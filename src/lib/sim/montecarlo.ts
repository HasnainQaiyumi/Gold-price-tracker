/**
 * Monte Carlo "possible futures" for gold.
 * Model: filtered historical simulation. Real daily moves are standardised by the engine's GARCH(1,1)
 * volatility (so the shapes of real shocks, fat tails included, are kept), then re-drawn at random and
 * re-scaled by a volatility that evolves day by day exactly like the engine's GARCH recursion.
 * Drift = gold's long-run average growth. Results are kept as histograms of log-returns, so a million
 * paths need almost no memory. Pure and deterministic for a given seed (no DOM; runs in a Web Worker).
 */
import { DRIFT_PER_DAY, GARCH_ALPHA, GARCH_BETA, garchPath, toSeries } from '../forecast/index';
import type { DailyBar } from '../forecast/types';

export interface Prepared {
  z: Float64Array; // standardised real daily shocks (mean 0, variance 1)
  v0: number; // variance of tomorrow's move (engine GARCH)
  lr: number; // long-run daily variance (variance targeting)
}

export function prepare(bars: readonly DailyBar[]): Prepared | null {
  const s = toSeries(bars);
  const n = s.p.length;
  if (n < 120) return null;
  const vol = garchPath(s);
  const zs: number[] = [];
  for (let i = 1; i < n; i++) {
    if (s.day[i] - s.day[i - 1] !== 1) continue; // only clean 1-day moves
    const v = vol.v1[i - 1];
    if (!(v > 0)) continue;
    zs.push(Math.log(s.p[i] / s.p[i - 1]) / Math.sqrt(v));
  }
  if (zs.length < 60) return null;
  const mean = zs.reduce((a, b) => a + b, 0) / zs.length;
  const sd = Math.sqrt(zs.reduce((a, b) => a + (b - mean) ** 2, 0) / (zs.length - 1));
  const z = Float64Array.from(zs, (x) => (x - mean) / sd);
  const v0 = vol.v1[n - 1], lr = vol.lr[n - 1];
  if (!(v0 > 0) || !(lr > 0)) return null;
  return { z, v0, lr };
}

/* Histogram of log-returns: [-LO, +LO] in BINS bins (0.02% resolution). */
export const H_LO = -1.2;
export const H_HI = 1.2;
export const BINS = 12000;
const W = (H_HI - H_LO) / BINS;
const bin = (x: number) => (x <= H_LO ? 0 : x >= H_HI ? BINS - 1 : Math.floor((x - H_LO) / W));
export const binMid = (i: number) => H_LO + (i + 0.5) * W;

export interface Hist {
  counts: Uint32Array;
  n: number;
}
const newHist = (): Hist => ({ counts: new Uint32Array(BINS), n: 0 });

/** Log-return x such that a fraction p of paths are at or below it. */
export function quantile(h: Hist, p: number): number {
  const target = p * h.n;
  let c = 0;
  for (let i = 0; i < BINS; i++) {
    c += h.counts[i];
    if (c >= target) return binMid(i);
  }
  return binMid(BINS - 1);
}
/** Share of paths strictly above log-return x (bin resolution). */
export function shareAbove(h: Hist, x: number): number {
  let c = 0;
  for (let i = bin(x) + 1; i < BINS; i++) c += h.counts[i];
  return c / h.n;
}
export function shareBelow(h: Hist, x: number): number {
  let c = 0;
  for (let i = 0; i < bin(x); i++) c += h.counts[i];
  return c / h.n;
}

export interface SimResult {
  paths: number;
  end: Record<number, Hist>; // log(P_h / P_0)
  min: Record<number, Hist>; // lowest log-return reached during days 1..h
  max: Record<number, Hist>; // highest during days 1..h
  ms: number;
}

/** xorshift32: fast, deterministic. */
function rng(seed: number) {
  let x = seed >>> 0 || 2463534242;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

export function simulate(p: Prepared, paths: number, horizons: number[] = [7, 30], seed = 12345, onProgress?: (done: number) => void): SimResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const H = Math.max(...horizons);
  const hs = new Set(horizons);
  const end: Record<number, Hist> = {}, min: Record<number, Hist> = {}, max: Record<number, Hist> = {};
  for (const h of horizons) {
    end[h] = newHist();
    min[h] = newHist();
    max[h] = newHist();
  }
  const rand = rng(seed);
  const { z, v0, lr } = p;
  const nz = z.length;
  const omega = lr * (1 - GARCH_ALPHA - GARCH_BETA);
  const step = Math.max(1, Math.floor(paths / 20));
  for (let k = 0; k < paths; k++) {
    let v = v0, x = 0, lo = 0, hi = 0;
    for (let d = 1; d <= H; d++) {
      const shock = Math.sqrt(v) * z[(rand() * nz) | 0];
      x += DRIFT_PER_DAY + shock;
      if (x < lo) lo = x;
      if (x > hi) hi = x;
      v = omega + GARCH_ALPHA * shock * shock + GARCH_BETA * v;
      if (hs.has(d)) {
        end[d].counts[bin(x)]++; end[d].n++;
        min[d].counts[bin(lo)]++; min[d].n++;
        max[d].counts[bin(hi)]++; max[d].n++;
      }
    }
    if (onProgress && k % step === 0) onProgress(k / paths);
  }
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return { paths, end, min, max, ms: t1 - t0 };
}
