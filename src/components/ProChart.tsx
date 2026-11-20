import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts';
import { Panel, Seg } from './ui';
import { explainPoint, type Arrow } from '../lib/chartStory';
import {
  dayChangePct,
  isoDay,
  isSaneUsd,
  prepareCandles,
  rangeStart,
  smaLine,
  timeToDay,
  toDisplay,
  type Candle,
  type RangeKey,
} from '../lib/candles';

/* Design tokens (see src/index.css). SMA colours match the History panel. */
const C = {
  text: '#f4efe6',
  muted: '#a39b8a',
  dim: '#7d7667',
  gold: '#d9a93f',
  up: '#6fcf97',
  down: '#ef6b6b',
  sma50: '#38bdf8',
  sma200: '#818cf8',
  grid: 'rgba(255, 255, 255, 0.045)',
  border: 'rgba(255, 255, 255, 0.08)',
};

type Mode = 'candles' | 'area';
const RANGES: { v: RangeKey; label: string }[] = [
  { v: '1M', label: '1M' },
  { v: '3M', label: '3M' },
  { v: '6M', label: '6M' },
  { v: '1Y', label: '1Y' },
  { v: 'ALL', label: 'ALL' },
];

const fmt = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const axisFmt = (v: number) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US') : v.toFixed(2));
const fmtVol = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: v >= 100 ? 0 : 2 });
const fmtDate = (ymd: string) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? ymd
    : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
const priceFormat = { type: 'custom' as const, formatter: axisFmt, minMove: 0.01 };

interface Series {
  candle: ISeriesApi<'Candlestick'>;
  area: ISeriesApi<'Area'>;
  sma50: ISeriesApi<'Line'>;
  sma200: ISeriesApi<'Line'>;
  volume: ISeriesApi<'Histogram'>;
  candleMarks: ISeriesMarkersPluginApi<Time>;
  areaMarks: ISeriesMarkersPluginApi<Time>;
}

