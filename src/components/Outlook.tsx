import type { ReactNode } from 'react';
import type { ForecastResult, RangeForecast, Scorecard } from '../lib/forecast/types';
import { fmtShort } from '../lib/goldPricing';
import { Panel } from './ui';

/* ------------------------------------------------------------------ */
/* Plain-language helpers (no finance words reach the screen).          */
/* ------------------------------------------------------------------ */

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** "1 week", "1 month", "3 months", "10 days" from a calendar-day horizon. */
function horizonLabel(days: number): string {
  if (days >= 28) {
    const m = Math.max(1, Math.round(days / 30));
    return m === 12 ? '1 year' : `${m} month${m === 1 ? '' : 's'}`;
  }
  if (days % 7 === 0) {
    const w = days / 7;
    return `${w} week${w === 1 ? '' : 's'}`;
  }
  return `${days} day${days === 1 ? '' : 's'}`;
}

/** A probability (0..1) as a simple fraction, e.g. 0.68 -> "about 2 times out of 3". */
function chanceWords(p: number): string {
  if (!fin(p) || p <= 0 || p >= 1) return 'most of the time';
  if (Math.abs(p - 0.5) < 0.03) return 'about half the time';
  let best = { k: 1, n: 2, err: Infinity };
  for (let n = 2; n <= 10; n++) {
    const k = Math.round(p * n);
    if (k < 1 || k >= n) continue;
    const err = Math.abs(k / n - p);
    if (err < best.err - 1e-9) best = { k, n, err };
  }
  return `about ${best.k} time${best.k === 1 ? '' : 's'} out of ${best.n}`;
}

/** The chance of landing OUTSIDE a band, as "about 1 time in 20". */
function rareWords(insideProb: number): string {
  const out = 1 - insideProb;
  if (!fin(out) || out <= 0 || out >= 1) return 'rarely';
  return `about 1 time in ${Math.max(2, Math.round(1 / out))}`;
}

/** 0..1 -> "about 6 times out of 10". */
function outOfTen(p: number): string {
  const k = Math.min(10, Math.max(0, Math.round(p * 10)));
  return `about ${k} time${k === 1 ? '' : 's'} out of 10`;
}

const per100 = (p: number) => Math.round(Math.min(1, Math.max(0, p)) * 100);

/** The method name, translated into everyday words. */
function methodInWords(model: string): string[] {
  const m = (model || '').toLowerCase();
  const parts: string[] = [];
  if (m.includes('garch') || m.includes('vol')) parts.push('watching how jumpy the price has been lately');
  if (m.includes('conformal') || m.includes('calibrat')) parts.push('checking itself against real past results');
  return parts;
}

