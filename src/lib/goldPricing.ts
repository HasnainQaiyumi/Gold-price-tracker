import type {
  ArbitrageBreakdown,
  CurrencyCode,
  KaratPurity,
  MarketMode,
  PricingAssumptions,
  PurchaseType,
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

export function computeDubaiVsIndiaArbitrage(
  spotUsdOz: number,
  grams: number,
  makingPct: number,
  purchaseType: PurchaseType,
  karat: KaratPurity,
  assumptions: PricingAssumptions
): ArbitrageBreakdown {
  const safeGrams = Math.max(0.1, grams);
  const safeMaking = Math.max(0, makingPct);
  const effectiveKarat: KaratPurity = purchaseType === 'bullion' ? 24 : karat;

  const uaeGoldBaseAed = convertUsdOzToMarket(
    spotUsdOz,
    'AED',
    'actual',
    effectiveKarat,
    safeGrams,
    assumptions
  );
  const uaeMakingAed =
    purchaseType === 'bullion' ? uaeGoldBaseAed * 0.015 : uaeGoldBaseAed * (safeMaking / 100);
  const uaeSub = uaeGoldBaseAed + uaeMakingAed;

  let uaeNetVatAed = 0;
  if (purchaseType === 'jewellery') {
    uaeNetVatAed = uaeSub * 0.05;
  } else if (purchaseType === 'tourist') {
    // UAE Planet Tax Free refunds ~85% of the 5% VAT at airport departure
    uaeNetVatAed = uaeSub * 0.05 * 0.15;
  }

  const uaeTotalAed = uaeSub + uaeNetVatAed;
  const aedToInr = assumptions.usdInr / assumptions.usdAed;
  const uaeTotalInr = uaeTotalAed * aedToInr;

  // India actual retail gold includes 3% GST; isolate pre-GST landed value first
  const indRetailWithGstInr = convertUsdOzToMarket(
    spotUsdOz,
    'INR',
    'actual',
    effectiveKarat,
    safeGrams,
    assumptions
  );
  const indGoldLandedInr = indRetailWithGstInr / (1 + assumptions.indiaGstPct / 100);
  const indMakingInr =
    purchaseType === 'bullion' ? indGoldLandedInr * 0.015 : indGoldLandedInr * (safeMaking / 100);
  const indGstInr = (indGoldLandedInr + indMakingInr) * (assumptions.indiaGstPct / 100);
  const indTotalInr = indGoldLandedInr + indMakingInr + indGstInr;
  const indTotalAed = indTotalInr / aedToInr;

  const savingsInr = indTotalInr - uaeTotalInr;
  const savingsPct = indTotalInr > 0 ? (savingsInr / indTotalInr) * 100 : 0;

  let cheaperMarket: ArbitrageBreakdown['cheaperMarket'] = 'Parity';
  if (savingsInr > 100) cheaperMarket = 'Dubai';
  else if (savingsInr < -100) cheaperMarket = 'India';

  return {
    uaeGoldBaseAed,
    uaeMakingAed,
    uaeNetVatAed,
    uaeTotalAed,
    uaeTotalInr,
    indGoldLandedInr,
    indMakingInr,
    indGstInr,
    indTotalInr,
    indTotalAed,
    savingsInr,
    savingsPct,
    cheaperMarket,
  };
}

/** AED is fixed to USD at 3.6725 (official peg). */
export const AED_PEG = 3.6725;

/** USD per troy oz -> AED per gram of 24K. */
export function usdOzToAedPerG(usdOz: number): number {
  return (usdOz / TROY_OZ_GRAMS) * AED_PEG;
}
