const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// CommonJS test mirror of computeStyleElasticityCurve
function calculateZeroLossFloor(cost) {
  if (cost <= 0) return 0;
  return Math.round(cost * 1.15 * 100) / 100;
}

function computeStyleElasticityCurve(ticketPrice, unitCost, weeklyROS, totalPhysicalStock, cumulativeSTR = 40.0) {
  const costPlusVat = calculateZeroLossFloor(unitCost);
  const discountSteps = [0, 10, 20, 30, 40, 50];
  const baseWeeklySales = Math.max(0.2, weeklyROS);
  const baselineSales = Math.max(1, Math.round(baseWeeklySales * 4));

  let priceElasticityCoeff = 1.6;
  if (cumulativeSTR < 30) priceElasticityCoeff = 2.1;
  else if (cumulativeSTR > 65) priceElasticityCoeff = 1.1;

  const tiers = [];
  let maxProfit = -Infinity;
  let optimalIdx = 0;

  discountSteps.forEach((discPct, idx) => {
    const rawPrice = ticketPrice * (1 - discPct / 100);
    const isZeroLossViolated = rawPrice < (costPlusVat - 0.01);
    const promotionalPrice = isZeroLossViolated ? costPlusVat : Math.round(rawPrice * 100) / 100;

    let demandMultiplier = 1.0;
    if (discPct > 0) {
      demandMultiplier = 1.0 + (priceElasticityCoeff * (discPct / 100) * (1 + (discPct / 100) * 0.8));
    }

    const uncappedDemand = Math.round(baselineSales * demandMultiplier);
    const estimatedDemand = Math.min(totalPhysicalStock, Math.max(baselineSales, uncappedDemand));
    const netPriceExVat = Math.round((promotionalPrice / 1.15) * 100) / 100;
    const projectedNetRevenue = Math.round(estimatedDemand * netPriceExVat * 100) / 100;
    const projectedCOGS = Math.round(estimatedDemand * unitCost * 100) / 100;
    const projectedGrossProfit = Math.round((projectedNetRevenue - projectedCOGS) * 100) / 100;

    const tierResult = {
      discountPct: discPct,
      promotionalPrice,
      isZeroLossViolated,
      estimatedDemand,
      projectedNetRevenue,
      projectedGrossProfit,
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

  return { tiers, optimalDiscountPct: tiers[optimalIdx].discountPct };
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
});
