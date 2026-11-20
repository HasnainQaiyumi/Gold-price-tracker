import { KARAT_FACTOR, KARATS, usdOzToAedPerG } from './goldPricing';
import { SELL_HAIRCUT } from './savingsPlan';
import type { KaratPurity } from './types';

export interface Holding {
  id: string;
  grams: number; // weight of the item/bar
  karat: KaratPurity;
  paidAed: number; // total AED paid (0 = unknown)
}

export interface HoldingStats {
  fineGrams: number; // pure-gold content
  spotValue: number; // AED at spot
  sellValue: number; // AED after the assumed shop buy-back cut
  pl: number | null; // AED profit/loss if sold now
  plPct: number | null;
  breakEven24: number | null; // 24K AED/g spot needed to break even after the cut
}

export function holdingStats(h: Holding, spotUsdOz: number): HoldingStats {
  const fineGrams = h.grams * KARAT_FACTOR[h.karat];
  const spotValue = fineGrams * usdOzToAedPerG(spotUsdOz);
  const sellValue = spotValue * (1 - SELL_HAIRCUT);
  const known = h.paidAed > 0;
  return {
    fineGrams,
    spotValue,
    sellValue,
    pl: known ? sellValue - h.paidAed : null,
    plPct: known ? (sellValue / h.paidAed - 1) * 100 : null,
    breakEven24: known ? h.paidAed / (fineGrams * (1 - SELL_HAIRCUT)) : null,
  };
}

export function holdingsTotal(hs: Holding[], spotUsdOz: number) {
  let fine = 0, sell = 0, paid = 0, paidKnownSell = 0;
  for (const h of hs) {
    const s = holdingStats(h, spotUsdOz);
    fine += s.fineGrams;
    sell += s.sellValue;
    if (h.paidAed > 0) {
      paid += h.paidAed;
      paidKnownSell += s.sellValue;
    }
  }
  return { fine, sell, paid, pl: paid > 0 ? paidKnownSell - paid : null, plPct: paid > 0 ? (paidKnownSell / paid - 1) * 100 : null };
}

const num = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;

/** Validates untrusted (stored or typed) data: drops anything malformed, caps the list size. */
export function sanitizeHoldings(raw: unknown): Holding[] {
  if (!Array.isArray(raw)) return [];
  const out: Holding[] = [];
  for (const r of raw.slice(0, 50)) {
    const o = (r ?? {}) as Record<string, unknown>;
    const grams = num(o.grams, 0.01, 1_000_000);
    const paidAed = num(o.paidAed, 0, 1_000_000_000);
    const karat = KARATS.find((k) => k === o.karat);
    if (grams === null || paidAed === null || !karat || typeof o.id !== 'string') continue;
    out.push({ id: o.id.slice(0, 40), grams, karat, paidAed });
  }
  return out;
}
