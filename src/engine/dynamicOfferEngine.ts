import { calculateZeroLossFloor, SpeedBand } from './metricsCalculator';
import { SAUDI_CHARM_PRICE_POINTS, CampaignMode, DROP_CYCLE_BENCHMARKS } from '../config/constants';

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
  hasCoreSizes?: boolean;
  isSingleSize?: boolean;
  stockWH?: number;
  historicalASP?: number;
  momentumRatio?: number;
  salesLifecycleWeeks?: number;
  effectiveTenureWeeks?: number;
  speedBand?: SpeedBand;
  campaignMode?: CampaignMode;
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

  // Determine dynamic target discount based on 2-month drop cadence, Medium Mover tier, and active Campaign Mode
  let targetDiscount = 0.25; // baseline 25% bundle discount
  let expectedClearance = 35;

  const mode: CampaignMode = metrics.campaignMode || 'REGULAR_DROP_CYCLE';
  const tenure = metrics.effectiveTenureWeeks ?? metrics.salesLifecycleWeeks ?? 0;

  if (
    metrics.speedBand === 'MEDIUM_2B' ||
    metrics.storeFloorWOS > 35.0 ||
    metrics.cumulativeSTR < 30.0 ||
    (tenure > 8.7 && metrics.storeFloorWOS > 20.0)
  ) {
    // Medium 2B (Exceeded 1 drop cycle / 20+ WOS) or sluggish overhang -> Escalated 30% - 33% bundle incentive
    targetDiscount = (mode === 'WHITE_FRIDAY' || mode === 'SUMMER_EXIT' || mode === 'WINTER_EXIT') ? 0.35 : 0.30;
    expectedClearance = 45;
  } else if (
    metrics.speedBand === 'MEDIUM_2A' ||
    (metrics.storeFloorWOS <= 20.0 && metrics.cumulativeSTR >= 30.0)
  ) {
    // Medium 2A (Steady within drop / <= 20 WOS) -> Gentle 18% - 20% bundle incentive to lift UPT & preserve margin
    targetDiscount = (mode === 'WHITE_FRIDAY') ? 0.25 : 0.20;
    expectedClearance = 32;
  }

  let rawBundlePrice = twoUnitTicket * (1 - targetDiscount);

  // Align patriotic basket-builder events to official KSA symbolic bundle prices when margin-safe
  const symbolicPool = mode === 'NATIONAL_DAY'
    ? [94, 194, 294]
    : (mode === 'FOUNDING_DAY' ? [122, 222, 322] : []);
  let charmBundlePrice = 0;
  if (symbolicPool.length > 0) {
    const validSymbolic = symbolicPool.filter(p => p >= twoUnitFloor && p < twoUnitTicket);
    if (validSymbolic.length > 0) {
      let bestSym = validSymbolic[0];
      let bestDiff = Math.abs(rawBundlePrice - bestSym);
      for (const s of validSymbolic) {
        const d = Math.abs(rawBundlePrice - s);
        if (d < bestDiff) {
          bestDiff = d;
          bestSym = s;
        }
      }
      if (bestDiff <= 35) {
        charmBundlePrice = bestSym;
      }
    }
  }

  if (!charmBundlePrice) {
    charmBundlePrice = roundToSaudiCharmPrice(rawBundlePrice, twoUnitFloor);
  }

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
    rationale: `Dynamic 2-pack bundle calibrated to performance (WOS ${Number(metrics.storeFloorWOS ?? 0).toFixed(1)} wks, STR ${Number(metrics.cumulativeSTR ?? 0).toFixed(1)}%). Drives 2.0 UPT at ${charmBundlePrice} SAR commercial charm point. Eligible for cross-style mix & match (Cost ceiling: ${railCostCeilingSAR.toFixed(2)} SAR).`,
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
  projectedNetProfitSAR?: number;
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
  recommendedScenarioId?: string;
  selectionReason?: string;
  isBrokenFastMover?: boolean;
  brokenFastMoverType?: 'NEAR_SELLOUT_FULL_PRICE' | 'WH_TRAPPED_CONSOLIDATE' | 'BROKEN_TAIL_CLEARANCE';
  scenarios: AlternativeOfferScenario[];
}

