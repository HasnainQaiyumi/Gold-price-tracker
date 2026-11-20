/// Runs the Monte Carlo + back-test off the main thread so the page never freezes.
import type { DailyBar, ImpliedVol } from '../lib/forecast/types';
import { backtestLadder, chooseTargets, makeClaims, type BacktestRow, type Calibration, type Claim } from '../lib/sim/claims';
import { curve, fan, prepare, simulate } from '../lib/sim/montecarlo';

export interface SimRequest {
  id: number; bars: DailyBar[]; spotUsd: number; paths: number;
  implied?: ImpliedVol[]; // traders' gold volatility (GVZ), blended into the starting volatility
  calib?: Calibration | null; // 21-year back-test from the data job; if absent, calibrate on `bars` here
}
export type SimMessage =
  | { id: number; type: 'progress'; done: number }
  | { id: number; type: 'result'; claims: Claim[]; backtest: BacktestRow[]; testedFrom: string | null; paths: number; ms: number; fan: number[][]; fanProbs: number[]; samples: number[][]; curves: Record<number, { x: number; p: number }[]> }
  | { id: number; type: 'error'; message: string };

const ctx = self as unknown as { postMessage: (m: SimMessage) => void; onmessage: ((e: MessageEvent<SimRequest>) => void) | null };

ctx.onmessage = (e) => {
  const { id, bars, spotUsd, paths, implied, calib } = e.data;
  try {
    const t0 = performance.now();
    const prep = prepare(bars, implied);
    if (!prep) throw new Error('not enough price history');
    // 1) Calibrate on the past: which confidence level really held at least 92% of the time?
    ctx.postMessage({ id, type: 'progress', done: 0.02 });
    // Without the published 21-year calibration, test on the last ~2 years only (fast enough for a phone).
    const local = bars.slice(-750);
    const { targets, tested } = calib ?? chooseTargets(backtestLadder(local, 3000, 3, 200, implied));
    ctx.postMessage({ id, type: 'progress', done: 0.25 });
    // 2) A million futures from today, at those levels.
    const sim = simulate(prep, paths, [7, 30], (Date.now() >>> 0) ^ id, (done) => ctx.postMessage({ id, type: 'progress', done: 0.25 + done * 0.75 }), { daily: true, samples: 60 });
    const claims = makeClaims(sim, spotUsd, targets);
    const fanProbs = [0.005, 0.025, 0.25, 0.5, 0.75, 0.975, 0.995];
    ctx.postMessage({
      id, type: 'result', claims, backtest: tested, testedFrom: calib?.fromDate ?? local[0]?.date ?? null, paths, ms: performance.now() - t0,
      fan: fan(sim, fanProbs), fanProbs,
      samples: sim.samples.map((a) => Array.from(a)),
      curves: { 7: curve(sim.end[7]), 30: curve(sim.end[30]) },
    });
  } catch (err) {
    ctx.postMessage({ id, type: 'error', message: String((err as Error)?.message ?? err) });
  }
};
