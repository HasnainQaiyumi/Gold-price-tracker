import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { DailyBar } from './types';
import {
  BASE_RATE_UP_30D,
  conformalQuantile,
  forecastGold,
  garchPath,
  GARCH_ALPHA,
  GARCH_BETA,
  horizonVariance,
  MIN_BARS,
  MIN_SCORECARD_PERIODS,
  PRIOR_Q68,
  PRIOR_Q95,
  scorecardFor,
  shrink,
  toSeries,
  walkForward,
} from './index';

// Real data: Kraken PAXG/USD daily closes, 720 consecutive UTC days (see fixture's "source").
const fx: { start: string; end: string; closes: number[] } = JSON.parse(
  readFileSync(new URL('../fixtures/paxg-kraken-daily.json', import.meta.url), 'utf8')
);
const DAY = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const t0 = Date.parse(`${fx.start}T00:00:00Z`);
const REAL: DailyBar[] = fx.closes.map((usd, i) => ({ date: isoDay(t0 + i * DAY), usd }));

/** Deterministic pseudo-random gold-like path (for maths / perf tests only, never shown to users). */
function synthetic(n: number, seed = 1, start = '2023-01-01'): DailyBar[] {
  let s = seed >>> 0;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const base = Date.parse(`${start}T00:00:00Z`);
  let p = 2000;
  const out: DailyBar[] = [];
  for (let i = 0; i < n; i++) {
    const z = Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
    p *= Math.exp(0.009 * z);
    out.push({ date: isoDay(base + i * DAY), usd: p });
  }
  return out;
}

test('fixture is the expected real series', () => {
  assert.equal(REAL.length, 720);
  assert.equal(REAL[REAL.length - 1].date, fx.end);
});

// ------------------------------- maths -------------------------------

test('horizonVariance: h=1 is the 1-step forecast, flat when at long-run level, reverts toward it', () => {
  assert.ok(Math.abs(horizonVariance(4e-4, 1e-4, 1) - 4e-4) < 1e-15);
  assert.ok(Math.abs(horizonVariance(1e-4, 1e-4, 90) - 90e-4) < 1e-15);
  const p = GARCH_ALPHA + GARCH_BETA;
  // closed form equals the explicit sum of step forecasts
  let sum = 0;
  for (let i = 1; i <= 30; i++) sum += 1e-4 + (4e-4 - 1e-4) * Math.pow(p, i - 1);
  assert.ok(Math.abs(horizonVariance(4e-4, 1e-4, 30) - sum) < 1e-15);
  // high current vol: per-day variance falls toward long-run as h grows
  assert.ok(horizonVariance(4e-4, 1e-4, 90) / 90 < horizonVariance(4e-4, 1e-4, 7) / 7);
});

test('conformalQuantile uses the ceil((n+1)p)-th order statistic, clamped', () => {
  const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(conformalQuantile(xs, 0.68), 8);
  assert.equal(conformalQuantile(xs, 0.95), 10);
  assert.ok(Number.isNaN(conformalQuantile([], 0.5)));
  // exact integer ranks must not be bumped by float error: 75 * 0.68 = 51.00000000000001 in doubles
  const ys = Array.from({ length: 74 }, (_, i) => i + 1);
  assert.equal(conformalQuantile(ys, 0.68), 51);
  const zs = Array.from({ length: 299 }, (_, i) => i + 1);
  assert.equal(conformalQuantile(zs, 0.68), 204); // 300 * 0.68 = 204 exactly
  assert.equal(conformalQuantile(zs, 0.95), 285); // 300 * 0.95 = 285 exactly
  assert.equal(conformalQuantile([5], 0.01), 5);
});

test('shrink: prior with no data, data-dominated with many effective samples', () => {
  assert.equal(shrink(NaN, 2.22, 0, 30), 2.22);
  assert.equal(shrink(1.5, 1.0, 600, 30), (20 / 40) * 1.5 + (20 / 40) * 1.0); // n_eff=20 vs k=20
  assert.ok(Math.abs(shrink(1.5, 1.0, 1e7, 7) - 1.5) < 1e-4);
});

