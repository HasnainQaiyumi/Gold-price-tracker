/**
 * Scheduled alert checker (GitHub Actions, every 10 min). Sends email (Gmail SMTP) and
 * WhatsApp (CallMeBot) when an alert rule fires. Secrets come from GitHub Actions secrets;
 * NOTHING personal is stored in the repository and nothing secret is ever logged.
 *
 * Secrets: GMAIL_USER, GMAIL_APP_PASSWORD, ALERT_EMAIL_TO (optional), WHATSAPP_PHONE, CALLMEBOT_APIKEY.
 * Variables (plain text, optional): ALERT_TARGETS ("above 445, below 400"), ALERT_DAILY_MOVE ("2" or "off"),
 *   DAILY_SUMMARY (email | whatsapp | both | off), DAILY_SUMMARY_HOUR (first briefing, Dubai hour, default 8),
 *   SUMMARY_EVERY_HOURS (default 8: 8am, 4pm, midnight), EMAIL_KEEP_ONLY_LATEST (on | off, default on),
 *   WHATSAPP_QUIET_HOURS ("23-7" or "off"). ALERT_TEST=1 sends a sample alert now.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import nodemailer from 'nodemailer';
import { chartSvg, newUpdateMessageId, renderEmailHtml, renderEmailText, renderSubject, renderWhatsApp, THREAD_ROOT, THREAD_SUBJECT, type AlertContext } from '../../src/lib/alertMessages';
import { trashOlderUpdates } from './mailbox';
import { fetchPaxgHistory, fetchSpot } from '../../src/lib/feed';
import { smaSeries } from '../../src/lib/goldAnalytics';
import { usdOzToAedPerG } from '../../src/lib/goldPricing';
import { marketStatus } from '../../src/lib/market';
import { BRIEF_MAX_AGE_HOURS, sanitizeBrief } from '../../src/lib/brief';
import type { Explainer } from '../../src/lib/teach';
import { summaryDue, summarySlot, dubaiClock, evaluateServerAlerts, freshState, inQuietHours, sanitizeConfig, sanitizeState, settingsFromEnv, type AlertEvent, type Facts } from '../../src/lib/serverAlerts';
import { happenedSentences, priceFacts } from '../../src/lib/explain';
import type { DailyBar } from '../../src/lib/forecast/types';

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

type SendResult = 'sent' | 'skipped' | 'failed';
const emailReady = () => !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
const whatsappReady = () => !!(process.env.WHATSAPP_PHONE && process.env.CALLMEBOT_APIKEY);
const errText = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 160);

async function sendEmail(ctx: AlertContext): Promise<SendResult> {
  if (!emailReady()) return 'skipped';
  const user = process.env.GMAIL_USER as string, pass = process.env.GMAIL_APP_PASSWORD as string;
  try {
    const png = new Resvg(chartSvg(ctx.closes30, ctx.targets), { fitTo: { mode: 'width', value: 1120 } }).render().asPng();
    const t = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass } });
    const messageId = newUpdateMessageId(Date.now(), Math.random());
    await t.sendMail({
      from: `"Gold updates" <${user}>`,
      to: process.env.ALERT_EMAIL_TO || user,
      subject: THREAD_SUBJECT, // same subject + same thread root = one Gmail conversation
      messageId,
      inReplyTo: THREAD_ROOT,
      references: [THREAD_ROOT],
      text: `${renderSubject(ctx)}\n\n${renderEmailText(ctx)}`,
      html: renderEmailHtml(ctx),
      attachments: [{ filename: 'gold-chart.png', content: png, cid: 'chart' }],
    });
    if ((process.env.EMAIL_KEEP_ONLY_LATEST ?? 'on').trim().toLowerCase() !== 'off') {
      try {
        const n = await trashOlderUpdates(user, pass, messageId);
        console.log(`email: moved ${n} older update(s) to Trash`);
      } catch (e) {
        console.log(`::warning title=Email clean-up::could not move older updates to Trash (${errText(e)}). The new email was sent.`);
      }
    }
    console.log('email: sent');
    return 'sent';
  } catch (e) {
    console.log(`::warning title=Email alert::sending failed (${errText(e)}). Check the GMAIL_APP_PASSWORD secret.`);
    return 'failed';
  }
}

async function sendWhatsApp(ctx: AlertContext): Promise<SendResult> {
  if (!whatsappReady()) return 'skipped';
  try {
    const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(process.env.WHATSAPP_PHONE as string)}&text=${encodeURIComponent(renderWhatsApp(ctx))}&apikey=${encodeURIComponent(process.env.CALLMEBOT_APIKEY as string)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const body = await res.text();
    // CallMeBot answers 200 with an HTML page; failures mention "error"/"invalid". Never log the URL (it holds the key).
    const ok = res.ok && !/error|invalid|not allowed/i.test(body);
    console.log(ok ? 'whatsapp: sent' : `::warning title=WhatsApp alert::sending failed (HTTP ${res.status})`);
    return ok ? 'sent' : 'failed';
  } catch {
    console.log('::warning title=WhatsApp alert::sending failed (network error)');
    return 'failed';
  }
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

/** Sends on the given channels. `attempted` = a configured channel was actually tried. */
async function deliver(ctx: AlertContext, ch: { email: boolean; whatsapp: boolean }) {
  const results = await Promise.all([ch.email ? sendEmail(ctx) : Promise.resolve<SendResult>('skipped'), ch.whatsapp ? sendWhatsApp(ctx) : Promise.resolve<SendResult>('skipped')]);
  return { sent: results.includes('sent'), attempted: results.some((r) => r !== 'skipped'), failed: results.includes('failed') && !results.includes('sent') };
}

