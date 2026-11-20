import test from 'node:test';
import assert from 'node:assert/strict';
import {
  _resetNetworkState,
  backoffMs,
  cleanText,
  decodeEntities,
  dollarMove,
  DXY_CONST,
  dxyProxy,
  fetchDollarMove,
  fetchNews,
  googleNewsUrl,
  isRateLimited,
  MIN_RETRY_GAP_MS,
  mergeHeadlines,
  minusDays,
  MAX_TITLE,
  NEWS_REFRESH_MS,
  parseFrankfurter,
  parsePubDate,
  parseRss2Json,
  safeUrl,
  splitTitle,
  timeAgo,
} from './news';

const NOW = Date.parse('2026-11-20T12:00:00Z');

// ---------------------------------------------------------------- sanitisation

test('cleanText strips script/style blocks and tags, keeps text', () => {
  assert.equal(cleanText('Gold <b>rises</b><script>alert(1)</script> today'), 'Gold rises today');
  assert.equal(cleanText('<style>p{}</style><p>Hi</p>'), 'Hi');
  assert.equal(cleanText('<SCRIPT type="x">evil()</script>ok'), 'ok');
  assert.equal(cleanText('before<script>never closed'), 'before');
  assert.equal(cleanText('<img src=x onerror=alert(1)>Gold'), 'Gold');
  assert.equal(cleanText('a<!-- hidden -->b'), 'a b');
});

test('cleanText decodes entities and strips tags revealed by decoding', () => {
  assert.equal(cleanText('Gold &amp; silver &#8211; &quot;safe&quot; &#x27;haven&#x27;'), 'Gold & silver – "safe" \'haven\'');
  assert.equal(cleanText('&lt;script&gt;alert(1)&lt;/script&gt;Gold'), 'Gold');
  assert.equal(cleanText('Fed&nbsp;cut'), 'Fed cut');
  assert.equal(decodeEntities('&bogus; &#0; &#xD800;'), '&bogus;  ');
});

test('cleanText removes control / bidi characters and collapses whitespace', () => {
  assert.equal(cleanText('Gold\u0000‮  up\n\n\t1%'), 'Gold up 1%');
  assert.equal(cleanText(undefined), '');
  assert.equal(cleanText(42), '');
});

test('cleanText caps overlong text on a word boundary with an ellipsis', () => {
  const long = 'Gold price '.repeat(60);
  const out = cleanText(long);
  assert.ok(out.length <= MAX_TITLE, `length ${out.length}`);
  assert.ok(out.endsWith('…'));
  assert.ok(!/\s…$/.test(out));
  assert.equal(cleanText('x'.repeat(500), 20).length, 20);
});

