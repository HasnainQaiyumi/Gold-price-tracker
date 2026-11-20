import {
  convertUsdOzToMarket,
  formatCurrency,
  getUnitLabel,
} from '../lib/goldPricing';
import type {
  CurrencyCode,
  KaratPurity,
  MarketMode,
  PricingAssumptions,
} from '../lib/types';

interface CurrencyCardsProps {
  spotUsdOz: number;
  change24hPct: number;
  mode: MarketMode;
  karat: KaratPurity;
  unitGrams: number;
  selectedCurrency: CurrencyCode;
  assumptions: PricingAssumptions;
  onSelectCurrency: (currency: CurrencyCode) => void;
}

interface CardConfig {
  currency: CurrencyCode;
  marketName: string;
  benchmarkDesc: string;
  spreadLabel: string;
  spreadValue: string;
  taxLabel: string;
  taxValue: string;
}

export function CurrencyCards({
  spotUsdOz,
  change24hPct,
  mode,
  karat,
  unitGrams,
  selectedCurrency,
  assumptions,
  onSelectCurrency,
}: CurrencyCardsProps) {
  const unitText = `${getUnitLabel(unitGrams)} · ${karat}K`;
  const isUp = change24hPct >= 0;
  const deltaText = `${isUp ? '+' : ''}${change24hPct.toFixed(2)}% 24h`;

  const cards: CardConfig[] = [
    {
      currency: 'USD',
      marketName: 'United States · USD',
      benchmarkDesc: 'COMEX Spot & Physical Dealer',
      spreadLabel: 'Dealer Premium',
      spreadValue: `+${assumptions.usDealerSpreadPct.toFixed(2)}%`,
      taxLabel: 'Federal Duty',
      taxValue: '0% Bullion',
    },
    {
      currency: 'AED',
      marketName: 'Dubai / UAE · AED',
      benchmarkDesc: 'DGJG Gold Souq Retail Board',
      spreadLabel: 'DGJG Spread',
      spreadValue: `+AED ${assumptions.uaeRetailSpreadAedG.toFixed(2)}/g`,
      taxLabel: 'UAE VAT',
      taxValue: '0% Bars / 5% Jewellery',
    },
    {
      currency: 'INR',
      marketName: 'India · INR',
      benchmarkDesc: 'MCX / IBJA Landed + GST',
      spreadLabel: 'Import Duty (BCD+AIDC)',
      spreadValue: `${assumptions.indiaDutyPct.toFixed(1)}%`,
      taxLabel: 'Retail Tax',
      taxValue: `+${assumptions.indiaGstPct.toFixed(1)}% GST`,
    },
  ];

  return (
    <section aria-label="Live Gold Market Prices" className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {cards.map((card) => {
        const displayedPrice = convertUsdOzToMarket(
          spotUsdOz,
          card.currency,
          mode,
          karat,
          unitGrams,
          assumptions
        );
        const rawSpotPrice = convertUsdOzToMarket(
          spotUsdOz,
          card.currency,
          'spot',
          karat,
          unitGrams,
          assumptions
        );
        const isSelected = selectedCurrency === card.currency;

        return (
          <button
            key={card.currency}
            type="button"
            onClick={() => onSelectCurrency(card.currency)}
            aria-pressed={isSelected}
            data-testid={`currency-card-${card.currency}`}
            className={`text-left rounded-xl p-5 transition-all duration-150 cursor-pointer bg-[#11161e] border focus-visible:outline-2 focus-visible:outline-[#e5b842] ${
              isSelected
                ? 'border-[#e5b842] bg-[#141a24]'
                : 'border-white/[0.08] hover:border-white/20'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-sm font-semibold text-[#f1f4f8]">
                  {card.marketName}
                </h2>
                <p className="text-xs text-[#94a3b8] mt-0.5">{card.benchmarkDesc}</p>
              </div>
              <span
                className={`font-mono-num text-xs font-medium whitespace-nowrap ${
                  isUp ? 'text-[#10b981]' : 'text-[#f43f5e]'
                }`}
              >
                {deltaText}
              </span>
            </div>

            <div className="mt-4">
              <div
                className="font-mono-num text-3xl font-bold tracking-tight text-[#f8fafc]"
                data-testid={`price-value-${card.currency}`}
              >
                {formatCurrency(displayedPrice, card.currency)}
              </div>
              <div className="mt-1.5 flex items-center justify-between text-xs text-[#94a3b8] font-mono-num">
                <span>
                  Raw Spot:{' '}
                  <strong className="text-[#cbd5e1] font-medium">
                    {formatCurrency(rawSpotPrice, card.currency)}
                  </strong>
                </span>
                <span>{unitText}</span>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-white/[0.06] grid grid-cols-2 gap-y-1.5 text-xs">
              <span className="text-[#64748b]">{card.spreadLabel}</span>
              <span className="text-right font-mono-num text-[#cbd5e1] font-medium">
                {card.spreadValue}
              </span>
              <span className="text-[#64748b]">{card.taxLabel}</span>
              <span className="text-right font-mono-num text-[#cbd5e1] font-medium">
                {card.taxValue}
              </span>
            </div>
          </button>
        );
      })}
    </section>
  );
}
