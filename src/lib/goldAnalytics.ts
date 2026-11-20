import type { DailyClose } from './types';

/** Replace today's close with the live spot, or append it if today isn't in the series yet. */
export function withLiveSpot(daily: DailyClose[], spotUsdOz: number, quoteAtIso: string): DailyClose[] {
  const day = quoteAtIso.slice(0, 10);
  const out = daily.filter((d) => d.date <= day);
  if (out.length && out[out.length - 1].date === day) {
    out[out.length - 1] = { date: day, usd: spotUsdOz };
  } else {
    out.push({ date: day, usd: spotUsdOz });
  }
  return out;
}

/** Simple moving average series; null until `n` points exist. */
export function smaSeries(v: number[], n: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    sum += v[i];
    if (i >= n) sum -= v[i - n];
    out.push(i >= n - 1 ? sum / n : null);
  }
  return out;
}

/** Wilder RSI. Returns null if there isn't enough data. */
export function rsi(v: number[], period = 14): number | null {
  if (v.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = v[i] - v[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgG = gain / period;
  let avgL = loss / period;
  for (let i = period + 1; i < v.length; i++) {
    const d = v[i] - v[i - 1];
    avgG = (avgG * (period - 1) + Math.max(d, 0)) / period;
    avgL = (avgL * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgL === 0) return 100;
  return 100 - 100 / (1 + avgG / avgL);
}

/** Annualised volatility (%) from sample stdev of the last `window` daily log returns. */
export function annualisedVolPct(v: number[], window = 30): number | null {
  if (v.length < window + 1) return null;
  const s = v.slice(-(window + 1));
  const r: number[] = [];
  for (let i = 1; i < s.length; i++) r.push(Math.log(s[i] / s[i - 1]));
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  const varc = r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1);
  return Math.sqrt(varc) * Math.sqrt(252) * 100;
}

/** Worst peak-to-trough fall (%, negative) over the series. */
export function maxDrawdownPct(v: number[]): number | null {
  if (v.length < 2) return null;
  let peak = v[0];
  let worst = 0;
  for (const x of v) {
    peak = Math.max(peak, x);
    worst = Math.min(worst, x / peak - 1);
  }
  return worst * 100;
}

/** Percent change over the last `n` trading days. */
export function returnPct(v: number[], n: number): number | null {
  if (v.length < n + 1) return null;
  return (v[v.length - 1] / v[v.length - 1 - n] - 1) * 100;
}
