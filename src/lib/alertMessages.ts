/** Renders alert emails (HTML + text), WhatsApp text and the chart SVG. Pure, no I/O. */
import type { AlertEvent } from './serverAlerts';
import type { Explainer } from './teach';

export interface AlertContext {
  events: AlertEvent[];
  price24: number; // AED/g 24K now
  prevClose24: number | null;
  closes30: number[]; // last ~30 daily closes AED/g 24K (oldest first), last = now
  targets: { dir: 'above' | 'below'; aedPerGram24k: number }[];
  quoteAt: string; // ISO
  siteUrl: string;
  configUrl: string;
  brief?: string | null; // the latest "Why gold is moving" paragraph, if fresh
  explainer?: Explainer | null; // the full teacher-style explainer (used in the morning briefing)
}

const TOLA_G = 11.6638;
const OZ_G = 31.1034768;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const aed = (v: number, d = 2) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const signPct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}%`;

export function dubaiTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Dubai', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' (Dubai)';
}

/** One plain sentence per event. */
export function describe(e: AlertEvent, price24: number): { title: string; line: string; emoji: string } {
  const p = `AED ${aed(price24)}/g`;
  switch (e.kind) {
    case 'target':
      return e.dir === 'above'
        ? { emoji: '🎯', title: `Gold reached your target`, line: `24K gold rose to ${p}, at or above your target of AED ${aed(e.target)}.` }
        : { emoji: '🎯', title: `Gold dropped to your target`, line: `24K gold fell to ${p}, at or below your target of AED ${aed(e.target)}.` };
    case 'move':
      return { emoji: e.pct >= 0 ? '📈' : '📉', title: `Big move today: ${signPct(e.pct)}`, line: `Gold moved ${signPct(e.pct)} since yesterday's close and is now ${p}.` };
    case 'yearHigh':
      return { emoji: '🏔️', title: 'New 1-year high', line: `Gold is at ${p}, above its highest price of the past year (AED ${aed(e.previous)}).` };
    case 'yearLow':
      return { emoji: '🕳️', title: 'New 1-year low', line: `Gold is at ${p}, below its lowest price of the past year (AED ${aed(e.previous)}).` };
    case 'trend':
      return e.side === 'above'
        ? { emoji: '↗️', title: 'Crossed above its long-term average', line: `Gold (${p}) moved above its 200-day average of AED ${aed(e.sma)}. Many traders see this as the trend turning up. It is not a guarantee.` }
        : { emoji: '↘️', title: 'Crossed below its long-term average', line: `Gold (${p}) moved below its 200-day average of AED ${aed(e.sma)}. Many traders see this as the trend turning down. It is not a guarantee.` };
    case 'daily':
      return { emoji: '☀️', title: 'Good morning! Your gold briefing', line: `24K gold is ${p} this morning.` };
    case 'test':
      return { emoji: '✅', title: 'Test alert: everything works', line: `Your gold alerts are set up correctly. Gold is ${p} right now.` };
  }
}

export function renderSubject(ctx: AlertContext): string {
  const first = describe(ctx.events[0], ctx.price24);
  if (ctx.events.length === 1 && ctx.events[0].kind === 'daily') {
    const chg = ctx.prevClose24 ? (ctx.price24 / ctx.prevClose24 - 1) * 100 : null;
    return `☀️ Gold today: AED ${aed(ctx.price24)}/g${chg !== null ? ` (${chg >= 0 ? '▲' : '▼'} ${signPct(chg)})` : ''}`;
  }
  const more = ctx.events.length > 1 ? ` (+${ctx.events.length - 1} more)` : '';
  return `${first.emoji} Gold ${aed(ctx.price24)} AED/g · ${first.title}${more}`;
}

/** First few sentences of the brief, so WhatsApp stays readable on a phone. */
export function shortBrief(text: string, maxWords = 75): string {
  const out: string[] = [];
  let n = 0;
  for (const sent of text.split(/(?<=[.!?])\s+/)) {
    const w = sent.split(' ').length;
    if (out.length && n + w > maxWords) break;
    out.push(sent);
    n += w;
  }
  return out.join(' ');
}

