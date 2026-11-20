import { useEffect, useRef, useState } from 'react';
import { marketStatus } from '../lib/market';
import { fmtAed } from '../lib/goldPricing';
import { useNow } from '../lib/useNow';
import type { Quote } from '../lib/feed';
import type { DailyClose } from '../lib/types';

function ago(sec: number) {
  if (sec < 90) return `${Math.max(0, Math.round(sec))}s ago`;
  if (sec < 5400) return `${Math.round(sec / 60)} min ago`;
  return `${(sec / 3600).toFixed(1)} h ago`;
}

interface Props {
  spot: Quote | null;
  paxg: Quote | null;
  feedOk: boolean;
  series: DailyClose[] | null;
  toAed: (usd: number) => number;
  unitText: string;
  karat: number;
  onRefresh: () => void;
}

function Spark({ pts }: { pts: number[] }) {
  if (pts.length < 2) return null;
  const min = Math.min(...pts), max = Math.max(...pts);
  const W = 240, H = 64;
  const xy = pts.map((v, i) => [(i / (pts.length - 1)) * W, H - 4 - ((v - min) / (max - min || 1)) * (H - 8)] as const);
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const up = pts[pts.length - 1] >= pts[0];
  const c = up ? '#6fcf97' : '#ef6b6b';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-16" preserveAspectRatio="none" role="img" aria-label="Last 14 days">
      <defs>
        <linearGradient id="sg" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={c} stopOpacity="0.28" />
          <stop offset="1" stopColor={c} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${H} ${line} ${W},${H}`} fill="url(#sg)" />
      <polyline points={line} fill="none" stroke={c} strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

export function GoldNow({ spot, paxg, feedOk, series, toAed, unitText, karat, onRefresh }: Props) {
  const now = useNow();
  const price = spot ? toAed(spot.usd) : null;
  const prev = useRef<number | null>(null);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  useEffect(() => {
    if (price === null) return;
    if (prev.current !== null && price !== prev.current) setFlash(price > prev.current ? 'up' : 'down');
    prev.current = price;
    const t = setTimeout(() => setFlash(null), 900);
    return () => clearTimeout(t);
  }, [price]);

  const mkt = marketStatus(new Date(now));

  if (!spot || price === null) {
    return (
      <section className="panel hero">
        <div className="text-sm text-[#a39b8a]">
          {feedOk ? 'Loading live gold price…' : 'Live gold price unavailable. No price is shown rather than a wrong one.'}
        </div>
        <button type="button" onClick={onRefresh} className="btn-ghost mt-3">Try again</button>
      </section>
    );
  }

  const ageSec = (now - Date.parse(spot.at)) / 1000;
  const state = !feedOk ? 'stale' : mkt.open ? (ageSec < 120 ? 'fresh' : ageSec < 600 ? 'aging' : 'stale') : 'closed';
  const status = {
    fresh: `Live · quote ${ago(ageSec)}`,
    aging: `Delayed · quote ${ago(ageSec)}`,
    stale: `STALE · last quote ${ago(ageSec)}${feedOk ? '' : ' (feed lost)'}`,
    closed: `Market closed · last quote ${ago(ageSec)}`,
  }[state];

  const spark = series ? series.slice(-14).map((d) => toAed(d.usd)) : [];
  const prevClose = series && series.length > 1 ? toAed(series[series.length - 2].usd) : null;
  const chg = prevClose ? (price / prevClose - 1) * 100 : null;
  const dev = paxg ? (paxg.usd / spot.usd - 1) * 100 : null;

  return (
    <section aria-label="Gold price now" className="panel hero">
      <div className="grid md:grid-cols-[1fr_260px] gap-6 items-end">
        <div>
          <div className="flex items-center gap-2 text-xs text-[#a39b8a]">
            <span className={`dot dot-${state}`} />
            {status}
            <span className="text-[#7d7667]">· {mkt.open ? 'Market open' : 'Market closed'}</span>
          </div>
          <div className="mt-2 text-xs uppercase tracking-[0.14em] text-[#7d7667]">Gold {karat}K · {unitText}</div>
          <div className={`price tabular-nums ${flash ? `flash-${flash}` : ''}`}>
            <span className="text-[0.38em] mr-2 text-[#a39b8a] align-middle">AED</span>
            {fmtAed(price)}
          </div>
          <div className="text-sm text-[#d8d0bf] font-mono-num mt-1">
            ${spot.usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / oz (24K)
            {chg !== null && (
              <span className={`ml-3 ${chg >= 0 ? 'text-[#6fcf97]' : 'text-[#ef6b6b]'}`}>
                {chg >= 0 ? '▲' : '▼'} {Math.abs(chg).toFixed(2)}% today
              </span>
            )}
          </div>
        </div>
        <div>
          <Spark pts={spark} />
          <div className="flex justify-between text-[10px] text-[#7d7667] mt-1">
            <span>14 days</span>
            <button type="button" onClick={onRefresh} className="underline underline-offset-2 hover:text-[#f0cf72] cursor-pointer">refresh now</button>
          </div>
        </div>
      </div>

      {(state === 'stale') && (
        <div role="alert" className="mt-4 rounded-lg border border-[#ef6b6b]/40 bg-[#ef6b6b]/10 p-3 text-xs text-[#f7c9c9]">
          {feedOk ? 'This quote is more than 10 minutes old while the market is open. Do not trade on it.' : 'The live feed is unreachable. The price above is the last one received and is getting older. Do not trade on it.'}
        </div>
      )}

      <div className="mt-4 pt-3 border-t border-white/[0.06] text-[11px] leading-relaxed text-[#7d7667]">
        gold-api.com XAU/USD spot, checked every 8s · AED at the fixed 3.6725 peg ·{' '}
        {karat !== 24 && `${karat}K = ${((karat / 24) * 100).toFixed(1)}% pure gold, this is the value of the gold itself · `}
        {paxg && dev !== null ? (
          <>
            cross-check (PAXG token) ${paxg.usd.toFixed(2)}, {dev >= 0 ? '+' : ''}{dev.toFixed(2)}% vs spot{' '}
            {Math.abs(dev) > 1 ? <span className="text-[#f0cf72]">gap over 1%: be careful</span> : <span className="text-[#6fcf97]">agrees</span>}
            {!mkt.open && ' · PAXG trades 24/7, so it shows moves while spot is closed'}
          </>
        ) : (
          'cross-check unavailable'
        )}
        . Global spot price: shops add making charges and a premium.
      </div>
    </section>
  );
}
