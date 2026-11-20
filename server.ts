import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateFallbackHistory } from './src/lib/quantForecast';
import type { HistoryPoint, MarketDataPayload } from './src/lib/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

interface CacheState {
  spotUpdatedAt: number;
  macroUpdatedAt: number;
  payload: MarketDataPayload;
}

const initialSpot = 3535.0;
const cache: CacheState = {
  spotUpdatedAt: 0,
  macroUpdatedAt: 0,
  payload: {
    spotUsdOz: initialSpot,
    usdAed: 3.6725,
    usdInr: 93.15,
    isLiveSpot: false,
    isLiveFx: false,
    isLiveMacro: false,
    updatedAt: new Date().toISOString(),
    history30d: generateFallbackHistory(initialSpot),
    macro: {
      realYield10y: 2.12,
      breakevenInfl: 2.28,
      dxy: 105.4,
      gvz: 19.2,
      cotMmNetPctOi: 22.4,
      brentUsd: 74.5,
      change24hPct: -0.42,
    },
  },
};

async function fetchWithTimeout(url: string, timeoutMs = 4500): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'AureusBullionTracker/1.0',
        Accept: 'application/json, text/csv, */*',
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchYahooSeries(symbol: string, range = '3mo'): Promise<{ dates: string[]; closes: number[] } | null> {
  try {
    const res = await fetchWithTimeout(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      chart?: {
        result?: Array<{
          timestamp?: number[];
          indicators?: { quote?: Array<{ close?: Array<number | null> }> };
        }>;
      };
    };
    const result = json.chart?.result?.[0];
    const timestamps = result?.timestamp;
    const closesRaw = result?.indicators?.quote?.[0]?.close;
    if (!timestamps || !closesRaw) return null;

    const dates: string[] = [];
    const closes: number[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const val = closesRaw[i];
      if (typeof val === 'number' && Number.isFinite(val)) {
        const d = new Date(timestamps[i] * 1000);
        dates.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }));
        closes.push(val);
      }
    }
    return closes.length >= 10 ? { dates, closes } : null;
  } catch {
    return null;
  }
}

