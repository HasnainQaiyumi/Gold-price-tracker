import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GoldNow } from './components/GoldNow';
import { Outlook } from './components/Outlook';
import { PriceHistory } from './components/PriceHistory';
import { SimpleSaver } from './components/SimpleSaver';
import { fetchPaxg, fetchPaxgHistory, fetchSpot, type Quote } from './lib/feed';
import { withLiveSpot } from './lib/goldAnalytics';
import { DEFAULT_ASSUMPTIONS } from './lib/goldPricing';
import type { DailyClose } from './lib/types';

const LIVE_MS = 8_000;
const HISTORY_MS = 30 * 60_000;

export default function App() {
  const [spot, setSpot] = useState<Quote | null>(null);
  const [paxg, setPaxg] = useState<Quote | null>(null);
  const [feedOk, setFeedOk] = useState(true);
  const [history, setHistory] = useState<DailyClose[] | null>(null);
  const busy = useRef(false);

  const refreshLive = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const [s, p] = await Promise.allSettled([fetchSpot(), fetchPaxg()]);
    if (s.status === 'fulfilled') {
      setSpot(s.value);
      setFeedOk(true);
    } else {
      setFeedOk(false); // keep the last good quote; its age keeps growing and is flagged STALE
    }
    if (p.status === 'fulfilled') setPaxg(p.value);
    else setPaxg(null);
    busy.current = false;
  }, []);

  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await fetchPaxgHistory());
    } catch {
      /* keep the previous history if any; never fabricate */
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

  // History is PAXG; scale it to live spot so levels line up (PAXG-vs-spot basis is ~0.3%).
  const series = useMemo(() => {
    if (!history || !spot) return null;
    const ref = paxg?.usd ?? history[history.length - 1].usd;
    const k = spot.usd / ref;
    return withLiveSpot(history.map((d) => ({ date: d.date, usd: d.usd * k })), spot.usd, new Date().toISOString());
  }, [history, spot, paxg]);

  const prevClose = series && series.length > 1 ? series[series.length - 2].usd : null;
  const closes30 = series ? series.slice(-30).map((d) => d.usd) : null;

  return (
    <div className="min-h-screen bg-[#090c10] text-[#f1f4f8]">
      <main className="max-w-[1000px] w-full mx-auto px-4 md:px-6 py-6 flex flex-col gap-5">
        <h1 className="font-display text-xl font-bold tracking-tight text-[#f8fafc]">Gold</h1>

        <GoldNow spot={spot} paxg={paxg} feedOk={feedOk} prevClose={prevClose} onRefresh={refreshLive} />
        {spot && <Outlook spotUsd={spot.usd} series={series} />}
        <PriceHistory series={series} />

        {spot && closes30 && (
          <details className="group">
            <summary className="cursor-pointer text-xs font-semibold text-[#f3d06b] border border-[#e5b842]/40 rounded-md px-3 py-1.5 inline-block">
              Buy price & what a monthly saving could do
            </summary>
            <div className="mt-3">
              <SimpleSaver spotUsdOz={spot.usd} closes30={closes30} assumptions={DEFAULT_ASSUMPTIONS} />
            </div>
          </details>
        )}

        <footer className="text-[11px] text-[#64748b] leading-relaxed pb-6">
          Informational only, not financial advice. Prices are the global spot rate; shops charge a premium. Gold can fall as well as rise.
        </footer>
      </main>
    </div>
  );
}
