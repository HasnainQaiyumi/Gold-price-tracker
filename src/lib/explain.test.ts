import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  changeSinceDays,
  classifyHeadline,
  detectThemes,
  dollarSentence,
  explain,
  goldMoveInHeadline,
  headlineLine,
  leanOf,
  priceFacts,
  THEME_TEXT,
  THEMES,
  windowMean,
  type PriceFacts,
  type ThemeId,
} from './explain';
import type { DailyBar } from './forecast/types';
import { minusDays, type DollarMove, type Headline } from './news';

const NOW = Date.parse('2026-11-20T12:00:00Z');
const close = (a: number | null, b: number, eps = 1e-9) => assert.ok(a !== null && Math.abs(a - b) < eps, `${a} != ${b}`);

/** Daily (calendar-day) series ending on `end`, with price f(i) for i = 0..n-1. */
function mkSeries(n: number, f: (i: number) => number, end = '2026-11-20'): DailyBar[] {
  return Array.from({ length: n }, (_, i) => ({ date: minusDays(end, n - 1 - i), usd: f(i) }));
}

const h = (title: string, hoursAgo = 2, source = 'Reuters'): Headline => ({
  title,
  source,
  link: 'https://news.example.com/x',
  publishedAt: new Date(NOW - hoursAgo * 3600_000).toISOString(),
});

const lean = (title: string, id: ThemeId) => {
  const m = classifyHeadline(title).find((x) => x.id === id);
  return m ? leanOf(m.up, m.down) : 'absent';
};

// ---------------------------------------------------------------- classifier

test('classifier finds the right themes', () => {
  const ids = (t: string) => classifyHeadline(t).map((m) => m.id).sort();
  assert.deepEqual(ids('Gold falls as dollar firms, Fed rate cut bets fade'), ['dollar', 'fed']);
  assert.deepEqual(ids('Gold rises on safe-haven demand amid Middle East tensions'), ['geopolitics', 'riskMood']);
  assert.deepEqual(ids('Gold hits record high as central banks keep buying'), ['centralBanks']);
  assert.deepEqual(ids('Gold ETF inflows jump to highest since 2020'), ['etfFlows']);
  assert.deepEqual(ids('Gold gains after weak US jobs report'), ['econData']);
  assert.deepEqual(ids('Trump slaps new tariffs on Canada, gold jumps'), ['trade']);
  assert.deepEqual(ids('Gold slips as traders book profits after record run'), ['profitTaking']);
  assert.deepEqual(ids('Diwali demand lifts Indian gold buying'), ['physicalDemand']);
  assert.deepEqual(ids('Silver surges 4% to a 14-year high'), ['metals']);
  assert.deepEqual(ids('US CPI comes in hotter than expected'), ['inflation']);
  assert.deepEqual(ids('Wall Street sell-off deepens'), ['riskMood']);
  assert.deepEqual(ids('Gold price today: what to know'), []);
});

test('classifier avoids common false positives', () => {
  const ids = (t: string) => classifyHeadline(t).map((m) => m.id);
  assert.ok(!ids('XAU/USD steadies near $4,000').includes('dollar'), 'XAU/USD is gold, not a dollar story');
  assert.ok(!ids('Gold trades higher in Asia').includes('trade'), '"trades" is not a trade fight');
  assert.ok(!ids('China slaps tariffs on US farm goods').includes('physicalDemand'), 'China alone is not shopper demand');
  assert.ok(!ids('Gold rises as Fed signals cuts').includes('centralBanks'), 'Fed rate talk is not central-bank gold buying');
});

test('direction hints: Fed / rates', () => {
  assert.equal(lean('Gold climbs as rate cut hopes grow', 'fed'), 'up');
  assert.equal(lean('Dovish Fed lifts gold', 'fed'), 'up');
  assert.equal(lean('Gold steady as Fed easing bets build', 'fed'), 'up');
  assert.equal(lean('Gold slips as Fed stays hawkish', 'fed'), 'down');
  assert.equal(lean('Fed signals higher for longer rates', 'fed'), 'down');
  assert.equal(lean('Rate cut bets fade after Powell speech', 'fed'), 'down');
  assert.equal(lean('Powell pushes back on December rate cut', 'fed'), 'down');
  assert.equal(lean('Gold rises as Treasury yields fall', 'fed'), 'up');
  assert.equal(lean('Treasury yields jump, gold drops', 'fed'), 'down');
});

