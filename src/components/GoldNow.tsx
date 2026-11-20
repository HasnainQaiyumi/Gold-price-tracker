import { marketStatus } from '../lib/market';
import { usdOzToAedPerG } from '../lib/goldPricing';
import { useNow } from '../lib/useNow';
import type { Quote } from '../lib/feed';

function ago(sec: number) {
  if (sec < 90) return `${Math.max(0, Math.round(sec))}s ago`;
  if (sec < 5400) return `${Math.round(sec / 60)} min ago`;
  return `${(sec / 3600).toFixed(1)} h ago`;
}

interface Props {
  spot: Quote | null;
  paxg: Quote | null;
  feedOk: boolean;
  prevClose: number | null; // USD/oz, previous UTC day close scaled to spot
  onRefresh: () => void;
}

export function GoldNow({ spot, paxg, feedOk, prevClose, onRefresh }: Props) {
  const now = useNow();
  const mkt = marketStatus(new Date(now));

  if (!spot) {
    return (
      <section className="rounded-xl bg-[#11161e] border border-white/[0.08] p-6">
        <div className="text-sm text-[#94a3b8]">{feedOk ? 'Loading live gold price…' : 'Live gold price unavailable. Check your connection and press Refresh. No price is shown rather than a wrong one.'}</div>
        <button type="button" onClick={onRefresh} className="mt-3 text-xs font-semibold text-[#f3d06b] border border-[#e5b842]/40 rounded-md px-3 py-1.5 cursor-pointer">Refresh</button>
      </section>
    );
  }

  const ageSec = (now - Date.parse(spot.at)) / 1000;
  // On a closed market the provider quote is legitimately old; otherwise judge freshness by age.
  const state = !feedOk ? 'stale' : mkt.open ? (ageSec < 120 ? 'fresh' : ageSec < 600 ? 'aging' : 'stale') : 'closed';
  const dot = { fresh: 'bg-[#10b981]', aging: 'bg-[#f59e0b]', stale: 'bg-[#f43f5e]', closed: 'bg-[#64748b]' }[state];
  const status = {
    fresh: `Live · quote ${ago(ageSec)}`,
    aging: `Delayed · quote ${ago(ageSec)}`,
    stale: `STALE · last quote ${ago(ageSec)}${feedOk ? '' : ' (feed lost)'}`,
    closed: `Market closed · last quote ${ago(ageSec)}`,
  }[state];

  const aed = usdOzToAedPerG(spot.usd);
  const chg = prevClose ? (spot.usd / prevClose - 1) * 100 : null;
  const dev = paxg ? (paxg.usd / spot.usd - 1) * 100 : null;

  return (
    <section aria-label="Gold price now" className="rounded-xl bg-[#11161e] border border-[#e5b842]/30 p-6 flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs text-[#94a3b8]">Gold now · 24K · per gram</div>
          <div className="text-5xl font-bold font-mono-num text-[#f3d06b] tabular-nums">
            AED {aed.toFixed(2)}
          </div>
          <div className="text-sm text-[#cbd5e1] font-mono-num mt-1">
            ${spot.usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / oz
            {chg !== null && (
              <span className={`ml-3 ${chg >= 0 ? 'text-[#10b981]' : 'text-[#f43f5e]'}`}>
                {chg >= 0 ? '▲' : '▼'} {Math.abs(chg).toFixed(2)}% today
              </span>
            )}
          </div>
        </div>
        <div className="text-xs text-right">
          <div className="flex items-center gap-2 justify-end text-[#e2e8f0]">
            <span className={`inline-block w-2 h-2 rounded-full ${dot}`} />
            {status}
          </div>
          <div className="text-[#64748b] mt-1">{mkt.label}</div>
          <button type="button" onClick={onRefresh} className="mt-2 font-semibold text-[#f3d06b] border border-[#e5b842]/40 rounded-md px-3 py-1 cursor-pointer">Refresh now</button>
        </div>
      </div>

      <div className="text-xs text-[#94a3b8] border-t border-white/[0.06] pt-3 leading-relaxed">
        Source: gold-api.com XAU/USD spot, checked every 8s · AED fixed at the official 3.6725 peg.{' '}
        {paxg && dev !== null ? (
          <>
            Cross-check: gold-backed token PAXG trades at ${paxg.usd.toFixed(2)} ({dev >= 0 ? '+' : ''}{dev.toFixed(2)}% vs spot)
            {Math.abs(dev) > 1 ? (
              <span className="text-[#f59e0b]"> — gap above 1%: treat the price with caution.</span>
            ) : (
              <span className="text-[#10b981]"> — agrees.</span>
            )}
            {!mkt.open && ' PAXG trades 24/7, so it shows where gold is moving while spot is closed.'}
          </>
        ) : (
          'Cross-check unavailable right now.'
        )}
        {' '}This is the global spot price. Dubai shop prices add a premium (see "Buy price" below).
      </div>
    </section>
  );
}
