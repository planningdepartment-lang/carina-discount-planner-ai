import { calculateZeroLossFloor } from './metricsCalculator';
import { SAUDI_CHARM_PRICE_POINTS } from '../config/constants';

export interface DynamicOfferMetrics {
  styleCode: string;
  productName: string;
  category: string;
  season: string;
  unitCost: number;
  ticketPrice: number;
  totalPhysicalStock: number;
  weeklyROS: number;
  cumulativeSTR: number;
  storeFloorWOS: number;
  activeSizeCount: number;
  isSingleSize?: boolean;
  historicalASP?: number;
  momentumRatio?: number;
}

export interface DynamicBundleResult {
  isBundleApplicable: boolean;
  bundleOfferLabel: string;
  bundleQuantity: number;
  bundlePriceSAR: number;
  unitPromoPriceSAR: number;
  discountPct: number;
  savingsAmountSAR: number;
  expectedClearancePct: number;
  rationale: string;
  railCostCeilingSAR?: number;
  sharedRailTag?: string;
}

/**
 * Calculates the maximum safe landed cost (SAR) for a style to participate
 * in a shared multi-style bundle rail without violating the Saudi 15% VAT Zero-Loss floor.
 * 
 * Formula: Floor( (Bundle_Price / Quantity) / 1.15 )
 * E.g. Buy 2 for 299 SAR: (299 / 2) / 1.15 = 149.50 / 1.15 = 130.00 SAR max cost ceiling.
 */
export function calculateRailCostCeiling(bundlePrice: number, quantity: number): number {
  if (quantity <= 0 || bundlePrice <= 0) return 0;
  const promoPerUnit = bundlePrice / quantity;
  return Math.floor((promoPerUnit / 1.15) * 100) / 100;
}

/**
 * Validates whether a specific style's landed cost permits it to join a shared bundle rail.
 * Returns true iff Landed Cost <= calculateRailCostCeiling(bundlePrice, quantity)
 */
export function isStyleEligibleForRail(landedCost: number, bundlePrice: number, quantity: number): boolean {
  const ceiling = calculateRailCostCeiling(bundlePrice, quantity);
  return landedCost <= (ceiling + 0.005);
}

/**
 * Generates the standardized Odoo POS Campaign Rail Tag for cross-style bundling.
 * When styles share this tag in Odoo POS Pricelist, cash registers automatically apply
 * the bundle discount across different styles in the same transaction.
 * E.g. RULE_BUNDLE_2_299_RAIL or RULE_BUNDLE_3_99_RAIL
 */
export function generateSharedRailTag(bundlePrice: number, quantity: number): string {
  const roundedPrice = Math.round(bundlePrice);
  return `RULE_BUNDLE_${quantity}_${roundedPrice}_RAIL`;
}

/**
 * Rounds a raw bundle price to the closest standard Saudi retail charm price point
 * (ending in .00 or 9.00 SAR) that strictly satisfies the 15% VAT zero-loss floor.
 */
export function roundToSaudiCharmPrice(rawPrice: number, floorPrice: number): number {
  const points = SAUDI_CHARM_PRICE_POINTS.filter(p => p >= floorPrice);
  if (points.length === 0) {
    return Math.ceil(floorPrice);
  }

  // Find closest charm point to rawPrice
  let closest = points[0];
  let minDiff = Math.abs(rawPrice - closest);

  for (const pt of points) {
    const diff = Math.abs(rawPrice - pt);
    if (diff < minDiff) {
      minDiff = diff;
      closest = pt;
    }
  }

  return closest;
}

/**
 * Dynamically computes optimal "Bundle 2" (Pairs) promotional mechanics based on
 * velocity runway (WOS), cumulative sell-through (STR %), and ticket economics.
 */
