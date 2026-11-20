/**
 * Gold forecast engine: honest, calibrated price RANGES (not a direction guess).
 *
 * Method (chosen by walk-forward back-tests, see research/forecast_report.md):
 *   1. Volatility: GARCH(1,1) on calendar-day log returns with FIXED parameters (fitted offline)
 *      and variance targeting on the expanding sample variance of the input bars. The h-day
 *      variance is the exact sum of the 1..h step GARCH forecasts, so short horizons follow the
 *      current mood of the market and long horizons revert to the long-run level.
 *   2. Calibration: the range half-width is q x sd_h in log space. q is a split-conformal
 *      quantile of the input's OWN past standardised errors |ln(P[t+h]/P[t])| / sd_h(t) (only
 *      errors whose outcome was already known at t), shrunk toward a long-history prior with a
 *      pseudo-count of PRIOR_STRENGTH effective independent observations (n_eff = n / h).
 *   3. Centre: today's spot. No drift, because no direction signal survived testing.
 *
 * Everything is causal: the range for day t uses bars up to and including t only. The live
 * forecast is literally the last row of the same walk-forward that produces the scorecard.
 * Runtime is O(n^2) in the worst case with tiny constants (~ms for 730 bars); no MLE at runtime.
 */
import type { DailyBar, DirectionView, ForecastResult, RangeForecast, Scorecard } from './types';

// ---- constants fitted offline (numbers from forecast_report.md) ----

/** GARCH(1,1) ARCH weight. Gaussian QMLE with variance targeting on 720 Kraken PAXG/USD daily
 * closes 2024-11-30..2026-11-19 gave a=0.0971, b=0.8386 (persistence 0.936, half-life ~10 days).
 * The tune-half-only fit (a=0.118, b=0.826) gave near-identical walk-forward scores (report table E1). */
export const GARCH_ALPHA = 0.097;
/** GARCH(1,1) persistence weight (see GARCH_ALPHA). */
export const GARCH_BETA = 0.839;
/** Prior multiplier for the 68% band. Monthly 1976-2026 standardised scores gave 0.94-0.97 and the
 * daily PAXG sample 1.06-1.15; 1.00 sits between (Normal would be 0.994). Report section 4. */
export const PRIOR_Q68 = 1.0;
/** Prior multiplier for the 95% band: gold's tails are fatter than Normal (1.96). Monthly 1976-2026
 * GARCH/EWMA scores, corrected for the monthly-averaging artefact, gave 2.11-2.28 at 1 and 3 months. */
export const PRIOR_Q95 = 2.22;
/** Prior weight in effective independent observations. k=20 was the only setting (of 0,5,10,20,40)
 * keeping walk-forward coverage within 3 points of nominal at both 7 and 30 days (report table E1). */
/** 99% multiplier prior. Measured walk-forward on real daily gold (PAXG 2024-26): 3.36 (7d), 3.16 (30d);
 * 55 years of monthly data give q99/q95 = 1.3-1.45 (fat tails), i.e. about 3.1 on top of PRIOR_Q95. */
export const PRIOR_Q99 = 3.2;

export const PRIOR_STRENGTH = 20;
/** Bars used to seed the variance recursion. */
export const INIT_BARS = 20;
/** Origins before this bar index produce no calibration scores (volatility not yet settled). */
export const SCORE_WARMUP = 60;
/** Fewer valid bars than this and the engine returns null. */
export const MIN_BARS = 120;
/** Horizons with fewer scorecard samples than this are left out of the scorecard. */
export const MIN_SCORECARD_SAMPLES = 30;
/** ...and horizons with fewer than this many NON-overlapping periods (samples / h) are left out too.
 * The checks overlap (one per past day), so e.g. 350 checks of a 90-day range are only ~4 separate
 * quarters: a hit rate from that is mostly noise (sd ~ 23 points) and would be shown as if it meant something. */
export const MIN_SCORECARD_PERIODS = 5;
/** Last date of the data the fixed constants (GARCH_ALPHA/BETA, PRIOR_*, PRIOR_STRENGTH) were chosen on.
 * Scorecard checks whose outcome falls on or before this date are in-sample for those constants; only
 * later checks are fully out-of-sample. (A nested test, constants re-chosen on the first 450 days only,
 * moved the in-sample hit rates by <= 1.5 points, so the effect is small; see the research report.) */
