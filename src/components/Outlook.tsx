import { useMemo } from 'react';
import { cone, dailyVol, VOL_WINDOW } from '../lib/forecastCone';
import { usdOzToAedPerG } from '../lib/goldPricing';
import type { DailyClose } from '../lib/types';

const HORIZONS = [
  { label: '1 week', days: 7 },
  { label: '1 month', days: 30 },
  { label: '3 months', days: 90 },
];

export function Outlook({ spotUsd, series }: { spotUsd: number; series: DailyClose[] | null }) {
  const rows = useMemo(() => {
    const sigma = series ? dailyVol(series.map((d) => d.usd), VOL_WINDOW) : null;
    return sigma === null ? null : { sigma, cones: HORIZONS.map((h) => cone(spotUsd, sigma, h.days)) };
  }, [series, spotUsd]);

  if (!rows) {
    return (
      <section className="rounded-xl bg-[#11161e] border border-white/[0.08] p-5 text-xs text-[#94a3b8]">
        Outlook needs real price history, which is unavailable right now.
      </section>
    );
  }

  const lo = Math.min(...rows.cones.map((c) => c.lo95));
  const hi = Math.max(...rows.cones.map((c) => c.hi95));
  const pos = (v: number) => `${(((v - lo) / (hi - lo)) * 100).toFixed(2)}%`;
  const w = (a: number, b: number) => `${(((b - a) / (hi - lo)) * 100).toFixed(2)}%`;
  const g = usdOzToAedPerG;
  const pc = (v: number) => {
    const x = (v / spotUsd - 1) * 100;
    return `${x >= 0 ? '+' : ''}${x.toFixed(1)}%`;
  };

  return (
    <section aria-label="Where gold could go" className="rounded-xl bg-[#11161e] border border-white/[0.08] p-5 flex flex-col gap-4">
      <div>
        <h2 className="font-display text-lg font-bold text-[#f8fafc]">Where gold could go</h2>
        <p className="text-xs text-[#94a3b8] mt-1">
          How far gold can realistically move from AED {g(spotUsd).toFixed(2)}/g, based on how much it has been swinging
          lately ({(rows.sigma * 100).toFixed(2)}% per day). It shows the size of the likely move, not its direction.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {rows.cones.map((c, i) => (
          <div key={c.days} className="grid grid-cols-1 md:grid-cols-[90px_1fr_300px] gap-2 md:gap-4 items-center text-xs">
            <div className="font-semibold text-[#e2e8f0]">{HORIZONS[i].label}</div>
            <div className="relative h-5 rounded bg-[#090c10] border border-white/[0.06]" aria-hidden>
              <div className="absolute top-0 bottom-0 bg-[#e5b842]/20" style={{ left: pos(c.lo95), width: w(c.lo95, c.hi95) }} />
              <div className="absolute top-0 bottom-0 bg-[#e5b842]/55" style={{ left: pos(c.lo68), width: w(c.lo68, c.hi68) }} />
              <div className="absolute -top-0.5 -bottom-0.5 w-0.5 bg-[#f8fafc]" style={{ left: pos(spotUsd) }} />
            </div>
            <div className="font-mono-num text-[#cbd5e1]">
              <span className="text-[#f3d06b] font-semibold">
                AED {g(c.lo68).toFixed(0)}–{g(c.hi68).toFixed(0)}
              </span>{' '}
              <span className="text-[#94a3b8]">({pc(c.lo68)} to {pc(c.hi68)})</span>
              <div className="text-[#64748b]">wide: {g(c.lo95).toFixed(0)}–{g(c.hi95).toFixed(0)} ({pc(c.lo95)} to {pc(c.hi95)})</div>
            </div>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-[#64748b] leading-relaxed">
        Bright bar: about 2 in 3 chance gold ends inside it. Faint bar: about 19 in 20. White line: today. Calibrated by
        back-testing on real gold history (2025–26), where the wide range held 92–94% of the time. Gold can still break
        out of any range, and these odds come from a limited sample. Nobody can know where gold goes; use this for sizing
        risk, not for timing.
      </p>
    </section>
  );
}
