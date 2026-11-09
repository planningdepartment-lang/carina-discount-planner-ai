const test = require('node:test');
const assert = require('node:assert/strict');

function getCategoryElasticity(category, productName = '') {
  const c = (category || '').toLowerCase();
  const p = (productName || '').toLowerCase();

  if (c.includes('pyjama') || c.includes('short') || p.includes('pyjama') || p.includes('pj') || p.includes('night')) {
    return 1.65;
  }
  if (c.includes('bra') || p.includes('bra')) {
    return 1.30;
  }
  if (c.includes('brief') || c.includes('pant') || p.includes('thong')) {
    return 1.45;
  }
  if (c.includes('cosmetic') || c.includes('fragrance') || c.includes('splash') || p.includes('perfume')) {
    return 1.70;
  }
  if (c.includes('shapewear') || c.includes('corset')) {
    return 1.40;
  }

  return 1.50;
}

function computeSizeCurveFulfillment(activeSizeCount, isSingleSize) {
  if (isSingleSize) return 1.00;
  if (activeSizeCount >= 3) return 0.92;
  return 0.48;
}

function computeStyleStatisticalForecast(metrics, recommendation, options) {
  const weeks = Math.max(1, Math.min(12, options?.promotionWeeks ?? 4));
  const scenario = options?.scenario ?? 'base';

  const promoPrice = recommendation.promotionalPriceSAR || metrics.ticketPrice;
  const discountPct = recommendation.discountPct || 0;
  const unitCost = metrics.unitCost || 0;
  const physicalStock = metrics.totalPhysicalStock || 0;

  const baseWeeklyROS = Math.max(0.05, metrics.weeklyROS || 0);
  const baselineDemand = Math.round(baseWeeklyROS * weeks * 10) / 10;

  const epsilon = getCategoryElasticity(metrics.category, metrics.productName);

  let scenarioLiftMultiplier = 1.0;
  let scenarioFootfallMultiplier = 1.0;
  let scenarioBrokenCurveFulfillment = 0.48;

  if (scenario === 'conservative') {
    scenarioLiftMultiplier = 0.80;
    scenarioFootfallMultiplier = 0.85;
    scenarioBrokenCurveFulfillment = 0.40;
  } else if (scenario === 'optimistic') {
    scenarioLiftMultiplier = 1.20;
    scenarioFootfallMultiplier = 1.35;
    scenarioBrokenCurveFulfillment = 0.60;
  }

  let promoLift = 1.0;
  if (discountPct > 0) {
    const rawMarkdownEffect = (discountPct / 100) * (1 - 0.22 * (discountPct / 100));
    const rawLift = epsilon * rawMarkdownEffect * scenarioLiftMultiplier;
    promoLift = Math.min(4.2, 1.0 + rawLift);
  }

  const isSingleSize = metrics.isSingleSize || (
    /cosmetics|towel|scarf|pillow|duvet|sheets|bandana|eye cover|sleeves|bundle/i.test(metrics.category) ||
    /\b(\d+ml|free size|one size|os)\b/i.test(metrics.productName)
  );

  const sizeFulfillmentRate = isSingleSize 
    ? 1.00 
    : (metrics.activeSizeCount >= 3 ? 0.92 : scenarioBrokenCurveFulfillment);

  let railImpulseFloor = 0;
  if (discountPct >= 40 && physicalStock > 0) {
    const railWeeklyUnits = metrics.activeSizeCount <= 2 ? 0.8 : 1.4;
    railImpulseFloor = Math.round(railWeeklyUnits * weeks * scenarioFootfallMultiplier);
  }

  const velocityDrivenDemand = baselineDemand * promoLift * sizeFulfillmentRate * scenarioFootfallMultiplier;
  const unconstrainedDemand = Math.max(railImpulseFloor, velocityDrivenDemand);

  const forecastSoldUnits = Math.min(physicalStock, Math.max(0, Math.round(unconstrainedDemand)));
  const isStockOut = unconstrainedDemand >= physicalStock && physicalStock > 0;
  const clearancePct = physicalStock > 0 ? Math.round((forecastSoldUnits / physicalStock) * 1000) / 10 : 0;

  const projectedGrossRevenue = Math.round(forecastSoldUnits * promoPrice * 100) / 100;
  const projectedNetRevenue = Math.round((projectedGrossRevenue / 1.15) * 100) / 100;
  const projectedCOGS = Math.round(forecastSoldUnits * unitCost * 100) / 100;
  const projectedNetProfit = Math.round((projectedNetRevenue - projectedCOGS) * 100) / 100;

  const p10Demand = Math.min(physicalStock, Math.max(0, Math.round(unconstrainedDemand * 0.72)));
  const p50Demand = Math.min(physicalStock, Math.max(0, Math.round(unconstrainedDemand)));
  const p90Demand = Math.min(physicalStock, Math.max(0, Math.round(unconstrainedDemand * 1.42)));

  return {
    styleCode: metrics.styleCode,
    promotionWeeks: weeks,
    scenario,
    baselineDemandUnits: baselineDemand,
    promotionalLiftMultiplier: Math.round(promoLift * 100) / 100,
    sizeFulfillmentRate,
    unconstrainedDemandUnits: Math.round(unconstrainedDemand * 10) / 10,
    forecastSoldUnits,
    clearancePct,
    isStockOut,
    projectedGrossRevenueSAR: projectedGrossRevenue,
    projectedNetRevenueSAR: projectedNetRevenue,
    projectedCOGSSAR: projectedCOGS,
    projectedNetProfitSAR: projectedNetProfit,
    quantiles: {
      conservativeP10: p10Demand,
      expectedP50: p50Demand,
      optimisticP90: p90Demand
    }
  };
}

