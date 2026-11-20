import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cone, dailyVol, HURST, VOL_WINDOW } from './forecastCone';

const closes: number[] = JSON.parse(readFileSync(new URL('./fixtures/paxg-daily-closes.json', import.meta.url), 'utf8'));

test('cone maths: median is price, symmetric in log space, widens with horizon', () => {
  const c = cone(1000, 0.01, 30);
  const s = 0.01 * Math.pow(30, HURST);
  assert.equal(c.median, 1000);
  assert.ok(Math.abs(c.lo68 - 1000 * Math.exp(-s)) < 1e-9);
  assert.ok(Math.abs(c.hi95 * c.lo95 - 1000 * 1000) < 1e-6);
  const w = cone(1000, 0.01, 90);
  assert.ok(w.hi95 > c.hi95 && w.lo95 < c.lo95 && c.hi95 > c.hi68);
});

test('dailyVol: zero for constant growth, null when too short', () => {
  const g = Array.from({ length: 70 }, (_, i) => 100 * Math.pow(1.01, i));
  assert.ok((dailyVol(g) as number) < 1e-12);
  assert.equal(dailyVol([1, 2, 3]), null);
});

// Real-data calibration: walk-forward, no look-ahead. Guards against silently
// shipping an over- or under-confident range.
test('real gold back-test: ranges are calibrated (68% in 60-80%, 95% in 88-99%)', () => {
  for (const h of [7, 30, 90]) {
    let n = 0, in68 = 0, in95 = 0;
    for (let t = VOL_WINDOW; t + h < closes.length; t++) {
      const sigma = dailyVol(closes.slice(0, t + 1)) as number;
      const c = cone(closes[t], sigma, h);
      const out = closes[t + h];
      n++;
      if (out >= c.lo68 && out <= c.hi68) in68++;
      if (out >= c.lo95 && out <= c.hi95) in95++;
    }
    assert.ok(n > 300, `enough samples for h=${h}`);
    assert.ok(in68 / n > 0.6 && in68 / n < 0.8, `h=${h} 68% coverage ${(in68 / n).toFixed(2)}`);
    assert.ok(in95 / n > 0.88 && in95 / n < 0.99, `h=${h} 95% coverage ${(in95 / n).toFixed(2)}`);
  }
});
