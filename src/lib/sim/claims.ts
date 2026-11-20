/**
 * Turns simulated futures into concrete statements, and checks the same statements against what
 * really happened at past dates (walk-forward: only data known at each date is used).
 * Focus: next week and next month at 99%. Each statement's level is self-calibrated before every run.
 */
import type { DailyBar, ImpliedVol } from '../forecast/types';
import { prepare, quantile, shareAbove, shareBelow, simulate, type SimResult } from './montecarlo';

export type ClaimKind = 'week' | 'month' | 'floor7' | 'floor30' | 'ceiling30';

export interface Claim {
  kind: ClaimKind;
  probability: number; // share of simulated futures in which it holds
  levels: number[]; // USD/oz level(s) the statement uses
  horizon: number; // days
}

export interface BacktestRow { kind: ClaimKind; checks: number; held: number; target: number }

export const KINDS: ClaimKind[] = ['week', 'month', 'floor7', 'floor30', 'ceiling30'];
const BAND_LADDER = [0.99, 0.993, 0.995, 0.997, 0.998, 0.999, 0.9995];
const PATH_LADDER = [0.95, 0.96, 0.97, 0.98, 0.99, 0.995, 0.999];
export const LADDERS: Record<ClaimKind, number[]> = { week: BAND_LADDER, month: BAND_LADDER, floor7: PATH_LADDER, floor30: PATH_LADDER, ceiling30: PATH_LADDER };
/** Past success a level must reach before it is used: 99% for the headline week/month ranges. */
export const NEED: Record<ClaimKind, number> = { week: 0.99, month: 0.99, floor7: 0.95, floor30: 0.95, ceiling30: 0.95 };
export const DEFAULT_TARGET: Record<ClaimKind, number> = { week: 0.99, month: 0.99, floor7: 0.95, floor30: 0.95, ceiling30: 0.95 };

export function makeClaims(sim: SimResult, spotUsd: number, T: Record<ClaimKind, number> = DEFAULT_TARGET): Claim[] {
  const lv = (x: number) => spotUsd * Math.exp(x);
  const band = (h: number, p: number): Claim => {
    const a = quantile(sim.end[h], (1 - p) / 2), b = quantile(sim.end[h], 1 - (1 - p) / 2);
    return { kind: h === 7 ? 'week' : 'month', horizon: h, levels: [lv(a), lv(b)], probability: 1 - shareBelow(sim.end[h], a) - shareAbove(sim.end[h], b) };
  };
  const f7 = quantile(sim.min[7], 1 - T.floor7), f30 = quantile(sim.min[30], 1 - T.floor30), c30 = quantile(sim.max[30], T.ceiling30);
  return [
    band(7, T.week),
    band(30, T.month),
    { kind: 'floor7', horizon: 7, levels: [lv(f7)], probability: shareAbove(sim.min[7], f7) },
    { kind: 'floor30', horizon: 30, levels: [lv(f30)], probability: shareAbove(sim.min[30], f30) },
    { kind: 'ceiling30', horizon: 30, levels: [lv(c30)], probability: shareBelow(sim.max[30], c30) },
  ];
}

/** Did the claim come true, given the real prices after the start date? null = outcome not known yet. */
export function claimHeld(c: Claim, startDay: number, after: { day: number; usd: number }[]): boolean | null {
  const within = (h: number) => after.filter((b) => b.day - startDay >= 1 && b.day - startDay <= h);
  const at = (h: number) => after.find((b) => b.day - startDay === h);
  switch (c.kind) {
    case 'week': { const e = at(7); return e ? e.usd >= c.levels[0] && e.usd <= c.levels[1] : null; }
    case 'month': { const e = at(30); return e ? e.usd >= c.levels[0] && e.usd <= c.levels[1] : null; }
    case 'floor7': return at(7) ? within(7).every((b) => b.usd > c.levels[0]) : null;
    case 'floor30': return at(30) ? within(30).every((b) => b.usd > c.levels[0]) : null;
    case 'ceiling30': return at(30) ? within(30).every((b) => b.usd < c.levels[0]) : null;
  }
}