async function main() {
  const test = process.env.ALERT_TEST === '1';
  const { config: cfg, notify, skippedTargets } = settingsFromEnv(process.env, sanitizeConfig(readJson(CONFIG_PATH)));
  if (skippedTargets.length) console.log(`::warning title=Alert settings::could not read these ALERT_TARGETS parts, ignored: ${skippedTargets.join(' | ')}. Use e.g. "above 445, below 400".`);
  if (!emailReady() && !whatsappReady()) console.log('::warning title=Alert settings::no channel is set up (add the GMAIL_USER and GMAIL_APP_PASSWORD secrets).');

  const spot = await fetchSpot();
  const history = await fetchPaxgHistory().catch(() => null);
  const price24 = usdOzToAedPerG(spot.usd);
  const nowMs = Date.now();
  const today = new Date(nowMs).toISOString().slice(0, 10);

  const stored = readJson(STATE_PATH);
  const prev = stored ? sanitizeState(stored) : freshState(cfg, price24);
  if (!stored && !test) console.log('alert memory missing: starting fresh (targets already crossed will not be re-sent)');

  // Align PAXG history with spot, drop today's partial candle, append the live price.
  let closes: number[] = [];
  let series: DailyBar[] = [];
  if (history?.length) {
    const k = spot.usd / history[history.length - 1].usd;
    const past = history.filter((d) => d.date < today).map((d) => ({ date: d.date, usd: d.usd * k }));
    closes = past.map((d) => usdOzToAedPerG(d.usd));
    series = [...past, { date: today, usd: spot.usd }];
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
  const clock = dubaiClock(nowMs);
  const quiet = inQuietHours(clock.hour, notify.quietHours);
  const slot = summarySlot(nowMs, notify);
  const morning = !test && summaryDue(prev, nowMs, notify);
  console.log(`price ${price24.toFixed(2)} AED/g, market ${facts.marketOpen ? 'open' : 'closed/stale'}, ${cfg.targets.length} targets, alerts: ${alertEvents.map((e) => e.kind).join(',') || 'none'}${morning ? ', briefing due' : ''}${quiet ? ', WhatsApp quiet hours' : ''}`);
  if (!alertEvents.length && !morning) {
    if (!test) save(next);
    return;
  }

  const brief = await latestBrief();
  let explainer = brief?.explainer ?? null;
  if (explainer && series.length > 30) {
    // The brief can be up to a few hours old: rebuild its price sentences from live data so nothing contradicts the header.
    const fmtPrice = (usd: number) => `AED ${usdOzToAedPerG(usd).toFixed(2)} per gram of 24K gold`;
    explainer = { ...explainer, happened: happenedSentences(priceFacts(series, spot.usd), fmtPrice).join(' ') };
  }
  const base = { price24, prevClose24: facts.prevClose24, closes30: withNow.slice(-30), targets: cfg.targets, quoteAt: spot.at, siteUrl: SITE_URL, configUrl: CONFIG_URL, brief: brief?.paragraph ?? null, explainer, name: (process.env.ALERT_NAME ?? '').trim() || 'Hasnain' };

  let failed = false;
  if (alertEvents.length) {
    const ch = { email: emailReady(), whatsapp: whatsappReady() && !quiet };
    if (!ch.email && !ch.whatsapp) {
      if (whatsappReady() && quiet) {
        console.log('alert waiting: WhatsApp is in quiet hours and email is not set up');
        next = { ...prev }; // keep it pending; it will be sent after quiet hours
      } else {
        console.log('alert not sent: no channel is set up');
      }
    } else {
      const r = await deliver({ ...base, events: alertEvents }, ch);
      if (!r.sent) {
        console.log('alert not delivered; will retry next run');
        next = { ...prev };
        failed = r.attempted;
      }
    }
  }
  if (morning) {
    const wantEmail = notify.daily === 'email' || notify.daily === 'both';
    const wantWa = notify.daily === 'whatsapp' || notify.daily === 'both';
    const ch = { email: wantEmail && emailReady(), whatsapp: wantWa && whatsappReady() && !quiet };
    const ctx = { ...base, prevClose24: facts.marketOpen ? facts.prevClose24 : null, events: [{ kind: 'daily' } as AlertEvent] };
    if (!ch.email && !ch.whatsapp) {
      if (wantWa && whatsappReady() && quiet) console.log('briefing waiting for WhatsApp quiet hours to end');
      else {
        console.log(`::warning title=Briefing::DAILY_SUMMARY is "${notify.daily}" but that channel is not set up; skipped for this briefing.`);
        next = { ...next, lastSummarySlot: slot };
      }
    } else {
      const r = await deliver(ctx, ch);
      if (r.sent) next = { ...next, lastSummarySlot: slot };
      else {
        console.log('briefing not delivered; will retry next run');
        failed = failed || r.attempted;
      }
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
  console.log(`::error title=Gold alerts::run failed (${errText(e)})`);
  process.exitCode = 1;
});