test('direction hints: dollar, war, trade, flows, data, mood, profit-taking, demand, metals', () => {
  assert.equal(lean('Gold gains as dollar weakens', 'dollar'), 'up');
  assert.equal(lean('Weaker dollar supports bullion', 'dollar'), 'up');
  assert.equal(lean('Strong dollar weighs on gold', 'dollar'), 'down');
  assert.equal(lean('Dollar rallies to two-week high', 'dollar'), 'down');
  assert.equal(lean('Gold rises on safe-haven demand', 'riskMood'), 'up');
  assert.equal(lean('Gold falls as ceasefire talks progress', 'geopolitics'), 'down');
  assert.equal(lean('Escalating Middle East conflict sends gold higher', 'geopolitics'), 'up');
  assert.equal(lean('Gold jumps after new tariffs announced', 'trade'), 'up');
  assert.equal(lean('US and EU strike trade deal; gold eases', 'trade'), 'down');
  assert.equal(lean('Gold ETFs see record inflows', 'etfFlows'), 'up');
  assert.equal(lean('Gold ETF outflows accelerate', 'etfFlows'), 'down');
  assert.equal(lean('Gold gains after weak US jobs report', 'econData'), 'up');
  assert.equal(lean('Strong US retail sales data hits gold', 'econData'), 'down');
  assert.equal(lean('Gold falls as stocks rally to record', 'riskMood'), 'down');
  assert.equal(lean('Gold rises as stocks tumble', 'riskMood'), 'up');
  assert.equal(lean('Gold slips on profit-taking', 'profitTaking'), 'down');
  assert.equal(lean('Bargain hunting lifts gold after correction', 'profitTaking'), 'mixed');
  assert.equal(lean('Indian gold demand slumps as record prices deter buyers', 'physicalDemand'), 'down');
  assert.equal(lean('Strong Diwali demand in India', 'physicalDemand'), 'up');
  assert.equal(lean('Silver jumps 3%', 'metals'), 'up');
  assert.equal(lean('Gold, silver prices fall', 'metals'), 'down');
  assert.equal(lean('Central banks bought 60 tonnes of gold in October', 'centralBanks'), 'up');
  assert.equal(lean('PBOC pauses gold purchases', 'centralBanks'), 'down');
});

test('direction hints: inflation is two-sided', () => {
  assert.equal(lean('Hotter-than-expected CPI pressures gold', 'inflation'), 'down');
  assert.equal(lean('Inflation cools, boosting gold', 'inflation'), 'up');
  assert.equal(lean('Investors turn to gold as inflation hedge', 'inflation'), 'up');
});

test('no hint when the wording is not clear, weak fallback only from explicit gold move + link word', () => {
  const m = classifyHeadline('Fed officials meet next week').find((x) => x.id === 'fed')!;
  assert.deepEqual([m.up, m.down, m.linked], [0, 0, null]);
  // The weak fallback only records that the headline links the topic to a gold move. It is not a direction.
  const f = classifyHeadline('Gold rises ahead of Fed meeting').find((x) => x.id === 'fed')!;
  assert.deepEqual([f.up, f.down, f.linked], [0, 0, 'up']);
  const c = classifyHeadline('Gold rises despite Fed comments').find((x) => x.id === 'fed')!;
  assert.deepEqual([c.up, c.down, c.linked], [0, 0, null], 'contrast word: no inference');
});

test('gold move in a headline: first verb after gold, not across a clause', () => {
  assert.equal(goldMoveInHeadline('Gold falls as dollar rises'), 'down');
  assert.equal(goldMoveInHeadline('Gold prices rise as dollar falls'), 'up');
  assert.equal(goldMoveInHeadline('Gold steady as Fed easing bets build'), null);
  assert.equal(goldMoveInHeadline('Gold hits record high'), 'up');
  assert.equal(goldMoveInHeadline('Gold, silver prices tumble'), 'down');
});

test('leanOf', () => {
  assert.equal(leanOf(0, 0), 'unclear');
  assert.equal(leanOf(2, 0), 'up');
  assert.equal(leanOf(2, 1), 'up');
  assert.equal(leanOf(1, 1), 'mixed');
  assert.equal(leanOf(1, 1.5), 'mixed');
  assert.equal(leanOf(0, 0.5), 'down');
});

test('every theme has plain text for each case', () => {
  for (const t of THEMES) {
    const x = THEME_TEXT[t.id];
    for (const k of ['base', 'up', 'down', 'unclear', 'nextUp', 'nextDown'] as const) assert.ok(x[k].length > 10, `${t.id}.${k}`);
    assert.match(x.nextUp, /could rise/);
    assert.match(x.nextDown, /could fall/);
  }
});

