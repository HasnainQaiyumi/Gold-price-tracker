import { convertUsdOzToMarket } from './goldPricing';
import type { HistoryPoint, PricingAssumptions } from './types';

/** Dealer buy-back haircut vs. spot when you sell (assumption, editable in one place). */
export const SELL_HAIRCUT = 0.01;

export interface GoldQuote {
  buyAedPerG: number; // what you pay per gram of 24K today (UAE retail)
  sellAedPerG: number; // what you'd realistically get per gram selling back
  roundTripCostPct: number; // % gold must rise just to break even
}

export function getGoldQuote(spotUsdOz: number, assumptions: PricingAssumptions): GoldQuote {
  const buy = convertUsdOzToMarket(spotUsdOz, 'AED', 'actual', 24, 1, assumptions);
  const spot = convertUsdOzToMarket(spotUsdOz, 'AED', 'spot', 24, 1, assumptions);
  const sell = spot * (1 - SELL_HAIRCUT);
  return { buyAedPerG: buy, sellAedPerG: sell, roundTripCostPct: (buy / sell - 1) * 100 };
}

/** Value (AED, after selling) of investing `monthly` AED each month for `years` at `annualReturnPct` gold-price growth. */
export function projectSavings(
  monthly: number,
  years: number,
  annualReturnPct: number,
  quote: GoldQuote
): { invested: number; value: number; gramsOwned: number } {
  const n = Math.round(years * 12);
  const invested = monthly * n;
  const premium = quote.buyAedPerG / (quote.sellAedPerG / (1 - SELL_HAIRCUT)); // buy / spot
  const m = Math.pow(1 + annualReturnPct / 100, 1 / 12) - 1;
  const annuity = Math.abs(m) < 1e-9 ? n : (Math.pow(1 + m, n) - 1) / m;
  const value = (monthly / premium) * annuity * (1 - SELL_HAIRCUT);
  const gramsOwned = invested / quote.buyAedPerG;
  return { invested, value, gramsOwned };
}

/** Months until `target` AED is reached; Infinity if never. */
export function monthsToTarget(
  monthly: number,
  target: number,
  annualReturnPct: number,
  quote: GoldQuote
): number {
  if (monthly <= 0 || annualReturnPct <= 0) return Infinity;
  const premium = quote.buyAedPerG / (quote.sellAedPerG / (1 - SELL_HAIRCUT));
  const m = Math.pow(1 + annualReturnPct / 100, 1 / 12) - 1;
  const needAnnuity = target / ((monthly / premium) * (1 - SELL_HAIRCUT));
  return Math.log(1 + needAnnuity * m) / Math.log(1 + m);
}

/** Monthly AED needed to reach `target` in `years` at `annualReturnPct`. */
export function monthlyNeeded(
  target: number,
  years: number,
  annualReturnPct: number,
  quote: GoldQuote
): number {
  const unit = projectSavings(1, years, annualReturnPct, quote).value;
  return unit > 0 ? target / unit : Infinity;
}

export type TimingSignal = { label: 'Below average' | 'Near average' | 'Above average'; pct: number };

/** Spot vs 30-day average. Descriptive only — not a prediction. */
export function timingSignal(spotUsdOz: number, history: HistoryPoint[]): TimingSignal {
  const avg = history.length ? history.reduce((s, p) => s + p.usdOz, 0) / history.length : spotUsdOz;
  const pct = (spotUsdOz / avg - 1) * 100;
  return { label: pct < -2 ? 'Below average' : pct > 2 ? 'Above average' : 'Near average', pct };
}
