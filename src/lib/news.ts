/**
 * External text sources for the "Why gold moved" section:
 *  - Google News RSS (via rss2json) for recent gold headlines
 *  - Frankfurter (ECB reference rates) for a US-dollar index proxy
 *
 * Everything that touches untrusted input is a pure function (parse / sanitize / maths) so it can be
 * unit-tested without a network. The fetchers are thin wrappers with an in-memory cache.
 */

// ---------------------------------------------------------------------------------------------------------------
// Sanitisation
// ---------------------------------------------------------------------------------------------------------------

export const MAX_TITLE = 180;
export const MAX_SOURCE = 60;
export const MAX_URL = 2000;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', middot: '·', bull: '•',
  copy: '©', reg: '®', trade: '™', euro: '€', pound: '£', yen: '¥', cent: '¢', deg: '°', times: '×',
};

/** Decode HTML entities (named subset, decimal and hex). Unknown entities are left as-is. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z][a-z0-9]{1,8});/gi, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '';
      return String.fromCodePoint(code);
    }
    const v = NAMED_ENTITIES[body.toLowerCase()];
    return v ?? m;
  });
}

const stripTags = (s: string) =>
  s
    .replace(/<(script|style|iframe|object|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(script|style|iframe|object|noscript|template)\b[^>]*>[\s\S]*$/gi, ' ') // unterminated block
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/?[a-z!][^>]*>/gi, ' ');

/**
 * Turn untrusted HTML-ish text into short plain text: drops script/style blocks and all tags, decodes entities
 * (then strips any tags the decoding revealed), removes control characters, collapses whitespace, caps length.
 */
export function cleanText(raw: unknown, max = MAX_TITLE): string {
  if (typeof raw !== 'string') return '';
  let s = raw.length > 20000 ? raw.slice(0, 20000) : raw;
  s = stripTags(s);
  s = decodeEntities(s);
  s = stripTags(s);
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > max) {
    const cut = s.slice(0, max - 1);
    const sp = cut.lastIndexOf(' ');
    s = `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.\-–—]+$/, '')}…`;
  }
  return s;
}

/** Only absolute http(s) URLs survive; anything else (javascript:, data:, relative, malformed) becomes null. */
export function safeUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > MAX_URL) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    return u.href;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// News
// ---------------------------------------------------------------------------------------------------------------

export interface Headline {
  title: string; // plain text, without the trailing " - Source"
  source: string; // publisher name ('' if unknown)
  link: string | null; // http(s) only
  publishedAt: string | null; // ISO-8601 UTC
}

/** rss2json pubDate is 'YYYY-MM-DD HH:MM:SS' in UTC. Also accepts ISO / RFC-2822 strings. */
export function parsePubDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  const t = m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)) : Date.parse(s);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  if (m && (d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3])) return null; // e.g. 2026-02-31
  return d.toISOString();
}

/** Google News titles end with " - Publisher". Split it off (only the last separator). */
export function splitTitle(title: string): { title: string; source: string } {
  const i = title.lastIndexOf(' - ');
  if (i > 0 && title.length - i - 3 > 0 && title.length - i - 3 <= MAX_SOURCE) {
    return { title: title.slice(0, i).trim(), source: title.slice(i + 3).trim() };
  }
  return { title, source: '' };
}

const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export interface NewsParse {
  ok: boolean;
  items: Headline[];
  error?: string;
}

/**
 * Parse one rss2json response. Never throws. Items are sanitised, deduplicated, newest first, and anything
 * older than `maxAgeHours` (relative to `nowMs`) or dated in the future (>1h) is dropped.
 */
