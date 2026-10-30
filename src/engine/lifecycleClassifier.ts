import { calculateZeroLossFloor } from './metricsCalculator';
import { LIFECYCLE_TIERS } from '../config/constants';
import { computeDynamicBundle2 } from './dynamicOfferEngine';

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
  isSingleSize?: boolean;
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
}

/**
 * 7-Tier Style Judgement Engine & Dynamic Offer Classifier
 * Evaluates Velocity (ROS), Lifecycle (STR%), Runway (WOS), Curve (SAR), Category, and Seasonality.
 * Dynamically computes "Bundle 2" pairs for healthy apparel curves and dedicated clearance for broken curves.
 */
export function classifyStyleAndRecommend(metrics: StyleMetrics): RecommendationResult {
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
      bundlePriceSAR: metrics.ticketPrice
    };
  }

  // Guard 1: Fresh Winter 2026 arrivals entering peak seasonal demand
  const seasonUpper = (metrics.season || '').toUpperCase();
  if (seasonUpper.includes('AW26') || seasonUpper.includes('WINTER 2026')) {
    return {
      tier: LIFECYCLE_TIERS.FRESH_WINTER,
      recommendedOffer: '100% Full Ticket Price (0% Off)',
      discountPct: 0,
      promotionalPriceSAR: metrics.ticketPrice,
      expectedClearancePct: 15,
      rationale: 'Fresh Winter 2026 arrival entering peak weather window. Strictly protected at full price.',
      zeroLossStatus: 'YES',
      bundleQuantity: 1,
      bundlePriceSAR: metrics.ticketPrice
    };
  }

  // Single-Size / Non-Sized Category Detection (Cosmetics, Fragrances, Towels, Accessories)
  const isSingleSize = metrics.isSingleSize ?? (
    /cosmetics|towel|scarf|pillow|duvet|sheets|bandana|eye cover|sleeves|bundle/i.test(metrics.category) ||
    /\b(\d+ml|free size|one size|os)\b/i.test(metrics.productName)
  );

  // Single-Size / Beauty Promotional Mechanics
  if (isSingleSize) {
    if (metrics.cumulativeSTR >= 50.0 || metrics.weeklyROS >= 4.0) {
      return {
        tier: LIFECYCLE_TIERS.HERO_CORE,
        recommendedOffer: 'Full Price Margin Protection (0% Off)',
        discountPct: 0,
        promotionalPriceSAR: metrics.ticketPrice,
        expectedClearancePct: 25,
        rationale: 'Core single-size product with healthy sell-through. Organic demand protects full ticket margin.',
        zeroLossStatus: 'YES',
        bundleQuantity: 1,
        bundlePriceSAR: metrics.ticketPrice
      };
    }

    if (metrics.totalPhysicalStock > 100) {
      const promoPrice = Math.max(costPlusVat, Math.round(metrics.ticketPrice * 0.80 * 100) / 100);
      const discPct = metrics.ticketPrice > 0 ? Math.round((1 - (promoPrice / metrics.ticketPrice)) * 100) : 0;
      return {
        tier: LIFECYCLE_TIERS.VOLUME_MULTI_BUY,
        recommendedOffer: 'Spend 250 Save 50 (Basket Pack)',
        discountPct: discPct,
        promotionalPriceSAR: promoPrice,
        expectedClearancePct: 40,
        rationale: 'High-margin non-sized cosmetic/accessory. Deployed as transaction basket booster rather than clearance rail.',
        zeroLossStatus: 'YES',
        bundleQuantity: 1,
        bundlePriceSAR: promoPrice
      };
    } else {
      const promoPrice = Math.max(costPlusVat, Math.round(metrics.ticketPrice * 0.67 * 100) / 100);
      const discPct = metrics.ticketPrice > 0 ? Math.round((1 - (promoPrice / metrics.ticketPrice)) * 100) : 0;
      return {
        tier: LIFECYCLE_TIERS.VOLUME_MULTI_BUY,
        recommendedOffer: 'Beauty Multi-Buy (Buy 2 Get 1 Free)',
        discountPct: discPct,
        promotionalPriceSAR: promoPrice,
        expectedClearancePct: 45,
        rationale: 'Single-size beauty item. Multi-buy incentive drives transaction volume without single-unit oddment dumping.',
        zeroLossStatus: 'YES',
        bundleQuantity: 3,
        bundlePriceSAR: Math.round(metrics.ticketPrice * 2 * 100) / 100
      };
    }
  }

  // Tier 1: Hero Core Category Captains (STR >= 70% with healthy unbroken curve)
  if (metrics.cumulativeSTR >= 70.0 && metrics.activeSizeCount >= 3) {
    return {
      tier: LIFECYCLE_TIERS.HERO_CORE,
      recommendedOffer: 'Full Price Margin Protection (0% Off)',
      discountPct: 0,
      promotionalPriceSAR: metrics.ticketPrice,
      expectedClearancePct: 20,
      rationale: `Proven category captain (STR ${metrics.cumulativeSTR.toFixed(1)}%). Organic customer demand is self-sustaining.`,
      zeroLossStatus: 'YES',
      bundleQuantity: 1,
      bundlePriceSAR: metrics.ticketPrice
    };
  }

  // Tier 3: Past Summer 2026 Exit (SS26)
  if (seasonUpper.includes('SS26') || seasonUpper.includes('SUMMER 2026')) {
    const rawPromo = Math.round(metrics.ticketPrice * 0.60 * 100) / 100;
    const safePromo = Math.max(costPlusVat, rawPromo);
    const discPct = metrics.ticketPrice > 0 ? Math.round((1 - (safePromo / metrics.ticketPrice)) * 100) : 0;
    return {
      tier: LIFECYCLE_TIERS.MATURE_SUMMER_EXIT,
      recommendedOffer: 'Category Markdown 40% Off',
      discountPct: discPct,
      promotionalPriceSAR: safePromo,
      expectedClearancePct: 45,
      rationale: 'Summer 2026 collection exit before cold winter weather sets in Taif and Western Province.',
      zeroLossStatus: 'YES',
      bundleQuantity: 1,
      bundlePriceSAR: safePromo
    };
  }

  // Tier 4/5: Slow Moving, Broken Curve, or Zombie Stock (Apparel Only)
  const isBrokenCurve = !isSingleSize && metrics.activeSizeCount <= 2;
  const isStagnantDeadStock = !isSingleSize && metrics.cumulativeSTR < 10.0;
  const isOverhangRunway = !isSingleSize && metrics.storeFloorWOS > 40.0 && metrics.cumulativeSTR < 30.0;

  if (isBrokenCurve || isStagnantDeadStock || isOverhangRunway) {
    const triggerReason = isBrokenCurve 
      ? `Broken size curve (${metrics.activeSizeCount} sizes active)`
      : (isStagnantDeadStock 
          ? `Stagnant turnover (STR ${metrics.cumulativeSTR.toFixed(1)}%)`
          : `Floor runway overhang (WOS ${metrics.storeFloorWOS.toFixed(1)} wks)`);
    // If ticket price is <= 40 SAR, bundle rail gives negligible discount; route to 50% Off
    if (metrics.ticketPrice <= 40.0) {
      const halfPrice = Math.round(metrics.ticketPrice * 0.50 * 100) / 100;
      const safePromo = Math.max(costPlusVat, halfPrice);
      const discPct = metrics.ticketPrice > 0 ? Math.round((1 - (safePromo / metrics.ticketPrice)) * 100) : 0;
      return {
        tier: LIFECYCLE_TIERS.CLEARANCE_50_PCT,
        recommendedOffer: '50% Off Dedicated Clearance Rail',
        discountPct: discPct,
        promotionalPriceSAR: safePromo,
        expectedClearancePct: 50,
        rationale: `${triggerReason}. 50% discount liquidates floor space above cost floor.`,
        zeroLossStatus: 'YES',
        bundleQuantity: 1,
        bundlePriceSAR: safePromo
      };
    } else {
      // 3 for 99 SAR Rail (33 SAR/unit)
      const bundleUnit = 33.00;
      if (bundleUnit >= costPlusVat) {
        const discPct = metrics.ticketPrice > 0 ? Math.round((1 - (bundleUnit / metrics.ticketPrice)) * 100) : 0;
        return {
          tier: LIFECYCLE_TIERS.CLEARANCE_3_FOR_99,
          recommendedOffer: 'Take 3 For 99 SAR Rail (33 SAR/u)',
          discountPct: discPct,
          promotionalPriceSAR: bundleUnit,
          expectedClearancePct: 55,
          rationale: `${triggerReason}. 33 SAR bundle recovers working capital safely above ${costPlusVat.toFixed(2)} SAR floor.`,
          zeroLossStatus: 'YES',
          bundleQuantity: 3,
          bundlePriceSAR: 99.00
        };
      } else {
        // Fallback for higher-cost items to safe clearance price
        const safePrice = Math.max(costPlusVat, Math.round(metrics.ticketPrice * 0.60 * 100) / 100);
        const discPct = metrics.ticketPrice > 0 ? Math.round((1 - (safePrice / metrics.ticketPrice)) * 100) : 0;
        return {
          tier: LIFECYCLE_TIERS.CLEARANCE_PERCENT_SAFE,
          recommendedOffer: 'Clearance Rail (Safe Floor)',
          discountPct: discPct,
          promotionalPriceSAR: safePrice,
          expectedClearancePct: 40,
          rationale: `${triggerReason}. Liquidates aged inventory while adhering strictly to landed cost + VAT floor.`,
          zeroLossStatus: 'YES',
          bundleQuantity: 1,
          bundlePriceSAR: safePrice
        };
      }
    }
  }

  // Tier 2: Dynamic "Bundle 2" (Pairs) for Healthy Apparel Curves
  if (!isSingleSize && metrics.activeSizeCount >= 3) {
    const bundle2 = computeDynamicBundle2(metrics);
    if (bundle2.isBundleApplicable) {
      return {
        tier: LIFECYCLE_TIERS.BUNDLE_2,
        recommendedOffer: bundle2.bundleOfferLabel,
        discountPct: bundle2.discountPct,
        promotionalPriceSAR: bundle2.unitPromoPriceSAR,
        expectedClearancePct: bundle2.expectedClearancePct,
        rationale: bundle2.rationale,
        zeroLossStatus: 'YES',
        bundleQuantity: bundle2.bundleQuantity,
        bundlePriceSAR: bundle2.bundlePriceSAR
      };
    }
  }

  // Fallback Steady Active (Spend & Save Multi-pack Driver)
  const rawSpendSave = Math.round(metrics.ticketPrice * 0.80 * 100) / 100;
  const spendSavePrice = Math.max(costPlusVat, rawSpendSave);
  const discPct = metrics.ticketPrice > 0 ? Math.round((1 - (spendSavePrice / metrics.ticketPrice)) * 100) : 0;

  return {
    tier: LIFECYCLE_TIERS.STEADY_ACTIVE,
    recommendedOffer: 'Spend & Save Eligible (~20% Off)',
    discountPct: discPct,
    promotionalPriceSAR: spendSavePrice,
    expectedClearancePct: 25,
    rationale: 'Core continuity basic pack. Basket driver protects 75%+ stock for December/January peak winter trading.',
    zeroLossStatus: 'YES',
    bundleQuantity: 1,
    bundlePriceSAR: spendSavePrice
  };
}