export const WHATSAPP_MAX_CHARS = 1500; // CallMeBot sends the text inside a URL; keep it safely short

const dirBadge = (d: 'up' | 'down' | 'unclear') => (d === 'up' ? '▲ pushing gold up' : d === 'down' ? '▼ pushing gold down' : 'direction unclear');

/** Condensed explainer for WhatsApp (phone-sized). */
export function whatsappExplainer(x: Explainer, maxChars = 900): string {
  const summary = x.summary.replace(/\s*Below, step by step, is how each one reaches the gold price\.?/, '');
  const lines: string[] = ['📌 *The short version*', summary];
  const d0 = x.drivers[0];
  if (d0) {
    lines.push('', '🔍 *Why it moved*');
    for (const d of x.drivers) lines.push(`${d.icon} *${d.name}* (${dirBadge(d.direction)}${d.note ? ', but not this time' : ''})`);
    lines.push('', `⚙️ *How it works: ${d0.name}*`, d0.steps.join(' → '));
    if (d0.note) lines.push(`_But this time:_ ${d0.note}`);
  }
  if (x.watch[0]) lines.push('', `👀 *Watch next:* ${x.watch[0].event}`, `▲ ${x.watch[0].ifUp}`, `▼ ${x.watch[0].ifDown}`);
  let out = lines.join('\n');
  if (out.length > maxChars) out = out.slice(0, maxChars - 1).replace(/\s+\S*$/, '') + '…';
  return out;
}

