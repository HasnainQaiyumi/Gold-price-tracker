import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alerts } from './components/Alerts';
import { Gate } from './components/Gate';
import { GoldNow } from './components/GoldNow';
import { MyGold } from './components/MyGold';
import { RealisticPrediction } from './components/RealisticPrediction';
import { TopProbabilities } from './components/TopProbabilities';
import { PriceHistory } from './components/PriceHistory';
import { ProChart } from './components/ProChart';
import { WhyGoldMoved } from './components/WhyGoldMoved';
import { SimpleSaver } from './components/SimpleSaver';
import { Seg } from './components/ui';
import { evaluateAlerts, sanitizeAlerts, type PriceAlert } from './lib/alerts';
import { fetchPaxgCandles, type Candle } from './lib/candles';
import { fetchPaxg, fetchSpot, type Quote } from './lib/feed';
import { forecastGold } from './lib/forecast';
import { withLiveSpot } from './lib/goldAnalytics';
import { DEFAULT_ASSUMPTIONS, fmtAed, KARATS, UNITS, usdOzToAed, usdOzToAedPerG } from './lib/goldPricing';
import { sanitizeHoldings, type Holding } from './lib/holdings';
import type { DailyClose, KaratPurity } from './lib/types';
import { useLocalStorage } from './lib/useLocalStorage';

const LIVE_MS = 8_000;
const HISTORY_MS = 30 * 60_000;
const UNLOCK_KEY = 'gold_unlocked_v1';

export default function App() {
  const [unlocked, setUnlocked] = useState(() => {
    try {
      return localStorage.getItem(UNLOCK_KEY) === '1';
    } catch {
      return false;
    }
  });
  if (!unlocked) {
    return (
      <Gate
        onUnlock={() => {
          try {
            localStorage.setItem(UNLOCK_KEY, '1');
          } catch {
            /* ignore */
          }
          setUnlocked(true);
        }}
      />
    );
  }
  return (
    <Dashboard
      onLock={() => {
        try {
          localStorage.removeItem(UNLOCK_KEY);
        } catch {
          /* ignore */
        }
        setUnlocked(false);
      }}
    />
  );
}

