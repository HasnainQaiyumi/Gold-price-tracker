import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { backtest, backtestLadder, chooseTargets, claimHeld, makeClaims, NEED, TARGET, type Claim } from './claims';
import { prepare, simulate } from './montecarlo';

const fx: { start: string; closes: number[] } = JSON.parse(readFileSync(new URL('../fixtures/paxg-kraken-daily.json', import.meta.url), 'utf8'));
const t0 = Date.parse(`${fx.start}T00:00:00Z`);
const bars = fx.closes.map((usd, i) => ({ date: new Date(t0 + i * 86400e3).toISOString().slice(0, 10), usd }));

test('simulation: deterministic per seed, and each statement holds in about its target share of futures', () => {
  const p = prepare(bars)!;
  const a = simulate(p, 20000, [7, 30], 7), b = simulate(p, 20000, [7, 30], 7);
  assert.deepEqual(Array.from(a.end[7].counts), Array.from(b.end[7].counts));
  const spot = bars[bars.length - 1].usd;
  for (const c of makeClaims(a, spot)) {
    assert.ok(Math.abs(c.probability - TARGET[c.kind]) < 0.01, `${c.kind} ${c.probability}`);
    assert.ok(c.levels.every((l) => l > 0 && Number.isFinite(l)));
  }
  const band = makeClaims(a, spot).find((c) => c.kind === 'band30')!;
  assert.ok(band.levels[0] < spot && band.levels[1] > spot);
});

test('claim checking uses the real path after the start date', () => {
  const after = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ day: 100 + d, usd: d === 3 ? 90 : 105 }));
  const c = (kind: Claim['kind'], levels: number[]): Claim => ({ kind, levels, horizon: 7, probability: 0.9 });
  assert.equal(claimHeld(c('above7', [100]), 100, after), true);
  assert.equal(claimHeld(c('below7', [100]), 100, after), false);
  assert.equal(claimHeld(c('floor7', [95]), 100, after), false, 'dipped to 90 on day 3');
  assert.equal(claimHeld(c('band30', [1, 2]), 100, after), null, 'outcome not known yet');
});

test('walk-forward back-test on real gold: every statement came true at least 90% of the time', () => {
  for (const r of backtest(bars, 3000, 3)) {
    assert.ok(r.checks > 100, `${r.kind} checks ${r.checks}`);
    assert.ok(r.held / r.checks >= 0.9, `${r.kind} held ${(100 * r.held / r.checks).toFixed(1)}%`);
  }
});

test('self-calibration: every chosen statement level held at least 92% in the walk-forward back-test', () => {
  const { targets, tested } = chooseTargets(backtestLadder(bars, 2000, 4));
  assert.equal(tested.length, 5);
  for (const r of tested) {
    assert.ok(r.checks >= 30);
    assert.ok(r.held / r.checks >= NEED, `${r.kind} at ${targets[r.kind]}: ${(100 * r.held / r.checks).toFixed(1)}%`);
  }
});
