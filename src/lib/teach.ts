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
  story: string; // the same chain told as one flowing, narrated paragraph
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
    return { id: w.id, icon: L.icon, name: L.name, direction, whatHappened, steps: chainDir === 'up' ? L.up : L.down, analogy: L.analogy, story: STORIES[w.id][chainDir], note, headlines: w.headlines.slice(0, 2) };
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

/**
 * Narrated versions of each cause -> effect chain, written as one flowing paragraph in the same
 * "teacher" voice as the lessons. Same facts as the `up`/`down` steps; no new claims.
 */
export const STORIES: Record<ThemeId, { up: string; down: string }> = {
  fed: {
    up: "Gold pays no interest or dividends. Its only reward is a rising price. So investors always weigh it against what they could earn safely elsewhere, like a bank deposit or a US government bond. The Fed, America's central bank, sets the main US interest rate, and the whole world follows it, because so much money is in dollars. Right now the Fed is hinting it may cut rates. That means savings and bonds are about to pay less, so the \"cost\" of holding gold instead, which is the interest you give up, gets smaller. When that cost shrinks, more investors are happy to hold gold, and that extra buying tends to push the price up.",
    down: "Gold pays no interest or dividends. Its only reward is a rising price. So investors always weigh it against what they could earn safely elsewhere, like a bank deposit or a US government bond. The Fed, America's central bank, sets the main US interest rate, and the whole world follows it, because so much money is in dollars. Right now the Fed is signalling that rates will stay high. That means savings and bonds keep paying good money, so holding gold means giving up real income. Some big investors would rather collect that interest than sit on gold that pays nothing. They sell some of their gold, and that selling tends to pull the price down.",
  },
  inflation: {
    up: "Inflation simply means prices rising, so your money buys a little less each year. Over long periods, gold has tended to keep its value while cash loses some of its value, which is why people see it as protection. But in the short run, what matters most is what inflation means for interest rates. When a report shows inflation cooling, the Fed can cut rates sooner. Lower rates make gold, which pays no interest, look better next to a bank deposit. And savers who still worry about rising prices keep buying gold as a safety net. Both forces point the same way, so cooling inflation tends to bring in buyers and lift the price.",
    down: "Inflation simply means prices rising, so your money buys a little less each year. You might expect hot inflation to help gold, because gold protects savings over the long run. But on the day, the reaction is often the opposite. When a report shows prices rising faster than expected, the Fed may keep interest rates high for longer to fight it. High rates hurt gold straight away, because gold earns nothing while a bank deposit or bond pays well. So even though inflation is exactly what gold is meant to protect you from, a hot inflation report can still push the price down, simply because of what it means for interest rates.",
  },
  dollar: {
    up: "Almost all gold in the world is bought and sold in US dollars, even by people who never hold a dollar. That link matters more than most people realise. When the dollar gets weaker against other currencies, a buyer in Europe, India or China needs less of their own money to buy the same ounce. In effect, gold becomes cheaper for them, so many of them buy more. That extra demand from outside America pushes the dollar price of gold up. For you in Dubai it is simpler: the dirham is fixed to the dollar, so the AED price moves almost exactly with the dollar price, and you feel the gold move itself.",
    down: "Almost all gold in the world is bought and sold in US dollars, even by people who never hold a dollar. That link matters more than most people realise. When the dollar gets stronger against other currencies, a buyer in Europe, India or China suddenly needs more of their own money to buy the same ounce. Gold becomes more expensive for them, even if its dollar price has not moved yet, so many of them buy less. That weaker demand from outside America tends to pull the dollar price of gold down. For you in Dubai it is simpler: the dirham is fixed to the dollar, so the AED price moves almost exactly with the dollar price.",
  },
  geopolitics: {
    up: "Gold has been trusted as a store of value for thousands of years, long before any of today's currencies or governments existed. That is exactly why people turn to it when the world suddenly feels less safe. When a war breaks out or a political crisis flares up, investors start asking what could go wrong with everything else they own: shares, currencies, even bank deposits. Gold does not depend on any one government or company, so it becomes an obvious place to park money until the picture clears. That rush toward safety can be sudden, and it often pushes the price up quickly, even before anyone knows how the situation will end.",
    down: "Gold often gets a boost from fear, which means it can give that boost back once the fear fades. When a conflict cools down, a ceasefire holds or a crisis is resolved, the extra money that rushed into gold for safety has less reason to stay. Some investors sell their gold and move back into shares and other investments that can grow faster in calmer times. Think of it like umbrellas: when dark clouds appear, everyone wants one, and when the sky clears, fewer people are willing to pay for them. That unwinding of 'fear buying' is a common reason gold falls even though nothing bad has happened. Good news alone is enough.",
  },
  centralBanks: {
    up: "Central banks are the banks that manage money for whole countries, and in recent years they have become some of the biggest gold buyers in the world. Countries like China, India and Poland have been adding hundreds of tonnes a year to their national savings. They do it partly to rely less on the US dollar, and partly because gold cannot be frozen by another country the way a bank account can. This buying happens quietly, showing up in monthly and quarterly reports rather than headlines. But because the amounts are huge and central banks rarely sell, their demand acts like a floor under the market, steadily supporting the price.",
    down: "Central banks have become some of the biggest and steadiest buyers of gold, so any sign that they are slowing down matters a great deal. When reports show countries like China or India buying less than before, or in rare cases selling, one of the market's most reliable buyers is stepping back. Other buyers, mostly private investors and funds, then have to fill that gap on their own, and they are usually far more sensitive to price than a country building long-term savings. With a giant, patient customer doing less shopping, there is simply less support holding the price up, and it can drift lower until other buyers step in.",
  },
  etfFlows: {
    up: "Most big investors do not keep gold bars at home. Instead, they buy shares in a gold fund, called an ETF, which keeps real gold locked in a vault on their behalf. Here is the important part: when more people buy shares in the fund than sell them, the fund must go out and buy real gold bars to back those new shares. That buying is real, it is large, and it hits the market directly. So when you read that money is 'flowing into' gold funds, it means someone is literally buying tonnes of gold to keep up, and that extra demand tends to push the price higher.",
    down: "Most big investors hold their gold through shares in a fund, called an ETF, which keeps real gold in a vault for them. When more investors sell their shares than buy new ones, the fund does not simply wait. It sells some of the gold in its vault to raise the cash those investors are asking for. That selling is real and reaches the market just like any other seller. So when reports say money is 'flowing out' of gold funds, it means actual gold bars are being sold, adding extra supply to the market. More gold for sale, with the same number of buyers, tends to push the price down.",
  },
  econData: {
    up: "Reports about the US economy, like how many new jobs were created last month, are watched closely because they tell the Fed whether the economy needs help. When these reports come in weaker than expected, the Fed is more likely to cut interest rates to support it. Lower rates are good for gold, because gold pays no interest of its own and looks better whenever savings and bonds start paying less. So, strange as it sounds, bad news for the American economy can turn into good news for gold. That is why gold often jumps in the very minutes after a weak US jobs report is released.",
    down: "Reports about the US economy, like how many new jobs were created last month, are watched closely because they shape what the Fed does with interest rates. When these reports come in stronger than expected, the Fed has no reason to cut rates soon, and rates may stay high for longer. That keeps savings and bonds paying well, so gold, which pays nothing, looks less attractive by comparison. It is a bit like a health check-up: a strong result means the doctor will not prescribe any medicine. That is why good news for the American economy can be bad news for gold, at least in the short run.",
  },
  trade: {
    up: "Tariffs are taxes that one country puts on goods coming in from another. When big economies like the US and China raise tariffs on each other, the effects ripple across the world. Businesses worry about higher costs, investors worry about slower growth, and nobody knows how the fight will end. That kind of uncertainty is exactly where gold tends to do well, because its value does not depend on trade flowing smoothly between any two countries. As the worry grows, some investors move money into gold as protection against whatever might go wrong next, and that extra demand tends to lift the price.",
    down: "Trade fights create uncertainty, and gold usually benefits from uncertainty. So when the fight calms down, some of gold's gains can unwind. When countries reach a trade deal, or tensions visibly ease, the worries about slower growth and higher prices start to fade. With one less thing to fear, some investors move money out of gold and back into shares, which tend to do better when the outlook looks calm. That shift away from 'safety' and back toward growth is a common reason the price softens, even though nothing bad has happened. The good news on its own is enough to cool demand for gold.",
  },
  riskMood: {
    up: "When stock markets fall sharply, it usually reflects a wider change in how investors feel about risk. In those moments, many people want to move at least part of their money somewhere that does not depend on company profits, and gold is one of the oldest and most trusted places to do that. As fear spreads, that search for safety often sends extra money into gold, pushing its price up even while shares are falling. One honest warning: in a sudden, sharp crash, gold can dip too at first, because some investors sell whatever they can to raise cash. After the panic, gold often recovers faster than shares do.",
    down: "Gold tends to shine when investors are nervous, so when confidence returns, it can lose some of its appeal. When shares are rallying and the future feels calmer, investors usually prefer things that can grow quickly, like company shares, over gold, which does not grow a business or pay a dividend. Money that moved into gold during the worried times starts to move back out, chasing markets that are doing well. Think of a fire extinguisher at a party: when everything is going well, nobody thinks about it. That quiet shift away from gold as confidence builds is a common reason the price drifts lower.",
  },
  profitTaking: {
    up: "Not every move in the gold price comes from the news. Sometimes it is simply how trading works. After gold has fallen for a while, it often reaches a price where many buyers who were waiting on the sidelines decide it is cheap enough. Their buying can stop the slide on its own. At the same time, traders who had bet on a further fall must buy gold back to close those bets, which adds even more buying. One wave of buying sets off the next, so the price can bounce back faster than the news alone would explain. These bounces can be sharp, but they do not always last.",
    down: "Not every move in the gold price comes from the news. Sometimes it is simply how trading works. After a long rise, many traders are sitting on big profits, and even a small worry can convince some of them to sell and lock those profits in. As the price starts to dip, automatic sell orders that other traders set in advance begin to kick in, adding more selling on top. It is like a crowd leaving a concert: once a few people head for the exit, others follow. Analysts call this 'profit-taking'. It can be sharp, but it usually fades once the easy profits have been taken.",
  },
  physicalDemand: {
    up: "Beyond investors and traders, gold has millions of everyday buyers: families in India and China who buy jewellery, coins and small bars, often for weddings and festivals like Diwali or Chinese New Year. This is called physical demand. It moves more slowly than investor trading, but it is enormous and very real. When wedding or festival season arrives, or when prices dip to a level families see as good value, this buying picks up noticeably. Because these are real people buying gold to keep, not to trade, their demand gives the price steady, lasting support. Dubai sits right at the centre of this trade.",
    down: "Families across India and China buy huge amounts of gold jewellery, coins and bars every year, especially around weddings and festivals. But this buying is sensitive to price in a very human way. When gold becomes expensive, many families simply wait, deciding a big purchase can hold off until prices look fairer, or they buy smaller pieces than planned. Jewellery shops sometimes offer discounts just to keep sales moving. Because this everyday buying normally gives the price steady support, a slowdown in it removes some of that support, and the price can soften, even without any big news at all.",
  },
  metals: {
    up: "Gold rarely moves completely on its own. It belongs to a family of precious metals that includes silver and platinum, and the same big funds and traders often buy and sell all of them together. When silver or another metal makes a strong move up, it often pulls gold along with it, simply because the same money and the same trading strategies are flowing into the whole group at once. Silver usually moves more sharply than gold, because its market is smaller and it is also used in industry, so a jump in silver can act like an early signal, with gold often following.",
    down: "Gold rarely moves completely on its own. It belongs to a family of precious metals that includes silver and platinum, and the same big funds and traders often buy and sell all of them together. When silver or another metal sells off sharply, gold often gets dragged down with it, even if nothing has changed for gold itself, simply because money is flowing out of the whole group at once. Think of cars in the same traffic lane: when the lane slows, they all slow together. Silver usually moves more sharply than gold in both directions, so a sudden fall in silver can be an early warning sign.",
  },
};
