import test from 'node:test';
import assert from 'node:assert/strict';
import { latestImplied, longSeries, sanitizeMarket } from './longHistory';

const gold = Array.from({ length: 600 }, (_, i) => [new Date(Date.UTC(2024, 0, 1) + i * 86400e3).toISOString().slice(0, 10), 200 + i * 0.1]);

test('market file is validated; bad rows dropped; too short rejected', () => {
  const m = sanitizeMarket({ generatedAt: '2026-11-20T00:00:00Z', gold: { bars: [...gold, ['bad', 1], ['2026-01-01', -5]] }, gvz: [['2026-11-18', 28.04], ['2026-11-19', 'x'], ['2026-11-19', 900]] })!;
  assert.equal(m.gold.length, 600);
  assert.deepEqual(m.gvz, [{ date: '2026-11-18', pct: 28.04 }]);
  assert.equal(sanitizeMarket({ generatedAt: '2026-11-20T00:00:00Z', gold: gold.slice(0, 10), gvz: [] }), null);
  assert.equal(sanitizeMarket(null), null);
});

test('long series is rescaled to spot and ends with today', () => {
  const m = sanitizeMarket({ generatedAt: '2026-11-20T00:00:00Z', gold, gvz: [['2025-08-20', 20]] })!;
  const s = longSeries(m, 3500, '2025-08-23T10:00:00Z');
  const last = s[s.length - 1], prev = s[s.length - 2];
  assert.equal(last.date, '2025-08-23');
  assert.equal(last.usd, 3500);
  assert.ok(Math.abs(prev.usd - 3500) < 1e-9, 'last close lines up with spot');
  assert.equal(latestImplied(m, '2025-08-23T00:00:00Z'), 20);
  assert.equal(latestImplied(m, '2025-09-30T00:00:00Z'), null, 'stale implied vol is ignored');
});

test('with a reference series, today keeps its real move', () => {
  const m = sanitizeMarket({ generatedAt: '2026-11-20T00:00:00Z', gold, gvz: [] })!;
  const lastDate = gold[gold.length - 1][0] as string;
  const s = longSeries(m, 3500, '2025-08-23T10:00:00Z', [{ date: lastDate, usd: 3400 }]);
  assert.ok(Math.abs(s[s.length - 2].usd - 3400) < 1e-9);
  assert.equal(s[s.length - 1].usd, 3500);
});
