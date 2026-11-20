import { useMemo, useState } from 'react';
import {
  getGoldQuote,
  monthlyNeeded,
  monthsToTarget,
  projectSavings,
  timingSignal,
} from '../lib/savingsPlan';
import type { PricingAssumptions } from '../lib/types';

interface Props {
  spotUsdOz: number;
  /** Last ~30 REAL daily closes (USD/oz); null when real history is unavailable. */
  closes30: number[] | null;
  assumptions: PricingAssumptions;
}

const SCENARIOS = [
  { label: 'Flat', rate: 0 },
  { label: 'Slow', rate: 4 },
  { label: 'Typical', rate: 8 },
  { label: 'Strong', rate: 12 },
];

const aed = (v: number) =>
  Number.isFinite(v) ? 'AED ' + Math.round(v).toLocaleString('en-US') : '—';

export function SimpleSaver({ spotUsdOz, closes30, assumptions }: Props) {
  const [monthly, setMonthly] = useState(100);
  const [years, setYears] = useState(10);
  const [rate, setRate] = useState(8);

  const quote = useMemo(() => getGoldQuote(spotUsdOz, assumptions), [spotUsdOz, assumptions]);
  const signal = useMemo(() => (closes30 ? timingSignal(spotUsdOz, closes30) : null), [spotUsdOz, closes30]);
  const plan = projectSavings(monthly, years, rate, quote);
  const yrsTo1M = monthsToTarget(monthly, 1_000_000, rate, quote) / 12;
  const need20 = monthlyNeeded(1_000_000, 20, rate, quote);

  const signalColor =
    signal?.label === 'Below average' ? 'text-[#10b981]' : signal?.label === 'Above average' ? 'text-[#f59e0b]' : 'text-[#94a3b8]';

  return (
    <section aria-label="Simple gold saver" className="rounded-xl bg-[#11161e] border border-[#e5b842]/30 p-5 flex flex-col gap-5">
      <div>
        <h2 className="font-display text-xl font-bold text-[#f8fafc]">Start small. Buy gold every month.</h2>
        <p className="text-xs text-[#94a3b8] mt-1">
          Gold is a store of value, not a lottery ticket. The edge for a small saver is consistency and low costs.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-lg bg-[#090c10] border border-white/[0.08] p-4">
          <div className="text-xs text-[#94a3b8]">24K buy price today</div>
          <div className="text-2xl font-bold font-mono-num text-[#f3d06b]">AED {quote.buyAedPerG.toFixed(2)}/g</div>
          <div className="text-xs text-[#94a3b8] mt-1">
            {monthly} AED buys ≈ {(monthly / quote.buyAedPerG).toFixed(3)} g
          </div>
        </div>
        <div className="rounded-lg bg-[#090c10] border border-white/[0.08] p-4">
          <div className="text-xs text-[#94a3b8]">Break-even cost</div>
          <div className="text-2xl font-bold font-mono-num text-[#f1f4f8]">+{quote.roundTripCostPct.toFixed(1)}%</div>
          <div className="text-xs text-[#94a3b8] mt-1">Gold must rise this much before you profit (buy/sell spread).</div>
        </div>
        <div className="rounded-lg bg-[#090c10] border border-white/[0.08] p-4">
          <div className="text-xs text-[#94a3b8]">Price vs 30-day average</div>
          <div className={`text-2xl font-bold ${signalColor}`}>{signal ? signal.label : 'Unavailable'}</div>
          <div className="text-xs text-[#94a3b8] mt-1">
            {signal
              ? `${signal.pct >= 0 ? '+' : ''}${signal.pct.toFixed(1)}%. Descriptive only, not a prediction. Keep buying on schedule either way.`
              : 'Needs real price history and a live quote.'}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-[#cbd5e1]">
        <label className="flex flex-col gap-1">
          Monthly (AED)
          <input type="number" min={10} step={10} value={monthly}
            onChange={(e) => setMonthly(Math.max(0, Number(e.target.value) || 0))}
            className="bg-[#090c10] border border-white/[0.12] rounded-md px-3 py-2 text-sm font-mono-num" />
        </label>
        <label className="flex flex-col gap-1">
          Years
          <input type="number" min={1} max={50} value={years}
            onChange={(e) => setYears(Math.min(50, Math.max(1, Number(e.target.value) || 1)))}
            className="bg-[#090c10] border border-white/[0.12] rounded-md px-3 py-2 text-sm font-mono-num" />
        </label>
        <div className="flex flex-col gap-1">
          Gold price growth per year
          <div role="group" className="inline-flex bg-[#090c10] border border-white/[0.08] rounded-lg p-1 gap-1">
            {SCENARIOS.map((s) => (
              <button key={s.rate} type="button" onClick={() => setRate(s.rate)} aria-pressed={rate === s.rate}
                className={`flex-1 px-2 py-1.5 rounded-md font-semibold cursor-pointer border ${
                  rate === s.rate ? 'bg-[#e5b842]/20 text-[#f3d06b] border-[#e5b842]/40' : 'text-[#94a3b8] border-transparent'
                }`}>
                {s.label} {s.rate}%
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-lg bg-[#090c10] border border-white/[0.08] p-4">
        <div className="text-xs text-[#94a3b8]">After {years} years at {rate}%/yr (after buy and sell costs)</div>
        <div className="text-3xl font-bold font-mono-num text-[#f3d06b]">{aed(plan.value)}</div>
        <div className="text-xs text-[#94a3b8] mt-1">
          You put in {aed(plan.invested)} · you own ≈ {plan.gramsOwned.toFixed(1)} g at today's price
        </div>
      </div>

      <div className="rounded-lg border border-[#f59e0b]/30 bg-[#f59e0b]/5 p-4 text-xs text-[#e2e8f0] leading-relaxed">
        <strong className="text-[#f59e0b]">Reality check on "millions":</strong>{' '}
        {monthly} AED/month reaches AED 1,000,000 in{' '}
        {Number.isFinite(yrsTo1M) ? `about ${yrsTo1M.toFixed(0)} years` : 'never'} at {rate}%/yr. To get there in 20 years
        you'd need ≈ {aed(need20)}/month. The real lever is raising what you save, not finding a trick. Anyone promising
        100 AED → millions is selling something. Gold can also fall for years. Only invest money you won't need soon.
      </div>

      <div className="text-xs text-[#94a3b8] leading-relaxed">
        <strong className="text-[#cbd5e1]">Simple rules:</strong> (1) Buy the same AED amount monthly. (2) Buy 24K bars/coins or a
        regulated gold product with low premium, avoid jewellery as an investment (making charges can be 10-25%).
        (3) Check the dealer's buy/sell gap before you buy. (4) Raise your monthly amount whenever income rises.
      </div>
    </section>
  );
}
