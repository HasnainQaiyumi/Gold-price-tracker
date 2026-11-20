# Gold

Live gold price in AED (per gram, 10 g, tola or ounce, in 24K/22K/21K/18K), a calibrated outlook for how far gold could move, real price history, a personal holdings tracker and price alerts.

**Live site: https://hasnainqaiyumi.github.io/Gold-price-tracker/**

## How it works
- Live spot: gold-api.com XAU/USD every 8 s, cross-checked against the PAXG gold token (Coinbase). Stale or missing data is flagged, never faked.
- Outlook: probability ranges from 60-day volatility, calibrated by a walk-forward back-test on real gold closes (the test fails if calibration drifts).
- Holdings and alerts are stored only in your browser.

## Security notes
- Everything runs in the browser. The site makes requests only to `api.gold-api.com` and `api.exchange.coinbase.com` (enforced by a Content-Security-Policy).
- The password screen is a **soft lock** for casual visitors. GitHub Pages is static hosting, so it cannot be real access control. Only a salted PBKDF2 hash is stored in the code.
- Stored data is validated on load; dependencies are monitored by Dependabot.

## Develop
```bash
npm install
npm run dev     # local dev server
npm test        # unit tests
npm run lint    # type check
npm run build
```