/**
 * Evaluates 4 Discount Planner scenarios for Broken-Size styles (including Broken Fast Movers)
 * and deterministically selects the highest-value VAT-compliant option with a clear business rationale.
 */
export function evaluateBrokenFastMoverScenarios(
  metrics: DynamicOfferMetrics,
  options?: { isBigClearanceEvent?: boolean }
): StyleAlternativeOffersResult {
  const ticket = metrics.ticketPrice;
  const cost = metrics.unitCost;
  const floor = calculateZeroLossFloor(cost);
  const stock = Math.max(0, metrics.totalPhysicalStock || 0);
  const whUnits = Math.max(0, metrics.stockWH || 0);
  const ros = metrics.weeklyROS > 0 ? metrics.weeklyROS : 0.05;
  const storeWos = metrics.storeFloorWOS > 0 ? metrics.storeFloorWOS : (stock / ros);
  const totalEffectiveWOS = metrics.weeklyROS > 0
    ? Math.round((stock / metrics.weeklyROS) * 10) / 10
    : 999;
  const isBigClearanceEvent = Boolean(options?.isBigClearanceEvent);
  const b = DROP_CYCLE_BENCHMARKS;

  const isNearSelloutFast =
    !isBigClearanceEvent &&
    metrics.weeklyROS >= b.BROKEN_FAST_MIN_ROS &&
    totalEffectiveWOS <= b.BROKEN_SELLOUT_MAX_WOS;

  const isWhTrappedFast =
    !isNearSelloutFast &&
    !isBigClearanceEvent &&
    metrics.weeklyROS >= b.BROKEN_FAST_MIN_ROS &&
    whUnits >= b.BROKEN_WH_MIN_UNITS &&
    storeWos <= b.BROKEN_SELLOUT_MAX_WOS;

  // Adjusted realistic pace on remaining fragmented sizes
  const organicPace = Math.max(0.2, ros * (isNearSelloutFast ? 0.75 : 0.48));

  // --- Scenario 1: Hold Full Price (0% Off) Organic Sellout ---
  const s1Price = ticket;
  const s1NetRev = s1Price / 1.15;
  const s1MarginSAR = Math.round((s1NetRev - cost) * 100) / 100;
  const s1MarginPct = s1NetRev > 0 ? Math.round((s1MarginSAR / s1NetRev) * 1000) / 10 : 0;
  const s1ClearancePct = isNearSelloutFast ? 90 : (isWhTrappedFast ? 50 : 25);
  const s1Sold = Math.min(stock, Math.max(1, Math.round(stock * (s1ClearancePct / 100))));
  const s1PostWOS = isNearSelloutFast
    ? totalEffectiveWOS
    : Math.round((Math.max(0, stock - s1Sold) / organicPace) * 10) / 10;
  const s1Profit = Math.round(s1Sold * s1MarginSAR);

  // --- Scenario 2: Transfer from WH / Consolidate + Gentle Buy-2 Bundle (~20-25% Off) ---
  const twoUnitTicket = ticket * 2;
  const twoUnitFloor = floor * 2;
  const rawBundle2 = twoUnitTicket * 0.80;
  const charmBundle2 = twoUnitFloor < twoUnitTicket
    ? roundToSaudiCharmPrice(rawBundle2, twoUnitFloor)
    : twoUnitTicket;
  const validBundle2 = charmBundle2 < twoUnitTicket ? charmBundle2 : twoUnitTicket;
  const s2UnitPrice = validBundle2 < twoUnitTicket
    ? Math.max(floor, Math.round((validBundle2 / 2) * 100) / 100)
    : ticket;
  const s2Discount = ticket > 0 ? Math.round(((ticket - s2UnitPrice) / ticket) * 100) : 0;
  const s2NetRev = s2UnitPrice / 1.15;
  const s2MarginSAR = Math.round((s2NetRev - cost) * 100) / 100;
  const s2MarginPct = s2NetRev > 0 ? Math.round((s2MarginSAR / s2NetRev) * 1000) / 10 : 0;
  const s2ClearancePct = isWhTrappedFast ? 75 : (isNearSelloutFast ? 95 : 45);
  const s2Sold = Math.min(stock, Math.max(1, Math.round(stock * (s2ClearancePct / 100))));
  const s2PostWOS = Math.round((Math.max(0, stock - s2Sold) / Math.max(0.3, ros)) * 10) / 10;
  const s2Profit = Math.round(s2Sold * s2MarginSAR);
  const s2OfferLabel = whUnits >= b.BROKEN_WH_MIN_UNITS && s2Discount > 0
    ? `Release ${whUnits}u WH + Buy 2 For ${Math.round(validBundle2)} SAR (${s2UnitPrice.toFixed(2)} SAR/u)`
    : (s2Discount > 0
        ? `Consolidate + Buy 2 For ${Math.round(validBundle2)} SAR (${s2UnitPrice.toFixed(2)} SAR/u)`
        : `Release ${whUnits}u WH at Full Price (0% Off)`);

  // --- Scenario 3: Shared 3-For-99 SAR Clearance Rail (33 SAR/u when Cost <= 28.69) ---
  const canUse3For99 = ticket > 40 && floor <= 33.01;
  const s3UnitPrice = canUse3For99 ? 33.00 : Math.max(floor, Math.round(ticket * 0.60 * 100) / 100);
  const s3Discount = ticket > 0 ? Math.round(((ticket - s3UnitPrice) / ticket) * 100) : 0;
  const s3NetRev = s3UnitPrice / 1.15;
  const s3MarginSAR = Math.round((s3NetRev - cost) * 100) / 100;
  const s3MarginPct = s3NetRev > 0 ? Math.round((s3MarginSAR / s3NetRev) * 1000) / 10 : 0;
  const s3ClearancePct = canUse3For99 ? 65 : 50;
  const s3Sold = Math.min(stock, Math.max(1, Math.round(stock * (s3ClearancePct / 100))));
  const s3PostWOS = Math.round((Math.max(0, stock - s3Sold) / Math.max(0.4, ros * 1.4)) * 10) / 10;
  const s3Profit = Math.round(s3Sold * s3MarginSAR);

  // --- Scenario 4: Dedicated % Clearance Rail (50% if <=40 SAR, else 40% Safe VAT Floor) ---
  const targetClrFactor = ticket <= 40 ? 0.50 : 0.60;
  const s4Price = Math.max(floor, Math.round(ticket * targetClrFactor * 100) / 100);
  const s4Discount = ticket > 0 ? Math.round(((ticket - s4Price) / ticket) * 100) : 0;
  const s4NetRev = s4Price / 1.15;
  const s4MarginSAR = Math.round((s4NetRev - cost) * 100) / 100;
  const s4MarginPct = s4NetRev > 0 ? Math.round((s4MarginSAR / s4NetRev) * 1000) / 10 : 0;
  const s4ClearancePct = 85;
  const s4Sold = Math.min(stock, Math.max(1, Math.round(stock * (s4ClearancePct / 100))));
  const s4PostWOS = Math.round((Math.max(0, stock - s4Sold) / Math.max(0.5, ros * 1.6)) * 10) / 10;
  const s4Profit = Math.round(s4Sold * s4MarginSAR);

  const scenarios: AlternativeOfferScenario[] = [
    {
      scenarioId: 'FULL_PRICE_SELLOUT',
      name: 'Scenario 1: Hold Full Price Organic Sellout (0% Off)',
      strategicPosture: 'PROTECT_MARGIN_SELLOUT',
      promoPriceSAR: s1Price,
      discountPct: 0,
      offerLabel: `Full Price Sellout Protection (0% Off: ${s1Price.toFixed(2)} SAR)`,
      unitNetMarginSAR: s1MarginSAR,
      netMarginPct: s1MarginPct,
      forecastSoldUnits: s1Sold,
      expectedClearancePct: s1ClearancePct,
      postEventWOS: s1PostWOS,
      projectedNetProfitSAR: s1Profit,
      posTag: `RULE_FULLPRICE_${metrics.styleCode}`,
      tradeOffSummary: `Nets +${s1MarginSAR.toFixed(2)} SAR/u (${s1MarginPct.toFixed(1)}%, ~+${s1Profit} SAR total). ${isNearSelloutFast ? `Last ${stock} pcs finish naturally in ${totalEffectiveWOS} wks without giving away margin.` : `Without store promo, remaining ${stock}u linger ${s1PostWOS} wks.`}`
    },
    {
      scenarioId: 'WH_CONSOLIDATE_BUNDLE',
      name: 'Scenario 2: Release WH / Consolidate + Gentle Buy-2',
      strategicPosture: 'REBALANCE_AND_BUNDLE',
      promoPriceSAR: s2UnitPrice,
      discountPct: s2Discount,
      offerLabel: s2OfferLabel,
      unitNetMarginSAR: s2MarginSAR,
      netMarginPct: s2MarginPct,
      forecastSoldUnits: s2Sold,
      expectedClearancePct: s2ClearancePct,
      postEventWOS: s2PostWOS,
      projectedNetProfitSAR: s2Profit,
      posTag: s2Discount > 0 ? `RULE_BUNDLE_2_${Math.round(validBundle2)}_${metrics.styleCode}` : `RULE_FULLPRICE_${metrics.styleCode}`,
      tradeOffSummary: `Nets +${s2MarginSAR.toFixed(2)} SAR/u (${s2MarginPct.toFixed(1)}%, ~+${s2Profit} SAR total). Unlocks ${whUnits}u WH reserve onto store shelves with a gentle margin-safe basket pull.`
    },
    {
      scenarioId: 'CLEARANCE_3_FOR_99',
      name: canUse3For99 ? 'Scenario 3: Shared 3-For-99 SAR Rail (33 SAR/u)' : 'Scenario 3: 40% Safe-Floor Rail',
      strategicPosture: 'SHARED_CLEARANCE_RAIL',
      promoPriceSAR: s3UnitPrice,
      discountPct: s3Discount,
      offerLabel: canUse3For99
        ? 'Take 3 For 99 SAR Rail (33 SAR/u)'
        : `Clearance Rail (${s3Discount}% Safe Floor: ${s3UnitPrice.toFixed(2)} SAR)`,
      unitNetMarginSAR: s3MarginSAR,
      netMarginPct: s3MarginPct,
      forecastSoldUnits: s3Sold,
      expectedClearancePct: s3ClearancePct,
      postEventWOS: s3PostWOS,
      projectedNetProfitSAR: s3Profit,
      posTag: canUse3For99 ? `RULE_BUNDLE_3_99_RAIL` : `RULE_CLEARANCE_${s3Discount}PCT_${metrics.styleCode}`,
      tradeOffSummary: `Nets +${s3MarginSAR.toFixed(2)} SAR/u (${s3MarginPct.toFixed(1)}%, ~+${s3Profit} SAR total). Cross-style mix-and-match rail accelerates fragmented tail clearance above ${floor.toFixed(2)} SAR VAT floor.`
    },
    {
      scenarioId: 'CLEARANCE_PCT_SAFE',
      name: ticket <= 40 ? 'Scenario 4: 50% Dedicated Clearance Rail' : `Scenario 4: ${s4Discount}% Safe Floor Markdown`,
      strategicPosture: 'RAPID_DECONGESTION',
      promoPriceSAR: s4Price,
      discountPct: s4Discount,
      offerLabel: ticket <= 40
        ? `50% Off Dedicated Clearance Rail (${s4Price.toFixed(2)} SAR)`
        : `Clearance Rail (${s4Discount}% Safe Floor: ${s4Price.toFixed(2)} SAR)`,
      unitNetMarginSAR: s4MarginSAR,
      netMarginPct: s4MarginPct,
      forecastSoldUnits: s4Sold,
      expectedClearancePct: s4ClearancePct,
      postEventWOS: s4PostWOS,
      projectedNetProfitSAR: s4Profit,
      posTag: `RULE_CLEARANCE_${s4Discount}PCT_${metrics.styleCode}`,
      tradeOffSummary: `Fastest liquidation (~${s4Sold}u, ${s4PostWOS} WOS left) yielding +${s4MarginSAR.toFixed(2)} SAR/u (${s4MarginPct.toFixed(1)}%) clamped strictly above ${floor.toFixed(2)} SAR VAT floor.`
    }
  ];

  let recommendedScenarioId = canUse3For99 ? 'CLEARANCE_3_FOR_99' : 'CLEARANCE_PCT_SAFE';
  let brokenFastMoverType: StyleAlternativeOffersResult['brokenFastMoverType'] = 'BROKEN_TAIL_CLEARANCE';
  let selectionReason = `Larger broken-size tail (${stock}u remaining, ${totalEffectiveWOS} WOS) cannot rely on full-price waiting; shared clearance clears floor bottlenecks before the next 2-month drop while staying >= ${floor.toFixed(2)} SAR VAT floor.`;

  if (isNearSelloutFast) {
    recommendedScenarioId = 'FULL_PRICE_SELLOUT';
    brokenFastMoverType = 'NEAR_SELLOUT_FULL_PRICE';
    selectionReason = `Despite missing core sizes, active pace (${ros.toFixed(1)} u/wk, ${metrics.cumulativeSTR.toFixed(1)}% STR) clears all ${stock} remaining pieces in ${totalEffectiveWOS} wks (<= 3.0 WOS). Holding Full Price earns +${s1Profit.toLocaleString()} SAR vs only +${s4Profit.toLocaleString()} SAR on a clearance markdown.`;
  } else if (isWhTrappedFast) {
    recommendedScenarioId = 'WH_CONSOLIDATE_BUNDLE';
    brokenFastMoverType = 'WH_TRAPPED_CONSOLIDATE';
    selectionReason = `Store shelves hold only ${Math.max(0, stock - whUnits)}u (${storeWos.toFixed(1)} WOS) while ${whUnits}u sit in Central WH at ${ros.toFixed(1)} u/wk live pull. Releasing WH stock with a gentle Buy-2 / Full Price strategy recovers +${s2MarginSAR.toFixed(2)} SAR/u (${s2MarginPct.toFixed(1)}%) vs only +${s3MarginSAR.toFixed(2)} SAR/u on deep 3-For-99 SAR clearance.`;
  }

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
    currentWOS: storeWos,
    strPct: metrics.cumulativeSTR,
    recommendedScenarioId,
    selectionReason,
    isBrokenFastMover: isNearSelloutFast || isWhTrappedFast,
    brokenFastMoverType,
    scenarios
  };
}