export function computeDynamicBundle2(metrics: DynamicOfferMetrics): DynamicBundleResult {
  const unitFloor = calculateZeroLossFloor(metrics.unitCost);
  const twoUnitFloor = unitFloor * 2;
  const twoUnitTicket = metrics.ticketPrice * 2;

  // If two-unit floor is already higher than or equal to twoUnitTicket, discounting is prohibited
  if (twoUnitFloor >= twoUnitTicket || metrics.ticketPrice <= 0) {
    return {
      isBundleApplicable: false,
      bundleOfferLabel: 'Full Price Protection (0% Off)',
      bundleQuantity: 1,
      bundlePriceSAR: metrics.ticketPrice,
      unitPromoPriceSAR: metrics.ticketPrice,
      discountPct: 0,
      savingsAmountSAR: 0,
      expectedClearancePct: 20,
      rationale: 'Cost floor does not allow bundle discount without regulatory violation.'
    };
  }

  // Determine dynamic target discount based on inventory pressure & velocity
  let targetDiscount = 0.25; // baseline 25% bundle discount
  let expectedClearance = 35;

  if (metrics.storeFloorWOS > 35.0 || metrics.cumulativeSTR < 30.0) {
    // Sluggish overhang / high runway -> Deeper 30% - 33% bundle incentive
    targetDiscount = 0.33;
    expectedClearance = 45;
  } else if (metrics.storeFloorWOS <= 20.0 && metrics.cumulativeSTR >= 50.0) {
    // Healthy continuity -> Gentle 18% - 20% bundle incentive to preserve margin
    targetDiscount = 0.20;
    expectedClearance = 30;
  }

  const rawBundlePrice = twoUnitTicket * (1 - targetDiscount);
  let charmBundlePrice = roundToSaudiCharmPrice(rawBundlePrice, twoUnitFloor);

  // Guarantee bundle provides a genuine discount (< twoUnitTicket)
  if (charmBundlePrice >= twoUnitTicket) {
    // Find highest charm point strictly below twoUnitTicket and >= twoUnitFloor
    const lowerPoints = SAUDI_CHARM_PRICE_POINTS.filter(p => p < twoUnitTicket && p >= twoUnitFloor);
    if (lowerPoints.length > 0) {
      charmBundlePrice = lowerPoints[lowerPoints.length - 1];
    } else {
      // Cannot fit a charm bundle safely
      return {
        isBundleApplicable: false,
        bundleOfferLabel: 'Spend & Save Eligible (~20% Off)',
        bundleQuantity: 1,
        bundlePriceSAR: metrics.ticketPrice,
        unitPromoPriceSAR: Math.max(unitFloor, Math.round(metrics.ticketPrice * 0.80 * 100) / 100),
        discountPct: 20,
        savingsAmountSAR: 0,
        expectedClearancePct: 25,
        rationale: 'Margin spread too tight for standard charm bundle; routed to general Spend & Save.'
      };
    }
  }

  const savingsSAR = Math.round((twoUnitTicket - charmBundlePrice) * 100) / 100;
  const realizedDiscountPct = Math.round((savingsSAR / twoUnitTicket) * 100);
  const unitPromoPrice = Math.round((charmBundlePrice / 2) * 100) / 100;

  // Format attractive commercial offer label
  const offerLabel = `Buy 2 For ${charmBundlePrice} SAR (Save ${Math.round(savingsSAR)} SAR)`;

  const sharedRailTag = generateSharedRailTag(charmBundlePrice, 2);
  const railCostCeilingSAR = calculateRailCostCeiling(charmBundlePrice, 2);

  return {
    isBundleApplicable: true,
    bundleOfferLabel: offerLabel,
    bundleQuantity: 2,
    bundlePriceSAR: charmBundlePrice,
    unitPromoPriceSAR: unitPromoPrice,
    discountPct: realizedDiscountPct,
    savingsAmountSAR: savingsSAR,
    expectedClearancePct: expectedClearance,
    rationale: `Dynamic 2-pack bundle calibrated to performance (WOS ${metrics.storeFloorWOS.toFixed(1)} wks, STR ${metrics.cumulativeSTR.toFixed(1)}%). Drives 2.0 UPT at ${charmBundlePrice} SAR commercial charm point. Eligible for cross-style mix & match (Cost ceiling: ${railCostCeilingSAR.toFixed(2)} SAR).`,
    sharedRailTag,
    railCostCeilingSAR
  };
}


export interface EvaluatedOfferDecision {
  styleCode: string;
  productName: string;
  ticketPrice: number;
  unitCost: number;
  costPlusVat: number;
  zeroLossFloorSAR: number;
  recommendedPriceSAR: number;
  discountPct: number;
  netMarginSAR: number;
  netMarginPct: number;
  isZeroLossCompliant: boolean;
  expectedClearancePct: number;
  forecastSoldUnits: number;
  forecastNetProfitSAR: number;
  posTag: string;
}

