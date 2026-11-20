import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { backtestLadder, chooseTargets, claimHeld, DEFAULT_TARGET, makeClaims, NEED, sanitizeCalibration, type Claim } from './claims';
import { curve, fan, prepare, simulate } from './montecarlo';

const fx: { start: string; closes: number[] } = JSON.parse(readFileSync(new URL('../fixtures/paxg-kraken-daily.json', import.meta.url), 'utf8'));
const t0 = Date.parse(`${fx.start}T00:00:00Z`);
const bars = fx.closes.map((usd, i) => ({ date: new Date(t0 + i * 86400e3).toISOString().slice(0, 10), usd }));

test('simulation: deterministic per seed; each statement holds in about its target share of futures', () => {
  const p = prepare(bars)!;
  const a = simulate(p, 40000, [7, 30], 7), b = simulate(p, 40000, [7, 30], 7);
  assert.deepEqual(Array.from(a.end[7].counts), Array.from(b.end[7].counts));
  const spot = bars[bars.length - 1].usd;
  const cs = makeClaims(a, spot);
  for (const c of cs) {
    assert.ok(Math.abs(c.probability - DEFAULT_TARGET[c.kind]) < 0.01, `${c.kind} ${c.probability}`);
    assert.ok(c.levels.every((l) => l > 0 && Number.isFinite(l)));
  }
  const week = cs.find((c) => c.kind === 'week')!, month = cs.find((c) => c.kind === 'month')!;
  assert.ok(week.levels[0] < spot && week.levels[1] > spot, 'one range holds both the low and the high');
  assert.ok(month.levels[0] < week.levels[0] && month.levels[1] > week.levels[1], 'a month is less certain than a week');
});

test('fan chart and probability curves are consistent with the simulation', () => {
  const p = prepare(bars)!;
  const s = simulate(p, 20000, [7, 30], 3, undefined, { daily: true, samples: 10 });
  const f = fan(s, [0.025, 0.5, 0.975]);
  assert.equal(f.length, 30);
  for (const [lo, mid, hi] of f) assert.ok(lo < mid && mid < hi);
  assert.ok(f[29][2] - f[29][0] > f[6][2] - f[6][0], 'the fan widens');
  assert.equal(s.samples.length, 10);
  const c = curve(s.end[30]);
  const total = c.reduce((a, b) => a + b.p, 0);
  assert.ok(total > 0.99 && total <= 1.0000001);
});

test('claim checking uses the real path after the start date', () => {
  const after = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ day: 100 + d, usd: d === 3 ? 90 : 105 }));
  const c = (kind: Claim['kind'], levels: number[]): Claim => ({ kind, levels, horizon: 7, probability: 0.99 });
  assert.equal(claimHeld(c('week', [100, 110]), 100, after), true);
  assert.equal(claimHeld(c('week', [106, 110]), 100, after), false);
  assert.equal(claimHeld(c('floor7', [95]), 100, after), false, 'dipped to 90 on day 3');
  assert.equal(claimHeld(c('month', [1, 2]), 100, after), null, 'outcome not known yet');
});

test('self-calibration on real gold: week and month ranges held >= 99%, the rest >= 95%', () => {
  const { tested } = chooseTargets(backtestLadder(bars, 2500, 3));
  assert.equal(tested.length, 5);
  for (const r of tested) {
    assert.ok(r.checks >= 100, `${r.kind} checks ${r.checks}`);
    assert.ok(r.held / r.checks >= NEED[r.kind], `${r.kind} at ${r.target}: ${(100 * r.held / r.checks).toFixed(1)}%`);
  }
});

test('published calibration: only ladder levels and complete rows are accepted', () => {
  const tested = (['week', 'month', 'floor7', 'floor30', 'ceiling30'] as const).map((kind) => ({ kind, checks: 100, held: 99, target: 0.99 }));
  const good = { generatedAt: '2026-11-20T00:00:00Z', fromDate: '2005-01-03', targets: { week: 0.99, month: 0.99, floor7: 0.95, floor30: 0.95, ceiling30: 0.96 }, tested };
  assert.ok(sanitizeCalibration(good));
  assert.equal(sanitizeCalibration({ ...good, targets: { ...good.targets, week: 0.5 } }), null);
  assert.equal(sanitizeCalibration({ ...good, tested: tested.slice(1) }), null);
  assert.equal(sanitizeCalibration({ ...good, tested: [{ ...tested[0], held: 101 }, ...tested.slice(1)] }), null);
});
