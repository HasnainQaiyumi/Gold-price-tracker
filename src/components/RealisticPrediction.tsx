import { useMemo } from 'react';
import { LONG_RUN_GROWTH_PCT_PER_YEAR, realisticPath, trackRecord } from '../lib/forecast/realistic';
import type { DailyBar } from '../lib/forecast/types';
import { Panel } from './ui';

interface Props {
  series: DailyBar[] | null;
  spotUsd: number | null;
  toAed: (usd: number) => number;
  unitText: string;
}

const DAY = 86400e3;
const t = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`);
const PAST_DAYS = 130;
const FUTURE_DAYS = 90;
const LABEL = { 7: '1 week', 30: '1 month', 90: '3 months' } as Record<number, string>;
const aed = (v: number) => `AED ${v >= 1000 ? Math.round(v).toLocaleString('en-US') : v.toFixed(0)}`;
const monthDay = (ymd: string) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export function RealisticPrediction({ series, spotUsd, toAed, unitText }: Props) {
  const data = useMemo(() => {
    if (!series || !spotUsd || series.length < 200) return null;
    const path = realisticPath(series, spotUsd);
    if (!path) return null;
    return { path, calls: trackRecord(series) };
  }, [series, spotUsd]);

  if (!series || !spotUsd || !data) {
    return (
      <Panel title="Where will gold be?">
        <p className="text-sm text-[#a39b8a]">The prediction appears once enough real price history has loaded.</p>
      </Panel>
    );
  }

  const { path, calls } = data;
  const today = series[series.length - 1].date;
  const nowT = t(today);
  const past = series.filter((b) => t(b.date) >= nowT - PAST_DAYS * DAY);

  // ---- scales (display units) ----
  const W = 960, H = 360, L = 14, R = 150, T = 30, B = 40;
  const x0 = nowT - PAST_DAYS * DAY, x1 = nowT + FUTURE_DAYS * DAY;
  const ys = [...past.map((b) => toAed(b.usd)), ...path.flatMap((p) => [toAed(p.lo), toAed(p.hi)]), ...calls.flatMap((c) => [toAed(c.actualUsd), toAed(c.predictedUsd)])];
  const yMin = Math.min(...ys), yMax = Math.max(...ys), pad = (yMax - yMin) * 0.08;
  const X = (ms: number) => L + ((ms - x0) / (x1 - x0)) * (W - L - R);
  const Y = (v: number) => T + (1 - (v - (yMin - pad)) / (yMax + 2 * pad - yMin)) * (H - T - B);

  const now = toAed(spotUsd);
  const pastLine = past.map((b) => `${X(t(b.date)).toFixed(1)},${Y(toAed(b.usd)).toFixed(1)}`).join(' ');
  const band = [{ ms: nowT, lo: now, hi: now }, ...path.map((p) => ({ ms: t(p.date), lo: toAed(p.lo), hi: toAed(p.hi) }))];
  const bandPoly = [...band.map((b) => `${X(b.ms).toFixed(1)},${Y(b.hi).toFixed(1)}`), ...band.slice().reverse().map((b) => `${X(b.ms).toFixed(1)},${Y(b.lo).toFixed(1)}`)].join(' ');
  const last = path[path.length - 1];
  const insideCount = calls.filter((c) => c.inside).length;
  const p30 = path.find((p) => p.days === 30);

  return (
    <section aria-label="Where will gold be" className="panel">
      <header className="mb-3">
        <h2 className="panel-title text-[1.35rem]">Where will gold be?</h2>
        <p className="text-xs text-[#a39b8a] mt-1">One line: our most realistic estimate, in AED {unitText}. Past estimates are shown on the left next to what really happened.</p>
      </header>

      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[620px] h-auto" role="img" aria-label={`Most realistic prediction: about ${aed(now)} in 1 week, 1 month and 3 months.`}>
          <defs>
            <marker id="rp-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="#d9a93f" />
            </marker>
            <marker id="rp-arrow-dim" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="#a39b8a" />
            </marker>
          </defs>
          {/* today divider */}
          <line x1={X(nowT)} x2={X(nowT)} y1={T - 10} y2={H - B} stroke="#7d7667" strokeDasharray="3 4" />
          <text x={X(nowT) - 8} y={H - B + 22} textAnchor="end" fontSize="12" fill="#a39b8a">← what happened</text>
          <text x={X(nowT) + 8} y={H - B + 22} fontSize="12" fill="#a39b8a">most realistic →</text>

          {/* future: faint zone + one line */}
          <polygon points={bandPoly} fill="#d9a93f" fillOpacity="0.08" />
          <line x1={X(nowT)} y1={Y(now)} x2={X(t(last.date))} y2={Y(toAed(last.usd))} stroke="#d9a93f" strokeWidth="3" strokeDasharray="8 6" markerEnd="url(#rp-arrow)" />

          {/* past: actual price */}
          <polyline points={pastLine} fill="none" stroke="#f4efe6" strokeOpacity="0.85" strokeWidth="2" strokeLinejoin="round" />

          {/* past calls: arrow from where we stood to what we said, dot where reality landed */}
          {calls.map((c) => {
            const xa = X(t(c.fromDate)), ya = Y(toAed(c.fromUsd));
            const xb = X(t(c.toDate)), yb = Y(toAed(c.predictedUsd));
            const ok = c.inside;
            return (
              <g key={c.fromDate}>
                <line x1={xa} y1={ya} x2={xb} y2={yb} stroke="#a39b8a" strokeWidth="1.6" strokeDasharray="5 5" markerEnd="url(#rp-arrow-dim)" />
                <line x1={xb} x2={xb} y1={Y(toAed(c.hi))} y2={Y(toAed(c.lo))} stroke="#a39b8a" strokeOpacity="0.35" strokeWidth="6" strokeLinecap="round" />
                <circle cx={xb} cy={Y(toAed(c.actualUsd))} r="6" fill={ok ? '#6fcf97' : '#ef6b6b'} stroke="#14120e" strokeWidth="2" />
                <text x={xb} y={Y(toAed(c.actualUsd)) + (c.actualUsd < c.predictedUsd ? 20 : -12)} textAnchor="middle" fontSize="12" fontWeight="700" fill={ok ? '#6fcf97' : '#ef6b6b'}>
                  {ok ? '✓' : '✗'}
                </text>
              </g>
            );
          })}

          {/* now */}
          <circle cx={X(nowT)} cy={Y(now)} r="7" fill="#f0cf72" stroke="#14120e" strokeWidth="2" />
          <text x={X(nowT) - 12} y={Y(now) + 26} textAnchor="end" fontSize="13" fontWeight="700" fill="#fbf7ef">Current price {aed(now)}</text>

          {/* realistic points */}
          {path.map((p, i) => (
            <g key={p.days}>
              <circle cx={X(t(p.date))} cy={Y(toAed(p.usd))} r="5" fill="#d9a93f" />
              <text x={X(t(p.date)) + (i === path.length - 1 ? 14 : 0)} y={Y(toAed(p.usd)) - 14 - (i === 1 ? 18 : 0)} textAnchor={i === path.length - 1 ? 'start' : 'middle'} fontSize="12" fill="#f0cf72">
                {LABEL[p.days] ?? `${p.days} days`}: {aed(toAed(p.usd))}
              </text>
            </g>
          ))}
        </svg>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-[#a39b8a]">
        <span><span className="text-[#d9a93f]">- - ➜</span> most realistic estimate</span>
        <span><span className="text-[#f4efe6]">━</span> real price</span>
        <span><span className="text-[#a39b8a]">- - ➜</span> what we would have said back then</span>
        <span><span className="text-[#6fcf97]">●</span> real price landed close (within the usual miss) <span className="text-[#ef6b6b] ml-2">●</span> it moved further</span>
      </div>

      <div className="mt-4 grid sm:grid-cols-3 gap-3">
        {path.map((p) => (
          <div key={p.days} className="rounded-2xl bg-[#0d0c09] border border-white/[0.07] p-4">
            <div className="text-[11px] uppercase tracking-[0.12em] text-[#7d7667]">In {LABEL[p.days] ?? `${p.days} days`} · {monthDay(p.date)}</div>
            <div className="font-display text-2xl font-semibold text-[#f0cf72] mt-1">{aed(toAed(p.usd))}</div>
            <div className="text-[12px] text-[#cfc7b6] mt-1">Usually lands within about {p.typicalMissPct.toFixed(0)}% of this, either way.</div>
            <div className="mt-3 pt-3 border-t border-white/[0.07]">
              <div className="text-[11px] uppercase tracking-[0.12em] text-[#6fcf97] font-semibold">99% sure</div>
              <div className="text-[15px] font-semibold text-[#fbf7ef] mt-0.5">
                {aed(toAed(p.sureLo))} to {aed(toAed(p.sureHi))}
              </div>
              <div className="text-[11px] text-[#a39b8a] mt-1">
                {p.sureHitRate !== null
                  ? `Tested on past prices: right ${(p.sureHitRate * 100).toFixed(1)}% of the time.`
                  : 'Not enough past data yet to test this one.'}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 max-w-[860px]">
        <h3 className="font-display text-[1.05rem] font-semibold text-[#fbf7ef] mb-2">Why the most realistic line is so close to today's price</h3>
        <p className="text-[15px] leading-[1.8] text-[#e8e1d2]">
          It may look too simple, but it is the most honest prediction there is. Today's price already includes everything the world knows: interest rates, the dollar, wars, central bank buying. What will move gold next is news that has not happened yet, and nobody can see that coming. We tested every popular method on 55 years of gold prices, including trend rules and machine learning. None of them could reliably say whether gold would be higher or lower a month later, so any line pointing up or down would just be a guess dressed up as science. Over very long periods gold has grown about {LONG_RUN_GROWTH_PCT_PER_YEAR}% a year on average, but that is less than 1% a month, which is tiny next to its normal swings. So the realistic answer is: expect it near {aed(now)}, and expect it to wander{p30 ? ` about ${p30.typicalMissPct.toFixed(0)}% either way over a month` : ''}.
        </p>
        <p className="mt-3 text-[14px] leading-relaxed text-[#cfc7b6]">
          <span className="font-semibold text-[#fbf7ef]">What "99% sure" means. </span>
          Nobody can name the exact future price, but we can name a range we are 99% sure about, and check it. We replayed the method on every day of the last two years, using only the prices known on that day: the real price ended inside the 99% range about 99 times out of 100. The range is wide because gold is swinging a lot right now; when markets calm down, it gets narrower.
        </p>
        {calls.length > 0 && (
          <p className="mt-3 text-[14px] leading-relaxed text-[#cfc7b6]">
            <span className="font-semibold text-[#fbf7ef]">How did this do before? </span>
            We went back to {calls.length} past dates and made the same one-month estimate using only the prices known on that day. The real price landed within the usual miss {insideCount} out of {calls.length} times (the green ticks on the chart). Over many years we aim for about 2 times out of 3. Recent weeks have been unusually wild, so expect misses like the red crosses when big news hits.
          </p>
        )}
      </div>
    </section>
  );
}
