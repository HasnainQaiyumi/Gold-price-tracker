export interface PriceAlert {
  id: string;
  dir: 'above' | 'below';
  target: number; // AED per gram of 24K gold (spot)
  firedAt?: string;
}

/** Marks alerts whose condition is met as fired. Pure: returns new array and the newly fired ones. */
export function evaluateAlerts(alerts: PriceAlert[], price24: number, nowIso: string) {
  const newlyFired: PriceAlert[] = [];
  const next = alerts.map((a) => {
    if (a.firedAt) return a;
    const hit = a.dir === 'above' ? price24 >= a.target : price24 <= a.target;
    if (!hit) return a;
    const fired = { ...a, firedAt: nowIso };
    newlyFired.push(fired);
    return fired;
  });
  return { alerts: newlyFired.length ? next : alerts, newlyFired };
}

/** Validates untrusted (stored) alerts: drops anything malformed, caps the list size. */
export function sanitizeAlerts(raw: unknown): PriceAlert[] {
  if (!Array.isArray(raw)) return [];
  const out: PriceAlert[] = [];
  for (const r of raw.slice(0, 20)) {
    const o = (r ?? {}) as Record<string, unknown>;
    const t = o.target;
    if (typeof o.id !== 'string' || (o.dir !== 'above' && o.dir !== 'below')) continue;
    if (typeof t !== 'number' || !Number.isFinite(t) || t < 1 || t > 100000) continue;
    out.push({
      id: o.id.slice(0, 40),
      dir: o.dir,
      target: t,
      firedAt: typeof o.firedAt === 'string' && !Number.isNaN(Date.parse(o.firedAt)) ? o.firedAt : undefined,
    });
  }
  return out;
}
