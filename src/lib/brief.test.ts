import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, buildVerifyPrompt, factsText, parseAiNews, parseGoogleNewsRss, parseVerdict, ruleParagraph, sanitizeBrief, sanitizeExplainer, validateAiParagraph } from './brief';
import { buildExplainer, LESSONS } from './teach';
import { explainerHtml, whatsappExplainer } from './alertMessages';
import { explain, priceFacts } from './explain';
import type { DailyBar } from './forecast/types';

const series: DailyBar[] = Array.from({ length: 400 }, (_, i) => {
  const d = new Date(Date.UTC(2025, 9, 16) + i * 86400000).toISOString().slice(0, 10);
  return { date: d, usd: 3000 + 600 * Math.sin(i / 60) + i };
});
const nowMs = Date.parse(series[series.length - 1].date + 'T12:00:00Z');
const headlines = [
  { title: 'Gold falls as Fed signals rates to stay higher for longer', source: 'Reuters', link: 'https://example.com/a', publishedAt: new Date(nowMs - 3600e3).toISOString() },
  { title: 'Gold slips as dollar strengthens ahead of US jobs report', source: 'CNBC', link: 'https://example.com/b', publishedAt: new Date(nowMs - 7200e3).toISOString() },
];
const e = explain({ facts: priceFacts(series), headlines, dollar: null, nowMs });

test('rule paragraph is one paragraph of sensible length, with the move and a caveat', () => {
  const p = ruleParagraph(e);
  assert.ok(!p.includes('\n'));
  const words = p.split(' ').length;
  assert.ok(words > 60 && words < 320, `words=${words}`);
  assert.match(p, /Nobody can know for sure which way gold will go next\.$/);
  assert.match(p, /Why\? Most gold news right now is about/);
  assert.ok(p.startsWith(e.headline));
});

test('prompt carries facts and headlines, and forbids invented numbers', () => {
  const { system, user } = buildPrompt(e, headlines, '2026-11-20T10:00:00Z');
  assert.match(system, /Return JSON only/);
  assert.match(system, /never invent numbers/);
  assert.match(system, /short sentences/);
  assert.match(user, /Fed signals rates/);
  assert.ok(user.includes(e.headline));
});

test('AI paragraph validator: accepts simple grounded text; rejects invented numbers, jargon, long sentences, links, advice', () => {
  const allowed = 'Gold is down 2.4% over the past week. It now costs about AED 422.43 per gram.';
  const good = [
    'Gold is down 2.4% over the past week.', 'It now costs about AED 422.43 per gram.',
    'Reports say the Fed may keep interest rates high for longer.', 'The Fed is America\'s central bank, and it sets US interest rates.',
    'Gold does not pay any interest.', 'So when interest rates stay high, savings accounts and bonds look more attractive than gold.',
    'That can make some investors sell gold.', 'News outlets also say the US dollar got stronger this week.',
    'Gold is priced in dollars, so a stronger dollar makes it more expensive for buyers in other countries.',
    'That can lower demand and pull the price down.', 'Next, people are watching the US jobs report mentioned in the news.',
    'A weak report could make rate cuts more likely, which could help gold.', 'A strong report could do the opposite and push gold lower.',
    'Nobody can know for sure which way gold will go next.',
  ].join(' ');
  assert.equal(typeof validateAiParagraph(good, allowed), 'string');
  assert.equal(validateAiParagraph(good.replace('2.4%', '3.7%'), allowed), null, 'invented percentage');
  assert.equal(validateAiParagraph(good.replace('Gold does not pay any interest.', 'Gold is hurt by hawkish talk.'), allowed), null, 'jargon');
  assert.equal(validateAiParagraph(good.replace('Gold does not pay any interest.', 'Gold does not pay any interest and that is a very important thing to remember because it means that holding it has a cost compared with keeping money in a bank account that pays something every single month to you.'), allowed), null, 'overlong sentence');
  assert.equal(validateAiParagraph(good + ' See https://x.com', allowed), null, 'link');
  assert.equal(validateAiParagraph(good.replace('Next, people', 'You should buy now. Next, people'), allowed), null, 'advice');
  assert.equal(validateAiParagraph('Too short.', allowed), null);
  assert.equal(validateAiParagraph(42, allowed), null);
});

test('fact-check verdict parsing is fail-closed', () => {
  assert.deepEqual(parseVerdict('{"supported": true, "issues": []}'), { supported: true, issues: [] });
  assert.equal(parseVerdict('Sure! {"supported": true, "issues": ["adds a date"]}').supported, false);
  assert.equal(parseVerdict('{"supported": "yes"}').supported, false);
  assert.equal(parseVerdict('not json').supported, false);
  assert.equal(parseVerdict(undefined).supported, false);
  const v = buildVerifyPrompt('Gold fell.', e, headlines);
  assert.match(v.system, /strict fact-checker/);
  assert.match(v.user, /PARAGRAPH:\nGold fell\./);
});

test('factsText includes every sentence the AI may rely on', () => {
  const t = factsText(e);
  for (const s of e.happened) assert.ok(t.includes(s));
});

test('sanitizeBrief rejects junk and unsafe links', () => {
  assert.equal(sanitizeBrief(null), null);
  assert.equal(sanitizeBrief({ generatedAt: 'x', nextUpdateAt: 'y', paragraph: 'a' }), null);
  const b = sanitizeBrief({
    generatedAt: '2026-11-20T08:00:00Z', nextUpdateAt: '2026-11-20T12:00:00Z',
    paragraph: '<b>Gold</b> fell this week as reports said rates may stay high for longer, and the dollar rose.',
    source: 'ai', model: 'm', headlines: [{ title: 'T', source: 'S', link: 'javascript:alert(1)', publishedAt: 'bad' }],
  });
  assert.ok(b);
  assert.ok(!b!.paragraph.includes('<b>'));
  assert.equal(b!.headlines[0].link, null);
  assert.equal(b!.headlines[0].publishedAt, null);
});

