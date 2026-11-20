/**
 * "Most realistic prediction": one line, not a low/normal/high set.
 * The engine's back-tests (55 years of monthly data, 2 years daily) found no reliable way to call
 * the direction, so the most realistic single estimate is today's price grown at gold's long-run
 * average rate (the centre of the calibrated forecast). Uncertainty is kept as one plain "typical miss" figure.
 * The track record replays the same method at past dates and compares it with what really happened.
 */
import { forecastGold, LONG_RUN_GROWTH_PER_YEAR } from './index';
import type { DailyBar } from './types';

/** Gold's average growth since August 1971 (monthly data to Oct 2026: 43 -> 4105 USD/oz). */
export const LONG_RUN_GROWTH_PCT_PER_YEAR = Math.round(LONG_RUN_GROWTH_PER_YEAR * 1000) / 10;

export interface RealisticPoint {
  days: number;
  date: string; // YYYY-MM-DD
  usd: number; // most realistic price (median)
  typicalMissPct: number; // about 2 times in 3 the real price ends within +/- this % of `usd`
  lo: number; // that zone, for the faint shading only
  hi: number;
  sureLo: number; // 99%-sure range
  sureHi: number;
  sureHitRate: number | null; // walk-forward share of past outcomes inside the 99% range (null: too few)
}

export interface PastCall {
  fromDate: string;
  fromUsd: number;
  toDate: string;
  predictedUsd: number;
  lo: number;
  hi: number;
  actualUsd: number;
  missPct: number; // actual vs predicted, signed %
  inside: boolean; // landed inside the typical-miss zone
}

const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);
const indexOnOrAfter = (b: readonly DailyBar[], ymd: string) => b.findIndex((x) => x.date >= ymd);

export function realisticPath(series: readonly DailyBar[], spotUsd: number, horizons = [7, 30, 90]): RealisticPoint[] | null {
  const f = forecastGold(series, spotUsd, horizons);
  if (!f || !series.length) return null;
  const today = series[series.length - 1].date;
  return f.ranges.map((r) => ({
    days: r.days,
    date: addDays(today, r.days),
    usd: r.median,
    typicalMissPct: ((r.likelyHigh / r.median - 1) * 100 + (1 - r.likelyLow / r.median) * 100) / 2,
    lo: r.likelyLow,
    hi: r.likelyHigh,
    sureLo: r.sureLow,
    sureHi: r.sureHigh,
    sureHitRate: f.scorecard.find((sc) => sc.horizonDays === r.days)?.sureHitRate ?? null,
  }));
}

/** Replays the same method at past dates (only data known then) and checks it against reality. */
export function trackRecord(series: readonly DailyBar[], lookbacks = [120, 90, 60, 30], horizon = 30): PastCall[] {
  if (series.length < 200) return [];
  const today = series[series.length - 1].date;
  const out: PastCall[] = [];
  for (const back of lookbacks) {
    const i = indexOnOrAfter(series, addDays(today, -back));
    if (i < 0) continue;
    const known = series.slice(0, i + 1);
    const from = known[known.length - 1];
    const f = forecastGold(known, from.usd, [horizon]);
    if (!f) continue;
    const r = f.ranges[0];
    const j = indexOnOrAfter(series, addDays(from.date, horizon));
    if (j < 0) continue; // outcome not known yet
    const actual = series[j];
    out.push({
      fromDate: from.date,
      fromUsd: from.usd,
      toDate: actual.date,
      predictedUsd: r.median,
      lo: r.likelyLow,
      hi: r.likelyHigh,
      actualUsd: actual.usd,
      missPct: (actual.usd / r.median - 1) * 100,
      inside: actual.usd >= r.likelyLow && actual.usd <= r.likelyHigh,
    });
  }
  return out;
}
