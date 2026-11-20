import type {
  CurrencyCode,
  KaratPurity,
  MarketMode,
  PricingAssumptions,
} from './types';

export const TROY_OZ_GRAMS = 31.1034768;

export const KARAT_FACTOR: Record<KaratPurity, number> = {
  24: 1.0,
  22: 22 / 24,
  21: 21 / 24,
  18: 18 / 24,
};

// Dubai DGJG 22K board quotes slightly above pure 91.67% (~0.926 of 24K) due to regional alloy/retail rounding
export const UAE_DGJG_KARAT_FACTOR: Record<KaratPurity, number> = {
  24: 1.0,
  22: 0.926,
  21: 0.887,
  18: 0.761,
};

export const WEIGHT_UNITS = [
  { label: '1g', grams: 1 },
  { label: '10g', grams: 10 },
  { label: '1 Tola', grams: 11.6638 },
  { label: '1 Troy Oz', grams: 31.1035 },
  { label: '1 Kg', grams: 1000 },
] as const;

export const DEFAULT_ASSUMPTIONS: PricingAssumptions = {
  usdAed: 3.6725,
  usdInr: 93.15,
  indiaDutyPct: 15.0,
  indiaGstPct: 3.0,
  uaeRetailSpreadAedG: 10.5,
  usDealerSpreadPct: 1.5,
};

export function convertUsdOzToMarket(
  usdOz: number,
  currency: CurrencyCode,
  mode: MarketMode,
  karat: KaratPurity,
  unitGrams: number,
  assumptions: PricingAssumptions
): number {
  const spotUsdPerG = usdOz / TROY_OZ_GRAMS;
  const kFactor = KARAT_FACTOR[karat];

  if (currency === 'USD') {
    const raw = spotUsdPerG * kFactor * unitGrams;
    return mode === 'spot' ? raw : raw * (1 + assumptions.usDealerSpreadPct / 100);
  }

  if (currency === 'AED') {
    const spotAed24G = spotUsdPerG * assumptions.usdAed;
    if (mode === 'spot') {
      return spotAed24G * kFactor * unitGrams;
    }
    const retail24G = spotAed24G + assumptions.uaeRetailSpreadAedG;
    return retail24G * UAE_DGJG_KARAT_FACTOR[karat] * unitGrams;
  }

  // INR market: Spot -> +Import Duty (BCD+AIDC) -> +Retail GST
  const spotInr24G = spotUsdPerG * assumptions.usdInr;
  if (mode === 'spot') {
    return spotInr24G * kFactor * unitGrams;
  }
  const landed24G = spotInr24G * (1 + assumptions.indiaDutyPct / 100);
  const retail24G = landed24G * (1 + assumptions.indiaGstPct / 100);
  return retail24G * kFactor * unitGrams;
}

export function formatCurrency(value: number, currency: CurrencyCode): string {
  if (!Number.isFinite(value)) return '—';
  if (currency === 'USD') {
    return (
      '$' +
      value.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }
  if (currency === 'AED') {
    return (
      'AED ' +
      value.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }
  return (
    '₹' +
    value.toLocaleString('en-IN', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })
  );
}

export function getUnitLabel(grams: number): string {
  if (Math.abs(grams - 1) < 0.001) return '1g';
  if (Math.abs(grams - 10) < 0.001) return '10g';
  if (Math.abs(grams - 11.6638) < 0.01) return '1 Tola';
  if (Math.abs(grams - 31.1035) < 0.01) return '1 Troy Oz';
  if (Math.abs(grams - 1000) < 0.01) return '1 Kg';
  return `${grams}g`;
}

/** AED is fixed to USD at 3.6725 (official peg). */
export const AED_PEG = 3.6725;

/** USD per troy oz -> AED per gram of 24K. */
export function usdOzToAedPerG(usdOz: number): number {
  return (usdOz / TROY_OZ_GRAMS) * AED_PEG;
}

export const KARATS: KaratPurity[] = [24, 22, 21, 18];

export const UNITS = [
  { label: 'gram', short: 'g', grams: 1 },
  { label: '10 grams', short: '10g', grams: 10 },
  { label: 'tola', short: 'tola', grams: 11.6638 },
  { label: 'ounce', short: 'oz', grams: TROY_OZ_GRAMS },
] as const;

/** Spot value in AED of `grams` of `karat` gold (pure-gold content; no shop premium). */
export function usdOzToAed(usdOz: number, karat: KaratPurity = 24, grams = 1): number {
  return usdOzToAedPerG(usdOz) * KARAT_FACTOR[karat] * grams;
}

/** Compact AED figure: no decimals for big numbers, 2 for small. */
export function fmtAed(v: number): string {
  if (!Number.isFinite(v)) return '—';
  return v >= 1000 ? Math.round(v).toLocaleString('en-US') : v.toFixed(2);
}

/** Even more compact, for range ends. */
export function fmtShort(v: number): string {
  if (!Number.isFinite(v)) return '—';
  return v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(1);
}