test('Google News RSS parser: titles, source, dates, safe links, age filter', () => {
  const now = Date.parse('2026-11-20T10:00:00Z');
  const xml = `<rss><channel>
<item><title>Gold set for worst week as firm dollar weighs &amp; Fed bets - Reuters</title><link>https://news.google.com/rss/articles/abc?oc=5</link><pubDate>Fri, 20 Nov 2026 07:00:00 GMT</pubDate><source url="https://www.reuters.com">Reuters</source></item>
<item><title>&lt;script&gt;x&lt;/script&gt;Old story - Site</title><link>javascript:alert(1)</link><pubDate>Mon, 09 Nov 2026 07:00:00 GMT</pubDate></item>
<item><title>Gold steadies - Kitco</title><link>javascript:alert(1)</link><pubDate>Fri, 20 Nov 2026 08:00:00 GMT</pubDate></item>
</channel></rss>`;
  const h = parseGoogleNewsRss(xml, now);
  assert.equal(h.length, 2, 'old item dropped');
  assert.equal(h[0].title, 'Gold set for worst week as firm dollar weighs & Fed bets');
  assert.equal(h[0].source, 'Reuters');
  assert.equal(h[0].publishedAt, '2026-11-20T07:00:00.000Z');
  assert.match(h[0].link ?? '', /^https:\/\/news\.google\.com\//);
  assert.equal(h[1].link, null, 'javascript: link removed');
  assert.equal(h[1].source, 'Kitco');
});

test('rule paragraph keeps acronyms like US', () => {
  const e2 = { ...e, why: [{ id: 'dollar' as const, label: 'The US dollar (currency data)', lean: 'down' as const, text: 'Currency data shows the dollar got stronger.', headlines: [], mentions: 0, fromData: true }] };
  assert.match(ruleParagraph(e2), /news right now is about the US dollar\./);
});

test('polish: dedupe + Fed explanation', async () => {
  const { polish } = await import('./brief');
  const t = polish('That fits. If the Fed cuts rates, gold could rise. That fits. If the Fed waits, gold could fall.');
  assert.equal((t.match(/That fits\./g) ?? []).length, 1);
  assert.match(t, /the Fed \(America's central bank, which sets US interest rates\) cuts/);
  assert.equal((t.match(/America's central bank/g) ?? []).length, 1);
});

test('AI news JSON: valid pieces kept, invented numbers or unknown topics dropped', () => {
  const allowed = factsText(e) + ' 2.4%';
  const raw = JSON.stringify({
    summary: 'Gold fell this week. Reports say the Fed, America\'s central bank, may keep interest rates high. A stronger dollar also weighed on the price, according to news outlets.',
    topics: { fed: 'Reports say the Fed may keep US interest rates high for longer. That makes savings pay more than gold does.', dollar: 'News outlets say the dollar rose 9.9% this week.', bogus: 'x' },
  });
  const ids = e.why.map((w) => w.id);
  const r = parseAiNews('Here you go: ' + raw, allowed, ids);
  assert.ok(r.summary && r.summary.startsWith('Gold fell this week.'));
  if (ids.includes('fed')) assert.ok(r.whatHappened.fed);
  assert.equal(r.whatHappened.dollar, undefined, 'invented 9.9% rejected');
  assert.deepEqual(parseAiNews('not json', allowed, ids), { summary: null, whatHappened: {} });
});

test('explainer: teaching chains come from the fixed library, with a note when the usual effect did not happen', () => {
  const x = buildExplainer(e, null, 0);
  assert.ok(x.summary.length > 20 && x.happened.length > 20);
  for (const d of x.drivers) {
    assert.deepEqual(d.steps, d.direction === 'up' ? LESSONS[d.id].up : d.direction === 'down' ? LESSONS[d.id].down : d.steps);
    assert.equal(d.analogy, LESSONS[d.id].analogy);
  }
  assert.ok(x.lesson.title && x.lesson.body);
  assert.match(x.forYou, /fixed amount every month/);
  const forced = buildExplainer({ ...e, mood: 'down', why: [{ id: 'riskMood', label: 'Stock market mood', lean: 'up', text: 't', headlines: [], mentions: 1, fromData: false }] }, null);
  assert.match(forced.drivers[0].note ?? '', /sell gold to raise cash/);
});

test('explainer survives brief.json round-trip; tampered fields are cleaned', () => {
  const x = buildExplainer(e, null, 0);
  const back = sanitizeExplainer(JSON.parse(JSON.stringify(x)));
  assert.deepEqual(back?.drivers.map((d) => d.id), x.drivers.map((d) => d.id));
  const bad = sanitizeExplainer({ ...x, summary: '<script>alert(1)</script> Gold went down a lot this week.', drivers: [{ id: 'notATopic' }, { ...x.drivers[0], icon: '<img>' }] });
  assert.ok(bad && !bad.summary.includes('<script>'));
  assert.equal(bad!.drivers.length, 1);
  assert.equal(bad!.drivers[0].icon, LESSONS[x.drivers[0].id].icon, 'icon comes from our library, not the file');
});

test('WhatsApp explainer stays within its length cap; email HTML escapes content', () => {
  const x = buildExplainer(e, null, 0);
  assert.ok(whatsappExplainer(x, 900).length <= 900);
  const html = explainerHtml({ ...x, summary: '<b>bold</b> summary text here' }, true);
  assert.ok(html.includes('&lt;b&gt;bold'));
  assert.ok(html.includes('Today'));
});
