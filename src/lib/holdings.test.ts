import test from 'node:test';
import assert from 'node:assert/strict';
import { holdingsTotal, holdingStats, sanitizeHoldings } from './holdings';
import { SELL_HAIRCUT } from './savingsPlan';
import { evaluateAlerts, sanitizeAlerts } from './alerts';
import { fmtAed, usdOzToAed, TROY_OZ_GRAMS, AED_PEG } from './goldPricing';

const SPOT = 3500; // USD/oz
const aedG = (SPOT / TROY_OZ_GRAMS) * AED_PEG; // 24K AED/g

test('karat and unit conversion is exact', () => {
  assert.ok(Math.abs(usdOzToAed(SPOT, 24, 1) - aedG) < 1e-9);
  assert.ok(Math.abs(usdOzToAed(SPOT, 22, 10) - aedG * (22 / 24) * 10) < 1e-9);
  assert.ok(Math.abs(usdOzToAed(SPOT, 24, TROY_OZ_GRAMS) - SPOT * AED_PEG) < 1e-9);
});

test('holding value: 10g of 22K', () => {
  const s = holdingStats({ id: 'a', grams: 10, karat: 22, paidAed: 4000 }, SPOT);
  const fine = 10 * (22 / 24);
  assert.ok(Math.abs(s.fineGrams - fine) < 1e-9);
  assert.ok(Math.abs(s.spotValue - fine * aedG) < 1e-6);
  assert.ok(Math.abs(s.sellValue - fine * aedG * (1 - SELL_HAIRCUT)) < 1e-6);
  assert.ok(Math.abs((s.pl as number) - (s.sellValue - 4000)) < 1e-6);
});

test('break-even price makes P/L zero', () => {
  const h = { id: 'a', grams: 5, karat: 24 as const, paidAed: 2300 };
  const be = holdingStats(h, SPOT).breakEven24 as number; // AED/g 24K
  const spotAtBE = (be / AED_PEG) * TROY_OZ_GRAMS;
  assert.ok(Math.abs(holdingStats(h, spotAtBE).pl as number) < 1e-6);
});

test('unknown cost gives no P/L; totals ignore unknown-cost items in P/L', () => {
  const hs = [
    { id: '1', grams: 10, karat: 24 as const, paidAed: 0 },
    { id: '2', grams: 10, karat: 24 as const, paidAed: 4000 },
  ];
  assert.equal(holdingStats(hs[0], SPOT).pl, null);
  const t = holdingsTotal(hs, SPOT);
  assert.ok(Math.abs((t.pl as number) - (holdingStats(hs[1], SPOT).sellValue - 4000)) < 1e-6);
  assert.equal(t.paid, 4000);
});

test('alerts fire once, in the right direction', () => {
  const al = [
    { id: 'u', dir: 'above' as const, target: 420 },
    { id: 'd', dir: 'below' as const, target: 400 },
  ];
  const r1 = evaluateAlerts(al, 410, 't1');
  assert.equal(r1.newlyFired.length, 0);
  assert.strictEqual(r1.alerts, al);
  const r2 = evaluateAlerts(al, 421, 't2');
  assert.deepEqual(r2.newlyFired.map((a) => a.id), ['u']);
  const r3 = evaluateAlerts(r2.alerts, 430, 't3'); // already fired: no repeat
  assert.equal(r3.newlyFired.length, 0);
  assert.deepEqual(evaluateAlerts(al, 400, 't4').newlyFired.map((a) => a.id), ['d']);
});

test('fmtAed', () => {
  assert.equal(fmtAed(423.745), '423.75'.replace('75', '75')); // 2 decimals under 1000
  assert.equal(fmtAed(13180.4), '13,180');
});

test('sanitizers drop tampered or malformed stored data', () => {
  const bad = [
    { id: 'ok', grams: 10, karat: 22, paidAed: 100 },
    { id: 'x', grams: -5, karat: 22, paidAed: 1 },
    { id: 'y', grams: 5, karat: 99, paidAed: 1 },
    { id: 'z', grams: '5', karat: 24, paidAed: 1 },
    { id: 'n', grams: NaN, karat: 24, paidAed: 1 },
    null,
    'junk',
  ];
  assert.deepEqual(sanitizeHoldings(bad).map((h) => h.id), ['ok']);
  assert.deepEqual(sanitizeHoldings({ not: 'array' }), []);
  assert.equal(sanitizeHoldings(Array.from({ length: 500 }, (_, i) => ({ id: String(i), grams: 1, karat: 24, paidAed: 1 }))).length, 50);
  const al = sanitizeAlerts([
    { id: 'a', dir: 'above', target: 400, firedAt: 'not a date' },
    { id: 'b', dir: 'sideways', target: 400 },
    { id: 'c', dir: 'below', target: Infinity },
    { id: 'd', dir: 'below', target: 380, firedAt: '2026-11-20T10:00:00Z' },
  ]);
  assert.deepEqual(al.map((a) => a.id), ['a', 'd']);
  assert.equal(al[0].firedAt, undefined);
});
