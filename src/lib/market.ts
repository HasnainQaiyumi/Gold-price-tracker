/**
 * Spot gold trades Sunday evening to Friday evening (UTC, approx. 23:00 Sun to 22:00 Fri;
 * exact times shift ~1h with US daylight saving). A quote that looks "old" on a weekend is normal.
 */
export function marketStatus(now: Date): { open: boolean; label: string } {
  const day = now.getUTCDay(); // 0 Sun .. 6 Sat
  const h = now.getUTCHours() + now.getUTCMinutes() / 60;
  const closed = day === 6 || (day === 5 && h >= 22) || (day === 0 && h < 23);
  return closed
    ? { open: false, label: 'Market closed for the weekend (reopens Sunday ~23:00 UTC)' }
    : { open: true, label: 'Market open' };
}
