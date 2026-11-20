import test from 'node:test';
import assert from 'node:assert/strict';
import { chartSvg, greeting, isOurUpdate, newUpdateMessageId, renderEmailHtml, renderSubject, renderWhatsApp, shortBrief, THREAD_ROOT, type AlertContext } from './alertMessages';

const ctx: AlertContext = {
  events: [{ kind: 'target', id: 't', dir: 'above', target: 440 }, { kind: 'move', pct: 2.4 }],
  price24: 441.2, prevClose24: 430.9,
  closes30: Array.from({ length: 30 }, (_, i) => 420 + i * 0.7),
  targets: [{ dir: 'above', aedPerGram24k: 440 }],
  quoteAt: '2026-11-20T09:00:00Z', siteUrl: 'https://example.org/app/', configUrl: 'https://example.org/edit',
};

test('subject and WhatsApp carry price, event and change', () => {
  const s = renderSubject(ctx);
  assert.match(s, /441\.20 AED\/g/);
  assert.match(s, /\+1 more/);
  const w = renderWhatsApp(ctx);
  assert.match(w, /\*AED 441\.20\/g\*/);
  assert.match(w, /▲ \+2\.39% today/);
  assert.match(w, /22K: AED 404\.43\/g/);
  assert.match(w, /13:00 \(Dubai\)/);
});

test('email HTML escapes injected text and references the inline chart', () => {
  const html = renderEmailHtml({ ...ctx, siteUrl: 'https://x.org/"><script>alert(1)</script>' });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('cid:chart'));
  assert.ok(html.includes('Gold reached your target'));
});

test('chart svg is well-formed and includes the target line', () => {
  const svg = chartSvg(ctx.closes30, ctx.targets);
  assert.ok(svg.startsWith('<svg') && svg.trim().endsWith('</svg>'));
  assert.match(svg, /Target 440/);
  assert.ok(!/NaN|Infinity/.test(svg));
});

test('morning summary subject and the why-paragraph in both channels', () => {
  const brief = 'Gold is down 2.4% this week. Reports say US interest rates may stay high. Gold pays no interest, so high rates make it less attractive. The dollar also got stronger. That makes gold cost more for buyers abroad. People are now watching the next US jobs report.';
  const d = { ...ctx, events: [{ kind: 'daily' as const }], brief };
  assert.match(renderSubject(d), /^🟡 Gold now: AED 441\.20\/g \(▲ \+2\.39% today\)$/);
  assert.match(renderWhatsApp(d), /\*Why gold is moving\*/);
  assert.ok(renderEmailHtml(d).includes('Why gold is moving'));
  assert.ok(renderEmailHtml({ ...d, brief: '<img src=x onerror=alert(1)>' }).includes('&lt;img'));
  assert.ok(shortBrief(brief, 20).split(' ').length <= 25);
  assert.ok(!renderWhatsApp(ctx).includes('Why gold is moving'), 'no brief section when absent');
});

test('one-thread email identity: our Message-IDs are recognised, nothing else is', () => {
  const id = newUpdateMessageId(1795176589000, 0.5);
  assert.ok(isOurUpdate(id));
  assert.notEqual(id, newUpdateMessageId(1795176589000, 0.6));
  for (const other of [THREAD_ROOT, '<CAF=abc@mail.gmail.com>', '<gold-update-x@evil.com>', 'gold-update-1@gmail.com', '', null, undefined]) {
    assert.equal(isOurUpdate(other as string), false, String(other));
  }
});

test('personal greeting: briefing vs alert, name cleaned, safe in HTML', () => {
  const daily = { ...ctx, events: [{ kind: 'daily' as const }], name: 'Hasnain' };
  assert.equal(greeting(daily), 'Gold for you today, Hasnain!');
  assert.equal(greeting({ ...ctx, name: 'Hasnain' }), 'Gold alert for you, Hasnain!');
  assert.equal(greeting({ ...daily, name: '' }), 'Gold for you today!');
  assert.equal(greeting({ ...daily, name: '<script>x</script>Ali' }), 'Gold for you today, scriptxscriptAli!');
  assert.ok(renderEmailHtml(daily).includes('Gold for you today, Hasnain!'));
  assert.match(renderWhatsApp(daily), /^🟡 \*Gold for you today, Hasnain!\*/);
});
