/**
 * "Teacher" library: plain-English, vetted explanations of how world events reach the gold price.
 * Fixed text (not AI) so the teaching is always accurate. The AI only summarises what the news says.
 */
import type { Explanation, ThemeId } from './explain';
import type { Headline } from './news';

export interface Lesson {
  icon: string;
  name: string; // short topic name
  up: string[]; // cause -> effect steps when this pushes gold UP
  down: string[]; // ... when it pushes gold DOWN
  analogy: string;
  lessonTitle: string;
  lessonBody: string;
  watch: string; // what to watch next for this topic
}

export const LESSONS: Record<ThemeId, Lesson> = {
  fed: {
    icon: '🏦',
    name: 'US interest rates (the Fed)',
    up: [
      'The Fed, America\'s central bank, hints it may cut interest rates',
      'Savings accounts and US bonds will pay less interest',
      'Gold pays no interest, so holding it now costs you less in missed income',
      'More investors move money into gold',
      'More buying → the gold price tends to rise',
    ],
    down: [
      'The Fed, America\'s central bank, signals interest rates will stay high',
      'Savings accounts and US bonds keep paying good interest',
      'Gold pays nothing, so holding it means missing out on that income',
      'Some big investors move money out of gold',
      'More selling → the gold price tends to fall',
    ],
    analogy:
      'Imagine choosing between a bank deposit that pays you every month and a gold bar in a safe that pays you nothing. When the deposit pays a lot, the gold bar looks less exciting. When the deposit pays little, the gold bar looks much better.',
    lessonTitle: 'Why US interest rates matter so much for gold',
    lessonBody:
      'Gold does not pay interest or dividends. Its only reward is if its price goes up. So investors always compare it with what they could earn safely elsewhere, like a bank deposit or a US government bond. The Fed sets the main US interest rate, and the whole world follows it, because so much money is in dollars. When rates are high, the "cost" of holding gold is high, because you give up that safe income. When rates fall, that cost shrinks and gold becomes more attractive. What matters most is the interest rate after inflation. If a bank pays 4% but prices rise 4%, you are not really earning anything, and gold looks fine. That is why gold often moves the moment the Fed speaks, even before rates actually change.',
    watch: 'The next Fed decision and speeches by Fed officials',
  },
  inflation: {
    icon: '🛒',
    name: 'Inflation (rising prices)',
    up: [
      'New data shows inflation is cooling, or prices keep rising and worry savers',
      'Cooling inflation lets the Fed cut rates sooner; worried savers look for protection',
      'Both make gold more attractive',
      'More buying → the gold price tends to rise',
    ],
    down: [
      'New data shows prices are rising faster than expected',
      'The Fed may keep interest rates high for longer to fight it',
      'High rates make gold, which pays no interest, less attractive in the short term',
      'Some investors sell → the gold price can fall, even though gold protects against inflation in the long run',
    ],
    analogy:
      'If a cup of coffee costs 10 dirhams this year and 12 next year, your money buys less. Over long periods, gold has tended to keep up with rising prices, like a lifeboat for savings. But in the short term, what the Fed does about inflation often matters more than inflation itself.',
    lessonTitle: 'Inflation helps gold in the long run, but can hurt it in the short run',
    lessonBody:
      'Inflation means your money slowly loses buying power. Over decades, gold has generally held its value while paper money lost some of its value, so people buy gold to protect their savings. But there is a twist. When inflation comes in high, the Fed may respond by keeping interest rates high. High rates hurt gold in the short term, because gold pays no interest. So a hot inflation report can push gold down on the day, even though inflation is good for gold over many years. When inflation cools, the Fed can cut rates, and that tends to help gold.',
    watch: 'The next US inflation report (the consumer price index)',
  },
  dollar: {
    icon: '💵',
    name: 'The US dollar',
    up: [
      'The US dollar gets weaker against other currencies',
      'Gold is priced in dollars all over the world',
      'For people paying in euros, rupees or yuan, gold becomes cheaper',
      'They buy more',
      'More demand → the dollar price of gold tends to rise',
    ],
    down: [
      'The US dollar gets stronger against other currencies',
      'Gold is priced in dollars all over the world',
      'For people paying in euros, rupees or yuan, gold becomes more expensive',
      'They buy less',
      'Less demand → the dollar price of gold tends to fall',
    ],
    analogy:
      'Think of a shop that only accepts dollars. If your own currency gets weaker against the dollar, everything in that shop costs you more, so you buy less. Gold is in that shop.',
    lessonTitle: 'Why a strong dollar usually means cheaper gold',
    lessonBody:
      'Almost all gold trading around the world is priced in US dollars. When the dollar rises against other currencies, buyers in Europe, India or China need more of their own money to buy the same gold, so many buy less, and the price in dollars tends to drop. When the dollar weakens, the opposite happens. For you in Dubai there is a simple bonus: the dirham is fixed to the dollar at 3.6725, so the AED price of gold moves almost exactly with the dollar price. A buyer in India feels currency swings; you mostly feel the gold price itself.',
    watch: 'Whether the US dollar keeps getting stronger or turns weaker',
  },
  geopolitics: {
    icon: '🌍',
    name: 'Wars and world tensions',
    up: [
      'A conflict or political crisis flares up somewhere in the world',
      'People and investors worry about what might happen next',
      'They look for a safe place to keep their money',
      'Gold has been trusted for thousands of years and is not tied to any one government',
      'More buying → the gold price often rises',
    ],
    down: [
      'Tensions ease, or a ceasefire or peace deal is reached',
      'Fear fades and investors relax',
      'Money moves back into shares and other riskier investments',
      'Some of the extra "fear" buying leaves gold → the price can fall',
    ],
    analogy:
      'It is like buying an umbrella when dark clouds appear. When the storm passes, fewer people want umbrellas, and they get cheaper.',
    lessonTitle: 'Why gold is called a "safe haven"',
    lessonBody:
      'When something frightening happens, like a war, a political crisis or a banking scare, people want to protect what they have. Gold is attractive at those moments because it has been valuable for thousands of years, every country recognises it, and it cannot be printed or frozen by one government. So fear often pushes gold up quickly. But that extra "fear premium" can disappear just as fast when the danger passes. That is why gold can jump on scary news and then give back the gains once things calm down.',
    watch: 'Developments in the conflicts and tensions mentioned in the news',
  },
  centralBanks: {
    icon: '🏛️',
    name: 'Central banks buying gold',
    up: [
      'Central banks, such as those of China, India or Poland, buy gold for their national reserves',
      'They buy in huge amounts, often hundreds of tonnes a year',
      'This steady, giant buyer takes gold off the market',
      'Less gold available → supports a higher price',
    ],
    down: [
      'Central banks slow down their gold buying, or some sell',
      'A giant, steady buyer steps back',
      'Other buyers have to fill the gap',
      'Less support → the price can drift lower',
    ],
    analogy:
      'Imagine one giant customer who visits the same market every month and buys a lot. While they keep shopping, prices stay firm. When they pause, sellers have to lower prices to find other buyers.',
    lessonTitle: 'Why central banks have become huge gold buyers',
    lessonBody:
      'Countries keep savings called reserves, mostly in US dollars and bonds. In recent years many central banks have bought much more gold, partly to rely less on the dollar and partly because gold cannot be frozen by another country. Because they buy so much and rarely sell, they act like a floor under the price. Their buying does not show up day to day, but reports every month or quarter show whether they are still buying.',
    watch: 'Monthly and quarterly reports on central bank gold buying',
  },
  etfFlows: {
    icon: '📊',
    name: 'Investment funds (gold ETFs)',
    up: [
      'Investors put money into gold funds (ETFs)',
      'Each fund must buy real gold bars to back its shares',
      'More gold is bought and locked in vaults',
      'More demand → the price tends to rise',
    ],
    down: [
      'Investors take money out of gold funds (ETFs)',
      'The funds sell some of their gold bars',
      'More gold comes onto the market',
      'More supply → the price tends to fall',
    ],
    analogy:
      'A gold ETF is like a share that represents gold sitting in a vault. When people buy the shares, the fund has to buy more gold for the vault. When people sell, the fund sells gold.',
    lessonTitle: 'How big investors buy gold without touching it',
    lessonBody:
      'Most large investors do not buy gold bars and keep them at home. They buy shares of gold funds, called ETFs, that hold real gold in secure vaults. When lots of money flows into these funds, they must buy tonnes of gold, which pushes the price up. When money flows out, they sell. So news about "inflows" and "outflows" is really news about big buyers and sellers.',
    watch: 'Whether money keeps flowing into or out of gold funds',
  },
  econData: {
    icon: '📋',
    name: 'Economic reports (jobs, growth)',
    up: [
      'US economic reports, like jobs numbers, come in weak',
      'The Fed is more likely to cut interest rates to help the economy',
      'Lower rates make gold, which pays no interest, more attractive',
      'More buying → the gold price tends to rise',
    ],
    down: [
      'US economic reports, like jobs numbers, come in strong',
      'The Fed has less reason to cut interest rates',
      'Rates may stay higher for longer',
      'Gold looks less attractive → the price tends to fall',
    ],
    analogy:
      'Economic reports are like the economy\'s health check-up. A strong check-up means the doctor, the Fed, will not give medicine, meaning rate cuts, any time soon.',
    lessonTitle: 'Why good news for the economy can be bad news for gold',
    lessonBody:
      'It sounds strange, but strong US jobs or growth numbers often push gold down. The reason is interest rates. A strong economy means the Fed does not need to cut rates, and high rates make gold less attractive because it pays no interest. Weak numbers make rate cuts more likely, which tends to help gold. That is why gold often moves sharply in the minutes after big US reports are released.',
    watch: 'The next big US economic reports, especially jobs data',
  },
  trade: {
    icon: '🚢',
    name: 'Trade fights and tariffs',
    up: [
      'Countries announce new tariffs or trade fights get worse',
      'Businesses and investors worry about slower growth and higher prices',
      'Uncertainty rises',
      'More people buy gold as protection → the price tends to rise',
    ],
    down: [
      'Countries reach a trade deal or tensions ease',
      'Worries about the economy fade',
      'Investors move back into shares',
      'Less need for protection → gold can fall',
    ],
    analogy:
      'When neighbours start a quarrel, everyone on the street gets a little nervous and keeps their valuables close.',
    lessonTitle: 'How trade fights reach the gold price',
    lessonBody:
      'Tariffs are taxes on imported goods. When big economies like the US and China raise tariffs on each other, it can slow trade, push up prices and hurt company profits. That uncertainty makes investors nervous, and nervous investors like gold. When a deal is reached, the worry fades and some of that money leaves gold.',
    watch: 'Trade talks and any new tariffs between the US and its partners',
  },
  riskMood: {
    icon: '📈',
    name: 'Stock market mood',
    up: [
      'Stock markets fall sharply and investors get scared',
      'They look for safer places for their money',
      'Gold is one of the oldest safe places',
      'More buying → gold tends to rise (though in a sudden crash it can dip first)',
    ],
    down: [
      'Stock markets rally and investors feel confident',
      'They prefer shares that can grow faster',
      'Less need for safety',
      'Money leaves gold → the price can lag or fall',
    ],
    analogy:
      'When a party is going well, nobody thinks about the fire extinguisher. When there is smoke, everyone looks for it.',
    lessonTitle: 'Gold and the stock market: often opposites, not always',
    lessonBody:
      'Gold usually does well when investors are scared and less well when they feel confident. But in a sudden crash, gold can fall too at first, because some investors sell whatever they can, including gold, to cover losses elsewhere. After the panic, gold often recovers faster than shares. So gold is protection over months, not a guarantee for every single day.',
    watch: 'How stock markets behave in the coming days',
  },
  profitTaking: {
    icon: '💰',
    name: 'Traders selling to lock in profits',
    up: [
      'Gold falls to a price where many buyers have been waiting',
      'Bargain hunters step in',
      'Traders who bet on a fall buy back to close their bets',
      'Buying snowballs → the price can bounce up',
    ],
    down: [
      'Gold has risen a lot over the past months',
      'Traders who bought earlier sell to lock in their gains',
      'Automatic sell orders kick in as the price drops',
      'Selling snowballs → the price can fall faster than the news alone explains',
    ],
    analogy:
      'It is like a crowd leaving a concert. When a few people head for the exit, others follow, and soon everyone is rushing out at once.',
    lessonTitle: 'Why gold sometimes falls without any big news',
    lessonBody:
      'Not every move has a big reason behind it. After a long rise, many traders sit on large profits. A small push can make some of them sell, and their selling triggers automatic orders from others, so the drop speeds up. Analysts call this "profit-taking". The same happens in reverse on the way up. These moves can be sharp but are often short-lived compared with moves driven by interest rates or the dollar.',
    watch: 'Whether the selling calms down or gold keeps sliding',
  },
  physicalDemand: {
    icon: '💍',
    name: 'Jewellery and coin buying in Asia',
    up: [
      'Wedding or festival season arrives in India or China',
      'Families buy more jewellery, coins and bars',
      'Real, physical demand rises',
      'This supports the price and shop premiums',
    ],
    down: [
      'Gold prices are high, so families delay or reduce jewellery purchases',
      'Physical demand weakens',
      'Shops may even offer discounts',
      'Less support → the price can soften',
    ],
    analogy:
      'It is like the demand for sweets around Eid. When the season comes, shops sell far more, and prices hold up.',
    lessonTitle: 'Why India and China matter so much for gold',
    lessonBody:
      'India and China are the world\'s biggest buyers of gold jewellery, coins and bars. Their buying rises around weddings and festivals, such as Diwali and Chinese New Year. This "physical" demand is slower and steadier than investor trading, but it matters: when prices jump too high, many families wait, and when prices dip, they often buy more. Dubai is a major hub for this trade.',
    watch: 'Jewellery and coin demand in India and China',
  },
  metals: {
    icon: '🥈',
    name: 'Silver and other metals',
    up: [
      'Silver and other metals rise strongly',
      'The same investors and funds often trade all precious metals together',
      'Buying in one metal spills into the others',
      'Gold tends to be pulled up too',
    ],
    down: [
      'Silver and other metals sell off',
      'The same investors and funds often trade all precious metals together',
      'Selling in one metal spills into the others',
      'Gold tends to be dragged down too',
    ],
    analogy: 'Think of cars in the same traffic lane: when the lane slows, all the cars slow down together.',
    lessonTitle: 'Why gold and silver often move together',
    lessonBody:
      'Gold and silver are both "precious metals" and are often bought by the same funds and traders. So big moves in silver, platinum or even copper can spill into gold. Silver usually moves more sharply than gold in both directions, because its market is smaller and it is also used in industry.',
    watch: 'Moves in silver and other metals',
  },
};

