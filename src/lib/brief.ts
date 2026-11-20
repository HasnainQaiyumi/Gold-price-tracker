/**
 * The 4-hourly "Why gold moved" brief: one plain paragraph.
 * Built by scripts/news/build-brief.ts (GitHub Actions) and read by the app from ./data/brief.json.
 * An AI model may write the paragraph, but only from the facts and headlines given, and its output
 * is rejected if it contains numbers that are not in those inputs. Otherwise the rule-based text is used.
 */
import type { Explanation, ThemeId } from './explain';
import { LESSONS, type Driver, type Explainer } from './teach';
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
  explainer: Explainer | null; // the teacher-style mid-page explainer
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
  let joined = out.join(' ').replace(/(^| )Measured currency data: /, '$1Currency data shows: ');
  joined = joined.replace(/\b(the )?Fed\b/, (m) => `${m.startsWith('the') ? 'the' : 'The'} Fed (America's central bank, which sets US interest rates)`);
  return joined;
}

/** The source text an AI paragraph is allowed to take numbers and claims from. */
export function factsText(e: Explanation): string {
  return [e.headline, ...e.happened, e.dollarFact ?? '', ...e.why.map((w) => `${w.label}: ${w.text}`), ...e.nextUp, ...e.nextDown]
    .filter(Boolean)
    .join('\n');
}

/** The AI only summarises the NEWS (short version + one summary per detected topic). Teaching text is fixed (teach.ts). */
export function buildPrompt(e: Explanation, headlines: Headline[], nowIso: string): { system: string; user: string } {
  const topics = e.why.slice(0, 3).filter((w) => !w.fromData);
  const system = [
    'You summarise gold news for an ordinary adult in Dubai who has never studied finance. Talk like a friendly teacher: simple, warm, clear, never childish.',
    'Return JSON only, exactly this shape: {"summary": string, "topics": {"<topicId>": string}}.',
    '"summary": 2 or 3 short sentences (30 to 70 words) saying what gold did and the main reasons in the news.',
    'For each topic id given, write 1 or 2 short sentences (15 to 55 words) saying what the news reports about that topic, attributed ("Reports say...", "News outlets say..."). Explain any term in plain words, for example "the Fed, America\'s central bank".',
    'Strict rules: use ONLY facts and numbers from FACTS and HEADLINES; never invent numbers, dates, names or events; never say which way gold will go; no advice to buy or sell; do not copy headlines word for word; short sentences (under 18 words); avoid jargon (no "hawkish", "dovish", "yields", "basis points", "risk-off", "XAU"); no markdown, no links.',
  ].join(' ');
  const hl = headlines
    .slice(0, 12)
    .map((h) => `- ${h.title}${h.source ? ` (${h.source}` : ''}${h.publishedAt ? `${h.source ? ', ' : ' ('}${h.publishedAt.slice(0, 16).replace('T', ' ')} UTC)` : h.source ? ')' : ''}`)
    .join('\n');
  const tp = topics.map((w) => `- ${w.id}: ${LESSONS[w.id].name}. Headlines on it: ${w.headlines.slice(0, 3).map((h) => `"${h.title}"`).join('; ') || '(see list)'}`).join('\n');
  const user = `Current time: ${nowIso}\n\nFACTS (the only numbers you may use):\n${factsText(e)}\n\nTOPICS to summarise (use these ids as keys):\n${tp || '(none)'}\n\nHEADLINES from the last 2 days:\n${hl || '(none available)'}\n\nReturn the JSON now.`;
  return { system, user };
}

export interface AiNews {
  summary: string | null;
  whatHappened: Partial<Record<ThemeId, string>>;
}

