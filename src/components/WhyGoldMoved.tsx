import { useEffect, useMemo, useState } from 'react';
import { BRIEF_MAX_AGE_HOURS, ruleParagraph, sanitizeBrief, type Brief } from '../lib/brief';
import { explain, priceFacts } from '../lib/explain';
import type { DailyBar } from '../lib/forecast/types';
import { fetchDollarMove, fetchNews, timeAgo, type DollarMove, type Headline } from '../lib/news';
import { useNow } from '../lib/useNow';
import { Panel } from './ui';

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

/** One plain paragraph about what is moving gold, refreshed every 4 hours by the site's scheduled job. */
export function WhyGoldMoved({ series, spotUsd, toAed, unitText }: Props) {
  const now = useNow(30_000);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [briefChecked, setBriefChecked] = useState(false);
  const [live, setLive] = useState<{ headlines: Headline[] | null; dollar: DollarMove | null } | null>(null);

  // 1) The 4-hourly brief published with the site.
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('./data/brief.json', { cache: 'no-cache' })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => alive && setBrief(sanitizeBrief(j)))
        .catch(() => undefined)
        .finally(() => alive && setBriefChecked(true));
    load();
    const t = setInterval(load, 30 * 60_000); // pick up a new brief without a reload
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const briefFresh = !!brief && now - Date.parse(brief.generatedAt) < BRIEF_MAX_AGE_HOURS * 3600e3;

  // 2) Fallback only when there is no fresh brief: build the same kind of paragraph live in the browser.
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

  const fallbackText = useMemo(() => {
    if (briefFresh || !live || !series) return null;
    const fmtPrice = (usd: number) => `AED ${toAed(usd).toFixed(2)} ${unitText}`;
    return ruleParagraph(explain({ facts: priceFacts(series, spotUsd), headlines: live.headlines, dollar: live.dollar, nowMs: Date.now(), fmtPrice }));
  }, [briefFresh, live, series, spotUsd, toAed, unitText]);

  const paragraph = briefFresh ? brief!.paragraph : fallbackText;
  const headlines = (briefFresh ? brief!.headlines : live?.headlines ?? []).slice(0, 5);

  return (
    <Panel title="Why gold is moving">
      {paragraph ? (
        <p className="text-[15px] md:text-base leading-[1.75] text-[#e8e1d2] max-w-[72ch]">{paragraph}</p>
      ) : (
        <p className="text-sm text-[#a39b8a]">{briefChecked ? 'Reading the latest gold news…' : 'Loading…'}</p>
      )}

      <div className="mt-3 text-[11px] text-[#7d7667] flex flex-wrap gap-x-3 gap-y-1">
        {briefFresh ? (
          <>
            <span>Updated {timeAgo(brief!.generatedAt, now)}</span>
            <span>· next update {untilText(brief!.nextUpdateAt, now)}</span>
            <span>· {brief!.source === 'ai' ? 'AI summary of the headlines below, checked against real price data' : 'Written from the headlines below and real price data'}</span>
          </>
        ) : (
          paragraph && <span>Live summary from the latest headlines and price data</span>
        )}
      </div>

      {headlines.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2 border-t border-white/[0.06] pt-3">
          {headlines.map((h, i) => (
            <li key={`${h.title}-${i}`} className="text-xs leading-snug">
              {h.link ? (
                <a href={h.link} target="_blank" rel="noopener noreferrer" className="text-[#d8d0bf] hover:text-[#f0cf72] underline-offset-2 hover:underline">
                  {h.title}
                </a>
              ) : (
                <span className="text-[#d8d0bf]">{h.title}</span>
              )}
              <span className="text-[#7d7667]">
                {h.source ? ` · ${h.source}` : ''}
                {h.publishedAt ? ` · ${timeAgo(h.publishedAt, now)}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
