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

  return {
    isBundleApplicable: true,
    bundleOfferLabel: offerLabel,
    bundleQuantity: 2,
    bundlePriceSAR: charmBundlePrice,
    unitPromoPriceSAR: unitPromoPrice,
    discountPct: realizedDiscountPct,
    savingsAmountSAR: savingsSAR,
    expectedClearancePct: expectedClearance,
    rationale: `Dynamic 2-pack bundle calibrated to performance (WOS ${metrics.storeFloorWOS.toFixed(1)} wks, STR ${metrics.cumulativeSTR.toFixed(1)}%). Drives 2.0 UPT at ${charmBundlePrice} SAR commercial charm point.`
  };
}