/** Parses + validates the AI JSON; every piece must pass the same grounding/simplicity checks, or it is dropped. */
export function parseAiNews(raw: unknown, allowed: string, topicIds: ThemeId[]): AiNews {
  const out: AiNews = { summary: null, whatHappened: {} };
  if (typeof raw !== 'string') return out;
  let j: { summary?: unknown; topics?: Record<string, unknown> };
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    j = JSON.parse(m ? m[0] : raw);
  } catch {
    return out;
  }
  out.summary = validateAiText(j.summary, allowed, 25, 80);
  for (const id of topicIds) {
    const v = validateAiText(j.topics?.[id], allowed, 10, 65);
    if (v) out.whatHappened[id] = v;
  }
  return out;
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
  return validateAiText(raw, allowed, 90, 240);
}

/** Shared checks: length, simple sentences, no jargon/links/advice, every number grounded in `allowed`. */
export function validateAiText(raw: unknown, allowed: string, minWords: number, maxWords: number): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.replace(/\s+/g, ' ').trim().replace(/^["“]|["”]$/g, '');
  const words = text.split(' ').length;
  if (words < minWords || words > maxWords) return null;
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const lens = sentences.map((x) => x.split(' ').length);
  if (Math.max(...lens) > 32 || lens.reduce((a, b) => a + b, 0) / lens.length > 20) return null; // keep it simple
  if (/\b(hawkish|dovish|yields?|basis points|bps|risk-off|risk-on|XAU|tailwinds?|headwinds?)\b/i.test(text)) return null;
  if (/https?:|www\.|[*#`<>{}]|\n/.test(text)) return null;
  // No advice and no predictions, however phrased.
  if (/\b(you should|we recommend|guaranteed|recommend(?:ed|s)?|advis(?:e|ed|es))\b/i.test(text)) return null;
  // Advice = telling the reader to act ("buy gold now", "sell everything today", "time to buy"), not describing what investors did.
  if (/\b(buy|sell|dump|load up on)\s+(?:(?:gold|everything|more|it)\s+)?(now|today|immediately|right away|before)\b/i.test(text)) return null;
  if (/\b(should|must|need to|ought to|time to|good time to|now is the time to|better to)\s+(buy|sell|invest|hold|dump)\b/i.test(text)) return null;
  if (/\bsell everything\b/i.test(text)) return null;
  if (/\bwill\s+(?:surely|definitely|certainly|probably|likely)?\s*(?:rise|fall|drop|double|halve|crash|soar|climb|surge|plunge|go up|go down|rebound|recover)\b/i.test(text)) return null;
  if (/\b(expect(?:s|ed)?|forecasts?|predicts?|predicted|is set to|is poised to|is bound to)\b/i.test(text)) return null;

  const allowedNums = (allowed.match(NUM_RE) ?? []).map(toNum);
  const inFacts = (v: number, tok: string) => allowedNums.some((a) => Math.abs(a - v) <= 0.5 * 10 ** -decimals(tok) + 1e-9);
  for (const m of text.matchAll(NUM_RE)) {
    const tok = m[0];
    const v = toNum(tok);
    const at = m.index ?? 0;
    const before = text.slice(Math.max(0, at - 6), at);
    const after = text.slice(at + tok.length, at + tok.length + 14);
    const marked = /^\s*(%|percent|per ?cent|aed|dirhams?|dollars?|usd|\/oz|an ounce|per gram|a gram|g\b)/i.test(after) || /(aed|usd|\$)\s*$/i.test(before);
    const isYear = !tok.includes('.') && v >= 1900 && v <= 2100 && !marked;
    const isCount = !marked && !tok.includes('.') && Number.isInteger(v) && v <= 100 && /^\s+(days?|weeks?|months?|years?|hours?|reasons?|things?|ways?|times|topics?|countries|banks?)\b/i.test(after);
    if (isCount) continue;
    if (isYear) {
      if (!inFacts(v, tok)) return null; // a year must come from the sources
      continue;
    }
    if (!inFacts(v, tok)) return null; // every price, percentage or other number must be in the facts
  }
  // Direction: a percentage next to "up/rose" must be an up fact; next to "down/fell" a down fact.
  const facts = directionalFacts(allowed);
  for (const m of text.matchAll(/\b(up|rose|risen|gained|higher|climbed|rallied|jumped|down|fell|fallen|dropped|lower|slid|crashed|plunged|declined|lost)\b[^.%]{0,30}?(\d+(?:\.\d+)?)\s*%/gi)) {
    const dir = /^(up|rose|risen|gained|higher|climbed|rallied|jumped)$/i.test(m[1]) ? 'up' : 'down';
    const v = Number(m[2]);
    const known = facts.filter((f) => Math.abs(f.v - v) <= 0.5 * 10 ** -decimals(m[2]) + 1e-9);
    if (known.length && !known.some((f) => f.dir === dir)) return null;
  }
  return text;
}

/** "down 0.9%", "up 2.4%", "2.4% stronger"... from the facts text, as signed facts. */
export function directionalFacts(allowed: string): { v: number; dir: 'up' | 'down' }[] {
  const out: { v: number; dir: 'up' | 'down' }[] = [];
  for (const m of allowed.matchAll(/\b(up|down|rose|fell|higher|lower|above|below)\s+(\d+(?:\.\d+)?)%/gi)) {
    out.push({ v: Number(m[2]), dir: /^(up|rose|higher|above)$/i.test(m[1]) ? 'up' : 'down' });
  }
  for (const m of allowed.matchAll(/(\d+(?:\.\d+)?)%\s+(above|below|stronger|weaker)/gi)) {
    out.push({ v: Number(m[1]), dir: /^(above|stronger)$/i.test(m[2]) ? 'up' : 'down' });
  }
  return out;
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
    explainer: sanitizeExplainer(o.explainer),
  };
}

