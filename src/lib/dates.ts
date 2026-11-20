/** Display dates on the Dubai clock, so every section names the same day. */
export const DUBAI_TZ = 'Asia/Dubai';

/** The date `days` from now in Dubai, e.g. "Sat 28 Nov" (long: "Saturday 28 Nov"; weekday: false drops it). */
export function dubaiDateIn(days: number, opts: { long?: boolean; weekday?: boolean; nowMs?: number } = {}): string {
  const { long = false, weekday = true, nowMs = Date.now() } = opts;
  return new Date(nowMs + days * 86400e3).toLocaleDateString('en-GB', {
    ...(weekday ? { weekday: long ? 'long' : 'short' } : {}),
    day: 'numeric',
    month: 'short',
    timeZone: DUBAI_TZ,
  });
}