export interface Driver {
  id: ThemeId;
  icon: string;
  name: string;
  direction: 'up' | 'down' | 'unclear';
  whatHappened: string; // news summary (AI) or headline-based fallback
  steps: string[]; // cause -> effect chain
  analogy: string;
  note: string | null; // shown when the usual effect did not happen this time
  headlines: Headline[];
}

export interface Explainer {
  summary: string;
  happened: string;
  drivers: Driver[];
  watch: { event: string; ifUp: string; ifDown: string }[];
  lesson: { title: string; body: string };
  forYou: string;
}

const firstHeadlineSentence = (hs: Headline[]) => {
  const h = hs[0];
  return h ? `${h.source ? `${h.source} reports` : 'One report says'}: "${h.title}".` : '';
};

/** Assembles the teacher-style explainer. `ai` (optional) supplies news summaries that already passed validation. */
export function buildExplainer(
  e: Explanation,
  ai?: { summary?: string | null; whatHappened?: Partial<Record<ThemeId, string>> } | null,
  dayIndex = 0
): Explainer {
  const top = e.why.slice(0, 3);
  const drivers: Driver[] = top.map((w) => {
    const L = LESSONS[w.id];
    const direction: Driver['direction'] = w.lean === 'up' || w.lean === 'down' ? w.lean : 'unclear';
    const chainDir = direction === 'unclear' ? (e.mood === 'up' ? 'up' : 'down') : direction;
    const fromNews = ai?.whatHappened?.[w.id];
    const whatHappened =
      fromNews ||
      (w.fromData
        ? (w.text.split('. ')[0] ?? w.text).replace(/\.?$/, '.')
        : `${firstHeadlineSentence(w.headlines)}${direction === 'unclear' ? ' The headlines do not say clearly which way this pushed gold.' : ''}`);
    let note: string | null = null;
    if (direction !== 'unclear' && (e.mood === 'up' || e.mood === 'down') && direction !== e.mood) {
      note =
        w.id === 'riskMood' && e.mood === 'down'
          ? 'Usually, scared stock markets help gold. This time gold fell too. In sharp sell-offs, some investors sell gold to raise cash and cover losses elsewhere.'
          : `Normally this would push gold ${direction}, but gold went ${e.mood} anyway. Other forces were stronger this time.`;
    }
    return { id: w.id, icon: L.icon, name: L.name, direction, whatHappened, steps: chainDir === 'up' ? L.up : L.down, analogy: L.analogy, note, headlines: w.headlines.slice(0, 2) };
  });

  const names = drivers.map((d) => d.name.replace(/\s*\(.*\)$/, '').replace(/^([A-Z])(?=[a-z])/, (c) => c.toLowerCase()));
  const summary =
    ai?.summary ||
    [e.headline, names.length ? `The main things moving it right now are ${names.join(names.length > 2 ? ', ' : ' and ').replace(/, ([^,]*)$/, ' and $1')}.` : 'There is no single clear reason in the news right now.', 'Below, step by step, is how each one reaches the gold price.'].join(' ');

  const happened = e.happened.join(' ');

  const watchIds = (drivers.length ? drivers.map((d) => d.id) : (['fed', 'dollar'] as ThemeId[])).slice(0, 3);
  const watch = watchIds.map((id, i) => ({ event: LESSONS[id].watch, ifUp: e.nextUp[i] ?? '', ifDown: e.nextDown[i] ?? '' })).filter((w) => w.ifUp && w.ifDown);

  // Lesson: the top driver's topic; with no clear driver, rotate through the two biggest everyday drivers.
  const lessonId: ThemeId = drivers[0]?.id ?? (dayIndex % 2 === 0 ? 'fed' : 'dollar');
  const lesson = { title: LESSONS[lessonId].lessonTitle, body: LESSONS[lessonId].lessonBody };

  const big = e.mood !== 'flat' && e.mood !== 'unknown';
  const forYou = [
    big ? 'Moves like this are normal for gold; it often swings several percent in a few weeks.' : 'Quiet periods like this are normal for gold too.',
    'If you buy a fixed amount every month, short-term swings matter much less, because you end up buying at many different prices. In our tests on 45 years of gold prices, that simple habit beat every "smart timing" rule we tried.',
    'If you are buying jewellery, remember that making charges and the shop\'s premium come on top of the price shown here.',
    'Nobody can know for sure which way gold goes next, so never invest money you might need soon.',
  ].join(' ');

  return { summary, happened, drivers, watch, lesson, forYou };
}

/** Short text version for alerts (email/WhatsApp). */
export function explainerToParagraph(x: Explainer): string {
  const why = x.drivers.map((d) => `${d.name}: ${d.whatHappened}`).join(' ');
  return [x.summary, x.happened, why].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}
