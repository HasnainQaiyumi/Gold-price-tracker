import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { explain, priceFacts, type ThemeLean, type WhyItem } from '../lib/explain';
import type { DailyBar } from '../lib/forecast/types';
import { fmtAed } from '../lib/goldPricing';
import { fetchDollarMove, fetchNews, NEWS_REFRESH_MS, safeUrl, timeAgo, type DollarMove, type Headline } from '../lib/news';
import { useNow } from '../lib/useNow';
import { Panel } from './ui';

interface Props {
  series: DailyBar[] | null;
  spotUsd: number | null;
  toAed: (usd: number) => number;
  unitText: string;
}

type NewsState =
  | { kind: 'loading' }
  | { kind: 'ok'; items: Headline[]; fetchedAt: number; stale: boolean }
  | { kind: 'error' };

const MOOD_COLOR = { up: 'text-[#6fcf97]', down: 'text-[#ef6b6b]', flat: 'text-[#f0cf72]', unknown: 'text-[#a39b8a]' } as const;
const MOOD_ICON = { up: '▲', down: '▼', flat: '●', unknown: '…' } as const;

function SectionTitle({ children }: { children: string }) {
  return <h3 className="text-[11px] uppercase tracking-[0.14em] font-semibold text-[#d9a93f] mb-2">{children}</h3>;
}

function LeanBadge({ lean }: { lean: ThemeLean }) {
  const cfg =
    lean === 'up'
      ? { t: 'usually helps gold', c: 'text-[#6fcf97] border-[#6fcf97]/35 bg-[#6fcf97]/10' }
      : lean === 'down'
        ? { t: 'usually pushes gold down', c: 'text-[#ef6b6b] border-[#ef6b6b]/35 bg-[#ef6b6b]/10' }
        : lean === 'mixed'
          ? { t: 'mixed signals', c: 'text-[#f0cf72] border-[#d9a93f]/35 bg-[#d9a93f]/10' }
          : { t: 'direction unclear', c: 'text-[#a39b8a] border-white/10 bg-white/[0.03]' };
  return <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cfg.c}`}>{cfg.t}</span>;
}

function HeadlineLink({ h, className = '' }: { h: Headline; className?: string }) {
  const href = safeUrl(h.link); // re-checked at render time: only http(s) ever reaches an href
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`hover:text-[#f0cf72] underline decoration-white/15 underline-offset-2 hover:decoration-[#d9a93f]/60 ${className}`}>
      {h.title}
    </a>
  ) : (
    <span className={className}>{h.title}</span>
  );
}