const txt = (v: unknown, max = 1200) => cleanText(v, max);
const sanitizeHeadlines = (v: unknown, n: number): Headline[] =>
  Array.isArray(v)
    ? v.slice(0, n).flatMap((h) => {
        const r = (h ?? {}) as Record<string, unknown>;
        const title = cleanText(r.title);
        const iso = typeof r.publishedAt === 'string' && !Number.isNaN(Date.parse(r.publishedAt)) ? r.publishedAt : null;
        return title ? [{ title, source: cleanText(r.source, 60), link: safeUrl(r.link), publishedAt: iso }] : [];
      })
    : [];

/** brief.json is fetched by the browser: re-validate every field; icons and names come from our own library. */
export function sanitizeExplainer(raw: unknown): Explainer | null {
  const o = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null;
  if (!o) return null;
  const summary = txt(o.summary), happened = txt(o.happened, 2000), forYou = txt(o.forYou, 2000);
  if (summary.length < 20) return null;
  const drivers = Array.isArray(o.drivers)
    ? o.drivers.slice(0, 3).flatMap((d): Driver[] => {
        const r = (d ?? {}) as Record<string, unknown>;
        const id = typeof r.id === 'string' && r.id in LESSONS ? (r.id as ThemeId) : null;
        if (!id) return [];
        const L = LESSONS[id];
        const direction: Driver['direction'] = r.direction === 'up' || r.direction === 'down' ? r.direction : 'unclear';
        const steps = Array.isArray(r.steps) ? r.steps.slice(0, 8).map((x) => txt(x, 300)).filter(Boolean) : [];
        return [{ id, icon: L.icon, name: L.name, direction, whatHappened: txt(r.whatHappened, 800), steps: steps.length ? steps : direction === 'up' ? L.up : L.down, analogy: txt(r.analogy, 800) || L.analogy, note: txt(r.note, 400) || null, headlines: sanitizeHeadlines(r.headlines, 2) }];
      })
    : [];
  const watch = Array.isArray(o.watch)
    ? o.watch.slice(0, 3).flatMap((w) => {
        const r = (w ?? {}) as Record<string, unknown>;
        const event = txt(r.event, 200), ifUp = txt(r.ifUp, 300), ifDown = txt(r.ifDown, 300);
        return event && ifUp && ifDown ? [{ event, ifUp, ifDown }] : [];
      })
    : [];
  const l = (o.lesson ?? {}) as Record<string, unknown>;
  return { summary, happened, drivers, watch, lesson: { title: txt(l.title, 200), body: txt(l.body, 3000) }, forYou };
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
