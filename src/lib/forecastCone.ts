/**
 * "Where could gold go" = a probability range, not a prediction of direction.
 * Range half-width = daily volatility x days^HURST. HURST > 0.5 because gold trends
 * (moves compound faster than sqrt(time)); 0.58 was fitted by back-testing 60-day-vol
 * ranges on real daily gold closes so the 95% range contained ~92-94% of outcomes
 * at 7, 30 and 90 days. See forecastCone.test.ts.
 */
export const HURST = 0.58;
export const VOL_WINDOW = 60;

/** Sample stdev of the last `window` daily log returns (calendar days; gold-backed token trades 24/7). */
export function dailyVol(closes: number[], window = VOL_WINDOW): number | null {
  if (closes.length < window + 1) return null;
  const s = closes.slice(-(window + 1));
  const r: number[] = [];
  for (let i = 1; i < s.length; i++) r.push(Math.log(s[i] / s[i - 1]));
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  return Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1));
}

export interface Cone {
  days: number;
  median: number;
  lo68: number;
  hi68: number;
  lo95: number;
  hi95: number;
}

export function cone(price: number, sigmaDaily: number, days: number): Cone {
  const s = sigmaDaily * Math.pow(days, HURST);
  return {
    days,
    median: price,
    lo68: price * Math.exp(-s),
    hi68: price * Math.exp(s),
    lo95: price * Math.exp(-1.96 * s),
    hi95: price * Math.exp(1.96 * s),
  };
}