test('detectThemes ranks by count, cites headlines, applies min score and recency', () => {
  const items = [
    h('Gold falls as dollar firms'),
    h('Dollar rallies to two-week high'),
    h('Strong dollar weighs on gold', 30),
    h('Gold slips as Fed stays hawkish'),
    h('Silver drops 2%', 40), // metals: half weight, old -> 0.35 < min score
  ];
  const th = detectThemes(items, NOW);
  assert.deepEqual(th.map((t) => t.id), ['dollar', 'fed']);
  assert.equal(th[0].lean, 'down');
  assert.equal(th[0].headlines.length, 2);
  close(th[0].score, 2.7, 1e-9);
  assert.deepEqual(detectThemes([], NOW), []);
});

// ---------------------------------------------------------------- price facts

test('changeSinceDays and windowMean on calendar and trading-day series', () => {
  const s = mkSeries(40, (i) => 100 + i); // last = 139 on 2026-11-20
  close(changeSinceDays(s, 7), (139 / 132 - 1) * 100);
  close(changeSinceDays(s, 30), (139 / 109 - 1) * 100);
  assert.equal(changeSinceDays(s, 60), null);
  close(windowMean(s, 10), (130 + 139) / 2);
  assert.equal(windowMean(s, 50), null, 'history shorter than the window');
  // Weekday-only series: "a week ago" on a Friday hits the previous Friday exactly.
  const wk = s.filter((b) => ![0, 6].includes(new Date(`${b.date}T00:00:00Z`).getUTCDay()));
  close(changeSinceDays(wk, 7), (139 / 132 - 1) * 100);
});

test('priceFacts: moves, averages, 52-week range; spot overrides the last close', () => {
  const s = mkSeries(400, (i) => 1000 + i); // steady climb: last is the 52-week high
  const f = priceFacts(s)!;
  close(f.todayPct, (1399 / 1398 - 1) * 100);
  close(f.weekPct, (1399 / 1392 - 1) * 100);
  close(f.avg50, (1350 + 1399) / 2);
  close(f.avg200, (1200 + 1399) / 2);
  close(f.high52, 1399);
  close(f.low52, 1035);
  close(f.fromHighPct, 0);
  const g = priceFacts(s, 1300)!;
  close(g.last, 1300);
  close(g.todayPct, (1300 / 1398 - 1) * 100);
  close(g.high52, 1398);
  assert.equal(priceFacts(null), null);
  assert.equal(priceFacts([]), null);
  assert.equal(priceFacts(mkSeries(30, () => 100))!.avg200, null);
});

test('priceFacts on the real PAXG fixture gives sane numbers', () => {
  const closes = JSON.parse(readFileSync(new URL('./fixtures/paxg-daily-closes.json', import.meta.url), 'utf8')) as number[];
  const s = mkSeries(closes.length, (i) => closes[i], '2026-11-19');
  const f = priceFacts(s)!;
  for (const k of ['todayPct', 'weekPct', 'monthPct', 'vs50Pct', 'vs200Pct', 'fromHighPct', 'fromLowPct'] as const) {
    assert.ok(f[k] !== null && Number.isFinite(f[k]), k);
  }
  assert.ok(f.fromHighPct! <= 0 && f.fromLowPct! >= 0);
  assert.ok(f.high52! >= f.last && f.low52! <= f.last);
});

// ---------------------------------------------------------------- text generation

const facts = (o: Partial<PriceFacts>): PriceFacts => ({
  last: 4000,
  lastDate: '2026-11-20',
  todayPct: 0.4,
  twoDayPct: -1.2,
  weekPct: -2.1,
  monthPct: 3.04,
  avg50: 3950,
  avg200: 3700,
  vs50Pct: 1.27,
  vs200Pct: 8.11,
  high52: 4200,
  low52: 3000,
  fromHighPct: -4.76,
  fromLowPct: 33.3,
  ...o,
});

