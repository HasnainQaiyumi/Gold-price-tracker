import test from 'node:test';
import assert from 'node:assert/strict';
import { explainDrawdown, explainFromHigh, explainRange, explainReturns, explainRsi, explainVol, explainVsAvg, overallSummary, type KeyStats } from './statsExplain';

const s: KeyStats = { r1m: -13.4, r3m: -22.2, r1y: -12.3, rsi: 24, vol: 29.3, dd: -35.5, hi: 656, lo: 423, last: 424, fromHigh: -35.5, vs50: -11.3, vs200: -15.8 };
const fmt = (v: number) => `AED ${v.toFixed(0)}`;

test('explanations use the live numbers and plain words', () => {
  assert.match(explainReturns(s), /month gold is down 13\.4%.*3 months down 22\.2%.*year down 12\.3%.*at a loss/);
  assert.match(explainRsi(24), /oversold/);
  assert.match(explainRsi(75), /overbought/);
  assert.match(explainRsi(50), /normal zone/);
  assert.match(explainVol(29.3), /right now it is 29%.*unusually jumpy/);
  assert.match(explainVol(9), /calmer than usual/);
  assert.match(explainDrawdown(-35.5), /35\.5%/);
  assert.match(explainRange(s, fmt), /between AED 423 and AED 656.*near the bottom/);
  assert.match(explainFromHigh(-35.5), /35\.5% cheaper.*rise about 55%/);
  assert.match(explainFromHigh(-0.2), /very close to/);
  assert.match(explainVsAvg(-11.3, 50), /11\.3% below.*short-term trend is down/);
  assert.match(explainVsAvg(5, 200), /above.*long-term trend is up/);
  assert.match(overallSummary(s), /downtrend.*swinging much more.*bounce/);
});
