/**
 * One- to three-line plain-language explanations for the "Key numbers" panel.
 * Every sentence is computed from the live numbers passed in; nothing is hard-coded.
 * Percentages are in %, prices already in display units.
 */
const p1 = (x: number) => `${Math.abs(x).toFixed(1)}%`;
const updown = (x: number) => (x >= 0 ? 'up' : 'down');

export interface KeyStats {
  r1m: number | null;
  r3m: number | null;
  r1y: number | null;
  rsi: number | null;
  vol: number | null; // annualised volatility, %
  dd: number | null; // worst fall over 1Y, % (negative)
  hi: number; // 1Y high, display units
  lo: number; // 1Y low
  last: number; // today, display units
  fromHigh: number; // %, <= 0
  vs50: number | null; // %
  vs200: number | null; // %
}

export function explainReturns(s: KeyStats): string {
  const parts: string[] = [];
  if (s.r1m !== null) parts.push(`Over the last month gold is ${updown(s.r1m)} ${p1(s.r1m)}`);
  if (s.r3m !== null) parts.push(`over 3 months ${updown(s.r3m)} ${p1(s.r3m)}`);
  if (s.r1y !== null) parts.push(`and over a full year ${updown(s.r1y)} ${p1(s.r1y)}`);
  if (!parts.length) return 'Not enough history yet to compare.';
  let t = parts.join(', ') + '.';
  if (s.r1y !== null) t += s.r1y >= 0 ? ' Someone who bought a year ago would be in profit today.' : ' Someone who bought a year ago would be at a loss today.';
  return t;
}

export function explainRsi(rsi: number | null): string {
  if (rsi === null) return 'Not enough history yet.';
  const base = 'This scores how fast the price has moved lately, from 0 to 100.';
  if (rsi < 30) return `${base} At ${rsi.toFixed(0)}, gold has been sold very fast ("oversold"). Prices sometimes bounce back after this, but not always.`;
  if (rsi > 70) return `${base} At ${rsi.toFixed(0)}, gold has been bought very fast ("overbought"). Prices sometimes cool off after this, but not always.`;
  return `${base} At ${rsi.toFixed(0)}, it is in the normal zone, neither rushed up nor rushed down.`;
}

export function explainVol(vol: number | null): string {
  if (vol === null) return 'Not enough history yet.';
  const base = `This shows how wildly the price is swinging. Gold usually swings about 15% a year; right now it is ${vol.toFixed(0)}%.`;
  if (vol >= 22) return `${base} That is unusually jumpy, so expect bigger daily moves than normal.`;
  if (vol <= 11) return `${base} That is calmer than usual, so daily moves are smaller than normal.`;
  return `${base} That is about normal for gold.`;
}

export function explainDrawdown(dd: number | null): string {
  if (dd === null) return 'Not enough history yet.';
  return `The biggest drop from a peak to a low during the past year was ${p1(dd)}. If you had bought at the very top, you would have been down this much at the worst moment.`;
}

export function explainRange(s: KeyStats, fmt: (v: number) => string): string {
  const pos = (s.last - s.lo) / (s.hi - s.lo || 1);
  const where = pos >= 0.9 ? 'near the top of' : pos <= 0.1 ? 'near the bottom of' : pos >= 0.5 ? 'in the upper half of' : 'in the lower half of';
  return `Over the past year the price moved between ${fmt(s.lo)} and ${fmt(s.hi)}. Today it is ${where} that range.`;
}

export function explainFromHigh(fromHigh: number): string {
  if (fromHigh > -0.5) return 'Gold is at, or very close to, its highest price of the past year.';
  const needed = (1 / (1 + fromHigh / 100) - 1) * 100;
  return `Gold is ${p1(fromHigh)} cheaper than its highest point of the past year. To get back to that high, it would need to rise about ${needed.toFixed(0)}%.`;
}

export function explainVsAvg(v: number | null, days: 50 | 200): string {
  if (v === null) return 'Not enough history yet.';
  const term = days === 50 ? 'short-term' : 'long-term';
  if (Math.abs(v) < 0.5) return `Today's price is right at the average of the last ${days} days, so the ${term} trend is flat.`;
  return `Today's price is ${p1(v)} ${v > 0 ? 'above' : 'below'} the average of the last ${days} days. Being ${v > 0 ? 'above' : 'below'} it means the ${term} trend is ${v > 0 ? 'up' : 'down'}.`;
}

/** Two or three sentences that tie all the numbers together. */
export function overallSummary(s: KeyStats): string {
  const out: string[] = [];
  if (s.vs50 !== null && s.vs200 !== null) {
    if (s.vs50 < 0 && s.vs200 < 0) out.push('In short: gold is in a downtrend right now, below both its short and long averages.');
    else if (s.vs50 > 0 && s.vs200 > 0) out.push('In short: gold is in an uptrend right now, above both its short and long averages.');
    else if (s.vs50 < 0) out.push('In short: the long-term trend is still up, but gold has cooled off recently.');
    else out.push('In short: gold is bouncing back recently, but the long-term trend is still down.');
  }
  if (s.vol !== null && s.vol >= 22) out.push('Prices are swinging much more than usual, so expect big moves either way.');
  if (s.rsi !== null && s.rsi < 30) out.push('It has fallen very fast, which sometimes leads to a bounce, but that is never guaranteed.');
  else if (s.rsi !== null && s.rsi > 70) out.push('It has risen very fast, which sometimes leads to a pause, but that is never guaranteed.');
  return out.join(' ');
}