test('headline one-liner for up / down / flat / missing', () => {
  // "Past week" (last 7 days), not "this week": on a Monday a calendar week would be misleading.
  assert.equal(headlineLine(facts({ weekPct: -2.1 })).text, 'Gold is down 2.1% over the past week.');
  assert.equal(headlineLine(facts({ weekPct: 1.26 })).text, 'Gold is up 1.3% over the past week.');
  assert.equal(headlineLine(facts({ weekPct: 0.12 })).text, 'Gold is about flat over the past week.');
  assert.equal(headlineLine(facts({ weekPct: 0.12 })).mood, 'flat');
  assert.equal(headlineLine(facts({ weekPct: null, todayPct: -0.8 })).text, 'Gold is down 0.8% today.');
  assert.equal(headlineLine(null).mood, 'unknown');
});

test('"What happened" uses only the numbers given', () => {
  const ex = explain({ facts: facts({}), headlines: [], nowMs: NOW, fmtPrice: (u) => `AED ${u.toFixed(0)}` });
  assert.deepEqual(ex.happened, [
    'Today it is up 0.4%, and over the past month it is up 3.0%. It now costs about AED 4000.',
    'It is 1.3% above its average price of the last 50 days and 8.1% above its average price of the last 200 days, so the bigger trend is still up.',
    'It is 4.8% below its highest price of the past year (AED 4200).',
  ]);
  const down = explain({ facts: facts({ todayPct: -0.02, vs50Pct: -3, vs200Pct: -1, fromHighPct: -20, fromLowPct: 5 }), headlines: [], nowMs: NOW });
  assert.match(down.happened[0], /^Today the price has hardly moved/);
  assert.match(down.happened[1], /below .* 50 days and 1\.0% below .* 200 days, so the bigger trend is down for now\./);
  assert.equal(down.happened[2], 'It is 20.0% below its highest price of the past year, and 5.0% above its lowest.');
  const top = explain({ facts: facts({ fromHighPct: 0 }), headlines: [], nowMs: NOW });
  assert.equal(top.happened[2], 'This is the highest price of the past year.');
});

test('"Why" cites real headlines and says whether the topic fits the move', () => {
  const items = [h('Gold falls as dollar firms', 1, 'Reuters'), h('Dollar rallies to two-week high', 3, 'CNBC'), h('Gold slips as Fed stays hawkish', 5, 'Kitco')];
  const ex = explain({ facts: facts({ twoDayPct: -1.2 }), headlines: items, nowMs: NOW });
  assert.equal(ex.newsAvailable, true);
  assert.match(ex.whyIntro, /Nobody can know for sure/);
  assert.deepEqual(ex.why.map((w) => w.id), ['dollar', 'fed']);
  assert.equal(ex.why[0].lean, 'down');
  assert.match(ex.why[0].text, /dollar got stronger/);
  assert.match(ex.why[0].text, /That fits with gold falling over the last two days\./);
  for (const w of ex.why) {
    assert.ok(w.headlines.length > 0, 'every news-based reason cites at least one headline');
    for (const c of w.headlines) assert.ok(items.includes(c), 'cited headline must be one we were given');
  }
  // Next steps come from the detected themes and are balanced.
  assert.equal(ex.nextUp.length, ex.nextDown.length);
  assert.ok(ex.nextUp.includes(THEME_TEXT.dollar.nextUp) && ex.nextDown.includes(THEME_TEXT.fed.nextDown));
  assert.match(ex.nextNote, /not predictions/);
});

test('theme that goes against the move is called out, not hidden', () => {
  const ex = explain({ facts: facts({ twoDayPct: -1.5 }), headlines: [h('Gold steady as rate cut hopes grow')], nowMs: NOW });
  assert.equal(ex.why[0].id, 'fed');
  assert.match(ex.why[0].text, /But gold still fell over the last two days, so other things probably mattered more\./);
  const flat = explain({ facts: facts({ twoDayPct: 0.1 }), headlines: [h('Gold steady as rate cut hopes grow')], nowMs: NOW });
  assert.doesNotMatch(flat.why[0].text, /fits|other things/);
});

test('no-news path: says news is unavailable and explains only the numbers', () => {
  const ex = explain({ facts: facts({}), headlines: null, nowMs: NOW });
  assert.equal(ex.newsAvailable, false);
  assert.match(ex.whyIntro, /News is unavailable right now/);
  assert.deepEqual(ex.why, []);
  assert.ok(ex.happened.length >= 2);
  assert.deepEqual(ex.nextUp, [THEME_TEXT.fed.nextUp, THEME_TEXT.dollar.nextUp]);
  assert.match(ex.nextNote, /interest rates and the US dollar/);
});