export function ProChart({
  candles,
  spotUsd,
  toAed,
  unitText,
  paxgUsd,
  outlook7,
}: {
  candles: Candle[] | null;
  spotUsd: number | null;
  toAed: (usd: number) => number;
  unitText: string;
  /** Optional live PAXG price; lets the chart remove PAXG's premium/discount to spot exactly. */
  paxgUsd?: number | null;
  /** Today's "most likely" 1-week range in display units, from the forecast engine. */
  outlook7?: { lo: number; hi: number } | null;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<Series | null>(null);
  const [mode, setMode] = useState<Mode>('candles');
  const [range, setRange] = useState<RangeKey>('6M');
  const [show50, setShow50] = useState(true);
  const [show200, setShow200] = useState(true);
  const [hoverDay, setHoverDay] = useState<string | null>(null);

  /* ---------------------------------------------------------------- derived data */
  const view = useMemo(() => {
    if (!candles || candles.length === 0) return null;
    const nowIso = new Date().toISOString();
    const usd = prepareCandles(candles, spotUsd, nowIso, paxgUsd);
    const disp = toDisplay(usd, toAed);
    if (disp.length === 0) return null;
    // "live" only when the last candle really is today's (UTC) and was patched with a sane spot.
    const liveDay = isSaneUsd(spotUsd) && disp[disp.length - 1].time === isoDay(nowIso) ? disp[disp.length - 1].time : null;
    const index = new Map(disp.map((c, i) => [c.time, i]));
    const s50 = smaLine(disp, 50);
    const s200 = smaLine(disp, 200);
    return {
      disp,
      liveDay,
      index,
      s50,
      s200,
      s50At: new Map(s50.map((p) => [p.time, p.value])),
      s200At: new Map(s200.map((p) => [p.time, p.value])),
    };
  }, [candles, spotUsd, paxgUsd, toAed]);

  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  const hadData = useRef(false);

  /* ------------------------------------------------------- create chart once */
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: C.muted,
        fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
        fontSize: 11,
        attributionLogo: true, // required by the lightweight-charts licence (TradingView attribution)
      },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: C.dim, labelBackgroundColor: '#2a261d', style: LineStyle.Dashed },
        horzLine: { color: C.dim, labelBackgroundColor: '#2a261d', style: LineStyle.Dashed },
      },
      rightPriceScale: { borderColor: C.border, scaleMargins: { top: 0.08, bottom: 0.24 } },
      timeScale: { borderColor: C.border, rightOffset: 3, fixLeftEdge: true, lockVisibleTimeRangeOnResize: true },
      localization: { locale: 'en-US' },
    });

    const candle = chart.addSeries(CandlestickSeries, {
      upColor: C.up,
      downColor: C.down,
      borderUpColor: C.up,
      borderDownColor: C.down,
      wickUpColor: C.up,
      wickDownColor: C.down,
      priceFormat,
    });
    const area = chart.addSeries(AreaSeries, {
      lineColor: C.gold,
      lineWidth: 2,
      topColor: 'rgba(217, 169, 63, 0.28)',
      bottomColor: 'rgba(217, 169, 63, 0.0)',
      priceFormat,
      visible: false,
    });
    const lineOpts = { lineWidth: 1 as const, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, priceFormat };
    const sma50 = chart.addSeries(LineSeries, { ...lineOpts, color: C.sma50 });
    const sma200 = chart.addSeries(LineSeries, { ...lineOpts, color: C.sma200, lineStyle: LineStyle.Dashed });
    const volume = chart.addSeries(HistogramSeries, {
      priceScaleId: 'vol',
      priceFormat: { type: 'volume' },
      priceLineVisible: false,
      lastValueVisible: false,
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, visible: false });

    const onMove = (p: MouseEventParams<Time>) => {
      const day = p.point && p.time !== undefined ? timeToDay(p.time) : null;
      setHoverDay((prev) => (prev === day ? prev : day));
    };
    chart.subscribeCrosshairMove(onMove);

    chartRef.current = chart;
    seriesRef.current = { candle, area, sma50, sma200, volume, candleMarks: createSeriesMarkers(candle, []), areaMarks: createSeriesMarkers(area, []) };
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      hadData.current = false; // a re-created chart (StrictMode, HMR) must be framed again
    };
  }, []);

  /* ---------------------------------------------- push data (no chart rebuild) */
  useEffect(() => {
    const s = seriesRef.current;
    if (!s) return;
    const clear = () => {
      s.candle.setData([]); s.area.setData([]); s.sma50.setData([]); s.sma200.setData([]); s.volume.setData([]);
      hadData.current = false;
    };
    if (!view) {
      clear();
      return;
    }
    try {
      s.candle.setData(view.disp.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
      s.area.setData(view.disp.map(({ time, close }) => ({ time, value: close })));
      s.sma50.setData(view.s50);
      s.sma200.setData(view.s200);
      s.volume.setData(
        view.disp.map((c) => ({
          time: c.time,
          value: c.volume,
          color: c.close >= c.open ? 'rgba(111, 207, 151, 0.32)' : 'rgba(239, 107, 107, 0.32)',
        }))
      );
    } catch (err) {
      // Data is normalised upstream, so this should not happen; never let the chart crash the app.
      console.error('ProChart: could not render candles', err);
      clear();
      return;
    }
    if (!hadData.current) {
      hadData.current = true;
      applyRange(chartRef.current, view.disp, range);
    }
    // `range` is intentionally not a dependency: later range changes are applied by the
    // effect below, so live price updates never reset the user's zoom/scroll.
  }, [view]);

  useEffect(() => {
    const v = viewRef.current;
    if (v) applyRange(chartRef.current, v.disp, range);
  }, [range]);

  useEffect(() => {
    const s = seriesRef.current;
    if (!s) return;
    s.candle.applyOptions({ visible: mode === 'candles' });
    s.area.applyOptions({ visible: mode === 'area' });
  }, [mode]);
  useEffect(() => { seriesRef.current?.sma50.applyOptions({ visible: show50 }); }, [show50]);
  useEffect(() => { seriesRef.current?.sma200.applyOptions({ visible: show200 }); }, [show200]);

  /* ------------------------------------------------------------------- legend */
  const legend = useMemo(() => {
    if (!view) return null;
    const i = hoverDay !== null && view.index.has(hoverDay) ? (view.index.get(hoverDay) as number) : view.disp.length - 1;
    const c = view.disp[i];
    return {
      c,
      chg: dayChangePct(view.disp, i),
      s50: view.s50At.get(c.time) ?? null,
      s200: view.s200At.get(c.time) ?? null,
      live: c.time === view.liveDay,
    };
  }, [view, hoverDay]);

  /* ------------------------------------------- plain-language story + pointers */
  const story = useMemo(() => {
    if (!view || !legend) return null;
    const i = view.index.get(legend.c.time) as number;
    return explainPoint(view.disp, i, legend.s50, legend.s200, (v) => `AED ${fmt(v)}`, outlook7 ?? null);
  }, [view, legend, outlook7]);

  useEffect(() => {
    const s = seriesRef.current;
    if (!s || !view || !legend) return;
    const marks: SeriesMarker<Time>[] = [];
    const a = story?.day.arrow;
    marks.push(
      a === 'down'
        ? { time: legend.c.time as Time, position: 'aboveBar', color: C.down, shape: 'arrowDown', text: 'this day' }
        : a === 'up'
          ? { time: legend.c.time as Time, position: 'belowBar', color: C.up, shape: 'arrowUp', text: 'this day' }
          : { time: legend.c.time as Time, position: 'aboveBar', color: C.gold, shape: 'circle', text: 'this day' }
    );
    if (story?.next) {
      const n = story.next;
      const label = `${n.laterPct >= 0 ? '+' : ''}${n.laterPct.toFixed(1)}% later`;
      marks.push(
        n.arrow === 'down'
          ? { time: n.laterTime as Time, position: 'aboveBar', color: C.down, shape: 'arrowDown', text: label }
          : n.arrow === 'up'
            ? { time: n.laterTime as Time, position: 'belowBar', color: C.up, shape: 'arrowUp', text: label }
            : { time: n.laterTime as Time, position: 'aboveBar', color: C.gold, shape: 'circle', text: label }
      );
    }
    const onCandles = mode === 'candles';
    (onCandles ? s.candleMarks : s.areaMarks).setMarkers(marks);
    (onCandles ? s.areaMarks : s.candleMarks).setMarkers([]);
  }, [story, legend, view, mode]);

  const tone = (v: number | null) => (v === null ? 'text-[#a39b8a]' : v >= 0 ? 'text-[#6fcf97]' : 'text-[#ef6b6b]');
  const kv = (k: string, v: string, cls = 'text-[#f4efe6]') => (
    <span className="whitespace-nowrap">
      <span className="text-[#7d7667]">{k}</span> <span className={cls}>{v}</span>
    </span>
  );

  return (
    <Panel title="Chart" hint={<span>AED {unitText} · PAXG daily candles, aligned to spot</span>}>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Seg<Mode> label="Chart style" value={mode} onChange={setMode} options={[{ v: 'candles', label: 'Candles' }, { v: 'area', label: 'Line' }]} />
        <div role="group" aria-label="Moving averages" className="seg">
          <button type="button" aria-pressed={show50} onClick={() => setShow50((v) => !v)}>
            <span className="text-[#38bdf8]">━</span> SMA 50
          </button>
          <button type="button" aria-pressed={show200} onClick={() => setShow200((v) => !v)}>
            <span className="text-[#818cf8]">┅</span> SMA 200
          </button>
        </div>
        <div className="ml-auto">
          <Seg<RangeKey> label="Chart range" value={range} onChange={setRange} options={RANGES} />
        </div>
      </div>

      <div className="min-h-[38px] mb-2 text-[11px] font-mono-num flex flex-wrap items-baseline gap-x-3 gap-y-1" aria-live="off">
        {legend ? (
          <>
            <span className="text-[#fbf7ef] font-semibold font-sans">
              {fmtDate(legend.c.time)}
              {legend.live && <span className="ml-1.5 text-[#f0cf72] font-normal">live</span>}
            </span>
            {kv('O', fmt(legend.c.open))}
            {kv('H', fmt(legend.c.high))}
            {kv('L', fmt(legend.c.low))}
            {kv('C', fmt(legend.c.close))}
            {kv('Chg', legend.chg === null ? '—' : `${legend.chg >= 0 ? '+' : ''}${legend.chg.toFixed(2)}%`, tone(legend.chg))}
            {show50 && legend.s50 !== null && kv('SMA50', fmt(legend.s50), 'text-[#38bdf8]')}
            {show200 && legend.s200 !== null && kv('SMA200', fmt(legend.s200), 'text-[#818cf8]')}
            {legend.c.volume > 0 && kv('Vol', `${fmtVol(legend.c.volume)} oz`, 'text-[#a39b8a]')}
          </>
        ) : (
          <span className="text-[#7d7667]">AED {unitText}</span>
        )}
      </div>

      <div className="relative h-[320px] sm:h-[380px] rounded-xl bg-[#0d0c09]/60 border border-white/[0.05] overflow-hidden">
        <div
          ref={boxRef}
          className={`absolute inset-0 ${view ? '' : 'invisible'}`}
          role="img"
          aria-label={
            legend
              ? `Daily gold price chart in AED ${unitText}. Latest close ${fmt(view!.disp[view!.disp.length - 1].close)}.`
              : 'Daily gold price chart, loading'
          }
        />
        {!view && (
          <div className="absolute inset-0 grid place-items-center text-center px-6">
            <div>
              <div className="mx-auto mb-3 h-1 w-24 rounded-full bg-gradient-to-r from-transparent via-[#d9a93f]/50 to-transparent animate-pulse" />
              <p className="text-xs text-[#a39b8a]">Daily candles are loading or temporarily unavailable.</p>
              <p className="text-[11px] text-[#7d7667] mt-1">Only real market data is charted, never placeholders.</p>
            </div>
          </div>
        )}
      </div>
      {story && (
        <div aria-live="polite" className="mt-3 rounded-2xl border border-[#d9a93f]/25 bg-[#0d0c09] p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-[11px] uppercase tracking-[0.14em] text-[#d9a93f] font-semibold">What this point on the chart means</div>
            <div className="text-xs text-[#fbf7ef] font-semibold">{story.date}</div>
          </div>
          <ul className="mt-3 flex flex-col gap-2.5">
            <StoryRow arrow={story.day.arrow} text={story.day.text} />
            {story.trend && <StoryRow arrow={story.trend.arrow} text={story.trend.text} />}
            {story.place && <StoryRow arrow="pin" text={story.place} />}
            {story.next && <StoryRow arrow={story.next.arrow} label="Next" text={story.next.text} />}
            {story.latest && <StoryRow arrow="future" label="Next" text={story.latest} />}
          </ul>
          <p className="mt-3 text-[11px] text-[#7d7667]">
            Move your cursor (or finger) across the chart to read any day. The arrow marked "this day" is where you are; the second arrow shows where the price actually was about a month later.
          </p>
        </div>
      )}

      <p className="mt-2 text-[10px] text-[#7d7667]">
        Source: Coinbase PAXG-USD (1 PAXG = 1 troy oz of gold, trades 24/7, so SMA periods count calendar days). Volume is PAXG traded.
      </p>
    </Panel>
  );
}

