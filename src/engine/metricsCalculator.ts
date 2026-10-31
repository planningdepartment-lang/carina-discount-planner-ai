import { SAUDI_VAT_RATE } from '../config/constants';

/**
 * Computes the legal zero-loss floor in Saudi Arabia (inclusive of 15% VAT).
 * @param landedCostSAR - Landed unit cost in Saudi Riyals
 * @returns Minimum legal selling price in SAR (rounded to 2 decimal places)
 */
export function calculateZeroLossFloor(landedCostSAR: number): number {
  if (landedCostSAR <= 0) return 0;
  return Math.round(landedCostSAR * (1 + SAUDI_VAT_RATE) * 100) / 100;
}

/**
 * Computes maximum safe discount before selling below Cost + 15% VAT.
 * @param ticketPriceSAR - Original list price inclusive of VAT
 * @param landedCostSAR - Unit landed cost
 * @returns Max allowable discount percentage (0 to 100)
 */
export function calculateMaxSafeDiscountPct(ticketPriceSAR: number, landedCostSAR: number): number {
  if (ticketPriceSAR <= 0 || landedCostSAR <= 0) return 0;
  const costPlusVat = calculateZeroLossFloor(landedCostSAR);
  if (costPlusVat >= ticketPriceSAR) return 0; // Margin is already negative or zero at list price
  const maxDiscount = ((ticketPriceSAR - costPlusVat) / ticketPriceSAR) * 100;
  return Math.max(0, Math.round(maxDiscount * 10) / 10);
}

/**
 * Hard Zero-Loss Guard Validator
 * Clamps or rejects any proposed promotional price below Cost + VAT.
 */
export function enforceZeroLossGuard(
  proposedPromoPrice: number,
  landedCostSAR: number
): { compliant: boolean; safePrice: number; violationAmount: number } {
  const floor = calculateZeroLossFloor(landedCostSAR);
  if (proposedPromoPrice < (floor - 0.01)) { // 1 cent safety tolerance for floating point
    return {
      compliant: false,
      safePrice: floor,
      violationAmount: Math.round((floor - proposedPromoPrice) * 100) / 100
    };
  }
  return {
    compliant: true,
    safePrice: proposedPromoPrice,
    violationAmount: 0
  };
}

/**
 * Rolling Rate of Sale (Weekly Velocity)
 * Filters out single-day transaction anomalies by averaging over active floor weeks (up to 8 weeks).
 * If actualActiveWeeks is provided (e.g. style arrived 3 weeks ago), divides by actual active weeks
 * to prevent unfairly depressing fresh arrival velocity.
 */
export function calculateWeeklyROS(unitsSold: number, lookbackWeeks = 8.0, actualActiveWeeks?: number): number {
  if (unitsSold <= 0) return 0.0;
  const effectiveWeeks = actualActiveWeeks !== undefined && actualActiveWeeks > 0
    ? Math.min(lookbackWeeks, Math.max(1.0, actualActiveWeeks))
    : lookbackWeeks;
  if (effectiveWeeks <= 0) return 0.0;
  return Math.round((unitsSold / effectiveWeeks) * 10) / 10;
}

export interface VelocityMomentumResult {
  momentumRatio: number;
  momentumLabel: string;
  trendDirection: 'ACCELERATING' | 'DECELERATING' | 'STABLE';
  percentageChange: number;
}

/**
 * Calculates Velocity Momentum Ratio: short-term pulse (ROS 2wk) vs baseline (ROS 8wk / active weeks).
 * Momentum Ratio = ROS_2wk / ROS_baseline
 * - >= 1.25: Accelerating (e.g. +35%)
 * - <= 0.75: Decelerating (e.g. -40%)
 * - In-between: Stable
 */
export function calculateVelocityMomentum(ros2wk: number, rosBaseline: number): VelocityMomentumResult {
  if (rosBaseline <= 0) {
    if (ros2wk > 0) {
      return {
        momentumRatio: 2.0,
        momentumLabel: 'Surging (New Demand)',
        trendDirection: 'ACCELERATING',
        percentageChange: 100
      };
    }
    return {
      momentumRatio: 1.0,
      momentumLabel: 'Stable (0%)',
      trendDirection: 'STABLE',
      percentageChange: 0
    };
  }

  const ratio = Math.round((ros2wk / rosBaseline) * 100) / 100;
  const pctChange = Math.round(((ros2wk - rosBaseline) / rosBaseline) * 100);

  if (ratio >= 1.25) {
    return {
      momentumRatio: ratio,
      momentumLabel: `Accelerating (+${pctChange}%)`,
      trendDirection: 'ACCELERATING',
      percentageChange: pctChange
    };
  } else if (ratio <= 0.75) {
    return {
      momentumRatio: ratio,
      momentumLabel: `Decelerating (${pctChange}%)`,
      trendDirection: 'DECELERATING',
      percentageChange: pctChange
    };
  } else {
    return {
      momentumRatio: ratio,
      momentumLabel: `Stable (${pctChange >= 0 ? '+' : ''}${pctChange}%)`,
      trendDirection: 'STABLE',
      percentageChange: pctChange
    };
  }
}

/**
 * Cumulative Lifetime Sell-Through Rate (STR %)
 * Standard NRF formula: Sold / (On-Hand Stock + Sold) * 100
 */
export function calculateCumulativeSTR(lifetimeSold: number, currentPhysicalStock: number): number {
  const totalReceived = lifetimeSold + currentPhysicalStock;
  if (totalReceived <= 0) return 0.0;
  return Math.round((lifetimeSold / totalReceived) * 1000) / 10;
}

/**
 * Store Floor Weeks of Supply (WOS)
 * Only evaluates units sitting on physical store sales floors (Andalus, Yasmeen, Jouri).
 * Central DC (WH/Stock) is excluded from floor WOS calculation.
 */
export function calculateStoreFloorWOS(
  stockAndalus: number,
  stockYasmeen: number,
  stockJouri: number,
  weeklyROS: number
): number {
  const floorStock = stockAndalus + stockYasmeen + stockJouri;
  if (weeklyROS <= 0) return 999.0; // Infinite runway / Stagnant
  return Math.round((floorStock / weeklyROS) * 10) / 10;
}

/**
 * Size Availability Ratio (SAR) & Curve Health Classifier
 * Evaluates core demand sizes (e.g. S, M, L, XL) vs broken fringe orphans.
 */
export function classifyCurveHealth(activeSizesWithStockGE2: number): {
  isHealthy: boolean;
  label: 'Healthy Curve (>=3 Sizes)' | 'Broken Curve (<=2 Sizes)';
} {
  const isHealthy = activeSizesWithStockGE2 >= 3;
  return {
    isHealthy,
    label: isHealthy ? 'Healthy Curve (>=3 Sizes)' : 'Broken Curve (<=2 Sizes)'
  };
}