test('garchPath: constant log return gives exactly that variance; NaN before seeding', () => {
  const bars = Array.from({ length: 50 }, (_, i) => ({ date: isoDay(t0 + i * DAY), usd: 100 * Math.exp(0.01 * i) }));
  const v = garchPath(toSeries(bars));
  assert.ok(Number.isNaN(v.v1[19]));
  for (let t = 20; t < 50; t++) assert.ok(Math.abs(v.v1[t] - 1e-4) < 1e-12 && Math.abs(v.lr[t] - 1e-4) < 1e-12);
});

test('toSeries: drops invalid rows, sorts, de-duplicates by date (last wins)', () => {
  const s = toSeries([
    { date: '2025-01-03', usd: 3 },
    { date: '2025-01-01', usd: 1 },
    { date: '2025-01-02', usd: Number.NaN },
    { date: '2025-02-30', usd: 5 },
    { date: 'garbage', usd: 5 },
    { date: '2025-01-01', usd: 2 },
    { date: '2025-01-04', usd: -1 },
  ]);
  assert.deepEqual(s.p, [2, 3]);
  assert.equal(s.day[1] - s.day[0], 2);
});

test('ranges: centred on spot, symmetric in log space, nested, widen with horizon', () => {
  const f = forecastGold(REAL, 3600)!;
  assert.ok(f);
  for (const r of f.ranges) {
    assert.equal(r.now, 3600);
    assert.equal(r.median, 3600);
    assert.ok(Math.abs(r.likelyLow * r.likelyHigh - 3600 * 3600) < 1e-6);
    assert.ok(Math.abs(r.extremeLow * r.extremeHigh - 3600 * 3600) < 1e-6);
    assert.ok(r.extremeLow < r.likelyLow && r.likelyLow < r.median && r.median < r.likelyHigh && r.likelyHigh < r.extremeHigh);
    assert.equal(r.likelyProb, 0.68);
    assert.equal(r.extremeProb, 0.95);
  }
  const [a, b, c] = f.ranges;
  assert.deepEqual(f.ranges.map((r) => r.days), [7, 30, 90]);
  assert.ok(a.extremeHigh < b.extremeHigh && b.extremeHigh < c.extremeHigh);
  assert.ok(f.dailyVolPct > 0.2 && f.dailyVolPct < 5);
});

// --------------------- cross-check against the research code ---------------------
// Reference values computed by research/engine replica (Python/numpy) on this exact fixture.
test('walk-forward matches the Python research implementation', () => {
  const s = toSeries(REAL);
  const vol = garchPath(s);
  assert.ok(Math.abs(Math.sqrt(vol.v1[719]) * 100 - 1.8934460660390013) < 1e-9);
  const ref: Record<number, { n: number; in68: number; in95: number; sd: number; q68: number; q95: number; sd300: number; q68_300: number; q95_300: number }> = {
    7: { n: 594, in68: 0.6936026936026936, in95: 0.9494949494949495, sd: 0.047859788682793586, q68: 1.049669007677049, q95: 2.2439619654888565, sd300: 0.022467986364561383, q68_300: 1.0238456200043844, q95_300: 2.219309298815603 },
    30: { n: 571, in68: 0.670753064798599, in95: 0.9667250437828371, sd: 0.08810796814663367, q68: 1.0814748836099202, q95: 2.238522102633299, sd300: 0.048609368900309834, q68_300: 1.0063959942757945, q95_300: 2.2573481636453723 },
    90: { n: 511, in68: 0.5929549902152642, in95: 0.9275929549902152, sd: 0.13707458002870232, q68: 1.1391241589537175, q95: 2.246061747757771, sd300: 0.08674960248327464, q68_300: 1.0400033115734906, q95_300: 2.2263434364323698 },
  };
  for (const h of [7, 30, 90]) {
    const wf = walkForward(s, vol, h);
    const sc = scorecardFor(s, wf, h);
    const r = ref[h];
    assert.equal(sc.samples, r.n);
    assert.ok(Math.abs(sc.likelyHitRate - r.in68) < 1e-12, `h=${h} in68`);
    assert.ok(Math.abs(sc.extremeHitRate - r.in95) < 1e-12, `h=${h} in95`);
    for (const [got, want] of [[wf.sd[719], r.sd], [wf.q68[719], r.q68], [wf.q95[719], r.q95], [wf.sd[300], r.sd300], [wf.q68[300], r.q68_300], [wf.q95[300], r.q95_300]]) {
      assert.ok(Math.abs(got - want) < 1e-9, `h=${h}: ${got} vs ${want}`);
    }
  }
});