/**
 * Generates 4 mathematically modeled alternative promotional scenarios
 * allowing executives to balance cash margin against inventory liquidation velocity.
 */
export function generateAlternativeOfferScenarios(
  metrics: DynamicOfferMetrics
): StyleAlternativeOffersResult {
  const isBrokenApparel =
    !metrics.isSingleSize &&
    (metrics.activeSizeCount < 3 || metrics.hasCoreSizes === false);

  if (isBrokenApparel) {
    return evaluateBrokenFastMoverScenarios(metrics);
  }

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
  // Ensure strictly < combined ticket and >= legal floor when spread allows
  let finalBundlePrice = bundleSolved < bundleTotalTicket
    ? bundleSolved
    : (bundleTotalFloor < bundleTotalTicket
        ? Math.max(bundleTotalFloor, Math.floor((bundleTotalTicket - 0.01) * 100) / 100)
        : bundleTotalTicket);
  finalBundlePrice = Math.round(finalBundlePrice * 100) / 100;
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
  const rawS4 = Math.round(ticket * 0.52);
  const candidateS4 = rawS4 > 0 ? rawS4 : Math.round(ticket * 0.52 * 100) / 100;
  const s4Price = ticket >= floor ? Math.min(ticket, Math.max(floor, candidateS4)) : floor;
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
