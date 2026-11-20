/**
 * Turns simulated futures into concrete statements that are 90-99% likely, and checks the same
 * statements against what really happened at past dates (walk-forward, only data known then).
 */
import type { DailyBar } from '../forecast/types';
import { prepare, quantile, shareAbove, shareBelow, simulate, type SimResult } from './montecarlo';

export type ClaimKind = 'above7' | 'below7' | 'floor7' | 'band30' | 'ceiling30';

export interface Claim {
  kind: ClaimKind;
  probability: number; // share of simulated futures in which it holds
  levels: number[]; // USD/oz level(s) the statement uses
  horizon: number; // days
}

/** Target confidence per statement (the simulated probability lands at about this level). */
export const TARGET: Record<ClaimKind, number> = { above7: 0.95, below7: 0.96, floor7: 0.93, band30: 0.95, ceiling30: 0.97 };

export function makeClaims(sim: SimResult, spotUsd: number, T: Record<ClaimKind, number> = TARGET): Claim[] {
  const lv = (x: number) => spotUsd * Math.exp(x);
  const qa = quantile(sim.end[7], 1 - T.above7);
  const qb = quantile(sim.end[7], T.below7);
  const qf = quantile(sim.min[7], 1 - T.floor7);
  const b1 = quantile(sim.end[30], (1 - T.band30) / 2), b2 = quantile(sim.end[30], 1 - (1 - T.band30) / 2);
  const qc = quantile(sim.max[30], T.ceiling30);
  return [
    { kind: 'above7', horizon: 7, levels: [lv(qa)], probability: shareAbove(sim.end[7], qa) },
    { kind: 'below7', horizon: 7, levels: [lv(qb)], probability: shareBelow(sim.end[7], qb) },
    { kind: 'floor7', horizon: 7, levels: [lv(qf)], probability: shareAbove(sim.min[7], qf) },
    { kind: 'band30', horizon: 30, levels: [lv(b1), lv(b2)], probability: 1 - shareBelow(sim.end[30], b1) - shareAbove(sim.end[30], b2) },
    { kind: 'ceiling30', horizon: 30, levels: [lv(qc)], probability: shareBelow(sim.max[30], qc) },
  ];
}

/** Did the claim come true, given the real prices after the start date? `after` = real bars, days 1..30 after. */
export function claimHeld(c: Claim, startDay: number, after: { day: number; usd: number }[]): boolean | null {
  const within = (h: number) => after.filter((b) => b.day - startDay >= 1 && b.day - startDay <= h);
  const at = (h: number) => after.find((b) => b.day - startDay === h);
  switch (c.kind) {
    case 'above7': { const e = at(7); return e ? e.usd > c.levels[0] : null; }
    case 'below7': { const e = at(7); return e ? e.usd < c.levels[0] : null; }
    case 'floor7': { const w = within(7); return at(7) ? w.every((b) => b.usd > c.levels[0]) : null; }
    case 'band30': { const e = at(30); return e ? e.usd >= c.levels[0] && e.usd <= c.levels[1] : null; }
    case 'ceiling30': { const w = within(30); return at(30) ? w.every((b) => b.usd < c.levels[0]) : null; }
  }
}

export interface BacktestRow { kind: ClaimKind; checks: number; held: number }

/** Replays the method at past dates (every `stepDays`), with `paths` futures each. Causal. */
export function backtest(bars: readonly DailyBar[], paths = 4000, stepDays = 3, minHistory = 200): BacktestRow[] {
  const sorted = [...bars].filter((b) => b.usd > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
  const day = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86400e3);
  const rows: Record<ClaimKind, BacktestRow> = {
    above7: { kind: 'above7', checks: 0, held: 0 }, below7: { kind: 'below7', checks: 0, held: 0 }, floor7: { kind: 'floor7', checks: 0, held: 0 },
    band30: { kind: 'band30', checks: 0, held: 0 }, ceiling30: { kind: 'ceiling30', checks: 0, held: 0 },
  };
  for (let i = minHistory; i < sorted.length - 7; i += stepDays) {
    const known = sorted.slice(0, i + 1);
    const prep = prepare(known);
    if (!prep) continue;
    const sim = simulate(prep, paths, [7, 30], 1000 + i);
    const start = sorted[i];
    const startDay = day(start.date);
    const after = sorted.slice(i + 1, i + 40).map((b) => ({ day: day(b.date), usd: b.usd }));
    for (const c of makeClaims(sim, start.usd)) {
      const ok = claimHeld(c, startDay, after);
      if (ok === null) continue;
      rows[c.kind].checks++;
      if (ok) rows[c.kind].held++;
    }
  }
  return Object.values(rows);
}

/* ---------------------------------------------------------------- self-calibration */
export const KINDS: ClaimKind[] = ['above7', 'below7', 'floor7', 'band30', 'ceiling30'];
export const LADDER = [0.9, 0.91, 0.92, 0.93, 0.94, 0.95, 0.96, 0.97, 0.98, 0.99, 0.995, 0.999];
/** Required past success before a level is used; above the 90% promise to allow for picking the level. */
export const NEED = 0.92;

export type Ladder = Record<ClaimKind, { target: number; checks: number; held: number }[]>;

/** Walk-forward back-test of every statement at every confidence level on the ladder. Causal. */
export function backtestLadder(bars: readonly DailyBar[], paths = 3000, stepDays = 3, minHistory = 200): Ladder {
  const sorted = [...bars].filter((b) => b.usd > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
  const day = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86400e3);
  const out = Object.fromEntries(KINDS.map((k) => [k, LADDER.map((target) => ({ target, checks: 0, held: 0 }))])) as Ladder;
  for (let i = minHistory; i < sorted.length - 7; i += stepDays) {
    const prep = prepare(sorted.slice(0, i + 1));
    if (!prep) continue;
    const sim = simulate(prep, paths, [7, 30], 1000 + i);
    const startDay = day(sorted[i].date);
    const after = sorted.slice(i + 1, i + 40).map((b) => ({ day: day(b.date), usd: b.usd }));
    LADDER.forEach((target, li) => {
      const T = Object.fromEntries(KINDS.map((k) => [k, target])) as Record<ClaimKind, number>;
      for (const c of makeClaims(sim, sorted[i].usd, T)) {
        const ok = claimHeld(c, startDay, after);
        if (ok === null) continue;
        const cell = out[c.kind][li];
        cell.checks++;
        if (ok) cell.held++;
      }
    });
  }
  return out;
}

/** Per statement: the least extreme level whose past success reached NEED (else the most extreme one). */
export function chooseTargets(l: Ladder, need = NEED, minChecks = 30): { targets: Record<ClaimKind, number>; tested: BacktestRow[] } {
  const targets = {} as Record<ClaimKind, number>;
  const tested: BacktestRow[] = [];
  for (const k of KINDS) {
    const cells = l[k].filter((c) => c.checks >= minChecks);
    const pick = cells.find((c) => c.held / c.checks >= need) ?? cells[cells.length - 1] ?? l[k][l[k].length - 1];
    targets[k] = pick.target;
    tested.push({ kind: k, checks: pick.checks, held: pick.held });
  }
  return { targets, tested };
}