// ------------------------------- no leakage -------------------------------

test('NO LEAKAGE: forecasts made at t are identical when data after t is altered', () => {
  const s = toSeries(REAL);
  const vol = garchPath(s);
  for (const t of [150, 333, 500, 650]) {
    const altered = REAL.map((b, i) => (i > t ? { ...b, usd: b.usd * (i % 2 ? 1.37 : 0.61) } : b));
    const s2 = toSeries(altered);
    const vol2 = garchPath(s2);
    for (const h of [7, 30, 90]) {
      const a = walkForward(s, vol, h);
      const b = walkForward(s2, vol2, h);
      for (let i = 0; i <= t; i++) {
        assert.ok(Object.is(a.sd[i], b.sd[i]) && Object.is(a.q68[i], b.q68[i]) && Object.is(a.q95[i], b.q95[i]), `t=${t} h=${h} i=${i}`);
      }
    }
    // and the public API on the prefix 0..t equals the full-series walk-forward row at t, for every
    // horizon and both bands (so the live forecast is exactly what the scorecard replays)
    const f = forecastGold(REAL.slice(0, t + 1), REAL[t].usd)!;
    assert.ok(f);
    for (const h of [7, 30, 90]) {
      const wf = walkForward(s, vol, h);
      const r = f.ranges.find((x) => x.days === h)!;
      const P = REAL[t].usd;
      assert.ok(Math.abs(r.likelyHigh / (P * Math.exp(wf.q68[t] * wf.sd[t])) - 1) < 1e-12, `t=${t} h=${h} likely`);
      assert.ok(Math.abs(r.extremeLow / (P * Math.exp(-wf.q95[t] * wf.sd[t])) - 1) < 1e-12, `t=${t} h=${h} extreme`);
    }
  }
});

test('NO LEAKAGE: a score enters the calibration only once its outcome bar has arrived', () => {
  const s = toSeries(REAL);
  const vol = garchPath(s);
  for (const h of [7, 30]) {
    const wf = walkForward(s, vol, h);
    // known[t] must equal the number of origins j >= 60 with j + h <= t (gap-free series)
    for (const t of [59, 60 + h - 1, 60 + h, 400, 719]) assert.equal(wf.known[t], Math.max(0, t - h - 60 + 1), `h=${h} t=${t}`);
  }
});

// ------------------------- calibration regression (real data) -------------------------