test('empty news and unthemed news paths', () => {
  assert.match(explain({ facts: facts({}), headlines: [], nowMs: NOW }).whyIntro, /could not find any gold news/);
  const ex = explain({ facts: facts({}), headlines: [h('Gold price today: what you need to know')], nowMs: NOW });
  assert.match(ex.whyIntro, /do not point to one clear reason/);
  assert.deepEqual(ex.why, []);
});

const dm = (pct: number): DollarMove => ({ fromDate: '2026-11-12', toDate: '2026-11-19', from: 100, to: 100 * (1 + pct / 100), pct });

test('dollar fact sentence and data-based dollar reason', () => {
  assert.equal(
    dollarSentence(dm(0.8)),
    'The US dollar is 0.8% stronger than a week earlier against other big currencies (12 Nov to 19 Nov, from European Central Bank rates). A stronger dollar usually pushes gold down.'
  );
  assert.match(dollarSentence(dm(-0.5))!, /0\.5% weaker .* usually helps gold\./);
  assert.match(dollarSentence(dm(0.05))!, /almost unchanged/);
  assert.equal(dollarSentence(null), null);

  const ex = explain({ facts: facts({ twoDayPct: -1 }), headlines: null, dollar: dm(0.9), nowMs: NOW });
  assert.equal(ex.why.length, 1);
  assert.equal(ex.why[0].fromData, true);
  assert.equal(ex.why[0].lean, 'down');
  assert.match(ex.why[0].text, /Currency data shows the dollar got 0\.9% stronger/);
  assert.match(ex.whyIntro, /News is unavailable right now, so we can only go by the numbers/);
  assert.ok(ex.dollarFact);
  // Small dollar moves are not presented as a reason.
  assert.equal(explain({ facts: facts({}), headlines: null, dollar: dm(0.2), nowMs: NOW }).why.length, 0);
  // Not duplicated when the news already covers the dollar.
  const both = explain({ facts: facts({}), headlines: [h('Gold falls as dollar firms')], dollar: dm(0.9), nowMs: NOW });
  assert.equal(both.why.filter((w) => w.id === 'dollar').length, 1);
});

test('near a one-year high adds a balanced pair of next-step lines', () => {
  const ex = explain({ facts: facts({ fromHighPct: -0.5 }), headlines: null, nowMs: NOW });
  assert.ok(ex.nextUp.some((s) => /one-year high/.test(s)));
  assert.ok(ex.nextDown.some((s) => /one-year high/.test(s)));
  assert.equal(ex.nextUp.length, ex.nextDown.length);
});

test('text never claims certainty', () => {
  const all = [
    ...Object.values(THEME_TEXT).flatMap((t) => Object.values(t)),
    ...explain({ facts: facts({}), headlines: [h('Gold falls as dollar firms')], dollar: dm(1), nowMs: NOW }).nextUp,
  ].join(' ');
  assert.doesNotMatch(all, /\b(will (rise|fall|go)|guarantee\w*|certainly|for sure gold)\b/i);
});

test('no price history: explanation still renders safely', () => {
  const ex = explain({ facts: null, headlines: [h('Gold rises as dollar weakens')], nowMs: NOW });
  assert.equal(ex.mood, 'unknown');
  assert.deepEqual(ex.happened, []);
  assert.equal(ex.why[0].id, 'dollar');
  assert.doesNotMatch(ex.why[0].text, /fits|other things/);
});

test('at or near the one-year low says so plainly', () => {
  const at = explain({ facts: facts({ fromHighPct: -30, fromLowPct: 0 }), headlines: null, nowMs: NOW });
  assert.equal(at.happened[2], "This is the lowest price of the past year. It is 30.0% below the year's highest.");
  const near = explain({ facts: facts({ fromHighPct: -30, fromLowPct: 0.6 }), headlines: null, nowMs: NOW });
  assert.match(near.happened[2], /^It is very close to its lowest price of the past year, and 30\.0% below/);
  assert.ok(at.nextUp.some((s) => /one-year low/.test(s)) && at.nextDown.some((s) => /one-year low/.test(s)));
});

// ---------------------------------------------------------------- review regressions

test('a topic only next to a gold move is never given a made-up direction or cause', () => {
  const ex = explain({ facts: facts({ twoDayPct: 1 }), headlines: [h('Gold rises ahead of Fed meeting')], nowMs: NOW });
  const w = ex.why.find((x) => x.id === 'fed')!;
  assert.equal(w.lean, 'unclear');
  assert.doesNotMatch(w.text, /rate cuts|lower interest rates|fits with/, 'must not claim the news talks about rate cuts');
  assert.match(w.text, /does not clearly point one way\. Some headlines mention it next to gold going up, but they do not say how/);
  const [t] = detectThemes([h('Gold rises ahead of Fed meeting')], NOW);
  assert.deepEqual([t.lean, t.linked, t.mentions], ['unclear', 'up', 1]);
});

