/**
 * Scheduled alert checker (GitHub Actions, every 10 min). Sends email (Gmail SMTP) and
 * WhatsApp (CallMeBot) when an alert rule fires. Secrets come from GitHub Actions secrets;
 * NOTHING personal is stored in the repository and nothing secret is ever logged.
 *
 * Env: GMAIL_USER, GMAIL_APP_PASSWORD, ALERT_EMAIL_TO (optional, defaults to GMAIL_USER),
 *      WHATSAPP_PHONE, CALLMEBOT_APIKEY, ALERT_TEST=1 (send a sample alert now).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import nodemailer from 'nodemailer';
import { chartSvg, renderEmailHtml, renderEmailText, renderSubject, renderWhatsApp, type AlertContext } from '../../src/lib/alertMessages';
import { fetchPaxgHistory, fetchSpot } from '../../src/lib/feed';
import { smaSeries } from '../../src/lib/goldAnalytics';
import { usdOzToAedPerG } from '../../src/lib/goldPricing';
import { marketStatus } from '../../src/lib/market';
import { evaluateServerAlerts, sanitizeConfig, sanitizeState, type AlertEvent, type Facts } from '../../src/lib/serverAlerts';

const SITE_URL = 'https://hasnainqaiyumi.github.io/Gold-price-tracker/';
const CONFIG_URL = 'https://github.com/HasnainQaiyumi/Gold-price-tracker/edit/main/public/alerts.config.json';
const CONFIG_PATH = 'public/alerts.config.json';
const STATE_PATH = '.alert-state/state.json';

const readJson = (p: string): unknown => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};

async function sendEmail(ctx: AlertContext): Promise<boolean> {
  const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    console.log('email: not configured (GMAIL_USER / GMAIL_APP_PASSWORD secrets missing), skipped');
    return false;
  }
  const png = new Resvg(chartSvg(ctx.closes30, ctx.targets), { fitTo: { mode: 'width', value: 1120 } }).render().asPng();
  const t = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass } });
  await t.sendMail({
    from: `"Gold alerts" <${user}>`,
    to: process.env.ALERT_EMAIL_TO || user,
    subject: renderSubject(ctx),
    text: renderEmailText(ctx),
    html: renderEmailHtml(ctx),
    attachments: [{ filename: 'gold-chart.png', content: png, cid: 'chart' }],
  });
  console.log('email: sent');
  return true;
}

async function sendWhatsApp(ctx: AlertContext): Promise<boolean> {
  const phone = process.env.WHATSAPP_PHONE, key = process.env.CALLMEBOT_APIKEY;
  if (!phone || !key) {
    console.log('whatsapp: not configured (WHATSAPP_PHONE / CALLMEBOT_APIKEY secrets missing), skipped');
    return false;
  }
  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(renderWhatsApp(ctx))}&apikey=${encodeURIComponent(key)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const body = await res.text();
  // CallMeBot answers 200 with an HTML page; failures mention "error"/"invalid".
  const ok = res.ok && !/error|invalid|not allowed/i.test(body);
  console.log(`whatsapp: ${ok ? 'sent' : `failed (HTTP ${res.status})`}`);
  return ok;
}

async function main() {
  const test = process.env.ALERT_TEST === '1';
  const cfg = sanitizeConfig(readJson(CONFIG_PATH));
  const prev = sanitizeState(readJson(STATE_PATH));

  const spot = await fetchSpot();
  const history = await fetchPaxgHistory().catch(() => null);
  const price24 = usdOzToAedPerG(spot.usd);
  const today = new Date().toISOString().slice(0, 10);

  // Align PAXG history with spot, drop today's partial candle, append the live price.
  let closes: number[] = [];
  if (history?.length) {
    const k = spot.usd / history[history.length - 1].usd;
    closes = history.filter((d) => d.date < today).map((d) => usdOzToAedPerG(d.usd * k));
  }
  const past365 = closes.slice(-365);
  const withNow = [...closes, price24];
  const sma = smaSeries(withNow, 200);
  const ageMin = (Date.now() - Date.parse(spot.at)) / 60000;
  const facts: Facts = {
    price24,
    prevClose24: closes.length ? closes[closes.length - 1] : null,
    high52: past365.length > 200 ? Math.max(...past365) : null,
    low52: past365.length > 200 ? Math.min(...past365) : null,
    sma200: sma[sma.length - 1],
    day: today,
    marketOpen: marketStatus(new Date()).open && ageMin < 30,
  };

  let events: AlertEvent[];
  let next = prev;
  if (test) {
    events = [{ kind: 'test' }];
  } else {
    const r = evaluateServerAlerts(cfg, prev, facts);
    events = r.events;
    next = r.state;
  }
  console.log(`price ${price24.toFixed(2)} AED/g, market ${facts.marketOpen ? 'open' : 'closed/stale'}, ${cfg.targets.length} targets, events: ${events.map((e) => e.kind).join(',') || 'none'}`);

  if (events.length) {
    const ctx: AlertContext = {
      events, price24, prevClose24: facts.prevClose24,
      closes30: withNow.slice(-30), targets: cfg.targets, quoteAt: spot.at, siteUrl: SITE_URL, configUrl: CONFIG_URL,
    };
    const results = await Promise.allSettled([sendEmail(ctx), sendWhatsApp(ctx)]);
    results.forEach((r) => r.status === 'rejected' && console.log(`send error: ${String((r.reason as Error)?.message ?? r.reason).slice(0, 200)}`));
    const anySent = results.some((r) => r.status === 'fulfilled' && r.value);
    if (!anySent) {
      // Keep state unchanged so the alert is retried next run, and fail the job so GitHub notifies you.
      console.log('no channel delivered the alert');
      process.exitCode = 1;
      return;
    }
  }
  if (!test) {
    mkdirSync('.alert-state', { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify(next));
  }
}

main().catch((e) => {
  console.log(`alert run failed: ${String((e as Error)?.message ?? e).slice(0, 200)}`);
  process.exitCode = 1;
});

