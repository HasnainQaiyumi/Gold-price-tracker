import { useEffect, useRef, useState } from 'react';
import type { DailyBar, ImpliedVol } from '../lib/forecast/types';
import type { BacktestRow, Calibration, Claim, ClaimKind } from '../lib/sim/claims';
import type { SimMessage, SimRequest } from '../workers/sim.worker';

interface Props {
  series: DailyBar[] | null;
  spotUsd: number | null;
  toAed: (usd: number) => number;
  unitText: string;
  implied?: ImpliedVol[];
  calib?: Calibration | null;
}

const STANDARD_PATHS = 1_000_000;
const DEEP_PATHS = 10_000_000;
const RERUN_MOVE = 0.0025; // re-run when the live price moves 0.25%
const RERUN_MS = 10 * 60_000; // ...or every 10 minutes

type Result = Extract<SimMessage, { type: 'result' }> & { at: number; spot: number };

const dateIn = (days: number, long = false) =>
  new Date(Date.now() + days * 86400e3).toLocaleDateString('en-GB', { weekday: long ? 'long' : 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Dubai' });

function secondary(c: Claim, money: (usd: number) => string): string {
  switch (c.kind as ClaimKind) {
    case 'floor7': return `Over the next 7 days, gold will not drop below ${money(c.levels[0])} at any point.`;
    case 'floor30': return `Over the next 30 days, gold will not drop below ${money(c.levels[0])} at any point.`;
    case 'ceiling30': return `Over the next 30 days, gold will not rise above ${money(c.levels[0])} at any point.`;
    default: return '';
  }
}

export function TopProbabilities({ series, spotUsd, toAed, unitText, implied, calib }: Props) {
  const worker = useRef<Worker | null>(null);
  const runId = useRef(0);
  const last = useRef<{ spot: number; at: number } | null>(null);
  const [running, setRunning] = useState<{ paths: number; done: number } | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deep, setDeep] = useState(0); // bump to request a 10-million run
  const [, tick] = useState(0);

  useEffect(() => {
    const w = new Worker(new URL('../workers/sim.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = (e: MessageEvent<SimMessage>) => {
      const m = e.data;
      if (m.id !== runId.current) return; // a newer run replaced this one
      if (m.type === 'progress') setRunning((r) => (r ? { ...r, done: m.done } : r));
      else if (m.type === 'error') { setError(m.message); setRunning(null); }
      else { setResult({ ...m, at: Date.now(), spot: last.current?.spot ?? 0 }); setRunning(null); setError(null); }
    };
    const t = setInterval(() => tick((x) => x + 1), 30_000);
    return () => { w.terminate(); worker.current = null; clearInterval(t); };
  }, []);

  const start = (paths: number) => {
    if (!worker.current || !series || !spotUsd) return;
    last.current = { spot: spotUsd, at: Date.now() };
    const id = ++runId.current;
    setRunning({ paths, done: 0 });
    const req: SimRequest = { id, bars: series, spotUsd, paths, implied, calib };
    worker.current.postMessage(req);
  };

  // Real time: run on load, then when the live price moves enough or the result gets old.
  useEffect(() => {
    if (!worker.current || !series || !spotUsd || series.length < 200 || running) return;
    const prev = last.current;
    const due = !prev || Math.abs(spotUsd / prev.spot - 1) >= RERUN_MOVE || Date.now() - prev.at >= RERUN_MS;
    if (due) start(STANDARD_PATHS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, spotUsd, running]);

  useEffect(() => {
    if (deep > 0) start(DEEP_PATHS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deep]);

  const money = (usd: number) => `AED ${toAed(usd).toFixed(2)}`;
  const tested = (k: ClaimKind) => result?.backtest.find((r) => r.kind === k);
  const claim = (k: ClaimKind) => result?.claims.find((c) => c.kind === k);
  const ageMin = result ? Math.round((Date.now() - result.at) / 60000) : 0;

  return (
    <section aria-label="Where gold will be, 99% sure" className="panel">
      <header className="mb-4">
        <h2 className="panel-title text-[1.35rem]">Where gold will be, 99% sure</h2>
        <p className="text-xs text-[#a39b8a] mt-1 max-w-[780px]">
          We simulate {(result?.paths ?? STANDARD_PATHS).toLocaleString('en-US')} possible futures for gold, built from how it has really moved, then check every statement against past prices before showing it. Prices in AED {unitText}.
        </p>
      </header>

      {running && (
        <div className="mb-4" role="status" aria-live="polite">
          <div className="flex justify-between text-[11px] text-[#a39b8a] mb-1">
            <span>{running.done < 0.25 ? 'Checking every statement against past prices…' : `Simulating ${running.paths.toLocaleString('en-US')} futures…`}</span>
            <span className="font-mono-num">{Math.round(running.done * 100)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
            <div className="h-full bg-[#d9a93f] transition-[width] duration-200" style={{ width: `${Math.round(running.done * 100)}%` }} />
          </div>
        </div>
      )}
      {error && <p className="text-sm text-[#ef6b6b]">Could not run the simulation: {error}</p>}

      {result && spotUsd && (
        <div className="flex flex-col gap-5">
          {/* Headline: next week and next month, low and high together */}
          <div className="grid md:grid-cols-2 gap-3">
            {(['week', 'month'] as const).map((k) => {
              const c = claim(k)!, t = tested(k)!;
              const ok = t.checks > 0 && t.held / t.checks >= 0.99;
              return (
                <div key={k} className="rounded-2xl border border-[#6fcf97]/30 bg-gradient-to-b from-[#121a14] to-[#0d0c09] p-5">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-[#6fcf97] font-semibold">
                    {k === 'week' ? 'Next week' : 'Next month'} · {dateIn(c.horizon, true)}
                  </div>
                  <div className="mt-2 text-[15px] text-[#d8d0bf]">Gold will be between</div>
                  <div className="font-display text-[1.7rem] leading-tight font-semibold text-[#fbf7ef]">
                    {money(c.levels[0])} <span className="text-[#8a8374] text-lg">and</span> {money(c.levels[1])}
                  </div>
                  <div className="mt-3 flex items-baseline gap-2">
                    <span className={`font-display text-2xl font-semibold ${ok ? 'text-[#6fcf97]' : 'text-[#f0cf72]'}`}>{(Math.floor((t.held / t.checks) * 1000) / 10).toFixed(1)}%</span>
                    <span className="text-[12px] text-[#a39b8a]">came true on past prices{result.testedFrom ? ` since ${result.testedFrom.slice(0, 4)}` : ''} ({t.held.toLocaleString('en-US')} of {t.checks.toLocaleString('en-US')} checks)</span>
                  </div>
                  <div className="text-[11px] text-[#8a8374] mt-1">Happened in {(c.probability * 100).toFixed(1)}% of the simulated futures.</div>
                </div>
              );
            })}
          </div>

          <FanChart result={result} spotUsd={spotUsd} toAed={toAed} week={claim('week')!} month={claim('month')!} />

          <div className="grid md:grid-cols-2 gap-3">
            <CurveCard title={`Next week · ${dateIn(7)}`} pts={result.curves[7]} spotUsd={spotUsd} toAed={toAed} band={claim('week')!.levels} />
            <CurveCard title={`Next month · ${dateIn(30)}`} pts={result.curves[30]} spotUsd={spotUsd} toAed={toAed} band={claim('month')!.levels} />
          </div>

          <div>
            <h3 className="font-display text-[1.05rem] font-semibold text-[#fbf7ef] mb-2">More things the futures agree on</h3>
            <ul className="flex flex-col gap-2">
              {(['floor7', 'floor30', 'ceiling30'] as const).map((k) => {
                const c = claim(k)!, t = tested(k)!;
                if (!t.checks || t.held / t.checks < 0.95) return null; // hide what the past does not back up
                return (
                  <li key={k} className="flex gap-4 items-baseline rounded-xl bg-[#0d0c09] border border-white/[0.07] px-4 py-3">
                    <span className="shrink-0 w-14 font-display text-xl font-semibold text-[#6fcf97]">{Math.floor((t.held / t.checks) * 100)}%</span>
                    <span className="min-w-0">
                      <span className="text-[15px] text-[#fbf7ef]">{secondary(c, money)}</span>
                      <span className="block text-[11px] text-[#8a8374] mt-0.5">Came true {t.held.toLocaleString('en-US')} of {t.checks.toLocaleString('en-US')} times on past prices{result.testedFrom ? ` since ${result.testedFrom.slice(0, 4)}` : ''}.</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="rounded-xl border border-white/[0.07] bg-[#0d0c09] p-4 text-[13px] leading-relaxed text-[#cfc7b6]">
            <span className="font-semibold text-[#fbf7ef]">Why not a billion futures? </span>
            More futures only make the simulation's own arithmetic steadier, not the prediction more right. With a million, the edges of the 99% ranges move by less than about AED 1 between runs. A billion would shrink that to a few fils, a difference you could not see. What decides accuracy is how well the past describes the future, which is exactly what the checks on past prices measure.
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="button" className="btn-ghost" disabled={!!running} onClick={() => setDeep((d) => d + 1)}>
                Run a deep check with {DEEP_PATHS.toLocaleString('en-US')} futures (about 30 seconds)
              </button>
              <span className="text-[11px] text-[#8a8374]">
                Last run {ageMin < 1 ? 'just now' : `${ageMin} min ago`}: {result.paths.toLocaleString('en-US')} futures in {(result.ms / 1000).toFixed(1)} s · updates when the price moves 0.25% or every 10 minutes
              </span>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function FanChart({ result, spotUsd, toAed, week, month }: { result: Result; spotUsd: number; toAed: (usd: number) => number; week: Claim; month: Claim }) {
  const W = 960, H = 380, L = 70, R = 170, T = 24, B = 38;
  const days = result.fan.length;
  const price = (x: number) => toAed(spotUsd * Math.exp(x));
  const ys = [...result.fan.flatMap((q) => [price(q[0]), price(q[q.length - 1])]), toAed(spotUsd)];
  const yMin = Math.min(...ys), yMax = Math.max(...ys), pad = (yMax - yMin) * 0.05;
  const X = (d: number) => L + (d / days) * (W - L - R);
  const Y = (v: number) => T + (1 - (v - (yMin - pad)) / (yMax + 2 * pad - yMin)) * (H - T - B);
  const now = toAed(spotUsd);
  // fan indexes: 0:0.5% 1:2.5% 2:25% 3:50% 4:75% 5:97.5% 6:99.5%
  const band = (lo: number, hi: number) =>
    [`${X(0)},${Y(now)}`, ...result.fan.map((q, i) => `${X(i + 1).toFixed(1)},${Y(price(q[hi])).toFixed(1)}`), ...result.fan.map((q, i) => `${X(i + 1).toFixed(1)},${Y(price(q[lo])).toFixed(1)}`).reverse()].join(' ');
  const median = [`${X(0)},${Y(now)}`, ...result.fan.map((q, i) => `${X(i + 1).toFixed(1)},${Y(price(q[3])).toFixed(1)}`)].join(' ');
  const ticks = Array.from({ length: 5 }, (_, i) => yMin + ((yMax - yMin) * i) / 4);
  const bracket = (c: Claim, label: string) => {
    const x = X(c.horizon), y1 = Y(toAed(c.levels[1])), y0 = Y(toAed(c.levels[0]));
    return (
      <g>
        <line x1={x} x2={x} y1={y1} y2={y0} stroke="#6fcf97" strokeWidth="3" />
        <line x1={x - 7} x2={x + 7} y1={y1} y2={y1} stroke="#6fcf97" strokeWidth="3" />
        <line x1={x - 7} x2={x + 7} y1={y0} y2={y0} stroke="#6fcf97" strokeWidth="3" />
        <text x={x + 12} y={y1 + 4} fontSize="12" fill="#6fcf97">{toAed(c.levels[1]).toFixed(0)}</text>
        <text x={x + 12} y={y0 + 4} fontSize="12" fill="#6fcf97">{toAed(c.levels[0]).toFixed(0)}</text>
        <text x={x} y={H - B + 18} textAnchor="middle" fontSize="12" fill="#a39b8a">{label}</text>
      </g>
    );
  };
  return (
    <figure className="rounded-2xl bg-[#0d0c09] border border-white/[0.07] p-3 sm:p-4">
      <figcaption className="text-[13px] text-[#d8d0bf] mb-2">
        <span className="font-semibold text-[#fbf7ef]">{result.paths.toLocaleString('en-US')} possible futures for the next 30 days.</span> Darker means more likely. Thin lines are a few of the simulated futures.
      </figcaption>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[620px] h-auto" role="img" aria-label={`Fan chart of simulated gold prices. 99% sure next week between AED ${toAed(week.levels[0]).toFixed(0)} and ${toAed(week.levels[1]).toFixed(0)}, next month between ${toAed(month.levels[0]).toFixed(0)} and ${toAed(month.levels[1]).toFixed(0)}.`}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="#ffffff" strokeOpacity="0.05" />
              <text x={L - 8} y={Y(v) + 4} textAnchor="end" fontSize="11" fill="#8a8374">{v.toFixed(0)}</text>
            </g>
          ))}
          <polygon points={band(0, 6)} fill="#d9a93f" fillOpacity="0.12" />
          <polygon points={band(1, 5)} fill="#d9a93f" fillOpacity="0.16" />
          <polygon points={band(2, 4)} fill="#d9a93f" fillOpacity="0.3" />
          {result.samples.map((s, i) => (
            <polyline key={i} points={[`${X(0)},${Y(now)}`, ...s.map((x, d) => `${X(d + 1).toFixed(1)},${Y(price(x)).toFixed(1)}`)].join(' ')} fill="none" stroke="#f4efe6" strokeOpacity="0.13" strokeWidth="1" />
          ))}
          <polyline points={median} fill="none" stroke="#f0cf72" strokeWidth="2.5" strokeDasharray="7 5" />
          {bracket(week, '1 week')}
          {bracket(month, '1 month')}
          <circle cx={X(0)} cy={Y(now)} r="6" fill="#f0cf72" stroke="#14120e" strokeWidth="2" />
          <text x={X(0) + 10} y={Y(now) - 10} fontSize="12" fontWeight="700" fill="#fbf7ef">Today {now.toFixed(2)}</text>
          <text x={W - R + 40} y={T + 14} fontSize="11" fill="#a39b8a">Shading:</text>
          <rect x={W - R + 40} y={T + 22} width="14" height="10" fill="#d9a93f" fillOpacity="0.42" /><text x={W - R + 60} y={T + 31} fontSize="11" fill="#a39b8a">half of futures</text>
          <rect x={W - R + 40} y={T + 40} width="14" height="10" fill="#d9a93f" fillOpacity="0.28" /><text x={W - R + 60} y={T + 49} fontSize="11" fill="#a39b8a">95% of futures</text>
          <rect x={W - R + 40} y={T + 58} width="14" height="10" fill="#d9a93f" fillOpacity="0.12" /><text x={W - R + 60} y={T + 67} fontSize="11" fill="#a39b8a">99% of futures</text>
          <line x1={W - R + 40} x2={W - R + 54} y1={T + 84} y2={T + 84} stroke="#6fcf97" strokeWidth="3" /><text x={W - R + 60} y={T + 88} fontSize="11" fill="#a39b8a">99% sure range</text>
        </svg>
      </div>
    </figure>
  );
}

function CurveCard({ title, pts, spotUsd, toAed, band }: { title: string; pts: { x: number; p: number }[]; spotUsd: number; toAed: (usd: number) => number; band: number[] }) {
  const W = 460, H = 170, L = 10, R = 10, T = 14, B = 30;
  const price = (x: number) => toAed(spotUsd * Math.exp(x));
  const xs = pts.map((p) => price(p.x));
  const x0 = xs[0], x1 = xs[xs.length - 1];
  const pMax = Math.max(...pts.map((p) => p.p));
  const X = (v: number) => L + ((v - x0) / (x1 - x0)) * (W - L - R);
  const Y = (p: number) => T + (1 - p / pMax) * (H - T - B);
  const area = [`${X(x0)},${Y(0)}`, ...pts.map((p, i) => `${X(xs[i]).toFixed(1)},${Y(p.p).toFixed(1)}`), `${X(x1)},${Y(0)}`].join(' ');
  const lo = toAed(band[0]), hi = toAed(band[1]);
  const peak = xs[pts.reduce((m, p, i) => (p.p > pts[m].p ? i : m), 0)];
  const now = toAed(spotUsd);
  return (
    <figure className="rounded-2xl bg-[#0d0c09] border border-white/[0.07] p-4">
      <figcaption className="text-[13px] text-[#fbf7ef] font-semibold">{title}</figcaption>
      <p className="text-[12px] text-[#a39b8a] mt-0.5">How likely each price is. Most likely around AED {peak.toFixed(0)}; the green part holds 99% of futures.</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto mt-2" role="img" aria-label={`Probability curve, most likely around AED ${peak.toFixed(0)}, 99% between ${lo.toFixed(0)} and ${hi.toFixed(0)}.`}>
        <defs>
          <clipPath id={`clip-${title.length}-${Math.round(lo)}`}>
            <rect x={X(Math.max(lo, x0))} y={0} width={Math.max(0, X(Math.min(hi, x1)) - X(Math.max(lo, x0)))} height={H} />
          </clipPath>
        </defs>
        <polygon points={area} fill="#d9a93f" fillOpacity="0.18" />
        <polygon points={area} fill="#6fcf97" fillOpacity="0.35" clipPath={`url(#clip-${title.length}-${Math.round(lo)})`} />
        <polyline points={pts.map((p, i) => `${X(xs[i]).toFixed(1)},${Y(p.p).toFixed(1)}`).join(' ')} fill="none" stroke="#f0cf72" strokeWidth="2" />
        {now >= x0 && now <= x1 && (
          <g>
            <line x1={X(now)} x2={X(now)} y1={T} y2={H - B} stroke="#fbf7ef" strokeDasharray="4 4" />
            <text x={X(now)} y={T - 2} textAnchor="middle" fontSize="11" fill="#fbf7ef">today</text>
          </g>
        )}
        <text x={X(Math.max(lo, x0))} y={H - 10} textAnchor="start" fontSize="11" fill="#6fcf97">{lo.toFixed(0)}</text>
        <text x={X(Math.min(hi, x1))} y={H - 10} textAnchor="end" fontSize="11" fill="#6fcf97">{hi.toFixed(0)}</text>
      </svg>
    </figure>
  );
}
