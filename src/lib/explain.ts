/**
 * "Why gold moved, and what could happen next" — pure logic.
 *
 * Inputs are only real data: daily closes (scaled to live spot), recent news headlines, and an optional
 * dollar-index move. Output is very plain English (about a 12-year-old reading level).
 *
 * Rules this file follows:
 *  - A cause is never invented. "Why" only lists topics that actually appear in the headlines (each one cites the
 *    headlines it came from), or the measured dollar move. We say these topics were in the news, not that they
 *    definitely caused the move.
 *  - "What could happen next" is always two-sided (if X, gold could rise; if Y, it could fall). No certainty.
 */
import type { DailyBar } from './forecast/types';
import { minusDays, type DollarMove, type Headline } from './news';

// ---------------------------------------------------------------------------------------------------------------
// Price facts
// ---------------------------------------------------------------------------------------------------------------

export interface PriceFacts {
  last: number;
  lastDate: string;
  todayPct: number | null; // vs the previous daily close
  twoDayPct: number | null; // ~ the news window
  weekPct: number | null;
  monthPct: number | null;
  avg50: number | null; // mean close over the last 50 calendar days
  avg200: number | null;
  vs50Pct: number | null;
  vs200Pct: number | null;
  high52: number | null; // over the last 365 days (including now)
  low52: number | null;
  fromHighPct: number | null; // <= 0
  fromLowPct: number | null; // >= 0
}

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

/** % change from the last bar dated on/before (lastDate - days), if one exists within a few days of the target. */
export function changeSinceDays(series: DailyBar[], days: number): number | null {
  if (series.length < 2) return null;
  const last = series[series.length - 1];
  const target = minusDays(last.date, days);
  const oldest = minusDays(target, 4); // tolerate weekends/holidays in trading-day series
  for (let i = series.length - 2; i >= 0; i--) {
    const b = series[i];
    if (b.date <= target) return b.date >= oldest ? (last.usd / b.usd - 1) * 100 : null;
  }
  return null;
}

/** Bars inside the last `days` calendar days, but only if the series actually covers that whole window. */
function windowBars(series: DailyBar[], days: number): DailyBar[] | null {
  if (!series.length) return null;
  const lastDate = series[series.length - 1].date;
  const start = minusDays(lastDate, days - 1);
  if (series[0].date > minusDays(start, -3)) return null; // history too short
  const w = series.filter((b) => b.date >= start);
  return w.length >= Math.ceil(days * 0.6) ? w : null;
}

export function windowMean(series: DailyBar[], days: number): number | null {
  const w = windowBars(series, days);
  return w ? w.reduce((a, b) => a + b.usd, 0) / w.length : null;
}

/**
 * Facts from the daily series. `spotUsd`, if given, replaces the last close (the series' last bar is meant to be
 * live already; this just keeps the two in sync).
 */
