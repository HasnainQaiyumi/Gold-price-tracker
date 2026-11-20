import test from 'node:test';
import assert from 'node:assert/strict';
import { annualisedVolPct, maxDrawdownPct, returnPct, rsi, smaSeries, withLiveSpot } from './goldAnalytics';

const close = (a: number | null, b: number, eps = 1e-9) => assert.ok(a !== null && Math.abs(a - b) < eps, `${a} != ${b}`);

test('SMA', () => {
  assert.deepEqual(smaSeries([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]);
});

test('RSI hand-computed (period 2): 75', () => {
  close(rsi([1, 2, 1, 2], 2), 75);
});

test('RSI extremes', () => {
  assert.equal(rsi([1, 2, 3, 4, 5], 2), 100);
  close(rsi([5, 4, 3, 2, 1], 2), 0);
  assert.equal(rsi([1, 2], 14), null);
});

test('volatility: constant growth = 0, known two-return case', () => {
  close(annualisedVolPct([100, 110, 121, 133.1], 3), 0, 1e-9);
  const lr = Math.log(1.1);
  close(annualisedVolPct([100, 110, 100], 2), Math.sqrt(2 * lr * lr) * Math.sqrt(252) * 100, 1e-9);
});

test('max drawdown and returns', () => {
  close(maxDrawdownPct([100, 120, 90, 110]), -25);
  close(returnPct([100, 105, 110], 2), 10);
  assert.equal(returnPct([1, 2], 5), null);
});

test('withLiveSpot replaces same-day close, appends new day, drops future', () => {
  const d = [{ date: '2026-11-18', usd: 1 }, { date: '2026-11-19', usd: 2 }];
  assert.deepEqual(withLiveSpot(d, 9, '2026-11-19T10:00:00Z').at(-1), { date: '2026-11-19', usd: 9 });
  assert.equal(withLiveSpot(d, 9, '2026-11-20T10:00:00Z').length, 3);
  assert.equal(withLiveSpot(d, 9, '2026-11-18T10:00:00Z').length, 1);
});