export type Ladder = Record<ClaimKind, { target: number; checks: number; held: number }[]>;

/** Walk-forward back-test of every statement at every level on its ladder. Causal. */
export function backtestLadder(bars: readonly DailyBar[], paths = 3000, stepDays = 3, minHistory = 200, implied?: readonly ImpliedVol[]): Ladder {
  const sorted = [...bars].filter((b) => b.usd > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
  const day = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86400e3);
  const out = Object.fromEntries(KINDS.map((k) => [k, LADDERS[k].map((target) => ({ target, checks: 0, held: 0 }))])) as Ladder;
  const rungs = Math.max(...KINDS.map((k) => LADDERS[k].length));
  for (let i = minHistory; i < sorted.length - 7; i += stepDays) {
    const prep = prepare(sorted.slice(0, i + 1), implied);
    if (!prep) continue;
    const sim = simulate(prep, paths, [7, 30], 1000 + i);
    const startDay = day(sorted[i].date);
    const after = sorted.slice(i + 1, i + 40).map((b) => ({ day: day(b.date), usd: b.usd }));
    for (let r = 0; r < rungs; r++) {
      const T = Object.fromEntries(KINDS.map((k) => [k, LADDERS[k][Math.min(r, LADDERS[k].length - 1)]])) as Record<ClaimKind, number>;
      for (const c of makeClaims(sim, sorted[i].usd, T)) {
        if (r >= LADDERS[c.kind].length) continue;
        const ok = claimHeld(c, startDay, after);
        if (ok === null) continue;
        const cell = out[c.kind][r];
        cell.checks++;
        if (ok) cell.held++;
      }
    }
  }
  return out;
}

/** Per statement: the least extreme level whose past success reached its NEED (else the most extreme one). */
export function chooseTargets(l: Ladder, minChecks = 30): { targets: Record<ClaimKind, number>; tested: BacktestRow[] } {
  const targets = {} as Record<ClaimKind, number>;
  const tested: BacktestRow[] = [];
  for (const k of KINDS) {
    const cells = l[k].filter((c) => c.checks >= minChecks);
    const pick = cells.find((c) => c.held / c.checks >= NEED[k]) ?? cells[cells.length - 1] ?? l[k][l[k].length - 1];
    targets[k] = pick.target;
    tested.push({ kind: k, checks: pick.checks, held: pick.held, target: pick.target });
  }
  return { targets, tested };
}

/** Back-test result published by the 8-hourly data job (21 years of history; too slow for a phone). */
export interface Calibration { generatedAt: string; fromDate: string; targets: Record<ClaimKind, number>; tested: BacktestRow[] }

/** Validates ./data/calibration.json (untrusted). Only levels from the ladders are accepted. */
export function sanitizeCalibration(raw: unknown): Calibration | null {
  const o = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null;
  if (!o || typeof o.generatedAt !== 'string' || Number.isNaN(Date.parse(o.generatedAt)) || typeof o.fromDate !== 'string') return null;
  const t = (o.targets ?? {}) as Record<string, unknown>;
  const targets = {} as Record<ClaimKind, number>;
  for (const k of KINDS) {
    if (typeof t[k] !== 'number' || !LADDERS[k].includes(t[k] as number)) return null;
    targets[k] = t[k] as number;
  }
  const tested: BacktestRow[] = [];
  for (const r of Array.isArray(o.tested) ? o.tested : []) {
    const x = (r ?? {}) as Record<string, unknown>;
    const ok = KINDS.includes(x.kind as ClaimKind) && [x.checks, x.held, x.target].every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0) && (x.held as number) <= (x.checks as number);
    if (ok) tested.push({ kind: x.kind as ClaimKind, checks: x.checks as number, held: x.held as number, target: x.target as number });
  }
  if (tested.length !== KINDS.length) return null;
  return { generatedAt: o.generatedAt, fromDate: o.fromDate.slice(0, 10), targets, tested };
}
