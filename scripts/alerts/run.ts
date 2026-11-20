/**
 * Scheduled alert checker (GitHub Actions, every 10 min). Sends email (Gmail SMTP) and
 * WhatsApp (CallMeBot) when an alert rule fires. Secrets come from GitHub Actions secrets;
 * NOTHING personal is stored in the repository and nothing secret is ever logged.
 *
 * Secrets: GMAIL_USER, GMAIL_APP_PASSWORD, ALERT_EMAIL_TO (optional), WHATSAPP_PHONE, CALLMEBOT_APIKEY.
 * Variables (plain text, optional): ALERT_TARGETS ("above 445, below 400"), ALERT_DAILY_MOVE ("2" or "off"),
 *   DAILY_SUMMARY (email | whatsapp | both | off), DAILY_SUMMARY_HOUR (Dubai hour, default 8),
 *   WHATSAPP_QUIET_HOURS ("23-7" or "off"). ALERT_TEST=1 sends a sample alert now.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import nodemailer from 'nodemailer';
import { chartSvg, renderEmailHtml, renderEmailText, renderSubject, renderWhatsApp, type AlertContext } from '../../src/lib/alertMessages';
import { fetchPaxgHistory, fetchSpot } from '../../src/lib/feed';
import { smaSeries } from '../../src/lib/goldAnalytics';
import { usdOzToAedPerG } from '../../src/lib/goldPricing';
import { marketStatus } from '../../src/lib/market';
import { BRIEF_MAX_AGE_HOURS, sanitizeBrief } from '../../src/lib/brief';
import type { Explainer } from '../../src/lib/teach';
import { dailyDue, dubaiClock, evaluateServerAlerts, inQuietHours, sanitizeConfig, sanitizeState, settingsFromEnv, type AlertEvent, type Facts } from '../../src/lib/serverAlerts';

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

async function latestBrief(): Promise<{ paragraph: string; explainer: Explainer | null } | null> {
  try {
    const r = await fetch(`${SITE_URL}data/brief.json`, { signal: AbortSignal.timeout(15000) });
    const b = r.ok ? sanitizeBrief(await r.json()) : null;
    return b && Date.now() - Date.parse(b.generatedAt) < BRIEF_MAX_AGE_HOURS * 3600e3 ? { paragraph: b.paragraph, explainer: b.explainer } : null;
  } catch {
    return null;
  }
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

async function deliver(ctx: AlertContext, email: boolean, whatsapp: boolean): Promise<boolean> {
  const jobs: Promise<boolean>[] = [];
  if (email) jobs.push(sendEmail(ctx));
  if (whatsapp) jobs.push(sendWhatsApp(ctx));
  const results = await Promise.allSettled(jobs);
  results.forEach((r) => r.status === 'rejected' && console.log(`send error: ${String((r.reason as Error)?.message ?? r.reason).slice(0, 200)}`));
  return results.some((r) => r.status === 'fulfilled' && r.value);
}

async function main() {
  const test = process.env.ALERT_TEST === '1';
  const { config: cfg, notify } = settingsFromEnv(process.env, sanitizeConfig(readJson(CONFIG_PATH)));
  const prev = sanitizeState(readJson(STATE_PATH));

  const spot = await fetchSpot();
  const history = await fetchPaxgHistory().catch(() => null);
  const price24 = usdOzToAedPerG(spot.usd);
  const nowMs = Date.now();
  const today = new Date(nowMs).toISOString().slice(0, 10);

  // Align PAXG history with spot, drop today's partial candle, append the live price.
  let closes: number[] = [];
  if (history?.length) {
    const k = spot.usd / history[history.length - 1].usd;
    closes = history.filter((d) => d.date < today).map((d) => usdOzToAedPerG(d.usd * k));
  }
  const past365 = closes.slice(-365);
  const withNow = [...closes, price24];
  const sma = smaSeries(withNow, 200);
  const ageMin = (nowMs - Date.parse(spot.at)) / 60000;
  const facts: Facts = {
    price24,
    prevClose24: closes.length ? closes[closes.length - 1] : null,
    high52: past365.length > 200 ? Math.max(...past365) : null,
    low52: past365.length > 200 ? Math.min(...past365) : null,
    sma200: sma[sma.length - 1],
    day: today,
    marketOpen: marketStatus(new Date(nowMs)).open && ageMin < 30,
  };

  let alertEvents: AlertEvent[] = [];
  let next = prev;
  if (test) {
    alertEvents = [{ kind: 'test' }];
  } else {
    const r = evaluateServerAlerts(cfg, prev, facts);
    alertEvents = r.events;
    next = r.state;
  }
  const morning = !test && dailyDue(prev, nowMs, notify);
  const clock = dubaiClock(nowMs);
  const quiet = inQuietHours(clock.hour, notify.quietHours);
  console.log(`price ${price24.toFixed(2)} AED/g, market ${facts.marketOpen ? 'open' : 'closed/stale'}, ${cfg.targets.length} targets, alerts: ${alertEvents.map((e) => e.kind).join(',') || 'none'}${morning ? ', morning summary due' : ''}${quiet ? ', WhatsApp quiet hours' : ''}`);
  if (!alertEvents.length && !morning) {
    if (!test) save(next);
    return;
  }

  const brief = await latestBrief();
  const base = { price24, prevClose24: facts.prevClose24, closes30: withNow.slice(-30), targets: cfg.targets, quoteAt: spot.at, siteUrl: SITE_URL, configUrl: CONFIG_URL, brief: brief?.paragraph ?? null, explainer: brief?.explainer ?? null };

  let failed = false;
  if (alertEvents.length) {
    const ok = await deliver({ ...base, events: alertEvents }, true, !quiet);
    if (!ok) {
      // Keep the old state so the alert is retried next run, and fail the job so GitHub notifies the owner.
      console.log('no channel delivered the alert');
      next = { ...prev, lastDailyDay: next.lastDailyDay };
      failed = true;
    }
  }
  if (morning) {
    const ok = await deliver({ ...base, events: [{ kind: 'daily' }] }, notify.daily === 'email' || notify.daily === 'both', notify.daily === 'whatsapp' || notify.daily === 'both');
    if (ok) next = { ...next, lastDailyDay: clock.date };
    else {
      console.log('morning summary not delivered');
      failed = true;
    }
  }
  if (!test) save(next);
  if (failed) process.exitCode = 1;
}

function save(state: unknown) {
  mkdirSync('.alert-state', { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state));
}

main().catch((e) => {
  console.log(`alert run failed: ${String((e as Error)?.message ?? e).slice(0, 200)}`);
  process.exitCode = 1;
});

