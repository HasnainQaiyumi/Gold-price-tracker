export type CurrencyCode = 'USD' | 'AED' | 'INR';
export type MarketMode = 'actual' | 'spot';
export type KaratPurity = 24 | 22 | 21 | 18;
export type ForecastHorizon = 7 | 30 | 90;
export type PurchaseType = 'jewellery' | 'tourist' | 'bullion';
export type NavSection = 'overview' | 'arbitrage' | 'model' | 'alerts';

export interface HistoryPoint {
  dateLabel: string;
  usdOz: number;
}

export interface MarketMacroTelemetry {
  realYield10y: number;
  breakevenInfl: number;
  dxy: number;
  gvz: number;
  cotMmNetPctOi: number;
  brentUsd: number;
  change24hPct: number;
}

export interface MarketDataPayload {
  spotUsdOz: number;
  usdAed: number;
  usdInr: number;
  isLiveSpot: boolean;
  isLiveFx: boolean;
  isLiveMacro: boolean;
  updatedAt: string;
  history30d: HistoryPoint[];
  macro: MarketMacroTelemetry;
}

export interface PricingAssumptions {
  usdAed: number;
  usdInr: number;
  indiaDutyPct: number;
  indiaGstPct: number;
  uaeRetailSpreadAedG: number;
  usDealerSpreadPct: number;
}

export interface MacroScenarioInput {
  yieldBps: number;
  dxyPct: number;
  geoPct: number;
  indiaDutyPct: number;
}

export interface ForecastStep {
  label: string;
  daysOut: number;
  p10: number;
  p50: number;
  p90: number;
}

export interface FeatureDriver {
  feature: string;
  impactWeightPct: number;
  direction: 'Bullish' | 'Bearish' | 'Neutral';
}

export interface QuantForecastResult {
  series: number[];
  ema20: number[];
  forecast: ForecastStep[];
  current: number;
  end: ForecastStep;
  rsi14: number;
  annVolPct: number;
  support: number;
  resistance: number;
  signalLabel: 'Bullish Bias' | 'Bearish Bias' | 'Mean-Reversion';
  p50ChangePct: number;
  p10ChangePct: number;
  p90ChangePct: number;
  inRCurrencyDriftPct: number;
  drivers: FeatureDriver[];
}

export interface ArbitrageBreakdown {
  uaeGoldBaseAed: number;
  uaeMakingAed: number;
  uaeNetVatAed: number;
  uaeTotalAed: number;
  uaeTotalInr: number;
  indGoldLandedInr: number;
  indMakingInr: number;
  indGstInr: number;
  indTotalInr: number;
  indTotalAed: number;
  savingsInr: number;
  savingsPct: number;
  cheaperMarket: 'Dubai' | 'India' | 'Parity';
}

export interface PriceAlert {
  id: string;
  currency: CurrencyCode;
  karat: KaratPurity;
  unitGrams: number;
  mode: MarketMode;
  targetPrice: number;
  condition: 'below' | 'above';
  createdAt: string;
  triggered: boolean;
}