function WhyCard({ w, total }: { w: WhyItem; total: number }) {
  return (
    <li className="rounded-xl bg-[#0d0c09] border border-white/[0.06] p-3.5">
      <div className="flex items-start justify-between gap-3 mb-1.5">
        <span className="font-semibold text-[#fbf7ef] text-[14px] leading-snug">{w.label}</span>
        <LeanBadge lean={w.lean} />
      </div>
      <p className="text-[14px] leading-relaxed text-[#f4efe6]/90">{w.text}</p>
      {w.headlines.length > 0 && (
        <div className="mt-2.5 pt-2.5 border-t border-white/[0.05]">
          <div className="text-[10px] uppercase tracking-[0.12em] text-[#7d7667] mb-1">
            In the news{w.mentions > 0 && total > 0 ? ` · ${w.mentions} of ${total} recent headline${total === 1 ? '' : 's'}` : ''}
          </div>
          <ul className="flex flex-col gap-1">
            {w.headlines.map((h) => (
              <li key={h.title} className="text-[12px] leading-snug text-[#a39b8a]">
                “<HeadlineLink h={h} className="text-[#d8d0c0]" />”{h.source && <span className="text-[#7d7667]"> · {h.source}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {w.fromData && <div className="mt-2 text-[10px] text-[#7d7667]">Based on measured exchange rates, not on headlines.</div>}
    </li>
  );
}

export function WhyGoldMoved({ series, spotUsd, toAed, unitText }: Props) {
  const now = useNow(30_000);
  const [news, setNews] = useState<NewsState>({ kind: 'loading' });
  const [dollar, setDollar] = useState<DollarMove | null>(null);
  const alive = useRef(true);
  const busy = useRef(false);

  const load = useCallback(async (force = false) => {
    if (busy.current) return;
    busy.current = true;
    const [n, d] = await Promise.allSettled([fetchNews(force), fetchDollarMove()]);
    busy.current = false;
    if (!alive.current) return;
    if (n.status === 'fulfilled') setNews({ kind: 'ok', ...n.value });
    else setNews((prev) => (prev.kind === 'ok' ? { ...prev, stale: true } : { kind: 'error' }));
    if (d.status === 'fulfilled') setDollar(d.value);
  }, []);

  useEffect(() => {
    alive.current = true;
    load();
    const t = setInterval(() => load(), NEWS_REFRESH_MS);
    const onVisible = () => document.visibilityState === 'visible' && load(); // served from cache unless 15 min passed
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive.current = false;
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const facts = useMemo(() => priceFacts(series, spotUsd), [series, spotUsd]);
  const fmtPrice = useCallback((usd: number) => `AED ${fmtAed(toAed(usd))} ${unitText}`, [toAed, unitText]);
  const headlines = news.kind === 'ok' ? news.items : null;
  const ex = useMemo(() => explain({ facts, headlines, dollar, nowMs: now, fmtPrice }), [facts, headlines, dollar, now, fmtPrice]);

  const hint =
    news.kind === 'ok'
      ? `news updated ${timeAgo(new Date(news.fetchedAt).toISOString(), now)}${news.stale ? ' · could not refresh' : ''}`
      : news.kind === 'loading'
        ? 'reading the news…'
        : 'news unavailable';

  const latest = headlines ? headlines.slice(0, 6) : [];

  return (
    <Panel title="Why gold moved" hint={hint}>
      <p className={`font-display text-[1.45rem] md:text-[1.7rem] leading-tight font-semibold mb-4 ${MOOD_COLOR[ex.mood]}`}>
        <span aria-hidden className="text-[0.7em] mr-2 align-[0.12em]">{MOOD_ICON[ex.mood]}</span>
        {ex.headline}
      </p>

      <div className="grid gap-6 md:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6 min-w-0">
          <section>
            <SectionTitle>What happened</SectionTitle>
            {ex.happened.length ? (
              <div className="flex flex-col gap-2 max-w-[64ch] text-[15px] leading-relaxed text-[#f4efe6]">
                {ex.happened.map((s) => <p key={s}>{s}</p>)}
                {ex.dollarFact && <p className="text-[#d8d0c0]">{ex.dollarFact}</p>}
              </div>
            ) : (
              <p className="text-[14px] text-[#a39b8a]">Waiting for real price history. Nothing is shown until it arrives.</p>
            )}
          </section>

          <section>
            <SectionTitle>Why (from the latest news)</SectionTitle>
            {news.kind === 'loading' ? (
              <div className="flex flex-col gap-2" aria-busy="true">
                <p className="text-[14px] text-[#a39b8a]">Reading the latest gold news…</p>
                <div className="h-16 rounded-xl bg-[#0d0c09] border border-white/[0.05] animate-pulse motion-reduce:animate-none" />
                <div className="h-16 rounded-xl bg-[#0d0c09] border border-white/[0.05] animate-pulse motion-reduce:animate-none" />
              </div>
            ) : (
              <>
                <p className="text-[14px] leading-relaxed text-[#a39b8a] max-w-[64ch] mb-3">{ex.whyIntro}</p>
                {ex.why.length > 0 && (
                  <ul className="flex flex-col gap-2.5">
                    {ex.why.map((w) => <WhyCard key={`${w.id}-${w.fromData}`} w={w} total={ex.headlineCount} />)}
                  </ul>
                )}
                {news.kind === 'error' && (
                  <button type="button" className="btn-ghost mt-3" onClick={() => load(true)}>Try loading news again</button>
                )}
              </>
            )}
          </section>

          <section>
            <SectionTitle>What could happen next</SectionTitle>
            <div className="grid sm:grid-cols-2 gap-2.5">
              <div className="rounded-xl border border-[#6fcf97]/20 bg-[#6fcf97]/[0.05] p-3.5">
                <div className="text-[12px] font-semibold text-[#6fcf97] mb-1.5"><span aria-hidden>▲ </span>Could push gold up</div>
                <ul className="flex flex-col gap-1.5 text-[14px] leading-relaxed text-[#f4efe6]">
                  {ex.nextUp.map((s) => <li key={s}>{s}</li>)}
                </ul>
              </div>
              <div className="rounded-xl border border-[#ef6b6b]/20 bg-[#ef6b6b]/[0.05] p-3.5">
                <div className="text-[12px] font-semibold text-[#ef6b6b] mb-1.5"><span aria-hidden>▼ </span>Could push gold down</div>
                <ul className="flex flex-col gap-1.5 text-[14px] leading-relaxed text-[#f4efe6]">
                  {ex.nextDown.map((s) => <li key={s}>{s}</li>)}
                </ul>
              </div>
            </div>
            <p className="text-[12px] leading-relaxed text-[#a39b8a] mt-2.5 max-w-[64ch]">{ex.nextNote}</p>
          </section>
        </div>

        <aside className="min-w-0">
          <SectionTitle>Latest gold headlines</SectionTitle>
          {news.kind === 'loading' && <p className="text-[13px] text-[#a39b8a]">Loading…</p>}
          {news.kind === 'error' && <p className="text-[13px] text-[#a39b8a]">Headlines could not be loaded right now. We will try again in a few minutes.</p>}
          {news.kind === 'ok' && latest.length === 0 && <p className="text-[13px] text-[#a39b8a]">No gold headlines from the last 2 days.</p>}
          {latest.length > 0 && (
            <ul className="flex flex-col divide-y divide-white/[0.05]">
              {latest.map((h) => (
                <li key={h.title} className="py-2.5 first:pt-0">
                  <HeadlineLink h={h} className="text-[13.5px] leading-snug text-[#f4efe6]" />
                  <div className="text-[11px] text-[#7d7667] mt-1">
                    {[h.source, timeAgo(h.publishedAt, now)].filter(Boolean).join(' · ')}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      <p className="text-[11px] text-[#7d7667] leading-relaxed mt-5 max-w-[80ch]">
        Headlines from Google News. Dollar figure from European Central Bank exchange rates (via Frankfurter), weighted like the
        US dollar index. Topics are picked by matching words in headlines, so they can be wrong, and being in the news does not
        prove something moved the price. Not financial advice.
      </p>
    </Panel>
  );
}
