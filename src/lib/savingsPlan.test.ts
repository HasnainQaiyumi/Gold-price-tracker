import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ASSUMPTIONS } from './goldPricing';
import { getGoldQuote, monthlyNeeded, monthsToTarget, projectSavings, timingSignal } from './savingsPlan';

const q = getGoldQuote(3500, DEFAULT_ASSUMPTIONS);

test('buy price exceeds sell price; break-even is positive', () => {
  assert.ok(q.buyAedPerG > q.sellAedPerG);
  assert.ok(q.roundTripCostPct > 0 && q.roundTripCostPct < 10);
});

test('0% growth loses money to spread (never magic)', () => {
  const r = projectSavings(100, 10, 0, q);
  assert.equal(r.invested, 12000);
  assert.ok(r.value < r.invested);
});

test('100 AED/month does not reach 1M AED within 30 years even at 12%', () => {
  const r = projectSavings(100, 30, 12, q);
  assert.ok(r.value < 1_000_000);
});

test('monthsToTarget and monthlyNeeded are consistent', () => {
  const need = monthlyNeeded(1_000_000, 20, 8, q);
  const months = monthsToTarget(need, 1_000_000, 8, q);
  assert.ok(Math.abs(months - 240) < 0.5);
  assert.equal(monthsToTarget(100, 1e6, 0, q), Infinity);
});

test('timing signal flags price vs 30d average', () => {
  const hist = Array.from({ length: 30 }, () => 3000);
  assert.equal(timingSignal(3300, hist).label, 'Above average');
  assert.equal(timingSignal(2800, hist).label, 'Below average');
  assert.equal(timingSignal(3010, hist).label, 'Near average');
});
