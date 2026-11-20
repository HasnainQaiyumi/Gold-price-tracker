import { useState } from 'react';
import { computeDubaiVsIndiaArbitrage, formatCurrency } from '../lib/goldPricing';
import type { KaratPurity, PricingAssumptions, PurchaseType } from '../lib/types';

interface ArbitrageCalculatorProps {
  spotUsdOz: number;
  karat: KaratPurity;
  assumptions: PricingAssumptions;
}

export function ArbitrageCalculator({
  spotUsdOz,
  karat,
  assumptions,
}: ArbitrageCalculatorProps) {
  const [gramsInput, setGramsInput] = useState<string>('10');
  const [makingInput, setMakingInput] = useState<string>('8');
  const [purchaseType, setPurchaseType] = useState<PurchaseType>('jewellery');

  const grams = Math.max(0.5, Number(gramsInput) || 10);
  const makingPct = Math.max(0, Math.min(40, Number(makingInput) || 0));

  const arb = computeDubaiVsIndiaArbitrage(
    spotUsdOz,
    grams,
    makingPct,
    purchaseType,
    karat,
    assumptions
  );

  const effectiveKarat = purchaseType === 'bullion' ? 24 : karat;

  return (
    <section
      aria-label="Dubai versus India checkout arbitrage calculator"
      className="rounded-xl bg-[#11161e] border border-white/[0.08] p-6 flex flex-col gap-5"
    >
      <div>
        <h2 className="font-display text-base font-semibold text-[#f1f4f8]">
          Dubai vs. India Real Checkout &amp; Arbitrage Calculator
        </h2>
        <p className="text-xs text-[#94a3b8] mt-0.5">
          Compares {effectiveKarat}K total landed checkout including DGJG retail spread, UAE VAT
          refund rules, India {assumptions.indiaDutyPct.toFixed(1)}% customs duty, and 3% GST.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="arb-grams" className="text-xs text-[#cbd5e1] font-medium">
            Weight (Grams)
          </label>
          <input
            id="arb-grams"
            type="number"
            min={0.5}
            step={0.5}
            value={gramsInput}
            onChange={(e) => setGramsInput(e.target.value)}
            className="w-full rounded-lg bg-[#090c10] border border-white/[0.1] px-3 py-2 text-sm font-mono-num text-[#f1f4f8] focus:border-[#e5b842] focus:outline-none"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="arb-making" className="text-xs text-[#cbd5e1] font-medium">
            Making Charge (%)
          </label>
          <input
            id="arb-making"
            type="number"
            min={0}
            max={35}
            step={0.5}
            value={makingInput}
            disabled={purchaseType === 'bullion'}
            onChange={(e) => setMakingInput(e.target.value)}
            className="w-full rounded-lg bg-[#090c10] border border-white/[0.1] px-3 py-2 text-sm font-mono-num text-[#f1f4f8] disabled:opacity-50 focus:border-[#e5b842] focus:outline-none"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="arb-type" className="text-xs text-[#cbd5e1] font-medium">
            Purchase Type
          </label>
          <select
            id="arb-type"
            value={purchaseType}
            onChange={(e) => setPurchaseType(e.target.value as PurchaseType)}
            className="w-full rounded-lg bg-[#090c10] border border-white/[0.1] px-3 py-2 text-sm text-[#f1f4f8] focus:border-[#e5b842] focus:outline-none"
          >
            <option value="jewellery">Jewellery (UAE 5% VAT / IND 3% GST)</option>
            <option value="tourist">Jewellery w/ UAE Tourist VAT Refund</option>
            <option value="bullion">24K Investment Bar (UAE 0% VAT)</option>
          </select>
        </div>
      </div>

      {/* Side-by-side itemized comparison separated by hairline divider */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-white/[0.06]">
        <div>
          <div className="text-xs font-medium text-[#94a3b8]">Dubai Checkout Cost (UAE)</div>
          <div
            className="font-mono-num text-2xl font-bold text-[#f3d06b] mt-1"
            data-testid="arb-uae-total"
          >
            {formatCurrency(arb.uaeTotalAed, 'AED')}
          </div>
          <div className="font-mono-num text-sm text-[#cbd5e1] mt-0.5">
            ≈ {formatCurrency(arb.uaeTotalInr, 'INR')}
          </div>
          <dl className="mt-3 space-y-1 text-xs text-[#94a3b8] font-mono-num">
            <div className="flex justify-between">
              <dt>Gold Value (DGJG)</dt>
              <dd className="text-[#cbd5e1]">{formatCurrency(arb.uaeGoldBaseAed, 'AED')}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Making / Minting</dt>
              <dd className="text-[#cbd5e1]">{formatCurrency(arb.uaeMakingAed, 'AED')}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Net UAE VAT</dt>
              <dd className="text-[#cbd5e1]">{formatCurrency(arb.uaeNetVatAed, 'AED')}</dd>
            </div>
          </dl>
        </div>

        <div className="md:border-l md:border-white/[0.06] md:pl-6">
          <div className="text-xs font-medium text-[#94a3b8]">India Checkout Cost (Domestic)</div>
          <div
            className="font-mono-num text-2xl font-bold text-[#f1f4f8] mt-1"
            data-testid="arb-ind-total"
          >
            {formatCurrency(arb.indTotalInr, 'INR')}
          </div>
          <div className="font-mono-num text-sm text-[#cbd5e1] mt-0.5">
            ≈ {formatCurrency(arb.indTotalAed, 'AED')}
          </div>
          <dl className="mt-3 space-y-1 text-xs text-[#94a3b8] font-mono-num">
            <div className="flex justify-between">
              <dt>Landed Gold ({assumptions.indiaDutyPct.toFixed(1)}% duty)</dt>
              <dd className="text-[#cbd5e1]">{formatCurrency(arb.indGoldLandedInr, 'INR')}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Making / Minting</dt>
              <dd className="text-[#cbd5e1]">{formatCurrency(arb.indMakingInr, 'INR')}</dd>
            </div>
            <div className="flex justify-between">
              <dt>India Retail GST (3%)</dt>
              <dd className="text-[#cbd5e1]">{formatCurrency(arb.indGstInr, 'INR')}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="pt-3 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-[#94a3b8]">Net Arbitrage Spread (before Indian customs baggage rules):</span>
        <span
          data-testid="arb-savings-summary"
          className={`font-mono-num font-semibold ${
            arb.cheaperMarket === 'Dubai'
              ? 'text-[#10b981]'
              : arb.cheaperMarket === 'India'
                ? 'text-[#f3d06b]'
                : 'text-[#cbd5e1]'
          }`}
        >
          {arb.cheaperMarket === 'Dubai'
            ? `Dubai cheaper by ${formatCurrency(arb.savingsInr, 'INR')} (${arb.savingsPct.toFixed(1)}%)`
            : arb.cheaperMarket === 'India'
              ? `India cheaper by ${formatCurrency(-arb.savingsInr, 'INR')}`
              : 'Markets near parity'}
        </span>
      </div>
    </section>
  );
}
