/**
 * The 4-hourly "Why gold moved" brief: one plain paragraph.
 * Built by scripts/news/build-brief.ts (GitHub Actions) and read by the app from ./data/brief.json.
 * An AI model may write the paragraph, but only from the facts and headlines given, and its output
 * is rejected if it contains numbers that are not in those inputs. Otherwise the rule-based text is used.
 */
import type { Explanation } from './explain';
import { cleanText, NEWS_MAX_AGE_HOURS, parsePubDate, safeUrl, splitTitle, type Headline } from './news';

export const BRIEF_INTERVAL_HOURS = 4;
export const BRIEF_MAX_AGE_HOURS = 10; // older than this: the app falls back to a live rule-based paragraph

export interface Brief {
  generatedAt: string; // ISO
  nextUpdateAt: string; // ISO (approximate: GitHub schedules can run late)
  paragraph: string;
  source: 'ai' | 'rules';
  model: string | null;
  headlines: Headline[];
}

const firstSentence = (s: string) => (s.match(/^.*?[.!?](\s|$)/)?.[0] ?? s).trim();

/** Deterministic, explanatory one-paragraph summary from the rule-based explanation (fallback, always available). */
export function ruleParagraph(e: Explanation): string {
  const parts: string[] = [e.headline];
  parts.push(...e.happened.slice(0, 2));
  const top = e.why.slice(0, 2);
  if (top.length) {
    const names = top.map((w) => w.label.replace(/\s*\(.*\)$/, '').replace(/^([A-Z])(?=[a-z])/, (c) => c.toLowerCase()));
    parts.push(`Why? Most gold news right now is about ${names.join(' and ')}.`);
    for (const w of top) parts.push(w.text); // what the news says + how it usually affects gold, in plain words
  } else {
    parts.push(e.whyIntro);
  }
  if (e.dollarFact && !top.some((w) => w.id === 'dollar')) parts.push(e.dollarFact);
  if (e.nextUp[0] && e.nextDown[0]) parts.push(`What to watch next: ${e.nextUp[0]} ${e.nextDown[0]}`);
  parts.push('Nobody can know for sure which way gold will go next.');
  return polish(parts.map((p) => p.trim()).filter(Boolean).join(' '));
}

/** Drops repeated sentences, explains "the Fed" on first use, tidies wording. */
export function polish(text: string): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const sent of text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/)) {
    const key = sent.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(sent);
  }
  let joined = out.join(' ').replace(/^Measured currency data: /m, 'Currency data confirms it: ').replace(/ Measured currency data: /, ' Currency data confirms it: ');
  joined = joined.replace(/\b(the )?Fed\b/, (m) => `${m.startsWith('the') ? 'the' : 'The'} Fed (America's central bank, which sets US interest rates)`);
  return joined;
}

/** The source text an AI paragraph is allowed to take numbers and claims from. */
export function factsText(e: Explanation): string {
  return [e.headline, ...e.happened, e.dollarFact ?? '', ...e.why.map((w) => `${w.label}: ${w.text}`), ...e.nextUp, ...e.nextDown]
    .filter(Boolean)
    .join('\n');
}

export function buildPrompt(e: Explanation, headlines: Headline[], nowIso: string): { system: string; user: string } {
  const system = [
    'You explain gold prices to an ordinary adult in Dubai who has never studied finance. Be simple, warm and clear, never childish.',
    'Write ONE paragraph of 140 to 210 words. Use short sentences (under 18 words). Use everyday words.',
    'Follow this order. (1) What gold did: use the numbers given, including the price in AED per gram. (2) Why: for each of the 1 to 3 main reasons in the headlines, say what happened, then explain in plain words why that pushes gold up or down. Explain any term the first time, for example "the Fed, America\'s central bank, which sets US interest rates". Attribute news to reports ("reports say", "news outlets say"). (3) What could happen next: name only upcoming events that appear in the headlines; say what could push gold up and what could push it down. If no event is named, say people are watching US interest rates and the dollar.',
    'Strict rules: use ONLY facts and numbers from the FACTS and HEADLINES given; never invent numbers, dates, names or events; never say which way gold will go; no advice to buy or sell; do not copy headlines word for word; avoid jargon (no "hawkish", "dovish", "yields", "basis points", "risk-off", "XAU"); no lists, no markdown, no links, no greeting.',
  ].join(' ');
  const hl = headlines
    .slice(0, 12)
    .map((h) => `- ${h.title}${h.source ? ` (${h.source}` : ''}${h.publishedAt ? `${h.source ? ', ' : ' ('}${h.publishedAt.slice(0, 16).replace('T', ' ')} UTC)` : h.source ? ')' : ''}`)
    .join('\n');
  const user = `Current time: ${nowIso}\n\nFACTS (the only numbers you may use):\n${factsText(e)}\n\nHEADLINES from the last 2 days:\n${hl || '(none available)'}\n\nWrite the paragraph now.`;
  return { system, user };
}

