import {
  calculateZeroLossFloor,
  detectSingleSizeAssortment,
  evaluateSpeedAndHeroQualification,
  SpeedBand
} from './metricsCalculator';
import { LIFECYCLE_TIERS, DROP_CYCLE_BENCHMARKS, CampaignMode } from '../config/constants';
import {
  computeDynamicBundle2,
  calculateRailCostCeiling,
  generateSharedRailTag,
  evaluateBrokenFastMoverScenarios
} from './dynamicOfferEngine';

export interface StyleMetrics {
  styleCode: string;
  productName: string;
  category: string;
  season: string;
  unitCost: number;
  ticketPrice: number;
  totalPhysicalStock: number;
  stockAndalus: number;
  stockYasmeen: number;
  stockJouri: number;
  stockWH: number;
  weeklyROS: number;
  cumulativeSTR: number;
  storeFloorWOS: number;
  activeSizeCount: number;
  hasCoreSizes?: boolean;
  isSingleSize?: boolean;
  sizeBreakdown?: Record<string, number>;
  everSizes?: string[];
  firstMoveDate?: string;
  historicalASP?: number;
  soldUnits?: number;
  salesLifecycleWeeks?: number;
  // Multi-Horizon Velocity & Floor Tenure
  activeWeeks?: number;
  weeklyROS2wk?: number;
  weeklyROS4wk?: number;
  weeklyROS8wk?: number;
  momentumRatio?: number;
  momentumLabel?: string;
}

export interface RecommendationResult {
  tier: string;
  recommendedOffer: string;
  discountPct: number;
  promotionalPriceSAR: number;
  expectedClearancePct: number;
  rationale: string;
  zeroLossStatus: 'YES' | 'FLAGGED';
  bundleQuantity?: number;
  bundlePriceSAR?: number;
  sharedRailTag?: string;
  railCostCeilingSAR?: number;
  historicalDiscountDepthPct?: number;
  speedBand?: SpeedBand;
  strVelocityPctPerWeek?: number;
  effectiveTenureWeeks?: number;
  campaignMode?: CampaignMode;
  clearanceScope?: 'NONE' | 'PERMANENT_ODDMENT_RAIL' | 'EVENT_CLEARANCE';
}

export interface ClassifyOptions {
  campaignMode?: CampaignMode;
}

function normalizeSeasonCompact(season: string | undefined): string {
  return (season || '').toUpperCase().replace(/[\s_-]+/g, '');
}

/**
 * 7-Tier Style Judgement Engine & Dynamic Offer Classifier with 2-Month Drop-Cycle Validation
 * Evaluates Time-Normalized STR Speed, Multi-Horizon Velocity (ROS), Runway (WOS), Size Curve (SAR),
 * Historical Realized ASP, and Active KSA Campaign Mode (Everyday Permanent Rail vs Event Clearance).
 */