test('safeUrl allows only absolute http(s)', () => {
  assert.equal(safeUrl('https://news.google.com/rss/articles/abc?oc=5'), 'https://news.google.com/rss/articles/abc?oc=5');
  assert.equal(safeUrl('http://example.com'), 'http://example.com/');
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl(' JaVaScRiPt:alert(1)'), null);
  assert.equal(safeUrl('java\nscript:alert(1)'), null);
  assert.equal(safeUrl('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(safeUrl('vbscript:msgbox'), null);
  assert.equal(safeUrl('/relative/path'), null);
  assert.equal(safeUrl('//evil.com/x'), null);
  assert.equal(safeUrl('https://user:pw@evil.com'), null);
  assert.equal(safeUrl('https://x.com/' + 'a'.repeat(3000)), null);
  assert.equal(safeUrl(null), null);
});

// ---------------------------------------------------------------- news parsing

test('splitTitle splits the last " - Source"', () => {
  assert.deepEqual(splitTitle('Gold - silver ratio widens - Reuters'), { title: 'Gold - silver ratio widens', source: 'Reuters' });
  assert.deepEqual(splitTitle('No source here'), { title: 'No source here', source: '' });
});

test('parsePubDate reads rss2json UTC format and rejects junk', () => {
  assert.equal(parsePubDate('2026-11-20 08:15:00'), '2026-11-20T08:15:00.000Z');
  assert.equal(parsePubDate('2026-02-31 08:15:00'), null);
  assert.equal(parsePubDate('yesterday'), null);
  assert.equal(parsePubDate(undefined), null);
  assert.equal(parsePubDate('Thu, 19 Nov 2026 10:00:00 GMT'), '2026-11-19T10:00:00.000Z');
});

test('parseRss2Json handles error status', () => {
  const r = parseRss2Json({ status: 'error', message: 'You are converting new feeds <b>too fast</b>' }, NOW);
  assert.equal(r.ok, false);
  assert.equal(r.items.length, 0);
  assert.equal(r.error, 'You are converting new feeds too fast');
  assert.equal(parseRss2Json(null, NOW).ok, false);
  assert.equal(parseRss2Json('nope', NOW).ok, false);
  assert.equal(parseRss2Json({ status: 'ok' }, NOW).ok, false);
});

test('parseRss2Json sanitises, splits source, drops bad links, old/future items, dedupes, sorts newest first', () => {
  const json = {
    status: 'ok',
    items: [
      { title: 'Gold falls as dollar firms - Reuters', pubDate: '2026-11-20 09:00:00', link: 'https://news.google.com/a' },
      { title: 'Gold <script>x()</script>rises &amp; shines - Kitco', pubDate: '2026-11-20 11:00:00', link: 'javascript:alert(1)' },
      { title: 'GOLD FALLS AS DOLLAR FIRMS - Yahoo', pubDate: '2026-11-19 09:00:00', link: 'https://y.com' }, // dup (older)
      { title: 'Ancient gold news item - Old', pubDate: '2026-11-10 09:00:00', link: 'https://o.com' }, // too old
      { title: 'From the future headline - Fut', pubDate: '2026-11-21 09:00:00', link: 'https://f.com' }, // future
      { title: 'short', pubDate: '2026-11-20 09:00:00' }, // too short
      { title: '', pubDate: '2026-11-20 09:00:00' },
      null,
      { title: 'Undated gold headline here', link: 'https://u.com' },
    ],
  };
  const r = parseRss2Json(json, NOW);
  assert.equal(r.ok, true);
  assert.deepEqual(
    r.items.map((h) => h.title),
    ['Gold rises & shines', 'Gold falls as dollar firms', 'Undated gold headline here']
  );
  assert.equal(r.items[0].source, 'Kitco');
  assert.equal(r.items[0].link, null);
  assert.equal(r.items[1].source, 'Reuters');
  assert.equal(r.items[1].link, 'https://news.google.com/a');
  assert.equal(r.items[2].publishedAt, null);
});

test('mergeHeadlines keeps newest duplicate', () => {
  const a = { title: 'Gold up', source: 'A', link: null, publishedAt: '2026-11-20T01:00:00.000Z' };
  const b = { title: 'gold UP!', source: 'B', link: null, publishedAt: '2026-11-20T05:00:00.000Z' };
  const out = mergeHeadlines([a], [b]);
  assert.equal(out.length, 1);
  assert.equal(out[0].source, 'B');
});

test('timeAgo', () => {
  assert.equal(timeAgo('2026-11-20T11:59:30Z', NOW), 'just now');
  assert.equal(timeAgo('2026-11-20T11:48:00Z', NOW), '12 min ago');
  assert.equal(timeAgo('2026-11-20T09:00:00Z', NOW), '3 h ago');
  assert.equal(timeAgo('2026-11-19T10:00:00Z', NOW), '1 day ago');
  assert.equal(timeAgo('2026-11-17T10:00:00Z', NOW), '3 days ago');
  assert.equal(timeAgo(null, NOW), '');
  assert.equal(timeAgo('garbage', NOW), '');
});

test('googleNewsUrl wraps the Google News RSS search in rss2json', () => {
  const u = new URL(googleNewsUrl('gold price when:2d'));
  assert.equal(u.origin, 'https://api.rss2json.com');
  const rss = new URL(u.searchParams.get('rss_url')!);
  assert.equal(rss.origin, 'https://news.google.com');
  assert.equal(rss.searchParams.get('q'), 'gold price when:2d');
  assert.equal(rss.searchParams.get('ceid'), 'US:en');
});

// ---------------------------------------------------------------- dollar index proxy

const close = (a: number, b: number, eps: number) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('dxyProxy: all rates 1 gives the constant; exponents are the DXY weights', () => {
  const ones = { EUR: 1, JPY: 1, GBP: 1, CAD: 1, SEK: 1, CHF: 1 };
  close(dxyProxy(ones), DXY_CONST, 1e-9);
  // Doubling EUR-per-USD multiplies the index by 2^0.576; doubling JPY by 2^0.136.
  close(dxyProxy({ ...ones, EUR: 2 }) / DXY_CONST, 2 ** 0.576, 1e-12);
  close(dxyProxy({ ...ones, JPY: 2 }) / DXY_CONST, 2 ** 0.136, 1e-12);
  // Weights sum to 1: a uniform 1% stronger dollar moves the index by exactly 1%.
  const r = { EUR: 0.9, JPY: 150, GBP: 0.78, CAD: 1.38, SEK: 10.5, CHF: 0.88 };
  const r2 = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v * 1.01])) as typeof r;
  close(dxyProxy(r2) / dxyProxy(r) - 1, 0.01, 1e-12);
});

