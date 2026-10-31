import { calculateZeroLossFloor } from './metricsCalculator';

export interface ElasticityTierResult {
  discountPct: number;
  promotionalPriceSAR: number;
  netPriceExVat: number;
  isZeroLossViolated: boolean;
  legalFloorSAR: number;
  estimatedDemandUnits: number;
  incrementalDemandUnits: number;
  projectedNetRevenueSAR: number;
  projectedGrossProfitSAR: number;
  realizedMarginPct: number;
  isOptimalProfitPeak: boolean;
  clearancePct: number;
}

export interface StyleElasticityCurve {
  styleCode: string;
  ticketPrice: number;
  unitCost: number;
  costPlusVat: number;
  baselineDemandUnits: number;
  optimalDiscountPct: number;
  optimalProfitSAR: number;
  optimalDemandUnits: number;
  tiers: ElasticityTierResult[];
  commercialAdvice: string;
  enhancementMetrics?: {
    sizeFulfillmentRate: number;
    sizeFulfillmentLabel: string;
    storeExposureRate: number;
    historicalAspEstimate: number;
    historicalDiscountDepth: number;
  };
}

/**
 * Computes empirical price elasticity of demand across 6 discrete candidate discount points.
 * Reveals the exact revenue & margin trade-off curve and identifies the profit-maximizing discount peak.
 */