// NOTE: this is a REGRESSION test, not out-of-sample proof. The constants (GARCH a/b, priors, k) were
// chosen on this same fixture, so these rates are in-sample for those constants. A nested check
// (constants re-chosen on the first 450 days only) moved them by <= 1.5 points (research report, 5b).
test('real-data calibration: walk-forward coverage near nominal at 7 and 30 days', () => {
  const f = forecastGold(REAL, REAL[REAL.length - 1].usd)!;
  const by = Object.fromEntries(f.scorecard.map((s) => [s.horizonDays, s]));
  // 7d: ~85 independent weeks -> tight tolerance; 30d: only ~19 independent months -> looser.
  const tol: Record<number, [number, number]> = { 7: [0.06, 0.03], 30: [0.08, 0.04] };
  for (const h of [7, 30]) {
    const s = by[h];
    assert.ok(s && s.samples > 500, `h=${h} samples`);
    assert.ok(Math.abs(s.likelyHitRate - 0.68) <= tol[h][0], `h=${h} 68% band held ${(s.likelyHitRate * 100).toFixed(1)}%`);
    assert.ok(Math.abs(s.extremeHitRate - 0.95) <= tol[h][1], `h=${h} 95% band held ${(s.extremeHitRate * 100).toFixed(1)}%`);
  }
  // 90d is reported (only ~6 independent quarters, so no tight assertion), but must be sane.
  assert.ok(by[90] && by[90].extremeHitRate > 0.85);
});

test('gaps in the input (missing days) are handled and barely move the result', () => {
  const holes = REAL.filter((_, i) => i % 11 !== 5);
  const a = forecastGold(REAL, 3600)!;
  const b = forecastGold(holes, 3600)!;
  for (let i = 0; i < a.ranges.length; i++) {
    const wa = Math.log(a.ranges[i].extremeHigh / 3600);
    const wb = Math.log(b.ranges[i].extremeHigh / 3600);
    assert.ok(Math.abs(wb / wa - 1) < 0.15, `h=${a.ranges[i].days}: ${wa} vs ${wb}`);
  }
});

// ------------------------------- direction -------------------------------

test('direction: no proven edge -> none, base-rate probability, plain reason', () => {
  const f = forecastGold(REAL, 3600)!;
  assert.equal(f.direction.label, 'none');
  assert.equal(f.direction.significant, false);
  assert.equal(f.direction.probabilityUp, BASE_RATE_UP_30D);
  assert.ok(f.direction.reason.length > 20 && f.direction.reason.length < 260);
});

// ------------------------------- edges -------------------------------

test('returns null for short or unusable input; works from MIN_BARS', () => {
  assert.equal(forecastGold(REAL.slice(0, MIN_BARS - 1), 3000), null);
  assert.equal(forecastGold([], 3000), null);
  assert.equal(forecastGold(REAL.map((b) => ({ ...b, usd: Number.NaN })), 3000), null);
  const f = forecastGold(REAL.slice(0, MIN_BARS), 3000);
  assert.ok(f);
  // too little history for a 30/90-day scorecard -> those horizons are left out, ranges still given
  assert.equal(f!.ranges.length, 3);
  assert.deepEqual(f!.scorecard.map((s) => s.horizonDays), []);
  // early on the multipliers are the prior
  assert.ok(Math.abs(Math.log(f!.ranges[2].likelyHigh / 3000) / Math.log(f!.ranges[2].extremeHigh / 3000) - PRIOR_Q68 / PRIOR_Q95) < 1e-12);
});

test('stale feed: flat prices give null, not a zero-width range scored as "100% right"', () => {
  const flat = Array.from({ length: 300 }, (_, i) => ({ date: isoDay(t0 + i * DAY), usd: 3000 }));
  assert.equal(forecastGold(flat, 3000), null);
  // a flat stretch inside real data: origins with sd = 0 are not counted as scorecard hits
  const s = toSeries([...flat.slice(0, 200), ...REAL.slice(200).map((b, i) => ({ date: isoDay(t0 + (200 + i) * DAY), usd: b.usd }))]);
  const vol = garchPath(s);
  const wf = walkForward(s, vol, 7);
  const sc = scorecardFor(s, wf, 7);
  let counted = 0;
  for (let t = MIN_BARS - 1; t < s.p.length; t++) if (wf.outcome[t] >= 0 && wf.sd[t] > 0) counted++;
  assert.equal(sc.samples, counted);
  assert.ok(counted < s.p.length - MIN_BARS - 7 + 1, 'zero-sd origins must be excluded');
});