test('dxyProxy matches the textbook ICE formula written with market quotes', () => {
  // Real ECB fixing (2026-11-19, base USD).
  const r = { CAD: 1.43, CHF: 0.84261, EUR: 0.90975, GBP: 0.76038, JPY: 159.97, SEK: 10.141 };
  const eurusd = 1 / r.EUR;
  const gbpusd = 1 / r.GBP;
  const textbook = 50.14348112 * eurusd ** -0.576 * r.JPY ** 0.136 * gbpusd ** -0.119 * r.CAD ** 0.091 * r.SEK ** 0.042 * r.CHF ** 0.036;
  close(dxyProxy(r), textbook, 1e-9);
  assert.ok(dxyProxy(r) > 80 && dxyProxy(r) < 130, 'plausible DXY level');
});

test('parseFrankfurter validates shape and rates', () => {
  const ok = { amount: 1, base: 'USD', date: '2026-11-19', rates: { CAD: 1.43, CHF: 0.84261, EUR: 0.90975, GBP: 0.76038, JPY: 159.97, SEK: 10.141 } };
  assert.equal(parseFrankfurter(ok)?.date, '2026-11-19');
  assert.equal(parseFrankfurter({ ...ok, base: 'EUR' }), null);
  assert.equal(parseFrankfurter({ ...ok, date: '19/11/2026' }), null);
  assert.equal(parseFrankfurter({ ...ok, rates: { ...ok.rates, SEK: undefined } }), null);
  assert.equal(parseFrankfurter({ ...ok, rates: { ...ok.rates, JPY: -1 } }), null);
  assert.equal(parseFrankfurter({ ...ok, rates: { ...ok.rates, JPY: '160' } }), null);
  assert.equal(parseFrankfurter(null), null);
});

test('dollarMove: % change of the proxy, requires older date first', () => {
  const now = parseFrankfurter({ base: 'USD', date: '2026-11-19', rates: { CAD: 1.43, CHF: 0.84261, EUR: 0.90975, GBP: 0.76038, JPY: 159.97, SEK: 10.141 } })!;
  const then = parseFrankfurter({ base: 'USD', date: '2026-11-12', rates: { CAD: 1.4258, CHF: 0.8384, EUR: 0.90481, GBP: 0.75605, JPY: 160.0, SEK: 10.0502 } })!;
  const m = dollarMove(then, now)!;
  close(m.pct, (dxyProxy(now.rates) / dxyProxy(then.rates) - 1) * 100, 1e-12);
  assert.ok(m.pct > 0, 'dollar strengthened in this sample');
  assert.equal(m.fromDate, '2026-11-12');
  assert.equal(dollarMove(now, then), null);
  assert.equal(dollarMove(now, now), null);
});

test('minusDays crosses month and year boundaries', () => {
  assert.equal(minusDays('2026-03-01', 1), '2026-02-28');
  assert.equal(minusDays('2026-01-03', 7), '2025-12-27');
  assert.equal(minusDays('2026-11-20', -3), '2026-11-23');
});