async function fetchLatestFredValue(seriesId: string): Promise<number | null> {
  try {
    const res = await fetchWithTimeout(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}`);
    if (!res.ok) return null;
    const text = await res.text();
    const lines = text.trim().split('\n');
    for (let i = lines.length - 1; i >= 1; i--) {
      const parts = lines[i].split(',');
      if (parts.length >= 2) {
        const num = Number(parts[1]);
        if (Number.isFinite(num)) return num;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchLatestCftcCotNetPct(): Promise<number | null> {
  try {
    const url =
      "https://publicreporting.cftc.gov/resource/kh3c-gbw2.json?$where=cftc_contract_market_code='088691'&$order=report_date_as_yyyy_mm_dd%20DESC&$limit=3";
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<Record<string, string>>;
    for (const row of rows) {
      const oi = Number(row.open_interest_all);
      const mmLong = Number(row.m_money_positions_long_all);
      const mmShort = Number(row.m_money_positions_short_all);
      if (Number.isFinite(oi) && oi > 0 && Number.isFinite(mmLong) && Number.isFinite(mmShort)) {
        return Number((((mmLong - mmShort) / oi) * 100).toFixed(1));
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function refreshMarketData(force = false): Promise<MarketDataPayload> {
  const now = Date.now();
  const needSpot = force || now - cache.spotUpdatedAt > 30_000;
  const needMacro = force || now - cache.macroUpdatedAt > 15 * 60_000;

  if (needSpot) {
    const [goldRes, fxRes] = await Promise.allSettled([
      fetchWithTimeout('https://api.gold-api.com/price/XAU'),
      fetchWithTimeout('https://open.er-api.com/v6/latest/USD'),
    ]);

    if (goldRes.status === 'fulfilled' && goldRes.value.ok) {
      try {
        const data = (await goldRes.value.json()) as { price?: number };
        if (typeof data.price === 'number' && data.price > 500) {
          cache.payload.spotUsdOz = data.price;
          cache.payload.isLiveSpot = true;
        }
      } catch {
        // retain previous spot
      }
    }

    if (fxRes.status === 'fulfilled' && fxRes.value.ok) {
      try {
        const fx = (await fxRes.value.json()) as { rates?: { INR?: number; AED?: number } };
        if (fx.rates?.INR && fx.rates.INR > 40) {
          cache.payload.usdInr = fx.rates.INR;
          cache.payload.isLiveFx = true;
        }
        if (fx.rates?.AED && fx.rates.AED > 3) {
          cache.payload.usdAed = fx.rates.AED;
        }
      } catch {
        // retain previous FX
      }
    }

    cache.spotUpdatedAt = now;
  }

  if (needMacro) {
    const [goldHist, gvzHist, dxyHist, brentHist, dfii10, dgs10, cotPct] = await Promise.all([
      fetchYahooSeries('GC=F', '3mo'),
      fetchYahooSeries('^GVZ', '1mo'),
      fetchYahooSeries('DX-Y.NYB', '1mo'),
      fetchYahooSeries('BZ=F', '1mo'),
      fetchLatestFredValue('DFII10'),
      fetchLatestFredValue('DGS10'),
      fetchLatestCftcCotNetPct(),
    ]);

    let liveMacroCount = 0;
    if (goldHist && goldHist.closes.length >= 20) {
      const last30Dates = goldHist.dates.slice(-30);
      const last30Closes = goldHist.closes.slice(-30);
      const lastYahooClose = last30Closes[last30Closes.length - 1];
      const anchorScale = cache.payload.spotUsdOz / Math.max(1, lastYahooClose);

      const history30d: HistoryPoint[] = last30Dates.map((dateLabel, idx) => ({
        dateLabel,
        usdOz: Number((last30Closes[idx] * anchorScale).toFixed(2)),
      }));
      cache.payload.history30d = history30d;

      const prevClose = last30Closes[last30Closes.length - 2];
      cache.payload.macro.change24hPct = Number(
        (((lastYahooClose - prevClose) / Math.max(1, prevClose)) * 100).toFixed(2)
      );
      liveMacroCount++;
    } else {
      cache.payload.history30d = generateFallbackHistory(cache.payload.spotUsdOz);
    }

    if (gvzHist) {
      cache.payload.macro.gvz = Number(gvzHist.closes[gvzHist.closes.length - 1].toFixed(2));
      liveMacroCount++;
    }
    if (dxyHist) {
      cache.payload.macro.dxy = Number(dxyHist.closes[dxyHist.closes.length - 1].toFixed(2));
      liveMacroCount++;
    }
    if (brentHist) {
      cache.payload.macro.brentUsd = Number(brentHist.closes[brentHist.closes.length - 1].toFixed(2));
      liveMacroCount++;
    }
    if (dfii10 !== null) {
      cache.payload.macro.realYield10y = Number(dfii10.toFixed(2));
      liveMacroCount++;
    }
    if (dgs10 !== null && dfii10 !== null) {
      cache.payload.macro.breakevenInfl = Number((dgs10 - dfii10).toFixed(2));
    }
    if (cotPct !== null) {
      cache.payload.macro.cotMmNetPctOi = cotPct;
      liveMacroCount++;
    }

    cache.payload.isLiveMacro = liveMacroCount > 0;
    cache.macroUpdatedAt = now;
  } else {
    // Re-anchor final point of history30d smoothly to latest spotUsdOz
    const hist = cache.payload.history30d;
    if (hist.length > 0) {
      hist[hist.length - 1] = {
        ...hist[hist.length - 1],
        usdOz: cache.payload.spotUsdOz,
      };
    }
  }

  cache.payload.updatedAt = new Date().toISOString();
  return cache.payload;
}

async function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', updatedAt: cache.payload.updatedAt });
  });

  app.get('/api/market-data', async (req, res) => {
    const force = req.query.force === '1';
    const data = await refreshMarketData(force);
    res.json(data);
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Aureus Bullion server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
