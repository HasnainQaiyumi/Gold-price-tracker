import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alignFactor,
  dayChangePct,
  fetchPaxgCandles,
  pageWindows,
  parseCoinbaseCandles,
  parseCoinbaseRow,
  prepareCandles,
  rangeStart,
  scaleCandles,
  smaLine,
  timeToDay,
  toDisplay,
  withLiveCandle,
  type Candle,
} from './candles';

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const ts = (day: string) => Date.parse(`${day}T00:00:00Z`) / 1000;
const c = (time: string, open: number, high: number, low: number, close: number, volume = 1): Candle => ({ time, open, high, low, close, volume });

/* ------------------------------------------------------------- payload validation */

test('parseCoinbaseRow maps [time, low, high, open, close, volume]', () => {
  assert.deepEqual(parseCoinbaseRow([ts('2026-11-19'), 3510.83, 3614.93, 3597.21, 3569.05, 363.15]), c('2026-11-19', 3597.21, 3614.93, 3510.83, 3569.05, 363.15));
});

test('parseCoinbaseRow drops malformed rows', () => {
  const good = [ts('2026-11-19'), 3500, 3600, 3550, 3560, 10];
  const bad: unknown[] = [
    null,
    'x',
    {},
    good.slice(0, 5), // too short
    [String(good[0]), ...good.slice(1)], // string timestamp
    [good[0], '3500', 3600, 3550, 3560, 10], // string price
    [good[0], NaN, 3600, 3550, 3560, 10],
    [good[0], 3500, Infinity, 3550, 3560, 10],
    [good[0], 3500, 3600, 3550, 3560, -1], // negative volume
    [good[0], 3500, 3600, 3550, 3560, null],
    [good[0], 3600, 3500, 3550, 3560, 10], // low > high
    [good[0], 3500, 3600, 3650, 3560, 10], // open above high
    [good[0], 3500, 3600, 3550, 3400, 10], // close below low
    [good[0], 1, 3600, 3550, 3560, 10], // implausible gold price
    [good[0], 3500, 300000, 3550, 3560, 10],
    [12, 3500, 3600, 3550, 3560, 10], // implausible timestamp
    [good[0] + 0.5, 3500, 3600, 3550, 3560, 10], // non-integer timestamp
  ];
  for (const row of bad) assert.equal(parseCoinbaseRow(row), null, JSON.stringify(row));
  assert.ok(parseCoinbaseRow(good));
});

test('parseCoinbaseCandles: drops junk, dedupes by day (last wins), sorts ascending', () => {
  const older = [
    [ts('2026-11-02'), 3500, 3600, 3550, 3560, 1],
    [ts('2026-11-01'), 3400, 3500, 3450, 3460, 1],
    ['junk'],
  ];
  const newer = [
    [ts('2026-11-03'), 3600, 3700, 3650, 3660, 1],
    [ts('2026-11-02'), 3500, 3610, 3550, 3600, 2], // overlap: replaces older row
    [ts('2026-11-04'), 3600, 3500, 3650, 3660, 1], // malformed (low > high)
  ];
  const out = parseCoinbaseCandles({ message: 'error' }, older, newer, null);
  assert.deepEqual(out.map((x) => x.time), ['2026-11-01', '2026-11-02', '2026-11-03']);
  assert.equal(out[1].close, 3600);
  assert.equal(out[1].volume, 2);
  assert.deepEqual(parseCoinbaseCandles('nope', 42), []);
});

test('pageWindows: three contiguous 300-day windows, newest first', () => {
  const now = Date.parse('2026-11-20T09:00:00Z');
  const w = pageWindows(now);
  assert.equal(w.length, 3);
  assert.equal(w[0].end, '2026-11-20T09:00:00.000Z');
  for (const p of w) assert.equal((Date.parse(p.end) - Date.parse(p.start)) / 86_400_000, 300);
  assert.equal(w[1].end, w[0].start);
  assert.equal(w[2].end, w[1].start);
});

