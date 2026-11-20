import { useEffect, useMemo, useState } from 'react';
import { TROY_OZ_GRAMS } from '../lib/goldPricing';
import {
  annualisedVolPct,
  maxDrawdownPct,
  returnPct,
  rsi,
  smaSeries,
  withLiveSpot,
} from '../lib/goldAnalytics';
import type { MarketDataPayload } from '../lib/types';

const RANGES = [
  { label: '1M', n: 21 },
  { label: '3M', n: 63 },
  { label: '6M', n: 126 },
  { label: '1Y', n: 252 },
  { label: '2Y', n: 504 },
];

const pct = (v: number | null, d = 1) => (v === null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`);
const tone = (v: number | null) => (v === null ? 'text-[#94a3b8]' : v >= 0 ? 'text-[#10b981]' : 'text-[#f43f5e]');

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function ago(sec: number) {
  if (sec < 90) return `${Math.max(0, Math.round(sec))}s ago`;
  if (sec < 5400) return `${Math.round(sec / 60)} min ago`;
  return `${(sec / 3600).toFixed(1)} h ago`;
}

export function PriceHistory({ market }: { market: MarketDataPayload }) {
  const [range, setRange] = useState(126);
  const [hover, setHover] = useState<number | null>(null);
  const now = useNow();

  const quoteMs = Date.parse(market.quoteAt ?? market.updatedAt);
  const ageSec = (now - quoteMs) / 1000;
  const live = market.isLiveSpot;
  const status = !live ? 'none' : ageSec < 300 ? 'fresh' : ageSec < 1800 ? 'aging' : 'stale';
  const dot = { fresh: 'bg-[#10b981]', aging: 'bg-[#f59e0b]', stale: 'bg-[#f43f5e]', none: 'bg-[#f43f5e]' }[status];

  const aedPerG = (usd: number) => (usd / TROY_OZ_GRAMS) * market.usdAed;
  const spotAedG = aedPerG(market.spotUsdOz);

  const series = useMemo(
    () => (market.historyDaily?.length && live
      ? withLiveSpot(market.historyDaily, market.spotUsdOz, market.quoteAt ?? market.updatedAt)
      : null),
    [market.historyDaily, market.spotUsdOz, market.quoteAt, market.updatedAt, live]
  );

  const calc = useMemo(() => {
    if (!series) return null;
    const v = series.map((d) => d.usd);
    const sma50 = smaSeries(v, 50);
    const sma200 = smaSeries(v, 200);
    const last1y = v.slice(-252);
    const hi = Math.max(...last1y);
    const lo = Math.min(...last1y);
    const last = v[v.length - 1];
    return {
      v, sma50, sma200,
      rsi: rsi(v, 14),
      vol: annualisedVolPct(v, 30),
      dd: maxDrawdownPct(last1y),
      r1m: returnPct(v, 21), r3m: returnPct(v, 63), r1y: returnPct(v, 252),
      hi, lo, fromHigh: (last / hi - 1) * 100,
      vs50: sma50[sma50.length - 1] ? (last / (sma50[sma50.length - 1] as number) - 1) * 100 : null,
      vs200: sma200[sma200.length - 1] ? (last / (sma200[sma200.length - 1] as number) - 1) * 100 : null,
    };
  }, [series]);

  // chart geometry
  const W = 800, H = 240, PAD = 8;
  const view = useMemo(() => {
    if (!series || !calc) return null;
    const n = Math.min(range, series.length);
    const start = series.length - n;
    const pts = series.slice(start).map((d, i) => ({ date: d.date, y: aedPerG(d.usd), s50: calc.sma50[start + i], s200: calc.sma200[start + i] }));
    const ys = pts.flatMap((p) => [p.y, p.s50 === null ? p.y : aedPerG(p.s50), p.s200 === null ? p.y : aedPerG(p.s200)]);
    const min = Math.min(...ys), max = Math.max(...ys);
    const x = (i: number) => PAD + (i / Math.max(1, pts.length - 1)) * (W - 2 * PAD);
    const y = (val: number) => H - PAD - ((val - min) / (max - min || 1)) * (H - 2 * PAD);
    const line = (get: (p: (typeof pts)[number]) => number | null) =>
      pts.map((p, i) => ({ i, v: get(p) })).filter((q) => q.v !== null).map((q) => `${x(q.i).toFixed(1)},${y(q.v as number).toFixed(1)}`).join(' ');
    return { pts, min, max, x, y, price: line((p) => p.y), s50: line((p) => (p.s50 === null ? null : aedPerG(p.s50))), s200: line((p) => (p.s200 === null ? null : aedPerG(p.s200))) };
  }, [series, calc, range, market.usdAed]);

  const hp = hover !== null && view ? view.pts[hover] : null;

  return (
    <section aria-label="Gold price and history" className="rounded-xl bg-[#11161e] border border-white/[0.08] p-5 flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs text-[#94a3b8]">Gold 24K spot</div>
          <div className="text-4xl font-bold font-mono-num text-[#f3d06b]">
            AED {spotAedG.toFixed(2)}<span className="text-base text-[#94a3b8]">/g</span>
          </div>
          <div className="text-xs text-[#94a3b8] font-mono-num mt-1">
            ${market.spotUsdOz.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/oz · USD/AED {market.usdAed} (fixed peg)
          </div>
        </div>
        <div className="text-xs text-right">
          <div className="flex items-center gap-2 justify-end text-[#cbd5e1]">
            <span className={`inline-block w-2 h-2 rounded-full ${dot}`} />
            {live ? `Live · updated ${ago(ageSec)}` : 'NO LIVE PRICE'}
          </div>
          <div className="text-[#64748b] mt-1">
            Source: gold-api.com (spot) · auto-refresh 15s
            {market.historyAsOf ? ` · history as of ${new Date(market.historyAsOf).toUTCString().slice(5, 22)} UTC` : ''}
          </div>
        </div>
      </div>

      {(!live || status === 'stale') && (
        <div role="alert" className="rounded-lg border border-[#f43f5e]/40 bg-[#f43f5e]/10 p-3 text-xs text-[#fecdd3]">
          {live
            ? 'This quote is more than 30 minutes old. Do not trade on it.'
            : 'The live price feed is unreachable. The numbers on this page are a stored baseline, NOT the current market. Do not trade on them. Press Sync to retry.'}
        </div>
      )}

      {series && calc && view ? (
        <>
          <div className="flex items-center justify-between">
            <div role="group" aria-label="Chart range" className="inline-flex bg-[#090c10] border border-white/[0.08] rounded-lg p-1 gap-1">
              {RANGES.map((r) => (
                <button key={r.label} type="button" onClick={() => setRange(r.n)} aria-pressed={range === r.n}
                  className={`px-3 py-1 text-xs font-semibold rounded-md cursor-pointer border ${range === r.n ? 'bg-[#e5b842]/20 text-[#f3d06b] border-[#e5b842]/40' : 'text-[#94a3b8] border-transparent'}`}>
                  {r.label}
                </button>
              ))}
            </div>
            <div className="text-xs text-[#94a3b8] font-mono-num h-4">
              {hp ? `${hp.date} · AED ${hp.y.toFixed(2)}/g` : 'AED/g, 24K spot'}
            </div>
          </div>

          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-60" preserveAspectRatio="none" role="img" aria-label="Gold price history chart"
            onMouseLeave={() => setHover(null)}
            onMouseMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const f = (e.clientX - r.left) / r.width;
              setHover(Math.max(0, Math.min(view.pts.length - 1, Math.round(f * (view.pts.length - 1)))));
            }}>
            <polyline points={view.s200} fill="none" stroke="#818cf8" strokeWidth="1.2" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
            <polyline points={view.s50} fill="none" stroke="#38bdf8" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
            <polyline points={view.price} fill="none" stroke="#e5b842" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            {hover !== null && <line x1={view.x(hover)} x2={view.x(hover)} y1={0} y2={H} stroke="#64748b" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
          </svg>
          <div className="flex gap-4 text-[11px] text-[#94a3b8]">
            <span><span className="text-[#e5b842]">━</span> Price</span>
            <span><span className="text-[#38bdf8]">━</span> 50-day avg</span>
            <span><span className="text-[#818cf8]">┅</span> 200-day avg</span>
            <span className="ml-auto font-mono-num">AED {view.min.toFixed(0)}–{view.max.toFixed(0)}/g · {view.pts[0].date} to {view.pts[view.pts.length - 1].date}</span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            {[
              ['1M / 3M / 1Y', <span key="r"><span className={tone(calc.r1m)}>{pct(calc.r1m)}</span> / <span className={tone(calc.r3m)}>{pct(calc.r3m)}</span> / <span className={tone(calc.r1y)}>{pct(calc.r1y)}</span></span>],
              ['RSI (14)', <span key="rsi">{calc.rsi === null ? '—' : calc.rsi.toFixed(0)} <span className="text-[#64748b]">{calc.rsi === null ? '' : calc.rsi > 70 ? 'overbought' : calc.rsi < 30 ? 'oversold' : 'neutral'}</span></span>],
              ['Volatility (30d, annual)', calc.vol === null ? '—' : `${calc.vol.toFixed(1)}%`],
              ['Worst fall (1Y)', <span key="dd" className="text-[#f43f5e]">{pct(calc.dd)}</span>],
              ['1Y high / low (AED/g)', `${aedPerG(calc.hi).toFixed(0)} / ${aedPerG(calc.lo).toFixed(0)}`],
              ['From 1Y high', <span key="fh" className={tone(calc.fromHigh)}>{pct(calc.fromHigh)}</span>],
              ['vs 50-day avg', <span key="v50" className={tone(calc.vs50)}>{pct(calc.vs50)}</span>],
              ['vs 200-day avg', <span key="v200" className={tone(calc.vs200)}>{pct(calc.vs200)}</span>],
            ].map(([k, v]) => (
              <div key={k as string} className="rounded-lg bg-[#090c10] border border-white/[0.08] p-3">
                <div className="text-[#94a3b8]">{k}</div>
                <div className="text-sm font-semibold font-mono-num text-[#f1f4f8] mt-0.5">{v}</div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="rounded-lg bg-[#090c10] border border-white/[0.08] p-4 text-xs text-[#94a3b8]">
          Price history unavailable. This page only shows real daily closes (published by the scheduled data job) and never invents history.
        </div>
      )}
    </section>
  );
}
