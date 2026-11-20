import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertsAndGithubPanel } from './components/AlertsAndGithubPanel';
import { ArbitrageCalculator } from './components/ArbitrageCalculator';
import { CurrencyCards } from './components/CurrencyCards';
import { ForecastChart } from './components/ForecastChart';
import { MacroSimulator } from './components/MacroSimulator';
import { TopHeader } from './components/TopHeader';
import {
  DEFAULT_ASSUMPTIONS,
  WEIGHT_UNITS,
  convertUsdOzToMarket,
} from './lib/goldPricing';
import { computeQuantForecast, generateFallbackHistory } from './lib/quantForecast';
import type {
  CurrencyCode,
  ForecastHorizon,
  KaratPurity,
  MacroScenarioInput,
  MarketDataPayload,
  MarketMode,
  NavSection,
  PriceAlert,
} from './lib/types';

const ALERTS_STORAGE_KEY = 'aureus_bullion_alerts_v1';

const FALLBACK_MARKET: MarketDataPayload = {
  spotUsdOz: 3535.0,
  usdAed: 3.6725,
  usdInr: 93.15,
  isLiveSpot: false,
  isLiveFx: false,
  isLiveMacro: false,
  updatedAt: new Date().toISOString(),
  history30d: generateFallbackHistory(3535.0),
  macro: {
    realYield10y: 2.12,
    breakevenInfl: 2.28,
    dxy: 105.4,
    gvz: 19.2,
    cotMmNetPctOi: 22.4,
    brentUsd: 74.5,
    change24hPct: -0.42,
  },
};

const PURITIES: KaratPurity[] = [24, 22, 21, 18];