/* ----------------------------------------------------------------------- fetching */

function rowsFor(startDay: string, n: number, base = 3000): number[][] {
  const t0 = ts(startDay);
  // Coinbase returns newest first.
  return Array.from({ length: n }, (_, i) => {
    const p = base + i;
    return [t0 + i * 86400, p - 5, p + 5, p - 1, p + 1, 10 + i];
  }).reverse();
}

function fakeFetch(handler: (url: URL, i: number) => unknown | Promise<unknown>, calls: string[] = []): typeof fetch {
  let i = 0;
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(url.toString());
    const body = await handler(url, i++);
    if (body instanceof Error) throw body;
    if (typeof body === 'number') return new Response('err', { status: body });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

const pageIndex = (url: URL, now: number) => Math.round((now - Date.parse(url.searchParams.get('end')!)) / (300 * 86_400_000));

test('fetchPaxgCandles: fetches 3 pages with correct params, merges, sorts, dedupes', async () => {
  const now = Date.parse('2026-11-20T09:00:00Z');
  const calls: string[] = [];
  const f = fakeFetch((url) => {
    assert.equal(url.host, 'api.exchange.coinbase.com');
    assert.equal(url.pathname, '/products/PAXG-USD/candles');
    assert.equal(url.searchParams.get('granularity'), '86400');
    const p = pageIndex(url, now);
    const startDay = url.searchParams.get('start')!.slice(0, 10);
    return rowsFor(startDay, 301, 3000 + 1000 * (2 - p)); // 301 rows -> 1 overlapping day per boundary
  }, calls);
  const out = await fetchPaxgCandles({ now, fetchImpl: f });
  assert.equal(calls.length, 3);
  for (let i = 1; i < out.length; i++) assert.ok(out[i - 1].time < out[i].time);
  assert.equal(new Set(out.map((x) => x.time)).size, out.length);
  assert.equal(out.length, 901);
  assert.equal(out[out.length - 1].time, '2026-11-20');
  // On the overlap day the newer page wins.
  const boundary = pageWindows(now)[0].start.slice(0, 10);
  const b = out.find((x) => x.time === boundary)!;
  assert.equal(b.close, 5001); // page 0 (base 5000) beats page 1 (which would give 4301)
});

test('fetchPaxgCandles: older page failure keeps the contiguous newest data', async () => {
  const now = Date.parse('2026-11-20T09:00:00Z');
  const f = fakeFetch((url) => {
    const p = pageIndex(url, now);
    if (p === 1) return 500;
    return rowsFor(url.searchParams.get('start')!.slice(0, 10), 300);
  });
  const out = await fetchPaxgCandles({ now, fetchImpl: f });
  assert.equal(out.length, 300); // page 2 dropped too: no hole in the middle
  assert.equal(out[out.length - 1].time, '2026-11-19');
});

test('fetchPaxgCandles: newest page failure or too little data throws', async () => {
  const now = Date.parse('2026-11-20T09:00:00Z');
  await assert.rejects(fetchPaxgCandles({ now, fetchImpl: fakeFetch((url) => (pageIndex(url, now) === 0 ? 503 : rowsFor('2025-01-01', 300))) }));
  await assert.rejects(fetchPaxgCandles({ now, fetchImpl: fakeFetch(() => ({ message: 'rate limited' })) }));
  await assert.rejects(fetchPaxgCandles({ now, fetchImpl: fakeFetch((url) => (pageIndex(url, now) === 0 ? rowsFor('2026-11-10', 5) : 500)) }), /not enough/);
});

test('fetchPaxgCandles: aborts a hung request after the timeout', async () => {
  const hung = ((_: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as typeof fetch;
  const t0 = Date.now();
  await assert.rejects(fetchPaxgCandles({ fetchImpl: hung, timeoutMs: 30 }));
  assert.ok(Date.now() - t0 < 2000);
});

/* --------------------------------------------------------------------- pure helpers */

const SAMPLE = [c('2026-11-17', 100, 110, 95, 105, 3), c('2026-11-18', 105, 112, 101, 108, 4), c('2026-11-19', 108, 109, 99, 100, 5)];

test('scaleCandles multiplies prices, keeps volume, does not mutate; bad k is a no-op', () => {
  const s = scaleCandles(SAMPLE, 1.01);
  near(s[0].open, 101); near(s[0].high, 111.1); near(s[0].low, 95.95); near(s[0].close, 106.05);
  assert.equal(s[0].volume, 3);
  assert.equal(SAMPLE[0].open, 100);
  for (const k of [0, -1, NaN, Infinity]) assert.deepEqual(scaleCandles(SAMPLE, k), SAMPLE);
  assert.notEqual(scaleCandles(SAMPLE, NaN)[0], SAMPLE[0]);
});

const G = [c('2026-11-18', 3500, 3520, 3490, 3510), c('2026-11-19', 3510, 3530, 3500, 3520)];

test('alignFactor: prefers live PAXG quote, falls back to today candle, else 1', () => {
  near(alignFactor(G, 3540, '2026-11-20T09:00:00Z', 3530), 3540 / 3530);
  // No PAXG quote and last candle is yesterday: refuse to fold today's move into history.
  assert.equal(alignFactor(G, 3540, '2026-11-20T09:00:00Z'), 1);
  assert.equal(alignFactor(G, 3540, '2026-11-20T09:00:00Z', null), 1);
  // Last candle is today's partial: use its close.
  near(alignFactor(G, 3527.04, '2026-11-19T22:00:00Z'), 3527.04 / 3520);
  // Implausible gap (> 3%) or no spot: 1.
  assert.equal(alignFactor(G, 3800, '2026-11-20T09:00:00Z', 3520), 1);
  assert.equal(alignFactor(G, null, '2026-11-20T09:00:00Z', 3520), 1);
  assert.equal(alignFactor([], 3540, '2026-11-20T09:00:00Z'), 1);
});

test('withLiveCandle appends today from previous close', () => {
  const out = withLiveCandle(G, 3540, '2026-11-20T09:00:00Z');
  assert.equal(out.length, 3);
  assert.deepEqual(out[2], c('2026-11-20', 3520, 3540, 3520, 3540, 0));
  const down = withLiveCandle(G, 3500, '2026-11-20T09:00:00Z')[2];
  assert.equal(down.high, 3520); assert.equal(down.low, 3500); assert.equal(down.close, 3500);
  assert.equal(G.length, 2); // not mutated
});

test('withLiveCandle updates today: close = spot, high/low expand but never shrink', () => {
  const up = withLiveCandle(G, 3600, '2026-11-19T15:00:00Z');
  assert.equal(up.length, 2);
  assert.deepEqual(up[1], c('2026-11-19', 3510, 3600, 3500, 3600));
  const down = withLiveCandle(G, 3450, '2026-11-19T15:00:00Z')[1];
  assert.equal(down.low, 3450); assert.equal(down.high, 3530); assert.equal(down.close, 3450);
  const inside = withLiveCandle(G, 3515, '2026-11-19T15:00:00Z')[1];
  assert.equal(inside.low, 3500); assert.equal(inside.high, 3530); assert.equal(inside.close, 3515);
  assert.equal(G[1].close, 3520);
});

test('withLiveCandle: insane spot, empty input, bad clock or future candle -> unchanged', () => {
  assert.deepEqual(withLiveCandle(G, null, '2026-11-20T09:00:00Z'), G);
  assert.deepEqual(withLiveCandle(G, NaN, '2026-11-20T09:00:00Z'), G);
  assert.deepEqual(withLiveCandle(G, 5, '2026-11-20T09:00:00Z'), G);
  assert.deepEqual(withLiveCandle([], 3540, '2026-11-20T09:00:00Z'), []);
  assert.deepEqual(withLiveCandle(G, 3540, 'not a date'), G);
  assert.deepEqual(withLiveCandle(G, 3540, '2026-11-18T09:00:00Z'), G);
});

test('prepareCandles aligns history to spot then patches today', () => {
  const k = 3540 / 3530;
  const out = prepareCandles(G, 3540, '2026-11-20T09:00:00Z', 3530);
  assert.equal(out.length, 3);
  near(out[0].close, 3510 * k, 1e-6);
  near(out[2].open, 3520 * k, 1e-6);
  assert.equal(out[2].close, 3540);
});

test('toDisplay converts every price and keeps high/low as extremes', () => {
  const d = toDisplay(SAMPLE, (usd) => usd * 3.6725);
  near(d[0].open, 367.25); near(d[0].high, 110 * 3.6725); near(d[0].low, 95 * 3.6725); near(d[0].close, 105 * 3.6725);
  assert.equal(d[0].volume, 3);
  // A decreasing converter must not invert high/low.
  const inv = toDisplay(SAMPLE, (usd) => 1000 - usd)[0];
  assert.equal(inv.high, 905); assert.equal(inv.low, 890);
});

test('smaLine: aligned to dates, starts at the n-th candle', () => {
  const cs = [1, 2, 3, 4, 5].map((v, i) => c(`2026-11-0${i + 1}`, v, v, v, v));
  assert.deepEqual(smaLine(cs, 3), [
    { time: '2026-11-03', value: 2 },
    { time: '2026-11-04', value: 3 },
    { time: '2026-11-05', value: 4 },
  ]);
  assert.deepEqual(smaLine(cs, 1).map((p) => p.value), [1, 2, 3, 4, 5]);
  assert.deepEqual(smaLine(cs, 6), []);
  assert.deepEqual(smaLine(cs, 0), []);
  assert.deepEqual(smaLine(cs, 2.5), []);
});

test('smaLine matches a naive mean over a long noisy series (no drift)', () => {
  const cs = Array.from({ length: 500 }, (_, i) => {
    const v = 2000 + Math.sin(i / 7) * 50 + (i % 13) * 0.37;
    return c(new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10), v, v, v, v);
  });
  const s = smaLine(cs, 200);
  assert.equal(s.length, 301);
  for (const k of [0, 150, 300]) {
    const i = k + 199;
    const mean = cs.slice(i - 199, i + 1).reduce((a, x) => a + x.close, 0) / 200;
    near(s[k].value, mean, 1e-8);
    assert.equal(s[k].time, cs[i].time);
  }
});

test('dayChangePct', () => {
  near(dayChangePct(SAMPLE, 1)!, (108 / 105 - 1) * 100);
  assert.equal(dayChangePct(SAMPLE, 0), null);
  assert.equal(dayChangePct(SAMPLE, 3), null);
});

test('rangeStart: calendar months back, clamped to month end', () => {
  assert.equal(rangeStart('2026-11-20', '1M'), '2026-10-20');
  assert.equal(rangeStart('2026-11-20', '3M'), '2026-08-20');
  assert.equal(rangeStart('2026-11-20', '6M'), '2026-05-20');
  assert.equal(rangeStart('2026-11-20', '1Y'), '2025-11-20');
  assert.equal(rangeStart('2026-03-31', '1M'), '2026-02-28');
  assert.equal(rangeStart('2026-01-15', '3M'), '2025-10-15');
  assert.equal(rangeStart('2026-11-20', 'ALL'), null);
  assert.equal(rangeStart('garbage', '1M'), null);
});

test('timeToDay handles string, unix seconds and BusinessDay', () => {
  assert.equal(timeToDay('2026-11-20'), '2026-11-20');
  assert.equal(timeToDay(ts('2026-11-20')), '2026-11-20');
  assert.equal(timeToDay({ year: 2026, month: 3, day: 5 }), '2026-03-05');
  assert.equal(timeToDay('20 Nov'), null);
  assert.equal(timeToDay(undefined), null);
  assert.equal(timeToDay({}), null);
});
