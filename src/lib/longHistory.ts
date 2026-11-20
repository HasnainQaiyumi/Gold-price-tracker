/**
 * Long daily gold history (GLD, 2005+) and gold implied volatility (CBOE GVZ, 2008+), published by
 * the site's data job as ./data/market.json. GLD tracks gold (0.1 oz per share minus fees), so its
 * daily moves are gold's; levels are rescaled to the live spot price.
 */
import type { DailyBar, ImpliedVol } from './forecast/types';

export interface MarketData {
  generatedAt: string;
  gold: DailyBar[]; // GLD closes, USD per share (rescaled to spot by the app)
  gvz: ImpliedVol[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Validates the published file (untrusted input). */
export function sanitizeMarket(raw: unknown): MarketData | null {
  const o = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null;
  if (!o || typeof o.generatedAt !== 'string' || Number.isNaN(Date.parse(o.generatedAt))) return null;
  const pairs = (v: unknown, lo: number, hi: number) =>
    Array.isArray(v)
      ? v.flatMap((r) => (Array.isArray(r) && typeof r[0] === 'string' && DATE.test(r[0]) && typeof r[1] === 'number' && Number.isFinite(r[1]) && r[1] > lo && r[1] < hi ? [[r[0], r[1]] as [string, number]] : []))
      : [];
  const gold = pairs((o.gold as Record<string, unknown> | undefined)?.bars ?? o.gold, 1, 100000).map(([date, usd]) => ({ date, usd }));
  const gvz = pairs(o.gvz, 1, 300).map(([date, pct]) => ({ date, pct }));
  if (gold.length < 500) return null;
  return { generatedAt: o.generatedAt, gold, gvz };
}

/** GLD history rescaled to gold's USD/oz level, with today's live price appended. The scale comes from
 * `ref` (spot-aligned daily gold, e.g. PAXG) on GLD's last date, so today's real move is kept;
 * without it, GLD's last close is lined up with spot. */
export function longSeries(m: MarketData, spotUsd: number, todayIso: string, ref?: readonly DailyBar[] | null): DailyBar[] {
  const g = m.gold.filter((b) => b.date < todayIso.slice(0, 10));
  if (!g.length) return [];
  const lastG = g[g.length - 1];
  const r = ref?.find((b) => b.date === lastG.date);
  const k = (r && r.usd > 0 ? r.usd : spotUsd) / lastG.usd;
  return [...g.map((b) => ({ date: b.date, usd: b.usd * k })), { date: todayIso.slice(0, 10), usd: spotUsd }];
}

/** Most recent implied vol (%), if it is fresh (<= 7 days old). */
export function latestImplied(m: MarketData | null, todayIso: string): number | null {
  if (!m || !m.gvz.length) return null;
  const last = m.gvz[m.gvz.length - 1];
  const age = (Date.parse(todayIso) - Date.parse(`${last.date}T00:00:00Z`)) / 86400e3;
  return age <= 7 ? last.pct : null;
}

/** Yahoo Finance chart JSON -> daily closes (UTC dates). */
export function parseYahooChart(raw: unknown): DailyBar[] {
  const r = (raw as { chart?: { result?: { timestamp?: unknown; indicators?: { quote?: { close?: unknown }[] } }[] } })?.chart?.result?.[0];
  const ts = r?.timestamp, cl = r?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(ts) || !Array.isArray(cl) || ts.length !== cl.length) return [];
  const byDay = new Map<string, number>();
  ts.forEach((t, i) => {
    const c = cl[i];
    if (typeof t === 'number' && typeof c === 'number' && Number.isFinite(c) && c > 1) byDay.set(new Date(t * 1000).toISOString().slice(0, 10), Math.round(c * 100) / 100);
  });
  return [...byDay].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, usd]) => ({ date, usd }));
}

/** FRED CSV ("observation_date,GVZCLS" with "." or blank for missing days) -> implied vol series. */
export function parseFredCsv(text: string): ImpliedVol[] {
  const out: ImpliedVol[] = [];
  for (const line of text.split(/\r?\n/).slice(1)) {
    const [date, v] = line.split(',');
    const pct = Number(v);
    if (DATE.test(date ?? '') && v && v !== '.' && Number.isFinite(pct) && pct > 1 && pct < 300) out.push({ date, pct });
  }
  return out;
}