/** Second AI pass: an independent fact-check of the paragraph against the same sources. */
export function buildVerifyPrompt(paragraph: string, e: Explanation, headlines: Headline[]): { system: string; user: string } {
  const system =
    'You are a strict fact-checker. Check every statement in the PARAGRAPH against the FACTS and HEADLINES. A statement is unsupported if it adds a number, date, name, event, cause or prediction that the sources do not contain, or states a cause more strongly than the headlines do. General explanations of how something usually affects gold (for example why higher interest rates tend to weigh on gold) are allowed. Reply with JSON only: {"supported": true|false, "issues": ["..."]}';
  const hl = headlines.slice(0, 12).map((h) => `- ${h.title}${h.source ? ` (${h.source})` : ''}`).join('\n');
  return { system, user: `FACTS:\n${factsText(e)}\n\nHEADLINES:\n${hl || '(none)'}\n\nPARAGRAPH:\n${paragraph}` };
}

/** Parses the fact-checker reply; anything unclear counts as NOT supported. */
export function parseVerdict(raw: unknown): { supported: boolean; issues: string[] } {
  if (typeof raw !== 'string') return { supported: false, issues: ['no verdict'] };
  const m = raw.match(/\{[\s\S]*\}/);
  try {
    const j = JSON.parse(m ? m[0] : raw) as { supported?: unknown; issues?: unknown };
    const issues = Array.isArray(j.issues) ? j.issues.filter((x): x is string => typeof x === 'string').slice(0, 10) : [];
    return { supported: j.supported === true && issues.length === 0, issues };
  } catch {
    return { supported: false, issues: ['unparseable verdict'] };
  }
}

const NUM_RE = /\d[\d,]*(?:\.\d+)?/g;
const toNum = (s: string) => Number(s.replace(/,/g, ''));
const decimals = (s: string) => (s.includes('.') ? s.split('.')[1].length : 0);

/** Returns the cleaned paragraph, or null if it breaks the rules (then the rule-based text is used). */
export function validateAiParagraph(raw: unknown, allowed: string): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.replace(/\s+/g, ' ').trim().replace(/^["“]|["”]$/g, '');
  const words = text.split(' ').length;
  if (words < 90 || words > 240) return null;
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const lens = sentences.map((x) => x.split(' ').length);
  if (Math.max(...lens) > 32 || lens.reduce((a, b) => a + b, 0) / lens.length > 19) return null; // keep it simple
  if (/\b(hawkish|dovish|yields?|basis points|bps|risk-off|risk-on|XAU|tailwinds?|headwinds?)\b/i.test(text)) return null;
  if (/https?:|www\.|[*#`<>]|\n/.test(text)) return null;
  if (/\b(you should|we recommend|buy now|sell now|guaranteed)\b/i.test(text)) return null;
  const allowedNums = (allowed.match(NUM_RE) ?? []).map(toNum);
  for (const tok of text.match(NUM_RE) ?? []) {
    const v = toNum(tok);
    if (!tok.includes('.') && Number.isInteger(v) && (v <= 100 || (v >= 1900 && v <= 2100))) continue; // counts, days, years
    const tol = 0.5 * 10 ** -decimals(tok) + 1e-9;
    if (!allowedNums.some((a) => Math.abs(a - v) <= tol)) return null;
  }
  return text;
}

/** Validates brief.json fetched by the browser (untrusted file). */
export function sanitizeBrief(raw: unknown): Brief | null {
  const o = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null;
  if (!o) return null;
  const iso = (v: unknown) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);
  const generatedAt = iso(o.generatedAt), nextUpdateAt = iso(o.nextUpdateAt);
  const paragraph = cleanText(o.paragraph, 1500);
  if (!generatedAt || !nextUpdateAt || paragraph.length < 40) return null;
  const headlines: Headline[] = Array.isArray(o.headlines)
    ? o.headlines.slice(0, 8).flatMap((h) => {
        const r = (h ?? {}) as Record<string, unknown>;
        const title = cleanText(r.title);
        return title ? [{ title, source: cleanText(r.source, 60), link: safeUrl(r.link), publishedAt: iso(r.publishedAt) }] : [];
      })
    : [];
  return {
    generatedAt,
    nextUpdateAt,
    paragraph,
    source: o.source === 'ai' ? 'ai' : 'rules',
    model: typeof o.model === 'string' ? cleanText(o.model, 60) : null,
    headlines,
  };
}

/** Direct Google News RSS (server side only; browsers are blocked by CORS). Pure XML parse. */
export function googleNewsRssUrl(q: string): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q).replace(/%20/g, '+')}&hl=en-US&gl=US&ceid=US:en`;
}

export function parseGoogleNewsRss(xml: string, nowMs: number, maxAgeHours = NEWS_MAX_AGE_HOURS): Headline[] {
  const out: Headline[] = [];
  const tag = (block: string, name: string) => block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1] ?? '';
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const raw = cleanText(tag(block, 'title').replace(/^<!\[CDATA\[|\]\]>$/g, ''), 400);
    if (!raw) continue;
    const split = splitTitle(raw);
    const source = cleanText(tag(block, 'source'), 60) || split.source;
    const publishedAt = parsePubDate(tag(block, 'pubDate'));
    if (publishedAt && nowMs - Date.parse(publishedAt) > maxAgeHours * 3600e3) continue;
    out.push({ title: cleanText(split.title), source, link: safeUrl(cleanText(tag(block, 'link'), 2000)), publishedAt });
    if (out.length >= 60) break;
  }
  return out;
}
