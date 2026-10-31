const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// CommonJS test mirror of computeStyleElasticityCurve
function calculateZeroLossFloor(cost) {
  if (cost <= 0) return 0;
  return Math.round(cost * 1.15 * 100) / 100;
}

function computeStyleElasticityCurve(
  ticketPrice, 
  unitCost, 
  weeklyROS, 
  totalPhysicalStock, 
  cumulativeSTR = 40.0,
  campaignDurationWeeks = 4,
  activeSizeCount = 4,
  isSingleSize = false,
  storeExposureRate = 0.50,
  historicalRealizedPrice = null
) {
  const costPlusVat = calculateZeroLossFloor(unitCost);
  const discountSteps = [0, 10, 20, 30, 40, 50];
  const baseWeeklySales = Math.max(0.2, weeklyROS);
  const baselineSales = Math.max(1, Math.round(baseWeeklySales * campaignDurationWeeks));

  const isBrokenCurve = !isSingleSize && activeSizeCount <= 2;
  const sizeFulfillmentRate = isBrokenCurve ? 0.70 : 1.00;
  const sizeFulfillmentLabel = isBrokenCurve 
    ? `Fragmented Size Curve (${activeSizeCount} sizes active) — 30% walkout loss applied`
    : (isSingleSize ? 'Complete Assortment — 100% Single-Size fulfillment' : `Healthy Curve (${activeSizeCount} sizes active) — 100% fulfillment`);

  let priceElasticityCoeff = 1.6;
  if (cumulativeSTR < 30) priceElasticityCoeff = 2.1;
  else if (cumulativeSTR > 65) priceElasticityCoeff = 1.1;

  const historicalAspEstimate = (historicalRealizedPrice && historicalRealizedPrice > 0)
    ? historicalRealizedPrice
    : (cumulativeSTR > 50 ? ticketPrice * 0.94 : (cumulativeSTR > 25 ? ticketPrice * 0.82 : ticketPrice * 0.72));
  const historicalDiscountDepth = Math.round(Math.max(0, 1 - (historicalAspEstimate / (ticketPrice || 1))) * 100);

  const tiers = [];
  let maxProfit = -Infinity;
  let optimalIdx = 0;

  discountSteps.forEach((discPct, idx) => {
    const rawPrice = ticketPrice * (1 - discPct / 100);
    const isZeroLossViolated = rawPrice < (costPlusVat - 0.01);
    const promotionalPrice = isZeroLossViolated ? costPlusVat : Math.round(rawPrice * 100) / 100;

    let demandMultiplier = 1.0;
    if (discPct > 0) {
      const rawLift = priceElasticityCoeff * (discPct / 100) * (1 + (discPct / 100) * 0.8);
      const adjustedLift = rawLift * sizeFulfillmentRate;
      demandMultiplier = 1.0 + adjustedLift;
    }

    const uncappedDemand = Math.round(baselineSales * demandMultiplier);
    const estimatedDemand = Math.min(totalPhysicalStock, Math.max(baselineSales, uncappedDemand));
    const incrementalDemand = Math.max(0, estimatedDemand - baselineSales);
    const incrementalPct = baselineSales > 0 ? Math.round((incrementalDemand / baselineSales) * 100) : 0;

    const netPriceExVat = Math.round((promotionalPrice / 1.15) * 100) / 100;
    const projectedNetRevenue = Math.round(estimatedDemand * netPriceExVat * 100) / 100;
    const projectedCOGS = Math.round(estimatedDemand * unitCost * 100) / 100;
    const projectedGrossProfit = Math.round((projectedNetRevenue - projectedCOGS) * 100) / 100;
    const realizedMarginPct = projectedNetRevenue > 0 ? Math.round(((projectedNetRevenue - projectedCOGS) / projectedNetRevenue) * 1000) / 10 : 0;

    const tierResult = {
      discountPct: discPct,
      promotionalPrice,
      isZeroLossViolated,
      estimatedDemand,
      incrementalDemand,
      incrementalPct,
      projectedNetRevenue,
      projectedGrossProfit,
      realizedMarginPct,
      isOptimalProfitPeak: false
    };

    tiers.push(tierResult);
    if (!isZeroLossViolated && projectedGrossProfit > maxProfit) {
      maxProfit = projectedGrossProfit;
      optimalIdx = idx;
    }
  });

  if (tiers[optimalIdx]) {
    tiers[optimalIdx].isOptimalProfitPeak = true;
  }

  return { 
    tiers, 
    baselineDemandUnits: baselineSales,
    optimalDiscountPct: tiers[optimalIdx].discountPct,
    enhancementMetrics: {
      sizeFulfillmentRate,
      sizeFulfillmentLabel,
      storeExposureRate,
      historicalAspEstimate,
      historicalDiscountDepth
    }
  };
}

