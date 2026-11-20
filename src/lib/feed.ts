import type { DailyClose } from './types';

export interface Quote {
  usd: number; // USD per troy oz
  at: string; // provider timestamp (ISO)
}

async function getJson(url: string, timeoutMs = 6000): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: 'no-store', signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

const sane = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 500 && n < 100000;

/** XAU/USD spot (gold-api.com). */
export async function fetchSpot(): Promise<Quote> {
  const j = (await getJson('https://api.gold-api.com/price/XAU')) as { price?: number; updatedAt?: string };
  if (!sane(j.price) || !j.updatedAt || Number.isNaN(Date.parse(j.updatedAt))) throw new Error('bad spot payload');
  return { usd: j.price, at: j.updatedAt };
}

/** PAXG (1 token = 1 troy oz of gold) last trade on Coinbase: independent, 24/7 cross-check. */
export async function fetchPaxg(): Promise<Quote> {
  const j = (await getJson('https://api.exchange.coinbase.com/products/PAXG-USD/ticker')) as { price?: string; time?: string };
  const p = Number(j.price);
  if (!sane(p) || !j.time || Number.isNaN(Date.parse(j.time))) throw new Error('bad PAXG payload');
  return { usd: p, at: j.time };
}

/** Daily PAXG closes (UTC days), ~2y. Coinbase candle = [time, low, high, open, close, volume]. */
export async function fetchPaxgHistory(): Promise<DailyClose[]> {
  const end = Date.now();
  const pages = await Promise.all(
    [0, 1, 2].map(async (i) => {
      const e = new Date(end - i * 300 * 86400_000);
      const s = new Date(e.getTime() - 299 * 86400_000);
      const url = `https://api.exchange.coinbase.com/products/PAXG-USD/candles?granularity=86400&start=${s.toISOString()}&end=${e.toISOString()}`;
      const rows = (await getJson(url, 10000)) as unknown;
      return Array.isArray(rows) ? (rows as number[][]) : [];
    })
  );
  const byDay = new Map<string, number>();
  for (const row of pages.flat()) {
    const [ts, , , , close] = row;
    if (sane(close) && Number.isFinite(ts)) byDay.set(new Date(ts * 1000).toISOString().slice(0, 10), close);
  }
  const out = [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, usd]) => ({ date, usd }));
  if (out.length < 90) throw new Error('not enough history');
  return out;
}
