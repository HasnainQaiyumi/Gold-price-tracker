import { useMemo } from 'react';
import { cone, dailyVol, VOL_WINDOW } from '../lib/forecastCone';
import { fmtShort } from '../lib/goldPricing';
import type { DailyClose } from '../lib/types';
import { Panel } from './ui';

const HORIZONS = [
  { label: '1 week', days: 7 },
  { label: '1 month', days: 30 },
  { label: '3 months', days: 90 },
];

export function Outlook({ spotUsd, series, toAed, unitText }: { spotUsd: number; series: DailyClose[] | null; toAed: (usd: number) => number; unitText: string }) {
  const rows = useMemo(() => {
    const sigma = series ? dailyVol(series.map((d) => d.usd), VOL_WINDOW) : null;
    return sigma === null ? null : { sigma, cones: HORIZONS.map((h) => cone(spotUsd, sigma, h.days)) };
  }, [series, spotUsd]);

  if (!rows) return <Panel title="Where gold could go"><div className="text-xs text-[#a39b8a]">Needs real price history, unavailable right now.</div></Panel>;

  const lo = Math.min(...rows.cones.map((c) => c.lo95));
  const hi = Math.max(...rows.cones.map((c) => c.hi95));
  const pos = (v: number) => `${(((v - lo) / (hi - lo)) * 100).toFixed(2)}%`;
  const w = (a: number, b: number) => `${(((b - a) / (hi - lo)) * 100).toFixed(2)}%`;
  const pc = (v: number) => {
    const x = (v / spotUsd - 1) * 100;
    return `${x >= 0 ? '+' : ''}${x.toFixed(1)}%`;
  };

  return (
    <Panel title="Where gold could go" hint={`swinging ${(rows.sigma * 100).toFixed(2)}% a day`}>
      <p className="text-xs text-[#a39b8a] mb-4 leading-relaxed">
        How far gold can realistically move from now, in AED {unitText}. This is the size of the likely move, not its direction.
      </p>
      <div className="flex flex-col gap-4">
        {rows.cones.map((c, i) => (
          <div key={c.days}>
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="font-semibold text-[#f4efe6]">{HORIZONS[i].label}</span>
              <span className="font-mono-num text-[#f0cf72] font-semibold">
                {fmtShort(toAed(c.lo68))} – {fmtShort(toAed(c.hi68))}
                <span className="ml-2 text-[#a39b8a] font-normal">{pc(c.lo68)} / {pc(c.hi68)}</span>
              </span>
            </div>
            <div className="relative h-3 mt-1.5 rounded-full bg-[#0d0c09] border border-white/[0.06] overflow-hidden" aria-hidden>
              <div className="absolute inset-y-0 bg-[#d9a93f]/20" style={{ left: pos(c.lo95), width: w(c.lo95, c.hi95) }} />
              <div className="absolute inset-y-0 bg-[#d9a93f]/65" style={{ left: pos(c.lo68), width: w(c.lo68, c.hi68) }} />
              <div className="absolute inset-y-0 w-0.5 bg-[#f4efe6]" style={{ left: pos(spotUsd) }} />
            </div>
            <div className="text-[10px] text-[#7d7667] font-mono-num mt-1">wide range: {fmtShort(toAed(c.lo95))} – {fmtShort(toAed(c.hi95))} ({pc(c.lo95)} / {pc(c.hi95)})</div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-[#7d7667] leading-relaxed mt-4">
        Bright bar: about 2 in 3 chance gold ends inside. Faint bar: about 19 in 20. White line: now. Calibrated on real gold history
        (2025–26), where the wide range held 92–94% of the time. Gold can still break out of any range. Nobody can know the direction.
      </p>
    </Panel>
  );
}
