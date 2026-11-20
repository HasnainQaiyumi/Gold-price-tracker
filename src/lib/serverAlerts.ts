/**
 * Email/WhatsApp alert rules, evaluated by the scheduled GitHub job (scripts/alerts/run.ts).
 * Pure functions only: config + saved state + market facts -> events + new state.
 * All prices are AED per gram of 24K gold (spot).
 */

export interface TargetRule {
  id: string;
  dir: 'above' | 'below';
  aedPerGram24k: number;
}

export interface AlertConfig {
  targets: TargetRule[];
  dailyMovePct: number | null; // alert when gold moves this much in a day (null = off)
  yearHighLow: boolean; // alert on a new 1-year high or low
  trendCross: boolean; // alert when price crosses its 200-day average
  rearmPct: number; // a fired target re-arms after price moves back this % past it
}

export interface AlertState {
  armed: Record<string, boolean>;
  lastMoveDay?: string;
  lastHighDay?: string;
  lastLowDay?: string;
  trendSide?: 'above' | 'below';
}

export interface Facts {
  price24: number;
  prevClose24: number | null;
  high52: number | null; // highest close of the previous 365 days (excluding today)
  low52: number | null;
  sma200: number | null;
  day: string; // YYYY-MM-DD (UTC)
  marketOpen: boolean;
}

export type AlertEvent =
  | { kind: 'target'; id: string; dir: 'above' | 'below'; target: number }
  | { kind: 'move'; pct: number }
  | { kind: 'yearHigh'; previous: number }
  | { kind: 'yearLow'; previous: number }
  | { kind: 'trend'; side: 'above' | 'below'; sma: number }
  | { kind: 'test' };

export const DEFAULT_CONFIG: AlertConfig = {
  targets: [],
  dailyMovePct: 2,
  yearHighLow: true,
  trendCross: true,
  rearmPct: 1,
};

const fin = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

/** Validates the (user-edited) config file. Anything malformed falls back to safe defaults. */
export function sanitizeConfig(raw: unknown): AlertConfig {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const targets: TargetRule[] = [];
  if (Array.isArray(o.targets)) {
    o.targets.slice(0, 20).forEach((t, i) => {
      const r = (t ?? {}) as Record<string, unknown>;
      if ((r.dir === 'above' || r.dir === 'below') && fin(r.aedPerGram24k, 1, 100000)) {
        const id = typeof r.id === 'string' && r.id.trim() ? r.id.trim().slice(0, 40) : `${r.dir}-${r.aedPerGram24k}-${i}`;
        targets.push({ id, dir: r.dir, aedPerGram24k: r.aedPerGram24k as number });
      }
    });
  }
  return {
    targets,
    dailyMovePct: o.dailyMovePct === null ? null : fin(o.dailyMovePct, 0.1, 50) ? (o.dailyMovePct as number) : DEFAULT_CONFIG.dailyMovePct,
    yearHighLow: typeof o.yearHighLow === 'boolean' ? o.yearHighLow : DEFAULT_CONFIG.yearHighLow,
    trendCross: typeof o.trendCross === 'boolean' ? o.trendCross : DEFAULT_CONFIG.trendCross,
    rearmPct: fin(o.rearmPct, 0, 20) ? (o.rearmPct as number) : DEFAULT_CONFIG.rearmPct,
  };
}

export function sanitizeState(raw: unknown): AlertState {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const armed: Record<string, boolean> = {};
  if (o.armed && typeof o.armed === 'object') {
    for (const [k, v] of Object.entries(o.armed as Record<string, unknown>).slice(0, 100)) if (typeof v === 'boolean') armed[k.slice(0, 40)] = v;
  }
  const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  return {
    armed,
    lastMoveDay: day(o.lastMoveDay),
    lastHighDay: day(o.lastHighDay),
    lastLowDay: day(o.lastLowDay),
    trendSide: o.trendSide === 'above' || o.trendSide === 'below' ? o.trendSide : undefined,
  };
}

export function evaluateServerAlerts(cfg: AlertConfig, prev: AlertState, f: Facts): { events: AlertEvent[]; state: AlertState } {
  const events: AlertEvent[] = [];
  const state: AlertState = { ...prev, armed: { ...prev.armed } };
  const p = f.price24;

  // 1) Your price targets: fire once on crossing, re-arm after moving back by rearmPct.
  for (const t of cfg.targets) {
    const armed = state.armed[t.id] ?? true;
    const hit = t.dir === 'above' ? p >= t.aedPerGram24k : p <= t.aedPerGram24k;
    if (armed && hit) {
      events.push({ kind: 'target', id: t.id, dir: t.dir, target: t.aedPerGram24k });
      state.armed[t.id] = false;
    } else if (!armed) {
      const back = t.dir === 'above' ? p <= t.aedPerGram24k * (1 - cfg.rearmPct / 100) : p >= t.aedPerGram24k * (1 + cfg.rearmPct / 100);
      if (back) state.armed[t.id] = true;
    }
  }
  // forget state of removed targets
  for (const k of Object.keys(state.armed)) if (!cfg.targets.some((t) => t.id === k)) delete state.armed[k];

  if (!f.marketOpen) return { events, state };

  // 2) Big daily move (once per day).
  if (cfg.dailyMovePct !== null && f.prevClose24 && state.lastMoveDay !== f.day) {
    const pct = (p / f.prevClose24 - 1) * 100;
    if (Math.abs(pct) >= cfg.dailyMovePct) {
      events.push({ kind: 'move', pct });
      state.lastMoveDay = f.day;
    }
  }

  // 3) New 1-year high / low (once per day each).
  if (cfg.yearHighLow) {
    if (f.high52 !== null && p > f.high52 && state.lastHighDay !== f.day) {
      events.push({ kind: 'yearHigh', previous: f.high52 });
      state.lastHighDay = f.day;
    }
    if (f.low52 !== null && p < f.low52 && state.lastLowDay !== f.day) {
      events.push({ kind: 'yearLow', previous: f.low52 });
      state.lastLowDay = f.day;
    }
  }

  // 4) Crossing the 200-day average (0.5% buffer so it does not flip-flop).
  if (cfg.trendCross && f.sma200 !== null) {
    const side = p > f.sma200 * 1.005 ? 'above' : p < f.sma200 * 0.995 ? 'below' : null;
    if (side) {
      if (state.trendSide && state.trendSide !== side) events.push({ kind: 'trend', side, sma: f.sma200 });
      state.trendSide = side;
    }
  }

  return { events, state };
}
