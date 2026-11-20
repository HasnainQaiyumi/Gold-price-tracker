import { useEffect, useMemo, useState } from 'react';
import { BRIEF_MAX_AGE_HOURS, sanitizeBrief, type Brief } from '../lib/brief';
import { explain, priceFacts } from '../lib/explain';
import type { DailyBar } from '../lib/forecast/types';
import { fetchDollarMove, fetchNews, timeAgo, type DollarMove, type Headline } from '../lib/news';
import { buildExplainer, type Driver, type Explainer } from '../lib/teach';
import { useNow } from '../lib/useNow';

interface Props {
  series: DailyBar[] | null;
  spotUsd: number | null;
  toAed: (usd: number) => number;
  unitText: string;
}

function untilText(iso: string, nowMs: number): string {
  const mins = Math.round((Date.parse(iso) - nowMs) / 60000);
  if (mins <= 5) return 'any minute now';
  if (mins < 90) return `in about ${mins} min`;
  return `in about ${Math.round(mins / 60)} h`;
}

const H3 = ({ children }: { children: React.ReactNode }) => (
  <h3 className="font-display text-[1.05rem] font-semibold text-[#fbf7ef] mb-2">{children}</h3>
);

function Sources({ items, now }: { items: Headline[]; now: number }) {
  if (!items.length) return null;
  return (
    <ul className="mt-2 flex flex-col gap-1">
      {items.map((h, i) => (
        <li key={`${h.title}-${i}`} className="text-[11px] leading-snug text-[#7d7667]">
          {h.link ? (
            <a href={h.link} target="_blank" rel="noopener noreferrer" className="text-[#a39b8a] hover:text-[#f0cf72] hover:underline underline-offset-2">
              {h.title}
            </a>
          ) : (
            <span className="text-[#a39b8a]">{h.title}</span>
          )}
          {h.source ? ` · ${h.source}` : ''}
          {h.publishedAt ? ` · ${timeAgo(h.publishedAt, now)}` : ''}
        </li>
      ))}
    </ul>
  );
}

function DriverCard({ d, now }: { d: Driver; now: number }) {
  const badge =
    d.direction === 'up'
      ? { text: '▲ pushing gold up', cls: 'text-[#6fcf97] bg-[#6fcf97]/10 border-[#6fcf97]/30' }
      : d.direction === 'down'
        ? { text: '▼ pushing gold down', cls: 'text-[#ef6b6b] bg-[#ef6b6b]/10 border-[#ef6b6b]/30' }
        : { text: 'direction unclear', cls: 'text-[#a39b8a] bg-white/[0.04] border-white/10' };
  return (
    <article className="rounded-2xl bg-[#0d0c09] border border-white/[0.07] p-4 md:p-5">
      <header className="flex flex-wrap items-center gap-2.5">
        <span className="text-2xl" aria-hidden>{d.icon}</span>
        <h4 className="font-semibold text-[#fbf7ef] text-[15px]">{d.name}</h4>
        <span className={`ml-auto text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${badge.cls}`}>{badge.text}</span>
      </header>

      <p className="mt-3 text-sm leading-relaxed text-[#e8e1d2]">
        <span className="text-[#a39b8a]">In the news: </span>
        {d.whatHappened}
      </p>

      <div className="mt-4">
        <div className="text-[11px] uppercase tracking-[0.12em] text-[#7d7667] mb-2">How it reaches the gold price</div>
        <p className="text-[15px] leading-[1.8] text-[#e8e1d2]">{d.story}</p>
      </div>

      {d.note && (
        <p className="mt-3 text-[13px] leading-relaxed rounded-lg border border-[#f0cf72]/30 bg-[#f0cf72]/[0.06] px-3 py-2 text-[#f0dca4]">
          <span className="font-semibold">But this time: </span>
          {d.note}
        </p>
      )}

      <p className="mt-3 text-[13px] leading-relaxed text-[#cfc7b6] italic">
        <span className="not-italic">💡 </span>
        <span className="not-italic font-semibold text-[#e8e1d2]">Think of it like this: </span>
        {d.analogy}
      </p>

      <Sources items={d.headlines} now={now} />
    </article>
  );
}