export function computeStyleElasticityCurve(
  styleCode: string,
  ticketPrice: number,
  unitCost: number,
  weeklyROS: number,
  totalPhysicalStock: number,
  cumulativeSTR: number = 40.0,
  campaignDurationWeeks: number = 4,
  activeSizeCount: number = 4,
  isSingleSize: boolean = false,
  storeExposureRate: number = 0.50,
  historicalRealizedPrice?: number
): StyleElasticityCurve {
  const costPlusVat = calculateZeroLossFloor(unitCost);
  const discountSteps = [0, 10, 20, 30, 40, 50];

  // Base expected baseline sales over campaign window without discounts
  const baseWeeklySales = Math.max(0.2, weeklyROS);
  const baselineSales = Math.max(1, Math.round(baseWeeklySales * campaignDurationWeeks));

  // 1. Assortment Size Curve Walkout Factor
  const isBrokenCurve = !isSingleSize && activeSizeCount <= 2;
  const sizeFulfillmentRate = isBrokenCurve ? 0.70 : 1.00;
  const sizeFulfillmentLabel = isBrokenCurve 
    ? `Fragmented Size Curve (${activeSizeCount} sizes active) — 30% walkout loss applied`
    : (isSingleSize ? 'Complete Assortment — 100% Single-Size fulfillment' : `Healthy Curve (${activeSizeCount} sizes active) — 100% fulfillment`);

  // 2. Price sensitivity coefficient (higher for aged / slow moving styles, lower for hero / fresh items)
  let priceElasticityCoeff = 1.6;
  if (cumulativeSTR < 30) {
    priceElasticityCoeff = 2.1; // Highly sensitive to price drops
  } else if (cumulativeSTR > 65) {
    priceElasticityCoeff = 1.1; // Inelastic, brand-driven demand
  }

  // 3. Historical Realized ASP & Discount Depth (from sales_price or estimated from STR velocity)
  const historicalAspEstimate = historicalRealizedPrice && historicalRealizedPrice > 0 
    ? historicalRealizedPrice 
    : (cumulativeSTR > 50 ? ticketPrice * 0.94 : (cumulativeSTR > 25 ? ticketPrice * 0.82 : ticketPrice * 0.72));
  const historicalDiscountDepth = Math.round(Math.max(0, 1 - (historicalAspEstimate / (ticketPrice || 1))) * 100);

  const tiers: ElasticityTierResult[] = [];
  let maxProfit = -Infinity;
  let optimalIdx = 0;

  discountSteps.forEach((discPct, idx) => {
    const rawPrice = ticketPrice * (1 - discPct / 100);
    const isZeroLossViolated = rawPrice < (costPlusVat - 0.01);
    const promotionalPrice = isZeroLossViolated 
      ? costPlusVat 
      : Math.round(rawPrice * 100) / 100;

    // Demand expansion modeling based on price elasticity adjusted by size availability
    let demandMultiplier = 1.0;
    if (discPct > 0) {
      const rawLift = priceElasticityCoeff * (discPct / 100) * (1 + (discPct / 100) * 0.8);
      const adjustedLift = rawLift * sizeFulfillmentRate;
      demandMultiplier = 1.0 + adjustedLift;
    }

    const uncappedDemand = Math.round(baselineSales * demandMultiplier);
    const estimatedDemand = Math.min(totalPhysicalStock, Math.max(baselineSales, uncappedDemand));
    const incrementalDemandUnits = Math.max(0, estimatedDemand - baselineSales);
    const clearancePct = totalPhysicalStock > 0 ? Math.round((estimatedDemand / totalPhysicalStock) * 100) : 0;

    const netPriceExVat = Math.round((promotionalPrice / 1.15) * 100) / 100;
    const projectedNetRevenue = Math.round(estimatedDemand * netPriceExVat * 100) / 100;
    const projectedCOGS = Math.round(estimatedDemand * unitCost * 100) / 100;
    const projectedGrossProfit = Math.round((projectedNetRevenue - projectedCOGS) * 100) / 100;
    const realizedMarginPct = projectedNetRevenue > 0 
      ? Math.round(((projectedNetRevenue - projectedCOGS) / projectedNetRevenue) * 1000) / 10 
      : 0;

    const tierResult: ElasticityTierResult = {
      discountPct: discPct,
      promotionalPriceSAR: promotionalPrice,
      netPriceExVat,
      isZeroLossViolated,
      legalFloorSAR: costPlusVat,
      estimatedDemandUnits: estimatedDemand,
      incrementalDemandUnits,
      projectedNetRevenueSAR: projectedNetRevenue,
      projectedGrossProfitSAR: projectedGrossProfit,
      realizedMarginPct,
      isOptimalProfitPeak: false,
      clearancePct
    };

    tiers.push(tierResult);

    // Track profit peak (ignore illegal loss-making tiers if any)
    if (!isZeroLossViolated && projectedGrossProfit > maxProfit) {
      maxProfit = projectedGrossProfit;
      optimalIdx = idx;
    }
  });

  // Mark the optimal profit peak
  if (tiers[optimalIdx]) {
    tiers[optimalIdx].isOptimalProfitPeak = true;
  }

  const optimalTier = tiers[optimalIdx];
  let commercialAdvice = '';
  if (optimalTier.discountPct === 0) {
    commercialAdvice = `Full price protection generates maximum profit (+${optimalTier.projectedGrossProfitSAR.toLocaleString()} SAR) due to organic demand.`;
  } else if (optimalTier.discountPct <= 25) {
    commercialAdvice = `Optimal cash peak achieved at ${optimalTier.discountPct}% off (+${optimalTier.projectedGrossProfitSAR.toLocaleString()} SAR profit). Higher discounts clear more units but sacrifice net dollar margin.`;
  } else {
    commercialAdvice = `A deeper markdown of ${optimalTier.discountPct}% off is mathematically required to accelerate velocity and recover +${optimalTier.projectedGrossProfitSAR.toLocaleString()} SAR working capital.`;
  }

  return {
    styleCode,
    ticketPrice,
    unitCost,
    costPlusVat,
    baselineDemandUnits: baselineSales,
    optimalDiscountPct: optimalTier.discountPct,
    optimalProfitSAR: optimalTier.projectedGrossProfitSAR,
    optimalDemandUnits: optimalTier.estimatedDemandUnits,
    tiers,
    commercialAdvice,
    enhancementMetrics: {
      sizeFulfillmentRate,
      sizeFulfillmentLabel,
      storeExposureRate,
      historicalAspEstimate,
      historicalDiscountDepth
    }
  };
}