function StoryRow({ arrow, text, label }: { arrow: Arrow | 'mixed' | 'pin' | 'future'; text: string; label?: string }) {
  const look = {
    up: { sym: '▲', cls: 'text-[#6fcf97] bg-[#6fcf97]/10 border-[#6fcf97]/30' },
    down: { sym: '▼', cls: 'text-[#ef6b6b] bg-[#ef6b6b]/10 border-[#ef6b6b]/30' },
    flat: { sym: '▶', cls: 'text-[#f0cf72] bg-[#f0cf72]/10 border-[#f0cf72]/30' },
    mixed: { sym: '⇅', cls: 'text-[#f0cf72] bg-[#f0cf72]/10 border-[#f0cf72]/30' },
    pin: { sym: '📍', cls: 'text-[#d8d0bf] bg-white/[0.04] border-white/10' },
    future: { sym: '➜', cls: 'text-[#f0cf72] bg-[#f0cf72]/10 border-[#f0cf72]/30' },
  }[arrow];
  return (
    <li className="flex gap-3 items-start">
      <span className={`shrink-0 grid place-items-center w-7 h-7 rounded-full border text-sm ${look.cls}`} aria-hidden>
        {look.sym}
      </span>
      <span className="text-[14px] leading-relaxed text-[#e8e1d2]">
        {label && <span className="font-semibold text-[#fbf7ef]">{label}: </span>}
        {label ? text.replace(/^What happened next: /, '') : text}
      </span>
    </li>
  );
}

function applyRange(chart: IChartApi | null, disp: Candle[], range: RangeKey) {
  if (!chart || disp.length === 0) return;
  const ts = chart.timeScale();
  const last = disp[disp.length - 1].time;
  const from = rangeStart(last, range);
  try {
    if (from === null || from <= disp[0].time) ts.fitContent();
    else ts.setVisibleRange({ from, to: last });
  } catch {
    ts.fitContent();
  }
}
