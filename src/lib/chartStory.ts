/**
 * Plain-language story for one point on the price chart (the candle under the cursor).
 * For past points, "what happened next" is read from the real data that follows them.
 * For today's point the future is unknown, so we show the calibrated likely range instead.
 * Pure functions; prices are already in display units (AED, karat, unit).
 */
export interface StoryCandle {
  time: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
}

export type Arrow = 'up' | 'down' | 'flat';

export interface PointStory {
  date: string;
  day: { arrow: Arrow; text: string };
  trend: { arrow: Arrow | 'mixed'; text: string } | null;
  place: string | null;
  next: { arrow: Arrow; text: string; laterTime: string; laterPct: number } | null;
  latest: string | null; // only for today's point
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function longDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

const pct = (a: number, b: number) => (b / a - 1) * 100;
const p1 = (x: number) => `${Math.abs(x).toFixed(1)}%`;
const arrowOf = (x: number, flat = 0.15): Arrow => (Math.abs(x) < flat ? 'flat' : x > 0 ? 'up' : 'down');
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);

/** Index of the first candle on or after `ymd`, or -1. */
export function indexOnOrAfter(c: StoryCandle[], ymd: string, from = 0): number {
  for (let i = from; i < c.length; i++) if (c[i].time >= ymd) return i;
  return -1;
}

export function explainPoint(
  c: StoryCandle[],
  i: number,
  sma50: number | null,
  sma200: number | null,
  fmt: (v: number) => string,
  outlook7: { lo: number; hi: number } | null = null
): PointStory | null {
  const k = c[i];
  if (!k) return null;
  const prev = i > 0 ? c[i - 1] : null;
  const isLatest = i === c.length - 1;

  // 1) That day
  let day: PointStory['day'];
  if (prev) {
    const ch = pct(prev.close, k.close);
    const a = arrowOf(ch);
    day = {
      arrow: a,
      text:
        a === 'flat'
          ? `On this day gold hardly moved. It closed at ${fmt(k.close)}.`
          : `On this day gold went ${a === 'up' ? 'up' : 'down'} ${p1(ch)}, from ${fmt(prev.close)} to ${fmt(k.close)}.${Math.abs(ch) >= 2 ? ' That is a big move for one day.' : ''}`,
    };
  } else {
    day = { arrow: 'flat', text: `Gold closed at ${fmt(k.close)} on this day.` };
  }
  const swing = pct(k.low, k.high);
  if (swing >= 2.5) day.text += ` During the day it swung between ${fmt(k.low)} and ${fmt(k.high)}, a wide range.`;

  // 2) The bigger trend at that point (averages of the days before it)
  let trend: PointStory['trend'] = null;
  if (sma50 !== null && sma200 !== null) {
    const a50 = k.close >= sma50, a200 = k.close >= sma200;
    trend =
      a50 && a200
        ? { arrow: 'up', text: 'The price was above both average lines (the blue 50-day and the dashed 200-day). That means the trend was going up at this point.' }
        : !a50 && !a200
          ? { arrow: 'down', text: 'The price was below both average lines (the blue 50-day and the dashed 200-day). That means the trend was going down at this point.' }
          : a200
            ? { arrow: 'mixed', text: 'The price had dipped below its 50-day average but was still above the 200-day one. The long trend was still up, but the short-term mood had cooled.' }
            : { arrow: 'mixed', text: 'The price had climbed above its 50-day average but was still below the 200-day one. It was bouncing back, but the long trend was still down.' };
  } else if (sma50 !== null) {
    const a50 = k.close >= sma50;
    trend = { arrow: a50 ? 'up' : 'down', text: `The price was ${a50 ? 'above' : 'below'} its 50-day average line (blue), so the recent trend was ${a50 ? 'up' : 'down'}.` };
  }

  // 3) Where it sat within the previous year's range
  let place: string | null = null;
  const yearAgo = addDays(k.time, -365);
  const start = indexOnOrAfter(c, yearAgo);
  if (start >= 0 && i - start >= 60) {
    let hi = -Infinity, lo = Infinity;
    for (let j = start; j <= i; j++) {
      hi = Math.max(hi, c[j].high);
      lo = Math.min(lo, c[j].low);
    }
    const pos = (k.close - lo) / (hi - lo || 1);
    place =
      pos >= 0.9
        ? `This was near the top of its range for the past year (highest about ${fmt(hi)}).`
        : pos <= 0.1
          ? `This was near the bottom of its range for the past year (lowest about ${fmt(lo)}).`
          : `This was in the ${pos >= 0.5 ? 'upper' : 'lower'} part of its range for the past year (between about ${fmt(lo)} and ${fmt(hi)}).`;
  }

  // 4) What happened next (real data), or today's honest outlook
  let next: PointStory['next'] = null;
  let latest: string | null = null;
  if (!isLatest) {
    const w = indexOnOrAfter(c, addDays(k.time, 7), i + 1);
    const m = indexOnOrAfter(c, addDays(k.time, 30), i + 1);
    const target = m >= 0 ? m : w >= 0 ? w : c.length - 1;
    const later = c[target];
    const ch = pct(k.close, later.close);
    const a = arrowOf(ch, 0.5);
    const span = m >= 0 ? 'a month later' : w >= 0 ? 'a week later' : `by ${longDate(later.time)}`;
    const weekBit = w >= 0 && m >= 0 ? ` (one week later it was ${pct(k.close, c[w].close) >= 0 ? 'up' : 'down'} ${p1(pct(k.close, c[w].close))}).` : '.';
    next = {
      arrow: a,
      laterTime: later.time,
      laterPct: ch,
      text:
        a === 'flat'
          ? `What happened next: ${span} the price was about the same, ${fmt(later.close)}${weekBit}`
          : `What happened next: ${span} gold was ${a === 'up' ? 'higher' : 'lower'} by ${p1(ch)}, at ${fmt(later.close)}${weekBit}`,
    };
  } else {
    latest = outlook7
      ? `This is today. Nobody knows what comes next. Based on how much gold has been swinging lately, in one week it will most likely be between ${fmt(outlook7.lo)} and ${fmt(outlook7.hi)}. Up or down is close to a coin flip.`
      : 'This is today. Nobody knows what comes next, so the chart cannot show it. Move left to see what happened after earlier days.';
  }

  return { date: longDate(k.time), day, trend, place, next, latest };
}