function validRange(r: RangeForecast): boolean {
  return (
    fin(r.days) && r.days > 0 && fin(r.now) && r.now > 0 &&
    fin(r.likelyLow) && fin(r.likelyHigh) && fin(r.extremeLow) && fin(r.extremeHigh) &&
    r.likelyLow < r.likelyHigh && r.extremeLow <= r.likelyLow && r.extremeHigh >= r.likelyHigh
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                               */
/* ------------------------------------------------------------------ */

/**
 * Absolutely positioned label that stays inside its track: at 0% it is left-aligned,
 * at 100% right-aligned, in between it slides proportionally (so it never spills out).
 */
function Pinned({ at, children, className = '' }: { at: number; children: ReactNode; className?: string }) {
  const x = Math.min(100, Math.max(0, at));
  return (
    <div className={`absolute whitespace-nowrap ${className}`} style={{ left: `${x}%`, transform: `translateX(-${x}%)` }}>
      {children}
    </div>
  );
}

/** One price scale shared by every row, so longer horizons visibly get wider ranges. */
interface Scale { min: number; max: number }

function sharedScale(ranges: RangeForecast[]): Scale {
  const lo = Math.min(...ranges.map((r) => Math.min(r.extremeLow, r.now)));
  const hi = Math.max(...ranges.map((r) => Math.max(r.extremeHigh, r.now)));
  const pad = Math.max(hi - lo, 1e-9) * 0.03;
  return { min: lo - pad, max: hi + pad };
}

/**
 * Edge label for the shaded zone: the low price sits just LEFT of the zone, the high price just
 * RIGHT of it, so the two never collide however narrow the zone is. Clamped (by its character
 * count, in a monospace font) so it never spills out of the track.
 */
function EdgeLabel({ at, side, text }: { at: number; side: 'low' | 'high'; text: string }) {
  const x = Math.min(100, Math.max(0, at));
  const n = text.length + 1;
  const style =
    side === 'low'
      ? { right: `max(0px, min(calc(${100 - x}% + 4px), calc(100% - ${n}ch)))` }
      : { left: `max(0px, min(calc(${x}% + 4px), calc(100% - ${n}ch)))` };
  return (
    <div className="absolute top-[42px] whitespace-nowrap font-mono-num text-[12px] leading-none font-semibold text-[#f0cf72]" style={style}>
      {text}
    </div>
  );
}

function RangeCard({ r, toAed, scale }: { r: RangeForecast; toAed: (usd: number) => number; scale: Scale }) {
  const label = horizonLabel(r.days);
  const aed = (usd: number) => `AED ${fmtShort(toAed(usd))}`;
  const lo = aed(r.likelyLow);
  const hi = aed(r.likelyHigh);
  const today = aed(r.now);
  const rareLo = fmtShort(toAed(r.extremeLow));
  const rareHi = fmtShort(toAed(r.extremeHigh));
  const likelyWords = chanceWords(r.likelyProb);
  const rare = rareWords(r.extremeProb);

  const pos = (v: number) => ((v - scale.min) / (scale.max - scale.min)) * 100;
  const zoneL = pos(r.likelyLow);
  const zoneR = pos(r.likelyHigh);
  const nowX = pos(r.now);

  const summary =
    `In ${label}: most likely between ${lo} and ${hi} (${likelyWords}). Today: ${today}. ` +
    `Rarely, ${rare}, it ends outside AED ${rareLo} to ${rareHi}.`;

  return (
    <li className="rounded-[14px] bg-[#0d0c09] border border-white/[0.06] px-4 pt-4 pb-3.5">
      <p className="text-[15px] leading-snug text-[#f4efe6]">
        <span className="font-semibold text-[#fbf7ef]">In {label}:</span>{' '}
        <span className="text-[#a39b8a]">most likely between</span>{' '}
        <span className="font-display font-semibold text-[#f0cf72] text-[1.35rem] whitespace-nowrap">{lo}</span>{' '}
        <span className="text-[#a39b8a]">and</span>{' '}
        <span className="font-display font-semibold text-[#f0cf72] text-[1.35rem] whitespace-nowrap">{hi}</span>
      </p>

      {/* Number line */}
      <div role="img" aria-label={summary} className="mt-3">
        <div aria-hidden className="relative h-[60px] select-none">
          {/* Today label + pin */}
          <Pinned at={nowX} className="top-0 text-[11px] leading-none">
            <span className="font-semibold text-[#fbf7ef]">Today</span>{' '}
            <span className="font-mono-num text-[#a39b8a]">{today}</span>
          </Pinned>
          <div className="absolute z-10 top-[16px] h-[26px] w-[2px] -translate-x-1/2 rounded-full bg-[#fbf7ef]" style={{ left: `${nowX}%` }} />
          <div className="absolute z-10 top-[12px] h-[8px] w-[8px] -translate-x-1/2 rounded-full bg-[#fbf7ef] shadow-[0_0_0_3px_#0d0c09]" style={{ left: `${nowX}%` }} />

          {/* Track: faint = rare territory (outer range), shaded = most likely */}
          <div className="absolute inset-x-0 top-[26px] h-[6px] rounded-full bg-white/[0.05]" />
          <div
            className="absolute top-[26px] h-[6px] rounded-full bg-[#d9a93f]/15"
            style={{ left: `${pos(r.extremeLow)}%`, width: `${Math.max(pos(r.extremeHigh) - pos(r.extremeLow), 0.5)}%` }}
          />
          <div
            className="absolute top-[22px] h-[14px] rounded-full bg-[#d9a93f]/45 border border-[#f0cf72]/70"
            style={{ left: `${zoneL}%`, width: `${Math.max(zoneR - zoneL, 0.5)}%` }}
          />

          {/* Zone edge labels: low on the left of the zone, high on the right */}
          <EdgeLabel at={zoneL} side="low" text={lo} />
          <EdgeLabel at={zoneR} side="high" text={hi} />
        </div>
      </div>

      <p className="mt-1 text-[12px] leading-relaxed text-[#a39b8a]">
        The shaded part is where gold ends up {likelyWords}.{' '}
        <span className="text-[#a39b8a]">
          Rarely ({rare}) it goes outside{' '}
          <span className="font-mono-num text-[#f4efe6] whitespace-nowrap">AED {rareLo} – {rareHi}</span>.
        </span>
      </p>
    </li>
  );
}

function DirectionBox({ direction }: { direction: ForecastResult['direction'] }) {
  const pUp = fin(direction?.probabilityUp) ? Math.min(1, Math.max(0, direction.probabilityUp)) : null;
  const proven = !!direction?.significant && direction.label !== 'none' && pUp !== null;

  if (!proven) {
    return (
      <div className="rounded-[14px] border border-white/[0.06] bg-[#0d0c09] p-4">
        <div className="flex items-center gap-3">
          <span aria-hidden className="coin shrink-0" style={{ width: 26, height: 26 }} />
          <h3 className="font-display text-[1.05rem] font-semibold text-[#fbf7ef]">Up or down? It's a coin flip.</h3>
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-[#a39b8a]">
          {direction?.reason || 'Nobody can reliably tell whether gold goes up or down next, so we do not guess.'}
        </p>
        <p className="mt-2 text-[12px] leading-relaxed text-[#a39b8a]">
          That is why the ranges above stretch both ways from today.
        </p>
      </div>
    );
  }

  const up = direction.label === 'up';
  const p = up ? pUp : 1 - pUp;
  return (
    <div className="rounded-[14px] border border-white/[0.06] bg-[#0d0c09] p-4">
      <h3 className="font-display text-[1.05rem] font-semibold text-[#fbf7ef]">
        Up or down?{' '}
        <span className={up ? 'text-[#6fcf97]' : 'text-[#ef6b6b]'}>
          {up ? 'A little more likely up' : 'A little more likely down'}
        </span>
      </h3>
      <p className="mt-2 text-[13px] leading-relaxed text-[#f4efe6]">
        Over the next month, our tests say gold goes {up ? 'up' : 'down'} {outOfTen(p)}.
      </p>
      {direction.reason && <p className="mt-2 text-[12px] leading-relaxed text-[#a39b8a]">{direction.reason}</p>}
      <p className="mt-2 text-[12px] leading-relaxed text-[#a39b8a]">That still leaves plenty of room for the opposite to happen.</p>
    </div>
  );
}

function ScoreBar({ hit, aim }: { hit: number; aim: number }) {
  return (
    <div aria-hidden className="relative h-[8px] flex-1 min-w-[80px] rounded-full bg-white/[0.08]">
      <div className="absolute inset-y-0 left-0 rounded-full bg-[#d9a93f]/75" style={{ width: `${hit}%` }} />
      <div className="absolute -top-[3px] h-[14px] w-[2px] -translate-x-1/2 rounded-full bg-[#fbf7ef]" style={{ left: `${aim}%` }} />
    </div>
  );
}

function ScorecardBox({ scorecard, ranges }: { scorecard: Scorecard[]; ranges: RangeForecast[] }) {
  const rows = scorecard
    .filter((s) => fin(s.horizonDays) && s.horizonDays > 0 && fin(s.samples) && s.samples > 0 && fin(s.likelyHitRate))
    .sort((a, b) => a.horizonDays - b.horizonDays);
  if (rows.length === 0) return null;

  const aimFor = (days: number) => {
    const r = ranges.find((x) => x.days === days) ?? ranges[0];
    return fin(r?.likelyProb) ? r.likelyProb : null;
  };
  const rareAimFor = (days: number) => {
    const r = ranges.find((x) => x.days === days) ?? ranges[0];
    return fin(r?.extremeProb) ? r.extremeProb : null;
  };

  const lead = rows.find((s) => s.horizonDays === 30) ?? rows[0];
  const leadAim = aimFor(lead.horizonDays);
  const leadRareAim = rareAimFor(lead.horizonDays);

  return (
    <div className="rounded-[14px] border border-white/[0.06] bg-[#0d0c09] p-4">
      <h3 className="font-display text-[1.05rem] font-semibold text-[#fbf7ef]">How often were we right?</h3>
      <p className="mt-2 text-[13px] leading-relaxed text-[#f4efe6]">
        We replayed this on {lead.samples.toLocaleString('en-US')} past days, each time using only prices known on that day.
        For the {horizonLabel(lead.horizonDays).replace(' ', '-').replace(/s$/, '')} range, the price ended inside our "most likely" range{' '}
        <span className="font-semibold text-[#f0cf72]">{per100(lead.likelyHitRate)} times out of 100</span>
        {leadAim !== null && <> (we aim for about {per100(leadAim)})</>}.
        {fin(lead.extremeHitRate) && leadRareAim !== null && (
          <> It stayed inside the wider range {per100(lead.extremeHitRate)} times out of 100 (we aim for about {per100(leadRareAim)}).</>
        )}
      </p>

      <ul className="mt-3 flex flex-col gap-2.5">
        {rows.map((s) => {
          const hit = per100(s.likelyHitRate);
          const aimP = aimFor(s.horizonDays);
          const aim = aimP === null ? null : per100(aimP);
          const name = horizonLabel(s.horizonDays);
          return (
            <li
              key={s.horizonDays}
              className="flex items-center gap-3 text-[12px]"
              aria-label={`${name}: inside the most likely range ${hit} times out of 100${aim !== null ? `, aiming for about ${aim}` : ''}, checked on ${s.samples} past days.`}
            >
              <span className="w-[62px] shrink-0 text-[#a39b8a]">{name}</span>
              {aim !== null ? <ScoreBar hit={hit} aim={aim} /> : <ScoreBar hit={hit} aim={hit} />}
              <span className="shrink-0 text-right font-mono-num text-[#f4efe6] whitespace-nowrap">
                {hit}<span className="text-[#a39b8a]"> of 100</span>
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[11px] leading-relaxed text-[#a39b8a]">
        Gold bar = how often the price ended inside our "most likely" range. White mark = what we aim for. Neighbouring past days share a lot of the same moves, so treat this as a rough check, not a guarantee.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main                                                                 */
/* ------------------------------------------------------------------ */

const TITLE = 'Where could the price be?';

export function Outlook({ result, toAed, unitText }: { result: ForecastResult | null; toAed: (usd: number) => number; unitText: string }) {
  const ranges = (result?.ranges ?? []).filter(validRange).sort((a, b) => a.days - b.days);

  if (!result || ranges.length === 0) {
    return (
      <Panel title={TITLE}>
        <div className="rounded-[14px] border border-white/[0.06] bg-[#0d0c09] p-5 text-center">
          <span aria-hidden className="coin inline-block align-middle" />
          <p className="mt-3 text-[14px] text-[#f4efe6]">Working out the likely price ranges…</p>
          <p className="mt-1 text-[12px] leading-relaxed text-[#a39b8a]">
            This needs gold's past prices. If this message stays, they could not be loaded right now. The live price still works.
          </p>
        </div>
      </Panel>
    );
  }

  const method = methodInWords(result.model);
  const scale = sharedScale(ranges);
  const directionProven = !!result.direction?.significant && result.direction.label !== 'none' && fin(result.direction.probabilityUp);

  return (
    <Panel title={TITLE}>
      <p className="-mt-1 text-[14px] leading-relaxed text-[#a39b8a]">
        Nobody knows the future, but gold usually stays inside these ranges.
        <span className="block text-[12px] mt-0.5">Prices in AED {unitText}.</span>
      </p>

      <ul className="mt-4 flex flex-col gap-3">
        {ranges.map((r) => (
          <RangeCard key={r.days} r={r} toAed={toAed} scale={scale} />
        ))}
      </ul>

      <div className="mt-4 flex flex-col gap-3">
        <DirectionBox direction={result.direction} />
        <ScorecardBox scorecard={result.scorecard ?? []} ranges={ranges} />
      </div>

      <details className="mt-4 group">
        <summary className="cursor-pointer text-[13px] font-semibold text-[#f0cf72] hover:text-[#fbf7ef] list-none [&::-webkit-details-marker]:hidden flex items-center gap-2">
          <span aria-hidden className="inline-block transition-transform group-open:rotate-90">›</span>
          How does this work?
        </summary>
        <div className="mt-2 flex flex-col gap-2 text-[13px] leading-relaxed text-[#a39b8a]">
          <p>
            {method.length > 0
              ? `Our method works by ${method.join(', then ')}.`
              : 'Our method looks only at gold’s real past prices.'}{' '}
            When gold has been calm the ranges get narrower, and when it has been jumpy they get wider.
          </p>
          <p>
            We replay the same method on many past days and stretch or shrink the ranges until they came true about as often as we say.
          </p>
          <p>
            {directionProven
              ? 'These are ranges, not promises: surprise news can push gold outside them, and a lean up or down is only a lean.'
              : 'These are ranges, not promises: surprise news can push gold outside them, and nothing here says which way it will go.'}
          </p>
        </div>
      </details>
    </Panel>
  );
}
