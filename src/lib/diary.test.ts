import test from 'node:test';
import assert from 'node:assert/strict';
import { addEntry, diaryStats, sanitizeDiary, scoreDiary, type DiaryEntry } from './diary';

const e = (date: string, spot = 3500): DiaryEntry => ({ date, spot, week: { lo: 3000, hi: 4000, mid: 3510 }, month: { lo: 2800, hi: 4300, mid: 3520 } });

test('one entry per day, never rewritten', () => {
  let d = addEntry(null, e('2026-11-20'));
  d = addEntry(d, { ...e('2026-11-20'), spot: 9999 });
  assert.equal(d.entries.length, 1);
  assert.equal(d.entries[0].spot, 3500);
  assert.equal(d.startedAt, '2026-11-20');
});

test('scoring fills real prices only once the date has passed, and counts hits', () => {
  let d = addEntry(addEntry(null, e('2026-11-01')), e('2026-11-20'));
  const prices: Record<string, number> = { '2026-11-08': 3600, '2026-12-01': 4500 };
  d = scoreDiary(d, (ymd) => prices[ymd] ?? null);
  assert.equal(d.entries[0].weekActual, 3600);
  assert.equal(d.entries[0].monthActual, 4500);
  assert.equal(d.entries[1].weekActual, null);
  const s = diaryStats(d);
  assert.deepEqual(s.week, { checked: 1, inside: 1 });
  assert.deepEqual(s.month, { checked: 1, inside: 0 }, '4500 is outside 2800-4300');
  assert.equal(s.nextResult, '2026-11-27');
});

test('sanitizer drops junk entries', () => {
  const d = sanitizeDiary({ startedAt: '2026-11-20', entries: [e('2026-11-20'), { date: 'x' }, { ...e('2026-11-21'), week: { lo: 5, hi: 1, mid: 3 } }] })!;
  assert.equal(d.entries.length, 1);
  assert.equal(sanitizeDiary({ startedAt: 'bad', entries: [] }), null);
});