test('Statistical Forecaster: User-selected promotion period scales baseline demand accurately', () => {
  const metrics = {
    styleCode: '58424',
    productName: 'Pyjama Short SS26-SH-PJ-5164',
    category: 'Pyjama',
    season: 'SS26',
    weeklyROS: 2.0,
    totalPhysicalStock: 100,
    activeSizeCount: 4,
    isSingleSize: false,
    ticketPrice: 159.0,
    unitCost: 42.3,
    cumulativeSTR: 20.0
  };

  const recommendation = {
    recommendedOffer: 'Category Markdown 40% Off',
    promotionalPriceSAR: 95.4,
    discountPct: 40.0,
    expectedClearancePct: 40.0
  };

  const forecast2Wks = computeStyleStatisticalForecast(metrics, recommendation, { promotionWeeks: 2 });
  assert.equal(forecast2Wks.promotionWeeks, 2);
  assert.equal(forecast2Wks.baselineDemandUnits, 4.0);

  const forecast4Wks = computeStyleStatisticalForecast(metrics, recommendation, { promotionWeeks: 4 });
  assert.equal(forecast4Wks.promotionWeeks, 4);
  assert.equal(forecast4Wks.baselineDemandUnits, 8.0);

  assert.ok(forecast4Wks.forecastSoldUnits > forecast2Wks.forecastSoldUnits);
});

test('Statistical Forecaster: Eliminates unrealistic liquidation on slow-moving inventory', () => {
  const deadStockMetrics = {
    styleCode: '99999',
    productName: 'Stagnant Dress AW24',
    category: 'Dress',
    season: 'AW24',
    weeklyROS: 0.1,
    totalPhysicalStock: 1000,
    activeSizeCount: 1,
    isSingleSize: false,
    ticketPrice: 120.0,
    unitCost: 35.0,
    cumulativeSTR: 8.0
  };

  const clearanceOffer = {
    recommendedOffer: 'Take 3 For 99 SAR Rail',
    promotionalPriceSAR: 33.0,
    discountPct: 72.5,
    expectedClearancePct: 50.0
  };

  const forecast = computeStyleStatisticalForecast(deadStockMetrics, clearanceOffer, { promotionWeeks: 4 });

  assert.ok(forecast.forecastSoldUnits < 50, `Expected realistic forecast < 50 units on 0.1 ROS dead stock, got ${forecast.forecastSoldUnits}`);
  assert.ok(forecast.forecastSoldUnits > 0);
  assert.equal(forecast.isStockOut, false);
});

test('Statistical Forecaster: High-velocity Hero item stocks out at physical stock boundary', () => {
  const heroMetrics = {
    styleCode: '50177',
    productName: 'Hero Top Bestseller',
    category: 'Top',
    season: 'Continuity',
    weeklyROS: 25.0,
    totalPhysicalStock: 30,
    activeSizeCount: 4,
    isSingleSize: false,
    ticketPrice: 99.0,
    unitCost: 28.0,
    cumulativeSTR: 82.0
  };

  const heroOffer = {
    recommendedOffer: 'Full Price Margin Protection (0% Off)',
    promotionalPriceSAR: 99.0,
    discountPct: 0.0,
    expectedClearancePct: 20.0
  };

  const forecast = computeStyleStatisticalForecast(heroMetrics, heroOffer, { promotionWeeks: 4 });
  assert.equal(forecast.forecastSoldUnits, 30);
  assert.equal(forecast.isStockOut, true);
  assert.equal(forecast.clearancePct, 100.0);
});

test('Statistical Forecaster: Multi-quantile confidence scenarios adhere to P10 <= P50 <= P90', () => {
  const metrics = {
    styleCode: '58401',
    productName: 'Cotton Pajama Set',
    category: 'Pyjama',
    season: 'SS26',
    weeklyROS: 3.5,
    totalPhysicalStock: 250,
    activeSizeCount: 3,
    isSingleSize: false,
    ticketPrice: 169.0,
    unitCost: 44.0,
    cumulativeSTR: 35.0
  };

  const offer = {
    recommendedOffer: 'Spend 250 Save 50',
    promotionalPriceSAR: 135.2,
    discountPct: 20.0,
    expectedClearancePct: 35.0
  };

  const conservative = computeStyleStatisticalForecast(metrics, offer, { scenario: 'conservative', promotionWeeks: 4 });
  const base = computeStyleStatisticalForecast(metrics, offer, { scenario: 'base', promotionWeeks: 4 });
  const optimistic = computeStyleStatisticalForecast(metrics, offer, { scenario: 'optimistic', promotionWeeks: 4 });

  assert.ok(conservative.forecastSoldUnits <= base.forecastSoldUnits, 'P10 must be <= P50');
  assert.ok(base.forecastSoldUnits <= optimistic.forecastSoldUnits, 'P50 must be <= P90');
  assert.ok(conservative.projectedNetProfitSAR <= optimistic.projectedNetProfitSAR);
});

test('Statistical Forecaster: Broken size curves receive walkout penalty while single size does not', () => {
  const brokenFactor = computeSizeCurveFulfillment(2, false);
  const healthyFactor = computeSizeCurveFulfillment(4, false);
  const singleSizeFactor = computeSizeCurveFulfillment(1, true);

  assert.equal(brokenFactor, 0.48);
  assert.equal(healthyFactor, 0.92);
  assert.equal(singleSizeFactor, 1.00);
});