export function classifyStyleAndRecommend(
  metrics: StyleMetrics,
  options?: ClassifyOptions
): RecommendationResult {
  const campaignMode: CampaignMode = options?.campaignMode || 'REGULAR_DROP_CYCLE';
  const isBigClearanceEvent =
    campaignMode === 'WHITE_FRIDAY' ||
    campaignMode === 'SUMMER_EXIT' ||
    campaignMode === 'WINTER_EXIT';
  const isFestiveHarvest =
    campaignMode === 'EID_AL_FITR' ||
    campaignMode === 'RAMADAN_PREP';
  const costPlusVat = calculateZeroLossFloor(metrics.unitCost);

  // Guard 0: System pricing error in Odoo (Ticket price is already below cost + 15% VAT)
  if (metrics.ticketPrice < costPlusVat) {
    return {
      tier: LIFECYCLE_TIERS.FLAGGED_PRICE_ERROR,
      recommendedOffer: 'FLAGGED: System Price Error (0% Off)',
      discountPct: 0,
      promotionalPriceSAR: metrics.ticketPrice,
      expectedClearancePct: 0,
      rationale: `Ticket price (${metrics.ticketPrice.toFixed(2)} SAR) is below Landed Cost + 15% VAT (${costPlusVat.toFixed(2)} SAR). Audit Odoo catalog.`,
      zeroLossStatus: 'FLAGGED',
      bundleQuantity: 1,
      bundlePriceSAR: metrics.ticketPrice,
      campaignMode,
      clearanceScope: 'NONE'
    };
  }

  // Historical Discount Intelligence: Audit realized customer willingness to pay from Odoo
  const hasRecordedSales = metrics.soldUnits === undefined || metrics.soldUnits > 0;
  const hasHistoricalSales = hasRecordedSales && metrics.historicalASP !== undefined && metrics.historicalASP > 0;
  const histDiscountDepthPct = (hasHistoricalSales && metrics.ticketPrice > 0 && (metrics.historicalASP ?? 0) < metrics.ticketPrice)
    ? Math.round((1 - ((metrics.historicalASP ?? 0) / metrics.ticketPrice)) * 100)
    : 0;

  // Guard 1: Fresh Winter 2026 arrivals entering peak seasonal demand (shielded unless active mode is WINTER_EXIT)
  const compactSeason = normalizeSeasonCompact(metrics.season);
  const isFreshWinter2026 =
    compactSeason.includes('AW26') ||
    compactSeason.includes('FW26') ||
    compactSeason.includes('WINTER2026');

  if (isFreshWinter2026 && campaignMode !== 'WINTER_EXIT') {
    return {
      tier: LIFECYCLE_TIERS.FRESH_WINTER,
      recommendedOffer: '100% Full Ticket Price (0% Off)',
      discountPct: 0,
      promotionalPriceSAR: metrics.ticketPrice,
      expectedClearancePct: 15,
      rationale: 'Fresh Winter 2026 arrival entering peak weather window. Strictly protected at full price.',
      zeroLossStatus: 'YES',
      bundleQuantity: 1,
      bundlePriceSAR: metrics.ticketPrice,
      historicalDiscountDepthPct: histDiscountDepthPct,
      campaignMode,
      clearanceScope: 'NONE'
    };
  }

  // STEP 1 (Speed & STR FIRST): Evaluate Sell-Through (STR %), Velocity (ROS), WOS & 1-Month (4.3w) Grace BEFORE Size Health!
  const isSingleSize = detectSingleSizeAssortment(
    metrics.category,
    metrics.productName,
    metrics.isSingleSize,
    metrics.sizeBreakdown,
    metrics.everSizes
  );
  // STEP 2 (Size Health SECOND): Core apparel requires >= 3 active sizes (>= 1 unit each) & intact S/M/L/XL
  const hasHealthyCoreCurve = metrics.activeSizeCount >= 3 && metrics.hasCoreSizes !== false;

  // Seasonality & 2-Month Drop-Cycle Speed Evaluation
  const isNextSeasonArrival = compactSeason.includes('SS27') || compactSeason.includes('SUMMER2027');
  const isOlderSeason =
    compactSeason.includes('SS26') ||
    compactSeason.includes('SUMMER2026') ||
    compactSeason.includes('2025') ||
    compactSeason.includes('2024') ||
    compactSeason.includes('2018');

  const speedEval = evaluateSpeedAndHeroQualification({
    cumulativeSTR: metrics.cumulativeSTR,
    weeklyROS: metrics.weeklyROS,
    weeklyROS2wk: metrics.weeklyROS2wk,
    storeFloorWOS: metrics.storeFloorWOS,
    salesLifecycleWeeks: metrics.salesLifecycleWeeks,
    firstMoveDate: metrics.firstMoveDate,
    isSingleSize,
    hasHealthyCoreCurve,
    isOlderSeason,
    momentumRatio: metrics.momentumRatio
  });

  const isRecentLaunchWindow = speedEval.isLaunchShield;
  const weeksSinceFirstArrival = speedEval.effectiveTenureWeeks > 0 ? speedEval.effectiveTenureWeeks : 999;

  if (isNextSeasonArrival && (isSingleSize || hasHealthyCoreCurve)) {
    return {
      tier: LIFECYCLE_TIERS.HERO_CORE,
      recommendedOffer: 'Full Price Margin Protection (0% Off)',
      discountPct: 0,
      promotionalPriceSAR: metrics.ticketPrice,
      expectedClearancePct: 15,
      rationale: 'Upcoming SS27 collection arrival with intact assortment depth. Protected at full ticket price.',
      zeroLossStatus: 'YES',
      bundleQuantity: 1,
      bundlePriceSAR: metrics.ticketPrice,
      historicalDiscountDepthPct: histDiscountDepthPct,
      speedBand: speedEval.speedBand,
      strVelocityPctPerWeek: speedEval.strVelocityPctPerWeek,
      effectiveTenureWeeks: speedEval.effectiveTenureWeeks,
      campaignMode,
      clearanceScope: 'NONE'
    };
  }

  // Single-Size / Beauty Promotional Mechanics
  if (isSingleSize) {
    if (speedEval.isQualifiedHero || speedEval.isLaunchShield) {
      return {
        tier: LIFECYCLE_TIERS.HERO_CORE,
        recommendedOffer: 'Full Price Margin Protection (0% Off)',
        discountPct: 0,
        promotionalPriceSAR: metrics.ticketPrice,
        expectedClearancePct: speedEval.isLaunchShield ? 18 : 25,
        rationale: speedEval.reason,
        zeroLossStatus: 'YES',
        bundleQuantity: 1,
        bundlePriceSAR: metrics.ticketPrice,
        historicalDiscountDepthPct: histDiscountDepthPct,
        speedBand: speedEval.speedBand,
        strVelocityPctPerWeek: speedEval.strVelocityPctPerWeek,
        effectiveTenureWeeks: speedEval.effectiveTenureWeeks,
        campaignMode,
        clearanceScope: 'NONE'
      };
    }

    // In Festive Harvest (Eid/Ramadan), healthy single-size Medium Movers protect full ticket or gentle threshold basket
    if (isFestiveHarvest && speedEval.speedBand !== 'SLOW_OVERSTOCK' && metrics.totalPhysicalStock <= 100) {
      return {
        tier: LIFECYCLE_TIERS.HERO_CORE,
        recommendedOffer: 'Full Price Festive Harvest (0% Off + Gift Add-On >= 300 SAR)',
        discountPct: 0,
        promotionalPriceSAR: metrics.ticketPrice,
        expectedClearancePct: 28,
        rationale: `${speedEval.reason} Peak festive traffic harvests full margin while optional gift threshold lifts AOV.`,
        zeroLossStatus: 'YES',
        bundleQuantity: 1,
        bundlePriceSAR: metrics.ticketPrice,
        historicalDiscountDepthPct: histDiscountDepthPct,
        speedBand: speedEval.speedBand,
        strVelocityPctPerWeek: speedEval.strVelocityPctPerWeek,
        effectiveTenureWeeks: speedEval.effectiveTenureWeeks,
        campaignMode,
        clearanceScope: 'NONE'
      };
    }

    const isCosmeticDept = /cosmetic|beauty|perfume|splash|lotion|scrub|mist/i.test(
      `${metrics.category || ''} ${metrics.productName || ''}`
    );

    if (metrics.totalPhysicalStock > 100) {
      const promoPrice = Math.max(costPlusVat, Math.round(metrics.ticketPrice * 0.80 * 100) / 100);
      const discPct = metrics.ticketPrice > 0 ? Math.round((1 - (promoPrice / metrics.ticketPrice)) * 100) : 0;
      const offerText = discPct >= 15
        ? 'Spend 250 Save 50 (Basket Pack)'
        : (discPct > 0 ? `Margin-Protected Basket Promo (${discPct}% Off)` : 'Full Price Margin Protection (0% Off)');
      return {
        tier: LIFECYCLE_TIERS.VOLUME_MULTI_BUY,
        recommendedOffer: offerText,
        discountPct: discPct,
        promotionalPriceSAR: promoPrice,
        expectedClearancePct: 40,
        rationale: `${speedEval.reason} Deployed as transaction basket booster rather than clearance rail.`,
        zeroLossStatus: 'YES',
        bundleQuantity: 1,
        bundlePriceSAR: promoPrice,
        historicalDiscountDepthPct: histDiscountDepthPct,
        speedBand: speedEval.speedBand,
        strVelocityPctPerWeek: speedEval.strVelocityPctPerWeek,
        effectiveTenureWeeks: speedEval.effectiveTenureWeeks,
        campaignMode,
        clearanceScope: 'NONE'
      };
    } else {
      const rawB2G1Unit = Math.round(metrics.ticketPrice * 0.67 * 100) / 100;
      if (rawB2G1Unit >= costPlusVat) {
        const discPct = metrics.ticketPrice > 0 ? Math.round((1 - (rawB2G1Unit / metrics.ticketPrice)) * 100) : 0;
        const multiPrefix = isCosmeticDept ? 'Beauty Multi-Buy' : 'Volume Multi-Buy';
        return {
          tier: LIFECYCLE_TIERS.VOLUME_MULTI_BUY,
          recommendedOffer: `${multiPrefix} (Buy 2 Get 1 Free)`,
          discountPct: discPct,
          promotionalPriceSAR: rawB2G1Unit,
          expectedClearancePct: 45,
          rationale: `${speedEval.reason} Single-size item (${metrics.category || 'Accessory'}): multi-buy lifts UPT without single-unit oddment dumping.`,
          zeroLossStatus: 'YES',
          bundleQuantity: 3,
          bundlePriceSAR: Math.round(metrics.ticketPrice * 2 * 100) / 100,
          historicalDiscountDepthPct: histDiscountDepthPct,
          speedBand: speedEval.speedBand,
          strVelocityPctPerWeek: speedEval.strVelocityPctPerWeek,
          effectiveTenureWeeks: speedEval.effectiveTenureWeeks,
          campaignMode,
          clearanceScope: 'NONE'
        };
      }

      // B2G1 would violate Saudi VAT floor: step up safely to 20% or zero-loss floor
      const safePromo = Math.max(costPlusVat, Math.round(metrics.ticketPrice * 0.80 * 100) / 100);
      const safeDisc = metrics.ticketPrice > 0 ? Math.round((1 - (safePromo / metrics.ticketPrice)) * 100) : 0;
      if (safeDisc <= 2) {
        return {
          tier: LIFECYCLE_TIERS.HERO_CORE,
          recommendedOffer: 'Full Price Margin Protection (0% Off)',
          discountPct: 0,
          promotionalPriceSAR: metrics.ticketPrice,
          expectedClearancePct: 20,
          rationale: `Single-size item near cost + 15% VAT floor (${costPlusVat.toFixed(2)} SAR). Full ticket price strictly protected.`,
          zeroLossStatus: 'YES',
          bundleQuantity: 1,
          bundlePriceSAR: metrics.ticketPrice,
          historicalDiscountDepthPct: histDiscountDepthPct,
          speedBand: speedEval.speedBand,
          strVelocityPctPerWeek: speedEval.strVelocityPctPerWeek,
          effectiveTenureWeeks: speedEval.effectiveTenureWeeks,
          campaignMode,
          clearanceScope: 'NONE'
        };
      }
      return {
        tier: LIFECYCLE_TIERS.VOLUME_MULTI_BUY,
        recommendedOffer: safeDisc >= 15 ? 'Spend 250 Save 50 (Basket Pack)' : `Margin-Protected Multi-Buy (${safeDisc}% Safe Floor)`,
        discountPct: safeDisc,
        promotionalPriceSAR: safePromo,
        expectedClearancePct: 35,
        rationale: `${speedEval.reason} Clamped above ${costPlusVat.toFixed(2)} SAR VAT floor (B2G1 would breach cost floor).`,
        zeroLossStatus: 'YES',
        bundleQuantity: 1,
        bundlePriceSAR: safePromo,
        historicalDiscountDepthPct: histDiscountDepthPct,
        speedBand: speedEval.speedBand,
        strVelocityPctPerWeek: speedEval.strVelocityPctPerWeek,
        effectiveTenureWeeks: speedEval.effectiveTenureWeeks,
        campaignMode,
        clearanceScope: 'NONE'
      };
    }
  }

  // Tier 1: Time-Bounded Hero Core Captains & 3-Week Launch Shield (Full Price Margin Protection)
  if (speedEval.isQualifiedHero && hasHealthyCoreCurve) {
    return {
      tier: LIFECYCLE_TIERS.HERO_CORE,
      recommendedOffer: 'Full Price Margin Protection (0% Off)',
      discountPct: 0,
      promotionalPriceSAR: metrics.ticketPrice,
      expectedClearancePct: 20,
      rationale: speedEval.reason,
      zeroLossStatus: 'YES',
      bundleQuantity: 1,
      bundlePriceSAR: metrics.ticketPrice,
      historicalDiscountDepthPct: histDiscountDepthPct,
      speedBand: speedEval.speedBand,
      strVelocityPctPerWeek: speedEval.strVelocityPctPerWeek,
      effectiveTenureWeeks: speedEval.effectiveTenureWeeks,
      campaignMode,
      clearanceScope: 'NONE'
    };
  }

  // Initial 1-Month (4.3-Week) Launch Read Shield for brand-new collections with intact core sizes
  if (isRecentLaunchWindow && hasHealthyCoreCurve && !isBigClearanceEvent) {
    return {
      tier: LIFECYCLE_TIERS.HERO_CORE,
      recommendedOffer: 'Full Price Margin Protection (0% Off)',
      discountPct: 0,
      promotionalPriceSAR: metrics.ticketPrice,
      expectedClearancePct: 18,
      rationale: `${speedEval.reason} Protected for initial 1-month (${DROP_CYCLE_BENCHMARKS.LAUNCH_SHIELD_WEEKS}-wk) read window before drop-cycle promotion.`,
      zeroLossStatus: 'YES',
      bundleQuantity: 1,
      bundlePriceSAR: metrics.ticketPrice,
      historicalDiscountDepthPct: histDiscountDepthPct,
      speedBand: speedEval.speedBand,
      strVelocityPctPerWeek: speedEval.strVelocityPctPerWeek,
      effectiveTenureWeeks: speedEval.effectiveTenureWeeks,
      campaignMode,
      clearanceScope: 'NONE'
    };
  }

  // Historical Discount Rule 1: High Organic Pricing Power Protection (never rescues stalled slow-overstock tails)
  const hasOrganicPricingPower =
    histDiscountDepthPct <= 10 &&
    metrics.cumulativeSTR >= 40.0 &&
    (metrics.momentumRatio || 1.0) >= 1.25 &&
    hasHealthyCoreCurve &&
    speedEval.speedBand !== 'SLOW_OVERSTOCK';

  if (hasOrganicPricingPower) {
    const bundle2 = computeDynamicBundle2({
      ...metrics,
      effectiveTenureWeeks: speedEval.effectiveTenureWeeks,
      speedBand: speedEval.speedBand,
      campaignMode
    });
    if (bundle2.isBundleApplicable) {
      const momentumPct = Math.round(((metrics.momentumRatio || 1.0) - 1) * 100);
      return {
        tier: LIFECYCLE_TIERS.BUNDLE_2,
        recommendedOffer: bundle2.bundleOfferLabel,
        discountPct: bundle2.discountPct,
        promotionalPriceSAR: bundle2.unitPromoPriceSAR,
        expectedClearancePct: bundle2.expectedClearancePct,
        rationale: `Organic pricing power verified (historical discount ${histDiscountDepthPct}%, STR ${metrics.cumulativeSTR.toFixed(1)}%, momentum +${momentumPct}%). Preserves margin via 2-pack bundle (${bundle2.bundleOfferLabel}) rather than margin-diluting exit markdown.`,
        zeroLossStatus: 'YES',
        bundleQuantity: bundle2.bundleQuantity,
        bundlePriceSAR: bundle2.bundlePriceSAR,
        sharedRailTag: bundle2.sharedRailTag,
        railCostCeilingSAR: bundle2.railCostCeilingSAR,
        historicalDiscountDepthPct: histDiscountDepthPct,
        speedBand: speedEval.speedBand,
        strVelocityPctPerWeek: speedEval.strVelocityPctPerWeek,
        effectiveTenureWeeks: speedEval.effectiveTenureWeeks,
        campaignMode,
        clearanceScope: 'NONE'
      };
    } else {
      return {
        tier: LIFECYCLE_TIERS.HERO_CORE,
        recommendedOffer: 'Full Price Margin Protection (0% Off)',
        discountPct: 0,
        promotionalPriceSAR: metrics.ticketPrice,
        expectedClearancePct: 25,
        rationale: `Organic pricing power verified (historical discount ${histDiscountDepthPct}%, STR ${metrics.cumulativeSTR.toFixed(1)}%). Margin strictly protected at full ticket price.`,
        zeroLossStatus: 'YES',
        bundleQuantity: 1,
        bundlePriceSAR: metrics.ticketPrice,
        historicalDiscountDepthPct: histDiscountDepthPct,
        speedBand: speedEval.speedBand,
        strVelocityPctPerWeek: speedEval.strVelocityPctPerWeek,
        effectiveTenureWeeks: speedEval.effectiveTenureWeeks,
        campaignMode,
        clearanceScope: 'NONE'
      };
    }
  }

  // Broken / Non-Core Curve Apparel: Evaluate 4 Discount Planner Scenarios before defaulting to Clearance Rail
  const isBrokenCurve = !isSingleSize && !hasHealthyCoreCurve;
  if (isBrokenCurve) {
    const scenarioEval = evaluateBrokenFastMoverScenarios(
      {
        styleCode: metrics.styleCode,
        productName: metrics.productName,
        category: metrics.category,
        season: metrics.season,
        unitCost: metrics.unitCost,
        ticketPrice: metrics.ticketPrice,
        totalPhysicalStock: metrics.totalPhysicalStock,
        weeklyROS: metrics.weeklyROS,
        cumulativeSTR: metrics.cumulativeSTR,
        storeFloorWOS: metrics.storeFloorWOS,
        activeSizeCount: metrics.activeSizeCount,
        hasCoreSizes: metrics.hasCoreSizes,
        isSingleSize: false,
        stockWH: metrics.stockWH,
        salesLifecycleWeeks: metrics.salesLifecycleWeeks,
        effectiveTenureWeeks: speedEval.effectiveTenureWeeks,
        speedBand: speedEval.speedBand,
        campaignMode
      },
      { isBigClearanceEvent }
    );

    if (scenarioEval.brokenFastMoverType === 'NEAR_SELLOUT_FULL_PRICE') {
      return {
        tier: LIFECYCLE_TIERS.HERO_CORE,
        recommendedOffer: 'Full Price Sellout Protection (0% Off)',
        discountPct: 0,
        promotionalPriceSAR: metrics.ticketPrice,
        expectedClearancePct: 85,
        rationale: `[Broken Fast-Mover Scenario Winner — Hold Full Price] ${scenarioEval.selectionReason}`,
        zeroLossStatus: 'YES',
        bundleQuantity: 1,
        bundlePriceSAR: metrics.ticketPrice,
        historicalDiscountDepthPct: histDiscountDepthPct,
        speedBand: speedEval.speedBand,
        strVelocityPctPerWeek: speedEval.strVelocityPctPerWeek,
        effectiveTenureWeeks: speedEval.effectiveTenureWeeks,
        campaignMode,
        clearanceScope: 'NONE'
      };
    }

    if (scenarioEval.brokenFastMoverType === 'WH_TRAPPED_CONSOLIDATE') {
      const bundle2 = computeDynamicBundle2({
        ...metrics,
        storeFloorWOS: Math.min(metrics.storeFloorWOS, 18.0),
        speedBand: 'MEDIUM_2A',
        campaignMode
      });
      if (bundle2.isBundleApplicable) {
        return {
          tier: LIFECYCLE_TIERS.BUNDLE_2,
          recommendedOffer: bundle2.bundleOfferLabel,
          discountPct: bundle2.discountPct,
          promotionalPriceSAR: bundle2.unitPromoPriceSAR,
          expectedClearancePct: 65,
          rationale: `[Broken Fast-Mover Scenario Winner — WH Release + Gentle Bundle] ${scenarioEval.selectionReason}`,
          zeroLossStatus: 'YES',
          bundleQuantity: bundle2.bundleQuantity,
          bundlePriceSAR: bundle2.bundlePriceSAR,
          sharedRailTag: bundle2.sharedRailTag,
          railCostCeilingSAR: bundle2.railCostCeilingSAR,
          historicalDiscountDepthPct: histDiscountDepthPct,
          speedBand: speedEval.speedBand,
          strVelocityPctPerWeek: speedEval.strVelocityPctPerWeek,
          effectiveTenureWeeks: speedEval.effectiveTenureWeeks,
          campaignMode,
          clearanceScope: 'NONE'
        };
      }
      return {
        tier: LIFECYCLE_TIERS.HERO_CORE,
        recommendedOffer: 'Full Price + WH Replenishment (0% Off)',
        discountPct: 0,
        promotionalPriceSAR: metrics.ticketPrice,
        expectedClearancePct: 60,
        rationale: `[Broken Fast-Mover Scenario Winner — WH Replenishment at Full Price] ${scenarioEval.selectionReason}`,
        zeroLossStatus: 'YES',
        bundleQuantity: 1,
        bundlePriceSAR: metrics.ticketPrice,
        historicalDiscountDepthPct: histDiscountDepthPct,
        speedBand: speedEval.speedBand,
        strVelocityPctPerWeek: speedEval.strVelocityPctPerWeek,
        effectiveTenureWeeks: speedEval.effectiveTenureWeeks,
        campaignMode,
        clearanceScope: 'NONE'
      };
    }

    const brokenReason = metrics.hasCoreSizes === false
      ? 'Non-core / fringe sizes only (core S/M/L/XL depth <1u or missing)'
      : `Broken size curve (${metrics.activeSizeCount} sizes active with >=1 u)`;
    return buildClearanceRecommendation(
      metrics,
      costPlusVat,
      histDiscountDepthPct,
      brokenReason,
      speedEval,
      campaignMode,
      isBigClearanceEvent ? 'EVENT_CLEARANCE' : 'PERMANENT_ODDMENT_RAIL'
    );
  }

  // Tier 3: Past Summer 2026 Exit (SS26 / Ss 26) for healthy-curve styles
  if (compactSeason.includes('SS26') || compactSeason.includes('SUMMER2026')) {
    const rawPromo = Math.round(metrics.ticketPrice * 0.60 * 100) / 100;
    const safePromo = Math.max(costPlusVat, rawPromo);
    const discPct = metrics.ticketPrice > 0 ? Math.round((1 - (safePromo / metrics.ticketPrice)) * 100) : 0;
    if (discPct <= 2) {
      return {
        tier: LIFECYCLE_TIERS.HERO_CORE,
        recommendedOffer: 'Margin-Protected Full Price (0% Off)',
        discountPct: 0,
        promotionalPriceSAR: metrics.ticketPrice,
        expectedClearancePct: 20,
        rationale: `Summer 2026 style near cost + 15% VAT floor (${costPlusVat.toFixed(2)} SAR). Markdown prevented by Zero-Loss Guard.`,
        zeroLossStatus: 'YES',
        bundleQuantity: 1,
        bundlePriceSAR: metrics.ticketPrice,
        historicalDiscountDepthPct: histDiscountDepthPct,
        speedBand: speedEval.speedBand,
        strVelocityPctPerWeek: speedEval.strVelocityPctPerWeek,
        effectiveTenureWeeks: speedEval.effectiveTenureWeeks,
        campaignMode,
        clearanceScope: 'NONE'
      };
    }
    const summerLabel = discPct >= 35
      ? 'Category Markdown 40% Off'
      : `Category Markdown (${discPct}% Safe Floor)`;
    return {
      tier: LIFECYCLE_TIERS.MATURE_SUMMER_EXIT,
      recommendedOffer: summerLabel,
      discountPct: discPct,
      promotionalPriceSAR: safePromo,
      expectedClearancePct: 45,
      rationale: 'Summer 2026 collection exit before cold winter weather sets in Taif and Western Province.',
      zeroLossStatus: 'YES',
      bundleQuantity: 1,
      bundlePriceSAR: safePromo,
      historicalDiscountDepthPct: histDiscountDepthPct,
      speedBand: speedEval.speedBand,
      strVelocityPctPerWeek: speedEval.strVelocityPctPerWeek,
      effectiveTenureWeeks: speedEval.effectiveTenureWeeks,
      campaignMode,
      clearanceScope: isBigClearanceEvent ? 'EVENT_CLEARANCE' : 'PERMANENT_ODDMENT_RAIL'
    };
  }

  // Tier 4/5: Slow Movers, Stale High-STR Tails & Drop-Cycle Overhang (Apparel, excluding 3-wk launch shield)
  const isStagnantDeadStock = !isSingleSize && !isRecentLaunchWindow && metrics.cumulativeSTR < 10.0;
  const isPostDropSlowOrOverhang =
    !isSingleSize &&
    !isRecentLaunchWindow &&
    (
      (speedEval.hasTenureTelemetry && speedEval.effectiveTenureWeeks > DROP_CYCLE_BENCHMARKS.DROP_CADENCE_WEEKS &&
        (metrics.weeklyROS < DROP_CYCLE_BENCHMARKS.MEDIUM_MIN_ROS || metrics.storeFloorWOS > DROP_CYCLE_BENCHMARKS.MEDIUM_MAX_WOS)) ||
      (metrics.storeFloorWOS > 40.0 && metrics.cumulativeSTR < 30.0) ||
      (isBigClearanceEvent && speedEval.speedBand === 'MEDIUM_2B' && metrics.storeFloorWOS > 28.0)
    );

  if (isStagnantDeadStock || isPostDropSlowOrOverhang) {
    const triggerReason = isStagnantDeadStock
      ? `Stagnant turnover (STR ${metrics.cumulativeSTR.toFixed(1)}%)`
      : speedEval.reason;
    return buildClearanceRecommendation(
      metrics,
      costPlusVat,
      histDiscountDepthPct,
      triggerReason,
      speedEval,
      campaignMode,
      isBigClearanceEvent ? 'EVENT_CLEARANCE' : 'PERMANENT_ODDMENT_RAIL'
    );
  }

  // Festive Peak Harvest (Eid / Ramadan): Keep healthy Medium 2A at Full Price instead of discounting peak footfall
  if (isFestiveHarvest && speedEval.speedBand === 'MEDIUM_2A') {
    return {
      tier: LIFECYCLE_TIERS.HERO_CORE,
      recommendedOffer: 'Full Price Festive Harvest (0% Off + Gift Add-On >= 300 SAR)',
      discountPct: 0,
      promotionalPriceSAR: metrics.ticketPrice,
      expectedClearancePct: 28,
      rationale: `${speedEval.reason} During peak festive trading (${campaignMode}), healthy medium-turn apparel holds full price to maximize net profit.`,
      zeroLossStatus: 'YES',
      bundleQuantity: 1,
      bundlePriceSAR: metrics.ticketPrice,
      historicalDiscountDepthPct: histDiscountDepthPct,
      speedBand: speedEval.speedBand,
      strVelocityPctPerWeek: speedEval.strVelocityPctPerWeek,
      effectiveTenureWeeks: speedEval.effectiveTenureWeeks,
      campaignMode,
      clearanceScope: 'NONE'
    };
  }

  // Tier 2A / 2B: Medium Movers ("Not Fast, Not Slow") — Margin-Smart Bundle 2 (Pairs)
  if (!isSingleSize && hasHealthyCoreCurve) {
    const bundle2 = computeDynamicBundle2({
      ...metrics,
      effectiveTenureWeeks: speedEval.effectiveTenureWeeks,
      speedBand: speedEval.speedBand,
      campaignMode
    });
    if (bundle2.isBundleApplicable) {
      const stagePrefix = speedEval.speedBand === 'MEDIUM_2B'
        ? '[Tier 2B Pre-Drop Escalation] '
        : (speedEval.speedBand === 'MEDIUM_2A' ? '[Tier 2A Gentle Lift] ' : '');
      return {
        tier: LIFECYCLE_TIERS.BUNDLE_2,
        recommendedOffer: bundle2.bundleOfferLabel,
        discountPct: bundle2.discountPct,
        promotionalPriceSAR: bundle2.unitPromoPriceSAR,
        expectedClearancePct: bundle2.expectedClearancePct,
        rationale: `${stagePrefix}${bundle2.rationale}`,
        zeroLossStatus: 'YES',
        bundleQuantity: bundle2.bundleQuantity,
        bundlePriceSAR: bundle2.bundlePriceSAR,
        sharedRailTag: bundle2.sharedRailTag,
        railCostCeilingSAR: bundle2.railCostCeilingSAR,
        historicalDiscountDepthPct: histDiscountDepthPct,
        speedBand: speedEval.speedBand,
        strVelocityPctPerWeek: speedEval.strVelocityPctPerWeek,
        effectiveTenureWeeks: speedEval.effectiveTenureWeeks,
        campaignMode,
        clearanceScope: 'NONE'
      };
    }
  }

  // Fallback Steady Active (Spend & Save Multi-pack Driver / Impulse Add-On)
  const rawSpendSave = Math.round(metrics.ticketPrice * 0.80 * 100) / 100;
  const spendSavePrice = Math.max(costPlusVat, rawSpendSave);
  const discPct = metrics.ticketPrice > 0 ? Math.round((1 - (spendSavePrice / metrics.ticketPrice)) * 100) : 0;

  const isMicroTicket = metrics.ticketPrice <= 15.0;
  const offerLabel = discPct <= 2
    ? 'Full Price Margin Protection (0% Off)'
    : isMicroTicket
      ? `Impulse Checkout Add-On (${discPct}% Off: ${spendSavePrice.toFixed(2)} SAR)`
      : (discPct >= 15 ? 'Spend & Save Eligible (~20% Off)' : `Margin-Protected Promo (${discPct}% Off)`);
  const rationaleText = isMicroTicket
    ? 'Micro-ticket impulse accessory. Deployed at point-of-sale checkout to drive units per transaction (UPT) above cost floor.'
    : isRecentLaunchWindow
      ? `New collection arrival (${weeksSinceFirstArrival.toFixed(1)} wks on floor) with full core S/M/L/XL depth; protected from premature clearance.`
      : 'Core continuity basic pack. Basket driver preserves healthy floor turn without heavy liquidation.';

  return {
    tier: discPct <= 2 ? LIFECYCLE_TIERS.HERO_CORE : LIFECYCLE_TIERS.STEADY_ACTIVE,
    recommendedOffer: offerLabel,
    discountPct: discPct,
    promotionalPriceSAR: spendSavePrice,
    expectedClearancePct: discPct <= 2 ? 20 : 25,
    rationale: rationaleText,
    zeroLossStatus: 'YES',
    bundleQuantity: 1,
    bundlePriceSAR: spendSavePrice,
    historicalDiscountDepthPct: histDiscountDepthPct,
    speedBand: speedEval.speedBand,
    strVelocityPctPerWeek: speedEval.strVelocityPctPerWeek,
    effectiveTenureWeeks: speedEval.effectiveTenureWeeks,
    campaignMode,
    clearanceScope: 'NONE'
  };
}