/** Mid-page, teacher-style explainer of what is moving gold. Rebuilt every 4 hours by the site's scheduled job. */
export function WhyGoldMoved({ series, spotUsd, toAed, unitText }: Props) {
  const now = useNow(30_000);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [briefChecked, setBriefChecked] = useState(false);
  const [live, setLive] = useState<{ headlines: Headline[] | null; dollar: DollarMove | null } | null>(null);

  // 1) The 4-hourly explainer published with the site.
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('./data/brief.json', { cache: 'no-cache' })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => alive && setBrief(sanitizeBrief(j)))
        .catch(() => undefined)
        .finally(() => alive && setBriefChecked(true));
    load();
    const t = setInterval(load, 30 * 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const briefFresh = !!brief?.explainer && now - Date.parse(brief.generatedAt) < BRIEF_MAX_AGE_HOURS * 3600e3;

  // 2) Fallback only when there is no fresh explainer: build it live in the browser (same fixed teaching text, no AI).
  useEffect(() => {
    if (!briefChecked || briefFresh) return;
    let alive = true;
    Promise.all([fetchNews().catch(() => null), fetchDollarMove().catch(() => null)]).then(([n, d]) => {
      if (alive) setLive({ headlines: n ? n.items : null, dollar: d });
    });
    return () => {
      alive = false;
    };
  }, [briefChecked, briefFresh]);

  const liveExplainer = useMemo<Explainer | null>(() => {
    if (briefFresh || !live || !series) return null;
    const fmtPrice = (usd: number) => `AED ${toAed(usd).toFixed(2)} ${unitText}`;
    const e = explain({ facts: priceFacts(series, spotUsd), headlines: live.headlines, dollar: live.dollar, nowMs: Date.now(), fmtPrice });
    return buildExplainer(e, null, Math.floor(Date.now() / 86400e3));
  }, [briefFresh, live, series, spotUsd, toAed, unitText]);

  const x = briefFresh ? brief!.explainer! : liveExplainer;
  const allHeadlines = briefFresh ? brief!.headlines : live?.headlines ?? [];

  return (
    <section aria-label="Gold explained" className="panel">
      <header className="mb-4">
        <h2 className="panel-title text-[1.35rem]">Gold explained</h2>
        <p className="text-xs text-[#a39b8a] mt-1">What is happening in the world, and how it reaches the gold price. Updated every 8 hours.</p>
      </header>

      {!x ? (
        <p className="text-sm text-[#a39b8a]">{briefChecked ? 'Reading the latest gold news…' : 'Loading…'}</p>
      ) : (
        <div className="flex flex-col gap-6 max-w-[860px]">
          <div className="rounded-2xl border border-[#d9a93f]/35 bg-gradient-to-b from-[#1b170e] to-[#14120e] p-4 md:p-5">
            <div className="text-[11px] uppercase tracking-[0.14em] text-[#d9a93f] font-semibold">The short version</div>
            <p className="mt-2 text-[16px] md:text-[17px] leading-[1.7] text-[#fbf7ef]">{x.summary}</p>
          </div>

          {x.happened && (
            <div>
              <H3>What happened to gold</H3>
              <p className="text-[15px] leading-[1.75] text-[#e8e1d2]">{x.happened}</p>
            </div>
          )}

          {x.drivers.length > 0 && (
            <div>
              <H3>Why it happened, step by step</H3>
              <p className="text-[13px] text-[#a39b8a] mb-3">Nobody can be completely sure what moved the price. These are the topics in the news right now, and how each one usually affects gold.</p>
              <div className="flex flex-col gap-3">
                {x.drivers.map((d) => (
                  <DriverCard key={d.id} d={d} now={now} />
                ))}
              </div>
            </div>
          )}

          {x.watch.length > 0 && (
            <div>
              <H3>What to watch next</H3>
              <div className="grid md:grid-cols-2 gap-3">
                {x.watch.map((w) => (
                  <div key={w.event} className="rounded-2xl bg-[#0d0c09] border border-white/[0.07] p-4">
                    <div className="text-sm font-semibold text-[#fbf7ef]">👀 {w.event}</div>
                    <p className="mt-2 text-[13px] leading-relaxed text-[#6fcf97]">▲ {w.ifUp}</p>
                    <p className="mt-1 text-[13px] leading-relaxed text-[#ef6b6b]">▼ {w.ifDown}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {x.lesson.title && (
            <div className="rounded-2xl border border-white/[0.08] bg-[#0d0c09] p-4 md:p-5">
              <div className="text-[11px] uppercase tracking-[0.14em] text-[#7d7667] font-semibold">📚 Today's lesson</div>
              <h4 className="font-display text-lg font-semibold text-[#f0cf72] mt-1">{x.lesson.title}</h4>
              <p className="mt-2 text-[15px] leading-[1.75] text-[#e8e1d2]">{x.lesson.body}</p>
            </div>
          )}

          {x.forYou && (
            <div>
              <H3>What this means for you</H3>
              <p className="text-[15px] leading-[1.75] text-[#e8e1d2]">{x.forYou}</p>
            </div>
          )}

          <footer className="border-t border-white/[0.06] pt-3 text-[11px] text-[#7d7667] flex flex-col gap-2">
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {briefFresh ? (
                <>
                  <span>Updated {timeAgo(brief!.generatedAt, now)}</span>
                  <span>· next update {untilText(brief!.nextUpdateAt, now)}</span>
                  <span>· {brief!.source === 'ai' ? 'News summaries written by AI from the headlines below and fact-checked; explanations written by us' : 'Written from the headlines below and real price data'}</span>
                </>
              ) : (
                <span>Live version built from the latest headlines and price data</span>
              )}
            </div>
            {allHeadlines.length > 0 && (
              <details>
                <summary className="cursor-pointer text-[#a39b8a] hover:text-[#f0cf72]">All headlines used ({allHeadlines.length})</summary>
                <Sources items={allHeadlines} now={now} />
              </details>
            )}
          </footer>
        </div>
      )}
    </section>
  );
}