/**
 * Deterministically evaluates the unit economics and commercial feasibility of a style offer
 */
export interface AlternativeOfferScenario {
  scenarioId: string;
  name: string;
  strategicPosture: string;
  promoPriceSAR: number;
  discountPct: number;
  offerLabel: string;
  unitNetMarginSAR: number;
  netMarginPct: number;
  forecastSoldUnits: number;
  expectedClearancePct: number;
  postEventWOS: number;
  posTag: string;
  tradeOffSummary: string;
}

export interface StyleAlternativeOffersResult {
  styleCode: string;
  productName: string;
  category: string;
  season: string;
  ticketPrice: number;
  unitCost: number;
  costPlusVat: number;
  totalPhysicalStock: number;
  weeklyROS: number;
  currentWOS: number;
  strPct: number;
  scenarios: AlternativeOfferScenario[];
}

/**
 * Generates 4 mathematically modeled alternative promotional scenarios
 * allowing executives to balance cash margin against inventory liquidation velocity.
 */
export function generateAlternativeOfferScenarios(
  metrics: DynamicOfferMetrics
): StyleAlternativeOffersResult {
  const ticket = metrics.ticketPrice;
  const cost = metrics.unitCost;
  const floor = calculateZeroLossFloor(cost);
  const stock = metrics.totalPhysicalStock;
  const ros = metrics.weeklyROS > 0 ? metrics.weeklyROS : 0.05;
  const currentWOS = metrics.storeFloorWOS > 0 ? metrics.storeFloorWOS : (stock / ros);
  const scenarios: AlternativeOfferScenario[] = [];

  // --- Scenario 1: Margin Defense (Spend & Save / 20% Off) ---
  const s1Discount = 20;
  const s1RawPrice = ticket * (1 - (s1Discount / 100));
  const s1Price = Math.max(floor, Math.round(s1RawPrice * 100) / 100);
  const s1NetRev = s1Price / 1.15;
  const s1MarginSAR = Math.round((s1NetRev - cost) * 100) / 100;
  const s1MarginPct = s1NetRev > 0 ? Math.round((s1MarginSAR / s1NetRev) * 1000) / 10 : 0;
  const s1ClearanceRate = 0.35;
  const s1Sold = Math.min(stock, Math.round(stock * s1ClearanceRate));
  const s1Remaining = Math.max(0, stock - s1Sold);
  const s1PostWOS = Math.round((s1Remaining / ros) * 10) / 10;

  scenarios.push({
    scenarioId: 'MARGIN_DEFENSE',
    name: 'Option 1: Margin Defense (Spend & Save)',
    strategicPosture: 'PROTECT_MARGIN',
    promoPriceSAR: s1Price,
    discountPct: s1Discount,
    offerLabel: `Spend & Save Eligible (~20% Off: ${s1Price.toFixed(2)} SAR)`,
    unitNetMarginSAR: s1MarginSAR,
    netMarginPct: s1MarginPct,
    forecastSoldUnits: s1Sold,
    expectedClearancePct: Math.round(s1ClearanceRate * 100),
    postEventWOS: s1PostWOS,
    posTag: `RULE_SPEND_SAVE_20PCT_${metrics.styleCode}`,
    tradeOffSummary: `Locks in max net margin (+${s1MarginPct.toFixed(1)}%), but clears only ~${s1Sold}u, leaving ${s1PostWOS} wks of inventory.`
  });

  // --- Scenario 2: Volume Multi-Buy Accelerator (Charm Bundle 2) ---
  const bundleQty = ticket <= 15 ? 3 : 2;
  const bundleTotalTicket = ticket * bundleQty;
  const bundleTotalFloor = floor * bundleQty;
  const targetBundleDiscount = 30; // 30% discount target
  const bundleSolved = roundToSaudiCharmPrice(bundleTotalTicket * (1 - (targetBundleDiscount / 100)), bundleTotalFloor);
  // Ensure strictly < combined ticket
  const finalBundlePrice = bundleSolved < bundleTotalTicket ? bundleSolved : Math.floor(bundleTotalTicket - 1);
  const s2UnitPromo = Math.round((finalBundlePrice / bundleQty) * 100) / 100;
  const s2Discount = Math.round(((bundleTotalTicket - finalBundlePrice) / bundleTotalTicket) * 100);
  const s2NetRev = s2UnitPromo / 1.15;
  const s2MarginSAR = Math.round((s2NetRev - cost) * 100) / 100;
  const s2MarginPct = s2NetRev > 0 ? Math.round((s2MarginSAR / s2NetRev) * 1000) / 10 : 0;
  const s2ClearanceRate = 0.70;
  const s2Sold = Math.min(stock, Math.round(stock * s2ClearanceRate));
  const s2Remaining = Math.max(0, stock - s2Sold);
  const s2PostWOS = Math.round((s2Remaining / ros) * 10) / 10;

  scenarios.push({
    scenarioId: 'VOLUME_BUNDLE',
    name: `Option 2: Volume Multi-Buy (Buy ${bundleQty} For ${finalBundlePrice} SAR)`,
    strategicPosture: 'ACCELERATE_VOLUME',
    promoPriceSAR: s2UnitPromo,
    discountPct: s2Discount,
    offerLabel: `Take ${bundleQty} For ${finalBundlePrice} SAR (${s2UnitPromo.toFixed(2)} SAR/u)`,
    unitNetMarginSAR: s2MarginSAR,
    netMarginPct: s2MarginPct,
    forecastSoldUnits: s2Sold,
    expectedClearancePct: Math.round(s2ClearanceRate * 100),
    postEventWOS: s2PostWOS,
    posTag: `RULE_BUNDLE_${bundleQty}_${finalBundlePrice}_${metrics.styleCode}`,
    tradeOffSummary: `Drives transaction size and clears ~${s2Sold}u (70% liquidation) while retaining healthy +${s2MarginPct.toFixed(1)}% margin.`
  });

  // --- Scenario 3: Aggressive Floor Liquidation (Dedicated Clearance Rail 50% Off) ---
  const s3RawPrice = ticket * 0.50;
  const s3Price = Math.max(floor, Math.round(s3RawPrice * 100) / 100);
  const s3Discount = Math.round(((ticket - s3Price) / ticket) * 100);
  const s3NetRev = s3Price / 1.15;
  const s3MarginSAR = Math.round((s3NetRev - cost) * 100) / 100;
  const s3MarginPct = s3NetRev > 0 ? Math.round((s3MarginSAR / s3NetRev) * 1000) / 10 : 0;
  const s3ClearanceRate = 0.95;
  const s3Sold = Math.min(stock, Math.round(stock * s3ClearanceRate));
  const s3Remaining = Math.max(0, stock - s3Sold);
  const s3PostWOS = Math.round((s3Remaining / ros) * 10) / 10;

  scenarios.push({
    scenarioId: 'CLEARANCE_RAIL',
    name: 'Option 3: Dedicated Clearance Rail (50% Off / Floor Clamped)',
    strategicPosture: 'RAPID_DECONGESTION',
    promoPriceSAR: s3Price,
    discountPct: s3Discount,
    offerLabel: `50% Off Dedicated Rail (${s3Price.toFixed(2)} SAR)`,
    unitNetMarginSAR: s3MarginSAR,
    netMarginPct: s3MarginPct,
    forecastSoldUnits: s3Sold,
    expectedClearancePct: Math.round(s3ClearanceRate * 100),
    postEventWOS: s3PostWOS,
    posTag: `RULE_CLEARANCE_50PCT_${metrics.styleCode}`,
    tradeOffSummary: `Eliminates the ${currentWOS.toFixed(0)}-week bottleneck immediately (95% liquidation), preserving legal +${s3MarginPct.toFixed(1)}% net margin.`
  });

  // --- Scenario 4: Checkout Till Impulse Booster (Basket Threshold Add-On) ---
  const s4Price = Math.max(floor, Math.round(ticket * 0.52));
  const s4Discount = Math.round(((ticket - s4Price) / ticket) * 100);
  const s4NetRev = s4Price / 1.15;
  const s4MarginSAR = Math.round((s4NetRev - cost) * 100) / 100;
  const s4MarginPct = s4NetRev > 0 ? Math.round((s4MarginSAR / s4NetRev) * 1000) / 10 : 0;
  const s4Threshold = 100;

  scenarios.push({
    scenarioId: 'CHECKOUT_BOOSTER',
    name: 'Option 4: POS Till Basket Booster (Tamara/Tabby Threshold)',
    strategicPosture: 'BASKET_BUILDER',
    promoPriceSAR: s4Price,
    discountPct: s4Discount,
    offerLabel: `Add at checkout for ${s4Price.toFixed(2)} SAR on orders $\\ge$ ${s4Threshold} SAR`,
    unitNetMarginSAR: s4MarginSAR,
    netMarginPct: s4MarginPct,
    forecastSoldUnits: Math.min(stock, Math.round(stock * 0.55)),
    expectedClearancePct: 55,
    postEventWOS: Math.round((Math.max(0, stock * 0.45) / ros) * 10) / 10,
    posTag: `RULE_CHECKOUT_ADDON_${s4Price}_${metrics.styleCode}`,
    tradeOffSummary: `Acts as the decisive basket builder at checkout to help shoppers exceed the 100 SAR BNPL split-payment limit.`
  });

  return {
    styleCode: metrics.styleCode,
    productName: metrics.productName,
    category: metrics.category,
    season: metrics.season,
    ticketPrice: ticket,
    unitCost: cost,
    costPlusVat: floor,
    totalPhysicalStock: stock,
    weeklyROS: metrics.weeklyROS,
    currentWOS,
    strPct: metrics.cumulativeSTR,
    scenarios
  };
}