export default function App() {
  const [activeSection, setActiveSection] = useState<NavSection>('overview');
  const [marketData, setMarketData] = useState<MarketDataPayload>(FALLBACK_MARKET);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncError, setSyncError] = useState<string>('');

  const [mode, setMode] = useState<MarketMode>('actual');
  const [karat, setKarat] = useState<KaratPurity>(24);
  const [unitGrams, setUnitGrams] = useState<number>(1);
  const [selectedCurrency, setSelectedCurrency] = useState<CurrencyCode>('INR');
  const [horizon, setHorizon] = useState<ForecastHorizon>(30);

  const [scenario, setScenario] = useState<MacroScenarioInput>({
    yieldBps: 0,
    dxyPct: 0,
    geoPct: 0,
    indiaDutyPct: DEFAULT_ASSUMPTIONS.indiaDutyPct,
  });

  const [alerts, setAlerts] = useState<PriceAlert[]>(() => {
    try {
      const raw = localStorage.getItem(ALERTS_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as PriceAlert[]) : [];
    } catch {
      return [];
    }
  });

  const assumptions = useMemo(
    () => ({
      ...DEFAULT_ASSUMPTIONS,
      usdAed: marketData.usdAed,
      usdInr: marketData.usdInr,
      indiaDutyPct: scenario.indiaDutyPct,
    }),
    [marketData.usdAed, marketData.usdInr, scenario.indiaDutyPct]
  );

  const syncMarket = useCallback(async (force = false) => {
    setIsSyncing(true);
    setSyncError('');
    try {
      const res = await fetch(`/api/market-data${force ? '?force=1' : ''}`, {
        cache: 'no-store',
      });
      if (res.ok) {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const payload = (await res.json()) as MarketDataPayload;
          setMarketData(payload);
          return;
        }
      }
    } catch {
      // Static hosting path (e.g. GitHub Pages): fetch client-side live quotes + scheduled ML JSON
    }

    try {
      const [goldRes, fxRes, mlRes] = await Promise.all([
        fetch('https://api.gold-api.com/price/XAU', { cache: 'no-store' }).catch(() => null),
        fetch('https://open.er-api.com/v6/latest/USD', { cache: 'no-store' }).catch(() => null),
        fetch('./data/forecast_latest.json', { cache: 'no-store' }).catch(() => null),
      ]);

      let spotUsdOz = FALLBACK_MARKET.spotUsdOz;
      let isLiveSpot = false;
      if (goldRes && goldRes.ok) {
        const g = (await goldRes.json()) as { price?: number };
        if (typeof g.price === 'number' && g.price > 500) {
          spotUsdOz = g.price;
          isLiveSpot = true;
        }
      }

      let usdAed = FALLBACK_MARKET.usdAed;
      let usdInr = FALLBACK_MARKET.usdInr;
      let isLiveFx = false;
      if (fxRes && fxRes.ok) {
        const fx = (await fxRes.json()) as { rates?: { AED?: number; INR?: number } };
        if (fx.rates?.INR && fx.rates.INR > 40) {
          usdInr = fx.rates.INR;
          isLiveFx = true;
        }
        if (fx.rates?.AED && fx.rates.AED > 3) {
          usdAed = fx.rates.AED;
        }
      }

      let history30d = generateFallbackHistory(spotUsdOz);
      let macro = FALLBACK_MARKET.macro;
      let isLiveMacro = false;

      if (mlRes && mlRes.ok) {
        const ml = (await mlRes.json()) as {
          history_30d_ratios?: Array<{ dateLabel: string; mult: number }>;
          macro?: MarketDataPayload['macro'];
        };
        if (Array.isArray(ml.history_30d_ratios) && ml.history_30d_ratios.length >= 20) {
          history30d = ml.history_30d_ratios.map((pt) => ({
            dateLabel: pt.dateLabel,
            usdOz: Number((spotUsdOz * pt.mult).toFixed(2)),
          }));
        }
        if (ml.macro) {
          macro = ml.macro;
          isLiveMacro = true;
        }
      }

      if (!isLiveSpot && !isLiveFx && !isLiveMacro) {
        setSyncError('Live feed unavailable — using cached market baseline.');
      }

      setMarketData({
        spotUsdOz,
        usdAed,
        usdInr,
        isLiveSpot,
        isLiveFx,
        isLiveMacro,
        updatedAt: new Date().toISOString(),
        history30d,
        macro,
      });
    } catch {
      setSyncError('Live feed unavailable — using cached market baseline.');
    } finally {
      setIsSyncing(false);
    }
  }, []);

  useEffect(() => {
    syncMarket(false);
    const interval = setInterval(() => syncMarket(false), 30_000);
    return () => clearInterval(interval);
  }, [syncMarket]);

  // Evaluate armed alerts whenever spot/FX/duty updates
  useEffect(() => {
    setAlerts((prev) => {
      let changed = false;
      const next = prev.map((a) => {
        const livePrice = convertUsdOzToMarket(
          marketData.spotUsdOz,
          a.currency,
          a.mode,
          a.karat,
          a.unitGrams,
          assumptions
        );
        const hit =
          a.condition === 'below'
            ? livePrice <= a.targetPrice
            : livePrice >= a.targetPrice;
        if (hit && !a.triggered) {
          changed = true;
          return { ...a, triggered: true };
        }
        return a;
      });
      if (changed) {
        try {
          localStorage.setItem(ALERTS_STORAGE_KEY, JSON.stringify(next));
        } catch {
          // ignore storage quota errors
        }
      }
      return changed ? next : prev;
    });
  }, [marketData.spotUsdOz, assumptions]);

  const saveAlerts = (next: PriceAlert[]) => {
    setAlerts(next);
    try {
      localStorage.setItem(ALERTS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const handleAddAlert = (targetPrice: number, condition: 'below' | 'above') => {
    const livePrice = convertUsdOzToMarket(
      marketData.spotUsdOz,
      selectedCurrency,
      mode,
      karat,
      unitGrams,
      assumptions
    );
    const triggered =
      condition === 'below' ? livePrice <= targetPrice : livePrice >= targetPrice;

    const newAlert: PriceAlert = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      currency: selectedCurrency,
      karat,
      unitGrams,
      mode,
      targetPrice,
      condition,
      createdAt: new Date().toISOString(),
      triggered,
    };
    saveAlerts([newAlert, ...alerts]);
  };

  const handleDeleteAlert = (id: string) => {
    saveAlerts(alerts.filter((a) => a.id !== id));
  };

  const quant = useMemo(
    () =>
      computeQuantForecast({
        history30d: marketData.history30d,
        currency: selectedCurrency,
        mode,
        karat,
        unitGrams,
        horizonDays: horizon,
        assumptions,
        scenario,
        macro: marketData.macro,
      }),
    [marketData, selectedCurrency, mode, karat, unitGrams, horizon, assumptions, scenario]
  );

  const handleDownloadSnapshotJson = () => {
    const snapshot = {
      exportedAt: new Date().toISOString(),
      spotUsdOz: marketData.spotUsdOz,
      usdAed: marketData.usdAed,
      usdInr: marketData.usdInr,
      selectedCurrency,
      mode,
      karat,
      unitGrams,
      horizon,
      macro: marketData.macro,
      forecastEnd: quant.end,
      drivers: quant.drivers,
    };
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aureus-forecast-${selectedCurrency.toLowerCase()}-${horizon}d.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const feedStatusText = marketData.isLiveSpot && marketData.isLiveFx
    ? 'Live Spot & FX Feed'
    : marketData.isLiveSpot
      ? 'Live Gold Spot · Cached FX'
      : 'Market Snapshot Baseline';

  return (
    <div className="min-h-screen bg-[#090c10] text-[#f1f4f8] flex flex-col">
      <TopHeader
        activeSection={activeSection}
        onSelectSection={setActiveSection}
        onSyncFeed={() => syncMarket(true)}
        isSyncing={isSyncing}
      />

      <main className="flex-1 max-w-[1380px] w-full mx-auto px-6 py-6 flex flex-col gap-6">
        {/* Clean unboxed market telemetry summary line + workspace controls */}
        <section
          aria-label="Market controls and spot rates"
          className="flex flex-col gap-4"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tight text-[#f8fafc] text-balance">
                Global &amp; Local Gold Market Terminal
              </h1>
              <p className="text-xs text-[#94a3b8] mt-1 font-mono-num">
                XAU/USD ${marketData.spotUsdOz.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/oz
                {' · '}USD/AED {marketData.usdAed.toFixed(4)}
                {' · '}USD/INR ₹{marketData.usdInr.toFixed(2)}
                {' · '}AED/INR ₹{(marketData.usdInr / marketData.usdAed).toFixed(2)}
                {' · '}
                {syncError || feedStatusText}
              </p>
            </div>
          </div>

          {/* Interactive Segmented Filters */}
          <div className="rounded-xl bg-[#11161e] border border-white/[0.08] px-4 py-3 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs font-medium text-[#94a3b8] whitespace-nowrap">
                Market Layer
              </span>
              <div
                role="group"
                aria-label="Market layer"
                className="inline-flex bg-[#090c10] border border-white/[0.08] rounded-lg p-1 gap-1"
              >
                <button
                  type="button"
                  onClick={() => setMode('actual')}
                  aria-pressed={mode === 'actual'}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    mode === 'actual'
                      ? 'bg-[#e5b842]/20 text-[#f3d06b] border border-[#e5b842]/40'
                      : 'text-[#94a3b8] hover:text-[#f1f4f8] border border-transparent'
                  }`}
                >
                  Actual Local Market
                </button>
                <button
                  type="button"
                  onClick={() => setMode('spot')}
                  aria-pressed={mode === 'spot'}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    mode === 'spot'
                      ? 'bg-[#e5b842]/20 text-[#f3d06b] border border-[#e5b842]/40'
                      : 'text-[#94a3b8] hover:text-[#f1f4f8] border border-transparent'
                  }`}
                >
                  Raw Global Spot
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs font-medium text-[#94a3b8] whitespace-nowrap">
                Purity
              </span>
              <div
                role="group"
                aria-label="Gold purity"
                className="inline-flex bg-[#090c10] border border-white/[0.08] rounded-lg p-1 gap-1"
              >
                {PURITIES.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setKarat(p)}
                    aria-pressed={karat === p}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      karat === p
                        ? 'bg-[#e5b842]/20 text-[#f3d06b] border border-[#e5b842]/40'
                        : 'text-[#94a3b8] hover:text-[#f1f4f8] border border-transparent'
                    }`}
                  >
                    {p}K
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs font-medium text-[#94a3b8] whitespace-nowrap">
                Weight
              </span>
              <div
                role="group"
                aria-label="Weight unit"
                className="inline-flex bg-[#090c10] border border-white/[0.08] rounded-lg p-1 gap-1"
              >
                {WEIGHT_UNITS.map((u) => (
                  <button
                    key={u.label}
                    type="button"
                    onClick={() => setUnitGrams(u.grams)}
                    aria-pressed={Math.abs(unitGrams - u.grams) < 0.001}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      Math.abs(unitGrams - u.grams) < 0.001
                        ? 'bg-[#e5b842]/20 text-[#f3d06b] border border-[#e5b842]/40'
                        : 'text-[#94a3b8] hover:text-[#f1f4f8] border border-transparent'
                    }`}
                  >
                    {u.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Flagship USD / AED / INR Cards */}
        <CurrencyCards
          spotUsdOz={marketData.spotUsdOz}
          change24hPct={marketData.macro.change24hPct}
          mode={mode}
          karat={karat}
          unitGrams={unitGrams}
          selectedCurrency={selectedCurrency}
          assumptions={assumptions}
          onSelectCurrency={setSelectedCurrency}
        />

        {/* Conditional / Focused Workspace Views */}
        {(activeSection === 'overview' || activeSection === 'model') && (
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
            <div className="xl:col-span-7 flex flex-col gap-4">
              <ForecastChart
                currency={selectedCurrency}
                mode={mode}
                karat={karat}
                unitGrams={unitGrams}
                horizon={horizon}
                onChangeHorizon={setHorizon}
                history30d={marketData.history30d}
                quant={quant}
              />

              {/* Model Feature Importance & Macro Drivers Table */}
              <section className="rounded-xl bg-[#11161e] border border-white/[0.08] p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
                  <h2 className="font-display text-sm font-semibold text-[#f1f4f8]">
                    Quantile Ensemble Feature Drivers
                  </h2>
                  <span className="text-xs text-[#94a3b8] font-mono-num">
                    GVZ Implied Vol {marketData.macro.gvz.toFixed(1)}% · Breakeven{' '}
                    {marketData.macro.breakevenInfl.toFixed(2)}% · DXY {marketData.macro.dxy.toFixed(2)}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead>
                      <tr className="border-b border-white/[0.08] text-[#94a3b8]">
                        <th className="py-2 font-medium">Macro / Market Factor</th>
                        <th className="py-2 font-medium text-right">Model Weight</th>
                        <th className="py-2 font-medium text-right">Current Signal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.05]">
                      {quant.drivers.map((d) => (
                        <tr key={d.feature} className="hover:bg-white/[0.02]">
                          <td className="py-2.5 text-[#cbd5e1]">{d.feature}</td>
                          <td className="py-2.5 text-right font-mono-num text-[#f1f4f8]">
                            {d.impactWeightPct}%
                          </td>
                          <td
                            className={`py-2.5 text-right font-medium ${
                              d.direction === 'Bullish'
                                ? 'text-[#10b981]'
                                : d.direction === 'Bearish'
                                  ? 'text-[#f43f5e]'
                                  : 'text-[#94a3b8]'
                            }`}
                          >
                            {d.direction}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            <div className="xl:col-span-5">
              <MacroSimulator
                currency={selectedCurrency}
                horizon={horizon}
                quant={quant}
                macro={marketData.macro}
                scenario={scenario}
                onChangeScenario={setScenario}
                onResetScenario={() =>
                  setScenario({
                    yieldBps: 0,
                    dxyPct: 0,
                    geoPct: 0,
                    indiaDutyPct: DEFAULT_ASSUMPTIONS.indiaDutyPct,
                  })
                }
              />
            </div>
          </div>
        )}

        {(activeSection === 'overview' || activeSection === 'arbitrage') && (
          <ArbitrageCalculator
            spotUsdOz={marketData.spotUsdOz}
            karat={karat}
            assumptions={assumptions}
          />
        )}

        {(activeSection === 'overview' || activeSection === 'alerts') && (
          <AlertsAndGithubPanel
            currency={selectedCurrency}
            karat={karat}
            unitGrams={unitGrams}
            mode={mode}
            currentPrice={quant.current}
            alerts={alerts}
            onAddAlert={handleAddAlert}
            onDeleteAlert={handleDeleteAlert}
            onDownloadSnapshotJson={handleDownloadSnapshotJson}
          />
        )}
      </main>

      <footer className="border-t border-white/[0.06] py-5 px-6 text-center text-xs text-[#64748b]">
        Live quotes synced via Gold-API, ExchangeRate-API, FRED (DFII10/DGS10), and CFTC COT.
        Quantile projections are analytical estimates, not investment advice.
      </footer>
    </div>
  );
}
