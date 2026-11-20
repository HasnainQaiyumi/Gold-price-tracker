import { useMemo, useState } from 'react';
import { explainDrawdown, explainFromHigh, explainRange, explainReturns, explainRsi, explainVol, explainVsAvg, overallSummary, type KeyStats } from '../lib/statsExplain';
import { annualisedVolPct, maxDrawdownPct, returnPct, rsi, smaSeries } from '../lib/goldAnalytics';
import type { DailyClose } from '../lib/types';

const RANGES = [
  { label: '1M', n: 30 },
  { label: '3M', n: 90 },
  { label: '6M', n: 180 },
  { label: '1Y', n: 365 },
  { label: '2Y', n: 730 },
];

const pct = (v: number | null, d = 1) => (v === null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`);
const tone = (v: number | null) => (v === null ? 'text-[#a39b8a]' : v >= 0 ? 'text-[#6fcf97]' : 'text-[#ef6b6b]');

export function PriceHistory({ series, toAed: g, unitText, statsOnly = false }: { series: DailyClose[] | null; toAed: (usd: number) => number; unitText: string; statsOnly?: boolean }) {
  const [range, setRange] = useState(180);
  const [hover, setHover] = useState<number | null>(null);

  const calc = useMemo(() => {
    if (!series) return null;
    const v = series.map((d) => d.usd);
    const sma50 = smaSeries(v, 50);
    const sma200 = smaSeries(v, 200);
    const y = v.slice(-365);
    const last = v[v.length - 1];
    const hi = Math.max(...y), lo = Math.min(...y);
    const lastOf = (a: (number | null)[]) => a[a.length - 1];
    return {
      v, sma50, sma200, last, hi, lo,
      rsi: rsi(v, 14), vol: annualisedVolPct(v, 30, 365), dd: maxDrawdownPct(y),
      r1m: returnPct(v, 30), r3m: returnPct(v, 90), r1y: returnPct(v, 365),
      fromHigh: (last / hi - 1) * 100,
      vs50: lastOf(sma50) ? (last / (lastOf(sma50) as number) - 1) * 100 : null,
      vs200: lastOf(sma200) ? (last / (lastOf(sma200) as number) - 1) * 100 : null,
    };
  }, [series]);

  const W = 800, H = 240, PAD = 8;
  const view = useMemo(() => {
    if (!series || !calc) return null;
    const n = Math.min(range, series.length);
    const start = series.length - n;
    const pts = series.slice(start).map((d, i) => ({
      date: d.date, y: g(d.usd),
      s50: calc.sma50[start + i] === null ? null : g(calc.sma50[start + i] as number),
      s200: calc.sma200[start + i] === null ? null : g(calc.sma200[start + i] as number),
    }));
    const ys = pts.flatMap((p) => [p.y, p.s50 ?? p.y, p.s200 ?? p.y]);
    const min = Math.min(...ys), max = Math.max(...ys);
    const x = (i: number) => PAD + (i / Math.max(1, pts.length - 1)) * (W - 2 * PAD);
    const yy = (val: number) => H - PAD - ((val - min) / (max - min || 1)) * (H - 2 * PAD);
    const line = (get: (p: (typeof pts)[number]) => number | null) =>
      pts.map((p, i) => [i, get(p)] as const).filter(([, v]) => v !== null)
        .map(([i, v]) => `${x(i).toFixed(1)},${yy(v as number).toFixed(1)}`).join(' ');
    return { pts, min, max, x, price: line((p) => p.y), s50: line((p) => p.s50), s200: line((p) => p.s200) };
  }, [series, calc, range]);

  if (!series || !calc || !view) {
    return (
      <section className="panel text-xs text-[#a39b8a]">
        Price history unavailable right now. Only real daily closes are ever shown, never invented ones.
      </section>
    );
  }
  const hp = hover !== null ? view.pts[hover] : null;
  const ks: KeyStats = { r1m: calc.r1m, r3m: calc.r3m, r1y: calc.r1y, rsi: calc.rsi, vol: calc.vol, dd: calc.dd, hi: g(calc.hi), lo: g(calc.lo), last: g(calc.last), fromHigh: calc.fromHigh, vs50: calc.vs50, vs200: calc.vs200 };
  const fmtA = (v: number) => `AED ${v >= 1000 ? Math.round(v).toLocaleString('en-US') : v.toFixed(0)}`;
  const why: Record<string, string> = {
    '1M / 3M / 1Y': explainReturns(ks),
    'RSI (14)': explainRsi(ks.rsi),
    'Volatility (30d, annual)': explainVol(ks.vol),
    'Worst fall (1Y)': explainDrawdown(ks.dd),
    '1Y high / low (AED)': explainRange(ks, fmtA),
    'From 1Y high': explainFromHigh(ks.fromHigh),
    'vs 50-day avg': explainVsAvg(ks.vs50, 50),
    'vs 200-day avg': explainVsAvg(ks.vs200, 200),
  };
  const stat = (k: string, v: React.ReactNode) => (
    <div key={k} className="rounded-lg bg-[#0d0c09] border border-white/[0.08] p-3 flex flex-col">
      <div className="text-[#a39b8a]">{k}</div>
      <div className="text-sm font-semibold font-mono-num text-[#f4efe6] mt-0.5">{v}</div>
      {statsOnly && why[k] && <p className="mt-2 text-[12px] leading-relaxed text-[#cfc7b6]">{why[k]}</p>}
    </div>
  );

  return (
    <section aria-label="Gold price history" className="panel flex flex-col gap-4">
      {statsOnly ? (
        <div>
          <h2 className="panel-title">Key numbers</h2>
          {overallSummary(ks) && <p className="mt-2 text-[15px] leading-relaxed text-[#fbf7ef] rounded-xl border border-[#d9a93f]/25 bg-[#1b170e] px-4 py-3">{overallSummary(ks)}</p>}
        </div>
      ) : (
        <>
      <div className="flex items-center justify-between">
        <h2 className="panel-title">History</h2>
        <div className="flex items-center gap-3">
          <div className="text-xs text-[#a39b8a] font-mono-num h-4 hidden md:block">{hp ? `${hp.date} · AED ${hp.y.toFixed(2)}` : `AED ${unitText}`}</div>
          <div role="group" aria-label="Chart range" className="inline-flex bg-[#0d0c09] border border-white/[0.08] rounded-lg p-1 gap-1">
            {RANGES.map((r) => (
              <button key={r.label} type="button" onClick={() => setRange(r.n)} aria-pressed={range === r.n}
                className={`px-3 py-1 text-xs font-semibold rounded-md cursor-pointer border ${range === r.n ? 'bg-[#d9a93f]/20 text-[#f0cf72] border-[#d9a93f]/40' : 'text-[#a39b8a] border-transparent'}`}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-60" preserveAspectRatio="none" role="img" aria-label="Gold price history chart"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(Math.max(0, Math.min(view.pts.length - 1, Math.round(((e.clientX - r.left) / r.width) * (view.pts.length - 1)))));
        }}>
        <polyline points={view.s200} fill="none" stroke="#818cf8" strokeWidth="1.2" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
        <polyline points={view.s50} fill="none" stroke="#38bdf8" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
        <polyline points={view.price} fill="none" stroke="#d9a93f" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {hover !== null && <line x1={view.x(hover)} x2={view.x(hover)} y1={0} y2={H} stroke="#7d7667" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="flex gap-4 text-[11px] text-[#a39b8a]">
        <span><span className="text-[#d9a93f]">━</span> Price</span>
        <span><span className="text-[#38bdf8]">━</span> 50-day avg</span>
        <span><span className="text-[#818cf8]">┅</span> 200-day avg</span>
        <span className="ml-auto font-mono-num">AED {view.min.toFixed(0)}–{view.max.toFixed(0)} · {view.pts[0].date} to {view.pts[view.pts.length - 1].date}</span>
      </div>

        </>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        {stat('1M / 3M / 1Y', <span><span className={tone(calc.r1m)}>{pct(calc.r1m)}</span> / <span className={tone(calc.r3m)}>{pct(calc.r3m)}</span> / <span className={tone(calc.r1y)}>{pct(calc.r1y)}</span></span>)}
        {stat('RSI (14)', <span>{calc.rsi === null ? '—' : calc.rsi.toFixed(0)} <span className="text-[#8a8374]">{calc.rsi === null ? '' : calc.rsi > 70 ? 'overbought' : calc.rsi < 30 ? 'oversold' : 'neutral'}</span></span>)}
        {stat('Volatility (30d, annual)', calc.vol === null ? '—' : `${calc.vol.toFixed(1)}%`)}
        {stat('Worst fall (1Y)', <span className="text-[#ef6b6b]">{pct(calc.dd)}</span>)}
        {stat('1Y high / low (AED)', `${g(calc.hi).toFixed(0)} / ${g(calc.lo).toFixed(0)}`)}
        {stat('From 1Y high', <span className={tone(calc.fromHigh)}>{pct(calc.fromHigh)}</span>)}
        {stat('vs 50-day avg', <span className={tone(calc.vs50)}>{pct(calc.vs50)}</span>)}
        {stat('vs 200-day avg', <span className={tone(calc.vs200)}>{pct(calc.vs200)}</span>)}
      </div>
      <div className="text-[11px] text-[#8a8374]">
        Where these numbers come from: daily prices of PAXG, a digital token backed by real gold (1 token = 1 ounce). It trades every day of the week and stays within about 0.3% of the real gold price, and we adjust it to match today's live price.
      </div>
    </section>
  );
}
