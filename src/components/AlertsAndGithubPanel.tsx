import { useState } from 'react';
import { formatCurrency, getUnitLabel } from '../lib/goldPricing';
import type {
  CurrencyCode,
  KaratPurity,
  MarketMode,
  PriceAlert,
} from '../lib/types';

interface AlertsAndGithubPanelProps {
  currency: CurrencyCode;
  karat: KaratPurity;
  unitGrams: number;
  mode: MarketMode;
  currentPrice: number;
  alerts: PriceAlert[];
  onAddAlert: (targetPrice: number, condition: 'below' | 'above') => void;
  onDeleteAlert: (id: string) => void;
  onDownloadSnapshotJson: () => void;
}

const GITHUB_WORKFLOW_SNIPPET = `name: Train ML & Deploy to GitHub Pages
on:
  push:
    branches: ["main"]
  schedule:
    - cron: "0 2,14 * * *"
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
          cache: "pip"
          cache-dependency-path: "backend/requirements.txt"
      - run: pip install -r backend/requirements.txt
      - run: |
          python backend/train_model.py
          python backend/export_static.py
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"
      - run: npm ci && npm run build
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: "dist"
  deploy:
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4`;

export function AlertsAndGithubPanel({
  currency,
  karat,
  unitGrams,
  mode,
  currentPrice,
  alerts,
  onAddAlert,
  onDeleteAlert,
  onDownloadSnapshotJson,
}: AlertsAndGithubPanelProps) {
  const [targetInput, setTargetInput] = useState<string>('');
  const [condition, setCondition] = useState<'below' | 'above'>('below');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Number(targetInput);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setErrorMsg('Enter a valid positive target price.');
      return;
    }
    setErrorMsg('');
    onAddAlert(parsed, condition);
    setTargetInput('');
  };

  const handleCopyWorkflow = async () => {
    try {
      await navigator.clipboard.writeText(GITHUB_WORKFLOW_SNIPPET);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Target Price Alert Manager */}
      <section className="rounded-xl bg-[#11161e] border border-white/[0.08] p-6 flex flex-col gap-4">
        <div>
          <h2 className="font-display text-base font-semibold text-[#f1f4f8]">
            Watchlist Target Price Alerts
          </h2>
          <p className="text-xs text-[#94a3b8] mt-0.5">
            Active benchmark: {currency} · {getUnitLabel(unitGrams)} · {karat}K (
            {mode === 'actual' ? 'Actual Market' : 'Raw Spot'}) — currently{' '}
            <span className="font-mono-num text-[#f1f4f8]">
              {formatCurrency(currentPrice, currency)}
            </span>
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-wrap sm:flex-nowrap items-end gap-3">
          <div className="flex flex-col gap-1 flex-1 min-w-[140px]">
            <label htmlFor="alert-target-input" className="text-xs text-[#cbd5e1]">
              Target Price ({currency})
            </label>
            <input
              id="alert-target-input"
              type="number"
              step="any"
              placeholder={Math.round(currentPrice * 0.98).toString()}
              value={targetInput}
              onChange={(e) => setTargetInput(e.target.value)}
              className="w-full rounded-lg bg-[#090c10] border border-white/[0.1] px-3 py-2 text-sm font-mono-num text-[#f1f4f8] focus:border-[#e5b842] focus:outline-none"
            />
          </div>

          <div className="flex flex-col gap-1 w-32">
            <label htmlFor="alert-condition" className="text-xs text-[#cbd5e1]">
              Trigger When
            </label>
            <select
              id="alert-condition"
              value={condition}
              onChange={(e) => setCondition(e.target.value as 'below' | 'above')}
              className="w-full rounded-lg bg-[#090c10] border border-white/[0.1] px-3 py-2 text-sm text-[#f1f4f8] focus:border-[#e5b842] focus:outline-none"
            >
              <option value="below">Drops ≤</option>
              <option value="above">Rises ≥</option>
            </select>
          </div>

          <button
            type="submit"
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#e5b842] text-[#090c10] hover:bg-[#f3d06b] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Arm Alert
          </button>
        </form>

        {errorMsg && (
          <p role="alert" className="text-xs text-[#f43f5e]">
            {errorMsg}
          </p>
        )}

        <div className="pt-3 border-t border-white/[0.06] flex flex-col gap-2">
          {alerts.length === 0 ? (
            <p className="text-xs text-[#64748b]">
              No active price alerts. Arm a target price above to monitor live market ticks.
            </p>
          ) : (
            <ul className="divide-y divide-white/[0.06]" data-testid="alerts-list">
              {alerts.map((alert) => (
                <li
                  key={alert.id}
                  className="py-2.5 flex items-center justify-between gap-3 text-xs"
                >
                  <div>
                    <div className="font-mono-num text-[#f1f4f8] font-medium">
                      {alert.currency} {alert.condition === 'below' ? '≤' : '≥'}{' '}
                      {formatCurrency(alert.targetPrice, alert.currency)}
                    </div>
                    <div className="text-[#94a3b8] mt-0.5">
                      {getUnitLabel(alert.unitGrams)} · {alert.karat}K ·{' '}
                      {alert.mode === 'actual' ? 'Actual' : 'Spot'} ·{' '}
                      <span className={alert.triggered ? 'text-[#10b981] font-semibold' : ''}>
                        {alert.triggered ? 'Target Reached' : 'Watching'}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onDeleteAlert(alert.id)}
                    aria-label={`Remove alert for ${formatCurrency(alert.targetPrice, alert.currency)}`}
                    className="text-xs text-[#94a3b8] hover:text-[#f43f5e] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* GitHub Hosting & Snapshot Export */}
      <section className="rounded-xl bg-[#11161e] border border-white/[0.08] p-6 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-semibold text-[#f1f4f8]">
              GitHub Hosting &amp; Portable Snapshot
            </h2>
            <p className="text-xs text-[#94a3b8] mt-0.5">
              Deploy to GitHub Pages or export the current calibrated market &amp; forecast JSON.
            </p>
          </div>
          <button
            type="button"
            onClick={onDownloadSnapshotJson}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-white/[0.12] text-[#f1f4f8] hover:border-[#e5b842] hover:text-[#f3d06b] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Download JSON
          </button>
        </div>

        <div className="text-xs text-[#cbd5e1] leading-relaxed space-y-2">
          <p>
            1. Push this repository to GitHub (<code className="font-mono-num text-[#f3d06b]">main</code>{' '}
            branch).
          </p>
          <p>
            2. Add <code className="font-mono-num text-[#f3d06b]">.github/workflows/deploy.yml</code>{' '}
            below and enable <strong>Settings → Pages → Source: GitHub Actions</strong>.
          </p>
        </div>

        <div className="relative">
          <pre className="rounded-lg bg-[#090c10] border border-white/[0.06] p-3 text-[11px] font-mono-num text-[#94a3b8] overflow-x-auto max-h-44">
            <code>{GITHUB_WORKFLOW_SNIPPET}</code>
          </pre>
          <button
            type="button"
            onClick={handleCopyWorkflow}
            className="absolute top-2.5 right-2.5 px-2.5 py-1 text-[11px] font-medium rounded bg-[#1a2230] text-[#f1f4f8] hover:text-[#f3d06b] border border-white/[0.08] cursor-pointer"
          >
            {copied ? 'Copied' : 'Copy YAML'}
          </button>
        </div>
      </section>
    </div>
  );
}