// ---------------------------------------------------------------- review regressions: text

test('cleanText decodes double-encoded entities once more, but still strips revealed tags', () => {
  assert.equal(cleanText('Gold &amp;#39;rallies&amp;#39; &amp;amp; more'), "Gold 'rallies' & more");
  assert.equal(cleanText('&amp;lt;script&amp;gt;x&amp;lt;/script&amp;gt;Gold'), 'Gold');
  assert.equal(cleanText('&amp;lt;img src=x onerror=alert(1)&amp;gt;Gold'), 'Gold');
});

test('cleanText drops invisible characters and never splits an emoji when cutting', () => {
  assert.equal(cleanText('Go­ld⁠ up﻿ 1%⁦'), 'Go ld up 1%');
  assert.equal(cleanText('bad \ud800 surrogate'), 'bad surrogate');
  for (const max of [20, 21]) {
    const out = cleanText('😀'.repeat(100), max);
    assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])/.test(out), `lone high surrogate at max=${max}`);
    assert.ok(out.length <= max);
  }
});

test('parseRss2Json drops items older than ~2 days (the UI says "last 2 days")', () => {
  const r = parseRss2Json({ status: 'ok', items: [
    { title: 'Gold news from 47 hours ago', pubDate: '2026-11-18 13:00:00' },
    { title: 'Gold news from 60 hours ago', pubDate: '2026-11-18 00:00:00' },
  ] }, NOW);
  assert.deepEqual(r.items.map((x) => x.title), ['Gold news from 47 hours ago']);
});

test('parseRss2Json survives hostile shapes', () => {
  for (const bad of [[], 0, true, { status: 'ok', items: 'x' }, { status: 'ok', items: [1, 'a', [], { title: {} }, { title: ['x'] }] }]) {
    const r = parseRss2Json(bad, NOW);
    assert.ok(Array.isArray(r.items));
    assert.equal(r.items.length, 0);
  }
  const r = parseRss2Json({ status: 'ok', items: [{ title: 'Gold is fine here today', link: { href: 'javascript:1' }, pubDate: 12 }] }, NOW);
  assert.equal(r.items[0].link, null);
  assert.equal(r.items[0].publishedAt, null);
});

// ---------------------------------------------------------------- review regressions: network politeness

test('backoffMs and isRateLimited', () => {
  assert.equal(backoffMs(0), 0);
  assert.equal(backoffMs(1), 60_000);
  assert.equal(backoffMs(3), 240_000);
  assert.equal(backoffMs(50), NEWS_REFRESH_MS);
  assert.ok(isRateLimited('You are converting new feeds in a very short period'));
  assert.ok(isRateLimited('HTTP 429'));
  assert.ok(!isRateLimited('HTTP 500'));
});

type FakeResponse = { ok: boolean; status: number; json: () => Promise<unknown> };
function stubFetch(handler: (url: string) => FakeResponse | Promise<FakeResponse>) {
  const calls: string[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    return handler(String(url));
  }) as unknown as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = orig) };
}
function withClock<T>(fn: (set: (ms: number) => void) => Promise<T>): Promise<T> {
  const orig = Date.now;
  let t = orig();
  Date.now = () => t;
  return fn((ms) => (t = ms)).finally(() => (Date.now = orig));
}
const okJson = (body: unknown): FakeResponse => ({ ok: true, status: 200, json: async () => body });
const feed = (n: number, at: number) => ({
  status: 'ok',
  items: Array.from({ length: n }, (_, i) => ({ title: `Gold headline number ${i} here`, pubDate: new Date(at - i * 60_000).toISOString() })),
});