export interface EvaluatedOfferDecision {
  styleCode: string;
  productName: string;
  ticketPrice: number;
  unitCost: number;
  costPlusVat: number;
  zeroLossFloorSAR: number;
  recommendedPriceSAR: number;
  discountPct: number;
  netMarginSAR: number;
  netMarginPct: number;
  isZeroLossCompliant: boolean;
  expectedClearancePct: number;
  forecastSoldUnits: number;
  forecastNetProfitSAR: number;
  posTag: string;
}

/**
 * Deterministically evaluates the unit economics and commercial feasibility of a style offer
 */
export function evaluateOfferDecision(
  metrics: DynamicOfferMetrics,
  targetDiscountPct?: number
): EvaluatedOfferDecision {
  const costPlusVat = calculateZeroLossFloor(metrics.unitCost);
  const discount = targetDiscountPct !== undefined ? targetDiscountPct : (metrics.storeFloorWOS > 35 ? 35 : 20);
  const rawPromoPrice = metrics.ticketPrice * (1 - (discount / 100));
  const safePromoPrice = Math.max(costPlusVat, Math.round(rawPromoPrice * 100) / 100);
  const actualDiscountPct = metrics.ticketPrice > 0 
    ? Math.round((1 - (safePromoPrice / metrics.ticketPrice)) * 100) 
    : 0;

  const netRevenue = safePromoPrice / 1.15;
  const netMarginSAR = Math.round((netRevenue - metrics.unitCost) * 100) / 100;
  const netMarginPct = netRevenue > 0 ? Math.round((netMarginSAR / netRevenue) * 1000) / 10 : 0;

  const clearanceRate = actualDiscountPct >= 40 ? 0.50 : (actualDiscountPct >= 20 ? 0.35 : 0.20);
  const forecastSold = Math.round(metrics.totalPhysicalStock * clearanceRate);
  const forecastProfit = Math.round(forecastSold * netMarginSAR);

  const posTag = actualDiscountPct > 0 
    ? `RULE_${actualDiscountPct}PCT_${metrics.styleCode}` 
    : `RULE_FULLPRICE_${metrics.styleCode}`;

  return {
    styleCode: metrics.styleCode,
    productName: metrics.productName,
    ticketPrice: metrics.ticketPrice,
    unitCost: metrics.unitCost,
    costPlusVat,
    zeroLossFloorSAR: costPlusVat,
    recommendedPriceSAR: safePromoPrice,
    discountPct: actualDiscountPct,
    netMarginSAR,
    netMarginPct,
    isZeroLossCompliant: safePromoPrice >= (costPlusVat - 0.01),
    expectedClearancePct: Math.round(clearanceRate * 100),
    forecastSoldUnits: forecastSold,
    forecastNetProfitSAR: forecastProfit,
    posTag
  };
}