export const CONSTANTS_FITTED_THROUGH = '2026-11-19';
export const LIKELY_PROB = 0.68;
export const EXTREME_PROB = 0.95;
export const SURE_PROB = 0.99;
/** Share of up-months in gold's monthly prices 1971-2026 (52.3% of 637 months). Used as the 30-day
 * probability of a rise because no direction signal was proven: the only Bonferroni survivor (price vs
 * 10-month average, 1 month) had no edge over "always up" in 2008-2026 (52% vs 54%) (report section 6). */
export const BASE_RATE_UP_30D = 0.523;

export const MODEL_NAME = 'GARCH(1,1) volatility + conformal calibration';

/** How the scorecard counts: one check per past day, so 30- and 90-day windows overlap. */
export const SCORECARD_NOTE =
  'Each past day is one check, so long-horizon windows overlap: a 30-day score of n checks contains only about n/30 truly separate periods. ' +
  'The score averages different market moods: in our tests the ranges were too narrow during the 2025 rally (the 30-day "most likely" range held about 63 times in 100) ' +
  'and too wide during the 2026 sell-off (about 73 in 100). The model settings were chosen on these same past prices, so treat the score as a rough check, not proof.';

const DIRECTION_NONE: DirectionView = {
  label: 'none',
  probabilityUp: BASE_RATE_UP_30D,
  significant: false,
  reason:
    'We tested popular trend rules on 55 years of gold prices and none could reliably tell whether the next month goes up or down, so we do not guess; gold rose in about 52 of every 100 months.',
};

// ------------------------------- series -------------------------------