function buildClearanceRecommendation(
  metrics: StyleMetrics,
  costPlusVat: number,
  histDiscountDepthPct: number,
  triggerReason: string,
  speedEval?: ReturnType<typeof evaluateSpeedAndHeroQualification>,
  campaignMode: CampaignMode = 'REGULAR_DROP_CYCLE',
  clearanceScope: 'PERMANENT_ODDMENT_RAIL' | 'EVENT_CLEARANCE' = 'PERMANENT_ODDMENT_RAIL'
): RecommendationResult {
  const scopePrefix = clearanceScope === 'EVENT_CLEARANCE'
    ? '[Event Clearance] '
    : '[Permanent Clearance Rail] ';

  if (metrics.ticketPrice <= 40.0) {
    const halfPrice = Math.round(metrics.ticketPrice * 0.50 * 100) / 100;
    const safePromo = Math.max(costPlusVat, halfPrice);
    const discPct = metrics.ticketPrice > 0 ? Math.round((1 - (safePromo / metrics.ticketPrice)) * 100) : 0;
    if (discPct <= 2) {
      return {
        tier: LIFECYCLE_TIERS.CLEARANCE_PERCENT_SAFE,
        recommendedOffer: 'Margin-Protected Full Price (0% Off)',
        discountPct: 0,
        promotionalPriceSAR: metrics.ticketPrice,
        expectedClearancePct: 20,
        rationale: `${scopePrefix}${triggerReason}. Ticket (${metrics.ticketPrice.toFixed(2)} SAR) is near 15% VAT floor (${costPlusVat.toFixed(2)} SAR); full price retained.`,
        zeroLossStatus: 'YES',
        bundleQuantity: 1,
        bundlePriceSAR: metrics.ticketPrice,
        historicalDiscountDepthPct: histDiscountDepthPct,
        speedBand: speedEval?.speedBand,
        strVelocityPctPerWeek: speedEval?.strVelocityPctPerWeek,
        effectiveTenureWeeks: speedEval?.effectiveTenureWeeks,
        campaignMode,
        clearanceScope
      };
    }
    const label = discPct >= 45
      ? '50% Off Dedicated Clearance Rail'
      : `Clearance Rail (${discPct}% Safe Floor)`;
    return {
      tier: discPct >= 45 ? LIFECYCLE_TIERS.CLEARANCE_50_PCT : LIFECYCLE_TIERS.CLEARANCE_PERCENT_SAFE,
      recommendedOffer: label,
      discountPct: discPct,
      promotionalPriceSAR: safePromo,
      expectedClearancePct: 50,
      rationale: `${scopePrefix}${triggerReason}. ${discPct}% clearance markdown liquidates floor space above ${costPlusVat.toFixed(2)} SAR cost floor.`,
      zeroLossStatus: 'YES',
      bundleQuantity: 1,
      bundlePriceSAR: safePromo,
      historicalDiscountDepthPct: histDiscountDepthPct,
      speedBand: speedEval?.speedBand,
      strVelocityPctPerWeek: speedEval?.strVelocityPctPerWeek,
      effectiveTenureWeeks: speedEval?.effectiveTenureWeeks,
      campaignMode,
      clearanceScope
    };
  }

  const bundleUnit = 33.00;
  if (bundleUnit >= costPlusVat) {
    const discPct = metrics.ticketPrice > 0 ? Math.round((1 - (bundleUnit / metrics.ticketPrice)) * 100) : 0;
    return {
      tier: LIFECYCLE_TIERS.CLEARANCE_3_FOR_99,
      recommendedOffer: 'Take 3 For 99 SAR Rail (33 SAR/u)',
      discountPct: discPct,
      promotionalPriceSAR: bundleUnit,
      expectedClearancePct: 55,
      rationale: `${scopePrefix}${triggerReason}. 33 SAR bundle recovers working capital safely above ${costPlusVat.toFixed(2)} SAR floor.`,
      zeroLossStatus: 'YES',
      bundleQuantity: 3,
      bundlePriceSAR: 99.00,
      sharedRailTag: generateSharedRailTag(99, 3),
      railCostCeilingSAR: calculateRailCostCeiling(99, 3),
      historicalDiscountDepthPct: histDiscountDepthPct,
      speedBand: speedEval?.speedBand,
      strVelocityPctPerWeek: speedEval?.strVelocityPctPerWeek,
      effectiveTenureWeeks: speedEval?.effectiveTenureWeeks,
      campaignMode,
      clearanceScope
    };
  }

  const safePrice = Math.max(costPlusVat, Math.round(metrics.ticketPrice * 0.60 * 100) / 100);
  const discPct = metrics.ticketPrice > 0 ? Math.round((1 - (safePrice / metrics.ticketPrice)) * 100) : 0;
  const offerLabel = discPct <= 2
    ? 'Margin-Protected Full Price (0% Off)'
    : (discPct === 40 ? 'Clearance Rail (Safe Floor)' : `Clearance Rail (${discPct}% Safe Floor)`);
  return {
    tier: LIFECYCLE_TIERS.CLEARANCE_PERCENT_SAFE,
    recommendedOffer: offerLabel,
    discountPct: discPct,
    promotionalPriceSAR: safePrice,
    expectedClearancePct: 40,
    rationale: `${scopePrefix}${triggerReason}. Liquidates fragmented inventory at ${discPct}% off (${safePrice.toFixed(2)} SAR) while adhering strictly to landed cost + VAT floor (${costPlusVat.toFixed(2)} SAR).`,
    zeroLossStatus: 'YES',
    bundleQuantity: 1,
    bundlePriceSAR: safePrice,
    historicalDiscountDepthPct: histDiscountDepthPct,
    speedBand: speedEval?.speedBand,
    strVelocityPctPerWeek: speedEval?.strVelocityPctPerWeek,
    effectiveTenureWeeks: speedEval?.effectiveTenureWeeks,
    campaignMode,
    clearanceScope
  };
}