export function parseRss2Json(json: unknown, nowMs: number, maxAgeHours = 72): NewsParse {
  if (!json || typeof json !== 'object') return { ok: false, items: [], error: 'empty response' };
  const j = json as { status?: unknown; message?: unknown; items?: unknown };
  if (j.status !== 'ok') return { ok: false, items: [], error: cleanText(j.message, 160) || 'news service error' };
  if (!Array.isArray(j.items)) return { ok: false, items: [], error: 'no items' };
  const out: Headline[] = [];
  for (const it of j.items.slice(0, 100)) {
    if (!it || typeof it !== 'object') continue;
    const r = it as Record<string, unknown>;
    const full = cleanText(r.title, 400);
    if (!full) continue;
    const split = splitTitle(full);
    const title = cleanText(split.title, MAX_TITLE);
    if (title.length < 8) continue;
    const source = cleanText(split.source || r.author, MAX_SOURCE);
    const publishedAt = parsePubDate(r.pubDate);
    if (publishedAt) {
      const t = Date.parse(publishedAt);
      if (t > nowMs + 3600_000 || nowMs - t > maxAgeHours * 3600_000) continue;
    }
    out.push({ title, source, link: safeUrl(r.link), publishedAt });
  }
  return { ok: true, items: mergeHeadlines(out) };
}

/** Deduplicate by normalised title (keeping the newest copy) and sort newest first; undated go last. */
export function mergeHeadlines(...lists: Headline[][]): Headline[] {
  const byKey = new Map<string, Headline>();
  for (const h of lists.flat()) {
    const k = normKey(h.title);
    if (!k) continue;
    const prev = byKey.get(k);
    if (!prev || (h.publishedAt ?? '') > (prev.publishedAt ?? '')) byKey.set(k, h);
  }
  return [...byKey.values()].sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
}

/** "just now", "12 min ago", "3 h ago", "2 days ago". */
export function timeAgo(iso: string | null, nowMs: number): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const sec = Math.max(0, (nowMs - t) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} h ago`;
  const d = Math.floor(sec / 86400);
  return d === 1 ? '1 day ago' : `${d} days ago`;
}

// ---------------------------------------------------------------------------------------------------------------
// US dollar index proxy (ICE DXY formula on ECB reference rates)
// ---------------------------------------------------------------------------------------------------------------

/**
 * DXY = 50.14348112 · EURUSD^-0.576 · USDJPY^0.136 · GBPUSD^-0.119 · USDCAD^0.091 · USDSEK^0.042 · USDCHF^0.036.
 * With base=USD quotes (units of foreign currency per 1 USD) every exponent becomes positive:
 * EURUSD^-0.576 = (EUR per USD)^0.576, and the same for GBP.
 */
export const DXY_WEIGHTS = { EUR: 0.576, JPY: 0.136, GBP: 0.119, CAD: 0.091, SEK: 0.042, CHF: 0.036 } as const;
export const DXY_CONST = 50.14348112;
export type DxyCcy = keyof typeof DXY_WEIGHTS;
export const DXY_SYMBOLS = Object.keys(DXY_WEIGHTS).join(',');

export interface FxDay {
  date: string; // YYYY-MM-DD (ECB fixing date)
  rates: Record<DxyCcy, number>; // foreign currency per 1 USD
}

/** Parse a Frankfurter response (base USD). Null unless every DXY currency has a sane positive rate. */
export function parseFrankfurter(json: unknown): FxDay | null {
  if (!json || typeof json !== 'object') return null;
  const j = json as { base?: unknown; date?: unknown; rates?: unknown };
  if (j.base !== undefined && j.base !== 'USD') return null;
  if (typeof j.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(j.date)) return null;
  if (!j.rates || typeof j.rates !== 'object') return null;
  const src = j.rates as Record<string, unknown>;
  const rates = {} as Record<DxyCcy, number>;
  for (const c of Object.keys(DXY_WEIGHTS) as DxyCcy[]) {
    const v = src[c];
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 1e5) return null;
    rates[c] = v;
  }
  return { date: j.date, rates };
}

/** Geometric DXY-weighted dollar index from base-USD rates. */
export function dxyProxy(rates: Record<DxyCcy, number>): number {
  let x = DXY_CONST;
  for (const c of Object.keys(DXY_WEIGHTS) as DxyCcy[]) x *= rates[c] ** DXY_WEIGHTS[c];
  return x;
}

export interface DollarMove {
  fromDate: string;
  toDate: string;
  from: number; // index level
  to: number;
  pct: number; // % change of the index (positive = stronger dollar)
}

export function dollarMove(then: FxDay, now: FxDay): DollarMove | null {
  if (then.date >= now.date) return null;
  const a = dxyProxy(then.rates);
  const b = dxyProxy(now.rates);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0) return null;
  return { fromDate: then.date, toDate: now.date, from: a, to: b, pct: (b / a - 1) * 100 };
}

/** YYYY-MM-DD minus n calendar days. */
export function minusDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------------------------------------------
// Network (browser). Keyless endpoints only.
// ---------------------------------------------------------------------------------------------------------------

export const NEWS_REFRESH_MS = 15 * 60_000;

/** At most two distinct feeds (rss2json's free tier limits new feeds). The second is only used to top up. */
export const NEWS_QUERIES = ['gold price when:2d', 'gold (Fed OR dollar OR "central bank") when:2d'] as const;

export function googleNewsUrl(q: string): string {
  const rss = `https://news.google.com/rss/search?q=${encodeURIComponent(q).replace(/%20/g, '+')}&hl=en-US&gl=US&ceid=US:en`;
  return `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rss)}`;
}

