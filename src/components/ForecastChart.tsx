import { useEffect, useRef, useState } from 'react';
import { formatCurrency, getUnitLabel } from '../lib/goldPricing';
import type {
  CurrencyCode,
  ForecastHorizon,
  HistoryPoint,
  KaratPurity,
  MarketMode,
  QuantForecastResult,
} from '../lib/types';

interface ForecastChartProps {
  currency: CurrencyCode;
  mode: MarketMode;
  karat: KaratPurity;
  unitGrams: number;
  horizon: ForecastHorizon;
  onChangeHorizon: (horizon: ForecastHorizon) => void;
  history30d: HistoryPoint[];
  quant: QuantForecastResult;
}

interface HoverTooltipState {
  visible: boolean;
  x: number;
  title: string;
  primary: string;
  secondary?: string;
  tertiary?: string;
}

const HORIZONS: ForecastHorizon[] = [7, 30, 90];

export function ForecastChart({
  currency,
  mode,
  karat,
  unitGrams,
  horizon,
  onChangeHorizon,
  history30d,
  quant,
}: ForecastChartProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [tooltip, setTooltip] = useState<HoverTooltipState>({
    visible: false,
    x: 0,
    title: '',
    primary: '',
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const renderChart = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width <= 0 || height <= 0) return;

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const pad = { top: 24, right: 86, bottom: 32, left: 16 };
      const plotW = Math.max(40, width - pad.left - pad.right);
      const plotH = Math.max(40, height - pad.top - pad.bottom);

      const allVals = [
        ...quant.series,
        ...quant.forecast.map((f) => f.p10),
        ...quant.forecast.map((f) => f.p90),
      ];
      const minV = Math.min(...allVals) * 0.992;
      const maxV = Math.max(...allVals) * 1.008;
      const span = Math.max(1e-6, maxV - minV);

      const totalPts = quant.series.length + quant.forecast.length;
      const xOf = (i: number) => pad.left + (i / Math.max(1, totalPts - 1)) * plotW;
      const yOf = (v: number) => pad.top + (1 - (v - minV) / span) * plotH;

      // Grid lines & right Y-axis labels
      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      for (let g = 0; g <= 4; g++) {
        const y = pad.top + (g / 4) * plotH;
        const val = maxV - (g / 4) * span;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(width - pad.right, y);
        ctx.stroke();

        ctx.fillStyle = '#64748b';
        ctx.fillText(formatCurrency(val, currency), width - pad.right + 10, y + 4);
      }

      const splitIdx = quant.series.length - 1;
      const splitX = xOf(splitIdx);

      // Vertical split marker between history and forecast
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(229, 184, 66, 0.4)';
      ctx.beginPath();
      ctx.moveTo(splitX, pad.top);
      ctx.lineTo(splitX, pad.top + plotH);
      ctx.stroke();
      ctx.restore();

      // Historical area fill
      const areaGrad = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotH);
      areaGrad.addColorStop(0, 'rgba(229, 184, 66, 0.22)');
      areaGrad.addColorStop(1, 'rgba(229, 184, 66, 0.0)');
      ctx.beginPath();
      quant.series.forEach((v, i) => {
        if (i === 0) ctx.moveTo(xOf(i), yOf(v));
        else ctx.lineTo(xOf(i), yOf(v));
      });
      ctx.lineTo(splitX, pad.top + plotH);
      ctx.lineTo(xOf(0), pad.top + plotH);
      ctx.closePath();
      ctx.fillStyle = areaGrad;
      ctx.fill();

      // EMA-20 line
      ctx.beginPath();
      quant.ema20.forEach((v, i) => {
        if (i === 0) ctx.moveTo(xOf(i), yOf(v));
        else ctx.lineTo(xOf(i), yOf(v));
      });
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.78)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Historical price line
      ctx.beginPath();
      quant.series.forEach((v, i) => {
        if (i === 0) ctx.moveTo(xOf(i), yOf(v));
        else ctx.lineTo(xOf(i), yOf(v));
      });
      ctx.strokeStyle = '#e5b842';
      ctx.lineWidth = 2.4;
      ctx.stroke();

      // P10-P90 conformal confidence cone
      ctx.beginPath();
      ctx.moveTo(splitX, yOf(quant.current));
      quant.forecast.forEach((f, idx) => ctx.lineTo(xOf(splitIdx + 1 + idx), yOf(f.p90)));
      for (let idx = quant.forecast.length - 1; idx >= 0; idx--) {
        ctx.lineTo(xOf(splitIdx + 1 + idx), yOf(quant.forecast[idx].p10));
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(16, 185, 129, 0.16)';
      ctx.fill();

      // P50 median forecast line
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(splitX, yOf(quant.current));
      quant.forecast.forEach((f, idx) => ctx.lineTo(xOf(splitIdx + 1 + idx), yOf(f.p50)));
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 2.2;
      ctx.stroke();
      ctx.restore();

      // Current spot anchor dot
      ctx.beginPath();
      ctx.arc(splitX, yOf(quant.current), 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#f3d06b';
      ctx.fill();

      // X-Axis ticks (align edge ticks flush inside plot bounds so they never clip)
      ctx.fillStyle = '#64748b';
      const tickIndices = [0, Math.floor(splitIdx / 2), splitIdx, totalPts - 1];
      tickIndices.forEach((idx, tickPos) => {
        const label =
          idx <= splitIdx
            ? history30d[idx]?.dateLabel ?? ''
            : quant.forecast[idx - splitIdx - 1]?.label ?? '';
        if (tickPos === 0) ctx.textAlign = 'left';
        else if (tickPos === tickIndices.length - 1) ctx.textAlign = 'right';
        else ctx.textAlign = 'center';
        ctx.fillText(label, xOf(idx), height - 10);
      });
    };

    renderChart();
    const ro = new ResizeObserver(renderChart);
    ro.observe(container);
    return () => ro.disconnect();
  }, [currency, history30d, quant]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const padLeft = 16;
    const padRight = 86;
    const plotW = Math.max(40, rect.width - padLeft - padRight);
    const x = e.clientX - rect.left;
    const frac = Math.max(0, Math.min(1, (x - padLeft) / plotW));
    const totalPts = quant.series.length + quant.forecast.length;
    const idx = Math.round(frac * (totalPts - 1));
    const splitIdx = quant.series.length - 1;

    if (idx <= splitIdx) {
      setTooltip({
        visible: true,
        x: Math.min(rect.width - 190, Math.max(12, x + 12)),
        title: `${history30d[idx]?.dateLabel ?? 'History'} · Actual`,
        primary: formatCurrency(quant.series[idx], currency),
        secondary: `EMA-20: ${formatCurrency(quant.ema20[idx], currency)}`,
      });
    } else {
      const f = quant.forecast[idx - splitIdx - 1];
      if (!f) return;
      setTooltip({
        visible: true,
        x: Math.min(rect.width - 190, Math.max(12, x + 12)),
        title: `Forecast ${f.label}`,
        primary: `P50 Base: ${formatCurrency(f.p50, currency)}`,
        secondary: `P90 Bull: ${formatCurrency(f.p90, currency)}`,
        tertiary: `P10 Bear: ${formatCurrency(f.p10, currency)}`,
      });
    }
  };

  return (
    <section className="rounded-xl bg-[#11161e] border border-white/[0.08] p-5 flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-base font-semibold text-[#f1f4f8]">
            {currency} {mode === 'actual' ? 'Actual Market' : 'Raw Spot'} Forecast Cone
          </h2>
          <p className="text-xs text-[#94a3b8] mt-0.5">
            {getUnitLabel(unitGrams)} · {karat}K Purity · Conformal P10 / P50 / P90 Envelope
          </p>
        </div>

        <div
          role="group"
          aria-label="Forecast horizon"
          className="inline-flex bg-[#090c10] border border-white/[0.08] rounded-lg p-1 gap-1"
        >
          {HORIZONS.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => onChangeHorizon(h)}
              aria-pressed={horizon === h}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                horizon === h
                  ? 'bg-[#e5b842]/20 text-[#f3d06b] border border-[#e5b842]/40'
                  : 'text-[#94a3b8] hover:text-[#f1f4f8] border border-transparent'
              }`}
            >
              +{h}D
            </button>
          ))}
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative w-full h-[340px] rounded-lg bg-[#090c10] border border-white/[0.06] overflow-hidden"
      >
        <canvas
          ref={canvasRef}
          data-testid="forecast-canvas"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setTooltip((prev) => ({ ...prev, visible: false }))}
          className="w-full h-full block cursor-crosshair"
        />
        {tooltip.visible && (
          <div
            style={{ left: `${tooltip.x}px`, top: '16px' }}
            className="pointer-events-none absolute z-10 min-w-[175px] rounded-lg bg-[#11161e]/95 border border-[#e5b842]/40 px-3 py-2 text-xs shadow-lg font-mono-num"
          >
            <div className="text-[#94a3b8] mb-1">{tooltip.title}</div>
            <div className="text-[#f3d06b] font-semibold">{tooltip.primary}</div>
            {tooltip.secondary && <div className="text-[#cbd5e1] mt-0.5">{tooltip.secondary}</div>}
            {tooltip.tertiary && <div className="text-[#94a3b8] mt-0.5">{tooltip.tertiary}</div>}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-5 text-xs text-[#94a3b8]">
        <span className="inline-flex items-center gap-2">
          <span className="w-3 h-0.5 bg-[#e5b842] inline-block" aria-hidden="true" />
          30D Market History
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="w-3 h-0.5 bg-[#38bdf8] inline-block" aria-hidden="true" />
          EMA-20 Trend
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="w-3 h-0.5 bg-[#10b981] inline-block" aria-hidden="true" />
          P50 Median Forecast
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="w-3 h-2 bg-[#10b981]/25 inline-block rounded-xs" aria-hidden="true" />
          80% Conformal Band (P10–P90)
        </span>
      </div>
    </section>
  );
}