export function renderWhatsApp(ctx: AlertContext): string {
  const chg = ctx.prevClose24 ? (ctx.price24 / ctx.prevClose24 - 1) * 100 : null;
  const morningOnly = ctx.events.every((e) => e.kind === 'daily');
  const lines = morningOnly
    ? []
    : ctx.events.map((e) => {
        const d = describe(e, ctx.price24);
        return `${d.emoji} *${d.title}*\n${d.line}`;
      });
  return [
    morningOnly ? `☀️ *GOOD MORNING · GOLD BRIEFING*` : `🟡 *GOLD ALERT*`,
    `*AED ${aed(ctx.price24)}/g* (24K)${chg !== null ? `  ${chg >= 0 ? '▲' : '▼'} ${signPct(chg)} today` : ''}`,
    '',
    ...lines,
    ...(ctx.explainer ? ['', whatsappExplainer(ctx.explainer, ctx.events.some((e) => e.kind === 'daily') ? 900 : 450)] : ctx.brief ? ['', `📰 *Why gold is moving*`, shortBrief(ctx.brief)] : []),
    '',
    `22K: AED ${aed(ctx.price24 * (22 / 24))}/g · Tola 24K: AED ${aed(ctx.price24 * TOLA_G, 0)}`,
    `🕒 ${dubaiTime(ctx.quoteAt)}`,
    `Full explanation: ${ctx.siteUrl}`,
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .slice(0, WHATSAPP_MAX_CHARS);
}

/** Line chart of the last ~30 days with target lines, sized for 2x displays (rendered at 560x220 in email). */
export function chartSvg(closes: number[], targets: AlertContext['targets']): string {
  const W = 1120, H = 440, L = 24, R = 150, T = 30, B = 40;
  const tvals = targets.map((t) => t.aedPerGram24k);
  const all = [...closes, ...tvals.filter((v) => v > Math.min(...closes) * 0.9 && v < Math.max(...closes) * 1.1)];
  const min = Math.min(...all), max = Math.max(...all), pad = (max - min) * 0.08 || 1;
  const lo = min - pad, hi = max + pad;
  const x = (i: number) => L + (i / Math.max(1, closes.length - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const pts = closes.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = closes[closes.length - 1];
  const up = last >= closes[0];
  const c = up ? '#6fcf97' : '#ef6b6b';
  const font = `font-family="DejaVu Sans, Arial, Helvetica, sans-serif"`;
  const grid = [0.25, 0.5, 0.75].map((f) => `<line x1="${L}" x2="${W - R}" y1="${(T + f * (H - T - B)).toFixed(1)}" y2="${(T + f * (H - T - B)).toFixed(1)}" stroke="#2a261d" stroke-width="2"/>`).join('');
  // Label placement on the right edge: never let a target label collide with the price label.
  const lastY = y(closes[closes.length - 1]);
  const taken: number[] = [lastY];
  const placeLabel = (want: number) => {
    let v = want;
    for (let guard = 0; guard < 8 && taken.some((u) => Math.abs(u - v) < 40); guard++) v += v <= lastY ? -40 : 40;
    v = Math.max(T + 10, Math.min(H - B - 4, v));
    taken.push(v);
    return v;
  };
  const tlines = targets
    .filter((t) => t.aedPerGram24k > lo && t.aedPerGram24k < hi)
    .map((t) => {
      const ty = y(t.aedPerGram24k);
      const ly = placeLabel(ty);
      return `<line x1="${L}" x2="${W - R}" y1="${ty.toFixed(1)}" y2="${ty.toFixed(1)}" stroke="#d9a93f" stroke-width="3" stroke-dasharray="12 10"/><text x="${W - R + 12}" y="${(ly + 9).toFixed(1)}" fill="#d9a93f" font-size="26" ${font}>Target ${t.aedPerGram24k.toFixed(0)}</text>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><linearGradient id="g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${c}" stop-opacity="0.35"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="#14120e"/>${grid}${tlines}
<polygon points="${x(0).toFixed(1)},${H - B} ${pts} ${x(closes.length - 1).toFixed(1)},${H - B}" fill="url(#g)"/>
<polyline points="${pts}" fill="none" stroke="${c}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>
<circle cx="${x(closes.length - 1).toFixed(1)}" cy="${y(last).toFixed(1)}" r="11" fill="${c}"/><circle cx="${x(closes.length - 1).toFixed(1)}" cy="${y(last).toFixed(1)}" r="20" fill="${c}" fill-opacity="0.25"/>
<text x="${W - R + 12}" y="${(y(last) + 10).toFixed(1)}" fill="#f4efe6" font-size="30" font-weight="bold" ${font}>${last.toFixed(1)}</text>
<text x="${L}" y="${H - 10}" fill="#7d7667" font-size="24" ${font}>${closes.length} days · AED per gram, 24K</text>
</svg>`;
}

const H = (t: string) => `<div style="font-family:Georgia,'Times New Roman',serif;font-size:19px;color:#fbf7ef;font-weight:600;margin:26px 0 8px">${esc(t)}</div>`;
const P = (t: string) => `<div style="font-size:15px;line-height:1.75;color:#e8e1d2">${esc(t)}</div>`;

/** The full teacher-style explainer as email-safe HTML (tables + inline styles). */
export function explainerHtml(x: Explainer, full: boolean): string {
  const drivers = x.drivers
    .map((d) => {
      const color = d.direction === 'up' ? '#6fcf97' : d.direction === 'down' ? '#ef6b6b' : '#a39b8a';
      const steps = (full ? d.steps : [])
        .map(
          (st, i) =>
            `<tr><td valign="top" style="width:30px;padding:0 0 8px"><div style="width:22px;height:22px;line-height:22px;border-radius:11px;background:#2a2213;border:1px solid #6b5420;color:#f0cf72;font-size:11px;font-weight:700;text-align:center">${i + 1}</div></td><td style="padding:2px 0 8px;font-size:14px;line-height:1.55;color:${i === d.steps.length - 1 ? '#f0cf72' : '#d8d0bf'};${i === d.steps.length - 1 ? 'font-weight:700' : ''}">${esc(st)}</td></tr>`
        )
        .join('');
      return `<div style="margin-top:12px;padding:16px 18px;background:#0d0c09;border:1px solid #2a261d;border-radius:16px">
<div style="font-size:15px;font-weight:700;color:#fbf7ef">${d.icon} ${esc(d.name)} <span style="display:inline-block;margin-left:6px;padding:2px 9px;border-radius:999px;font-size:11px;color:${color};background:${color}1f;border:1px solid ${color}55">${esc(dirBadge(d.direction))}</span></div>
<div style="font-size:14px;line-height:1.65;color:#e8e1d2;margin-top:8px"><span style="color:#a39b8a">In the news: </span>${esc(d.whatHappened)}</div>
${full ? `<div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#7d7667;margin:14px 0 8px">How it reaches the gold price</div><table role="presentation" cellpadding="0" cellspacing="0" width="100%">${steps}</table>` : ''}
${d.note ? `<div style="margin-top:8px;padding:9px 12px;border-radius:10px;background:#2a2312;border:1px solid #5c4a1e;font-size:13px;line-height:1.6;color:#f0dca4"><b>But this time:</b> ${esc(d.note)}</div>` : ''}
${full ? `<div style="margin-top:10px;font-size:13px;line-height:1.65;color:#cfc7b6"><b style="color:#e8e1d2">💡 Think of it like this:</b> <i>${esc(d.analogy)}</i></div>` : ''}
</div>`;
    })
    .join('');
  const watch = x.watch
    .map((w) => `<div style="margin-top:10px;padding:12px 16px;background:#0d0c09;border:1px solid #2a261d;border-radius:14px"><div style="font-size:14px;font-weight:700;color:#fbf7ef">👀 ${esc(w.event)}</div><div style="font-size:13px;line-height:1.6;color:#6fcf97;margin-top:6px">▲ ${esc(w.ifUp)}</div><div style="font-size:13px;line-height:1.6;color:#ef6b6b">▼ ${esc(w.ifDown)}</div></div>`)
    .join('');
  return `<div style="margin-top:24px;padding:18px 20px;border-radius:16px;border:1px solid #5c4a1e;background:#1b170e"><div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#d9a93f;font-weight:700">The short version</div><div style="font-size:16px;line-height:1.7;color:#fbf7ef;margin-top:8px">${esc(x.summary)}</div></div>
${full && x.happened ? H('What happened to gold') + P(x.happened) : ''}
${drivers ? H('Why it happened, step by step') + drivers : ''}
${full && watch ? H('What to watch next') + watch : ''}
${full && x.lesson.title ? `<div style="margin-top:22px;padding:18px 20px;background:#0d0c09;border:1px solid #2a261d;border-radius:16px"><div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#7d7667;font-weight:700">📚 Today's lesson</div><div style="font-family:Georgia,'Times New Roman',serif;font-size:18px;color:#f0cf72;font-weight:600;margin-top:4px">${esc(x.lesson.title)}</div><div style="font-size:15px;line-height:1.75;color:#e8e1d2;margin-top:8px">${esc(x.lesson.body)}</div></div>` : ''}
${full && x.forYou ? H('What this means for you') + P(x.forYou) : ''}`;
}

export function renderEmailHtml(ctx: AlertContext): string {
  const first = describe(ctx.events[0], ctx.price24);
  const chg = ctx.prevClose24 ? (ctx.price24 / ctx.prevClose24 - 1) * 100 : null;
  const chgColor = chg === null ? '#a39b8a' : chg >= 0 ? '#6fcf97' : '#ef6b6b';
  const cell = (label: string, value: string) =>
    `<td style="padding:14px 10px;background:#0d0c09;border-radius:12px;text-align:center;width:33%"><div style="font-size:11px;color:#a39b8a;letter-spacing:.06em;text-transform:uppercase">${esc(label)}</div><div style="font-size:17px;color:#f4efe6;font-weight:700;margin-top:4px">${esc(value)}</div></td>`;
  const items = ctx.events
    .filter((e) => e.kind !== 'daily')
    .map((e) => {
      const d = describe(e, ctx.price24);
      return `<tr><td style="padding:12px 0;border-top:1px solid #2a261d"><div style="font-size:15px;color:#fbf7ef;font-weight:700">${d.emoji} ${esc(d.title)}</div><div style="font-size:14px;color:#d8d0bf;line-height:1.5;margin-top:3px">${esc(d.line)}</div></td></tr>`;
    })
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>${esc(renderSubject(ctx))}</title></head>
<body style="margin:0;padding:0;background:#0a0907">
<div style="display:none;max-height:0;overflow:hidden">${esc(first.line)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0907"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<tr><td style="padding:0 6px 14px"><table role="presentation" width="100%"><tr>
<td style="font-size:15px;font-weight:800;letter-spacing:.3em;color:#f0cf72">● GOLD</td>
<td align="right" style="font-size:12px;color:#7d7667">${esc(dubaiTime(ctx.quoteAt))}</td></tr></table></td></tr>
<tr><td style="background:#16130d;border:1px solid #4a3c1c;border-radius:20px;padding:28px 26px">
<div style="font-size:13px;color:#d9a93f;font-weight:700;letter-spacing:.08em;text-transform:uppercase">${first.emoji} ${esc(first.title)}</div>
<div style="font-family:Georgia,'Times New Roman',serif;font-size:52px;line-height:1.05;color:#f0cf72;font-weight:600;margin-top:10px"><span style="font-size:22px;color:#a39b8a;vertical-align:middle">AED</span> ${aed(ctx.price24)}</div>
<div style="font-size:13px;color:#a39b8a;margin-top:6px">per gram · 24K${chg !== null ? ` &nbsp;<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:${chgColor}22;color:${chgColor};font-weight:700">${chg >= 0 ? '▲' : '▼'} ${signPct(chg)} today</span>` : ''}</div>
<img src="cid:chart" width="548" alt="Gold price, last ${ctx.closes30.length} days" style="display:block;width:100%;max-width:548px;height:auto;border-radius:14px;margin-top:22px;border:1px solid #2a261d">
<table role="presentation" width="100%" cellpadding="0" cellspacing="6" style="margin-top:14px"><tr>
${cell('22K per gram', `AED ${aed(ctx.price24 * (22 / 24))}`)}${cell('24K per tola', `AED ${aed(ctx.price24 * TOLA_G, 0)}`)}${cell('24K per ounce', `AED ${aed(ctx.price24 * OZ_G, 0)}`)}
</tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px">${items}</table>
${ctx.explainer ? explainerHtml(ctx.explainer, ctx.events.some((e) => e.kind === 'daily')) : ctx.brief ? `<div style="margin-top:18px;padding:16px 18px;background:#0d0c09;border:1px solid #2a261d;border-radius:14px"><div style="font-size:12px;color:#d9a93f;font-weight:700;letter-spacing:.06em;text-transform:uppercase">📰 Why gold is moving</div><div style="font-size:14px;line-height:1.7;color:#e8e1d2;margin-top:8px">${esc(ctx.brief)}</div></div>` : ''}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:22px"><tr><td style="border-radius:12px;background:#d9a93f"><a href="${esc(ctx.siteUrl)}" style="display:inline-block;padding:13px 22px;color:#1a1405;font-weight:800;font-size:14px;text-decoration:none">Open the full Gold app →</a></td></tr></table>
</td></tr>
<tr><td style="padding:16px 8px;font-size:11px;line-height:1.6;color:#7d7667">Spot price of pure gold; shops add making charges and a premium. Not financial advice.<br>Change or stop alerts: <a href="${esc(ctx.configUrl)}" style="color:#d9a93f">edit your alert settings</a>.</td></tr>
</table></td></tr></table></body></html>`;
}

export function renderEmailText(ctx: AlertContext): string {
  return renderWhatsApp(ctx).replace(/\*/g, '') + `\n\nChange alerts: ${ctx.configUrl}`;
}