async function getJson(url: string, timeoutMs = 9000): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export interface NewsResult {
  items: Headline[];
  fetchedAt: number; // ms epoch of the last successful fetch
  stale: boolean; // true if the latest attempt failed and this is the cached copy
}

let newsCache: { items: Headline[]; at: number } | null = null;
let newsInFlight: Promise<NewsResult> | null = null;

/** Fetch recent gold headlines. Cached for 15 min; on failure returns the last good result (stale) or throws. */
export function fetchNews(force = false): Promise<NewsResult> {
  const now = Date.now();
  if (!force && newsCache && now - newsCache.at < NEWS_REFRESH_MS - 5000) {
    return Promise.resolve({ items: newsCache.items, fetchedAt: newsCache.at, stale: false });
  }
  if (newsInFlight) return newsInFlight;
  newsInFlight = (async () => {
    try {
      let items: Headline[] = [];
      let lastErr = 'news unavailable';
      let anyOk = false;
      for (const q of NEWS_QUERIES) {
        try {
          const r = parseRss2Json(await getJson(googleNewsUrl(q)), Date.now());
          if (r.ok) {
            anyOk = true;
            items = mergeHeadlines(items, r.items);
          } else lastErr = r.error ?? lastErr;
        } catch (e) {
          lastErr = e instanceof Error ? e.message : lastErr;
        }
        if (items.length >= 12) break; // enough; spare the rate limit
      }
      if (!anyOk) throw new Error(lastErr);
      newsCache = { items: items.slice(0, 40), at: Date.now() };
      return { items: newsCache.items, fetchedAt: newsCache.at, stale: false };
    } catch (e) {
      if (newsCache) return { items: newsCache.items, fetchedAt: newsCache.at, stale: true };
      throw e;
    } finally {
      newsInFlight = null;
    }
  })();
  return newsInFlight;
}

let fxCache: { move: DollarMove; at: number } | null = null;

/** Dollar index proxy now vs ~1 week earlier (ECB fixings, weekdays). Cached 15 min; stale copy on failure. */
export async function fetchDollarMove(): Promise<DollarMove> {
  if (fxCache && Date.now() - fxCache.at < NEWS_REFRESH_MS - 5000) return fxCache.move;
  try {
    const now = parseFrankfurter(await getJson(`https://api.frankfurter.dev/v1/latest?base=USD&symbols=${DXY_SYMBOLS}`));
    if (!now) throw new Error('bad FX payload');
    const then = parseFrankfurter(await getJson(`https://api.frankfurter.dev/v1/${minusDays(now.date, 7)}?base=USD&symbols=${DXY_SYMBOLS}`));
    if (!then) throw new Error('bad FX payload');
    const move = dollarMove(then, now);
    if (!move) throw new Error('FX dates out of order');
    fxCache = { move, at: Date.now() };
    return move;
  } catch (e) {
    if (fxCache) return fxCache.move;
    throw e;
  }
}
