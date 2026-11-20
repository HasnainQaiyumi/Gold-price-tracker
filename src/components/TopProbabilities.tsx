import { useEffect, useRef, useState } from 'react';
import type { DailyBar } from '../lib/forecast/types';
import type { BacktestRow, Claim, ClaimKind } from '../lib/sim/claims';
import type { SimMessage, SimRequest } from '../workers/sim.worker';

interface Props {
  series: DailyBar[] | null;
  spotUsd: number | null;
  toAed: (usd: number) => number;
  unitText: string;
}

const PATHS = 1_000_000;
const MIN_TESTED = 0.9; // a statement is shown only if it came true at least this often in the back-test
const RERUN_MOVE = 0.0025; // re-run when the live price moves 0.25%
const RERUN_MS = 10 * 60_000; // ...or every 10 minutes

const fmtDate = (days: number) =>
  new Date(Date.now() + days * 86400e3).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Dubai' });

function sentence(c: Claim, money: (usd: number) => string): string {
  const [a, b] = c.levels;
  switch (c.kind as ClaimKind) {
    case 'above7': return `On ${fmtDate(7)}, gold will be above ${money(a)}.`;
    case 'below7': return `On ${fmtDate(7)}, gold will be below ${money(a)}.`;
    case 'floor7': return `Over the next 7 days, gold will not drop below ${money(a)} at any point.`;
    case 'band30': return `On ${fmtDate(30)}, gold will be between ${money(a)} and ${money(b)}.`;
    case 'ceiling30': return `Over the next 30 days, gold will not rise above ${money(a)} at any point.`;
  }
}

export function TopProbabilities({ series, spotUsd, toAed, unitText }: Props) {
  const worker = useRef<Worker | null>(null);
  const runId = useRef(0);
  const last = useRef<{ spot: number; at: number } | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<{ claims: Claim[]; backtest: BacktestRow[]; paths: number; ms: number; at: number; spot: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    const w = new Worker(new URL('../workers/sim.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = (e: MessageEvent<SimMessage>) => {
      const m = e.data;
      if (m.id !== runId.current) return; // a newer run replaced this one
      if (m.type === 'progress') setProgress(m.done);
      else if (m.type === 'error') { setError(m.message); setProgress(null); }
      else { setResult({ claims: m.claims, backtest: m.backtest, paths: m.paths, ms: m.ms, at: Date.now(), spot: last.current?.spot ?? 0 }); setProgress(null); setError(null); }
    };
    const t = setInterval(() => tick((x) => x + 1), 30_000);
    return () => { w.terminate(); worker.current = null; clearInterval(t); };
  }, []);

  // Real time: run on load, then whenever the live price moves enough or the result gets old.
  useEffect(() => {
    if (!worker.current || !series || !spotUsd || series.length < 200) return;
    const prev = last.current;
    const due = !prev || Math.abs(spotUsd / prev.spot - 1) >= RERUN_MOVE || Date.now() - prev.at >= RERUN_MS;
    if (!due || (progress !== null && prev)) return;
    last.current = { spot: spotUsd, at: Date.now() };
    const id = ++runId.current;
    setProgress(0);
    const req: SimRequest = { id, bars: series, spotUsd, paths: PATHS };
    worker.current.postMessage(req);
  }, [series, spotUsd, progress]);

  const money = (usd: number) => `AED ${toAed(usd).toFixed(2)}`;
  const tested = (k: ClaimKind) => result?.backtest.find((r) => r.kind === k);
  const shown = (result?.claims ?? [])
    .map((c) => ({ c, t: tested(c.kind) }))
    .filter(({ t }) => t && t.checks >= 30 && t.held / t.checks >= MIN_TESTED)
    .sort((x, y) => y.t!.held / y.t!.checks - x.t!.held / x.t!.checks);
  const ageMin = result ? Math.round((Date.now() - result.at) / 60000) : 0;

  return (
    <section aria-label="Five things we are over 90% sure about" className="panel">
      <header className="mb-4">
        <h2 className="panel-title text-[1.35rem]">5 things we are over 90% sure about</h2>
        <p className="text-xs text-[#a39b8a] mt-1 max-w-[760px]">
          We simulate {PATHS.toLocaleString('en-US')} possible futures for gold, built from how it has really moved, then check every statement against the past. Prices in AED {unitText}.
        </p>
      </header>

      {progress !== null && (
        <div className="mb-4" role="status" aria-live="polite">
          <div className="flex justify-between text-[11px] text-[#a39b8a] mb-1">
            <span>{progress < 0.25 ? 'Checking every statement against past prices…' : `Simulating ${PATHS.toLocaleString('en-US')} futures…`}</span>
            <span className="font-mono-num">{Math.round(progress * 100)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
            <div className="h-full bg-[#d9a93f] transition-[width] duration-200" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        </div>
      )}
      {error && <p className="text-sm text-[#ef6b6b]">Could not run the simulation: {error}</p>}

      {result && (
        <>
          <ol className="flex flex-col gap-3">
            {shown.map(({ c, t }, i) => {
              const rate = t!.held / t!.checks;
              return (
                <li key={c.kind} className="rounded-2xl bg-[#0d0c09] border border-white/[0.07] p-4 flex gap-4 items-start">
                  <div className="shrink-0 w-[78px] text-center">
                    <div className="font-display text-[1.9rem] leading-none font-semibold text-[#6fcf97]">{Math.floor(rate * 100)}%</div>
                    <div className="text-[10px] uppercase tracking-[0.1em] text-[#7d7667] mt-1">came true</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[16px] leading-snug text-[#fbf7ef] font-semibold">
                      <span className="text-[#7d7667] mr-1.5">{i + 1}.</span>
                      {sentence(c, money)}
                    </div>
                    <div className="text-[12px] text-[#a39b8a] mt-1.5">
                      Happened in {(c.probability * 100).toFixed(1)}% of {result.paths.toLocaleString('en-US')} simulated futures. Checked on past prices: came true {t!.held} of {t!.checks} times.
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          {shown.length < 5 && (
            <p className="mt-3 text-[13px] text-[#f0cf72]">
              {5 - shown.length} statement{5 - shown.length > 1 ? 's' : ''} did not pass the 90% check on past prices this time, so {5 - shown.length > 1 ? 'they are' : 'it is'} hidden rather than shown with a number we cannot back up.
            </p>
          )}
          <p className="mt-4 text-[12px] leading-relaxed text-[#7d7667] max-w-[860px]">
            How this works: each simulated future reuses gold's real daily moves from the last two years in a random order, with calm and wild spells that behave the way real markets do. Before every run we replay the method on past dates, using only prices known on each day, and pick for each statement the level that really came true at least 92% of the time. The big number is that real success rate. None of these is a guarantee, and none says whether gold will go up or down. Last run {ageMin < 1 ? 'just now' : `${ageMin} min ago`} in {(result.ms / 1000).toFixed(1)} s · updates when the live price moves 0.25% or every 10 minutes.
          </p>
        </>
      )}
    </section>
  );
}
