import { formatCurrency } from '../lib/goldPricing';
import type {
  CurrencyCode,
  ForecastHorizon,
  MacroScenarioInput,
  MarketMacroTelemetry,
  QuantForecastResult,
} from '../lib/types';

interface MacroSimulatorProps {
  currency: CurrencyCode;
  horizon: ForecastHorizon;
  quant: QuantForecastResult;
  macro: MarketMacroTelemetry;
  scenario: MacroScenarioInput;
  onChangeScenario: (next: MacroScenarioInput) => void;
  onResetScenario: () => void;
}

export function MacroSimulator({
  currency,
  horizon,
  quant,
  macro,
  scenario,
  onChangeScenario,
  onResetScenario,
}: MacroSimulatorProps) {
  const fmtPct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;

  const hasScenarioEdits =
    scenario.yieldBps !== 0 ||
    scenario.dxyPct !== 0 ||
    scenario.geoPct !== 0 ||
    scenario.indiaDutyPct !== 15;

  return (
    <section className="rounded-xl bg-[#11161e] border border-white/[0.08] p-5 flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-semibold text-[#f1f4f8]">
            Quant Forecast &amp; Macro Stress-Test
          </h2>
          <p className="text-xs text-[#94a3b8] mt-0.5">
            +{horizon}D Horizon · {quant.signalLabel}
            {currency === 'INR'
              ? ` · FX Carry ${quant.inRCurrencyDriftPct >= 0 ? '+' : ''}${quant.inRCurrencyDriftPct.toFixed(2)}%`
              : ''}
          </p>
        </div>

        {hasScenarioEdits && (
          <button
            type="button"
            onClick={onResetScenario}
            className="text-xs font-medium text-[#f3d06b] hover:underline whitespace-nowrap shrink-0 cursor-pointer"
          >
            Reset Sliders
          </button>
        )}
      </div>

      {/* Bear / Base / Bull Target Grid separated by subtle hairline dividers (no nested cards) */}
      <div className="grid grid-cols-3 divide-x divide-white/[0.08] border-y border-white/[0.06] py-3">
        <div className="pr-3">
          <div className="text-xs text-[#94a3b8]">Bear (P10)</div>
          <div
            className="font-mono-num text-base font-semibold text-[#f1f4f8] mt-1"
            data-testid="forecast-p10"
          >
            {formatCurrency(quant.end.p10, currency)}
          </div>
          <div
            className={`font-mono-num text-xs mt-0.5 ${
              quant.p10ChangePct >= 0 ? 'text-[#10b981]' : 'text-[#f43f5e]'
            }`}
          >
            {fmtPct(quant.p10ChangePct)}
          </div>
        </div>

        <div className="px-3">
          <div className="text-xs text-[#f3d06b] font-medium">Base (P50)</div>
          <div
            className="font-mono-num text-base font-bold text-[#f3d06b] mt-1"
            data-testid="forecast-p50"
          >
            {formatCurrency(quant.end.p50, currency)}
          </div>
          <div
            className={`font-mono-num text-xs mt-0.5 ${
              quant.p50ChangePct >= 0 ? 'text-[#10b981]' : 'text-[#f43f5e]'
            }`}
          >
            {fmtPct(quant.p50ChangePct)}
          </div>
        </div>

        <div className="pl-3">
          <div className="text-xs text-[#94a3b8]">Bull (P90)</div>
          <div
            className="font-mono-num text-base font-semibold text-[#f1f4f8] mt-1"
            data-testid="forecast-p90"
          >
            {formatCurrency(quant.end.p90, currency)}
          </div>
          <div
            className={`font-mono-num text-xs mt-0.5 ${
              quant.p90ChangePct >= 0 ? 'text-[#10b981]' : 'text-[#f43f5e]'
            }`}
          >
            {fmtPct(quant.p90ChangePct)}
          </div>
        </div>
      </div>

      {/* Live Macro & Technical Telemetry Table */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
        <div className="flex justify-between py-1 border-b border-white/[0.04]">
          <span className="text-[#94a3b8]">RSI (14D)</span>
          <span className="font-mono-num text-[#f1f4f8] font-medium">
            {quant.rsi14.toFixed(1)}{' '}
            {quant.rsi14 < 35 ? '(Oversold)' : quant.rsi14 > 70 ? '(Overbought)' : '(Neutral)'}
          </span>
        </div>
        <div className="flex justify-between py-1 border-b border-white/[0.04]">
          <span className="text-[#94a3b8]">Blended Vol</span>
          <span className="font-mono-num text-[#f1f4f8] font-medium">
            {quant.annVolPct.toFixed(1)}% ann.
          </span>
        </div>
        <div className="flex justify-between py-1 border-b border-white/[0.04]">
          <span className="text-[#94a3b8]">Key Support</span>
          <span className="font-mono-num text-[#f1f4f8] font-medium">
            {formatCurrency(quant.support, currency)}
          </span>
        </div>
        <div className="flex justify-between py-1 border-b border-white/[0.04]">
          <span className="text-[#94a3b8]">Key Resistance</span>
          <span className="font-mono-num text-[#f1f4f8] font-medium">
            {formatCurrency(quant.resistance, currency)}
          </span>
        </div>
        <div className="flex justify-between py-1 border-b border-white/[0.04]">
          <span className="text-[#94a3b8]">10Y Real Yield</span>
          <span className="font-mono-num text-[#f1f4f8] font-medium">
            {macro.realYield10y.toFixed(2)}%
          </span>
        </div>
        <div className="flex justify-between py-1 border-b border-white/[0.04]">
          <span className="text-[#94a3b8]">CFTC MM Net</span>
          <span className="font-mono-num text-[#f1f4f8] font-medium">
            {macro.cotMmNetPctOi.toFixed(1)}% OI
          </span>
        </div>
      </div>

      {/* Macro Driver Scenario Stress-Test Sliders */}
      <div className="pt-2 border-t border-white/[0.06] flex flex-col gap-3.5">
        <div className="text-xs font-semibold text-[#f3d06b]">
          Macro Driver Scenario Stress-Test
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between text-xs">
            <label htmlFor="slider-yield" className="text-[#cbd5e1]">
              US 10Y Real Yield Shift
            </label>
            <span className="font-mono-num text-[#f1f4f8]">
              {scenario.yieldBps > 0 ? '+' : ''}
              {scenario.yieldBps} bps
            </span>
          </div>
          <input
            id="slider-yield"
            type="range"
            min={-100}
            max={100}
            step={5}
            value={scenario.yieldBps}
            onChange={(e) =>
              onChangeScenario({ ...scenario, yieldBps: Number(e.target.value) })
            }
            className="bullion-slider"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between text-xs">
            <label htmlFor="slider-dxy" className="text-[#cbd5e1]">
              DXY Dollar Index Shift
            </label>
            <span className="font-mono-num text-[#f1f4f8]">
              {scenario.dxyPct > 0 ? '+' : ''}
              {scenario.dxyPct.toFixed(1)}%
            </span>
          </div>
          <input
            id="slider-dxy"
            type="range"
            min={-5}
            max={5}
            step={0.5}
            value={scenario.dxyPct}
            onChange={(e) =>
              onChangeScenario({ ...scenario, dxyPct: Number(e.target.value) })
            }
            className="bullion-slider"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between text-xs">
            <label htmlFor="slider-geo" className="text-[#cbd5e1]">
              Central Bank / Safe-Haven Impulse
            </label>
            <span className="font-mono-num text-[#f1f4f8]">
              {scenario.geoPct > 0 ? '+' : ''}
              {scenario.geoPct.toFixed(1)}%
            </span>
          </div>
          <input
            id="slider-geo"
            type="range"
            min={-4}
            max={8}
            step={0.5}
            value={scenario.geoPct}
            onChange={(e) =>
              onChangeScenario({ ...scenario, geoPct: Number(e.target.value) })
            }
            className="bullion-slider"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between text-xs">
            <label htmlFor="slider-duty" className="text-[#cbd5e1]">
              India Import Duty (BCD + AIDC)
            </label>
            <span className="font-mono-num text-[#f1f4f8]">
              {scenario.indiaDutyPct.toFixed(1)}%
            </span>
          </div>
          <input
            id="slider-duty"
            type="range"
            min={6}
            max={18}
            step={0.5}
            value={scenario.indiaDutyPct}
            onChange={(e) =>
              onChangeScenario({ ...scenario, indiaDutyPct: Number(e.target.value) })
            }
            className="bullion-slider"
          />
        </div>
      </div>
    </section>
  );
}
