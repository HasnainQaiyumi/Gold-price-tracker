/**
 * Contract between the forecast engine (src/lib/forecast/index.ts) and the UI.
 * All prices are USD per troy oz of 24K gold; the UI converts to AED / karat / unit.
 */
export interface DailyBar {
  date: string; // YYYY-MM-DD (UTC)
  usd: number; // close, USD/oz
}

export interface RangeForecast {
  days: number; // horizon in calendar days (7, 30, 90)
  now: number; // starting price (USD/oz)
  median: number; // central estimate (USD/oz)
  likelyLow: number; // "most likely" band, nominal probability = likelyProb
  likelyHigh: number;
  extremeLow: number; // "almost certainly" band, nominal probability = extremeProb
  extremeHigh: number;
  likelyProb: number; // e.g. 0.68
  extremeProb: number; // e.g. 0.95
  sureLow: number; // "99% sure" band, nominal probability = sureProb
  sureHigh: number;
  sureProb: number; // 0.99
}

export interface DirectionView {
  label: 'up' | 'down' | 'none'; // 'none' unless a statistically proven edge exists
  probabilityUp: number; // 0..1 for the 30-day horizon
  significant: boolean; // true only if the signal beat a coin flip out-of-sample with p < 0.05
  reason: string; // one plain-English sentence for a non-expert
}

export interface Scorecard {
  horizonDays: number;
  samples: number; // number of past predictions checked (walk-forward, no look-ahead)
  likelyHitRate: number; // share of past outcomes that landed inside the likely band
  extremeHitRate: number; // share inside the extreme band
  sureHitRate: number; // share inside the 99% band
}

export interface ForecastResult {
  model: string; // short human-readable model name
  dailyVolPct: number; // current estimated daily volatility, %
  ranges: RangeForecast[];
  direction: DirectionView;
  scorecard: Scorecard[];
}
