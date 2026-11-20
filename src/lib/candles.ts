/**
 * Daily OHLCV candles for the pro chart.
 *
 * Source: Coinbase Exchange PAXG-USD daily candles. PAXG is a token backed 1:1 by a
 * London Good Delivery troy ounce of gold, so its candles track spot gold closely
 * (typically within a few tenths of a percent). Coinbase only returns completed-ish UTC
 * days and the current day can lag, so the UI patches today's candle with the live spot
 * price via withLiveCandle().
 *
 * Everything except fetchPaxgCandles() is pure and unit-tested (src/lib/candles.test.ts).
 */

export interface Candle {
  time: string; // YYYY-MM-DD (UTC day the candle opened)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number; // PAXG traded that day (1 PAXG = 1 troy oz)
}

export interface LinePoint {
  time: string;
  value: number;
}

const DAY_MS = 86_400_000;
/** Coinbase rejects requests that would return more than 300 aggregations. */
const PAGE_DAYS = 300;
const PAGES = 3;
const MIN_CANDLES = 30;

/** Plausible USD/oz range for gold (same bounds as the live feed). */
const saneUsd = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 500 && n < 100000;
export const isSaneUsd = saneUsd;
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** UTC calendar day of an ISO timestamp / epoch ms. */
export function isoDay(at: string | number): string | null {
  const ms = typeof at === 'number' ? at : Date.parse(at);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Validate one Coinbase candle row: [time (unix s), low, high, open, close, volume].
 * Returns null for anything malformed or internally inconsistent.
 */
export function parseCoinbaseRow(row: unknown): Candle | null {
  if (!Array.isArray(row) || row.length < 6) return null;
  const [ts, low, high, open, close, volume] = row as unknown[];
  if (!finite(ts) || !Number.isInteger(ts) || ts < 1_000_000_000 || ts > 10_000_000_000) return null;
  if (!saneUsd(low) || !saneUsd(high) || !saneUsd(open) || !saneUsd(close)) return null;
  if (!finite(volume) || volume < 0) return null;
  // OHLC consistency (tiny tolerance for float noise).
  const eps = 1e-9 * high;
  if (high + eps < low) return null;
  if (open > high + eps || open < low - eps || close > high + eps || close < low - eps) return null;
  const time = isoDay(ts * 1000);
  if (!time) return null;
  return { time, open, high, low, close, volume };
}

/**
 * Parse any number of Coinbase payloads (pages) into clean ascending daily candles.
 * Non-array payloads and malformed rows are dropped; duplicate days keep the row seen last
 * (pass pages oldest-first so the freshest page wins).
 */
export function parseCoinbaseCandles(...payloads: unknown[]): Candle[] {
  const byDay = new Map<string, Candle>();
  for (const payload of payloads) {
    if (!Array.isArray(payload)) continue;
    for (const row of payload) {
      const c = parseCoinbaseRow(row);
      if (c) byDay.set(c.time, c);
    }
  }
  return [...byDay.values()].sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
}

/** The [start, end] windows (ISO) for each page, newest page first. Exactly 300 days each. */
export function pageWindows(nowMs: number, pages = PAGES): { start: string; end: string }[] {
  return Array.from({ length: pages }, (_, i) => {
    const end = nowMs - i * PAGE_DAYS * DAY_MS;
    const start = end - PAGE_DAYS * DAY_MS;
    return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
  });
}

async function getJson(url: string, timeoutMs: number, fetchImpl: typeof fetch): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { cache: 'no-store', signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export interface FetchCandlesOptions {
  now?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * ~900 days of PAXG-USD daily candles from Coinbase (3 pages of 300, fetched in parallel).
 * If an older page fails we keep the contiguous newer pages (no holes in the middle);
 * if the newest page fails, or too little data survives validation, this throws.
 */
export async function fetchPaxgCandles(opts: FetchCandlesOptions = {}): Promise<Candle[]> {
  const now = opts.now ?? Date.now();
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const windows = pageWindows(now);
  const settled = await Promise.allSettled(
    windows.map(({ start, end }) =>
      getJson(
        `https://api.exchange.coinbase.com/products/PAXG-USD/candles?granularity=86400&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
        timeoutMs,
        fetchImpl
      )
    )
  );
  const ok: unknown[] = [];
  for (const s of settled) {
    if (s.status !== 'fulfilled' || !Array.isArray(s.value)) break; // keep only the contiguous newest pages
    ok.push(s.value);
  }
  if (ok.length === 0) {
    const first = settled[0];
    throw new Error(`PAXG candles unavailable${first.status === 'rejected' ? `: ${String((first.reason as Error)?.message ?? first.reason)}` : ''}`);
  }
  const candles = parseCoinbaseCandles(...ok.reverse()); // oldest-first so the newest page wins on overlap
  if (candles.length < MIN_CANDLES) throw new Error('not enough candle history');
  return candles;
}

/* ------------------------------------------------------------------ pure helpers */

/** Multiply prices by k (e.g. spot / PAXG to remove the token's premium). Volume unchanged. */
export function scaleCandles(candles: Candle[], k: number): Candle[] {
  if (!finite(k) || k <= 0) return candles.map((c) => ({ ...c }));
  return candles.map((c) => ({ ...c, open: c.open * k, high: c.high * k, low: c.low * k, close: c.close * k }));
}

/** Largest PAXG-vs-spot gap we accept as a premium/discount; beyond this a feed is probably wrong. */
export const MAX_ALIGN_DEVIATION = 0.03;

/**
 * Factor that maps PAXG prices onto spot gold.
 * - With a live PAXG quote: k = spot / paxg (the token's current premium or discount).
 * - Else, if the last candle is today's (partial) candle: k = spot / its close.
 * - Else 1 (no simultaneous reference; we never fold today's move into history).
 * Returns 1 whenever the implied gap exceeds MAX_ALIGN_DEVIATION.
 */
export function alignFactor(candles: Candle[], spotUsd: number | null, nowIso: string, paxgUsd?: number | null): number {
  if (!saneUsd(spotUsd)) return 1;
  let ref: number | null = null;
  if (saneUsd(paxgUsd)) ref = paxgUsd;
  else {
    const last = candles[candles.length - 1];
    if (last && last.time === isoDay(nowIso)) ref = last.close;
  }
  if (ref === null) return 1;
  const k = spotUsd / ref;
  return Math.abs(k - 1) <= MAX_ALIGN_DEVIATION ? k : 1;
}

/**
 * Update (or create) today's candle from the live spot price.
 * - Last candle is today: close = spot, high/low widen to include spot.
 * - Last candle is older: append today's candle opening at the previous close.
 * - Last candle is in the future (clock skew) or spot is not sane: unchanged copy.
 */
export function withLiveCandle(candles: Candle[], spotUsd: number | null, nowIso: string): Candle[] {
  const out = candles.map((c) => ({ ...c }));
  const today = isoDay(nowIso);
  if (!saneUsd(spotUsd) || !today || out.length === 0) return out;
  const last = out[out.length - 1];
  if (last.time === today) {
    last.close = spotUsd;
    last.high = Math.max(last.high, spotUsd);
    last.low = Math.min(last.low, spotUsd);
  } else if (last.time < today) {
    out.push({
      time: today,
      open: last.close,
      high: Math.max(last.close, spotUsd),
      low: Math.min(last.close, spotUsd),
      close: spotUsd,
      volume: 0,
    });
  }
  return out;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Defensive clean-up for candles that did not come straight from parseCoinbaseCandles():
 * drops rows with a bad day key, non-finite/insane prices, bad volume or inconsistent OHLC,
 * then sorts ascending and dedupes by day (last wins). lightweight-charts throws on
 * unsorted or duplicate times, and a throw inside a React effect would take down the page.
 */
export function normalizeCandles(candles: readonly Candle[]): Candle[] {
  const byDay = new Map<string, Candle>();
  for (const c of candles) {
    if (!c || typeof c.time !== 'string' || !DAY_RE.test(c.time) || isoDay(`${c.time}T00:00:00Z`) !== c.time) continue;
    const { open, high, low, close, volume } = c;
    if (!saneUsd(open) || !saneUsd(high) || !saneUsd(low) || !saneUsd(close)) continue;
    if (!finite(volume) || volume < 0) continue;
    const eps = 1e-9 * high;
    if (high + eps < low || open > high + eps || open < low - eps || close > high + eps || close < low - eps) continue;
    byDay.set(c.time, { time: c.time, open, high, low, close, volume });
  }
  return [...byDay.values()].sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
}

/** Full prep for the chart: clean, align PAXG to spot, then patch today's candle with spot. */
export function prepareCandles(candles: Candle[], spotUsd: number | null, nowIso: string, paxgUsd?: number | null): Candle[] {
  const clean = normalizeCandles(candles);
  const k = alignFactor(clean, spotUsd, nowIso, paxgUsd);
  return withLiveCandle(scaleCandles(clean, k), spotUsd, nowIso);
}

/**
 * Convert USD/oz candles for display (AED, karat, unit) with the app's toAed().
 * high/low are recomputed so they stay the extremes even if the converter is not monotone.
 * Rows the converter turns into non-finite numbers are dropped rather than charted as garbage.
 */
export function toDisplay(candles: Candle[], toAed: (usd: number) => number): Candle[] {
  const out: Candle[] = [];
  for (const c of candles) {
    const open = toAed(c.open), high = toAed(c.high), low = toAed(c.low), close = toAed(c.close);
    if (![open, high, low, close].every(Number.isFinite)) continue;
    out.push({
      time: c.time,
      open,
      close,
      high: Math.max(open, high, low, close),
      low: Math.min(open, high, low, close),
      volume: c.volume,
    });
  }
  return out;
}

/** Simple moving average of closes over the last n candles, one point per candle once n are available. */
export function smaLine(candles: Candle[], n: number): LinePoint[] {
  if (!Number.isInteger(n) || n < 1) return [];
  const out: LinePoint[] = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= n) sum -= candles[i - n].close;
    if (i >= n - 1) out.push({ time: candles[i].time, value: sum / n });
  }
  return out;
}

/** % change of candle i's close versus the previous candle's close (null for the first candle). */
export function dayChangePct(candles: Candle[], i: number): number | null {
  if (i <= 0 || i >= candles.length) return null;
  const prev = candles[i - 1].close;
  return prev > 0 ? (candles[i].close / prev - 1) * 100 : null;
}

export type RangeKey = '1M' | '3M' | '6M' | '1Y' | 'ALL';
const RANGE_MONTHS: Record<Exclude<RangeKey, 'ALL'>, number> = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12 };

/** First visible day for a range ending on lastDay (calendar months back, clamped to month end). null = ALL. */
export function rangeStart(lastDay: string, range: RangeKey): string | null {
  if (range === 'ALL') return null;
  const [y, m, d] = lastDay.split('-').map(Number);
  if (![y, m, d].every(Number.isFinite)) return null;
  const months = RANGE_MONTHS[range];
  const target = new Date(Date.UTC(y, m - 1 - months, 1));
  const daysInMonth = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, daysInMonth));
  return target.toISOString().slice(0, 10);
}

/**
 * Normalise a lightweight-charts Time (string, unix seconds or BusinessDay) to YYYY-MM-DD.
 * Kept structural so this module does not depend on the chart library.
 */
export function timeToDay(t: unknown): string | null {
  if (typeof t === 'string') return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
  if (typeof t === 'number') return Number.isFinite(t) ? isoDay(t * 1000) : null;
  if (t && typeof t === 'object') {
    const { year, month, day } = t as { year?: unknown; month?: unknown; day?: unknown };
    if (finite(year) && finite(month) && finite(day)) {
      return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  return null;
}
