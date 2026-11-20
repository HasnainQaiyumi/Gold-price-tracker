/**
 * Builds public/data/market.json (21 years of daily gold via GLD + CBOE gold implied volatility, GVZ)
 * and public/data/diary.json (the prediction diary) during the deploy job, every 8 hours.
 * Any failed download keeps the last good data. Never fails the deploy.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { addDays, addEntry, sanitizeDiary, scoreDiary, type Diary } from '../../src/lib/diary';
import { fetchSpot } from '../../src/lib/feed';
import { forecastGold } from '../../src/lib/forecast';
import { backtestLadder, chooseTargets, type Calibration } from '../../src/lib/sim/claims';
import { longSeries, parseFredCsv, parseYahooChart, sanitizeMarket, type MarketData } from '../../src/lib/longHistory';

const DIR = 'public/data';
const MARKET = `${DIR}/market.json`;
const DIARY = `${DIR}/diary.json`;
const CALIB = `${DIR}/calibration.json`;
const DIARY_CACHE = '.diary-state/diary.json';
const UA = { 'User-Agent': 'Mozilla/5.0 (gold-data)' };

const readJson = (p: string): unknown => {
  try {
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
  } catch {
    return null;
  }
};

async function getGld() {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/GLD?period1=1104537600&period2=${Math.floor(Date.now() / 1000) + 86400}&interval=1d`;
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`GLD HTTP ${res.status}`);
  const bars = parseYahooChart(await res.json());
  if (bars.length < 4000) throw new Error(`GLD only ${bars.length} days`);
  return bars;
}

async function getGvz() {
  // FRED first (the official CBOE series); Yahoo's ^GVZ is the same index, used if FRED is down.
  try {
    const res = await fetch('https://fred.stlouisfed.org/graph/fredgraph.csv?id=GVZCLS', { headers: UA, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = parseFredCsv(await res.text());
    if (rows.length < 3000) throw new Error(`only ${rows.length} days`);
    return rows;
  } catch (e) {
    console.log(`FRED GVZ failed (${e}); trying Yahoo ^GVZ`);
  }
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/%5EGVZ?period1=1199145600&period2=${Math.floor(Date.now() / 1000) + 86400}&interval=1d`;
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Yahoo GVZ HTTP ${res.status}`);
  const rows = parseYahooChart(await res.json()).map((b) => ({ date: b.date, pct: b.usd })).filter((x) => x.pct < 300);
  if (rows.length < 3000) throw new Error(`Yahoo GVZ only ${rows.length} days`);
  return rows;
}

async function main() {
  mkdirSync(DIR, { recursive: true });
  const old = sanitizeMarket(readJson(MARKET));
  const [g, v] = await Promise.allSettled([getGld(), getGvz()]);
  if (g.status === 'rejected') console.log(`GLD download failed (${g.reason}); keeping last good copy`);
  if (v.status === 'rejected') console.log(`GVZ download failed (${v.reason}); keeping last good copy`);
  const gold = g.status === 'fulfilled' ? g.value : old?.gold ?? null;
  const gvz = v.status === 'fulfilled' ? v.value : old?.gvz ?? [];
  if (!gold) {
    console.log('No gold history available; market.json not written');
    return;
  }
  const market: MarketData = { generatedAt: new Date().toISOString(), gold, gvz };
  writeFileSync(MARKET, JSON.stringify({ generatedAt: market.generatedAt, gold: { bars: gold.map((b) => [b.date, b.usd]) }, gvz: gvz.map((x) => [x.date, x.pct]) }));
  console.log(`market.json: ${gold.length} gold days (${gold[0].date} to ${gold[gold.length - 1].date}), ${gvz.length} GVZ days`);

  // Prediction diary: keep whichever saved copy (live site or Actions cache) has the longer history.
  const copies = [sanitizeDiary(readJson(DIARY)), sanitizeDiary(readJson(DIARY_CACHE))].filter((d): d is Diary => !!d);
  let diary: Diary | null = copies.sort((a, b) => b.entries.length - a.entries.length)[0] ?? null;

  let spot: number | null = null;
  try {
    spot = (await fetchSpot()).usd;
  } catch (e) {
    console.log(`Spot price unavailable (${e}); no new diary entry this run`);
  }
  const nowIso = new Date().toISOString();
  const today = nowIso.slice(0, 10);
  if (spot) {
    const series = longSeries(market, spot, nowIso);
    // Self-calibration of the "99% sure" statements over all 21 years (every 3rd day, 3,000 futures each).
    try {
      const t0 = Date.now();
      const { targets, tested } = chooseTargets(backtestLadder(series, 3000, 3, 200, gvz));
      const calib: Calibration = { generatedAt: nowIso, fromDate: series[0].date, targets, tested };
      writeFileSync(CALIB, JSON.stringify(calib));
      console.log(`calibration.json in ${Math.round((Date.now() - t0) / 1000)} s: ${tested.map((r) => `${r.kind} ${r.target} held ${r.held}/${r.checks}`).join('; ')}`);
    } catch (e) {
      console.log(`calibration failed (${e}); the app will calibrate on recent data itself`);
    }
    const f = forecastGold(series, spot, [7, 30], gvz);
    const w = f?.ranges.find((r) => r.days === 7), m = f?.ranges.find((r) => r.days === 30);
    if (w && m) {
      const r2 = (x: number) => Math.round(x * 100) / 100;
      diary = addEntry(diary, {
        date: today,
        spot: r2(spot),
        week: { lo: r2(w.sureLow), hi: r2(w.sureHigh), mid: r2(w.median) },
        month: { lo: r2(m.sureLow), hi: r2(m.sureHigh), mid: r2(m.median) },
      });
    }
  }
  if (!diary) return;
  // Real price on a date = the spot the diary itself recorded that day (or within the next 3 days).
  const recorded = new Map(diary.entries.map((e) => [e.date, e.spot]));
  const priceOn = (ymd: string): number | null => {
    if (ymd > today) return null;
    for (let i = 0; i <= 3; i++) {
      const p = recorded.get(addDays(ymd, i));
      if (p) return p;
    }
    return null;
  };
  diary = scoreDiary(diary, priceOn);
  const text = JSON.stringify(diary);
  writeFileSync(DIARY, text);
  mkdirSync('.diary-state', { recursive: true });
  writeFileSync(DIARY_CACHE, text);
  console.log(`diary.json: ${diary.entries.length} days recorded since ${diary.startedAt}`);
}

main().catch((e) => console.log(`market data job failed: ${e}`));
