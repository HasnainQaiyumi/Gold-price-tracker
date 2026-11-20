import test from 'node:test';
import assert from 'node:assert/strict';
import { explainPoint, indexOnOrAfter, longDate, type StoryCandle } from './chartStory';

const fmt = (v: number) => `AED ${v.toFixed(2)}`;
const mk = (n: number, f: (i: number) => number): StoryCandle[] =>
  Array.from({ length: n }, (_, i) => {
    const t = new Date(Date.UTC(2025, 0, 1) + i * 86400e3).toISOString().slice(0, 10);
    const v = f(i);
    return { time: t, open: v, high: v * 1.005, low: v * 0.995, close: v };
  });

test('day move, wide swing and what happened next, from real following data', () => {
  const c = mk(120, (i) => 400 + i); // steadily rising
  c[50] = { ...c[50], close: c[49].close * 1.03, high: c[49].close * 1.05, low: c[49].close * 0.99 };
  const s = explainPoint(c, 50, 400, 380, fmt)!;
  assert.equal(s.day.arrow, 'up');
  assert.match(s.day.text, /went up 3\.0%.*big move for one day/);
  assert.match(s.day.text, /swung between/);
  assert.equal(s.trend?.arrow, 'up');
  assert.equal(s.next?.arrow, 'up');
  assert.match(s.next!.text, /a month later gold was higher by/);
  assert.equal(s.latest, null);
});

test('today: no invented future, the calibrated range instead', () => {
  const c = mk(100, (i) => 500 - i);
  const s = explainPoint(c, c.length - 1, 450, 470, fmt, { lo: 380, hi: 420 })!;
  assert.equal(s.next, null);
  assert.match(s.latest!, /Nobody knows what comes next/);
  assert.match(s.latest!, /between AED 380\.00 and AED 420\.00/);
  assert.equal(s.trend?.arrow, 'down');
  const s2 = explainPoint(c, c.length - 1, null, null, fmt)!;
  assert.match(s2.latest!, /cannot show it/);
  assert.equal(s2.trend, null);
});

test('mixed trend wording and year-range placement', () => {
  const c = mk(400, (i) => (i < 300 ? 300 + i : 600 - (i - 300) * 2));
  const s = explainPoint(c, 399, 420, 380, fmt)!;
  assert.equal(s.trend?.arrow, 'mixed');
  assert.match(s.trend!.text, /dipped below its 50-day average but was still above the 200-day/);
  assert.ok(s.place);
});

test('helpers', () => {
  assert.equal(longDate('2026-11-20'), '20 November 2026');
  const c = mk(10, () => 1);
  assert.equal(indexOnOrAfter(c, '2025-01-05'), 4);
  assert.equal(indexOnOrAfter(c, '2030-01-01'), -1);
});