export function priceFacts(series: DailyBar[] | null, spotUsd?: number | null): PriceFacts | null {
  if (!series) return null;
  const valid = series.filter((b) => b && typeof b.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.date) && isNum(b.usd));
  if (!valid.length) return null;
  // Defensive: oldest first, one bar per date (the later one wins), so every window/lookback below is valid.
  const byDate = new Map<string, DailyBar>();
  for (const b of valid) byDate.set(b.date, b);
  const s = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (isNum(spotUsd)) s[s.length - 1] = { date: s[s.length - 1].date, usd: spotUsd };
  const last = s[s.length - 1];

  let todayPct: number | null = null;
  if (s.length >= 2) {
    const prev = s[s.length - 2];
    if (prev.date >= minusDays(last.date, 4)) todayPct = (last.usd / prev.usd - 1) * 100;
  }
  const avg50 = windowMean(s, 50);
  const avg200 = windowMean(s, 200);
  const yr = windowBars(s, 365);
  const high52 = yr ? Math.max(...yr.map((b) => b.usd)) : null;
  const low52 = yr ? Math.min(...yr.map((b) => b.usd)) : null;
  const rel = (a: number | null) => (a === null ? null : (last.usd / a - 1) * 100);
  return {
    last: last.usd,
    lastDate: last.date,
    todayPct,
    twoDayPct: changeSinceDays(s, 2),
    weekPct: changeSinceDays(s, 7),
    monthPct: changeSinceDays(s, 30),
    avg50,
    avg200,
    vs50Pct: rel(avg50),
    vs200Pct: rel(avg200),
    high52,
    low52,
    fromHighPct: rel(high52),
    fromLowPct: rel(low52),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Headline themes
// ---------------------------------------------------------------------------------------------------------------

export type ThemeId =
  | 'fed'
  | 'inflation'
  | 'dollar'
  | 'geopolitics'
  | 'centralBanks'
  | 'etfFlows'
  | 'econData'
  | 'trade'
  | 'riskMood'
  | 'profitTaking'
  | 'physicalDemand'
  | 'metals';

/** What a piece of wording suggests for the gold price. */
export type Lean = 'up' | 'down';
/** Overall lean of a theme across its headlines. */
export type ThemeLean = Lean | 'mixed' | 'unclear';

interface Hint {
  re: RegExp; // must NOT be global
  lean: Lean | ((m: RegExpExecArray) => Lean);
}

interface ThemeDef {
  id: ThemeId;
  label: string;
  keys: RegExp[]; // must NOT be global
  hints: Hint[]; // most specific first: a match blanks its text so later, looser rules can't re-use it
  weight: number; // metals are a companion move, not a cause: half weight
}

// Movement verbs. Kept as plain alternations so they can be embedded in other patterns.
const UP_W =
  'rises?|rose|rising|climbs?|climbed|climbing|jumps?|jumped|gains?|gained|gaining|rall(?:y|ies|ied|ying)|surges?|surged|surging|soars?|soared|advances?|advanced|rebounds?|rebounded|recovers?|recovered|spikes?|spiked|firms?|firmed|firming|strengthens?|strengthened|strengthening|edges? (?:up|higher)|inches? (?:up|higher)|ticks? (?:up|higher)|extends? gains|hits? (?:a )?(?:record|new|fresh|all-time|\\d+-\\w+) (?:high|peak)|record high|all-time high|higher|up';
const DOWN_W =
  'falls?|fell|falling|slips?|slipped|slipping|drops?|dropped|dropping|declines?|declined|declining|slides?|slid|sliding|tumbles?|tumbled|plunges?|plunged|plunging|sinks?|sank|sinking|dips?|dipped|dipping|eases?|eased|easing|retreats?|retreated|slumps?|slumped|loses?|lost|sheds?|weakens?|weakened|weakening|softens?|softened|cools?|cooled|cooling|slows?|slowed|slowing|edges? (?:down|lower)|ticks? (?:down|lower)|extends? (?:losses|declines)|crash(?:es|ed)?|lower|down';

/** "<subject> ... <verb>" where the first movement verb after the subject decides; subject-up maps to `ifUp`. */
/** Gap that may not cross a clause connector ("gold steady as Fed easing bets..." must not read as "gold eases"). */
const gapRe = (n: number) => `(?:(?!\\b(?:as|on|after|amid|while|with|despite|but|ahead|before|following|over|even|though|although|yet|whereas)\\b)[^.;:!?|]){0,${n}}?`;

function moveHint(subject: string, ifUp: Lean, gap = 30): Hint {
  return {
    re: new RegExp(`\\b(?:${subject})\\b${gapRe(gap)}\\b(?:(${UP_W})|(${DOWN_W}))\\b`, 'i'),
    lean: (m) => (m[1] ? ifUp : ifUp === 'up' ? 'down' : 'up'),
  };
}

const rx = (s: string) => new RegExp(s, 'i');

const SAFE_HAVEN: Hint = { re: rx('\\bsafe[- ]havens?(?: (?:demand|buying|bid|flows|appeal|status|assets?))?\\b'), lean: 'up' };

export const THEMES: ThemeDef[] = [
  {
    id: 'fed',
    label: 'Interest rates (the Fed)',
    keys: [rx('\\b(?:fed|feds|federal reserve|fomc|powell|rate[- ]cuts?|rate[- ]hikes?|interest[- ]rates?|monetary policy|(?:treasury |bond |real )?yields?|policymakers?)\\b')],
    hints: [
      { re: rx('\\b(?:(?:rate[- ]?)?cut (?:hopes|bets|expectations|odds|bets) (?:fade|fades|faded|dim|dims|dimmed|wane|wanes|waned|recede|recedes|receded|cool|cools|cooled|ebb|ebbs|shrink|shrinks|drop|drops|fall|falls|pared|dashed)|fewer (?:rate[- ])?cuts|no (?:\\w+ )?(?:rate[- ])?cuts?|(?:doubts?|uncertainty|skepticism|scepticism) (?:over|about|on|around) (?:a |the |any )?(?:\\w+ )?(?:rate[- ])?cuts?|(?:against|opposes?|opposed to|rejects?) (?:a |any |more |further )?(?:\\w+ )?(?:rate[- ])?cuts?|(?:delays?|delayed|pushes? back (?:on|against)|no rush to|no hurry to|in no hurry to|rules? out|scales? back|pares?)\\b[^.;:]{0,20}?\\b(?:rate[- ])?cuts?)\\b'), lean: 'down' },
      { re: rx('\\b(?:hawkish\\w*|higher[- ]for[- ]longer|rate[- ]hikes?|hikes? (?:interest )?rates|raises? (?:interest )?rates|tighten\\w*)\\b'), lean: 'down' },
      { re: rx('\\b(?:dovish\\w*|(?:fed|policy|monetary) easing|easing (?:bets|hopes|expectations|cycle|path)|rate[- ]cuts?|cuts? (?:interest )?rates|lower(?:ing)? (?:interest )?rates|policy easing|(?:bets|hopes|expectations|odds) (?:of|for|on) (?:a |an |more |further |another )?(?:fed |rate |december |january |march )?(?:rate )?cuts?)\\b'), lean: 'up' },
      moveHint('(?:treasury |bond |real |us |10-year |u\\.s\\. )?yields?', 'down', 20),
    ],
    weight: 1,
  },
  {
    id: 'inflation',
    label: 'Inflation (rising prices)',
    keys: [rx('\\b(?:inflation\\w*|cpi|pce|consumer prices?|price pressures?|stagflation|deflation)\\b')],
    hints: [
      { re: rx('\\b(?:inflation hedge|hedge against inflation|inflation (?:fears|worries|concerns|jitters))\\b'), lean: 'up' },
      { re: rx('\\b(?:hot(?:ter)?|sticky|firm(?:er)?|higher|stronger)[- ](?:than[- ]expected[- ])?(?:inflation|cpi|pce)\\b'), lean: 'down' },
      { re: rx('\\b(?:cool(?:er|ing)?|soft(?:er)?|tame|benign|lower|weaker)[- ](?:than[- ]expected[- ])?(?:inflation|cpi|pce)\\b'), lean: 'up' },
      moveHint('inflation|cpi|pce|consumer prices|price pressures', 'down', 20),
    ],
    weight: 1,
  },
  {
    id: 'dollar',
    label: 'The US dollar',
    keys: [rx('\\b(?:dollar|dollars|greenback|dxy|dollar index|usd)\\b')],
    hints: [
      { re: rx('\\b(?:weak(?:er|ening)?|soft(?:er|ening)?|falling|sliding|slumping|sagging)[- ](?:us |u\\.s\\. )?(?:dollar|greenback)\\b'), lean: 'up' },
      { re: rx('\\b(?:strong(?:er)?|firm(?:er)?|rising|resurgent|surging|robust)[- ](?:us |u\\.s\\. )?(?:dollar|greenback)\\b'), lean: 'down' },
      { re: rx('\\b(?:dollar|greenback) (?:strength|rally|rallies|gains|rebound|bounce|bid)\\b'), lean: 'down' },
      { re: rx('\\b(?:dollar|greenback) (?:weakness|slide|slump|losses|retreat|selloff|sell-off)\\b|\\b(?:weighs?|weighed|weighing|pressures?|pressured|drags?|dragged|hits?) (?:on )?(?:the )?(?:us )?(?:dollar|greenback)\\b'), lean: 'up' },
      moveHint('dollar|greenback|dxy|dollar index', 'down', 20),
    ],
    weight: 1,
  },
  {
    id: 'geopolitics',
    label: 'War and world tensions',
    keys: [rx('\\b(?:(?<!trade[- ])(?<!tariff )(?<!price )(?<!currency )wars?|conflicts?|geopolitic\\w*|(?<!trade[- ])(?<!tariff )(?<!price )(?<!currency )tensions?|attacks?|missiles?|airstrikes?|military|invasion|sanctions?|ceasefire|truce|peace (?:talks|deal|plan|agreement)|middle east|ukraine|russia|iran|israel|gaza|taiwan|north korea|venezuela|nuclear)\\b')], // "escalates" alone is only a hint: "trade war escalates" is not a war
    hints: [
      { re: rx('\\b(?:ceasefire|cease-fire|truce|peace (?:deal|talks|plan|agreement|hopes)|de-?escalat\\w*|tensions? (?:ease|eases|eased|easing|cool|cools|cooled|subside|subsides|subsided)|easing tensions)\\b'), lean: 'down' },
      SAFE_HAVEN,
      { re: rx('\\b(?:escalat\\w*|(?:rising|mounting|heightened|growing) tensions|(?<!trade[- ])tensions? (?:rise|rises|rising|rose|mount|mounts|flare|flares|grow|grows|heighten\\w*|intensif\\w*)|(?<!trade[- ])(?<!tariff )(?<!price )(?<!currency )wars?|attacks?|missiles?|airstrikes?|invasion|new sanctions)\\b'), lean: 'up' },
    ],
    weight: 1,
  },
  {
    id: 'centralBanks',
    label: 'Central banks buying gold',
    keys: [
      rx("\\b(?:central banks?|pboc|people'?s bank of china|reserve bank of india|rbi|national bank of poland|official sector)\\b[^.;:]{0,40}?\\b(?:buy\\w*|bought|purchas\\w*|demand|add\\w*|accumulat\\w*|reserves?|hoard\\w*|sell\\w*|sold|holdings|gold)\\b"),
      rx('\\b(?:gold reserves|reserve (?:buying|diversification)|de-?dollari[sz]ation|official (?:sector )?(?:buying|purchases|demand)|(?:buying|purchases|demand) (?:by|from) central banks)\\b'),
    ],
    hints: [
      { re: rx('\\b(?:sell\\w*|sold|pauses?|paused|halts?|halted|stops?|stopped|slows?|slowed|cuts?|trims?)\\b[^.;:]{0,20}?\\b(?:gold )?(?:purchases|buying|reserves)\\b'), lean: 'down' },
      { re: rx('\\b(?:sells?|selling|sold)\\b'), lean: 'down' },
      { re: rx('\\b(?:buy\\w*|bought|purchas\\w*|add(?:s|ed|ing)?|accumulat\\w*|hoard\\w*|de-?dollari[sz]ation|record demand|reserve diversification)\\b'), lean: 'up' },
    ],
    weight: 1,
  },
  {
    id: 'etfFlows',
    label: 'Money going into or out of gold funds',
    keys: [rx('\\b(?:etfs?|exchange[- ]traded (?:funds?|products?)|spdr|gld|iau|inflows?|outflows?|fund flows|investment demand|investors? (?:pile|pour|flock|rush))\\b')],
    hints: [
      { re: rx('\\b(?:outflows?|redemptions?|pull(?:s|ed)? (?:money )?out|holdings (?:fall|fell|drop|dropped|decline|declined|slip|slipped|shrink))\\b'), lean: 'down' },
      { re: rx('\\b(?:inflows?|pil(?:e|es|ed|ing) into|pour(?:s|ed|ing)? into|flock(?:s|ed|ing)? to|rush(?:es|ed|ing)? (?:into|to)|holdings (?:rise|rose|climb|climbed|jump|jumped|increase|increased|hit))\\b'), lean: 'up' },
    ],
    weight: 1,
  },
  {
    id: 'econData',
    label: 'US jobs and economy news',
    keys: [rx('\\b(?:jobs? (?:report|data|numbers|growth)|payrolls?|nonfarm|non-farm|nfp|unemployment|jobless|labou?r market|gdp|retail sales|pmi|ism|economic data|us data|u\\.s\\. data|consumer confidence|consumer sentiment|recession|economic (?:growth|slowdown)|manufacturing)\\b')],
    hints: [
      { re: rx('\\b(?:better[- ]than[- ]expected|stronger[- ]than[- ]expected|strong|robust|blowout|beats?|resilient|upbeat|solid|hot(?:ter)?)\\b'), lean: 'down' },
      { re: rx('\\b(?:worse[- ]than[- ]expected|weaker[- ]than[- ]expected|weak(?:er|ens|ening)?|soft(?:er|ens|ening)?|miss(?:es|ed)?|disappoint\\w*|slowdown|contract\\w*|shrinks?|recession\\w*|cool(?:s|ing|ed)?|layoffs?|jobless claims (?:rise|rose|jump|jumped|climb|climbed))\\b'), lean: 'up' },
    ],
    weight: 1,
  },
  {
    id: 'trade',
    label: 'Tariffs and trade fights',
    keys: [rx('\\b(?:tariffs?|trade[- ](?:wars?|tensions?|deals?|talks|truce|disputes?|agreements?|policy|fights?|barriers)|protectionis\\w*|levies)\\b')],
    hints: [
      { re: rx('\\b(?:trade[- ](?:deals?|truce|agreements?|breakthrough)|tariff (?:relief|pause|cuts?|exemptions?|reprieve)|(?:lifts?|lifted|removes?|removed|eases?|eased|delays?|delayed|pauses?|paused|suspends?|suspended|cuts?|rolls? back|scraps?) [^.;:]{0,15}?tariffs?)\\b'), lean: 'down' },
      { re: rx('\\b(?:new tariffs?|tariff (?:threats?|hikes?|fears|worries|escalation|war)|trade[- ]wars?|trade tensions?|(?:threatens?|imposes?|imposed|raises?|raised|hikes?|hiked|slaps?|slapped|announces?|announced) [^.;:]{0,20}?tariffs?)\\b'), lean: 'up' },
    ],
    weight: 1,
  },
  {
    id: 'riskMood',
    label: 'Stock market mood and worries',
    keys: [rx('\\b(?:stocks?|equit(?:y|ies)|wall street|s&p(?: 500)?|nasdaq|dow|risk[- ]?(?:on|off)|risk (?:appetite|sentiment|aversion)|safe[- ]havens?|sell-?offs?|market (?:turmoil|rout|jitters|volatility|uncertainty)|uncertainty|shutdown|bitcoin|crypto)\\b')],
    hints: [
      SAFE_HAVEN,
      { re: rx('\\b(?:risk[- ]?on|(?:improv\\w*|strong|rising|better|returning|healthy) risk appetite|risk appetite (?:improves|returns|rises|recovers))\\b'), lean: 'down' },
      { re: rx('\\b(?:risk[- ]?off|risk aversion|sell-?offs?|rout|turmoil|jitters|uncertainty|shutdown|panic)\\b'), lean: 'up' },
      moveHint('stocks|equities|wall street|shares|s&p(?: 500)?|nasdaq|dow|bitcoin|crypto', 'down', 20),
    ],
    weight: 1,
  },
  {
    id: 'profitTaking',
    label: 'Traders cashing in (profit-taking)',
    keys: [rx('\\b(?:profit[- ]taking|takes? profits?|taking profits?|book(?:ing|s)? profits?|lock(?:s|ing)? in (?:gains|profits)|technical (?:selling|correction|levels?|resistance|support|buying)|overbought|oversold|correction|pullback|bargain[- ]hunting|dip[- ]buying|buy(?:ing)? the dip|short[- ]covering|liquidation|margin calls?)\\b')],
    hints: [
      { re: rx('\\b(?:bargain[- ]hunting|dip[- ]buying|buy(?:ing)? the dip|short[- ]covering|oversold|technical buying)\\b'), lean: 'up' },
      { re: rx('\\b(?:profit[- ]taking|takes? profits?|taking profits?|book(?:ing|s)? profits?|lock(?:s|ing)? in|overbought|correction|pullback|liquidation|margin calls?|technical selling)\\b'), lean: 'down' },
    ],
    weight: 1,
  },
  {
    id: 'physicalDemand',
    label: 'Shoppers in India and China',
    keys: [
      rx('\\b(?:india|indian|china|chinese)\\b[^.;:]{0,40}?\\b(?:demand|buying|buyers|jewel\\w*|imports?|premiums?|discounts?|consumers?|shoppers|retail|festiv\\w*)\\b'),
      rx('\\b(?:diwali|dhanteras|akshaya tritiya|wedding season|festive (?:demand|buying|season)|jewel(?:le)?ry (?:demand|sales|buyers)|physical demand|retail demand|coin (?:demand|sales)|bar and coin|import duty)\\b'),
    ],
    hints: [
      { re: rx('\\b(?:high|higher|record|rising) prices? (?:dampen\\w*|hurt\\w*|curb\\w*|deter\\w*|keep\\w* (?:buyers )?away|weigh\\w* on|dent\\w*)\\b'), lean: 'down' },
      { re: rx('\\b(?:weak\\w*|slump\\w*|tepid|subdued|muted|sluggish|discounts?|dampen\\w*|curb\\w*|deter\\w*|shun\\w*|falls?|fell|drops?|declines?)\\b'), lean: 'down' },
      { re: rx('\\b(?:strong|robust|brisk|record|surg\\w*|jumps?|rises?|rose|pick(?:s|ed)? up|boost\\w*|premiums?)\\b'), lean: 'up' },
    ],
    weight: 1,
  },
  {
    id: 'metals',
    label: 'Silver and other metals',
    keys: [rx('\\b(?:silver|platinum|palladium|copper|precious metals|base metals)\\b')],
    hints: [moveHint('silver|platinum|palladium|copper|precious metals|metals', 'up', 25)],
    weight: 0.5,
  },
];

const PROXIMITY = 45; // a hint must sit within this many characters of one of the theme's keywords

/** Normalise a headline for matching (lowercase, unify dashes/quotes, drop trading-pair symbols). */
export function normalizeForMatch(title: string): string {
  return ` ${title} `
    .toLowerCase()
    .replace(/[‘’`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, ' - ')
    .replace(/\bxau\s*\/?\s*usd\b/g, 'gold')
    .replace(/\bu\.s\.\s*/g, 'us ')
    .replace(/\s+/g, ' ');
}

const blank = (s: string, from: number, len: number) => s.slice(0, from) + ' '.repeat(len) + s.slice(from + len);

function keySpans(text: string, keys: RegExp[]): [number, number][] {
  const out: [number, number][] = [];
  for (const k of keys) {
    const g = new RegExp(k.source, 'gi');
    let m: RegExpExecArray | null;
    while ((m = g.exec(text)) && out.length < 20) {
      out.push([m.index, m.index + m[0].length]);
      if (m[0].length === 0) g.lastIndex++;
    }
  }
  return out;
}

/** The gold move a headline itself describes ("Gold falls as ..."), from the first movement verb after "gold". */
const GOLD_MOVE = new RegExp(`\\b(?:gold|bullion|yellow metal)\\b${gapRe(35)}\\b(?:(${UP_W})|(${DOWN_W}))\\b`, 'i');
export function goldMoveInHeadline(title: string): Lean | null {
  const m = GOLD_MOVE.exec(normalizeForMatch(title));
  return m ? (m[1] ? 'up' : 'down') : null;
}

const CAUSAL = /\b(?:as|on|after|amid|with|following|over|due to|thanks to|boosted by|supported by|lifted by|weighed (?:down )?by|pressured by|hit by|dragged by|ahead of|before)\b/;
const CONTRAST = /\b(?:despite|even as|although|though|but|while|yet|however)\b/;

export interface ThemeMatch {
  id: ThemeId;
  up: number; // strength of explicit wording pointing to "helps gold"
  down: number; // strength of explicit wording pointing to "pushes gold down"
  /**
   * Weak signal, only when there is no explicit wording: the headline puts this topic next to a gold move
   * ("Gold rises ahead of Fed meeting"). It is NOT a direction for the topic and is never shown as one.
   */
  linked: Lean | null;
}

/** Which themes a single headline touches, with direction hints for each. Pure and deterministic. */
export function classifyHeadline(title: string): ThemeMatch[] {
  const text = normalizeForMatch(title);
  const out: ThemeMatch[] = [];
  const move = goldMoveInHeadline(title);
  for (const t of THEMES) {
    const spans = keySpans(text, t.keys);
    if (!spans.length) continue;
    let up = 0;
    let down = 0;
    let work = text;
    for (const h of t.hints) {
      for (let guard = 0; guard < 6; guard++) {
        const m = h.re.exec(work);
        if (!m) break;
        const a = m.index;
        const b = a + m[0].length;
        work = blank(work, a, m[0].length);
        const near = spans.some(([s, e]) => a <= e + PROXIMITY && b >= s - PROXIMITY);
        if (!near) continue;
        const l = typeof h.lean === 'function' ? h.lean(m) : h.lean;
        if (l === 'up') up += 1;
        else down += 1;
      }
    }
    // Weak fallback: "Gold rises as <theme>" with no explicit wording -> the headline itself links them.
    const linked = up === 0 && down === 0 && move && CAUSAL.test(text) && !CONTRAST.test(text) ? move : null;
    out.push({ id: t.id, up, down, linked });
  }
  return out;
}

export interface ThemeHit {
  id: ThemeId;
  label: string;
  score: number;
  lean: ThemeLean; // from explicit wording only
  /** When lean is 'unclear': the gold move most headlines put this topic next to (not a cause), if any. */
  linked: Lean | null;
  mentions: number; // how many headlines touch this topic
  headlines: Headline[]; // supporting headlines, most relevant first (max 2)
}

export function leanOf(up: number, down: number): ThemeLean {
  if (up === 0 && down === 0) return 'unclear';
  if (down === 0 || up >= 2 * down) return 'up';
  if (up === 0 || down >= 2 * up) return 'down';
  return 'mixed';
}

/** Aggregate themes over many headlines; newest headlines count a little more. Sorted by score, then priority. */
export function detectThemes(items: Headline[], nowMs: number, minScore = 0.7): ThemeHit[] {
  const acc = new Map<ThemeId, { score: number; up: number; down: number; lu: number; ld: number; hl: { h: Headline; hinted: boolean }[] }>();
  for (const h of items) {
    const t = h.publishedAt ? Date.parse(h.publishedAt) : NaN;
    const ageH = Number.isFinite(t) ? (nowMs - t) / 3600_000 : 48;
    const rec = ageH <= 24 ? 1 : 0.7;
    for (const m of classifyHeadline(h.title)) {
      const def = THEMES.find((d) => d.id === m.id)!;
      const a = acc.get(m.id) ?? { score: 0, up: 0, down: 0, lu: 0, ld: 0, hl: [] };
      a.score += rec * def.weight;
      a.up += m.up * rec;
      a.down += m.down * rec;
      if (m.linked === 'up') a.lu += rec;
      else if (m.linked === 'down') a.ld += rec;
      a.hl.push({ h, hinted: m.up + m.down >= 1 });
      acc.set(m.id, a);
    }
  }
  const order = THEMES.map((d) => d.id);
  return [...acc.entries()]
    .filter(([, a]) => a.score >= minScore - 1e-9)
    .map(([id, a]) => ({
      id,
      label: THEMES.find((d) => d.id === id)!.label,
      score: Math.round(a.score * 100) / 100,
      lean: leanOf(a.up, a.down),
      linked: a.up + a.down > 0 ? null : a.lu > a.ld ? ('up' as const) : a.ld > a.lu ? ('down' as const) : null,
      mentions: a.hl.length,
      headlines: a.hl
        .slice()
        .sort((x, y) => Number(y.hinted) - Number(x.hinted) || (y.h.publishedAt ?? '').localeCompare(x.h.publishedAt ?? ''))
        .slice(0, 2)
        .map((x) => x.h),
    }))
    .sort((a, b) => b.score - a.score || order.indexOf(a.id) - order.indexOf(b.id));
}

// ---------------------------------------------------------------------------------------------------------------
// Plain-language text
// ---------------------------------------------------------------------------------------------------------------

interface ThemeText {
  base: string; // how this thing usually affects gold
  up: string; // what the headlines say, when they point to "helps gold"
  down: string; // ... when they point to "pushes gold down"
  unclear: string; // when wording is mixed or absent
  nextUp: string; // "If ..., gold could rise."
  nextDown: string; // "If ..., gold could fall."
}

export const THEME_TEXT: Record<ThemeId, ThemeText> = {
  fed: {
    base: 'Gold pays no interest. So when interest rates go down, gold looks better next to savings and bonds. When rates stay high, gold looks less worth holding.',
    up: 'The news talks about lower interest rates or rate cuts, which usually helps gold.',
    down: 'The news talks about interest rates staying high, which usually pushes gold down.',
    unclear: 'The news talks about the Fed and interest rates, but it does not clearly point one way.',
    nextUp: 'If the Fed hints at more rate cuts, gold could rise.',
    nextDown: 'If the Fed says rates will stay high for longer, gold could fall.',
  },
  inflation: {
    base: 'Inflation means things cost more over time. Some people buy gold to protect their savings from that. But high inflation can also keep interest rates high, which is bad for gold.',
    up: 'The news points to cooler inflation or worries about money losing value, which usually helps gold.',
    down: 'The news points to hotter inflation, which can keep interest rates high and push gold down.',
    unclear: 'The news mentions inflation, but it does not clearly point one way.',
    nextUp: 'If inflation cools and rate cuts look closer, gold could rise.',
    nextDown: 'If inflation runs hot and keeps interest rates high, gold could fall.',
  },
  dollar: {
    base: 'Gold is priced in US dollars. When the dollar gets weaker, gold gets cheaper for people using other money, so more of them buy it. When the dollar gets stronger, the opposite happens.',
    up: 'The news says the dollar got weaker, which usually helps gold.',
    down: 'The news says the dollar got stronger, which usually pushes gold down.',
    unclear: 'The news mentions the dollar, but it does not clearly say which way it moved.',
    nextUp: 'If the US dollar gets weaker, gold could rise.',
    nextDown: 'If the US dollar gets stronger, gold could fall.',
  },
  geopolitics: {
    base: 'When people are scared about wars or trouble between countries, many buy gold because it feels safe. When things calm down, some of them sell.',
    up: 'The news talks about rising tensions or fighting, which often makes people buy gold.',
    down: 'The news talks about peace talks or calmer tensions, which can make people sell some gold.',
    unclear: 'The news mentions world tensions, but it does not clearly point one way.',
    nextUp: 'If fighting or tensions get worse, gold could rise.',
    nextDown: 'If peace talks or a ceasefire calm things down, gold could fall.',
  },
  centralBanks: {
    base: 'Central banks are the banks that run a country’s money. Many of them buy gold to keep as savings. Big buying helps hold the price up.',
    up: 'The news says central banks are buying gold, which helps support the price.',
    down: 'The news says central banks are slowing or selling, which takes away some support.',
    unclear: 'The news mentions central banks and gold, without a clear direction.',
    nextUp: 'If central banks keep buying lots of gold, gold could rise.',
    nextDown: 'If central banks slow down their buying, gold could fall.',
  },
  etfFlows: {
    base: 'Gold funds (called ETFs) let people own gold through the stock market. When money pours in, the funds must buy real gold. When money leaves, they sell.',
    up: 'The news says money is flowing into gold funds, which usually helps the price.',
    down: 'The news says money is leaving gold funds, which usually pushes the price down.',
    unclear: 'The news mentions gold funds, without a clear direction.',
    nextUp: 'If more money flows into gold funds, gold could rise.',
    nextDown: 'If investors pull money out of gold funds, gold could fall.',
  },
  econData: {
    base: 'News about US jobs and the economy changes what people expect from interest rates. Weak numbers usually help gold. Strong numbers usually hurt it.',
    up: 'The news points to a weaker US economy, which usually helps gold.',
    down: 'The news points to a strong US economy, which usually pushes gold down.',
    unclear: 'The news mentions US economic numbers, without a clear direction.',
    nextUp: 'If upcoming US jobs or economy numbers come in weak, gold could rise.',
    nextDown: 'If upcoming US jobs or economy numbers come in strong, gold could fall.',
  },
  trade: {
    base: 'Tariffs are taxes on goods from other countries. Trade fights make people nervous about the economy, and nervous people often buy gold. Trade deals can calm them down.',
    up: 'The news talks about new tariffs or trade fights, which often makes people buy gold.',
    down: 'The news talks about trade deals or tariff relief, which can make people sell some gold.',
    unclear: 'The news mentions tariffs and trade, but it does not clearly point one way.',
    nextUp: 'If trade fights or new tariffs grow, gold could rise.',
    nextDown: 'If countries agree new trade deals, gold could fall.',
  },
  riskMood: {
    base: 'When stock markets are scared and falling, many people move money into gold to feel safe. When stocks are doing great, gold can look less exciting.',
    up: 'The news talks about worried or falling markets, which often sends people to gold.',
    down: 'The news talks about confident, rising stock markets, which can pull money away from gold.',
    unclear: 'The news mentions the stock market mood, but it does not clearly point one way.',
    nextUp: 'If stock markets get scared and fall, gold could rise.',
    nextDown: 'If stocks keep climbing and investors feel brave, gold could fall.',
  },
  profitTaking: {
    base: 'After gold goes up a lot, some traders sell to lock in their winnings. That selling can pull the price down for a bit, even if nothing else changed.',
    up: 'The news says buyers are stepping in after a dip, which can help the price bounce.',
    down: 'The news says traders are selling to lock in their profits.',
    unclear: 'The news talks about traders and chart levels, without a clear direction.',
    nextUp: 'If buyers step in after the dip, gold could rise.',
    nextDown: 'If more traders sell to lock in profits, gold could fall.',
  },
  physicalDemand: {
    base: 'India and China buy a huge amount of gold jewellery, coins and bars. Strong shopping helps the price. Weak shopping takes away support.',
    up: 'The news says shoppers in India or China are buying a lot, which helps the price.',
    down: 'The news says shoppers in India or China are buying less, which takes away support.',
    unclear: 'The news mentions gold shopping in India or China, without a clear direction.',
    nextUp: 'If shoppers in India and China buy more, gold could rise.',
    nextDown: 'If high prices keep shoppers away, gold could fall.',
  },
  metals: {
    base: 'Silver and other metals often move in the same direction as gold. This is a sign of the mood around metals, not a reason by itself.',
    up: 'The news says silver or other metals went up too.',
    down: 'The news says silver or other metals went down too.',
    unclear: 'The news mentions silver or other metals moving as well.',
    nextUp: 'If silver and other metals keep rising, gold could rise with them.',
    nextDown: 'If metals keep falling, gold could fall with them.',
  },
};

export type Mood = 'up' | 'down' | 'flat' | 'unknown';

export interface WhyItem {
  id: ThemeId;
  label: string;
  lean: ThemeLean;
  text: string; // plain explanation: what the news says + how this usually affects gold + fit with the actual move
  headlines: Headline[]; // cited headlines (empty for the data-based dollar item)
  mentions: number; // how many of the recent headlines touch this topic (0 for the data-based item)
  fromData: boolean; // true = based on measured currency data, not headlines
}

export interface Explanation {
  headline: string;
  mood: Mood;
  happened: string[];
  whyIntro: string;
  why: WhyItem[];
  nextUp: string[];
  nextDown: string[];
  nextNote: string;
  dollarFact: string | null;
  newsAvailable: boolean;
  headlineCount: number; // how many headlines the "why" section looked at (0 if none / unavailable)
}

export interface ExplainInput {
  facts: PriceFacts | null;
  headlines: Headline[] | null; // null = news unavailable; [] = fetched but empty
  dollar?: DollarMove | null;
  nowMs: number;
  fmtPrice?: (usd: number) => string; // e.g. usd => `AED 412.50 per gram`
}

const FLAT_WEEK = 0.3;
const FLAT_DAY = 0.1;
const FLAT_RECENT = 0.3;

export const pct1 = (x: number) => `${Math.abs(x).toFixed(1)}%`;
const upDown = (x: number) => (x >= 0 ? 'up' : 'down');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDay(ymd: string): string {
  const [, m, d] = ymd.split('-').map(Number);
  return m >= 1 && m <= 12 ? `${d} ${MONTHS[m - 1]}` : ymd;
}

export function headlineLine(f: PriceFacts | null): { text: string; mood: Mood } {
  if (!f) return { text: 'Waiting for gold price history.', mood: 'unknown' };
  if (f.weekPct !== null) {
    if (Math.abs(f.weekPct) < FLAT_WEEK) return { text: 'Gold is about flat over the past week.', mood: 'flat' };
    return { text: `Gold is ${upDown(f.weekPct)} ${pct1(f.weekPct)} over the past week.`, mood: f.weekPct > 0 ? 'up' : 'down' };
  }
  if (f.todayPct !== null) {
    if (Math.abs(f.todayPct) < FLAT_DAY) return { text: 'Gold is about flat today.', mood: 'flat' };
    return { text: `Gold is ${upDown(f.todayPct)} ${pct1(f.todayPct)} today.`, mood: f.todayPct > 0 ? 'up' : 'down' };
  }
  return { text: 'Not enough price history yet to say how gold moved.', mood: 'unknown' };
}

export function happenedSentences(f: PriceFacts | null, fmtPrice?: (usd: number) => string): string[] {
  if (!f) return [];
  const out: string[] = [];

  const parts: string[] = [];
  if (f.todayPct !== null) {
    parts.push(Math.abs(f.todayPct) < FLAT_DAY ? 'Today the price has hardly moved' : `Today it is ${upDown(f.todayPct)} ${pct1(f.todayPct)}`);
  }
  if (f.monthPct !== null) {
    parts.push(Math.abs(f.monthPct) < FLAT_WEEK ? 'over the past month it is about where it started' : `over the past month it is ${upDown(f.monthPct)} ${pct1(f.monthPct)}`);
  }
  let first = parts.length ? `${parts.join(', and ')}.` : '';
  first = first.charAt(0).toUpperCase() + first.slice(1);
  if (fmtPrice) first = `${first ? `${first} ` : ''}It now costs about ${fmtPrice(f.last)}.`;
  if (first) out.push(first);

  const a = f.vs50Pct;
  const b = f.vs200Pct;
  const rel = (x: number, n: number) =>
    Math.abs(x) < 0.25 ? `right at its average price of the last ${n} days` : `${pct1(x)} ${x > 0 ? 'above' : 'below'} its average price of the last ${n} days`;
  if (a !== null && b !== null) {
    let tail: string;
    if (a >= 0 && b >= 0) tail = 'so the bigger trend is still up.';
    else if (a < 0 && b < 0) tail = 'so the bigger trend is down for now.';
    else if (a < 0 && b >= 0) tail = 'so the long trend is still up, but the short trend has cooled.';
    else tail = 'so it is bouncing back, but the long trend is still down.';
    out.push(`It is ${rel(a, 50)} and ${rel(b, 200)}, ${tail}`);
  } else if (a !== null) {
    out.push(`It is ${rel(a, 50)}.`);
  }

  if (f.fromHighPct !== null && f.high52 !== null) {
    const hi = fmtPrice ? ` (${fmtPrice(f.high52)})` : '';
    const lo = fmtPrice && f.low52 !== null ? ` (${fmtPrice(f.low52)})` : '';
    if (f.fromHighPct >= -0.05) out.push(`This is the highest price of the past year${hi}.`);
    else if (f.fromHighPct > -1) out.push(`It is very close to its highest price of the past year${hi}.`);
    else if (f.fromLowPct !== null && f.fromLowPct < 0.05) out.push(`This is the lowest price of the past year${lo}. It is ${pct1(f.fromHighPct)} below the year's highest.`);
    else if (f.fromLowPct !== null && f.fromLowPct < 1) out.push(`It is very close to its lowest price of the past year${lo}, and ${pct1(f.fromHighPct)} below the year's highest.`);
    else if (f.fromHighPct > -5 || f.fromLowPct === null) out.push(`It is ${pct1(f.fromHighPct)} below its highest price of the past year${hi}.`);
    else out.push(`It is ${pct1(f.fromHighPct)} below its highest price of the past year${hi}, and ${pct1(f.fromLowPct)} above its lowest.`);
  }
  return out;
}

/** Direction of the recent move used to check whether a theme "fits" (news window is ~2 days). */
export function recentMood(f: PriceFacts | null): Mood {
  if (!f) return 'unknown';
  const x = f.twoDayPct ?? f.todayPct;
  if (x === null) return 'unknown';
  if (Math.abs(x) < FLAT_RECENT) return 'flat';
  return x > 0 ? 'up' : 'down';
}

function fitSentence(lean: ThemeLean, mood: Mood): string {
  if ((lean !== 'up' && lean !== 'down') || (mood !== 'up' && mood !== 'down')) return '';
  if (lean === mood) return mood === 'up' ? 'That fits with gold going up lately.' : 'That fits with gold going down lately.';
  return mood === 'down'
    ? 'But gold still went down lately, so other things probably mattered more.'
    : 'But gold still went up lately, so other things probably mattered more.';
}

export function dollarSentence(d: DollarMove | null | undefined): string | null {
  if (!d || !Number.isFinite(d.pct)) return null;
  const when = `(${fmtDay(d.fromDate)} to ${fmtDay(d.toDate)}, from European Central Bank rates)`;
  if (Math.abs(d.pct) < 0.15) return `The US dollar is almost unchanged from a week earlier against other big currencies ${when}.`;
  return d.pct > 0
    ? `The US dollar is ${pct1(d.pct)} stronger than a week earlier against other big currencies ${when}. A stronger dollar usually pushes gold down.`
    : `The US dollar is ${pct1(d.pct)} weaker than a week earlier against other big currencies ${when}. A weaker dollar usually helps gold.`;
}

const DOLLAR_DATA_MIN = 0.4; // % weekly move in the dollar index proxy before we call it a reason

export function explain(input: ExplainInput): Explanation {
  const { facts, headlines, dollar, nowMs, fmtPrice } = input;
  const hl = headlineLine(facts);
  const mood = recentMood(facts);
  const newsAvailable = headlines !== null;
  const themes = headlines ? detectThemes(headlines, nowMs).slice(0, 3) : [];

  const dollarOk = !!dollar && Number.isFinite(dollar.pct);
  const why: WhyItem[] = themes.map((t) => {
    const tx = THEME_TEXT[t.id];
    // Only explicit wording gives a topic a direction. Otherwise we say plainly that the direction is not clear.
    const what =
      t.lean === 'up'
        ? tx.up
        : t.lean === 'down'
          ? tx.down
          : t.lean === 'mixed'
            ? `${tx.unclear} Some headlines point one way and some the other.`
            : t.linked
              ? `${tx.unclear} Some headlines mention it next to gold going ${t.linked}, but they do not say how it pushed the price.`
              : tx.unclear;
    // When the news talks about the dollar and we also measured it, show the measurement next to the words.
    const measured =
      t.id === 'dollar' && dollarOk && Math.abs(dollar!.pct) >= 0.15
        ? `Measured currency data: the dollar is ${pct1(dollar!.pct)} ${dollar!.pct > 0 ? 'stronger' : 'weaker'} than a week earlier.`
        : '';
    return {
      id: t.id,
      label: t.label,
      lean: t.lean,
      text: [what, tx.base, measured, fitSentence(t.lean, mood)].filter(Boolean).join(' '),
      headlines: t.headlines,
      mentions: t.mentions,
      fromData: false,
    };
  });

  if (dollar && dollarOk && Math.abs(dollar.pct) >= DOLLAR_DATA_MIN && !why.some((w) => w.id === 'dollar')) {
    const lean: Lean = dollar.pct > 0 ? 'down' : 'up';
    why.push({
      id: 'dollar',
      label: 'The US dollar (currency data)',
      lean,
      text: [
        `Currency data shows the dollar got ${pct1(dollar.pct)} ${dollar.pct > 0 ? 'stronger' : 'weaker'} over the past week.`,
        THEME_TEXT.dollar.base,
        fitSentence(lean, mood),
      ]
        .filter(Boolean)
        .join(' '),
      headlines: [],
      mentions: 0,
      fromData: true,
    });
  }

  let whyIntro: string;
  if (!newsAvailable) {
    whyIntro = why.length
      ? 'News is unavailable right now, so we can only go by the numbers.'
      : 'News is unavailable right now, so we can only explain the numbers above.';
  } else if (!headlines!.length) {
    whyIntro = 'We could not find any gold news from the last 2 days, so we can only go by the numbers.';
  } else if (!themes.length) {
    whyIntro = 'Today’s gold headlines do not point to one clear reason. Gold often moves for many small reasons at once.';
  } else {
    whyIntro = 'Nobody can know for sure what moved gold. These are the topics that came up most in gold news over the last 2 days:';
  }

  const nextUp: string[] = [];
  const nextDown: string[] = [];
  const ids = why.map((w) => w.id).filter((id, i, a) => a.indexOf(id) === i);
  const pickIds: ThemeId[] = ids.length ? ids : ['fed', 'dollar'];
  for (const id of pickIds) {
    nextUp.push(THEME_TEXT[id].nextUp);
    nextDown.push(THEME_TEXT[id].nextDown);
  }
  if (facts && facts.fromHighPct !== null && facts.fromHighPct > -2) {
    nextUp.push('If it breaks above its one-year high, more buyers could join in.');
    nextDown.push('Prices near a one-year high can drop fast if many people sell to lock in profits.');
  } else if (facts && facts.fromLowPct !== null && facts.fromLowPct < 2) {
    nextUp.push('Prices near a one-year low can bounce if people see gold as cheap and buy.');
    nextDown.push('If it drops below its one-year low, more sellers could join in.');
  }
  const nextNote = ids.length
    ? 'Nobody knows for sure which way gold will go. These are possibilities, not predictions.'
    : 'Without clear news, the two big things to watch are usually US interest rates and the US dollar. Nobody knows for sure which way gold will go.';

  return {
    headline: hl.text,
    mood: hl.mood,
    happened: happenedSentences(facts, fmtPrice),
    whyIntro,
    why,
    nextUp,
    nextDown,
    nextNote,
    dollarFact: dollarSentence(dollar),
    newsAvailable,
    headlineCount: headlines ? headlines.length : 0,
  };
}
