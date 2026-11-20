import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { realisticPath, trackRecord } from './realistic';
import type { DailyBar } from './types';

const fx: { start: string; closes: number[] } = JSON.parse(readFileSync(new URL('../fixtures/paxg-kraken-daily.json', import.meta.url), 'utf8'));
const t0 = Date.parse(`${fx.start}T00:00:00Z`);
const rows: DailyBar[] = fx.closes.map((usd, i) => ({ date: new Date(t0 + i * 86400e3).toISOString().slice(0, 10), usd }));

test('one realistic price per horizon, centred on today, with a typical miss', () => {
  const spot = rows[rows.length - 1].usd;
  const p = realisticPath(rows, spot)!;
  assert.deepEqual(p.map((x) => x.days), [7, 30, 90]);
  for (const x of p) {
    assert.ok(Math.abs(x.usd / (spot * Math.pow(1.086, x.days / 365)) - 1) < 1e-9, "today's price grown at the long-run average rate");
    assert.ok(x.typicalMissPct > 0 && x.lo < x.usd && x.hi > x.usd);
  }
  assert.ok(p[2].typicalMissPct > p[0].typicalMissPct, 'further out = less certain');
  assert.ok(p[0].usd < p[1].usd && p[1].usd < p[2].usd, 'each horizon has its own estimate');
});

test('track record uses only data known at the time and compares with reality', () => {
  const t = trackRecord(rows);
  assert.ok(t.length >= 3);
  for (const c of t) {
    assert.ok(c.toDate > c.fromDate);
    const actual = rows.find((r) => r.date === c.toDate)!.usd;
    assert.equal(c.actualUsd, actual);
    assert.equal(c.inside, actual >= c.lo && actual <= c.hi);
  }
  // no look-ahead: changing data after a call's start date must not change the call
  const c0 = t[0];
  const cut = rows.findIndex((r) => r.date === c0.fromDate);
  const altered = rows.map((r, i) => (i > cut ? { ...r, usd: r.usd * 1.5 } : r));
  const t2 = trackRecord(altered);
  assert.equal(t2[0].predictedUsd, c0.predictedUsd);
  assert.equal(t2[0].lo, c0.lo);
});
