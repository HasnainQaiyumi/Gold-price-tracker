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
  // Feeds are often double-encoded ("&amp;#39;"), so decode at most twice; strip any tags that decoding revealed.
  s = decodeEntities(s);
  if (/&(?:#x?[0-9a-f]+|[a-z][a-z0-9]+);/i.test(s)) s = decodeEntities(s);
  s = stripTags(s);
  // Control chars, soft hyphen, zero-width / bidi / word-joiner / BOM / interlinear annotation characters.
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u001f\u007f-\u009f­​-‏‪-‮⁠-⁤⁦-⁯﻿￹-￻]/g, ' ');
  // Lone surrogates (broken UTF-16) would render as replacement boxes.
  s = s.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > max) {
    let cut = s.slice(0, max - 1);
    if (/[\ud800-\udbff]$/.test(cut)) cut = cut.slice(0, -1); // never split a surrogate pair
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

/** The UI says "the last 2 days"; one hour of slack for publisher clock skew. */
export const NEWS_MAX_AGE_HOURS = 49;

export interface NewsParse {
  ok: boolean;
  items: Headline[];
  error?: string;
}

/**
 * Parse one rss2json response. Never throws. Items are sanitised, deduplicated, newest first, and anything
 * older than `maxAgeHours` (relative to `nowMs`) or dated in the future (>1h) is dropped.
 */
export function parseRss2Json(json: unknown, nowMs: number, maxAgeHours = NEWS_MAX_AGE_HOURS): NewsParse {
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
/** A cached copy counts as fresh up to this long before NEWS_REFRESH_MS, so a 15-min timer never skips a refresh. */
const FRESH_SLACK_MS = 60_000;
/** Even a "try again" click waits at least this long after a failure (stops click-spam against a rate limit). */
export const MIN_RETRY_GAP_MS = 10_000;

/** At most two distinct feeds (rss2json's free tier limits new feeds). The second is only used to top up. */
export const NEWS_QUERIES = ['gold price when:2d', 'gold (Fed OR dollar OR "central bank") when:2d'] as const;

export function googleNewsUrl(q: string): string {
  const rss = `https://news.google.com/rss/search?q=${encodeURIComponent(q).replace(/%20/g, '+')}&hl=en-US&gl=US&ceid=US:en`;
  return `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rss)}`;
}

/** Wait after the n-th consecutive failure: 1, 2, 4, 8 min, then capped at the normal refresh interval. */
export function backoffMs(failures: number): number {
  if (!(failures > 0)) return 0;
  return Math.min(NEWS_REFRESH_MS, 60_000 * 2 ** Math.min(failures - 1, 10));
}

/** True when an error message looks like a rate limit (then we stop and do not try the second feed). */
export function isRateLimited(msg: string): boolean {
  return /\b429\b|rate[- ]?limit|too many|short period|quota|limit exceeded/i.test(msg);
}

async function getJson(url: string, timeoutMs = 9000): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/** Shared cache + single-flight + exponential backoff for one remote source. */
interface SourceState<T> {
  value: T | null;
  at: number; // ms epoch of the last success
  inFlight: Promise<{ value: T; at: number; stale: boolean }> | null;
  failures: number;
  lastFailAt: number;
  lastError: string;
}

const newSource = <T>(): SourceState<T> => ({ value: null, at: 0, inFlight: null, failures: 0, lastFailAt: 0, lastError: '' });

function cachedLoad<T>(st: SourceState<T>, force: boolean, run: () => Promise<T>): Promise<{ value: T; at: number; stale: boolean }> {
  const now = Date.now();
  if (!force && st.value !== null && now - st.at < NEWS_REFRESH_MS - FRESH_SLACK_MS) {
    return Promise.resolve({ value: st.value, at: st.at, stale: false });
  }
  if (st.inFlight) return st.inFlight;
  const wait = backoffMs(st.failures);
  const sinceFail = now - st.lastFailAt;
  if (st.failures > 0 && (sinceFail < MIN_RETRY_GAP_MS || (!force && sinceFail < wait))) {
    // Still backing off: answer from cache (marked stale) without touching the network.
    if (st.value !== null) return Promise.resolve({ value: st.value, at: st.at, stale: true });
    return Promise.reject(new Error(st.lastError || 'unavailable'));
  }
  const p = (async () => {
    try {
      const value = await run();
      st.value = value;
      st.at = Date.now();
      st.failures = 0;
      st.lastError = '';
      return { value, at: st.at, stale: false };
    } catch (e) {
      st.failures += 1;
      st.lastFailAt = Date.now();
      st.lastError = e instanceof Error ? e.message : 'unavailable';
      if (st.value !== null) return { value: st.value, at: st.at, stale: true };
      throw e;
    } finally {
      st.inFlight = null;
    }
  })();
  st.inFlight = p;
  return p;
}

export interface NewsResult {
  items: Headline[];
  fetchedAt: number; // ms epoch of the last successful fetch
  stale: boolean; // true if the latest attempt failed (or we are backing off) and this is the cached copy
}

let newsState = newSource<Headline[]>();
let fxState = newSource<DollarMove>();

/** Test hook: forget caches, in-flight requests and backoff. */
export function _resetNetworkState(): void {
  newsState = newSource<Headline[]>();
  fxState = newSource<DollarMove>();
}

async function loadNews(): Promise<Headline[]> {
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
    if (!anyOk && isRateLimited(lastErr)) break; // the second feed would be refused too
  }
  if (!anyOk) throw new Error(lastErr);
  return items.slice(0, 40);
}

/**
 * Fetch recent gold headlines. Cached for 15 min, one request at a time, exponential backoff after failures.
 * On failure returns the last good result (stale) or rejects.
 */
export async function fetchNews(force = false): Promise<NewsResult> {
  const r = await cachedLoad(newsState, force, loadNews);
  return { items: r.value, fetchedAt: r.at, stale: r.stale };
}

async function loadDollar(): Promise<DollarMove> {
  const now = parseFrankfurter(await getJson(`https://api.frankfurter.dev/v1/latest?base=USD&symbols=${DXY_SYMBOLS}`));
  if (!now) throw new Error('bad FX payload');
  const then = parseFrankfurter(await getJson(`https://api.frankfurter.dev/v1/${minusDays(now.date, 7)}?base=USD&symbols=${DXY_SYMBOLS}`));
  if (!then) throw new Error('bad FX payload');
  const move = dollarMove(then, now);
  if (!move) throw new Error('FX dates out of order');
  return move;
}

/** Dollar index proxy now vs ~1 week earlier (ECB fixings, weekdays). Same caching/backoff as the news. */
export async function fetchDollarMove(): Promise<DollarMove> {
  return (await cachedLoad(fxState, false, loadDollar)).value;
}