test('fetchNews: rate-limit error stops after one request and backs off; no request storm', async () => {
  _resetNetworkState();
  const f = stubFetch(() => okJson({ status: 'error', message: 'You are converting new feeds in a very short period' }));
  try {
    await withClock(async (set) => {
      const t0 = Date.parse('2026-11-20T12:00:00Z');
      set(t0);
      await assert.rejects(fetchNews());
      assert.equal(f.calls.length, 1, 'second feed not tried after a rate-limit answer');
      // Tab switches / timers during backoff do not touch the network.
      for (let i = 0; i < 5; i++) await assert.rejects(fetchNews());
      set(t0 + 5_000);
      await assert.rejects(fetchNews(true), Error, 'retry click within the minimum gap is refused');
      assert.equal(f.calls.length, 1);
      // A retry click after the minimum gap goes through.
      set(t0 + MIN_RETRY_GAP_MS + 1);
      await assert.rejects(fetchNews(true));
      assert.equal(f.calls.length, 2);
      // Not forced: waits out the (now 2-minute) backoff.
      set(t0 + MIN_RETRY_GAP_MS + 60_000);
      await assert.rejects(fetchNews());
      assert.equal(f.calls.length, 2);
      set(t0 + MIN_RETRY_GAP_MS + 1 + 120_001);
      await assert.rejects(fetchNews());
      assert.equal(f.calls.length, 3);
    });
  } finally {
    f.restore();
    _resetNetworkState();
  }
});

test('fetchNews: single flight, cache, stale copy on failure, second feed only to top up', async () => {
  _resetNetworkState();
  let mode: 'few' | 'fail' = 'few';
  const f = stubFetch(() => (mode === 'few' ? okJson(feed(5, Date.now())) : { ok: false, status: 503, json: async () => ({}) }));
  try {
    await withClock(async (set) => {
      const t0 = Date.parse('2026-11-20T12:00:00Z');
      set(t0);
      const [a, b] = await Promise.all([fetchNews(), fetchNews()]);
      assert.equal(f.calls.length, 2, 'one load (both feeds, because the first had < 12 items) shared by two callers');
      assert.equal(b.items.length, 5, 'same titles from both feeds are deduplicated');
      assert.equal(b.stale, false);
      await fetchNews();
      assert.equal(f.calls.length, 2, 'served from cache');
      // After the refresh interval the next call refetches; a failure returns the cached copy marked stale.
      mode = 'fail';
      set(t0 + NEWS_REFRESH_MS);
      const s = await fetchNews();
      assert.equal(s.stale, true);
      assert.equal(s.fetchedAt, t0);
      assert.equal(s.items.length, 5);
      const n = f.calls.length;
      await fetchNews();
      assert.equal(f.calls.length, n, 'backing off: cached copy, no request');
    });
  } finally {
    f.restore();
    _resetNetworkState();
  }
});

test('fetchNews: a timer firing exactly every 15 minutes always refreshes', async () => {
  _resetNetworkState();
  const f = stubFetch(() => okJson(feed(20, Date.now())));
  try {
    await withClock(async (set) => {
      const t0 = Date.parse('2026-11-20T12:00:00Z');
      set(t0 + 8_000); // first load finished 8 s after the timer started
      await fetchNews();
      set(t0 + NEWS_REFRESH_MS); // first tick
      await fetchNews();
      assert.equal(f.calls.length, 2, 'one feed per load (20 items is enough), and the tick refreshed');
    });
  } finally {
    f.restore();
    _resetNetworkState();
  }
});

test('fetchDollarMove: two requests, cached, single flight', async () => {
  _resetNetworkState();
  const rates = { CAD: 1.43, CHF: 0.84261, EUR: 0.90975, GBP: 0.76038, JPY: 159.97, SEK: 10.141 };
  const f = stubFetch((url) => {
    const u = new URL(url);
    assert.equal(u.origin, 'https://api.frankfurter.dev');
    return url.includes('/latest') ? okJson({ base: 'USD', date: '2026-11-19', rates }) : okJson({ base: 'USD', date: '2026-11-12', rates: { ...rates, EUR: 0.9 } });
  });
  try {
    const [a, b] = await Promise.all([fetchDollarMove(), fetchDollarMove()]);
    assert.equal(a, b);
    assert.equal(f.calls.length, 2);
    assert.ok(f.calls[1].includes('/v1/2026-11-12?'));
    assert.ok(a.pct > 0, 'more euros per dollar = stronger dollar = index up');
    await fetchDollarMove();
    assert.equal(f.calls.length, 2);
  } finally {
    f.restore();
    _resetNetworkState();
  }
});