test('mixed topics say so; unclear topics do not invent "signs both ways"', () => {
  const ex = explain({ facts: facts({}), headlines: [h('Gold rises as tensions flare'), h('Ceasefire hopes cap gold', 3)], nowMs: NOW });
  const w = ex.why.find((x) => x.id === 'geopolitics')!;
  assert.equal(w.lean, 'mixed');
  assert.match(w.text, /Some headlines point one way and some the other\./);
  assert.doesNotMatch(THEME_TEXT.geopolitics.unclear + THEME_TEXT.trade.unclear + THEME_TEXT.riskMood.unclear, /both ways/);
});

test('trade wars and trade tensions are trade, not war', () => {
  const ids = (t: string) => classifyHeadline(t).map((m) => m.id);
  assert.deepEqual(ids('Gold climbs as trade war escalates'), ['trade']);
  assert.deepEqual(ids('Gold steady amid trade tensions'), ['trade']);
  assert.ok(ids('Gold gains as tariff war heats up').includes('trade'));
  assert.ok(!ids('Gold gains as tariff war heats up').includes('geopolitics'));
  assert.equal(lean('Gold jumps as war in Middle East widens', 'geopolitics'), 'up');
});

test('"no rate cut" and doubts about cuts are bad for gold, not good', () => {
  assert.equal(lean('Fed signals no rate cut in December, gold slips', 'fed'), 'down');
  assert.equal(lean('Doubts over December rate cut weigh on gold', 'fed'), 'down');
  assert.equal(lean('Fed official argues against a rate cut', 'fed'), 'down');
  assert.equal(lean('Gold climbs as rate cut hopes grow', 'fed'), 'up', 'unchanged');
});

test('each news topic reports how many headlines it came from', () => {
  const items = [h('Gold falls as dollar firms'), h('Dollar rallies to two-week high'), h('Gold price today: what to know')];
  const ex = explain({ facts: facts({}), headlines: items, nowMs: NOW });
  assert.equal(ex.headlineCount, 3);
  assert.equal(ex.why[0].id, 'dollar');
  assert.equal(ex.why[0].mentions, 2);
  assert.equal(explain({ facts: null, headlines: null, nowMs: NOW }).headlineCount, 0);
});

test('news about the dollar is shown next to the measured dollar move', () => {
  const ex = explain({ facts: facts({}), headlines: [h('Gold gains as dollar weakens')], dollar: dm(0.6), nowMs: NOW });
  const w = ex.why.find((x) => x.id === 'dollar')!;
  assert.equal(w.fromData, false);
  assert.match(w.text, /Measured currency data: the dollar is 0\.6% stronger than a week earlier\./);
  const tiny = explain({ facts: facts({}), headlines: [h('Gold gains as dollar weakens')], dollar: dm(0.05), nowMs: NOW });
  assert.doesNotMatch(tiny.why[0].text, /Measured currency data/);
});

test('priceFacts tolerates unsorted and duplicate-date input', () => {
  const s = mkSeries(400, (i) => 1000 + i);
  const shuffled = [...s.slice(200), ...s.slice(0, 200)];
  const dup = [...s, { date: s[s.length - 1].date, usd: 1500 }];
  assert.deepEqual(priceFacts(shuffled), priceFacts(s));
  close(priceFacts(dup)!.last, 1500);
  close(priceFacts(dup)!.todayPct, (1500 / 1398 - 1) * 100);
  assert.equal(priceFacts([{ date: 'bad', usd: 1 }, { date: '2026-01-01', usd: -5 }] as DailyBar[]), null);
});

test('user-facing text avoids harder words', () => {
  const all = [
    ...Object.values(THEME_TEXT).flatMap((t) => Object.values(t)),
    ...explain({ facts: facts({ fromHighPct: -30, fromLowPct: 0.5 }), headlines: [h('Gold falls as dollar firms')], dollar: dm(1), nowMs: NOW }).nextUp,
    dollarSentence(dm(1))!,
  ].join(' ');
  assert.doesNotMatch(all, /\b(weighs?|attractive|bargain|monetary|geopolitic\w*|accumulat\w*)\b/i);
});