function Dashboard({ onLock }: { onLock: () => void }) {
  const [spot, setSpot] = useState<Quote | null>(null);
  const [paxg, setPaxg] = useState<Quote | null>(null);
  const [feedOk, setFeedOk] = useState(true);
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const busy = useRef(false);

  const [karat, setKarat] = useLocalStorage<KaratPurity>('gold_karat', 24, (r) => KARATS.find((k) => k === r) ?? 24);
  const [unitIdx, setUnitIdx] = useLocalStorage<number>('gold_unit', 0, (r) => (typeof r === 'number' && r >= 0 && r < UNITS.length ? Math.floor(r) : 0));
  const [holdings, setHoldings] = useLocalStorage<Holding[]>('gold_holdings', [], sanitizeHoldings);
  const [alerts, setAlerts] = useLocalStorage<PriceAlert[]>('gold_alerts', [], sanitizeAlerts);

  const unit = UNITS[unitIdx];
  const toAed = useCallback((usd: number) => usdOzToAed(usd, karat, unit.grams), [karat, unit]);
  const unitText = `per ${unit.label}`;

  const refreshLive = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const [s, p] = await Promise.allSettled([fetchSpot(), fetchPaxg()]);
    if (s.status === 'fulfilled') {
      setSpot(s.value);
      setFeedOk(true);
    } else {
      setFeedOk(false); // keep last good quote; its age keeps growing and is flagged STALE
    }
    setPaxg(p.status === 'fulfilled' ? p.value : null);
    busy.current = false;
  }, []);

  const refreshHistory = useCallback(async () => {
    try {
      setCandles(await fetchPaxgCandles());
    } catch {
      /* keep previous history if any; never fabricate */
    }
  }, []);

  useEffect(() => {
    refreshLive();
    refreshHistory();
    const a = setInterval(refreshLive, LIVE_MS);
    const b = setInterval(refreshHistory, HISTORY_MS);
    const onVisible = () => document.visibilityState === 'visible' && refreshLive();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(a);
      clearInterval(b);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshLive, refreshHistory]);

  // Daily closes from the same PAXG candles the chart uses (one download serves both).
  const history = useMemo<DailyClose[] | null>(() => (candles && candles.length >= 90 ? candles.map((c) => ({ date: c.time, usd: c.close })) : null), [candles]);

  // History is PAXG; scale it to live spot so levels line up (PAXG-vs-spot basis is ~0.3%).
  const series = useMemo(() => {
    if (!history || !spot) return null;
    const ref = paxg?.usd ?? history[history.length - 1].usd;
    const k = spot.usd / ref;
    return withLiveSpot(history.map((d) => ({ date: d.date, usd: d.usd * k })), spot.usd, new Date().toISOString());
  }, [history, spot, paxg]);

  const forecast = useMemo(() => (spot && series ? forecastGold(series, spot.usd) : null), [series, spot]);

  const price24 = spot ? usdOzToAedPerG(spot.usd) : null;
  const price = spot ? toAed(spot.usd) : null;

  // Price alerts: evaluated on every fresh quote while the page is open.
  useEffect(() => {
    if (price24 === null || !feedOk) return;
    const r = evaluateAlerts(alerts, price24, new Date().toISOString());
    if (!r.newlyFired.length) return;
    setAlerts(r.alerts);
    for (const a of r.newlyFired) {
      try {
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('Gold alert', { body: `24K gold ${a.dir === 'above' ? 'rose to' : 'fell to'} AED ${price24.toFixed(2)}/g (target ${a.target})` });
        }
      } catch {
        /* notifications unavailable */
      }
    }
  }, [price24, feedOk, alerts, setAlerts]);

  useEffect(() => {
    document.title = price === null ? 'Gold' : `AED ${fmtAed(price)} · Gold ${karat}K`;
  }, [price, karat]);

  const closes30 = series ? series.slice(-30).map((d) => d.usd) : null;

  return (
    <div className="min-h-screen">
      <header className="topbar">
        <div className="max-w-[1100px] mx-auto px-4 md:px-6 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="coin" aria-hidden />
            <span className="wordmark">GOLD</span>
          </div>
          <div className="flex items-center gap-2 md:gap-3">
            <Seg label="Karat" value={karat} onChange={setKarat} options={KARATS.map((k) => ({ v: k, label: `${k}K` }))} />
            <Seg label="Unit" value={unitIdx} onChange={setUnitIdx} options={UNITS.map((u, i) => ({ v: i, label: u.short }))} />
            <button type="button" onClick={onLock} className="btn-ghost hidden sm:block" aria-label="Lock">Lock</button>
          </div>
        </div>
      </header>

      <main className="max-w-[1100px] w-full mx-auto px-4 md:px-6 py-6 flex flex-col gap-5">
        <GoldNow spot={spot} paxg={paxg} feedOk={feedOk} series={series} toAed={toAed} unitText={unitText} karat={karat} onRefresh={refreshLive} />

        <WhyGoldMoved series={series} spotUsd={spot?.usd ?? null} toAed={toAed} unitText={unitText} />

        <RealisticPrediction series={series} spotUsd={spot?.usd ?? null} toAed={toAed} unitText={unitText} />
        <TopProbabilities series={series} spotUsd={spot?.usd ?? null} toAed={toAed} unitText={unitText} />

        <div className="grid lg:grid-cols-2 gap-5 items-start">
          <MyGold holdings={holdings} setHoldings={setHoldings} spotUsd={spot?.usd ?? null} />
          <Alerts alerts={alerts} setAlerts={setAlerts} price24={price24} />
        </div>

        <ProChart
          candles={candles}
          spotUsd={spot?.usd ?? null}
          paxgUsd={paxg?.usd ?? null}
          toAed={toAed}
          unitText={unitText}
          outlook7={(() => {
            const r = forecast?.ranges.find((x) => x.days === 7);
            return r ? { lo: toAed(r.likelyLow), hi: toAed(r.likelyHigh) } : null;
          })()}
        />
        <PriceHistory series={series} toAed={toAed} unitText={unitText} statsOnly />

        {spot && closes30 && (
          <details>
            <summary className="btn-ghost inline-block cursor-pointer">Shop buy price &amp; what a monthly saving could do</summary>
            <div className="mt-3">
              <SimpleSaver spotUsdOz={spot.usd} closes30={closes30} assumptions={DEFAULT_ASSUMPTIONS} />
            </div>
          </details>
        )}

        <footer className="text-[11px] text-[#7d7667] leading-relaxed pb-8">
          Informational only, not financial advice. Prices are the global spot rate; shops charge making charges and a premium. Gold can fall as well as rise.
          Your holdings and alerts are stored only in this browser.
        </footer>
      </main>
    </div>
  );
}