export interface Series {
  day: number[]; // days since 1970-01-01 (UTC)
  p: number[]; // close, USD/oz
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function dayNumber(date: string): number | null {
  const m = DATE_RE.exec(date);
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
  return Math.round(ms / 86_400_000);
}

/** Valid bars only, sorted by date, one per day (the last one given wins). */
export function toSeries(bars: readonly DailyBar[]): Series {
  const byDay = new Map<number, number>();
  for (const b of bars) {
    if (!b || typeof b.usd !== 'number' || !Number.isFinite(b.usd) || b.usd <= 0) continue;
    const d = typeof b.date === 'string' ? dayNumber(b.date) : null;
    if (d !== null) byDay.set(d, b.usd);
  }
  const days = [...byDay.keys()].sort((a, b) => a - b);
  return { day: days, p: days.map((d) => byDay.get(d) as number) };
}

// ------------------------------ volatility ------------------------------

export interface VolPath {
  /** v1[t]: variance of the next 1-day log return, forecast after observing bar t (NaN before INIT_BARS). */
  v1: Float64Array;
  /** lr[t]: long-run daily variance targeted at t = sum r^2 / sum gap-days over bars 1..t. */
  lr: Float64Array;
}

/** GARCH(1,1) filter with fixed parameters and expanding variance targeting. A return spanning a
 * g-day gap contributes r^2/g as its per-day shock. Causal: v1[t], lr[t] use bars 0..t only. */
export function garchPath(s: Series, a = GARCH_ALPHA, b = GARCH_BETA, initBars = INIT_BARS): VolPath {
  const n = s.p.length;
  const v1 = new Float64Array(n).fill(NaN);
  const lr = new Float64Array(n).fill(NaN);
  if (n <= initBars) return { v1, lr };
  let sumR2 = 0;
  let sumG = 0;
  let seed = 0;
  let v = 0;
  for (let t = 1; t < n; t++) {
    const g = Math.max(1, s.day[t] - s.day[t - 1]);
    const r = Math.log(s.p[t] / s.p[t - 1]);
    const shock = (r * r) / g;
    sumR2 += r * r;
    sumG += g;
    const L = sumR2 / sumG;
    if (t < initBars) {
      seed += shock;
    } else if (t === initBars) {
      seed += shock;
      v = seed / initBars;
      v1[t] = v;
      lr[t] = L;
    } else {
      v = (1 - a - b) * L + a * shock + b * v;
      v1[t] = v;
      lr[t] = L;
    }
  }
  return { v1, lr };
}

/** Sum of the 1..h step GARCH(1,1) variance forecasts (exact closed form). */
export function horizonVariance(v1: number, lr: number, h: number, a = GARCH_ALPHA, b = GARCH_BETA): number {
  const p = a + b;
  if (p >= 1) return v1 * h;
  return lr * h + (v1 - lr) * ((1 - Math.pow(p, h)) / (1 - p));
}

// ----------------------------- calibration -----------------------------

/** Split-conformal quantile: the ceil((n+1)p)-th smallest of `sorted` (clamped to the largest).
 * The 1e-9 guard stops float error from bumping an exact integer rank up by one
 * (e.g. 75 * 0.68 = 51.00000000000001 in IEEE doubles, which would give rank 52 instead of 51). */
export function conformalQuantile(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const k = Math.max(1, Math.min(n, Math.ceil((n + 1) * p - 1e-9)));
  return sorted[k - 1];
}

/** Blend an empirical quantile with the prior using n_eff = n/h effective observations. */
export function shrink(empirical: number, prior: number, n: number, h: number, k = PRIOR_STRENGTH): number {
  if (n === 0 || !Number.isFinite(empirical)) return prior;
  const neff = n / h;
  const w = neff / (neff + k);
  return w * empirical + (1 - w) * prior;
}

function insertSorted(arr: number[], x: number): void {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  arr.splice(lo, 0, x);
}

export interface WalkForward {
  /** sd[t]: standard deviation of ln(P[t+h]/P[t]) forecast at t (NaN while warming up). */
  sd: Float64Array;
  /** Calibrated multipliers at t: likely band = +/- q68 * sd, extreme band = +/- q95 * sd. */
  q68: Float64Array;
  q95: Float64Array;
  q99: Float64Array;
  /** Index of the bar exactly h calendar days after t, or -1 if that bar is not in the input. */
  outcome: Int32Array;
  /** Number of past scores whose outcome was known at t. */
  known: Int32Array;
}

/** Runs the engine at every bar t using only bars 0..t. The last row is the live forecast. */
export function walkForward(s: Series, vol: VolPath, h: number): WalkForward {
  const n = s.p.length;
  const sd = new Float64Array(n).fill(NaN);
  const q68 = new Float64Array(n).fill(NaN);
  const q95 = new Float64Array(n).fill(NaN);
  const q99 = new Float64Array(n).fill(NaN);
  const outcome = new Int32Array(n).fill(-1);
  const known = new Int32Array(n);
  const indexOfDay = new Map<number, number>();
  for (let i = 0; i < n; i++) indexOfDay.set(s.day[i], i);
  for (let t = 0; t < n; t++) {
    if (Number.isFinite(vol.v1[t])) sd[t] = Math.sqrt(horizonVariance(vol.v1[t], vol.lr[t], h));
    outcome[t] = indexOfDay.get(s.day[t] + h) ?? -1;
  }
  // scores that become known when bar k arrives
  const arrivals: number[][] = Array.from({ length: n }, () => []);
  for (let j = SCORE_WARMUP; j < n; j++) {
    const k = outcome[j];
    if (k < 0 || !Number.isFinite(sd[j]) || sd[j] <= 0) continue;
    arrivals[k].push(Math.abs(Math.log(s.p[k] / s.p[j])) / sd[j]);
  }
  const sorted: number[] = [];
  for (let t = 0; t < n; t++) {
    for (const x of arrivals[t]) insertSorted(sorted, x);
    const m = sorted.length;
    known[t] = m;
    q68[t] = shrink(conformalQuantile(sorted, LIKELY_PROB), PRIOR_Q68, m, h);
    q95[t] = shrink(conformalQuantile(sorted, EXTREME_PROB), PRIOR_Q95, m, h);
    q99[t] = Math.max(q95[t], shrink(conformalQuantile(sorted, SURE_PROB), PRIOR_Q99, m, h));
  }
  return { sd, q68, q95, q99, outcome, known };
}

/** Walk-forward hit rates over origins whose own prefix had >= MIN_BARS bars (overlapping windows).
 * Origins with a zero-width range (sd = 0, e.g. a stale feed repeating one price) are not counted:
 * a range of width 0 "containing" an unchanged price is not a meaningful hit. */
export function scorecardFor(s: Series, wf: WalkForward, h: number): Scorecard {
  let samples = 0;
  let likely = 0;
  let extreme = 0;
  let sure = 0;
  for (let t = MIN_BARS - 1; t < s.p.length; t++) {
    const k = wf.outcome[t];
    if (k < 0 || !(wf.sd[t] > 0) || !Number.isFinite(wf.sd[t]) || !Number.isFinite(wf.q68[t]) || !Number.isFinite(wf.q95[t])) continue;
    const z = Math.abs(Math.log(s.p[k] / s.p[t]));
    samples++;
    if (z <= wf.q68[t] * wf.sd[t]) likely++;
    if (z <= wf.q95[t] * wf.sd[t]) extreme++;
    if (z <= wf.q99[t] * wf.sd[t]) sure++;
  }
  return {
    horizonDays: h,
    samples,
    likelyHitRate: samples ? likely / samples : NaN,
    extremeHitRate: samples ? extreme / samples : NaN,
    sureHitRate: samples ? sure / samples : NaN,
  };
}

function rangeAt(now: number, sd: number, q68: number, q95: number, q99: number, h: number): RangeForecast {
  return {
    days: h,
    now,
    median: now,
    likelyLow: now * Math.exp(-q68 * sd),
    likelyHigh: now * Math.exp(q68 * sd),
    extremeLow: now * Math.exp(-q95 * sd),
    extremeHigh: now * Math.exp(q95 * sd),
    likelyProb: LIKELY_PROB,
    extremeProb: EXTREME_PROB,
    sureLow: now * Math.exp(-q99 * sd),
    sureHigh: now * Math.exp(q99 * sd),
    sureProb: SURE_PROB,
  };
}

/**
 * Forecast ranges for gold from daily closes (calendar days, e.g. PAXG scaled to spot).
 * @param bars daily closes, any order; invalid rows are ignored, duplicates keep the last one
 * @param spotUsd live spot (USD/oz); the ranges are centred on it. Falls back to the last close.
 * @param horizons calendar-day horizons, integers 1..365
 * @returns null when fewer than MIN_BARS valid bars are available, when the recent prices show no
 *   variation at all (zero volatility: a stale feed), or when the input is so extreme that a range
 *   would not be a finite number
 */
export function forecastGold(bars: readonly DailyBar[], spotUsd: number, horizons: number[] = [7, 30, 90]): ForecastResult | null {
  if (!Array.isArray(bars)) return null;
  const s = toSeries(bars);
  const n = s.p.length;
  if (n < MIN_BARS) return null;
  const now = Number.isFinite(spotUsd) && spotUsd > 0 ? spotUsd : s.p[n - 1];
  const hs = [...new Set((horizons ?? []).filter((h) => Number.isInteger(h) && h >= 1 && h <= 365))];
  const vol = garchPath(s);
  const last = n - 1;
  // v1 = 0 means every return so far was exactly 0: a zero-width range would be meaningless.
  if (!Number.isFinite(vol.v1[last]) || !(vol.v1[last] > 0)) return null;

  const ranges: RangeForecast[] = [];
  const scorecard: Scorecard[] = [];
  for (const h of hs) {
    const wf = walkForward(s, vol, h);
    const r = rangeAt(now, wf.sd[last], wf.q68[last], wf.q95[last], wf.q99[last], h);
    if (![r.likelyLow, r.likelyHigh, r.extremeLow, r.extremeHigh, r.sureLow, r.sureHigh].every((x) => Number.isFinite(x))) return null;
    ranges.push(r);
    const sc = scorecardFor(s, wf, h);
    if (sc.samples >= MIN_SCORECARD_SAMPLES && sc.samples >= MIN_SCORECARD_PERIODS * h) scorecard.push(sc);
  }
  return {
    model: MODEL_NAME,
    dailyVolPct: Math.sqrt(vol.v1[last]) * 100,
    ranges,
    direction: { ...DIRECTION_NONE },
    scorecard,
  };
}
