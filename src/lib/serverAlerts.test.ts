import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, evaluateServerAlerts, sanitizeConfig, sanitizeState, type Facts } from './serverAlerts';

const facts = (p: number, extra: Partial<Facts> = {}): Facts => ({
  price24: p, prevClose24: 400, high52: 450, low52: 350, sma200: 400, day: '2026-11-20', marketOpen: true, ...extra,
});
const cfg = sanitizeConfig({ targets: [{ id: 't1', dir: 'above', aedPerGram24k: 430 }], dailyMovePct: 2, yearHighLow: true, trendCross: true, rearmPct: 1 });

test('target fires once, re-arms only after moving back past the buffer', () => {
  let s = sanitizeState({});
  let r = evaluateServerAlerts(cfg, s, facts(431, { prevClose24: 430 }));
  assert.deepEqual(r.events.filter((e) => e.kind === 'target').length, 1);
  s = r.state;
  r = evaluateServerAlerts(cfg, s, facts(432, { prevClose24: 431 }));
  assert.equal(r.events.filter((e) => e.kind === 'target').length, 0, 'no repeat while above');
  r = evaluateServerAlerts(cfg, r.state, facts(428, { prevClose24: 431 })); // within 1% buffer
  assert.equal(r.state.armed.t1, false);
  r = evaluateServerAlerts(cfg, r.state, facts(425, { prevClose24: 428 })); // >1% back
  assert.equal(r.state.armed.t1, true);
  r = evaluateServerAlerts(cfg, r.state, facts(430.5, { prevClose24: 428 }));
  assert.equal(r.events.filter((e) => e.kind === 'target').length, 1, 'fires again after re-arm');
});

test('daily move alert once per day, both directions', () => {
  const r = evaluateServerAlerts(cfg, sanitizeState({}), facts(409));
  assert.ok(r.events.some((e) => e.kind === 'move' && Math.abs(e.pct - 2.25) < 1e-9));
  const r2 = evaluateServerAlerts(cfg, r.state, facts(412));
  assert.equal(r2.events.filter((e) => e.kind === 'move').length, 0);
  const r3 = evaluateServerAlerts(cfg, r.state, facts(391, { day: '2026-11-21' }));
  assert.ok(r3.events.some((e) => e.kind === 'move' && e.pct < 0));
});

test('year high/low and trend cross', () => {
  const r = evaluateServerAlerts(cfg, sanitizeState({ trendSide: 'below' }), facts(455, { prevClose24: 450 }));
  const kinds = r.events.map((e) => e.kind).sort();
  assert.deepEqual(kinds, ['target', 'trend', 'yearHigh']);
  const low = evaluateServerAlerts(cfg, sanitizeState({ trendSide: 'below' }), facts(349, { prevClose24: 350 }));
  assert.ok(low.events.some((e) => e.kind === 'yearLow'));
  assert.ok(!low.events.some((e) => e.kind === 'trend'), 'no trend event when side unchanged');
});

test('market closed: only price targets are checked', () => {
  const r = evaluateServerAlerts(cfg, sanitizeState({}), facts(460, { marketOpen: false }));
  assert.deepEqual(r.events.map((e) => e.kind), ['target']);
});

test('config and state sanitizers reject junk', () => {
  const c = sanitizeConfig({ targets: [{ dir: 'up', aedPerGram24k: 1 }, { dir: 'below', aedPerGram24k: -3 }, { dir: 'below', aedPerGram24k: 400 }], dailyMovePct: 'x', yearHighLow: 'yes' });
  assert.equal(c.targets.length, 1);
  assert.equal(c.dailyMovePct, DEFAULT_CONFIG.dailyMovePct);
  assert.equal(c.yearHighLow, true);
  assert.deepEqual(sanitizeConfig(null).targets, []);
  assert.equal(sanitizeConfig({ dailyMovePct: null }).dailyMovePct, null);
  const s = sanitizeState({ armed: { a: true, b: 'no' }, lastMoveDay: 'bad', trendSide: 'sideways' });
  assert.deepEqual(s, { armed: { a: true }, lastMoveDay: undefined, lastHighDay: undefined, lastLowDay: undefined, trendSide: undefined });
});
