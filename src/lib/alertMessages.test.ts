import test from 'node:test';
import assert from 'node:assert/strict';
import { chartSvg, renderEmailHtml, renderSubject, renderWhatsApp, type AlertContext } from './alertMessages';

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
