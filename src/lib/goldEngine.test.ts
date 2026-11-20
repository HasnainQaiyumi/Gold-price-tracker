import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ASSUMPTIONS,
  TROY_OZ_GRAMS,
  computeDubaiVsIndiaArbitrage,
  convertUsdOzToMarket,
} from './goldPricing';
import { computeQuantForecast, generateFallbackHistory } from './quantForecast';

test('USD spot vs actual market adds US dealer spread accurately', () => {
  const spotOz = 3500;
  const spot1g = convertUsdOzToMarket(spotOz, 'USD', 'spot', 24, 1, DEFAULT_ASSUMPTIONS);
  const actual1g = convertUsdOzToMarket(spotOz, 'USD', 'actual', 24, 1, DEFAULT_ASSUMPTIONS);

  assert.ok(Math.abs(spot1g - spotOz / TROY_OZ_GRAMS) < 1e-6);
  assert.ok(Math.abs(actual1g - spot1g * 1.015) < 1e-6);
});

test('AED actual market models Dubai DGJG spread and 22K factor (0.926)', () => {
  const spotOz = 3500;
  const spotAed24 = convertUsdOzToMarket(spotOz, 'AED', 'spot', 24, 1, DEFAULT_ASSUMPTIONS);
  const actualAed24 = convertUsdOzToMarket(spotOz, 'AED', 'actual', 24, 1, DEFAULT_ASSUMPTIONS);
  const actualAed22 = convertUsdOzToMarket(spotOz, 'AED', 'actual', 22, 1, DEFAULT_ASSUMPTIONS);

  assert.ok(Math.abs(actualAed24 - (spotAed24 + DEFAULT_ASSUMPTIONS.uaeRetailSpreadAedG)) < 1e-6);
  assert.ok(Math.abs(actualAed22 - actualAed24 * 0.926) < 1e-6);
});

test('INR actual market applies 15% import duty and 3% retail GST sequentially', () => {
  const spotOz = 3500;
  const spotInr10g = convertUsdOzToMarket(spotOz, 'INR', 'spot', 24, 10, DEFAULT_ASSUMPTIONS);
  const actualInr10g = convertUsdOzToMarket(spotOz, 'INR', 'actual', 24, 10, DEFAULT_ASSUMPTIONS);

  const expected = spotInr10g * 1.15 * 1.03;
  assert.ok(Math.abs(actualInr10g - expected) < 1e-4);
});

test('Dubai vs India arbitrage reflects 15% duty advantage for UAE tourist & bullion purchases', () => {
  const arb = computeDubaiVsIndiaArbitrage(3500, 10, 8, 'tourist', 22, DEFAULT_ASSUMPTIONS);
  assert.equal(arb.cheaperMarket, 'Dubai');
  assert.ok(arb.savingsInr > 5000);
  assert.ok(arb.savingsPct > 5);
});

test('Quantile forecast preserves p10 <= p50 <= p90 and responds monotonically to macro stress', () => {
  const history = generateFallbackHistory(3535);
  const baseMacro = {
    realYield10y: 2.1,
    breakevenInfl: 2.28,
    dxy: 105.4,
    gvz: 19.2,
    cotMmNetPctOi: 22.0,
    brentUsd: 74.5,
    change24hPct: 0.42,
  };

  const neutral = computeQuantForecast({
    history30d: history,
    currency: 'INR',
    mode: 'actual',
    karat: 24,
    unitGrams: 10,
    horizonDays: 30,
    assumptions: DEFAULT_ASSUMPTIONS,
    scenario: { yieldBps: 0, dxyPct: 0, geoPct: 0, indiaDutyPct: 15 },
    macro: baseMacro,
  });

  for (const step of neutral.forecast) {
    assert.ok(step.p10 <= step.p50 && step.p50 <= step.p90);
  }

  const dovishFed = computeQuantForecast({
    history30d: history,
    currency: 'INR',
    mode: 'actual',
    karat: 24,
    unitGrams: 10,
    horizonDays: 30,
    assumptions: DEFAULT_ASSUMPTIONS,
    scenario: { yieldBps: -75, dxyPct: -2, geoPct: 2, indiaDutyPct: 15 },
    macro: baseMacro,
  });

  assert.ok(dovishFed.end.p50 > neutral.end.p50);
});
