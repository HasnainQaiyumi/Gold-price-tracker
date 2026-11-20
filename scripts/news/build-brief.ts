/**
 * Builds public/data/brief.json (the "Why gold moved" paragraph) during the deploy job,
 * which runs every 4 hours. Uses GitHub Models (free with the repo's GITHUB_TOKEN) to write the
 * paragraph from real facts + headlines; any failure or rule violation falls back to the
 * deterministic rule-based paragraph. Never fails the deploy.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { BRIEF_INTERVAL_HOURS, buildPrompt, buildVerifyPrompt, factsText, googleNewsRssUrl, parseAiNews, parseGoogleNewsRss, parseVerdict, type AiNews, type Brief } from '../../src/lib/brief';
import { buildExplainer, explainerToParagraph } from '../../src/lib/teach';
import { explain, priceFacts } from '../../src/lib/explain';
import { fetchPaxgHistory, fetchSpot } from '../../src/lib/feed';
import { usdOzToAedPerG } from '../../src/lib/goldPricing';
import { fetchDollarMove, mergeHeadlines, NEWS_QUERIES, type Headline } from '../../src/lib/news';

const OUT = 'public/data/brief.json';
const MODEL = process.env.BRIEF_MODEL || 'openai/gpt-4.1-mini';

async function aiCall(system: string, user: string, maxTokens = 600): Promise<string | null> {
  // JSON-mode is requested for the structured call; the fact-check also answers in JSON.
  const token = process.env.GITHUB_TOKEN;
  if (!token) return null;
  const res = await fetch('https://models.github.ai/inference/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ model: MODEL, temperature: 0.2, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) {
    console.log(`ai: HTTP ${res.status}`);
    return null;
  }
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return j.choices?.[0]?.message?.content ?? null;
}

/** Google News RSS read directly (works server side; no CORS, no rate-limited relay). */
async function fetchHeadlines(nowMs: number): Promise<Headline[]> {
  const lists = await Promise.all(
    NEWS_QUERIES.map(async (q) => {
      const res = await fetch(googleNewsRssUrl(q), { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'Mozilla/5.0 (gold-brief)' } });
      if (!res.ok) throw new Error(`news HTTP ${res.status}`);
      return parseGoogleNewsRss(await res.text(), nowMs);
    })
  );
  return mergeHeadlines(...lists);
}

async function main() {
  const now = new Date();
  const [spot, history, news, dollar] = await Promise.all([
    fetchSpot().catch(() => null),
    fetchPaxgHistory().catch(() => null),
    fetchHeadlines(now.getTime()).catch(() => null),
    fetchDollarMove().catch(() => null),
  ]);
  if (!spot || !history) throw new Error('price data unavailable');
  const k = spot.usd / history[history.length - 1].usd;
  const series = history.map((d) => ({ date: d.date, usd: d.usd * k }));
  const facts = priceFacts(series, spot.usd);
  const headlines: Headline[] | null = news;
  const fmtPrice = (usd: number) => `AED ${usdOzToAedPerG(usd).toFixed(2)} per gram of 24K gold`;
  const e = explain({ facts, headlines, dollar, nowMs: now.getTime(), fmtPrice });

  // AI writes only the news summaries; each piece is validated, then the whole set is fact-checked.
  let ai: AiNews | null = null;
  try {
    const { system, user } = buildPrompt(e, headlines ?? [], now.toISOString());
    const topicIds = e.why.slice(0, 3).filter((w) => !w.fromData).map((w) => w.id);
    const parsed = parseAiNews(await aiCall(system, user, 900), factsText(e), topicIds);
    const pieces = [parsed.summary, ...Object.values(parsed.whatHappened)].filter(Boolean).join(' ');
    if (!pieces) {
      console.log('ai: unavailable or every piece rejected by the validator, using rule-based text');
    } else {
      const v = buildVerifyPrompt(pieces, e, headlines ?? []);
      const verdict = parseVerdict(await aiCall(v.system, v.user, 300));
      if (verdict.supported) ai = parsed;
      else console.log(`ai: fact-check failed (${verdict.issues.length} issue(s)), using rule-based text`);
    }
  } catch (err) {
    console.log(`ai: error ${String((err as Error)?.message ?? err).slice(0, 120)}`);
  }
  const explainer = buildExplainer(e, ai, Math.floor(now.getTime() / 86400e3));
  const paragraph = explainerToParagraph(explainer);
  const source: Brief['source'] = ai ? 'ai' : 'rules';

  const brief: Brief = {
    generatedAt: now.toISOString(),
    nextUpdateAt: new Date(now.getTime() + BRIEF_INTERVAL_HOURS * 3600e3).toISOString(),
    paragraph,
    source,
    model: source === 'ai' ? MODEL : null,
    headlines: (headlines ?? []).slice(0, 6),
    explainer,
  };
  mkdirSync('public/data', { recursive: true });
  writeFileSync(OUT, JSON.stringify(brief, null, 1));
  console.log(`brief: ${source}, ${paragraph.split(' ').length} words, ${brief.headlines.length} headlines`);
}

main().catch((e) => {
  // Never block a deploy because of the news brief; the app falls back to a live paragraph.
  console.log(`brief failed: ${String((e as Error)?.message ?? e).slice(0, 200)}`);
});
