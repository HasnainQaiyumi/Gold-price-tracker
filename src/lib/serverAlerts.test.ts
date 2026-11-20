import test from 'node:test';
import assert from 'node:assert/strict';
import { summaryDue, summarySlot, DEFAULT_CONFIG, dubaiClock, evaluateServerAlerts, freshState, inQuietHours, parseTargetsText, parseTargetsTextDetailed, sanitizeConfig, sanitizeState, settingsFromEnv, type Facts } from './serverAlerts';

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
  assert.deepEqual(s, { armed: { a: true }, lastMoveDay: undefined, lastHighDay: undefined, lastLowDay: undefined, trendSide: undefined, lastDailyDay: undefined, lastSummarySlot: undefined });
});

test('plain-text targets are parsed forgivingly', () => {
  assert.deepEqual(parseTargetsText('above 445, below 400').map((r) => [r.dir, r.aedPerGram24k]), [['above', 445], ['below', 400]]);
  assert.deepEqual(parseTargetsText('rise 450.5; falls 390\n> 460').map((r) => [r.dir, r.aedPerGram24k]), [['above', 450.5], ['below', 390], ['above', 460]]);
  assert.deepEqual(parseTargetsText('hello, 445, sideways 300'), []);
  assert.deepEqual(parseTargetsText('below 400 or above 445').map((r) => [r.dir, r.aedPerGram24k]), [['below', 400], ['above', 445]]);
  assert.deepEqual(parseTargetsText('above 445 and below 400').map((r) => [r.dir, r.aedPerGram24k]), [['above', 445], ['below', 400]]);
  assert.deepEqual(parseTargetsText('above 4,450').map((r) => r.aedPerGram24k), [4450]);
  assert.deepEqual(parseTargetsTextDetailed('above 445 below 400, 420').skipped, ['above 445 below 400', '420']);
});

test('settings from repository variables override the file, junk keeps defaults', () => {
  const file = sanitizeConfig({ targets: [{ dir: 'above', aedPerGram24k: 500 }] });
  const a = settingsFromEnv({ ALERT_TARGETS: 'below 410', ALERT_DAILY_MOVE: 'off', DAILY_SUMMARY: 'both', DAILY_SUMMARY_HOUR: '9', WHATSAPP_QUIET_HOURS: '22-6' }, file);
  assert.deepEqual(a.config.targets.map((x) => x.aedPerGram24k), [410]);
  assert.equal(a.config.dailyMovePct, null);
  assert.deepEqual(a.notify, { daily: 'both', dailyHourDubai: 9, everyHours: 8, quietHours: [22, 6] });
  const b = settingsFromEnv({ DAILY_SUMMARY: 'sms', DAILY_SUMMARY_HOUR: '99', WHATSAPP_QUIET_HOURS: 'nights' }, file);
  assert.deepEqual(b.config.targets.map((x) => x.aedPerGram24k), [500], 'empty variable keeps file targets');
  assert.deepEqual(b.notify, { daily: 'email', dailyHourDubai: 8, everyHours: 8, quietHours: [23, 7] });
  assert.equal(settingsFromEnv({ SUMMARY_EVERY_HOURS: '6' }, file).notify.everyHours, 6);
  assert.equal(settingsFromEnv({ SUMMARY_EVERY_HOURS: '5' }, file).notify.everyHours, 8, 'must divide 24');
  assert.equal(settingsFromEnv({ WHATSAPP_QUIET_HOURS: 'off' }, file).notify.quietHours, null);
});

test('Dubai clock, quiet hours and 8-hourly briefing slots', () => {
  const t = Date.parse('2026-11-20T03:30:00Z'); // 07:30 Dubai
  assert.deepEqual(dubaiClock(t), { hour: 7, date: '2026-11-20' });
  assert.equal(inQuietHours(23, [23, 7]), true);
  assert.equal(inQuietHours(6, [23, 7]), true);
  assert.equal(inQuietHours(7, [23, 7]), false);
  assert.equal(inQuietHours(12, null), false);
  const n = { daily: 'email' as const, dailyHourDubai: 8, everyHours: 8, quietHours: null };
  // slots: midnight, 8am, 4pm Dubai
  assert.equal(summarySlot(t, n), '2026-11-20T00', '07:30 belongs to the midnight slot');
  assert.equal(summarySlot(Date.parse('2026-11-20T04:05:00Z'), n), '2026-11-20T08');
  assert.equal(summarySlot(Date.parse('2026-11-20T12:30:00Z'), n), '2026-11-20T16');
  assert.equal(summarySlot(Date.parse('2026-11-20T19:59:00Z'), n), '2026-11-20T16', '23:59 Dubai');
  assert.equal(summarySlot(Date.parse('2026-11-20T20:01:00Z'), n), '2026-11-21T00', 'midnight Dubai');
  const t2 = Date.parse('2026-11-20T04:05:00Z');
  assert.equal(summaryDue({ armed: {} }, t2, n), true);
  assert.equal(summaryDue({ armed: {}, lastSummarySlot: '2026-11-20T08' }, t2, n), false, 'once per slot');
  assert.equal(summaryDue({ armed: {}, lastSummarySlot: '2026-11-20T08' }, Date.parse('2026-11-20T12:01:00Z'), n), true, 'next slot at 4pm');
  assert.equal(summaryDue({ armed: {} }, t2, { ...n, daily: 'off' }), false);
  assert.equal(sanitizeState({ lastSummarySlot: 'nope' }).lastSummarySlot, undefined);
});

test('fresh memory does not re-fire targets that are already crossed', () => {
  const c = sanitizeConfig({ targets: [{ id: 'a', dir: 'above', aedPerGram24k: 420 }, { id: 'b', dir: 'below', aedPerGram24k: 400 }] });
  const s = freshState(c, 430);
  assert.deepEqual(s.armed, { a: false, b: true });
  assert.equal(evaluateServerAlerts(c, s, facts(431, { prevClose24: 430 })).events.filter((e) => e.kind === 'target').length, 0);
});
