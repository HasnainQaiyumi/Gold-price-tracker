/**
 * Prediction diary: once a day the data job writes down that day's 99% ranges for next week and
 * next month, and later scores each one against the real price on its date. Because every entry is
 * recorded before its outcome is known, this is the one track record that cannot be curve-fitted.
 */
export interface DiaryRange { lo: number; hi: number; mid: number } // USD/oz
export interface DiaryEntry {
  date: string; // YYYY-MM-DD (UTC) the prediction was made
  spot: number; // USD/oz at that time
  week: DiaryRange; // 99% range for date + 7 days
  month: DiaryRange; // 99% range for date + 30 days
  weekActual?: number | null; // real price on the target date, once known
  monthActual?: number | null;
}
export interface Diary { startedAt: string; entries: DiaryEntry[] }

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1e6;
const range = (v: unknown): DiaryRange | null => {
  const o = (v ?? {}) as Record<string, unknown>;
  return num(o.lo) && num(o.hi) && num(o.mid) && (o.lo as number) < (o.hi as number) ? { lo: o.lo as number, hi: o.hi as number, mid: o.mid as number } : null;
};

export function sanitizeDiary(raw: unknown): Diary | null {
  const o = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null;
  if (!o || typeof o.startedAt !== 'string' || !DATE.test(o.startedAt.slice(0, 10)) || !Array.isArray(o.entries)) return null;
  const entries: DiaryEntry[] = [];
  for (const r of o.entries.slice(-800)) {
    const e = (r ?? {}) as Record<string, unknown>;
    const week = range(e.week), month = range(e.month);
    if (typeof e.date !== 'string' || !DATE.test(e.date) || !num(e.spot) || !week || !month) continue;
    entries.push({ date: e.date, spot: e.spot as number, week, month, weekActual: num(e.weekActual) ? (e.weekActual as number) : null, monthActual: num(e.monthActual) ? (e.monthActual as number) : null });
  }
  return { startedAt: o.startedAt.slice(0, 10), entries };
}

export const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);

/** Adds today's entry (once per day). Never rewrites an existing day. */
export function addEntry(d: Diary | null, e: DiaryEntry): Diary {
  const base: Diary = d ?? { startedAt: e.date, entries: [] };
  if (base.entries.some((x) => x.date === e.date)) return base;
  return { ...base, entries: [...base.entries, e].slice(-800) };
}

/** Fills in real prices for entries whose target date has passed. `priceOn(date)` returns the real
 * price on that date (or the first trading day within 3 days after), or null if not known yet. */
export function scoreDiary(d: Diary, priceOn: (ymd: string) => number | null): Diary {
  return {
    ...d,
    entries: d.entries.map((e) => ({
      ...e,
      weekActual: e.weekActual ?? priceOn(addDays(e.date, 7)),
      monthActual: e.monthActual ?? priceOn(addDays(e.date, 30)),
    })),
  };
}

export interface DiaryStats {
  days: number;
  week: { checked: number; inside: number };
  month: { checked: number; inside: number };
  nextResult: string | null; // date the next unscored prediction can be checked
}

export function diaryStats(d: Diary): DiaryStats {
  const s: DiaryStats = { days: d.entries.length, week: { checked: 0, inside: 0 }, month: { checked: 0, inside: 0 }, nextResult: null };
  const pending: string[] = [];
  for (const e of d.entries) {
    if (e.weekActual) { s.week.checked++; if (e.weekActual >= e.week.lo && e.weekActual <= e.week.hi) s.week.inside++; } else pending.push(addDays(e.date, 7));
    if (e.monthActual) { s.month.checked++; if (e.monthActual >= e.month.lo && e.monthActual <= e.month.hi) s.month.inside++; } else pending.push(addDays(e.date, 30));
  }
  s.nextResult = pending.sort()[0] ?? null;
  return s;
}