describe('Dynamic Price Elasticity Engine', () => {
  test('Style 58424 computes 6 discount steps and identifies optimal profit peak', () => {
    // Style 58424: Ticket 159 SAR, Cost 42.30 SAR, ROS 0.8 u/wk, Stock 35 units, STR 45%
    const curve = computeStyleElasticityCurve(159.00, 42.30, 0.8, 35, 45.0);

    assert.equal(curve.tiers.length, 6, 'Must generate exactly 6 tiers (0%, 10%, 20%, 30%, 40%, 50%)');
    
    // Legal floor: 42.30 * 1.15 = 48.65 SAR
    // At 50% discount: 159 * 0.50 = 79.50 SAR (Safely above 48.65 SAR, so no violation)
    const tier50 = curve.tiers.find(t => t.discountPct === 50);
    assert.equal(tier50.isZeroLossViolated, false);
    assert.equal(tier50.promotionalPrice, 79.50);

    // Peak discount should be in 20%-30% range for steady continuity product
    assert.ok(curve.optimalDiscountPct >= 10 && curve.optimalDiscountPct <= 30, 
      `Optimal discount should be balanced (was ${curve.optimalDiscountPct}%)`);
  });

  test('Clamps discount when candidate price violates Zero-Loss floor', () => {
    // Style with low ticket margin: Ticket 50 SAR, Cost 42 SAR -> Legal floor 48.30 SAR
    // 20% discount = 40 SAR (< 48.30 SAR floor!)
    const curve = computeStyleElasticityCurve(50.00, 42.00, 1.0, 50, 40.0);
    const tier20 = curve.tiers.find(t => t.discountPct === 20);
    assert.equal(tier20.isZeroLossViolated, true, '20% discount on 50 SAR ticket with 42 SAR cost must violate floor');
    assert.equal(tier20.promotionalPrice, 48.30, 'Promotional price must clamp to legal floor 48.30 SAR');
  });

  test('High STR hero item (>70%) favors full price or minimal discount', () => {
    // Hero style: STR 75%, ROS 4.0 u/wk, Ticket 120 SAR, Cost 30 SAR
    const curve = computeStyleElasticityCurve(120.00, 30.00, 4.0, 80, 75.0);
    assert.ok(curve.optimalDiscountPct <= 20, 'Hero item should not need deep discount');
  });

  test('Forecast Enhancement Metrics & Incremental Demand Validation', () => {
    // Style with 3.5 weekly ROS and STR 25% (< 30% -> elasticity coeff 2.1) -> baseline demand = 14 units over 4 weeks
    const curve = computeStyleElasticityCurve(69.00, 10.15, 3.5, 358, 25.0, 4, 4, false, 0.25, 55.20);
    assert.equal(curve.baselineDemandUnits, 14, 'Baseline demand at 0% off must be 14 units');
    
    // Tier 0 (0% off)
    const tier0 = curve.tiers.find(t => t.discountPct === 0);
    assert.equal(tier0.estimatedDemand, 14, '0% off demand must equal baseline 14 units');
    assert.equal(tier0.incrementalDemand, 0, '0% off incremental demand must be 0');

    // Tier 20 (20% off) -> 21 total units, +7 incremental units
    const tier20 = curve.tiers.find(t => t.discountPct === 20);
    assert.equal(tier20.estimatedDemand, 21, 'Total demand at 20% off must be 21 units');
    assert.equal(tier20.incrementalDemand, 7, 'Incremental demand at 20% off must be +7 units (21 - 14)');
    assert.equal(tier20.incrementalPct, 50, 'Incremental lift percentage must be +50% (7 / 14)');

    // Historical ASP validation from sales_price
    assert.equal(curve.enhancementMetrics.historicalAspEstimate, 55.20);
    assert.equal(curve.enhancementMetrics.historicalDiscountDepth, 20);
    assert.equal(curve.enhancementMetrics.sizeFulfillmentRate, 1.00);
  });
});