test('scorecard: a horizon needs >= MIN_SCORECARD_PERIODS non-overlapping periods to be listed', () => {
  const f = forecastGold(REAL, 3600, [7, 30, 90, 180, 365])!;
  for (const sc of f.scorecard) assert.ok(sc.samples / sc.horizonDays >= MIN_SCORECARD_PERIODS, `h=${sc.horizonDays}`);
  const listed = f.scorecard.map((x) => x.horizonDays);
  assert.deepEqual(listed, [7, 30, 90]); // 180d: ~2.3 periods, 365d: < 1 period -> left out
  assert.equal(f.ranges.length, 5); // ranges are still given
  // 450 bars: 90d has ~331 overlapping checks = 3.7 quarters -> left out; 30d kept
  const g = forecastGold(REAL.slice(0, 450), 3000)!;
  assert.deepEqual(g.scorecard.map((x) => x.horizonDays), [7, 30]);
});

test('every output is a finite number on hostile-but-valid inputs (or the result is null)', () => {
  const cases: DailyBar[][] = [
    REAL.map((b, i) => (i === 600 ? { ...b, usd: b.usd * 100 } : b)), // one bad tick
    REAL.map((b, i) => (i === 719 ? { ...b, usd: b.usd / 100 } : b)), // bad last tick
    REAL.map((b) => ({ ...b, usd: b.usd * 1e-300 })), // tiny scale
    REAL.map((b) => ({ ...b, usd: b.usd * 1e300 })), // huge scale
    REAL.map((b, i) => ({ ...b, usd: i % 2 ? 1e150 : 1e-150 })), // absurd oscillation
    REAL.filter((b) => ![0, 6].includes(new Date(`${b.date}T00:00:00Z`).getUTCDay())), // weekday-only feed
    [...REAL.slice(0, 360), ...REAL.slice(360).map((b) => ({ ...b, date: isoDay(Date.parse(`${b.date}T00:00:00Z`) + 365 * DAY) }))], // 1-year hole
  ];
  for (const [i, bars] of cases.entries()) {
    const f = forecastGold(bars, bars[bars.length - 1].usd, [1, 7, 30, 90, 365]);
    if (f === null) continue;
    const nums: number[] = [f.dailyVolPct, f.direction.probabilityUp];
    for (const r of f.ranges) nums.push(r.now, r.median, r.likelyLow, r.likelyHigh, r.extremeLow, r.extremeHigh);
    for (const s of f.scorecard) nums.push(s.samples, s.likelyHitRate, s.extremeHitRate);
    assert.ok(nums.every((x) => Number.isFinite(x)), `case ${i}`);
    for (const r of f.ranges) assert.ok(r.extremeLow <= r.likelyLow && r.likelyLow <= r.likelyHigh && r.likelyHigh <= r.extremeHigh, `case ${i}`);
  }
  // the scale cases must still produce a forecast (scale-invariant engine)
  assert.ok(forecastGold(cases[2], cases[2][719].usd) && forecastGold(cases[3], cases[3][719].usd));
});

test('invalid spot falls back to the last close; horizons are sanitised', () => {
  const f = forecastGold(REAL, Number.NaN, [30, 30, 0, 2.5, 1000, 7])!;
  assert.deepEqual(f.ranges.map((r) => r.days), [30, 7]);
  assert.equal(f.ranges[0].now, REAL[REAL.length - 1].usd);
});

// ------------------------------- performance -------------------------------

test('performance: < 50 ms for 730 bars (3 horizons, incl. scorecard)', () => {
  const bars = synthetic(730, 42);
  for (let i = 0; i < 3; i++) forecastGold(bars, bars[729].usd); // warm-up JIT
  const times: number[] = [];
  for (let i = 0; i < 7; i++) {
    const t = performance.now();
    const f = forecastGold(bars, bars[729].usd);
    times.push(performance.now() - t);
    assert.ok(f);
  }
  times.sort((a, b) => a - b);
  assert.ok(times[3] < 50, `median ${times[3].toFixed(1)} ms`);
});
