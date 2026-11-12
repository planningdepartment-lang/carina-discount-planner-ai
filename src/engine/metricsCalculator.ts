import { SAUDI_VAT_RATE, DROP_CYCLE_BENCHMARKS } from '../config/constants';

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

const STANDARD_LETTER_SIZES = new Set(['XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', 'XXXL', '4XL']);
const CORE_LETTER_SIZES = new Set(['S', 'M', 'L', 'XL']);
const BELLY_LETTER_SIZES = new Set(['M', 'L']);
const SINGLE_SIZE_TOKENS = new Set(['OS', 'ONE SIZE', 'ONESIZE', 'FREE', 'FREE SIZE', 'FREESIZE', 'STD', 'STANDARD', '12CM']);

const DUAL_LETTER_EXPANSION: Record<string, string[]> = {
  'SM': ['S', 'M'],
  'S/M': ['S', 'M'],
  'S-M': ['S', 'M'],
  'LXL': ['L', 'XL'],
  'L/XL': ['L', 'XL'],
  'L-XL': ['L', 'XL'],
  'ML': ['M', 'L'],
  'M/L': ['M', 'L'],
  'M-L': ['M', 'L'],
  'XS-S': ['XS', 'S'],
  'XS/S': ['XS', 'S'],
  'XSS': ['XS', 'S'],
  'XL-2X': ['XL', '2XL'],
  'XL/2X': ['XL', '2XL'],
  'XL2X': ['XL', '2XL'],
  'X2X': ['XL', '2XL'],
  'XL-2XL': ['XL', '2XL'],
  '23X': ['2XL', '3XL'],
  '2X3X': ['2XL', '3XL'],
  '2XL-3XL': ['2XL', '3XL'],
  '2XL/3XL': ['2XL', '3XL'],
};

function normalizeSizeToken(rawSize: string): string {
  const token = rawSize.trim().toUpperCase();
  if (token === 'XXL') return '2XL';
  if (token === 'XXXL') return '3XL';
  return token;
}

function isMultiSizeApparelToken(rawSize: string): boolean {
  const token = normalizeSizeToken(rawSize);
  if (SINGLE_SIZE_TOKENS.has(token) || /^\d+(\.\d+)?\s*(ML|GM|G|CM)$/.test(token) || token === '38-41') {
    return false;
  }
  return (
    STANDARD_LETTER_SIZES.has(token) ||
    Boolean(DUAL_LETTER_EXPANSION[token]) ||
    /^\d{2,3}[A-E]{1,2}$/.test(token) ||          // Bras e.g. 75B, 85C
    /^(?:[1-9]|1[0-6])-(?:[2-9]|1[0-8])$/.test(token) || // Kids e.g. 4-6, 10-12 (excludes 38-41)
    /^\d{2}$/.test(token)                         // EU numeric e.g. 32, 34, 36
  );
}

export type CurveHealthLabel =
  | 'Single Size (Complete)'
  | 'Healthy Curve (>=3 Sizes)'
  | 'Broken Curve (<=2 Sizes)'
  | 'Broken Curve (Non-Core Sizes)';

/**
 * Single source of truth for single-size assortment detection (cosmetics, towels, accessories, one-size).
 * Respects multi-size apparel evidence (e.g. multi-size Neck Covers or Sport Bundles remain size-curve tracked).
 */
export function detectSingleSizeAssortment(
  category: string,
  productName: string,
  isSingleSizeFlag?: boolean,
  sizeQuantities?: Record<string, number>,
  everSizes?: string[]
): boolean {
  if (isSingleSizeFlag === true) return true;

  const trimmedCategory = (category || '').trim();
  const trimmedName = (productName || '').trim();

  const positiveSizes = sizeQuantities
    ? Object.entries(sizeQuantities)
        .filter(([, qty]) => (Number(qty) || 0) > 0)
        .map(([sz]) => normalizeSizeToken(sz))
    : [];

  const allKnownSizes = new Set<string>(positiveSizes);
  if (everSizes) {
    for (const s of everSizes) allKnownSizes.add(normalizeSizeToken(s));
  }

  const apparelSizesCount = Array.from(allKnownSizes).filter(isMultiSizeApparelToken).length;
  if (apparelSizesCount >= 2) {
    return false;
  }

  if (positiveSizes.length > 0 && positiveSizes.every(sz =>
    SINGLE_SIZE_TOKENS.has(sz) ||
    /^\d+(\.\d+)?\s*(ML|GM|G|CM)$/.test(sz) ||
    (sz === '38-41' && apparelSizesCount === 0)
  )) {
    return true;
  }

  if (isSingleSizeFlag === false && positiveSizes.length === 0) {
    return false;
  }

  return (
    /cosmetics|towel|scarf|head\s*scarf|pillow|duvet|sheets|bandana|eye cover|sleeves|head\s*band|puncho|poncho|prayer|abaya|socks|bundle/i.test(trimmedCategory) ||
    /\b(\d+\s*ml|\d+\s*gm|free size|one size|os)\b|towel|diffuser|scrub|pillowcase|poncho|puncho|prayer|head\s*band|abaya|stripes\s*robe/i.test(trimmedName)
  );
}

/**
 * Size Availability Ratio (SAR) & Curve Health Classifier
 * Evaluates live active size depth (>=1 unit per size) and strict core size coverage (S, M, L, XL).
 */
export function classifyCurveHealth(
  activeSizesWithStockGE1: number,
  hasCoreSizes: boolean = true
): {
  isHealthy: boolean;
  label: Exclude<CurveHealthLabel, 'Single Size (Complete)'>;
} {
  const isHealthy = activeSizesWithStockGE1 >= 3 && hasCoreSizes;
  const label = !hasCoreSizes
    ? 'Broken Curve (Non-Core Sizes)'
    : (activeSizesWithStockGE1 >= 3 ? 'Healthy Curve (>=3 Sizes)' : 'Broken Curve (<=2 Sizes)');
  return { isHealthy, label };
}

/**
 * Computes consistent SAR curve health label across DB persistence, exports, and Copilot.
 */
export function formatCurveHealthLabel(params: {
  category: string;
  productName: string;
  activeSizeCount: number;
  isSingleSize?: boolean;
  hasCoreSizes?: boolean;
  sizeQuantities?: Record<string, number>;
  everSizes?: string[];
}): CurveHealthLabel {
  if (detectSingleSizeAssortment(params.category, params.productName, params.isSingleSize, params.sizeQuantities, params.everSizes)) {
    return 'Single Size (Complete)';
  }
  return classifyCurveHealth(params.activeSizeCount, params.hasCoreSizes !== false).label;
}

/**
 * Evaluates live per-size inventory quantities for size curve depth (>=1 unit per size) and strict S/M/L/XL core coverage.
 * Expands dual-letter garment tokens (SM, LXL, ML, 23X, XL-2X, XS-S) into their underlying letter sizes.
 * Genuine M-3XL / M-2XL styles (verified via everSizes showing S never existed in Odoo) require M, L, XL, and >=1 plus size >= 1 unit.
 * Non-letter scales (bras 75B-95D, kids 4-6..14-16, EU numeric) are evaluated on >=3 sizes with >=1 unit each.
 */
export function evaluateSizeStockHealth(
  sizeQuantities: Record<string, number>,
  everSizes?: string[]
): {
  activeSizesGE1: number;
  activeSizesGT0: number;
  isLetterSized: boolean;
  coreSizesGE1: number;
  bellySizesGE1: number;
  hasCoreSizes: boolean;
  isHealthy: boolean;
  label: Exclude<CurveHealthLabel, 'Single Size (Complete)'>;
} {
  let rawActiveSizesGE1 = 0;
  let activeSizesGT0 = 0;
  let isLetterSized = false;
  let hasDualLetter = false;

  const coveredLogicalGE1 = new Set<string>();
  const everLogical = new Set<string>();

  if (everSizes) {
    for (const raw of everSizes) {
      const token = normalizeSizeToken(raw);
      if (DUAL_LETTER_EXPANSION[token]) {
        DUAL_LETTER_EXPANSION[token].forEach(sz => everLogical.add(sz));
      } else {
        everLogical.add(token);
      }
    }
  }

  for (const [rawSize, rawQty] of Object.entries(sizeQuantities)) {
    const sizeCode = normalizeSizeToken(rawSize);
    const qty = Number(rawQty) || 0;
    const dualExpanded = DUAL_LETTER_EXPANSION[sizeCode];

    if (STANDARD_LETTER_SIZES.has(sizeCode) || dualExpanded) {
      isLetterSized = true;
      if (dualExpanded) hasDualLetter = true;
    }

    if (qty > 0) activeSizesGT0++;
    if (qty >= 1) {
      rawActiveSizesGE1++;
      if (dualExpanded) {
        dualExpanded.forEach(sz => coveredLogicalGE1.add(sz));
      } else {
        coveredLogicalGE1.add(sizeCode);
      }
    }
  }

  let coreSizesGE1 = 0;
  let bellySizesGE1 = 0;
  for (const sz of coveredLogicalGE1) {
    if (CORE_LETTER_SIZES.has(sz)) coreSizesGE1++;
    if (BELLY_LETTER_SIZES.has(sz)) bellySizesGE1++;
  }

  const isVerifiedMTo3XLCurve =
    Boolean(everSizes && everSizes.length > 0) &&
    !everLogical.has('S') &&
    coveredLogicalGE1.has('M') &&
    coveredLogicalGE1.has('L') &&
    coveredLogicalGE1.has('XL') &&
    (coveredLogicalGE1.has('2XL') || coveredLogicalGE1.has('3XL'));

  const hasCoreSizes = !isLetterSized || coreSizesGE1 === 4 || isVerifiedMTo3XLCurve;

  const activeSizesGE1 = hasDualLetter
    ? Math.max(rawActiveSizesGE1, coveredLogicalGE1.size)
    : rawActiveSizesGE1;

  const { isHealthy, label } = classifyCurveHealth(activeSizesGE1, hasCoreSizes);

  return {
    activeSizesGE1,
    activeSizesGT0,
    isLetterSized,
    coreSizesGE1,
    bellySizesGE1,
    hasCoreSizes,
    isHealthy,
    label
  };
}

export type SpeedBand =
  | 'LAUNCH_SHIELD'
  | 'FAST_HERO'
  | 'ACTIVE_CONTINUITY_HERO'
  | 'MEDIUM_2A'
  | 'MEDIUM_2B'
  | 'SLOW_OVERSTOCK';

export interface HeroAndSpeedEvaluation {
  speedBand: SpeedBand;
  isQualifiedHero: boolean;
  isLaunchShield: boolean;
  effectiveTenureWeeks: number;
  strVelocityPctPerWeek: number;
  hasTenureTelemetry: boolean;
  reason: string;
}

/**
 * Evaluates a style against CARINA's 2-Month (~8.7-Week) Drop-Cycle speed benchmarks.
 * Prevents slow 1-year "tortoise" styles from being misclassified as Heroes purely on
 * lifetime STR %, differentiates Fast Heroes vs Medium Movers (Tier 2A / 2B) vs Slow Overstock,
 * and recognizes continuously replenished active NOOS captains via live pull.
 */
export function evaluateSpeedAndHeroQualification(params: {
  cumulativeSTR: number;
  weeklyROS: number;
  weeklyROS2wk?: number;
  storeFloorWOS: number;
  salesLifecycleWeeks?: number;
  firstMoveDate?: string;
  isSingleSize: boolean;
  hasHealthyCoreCurve: boolean;
  isOlderSeason?: boolean;
  momentumRatio?: number;
}): HeroAndSpeedEvaluation {
  const b = DROP_CYCLE_BENCHMARKS;
  const salesWks = Math.max(0, Number(params.salesLifecycleWeeks ?? 0));
  let moveWks = 0;
  if (params.firstMoveDate) {
    const ms = Date.now() - new Date(params.firstMoveDate).getTime();
    if (!isNaN(ms) && ms >= 0) {
      moveWks = Math.round((ms / (7 * 24 * 3600 * 1000)) * 10) / 10;
    }
  }

  const hasTenureTelemetry =
    (params.salesLifecycleWeeks !== undefined && params.salesLifecycleWeeks > 0) ||
    Boolean(params.firstMoveDate);

  const effectiveTenureWeeks = Math.max(salesWks, moveWks);
  const strVelocityPctPerWeek = effectiveTenureWeeks > 0
    ? Math.round((params.cumulativeSTR / Math.max(1.0, effectiveTenureWeeks)) * 10) / 10
    : Math.round(params.cumulativeSTR * 10) / 10;

  const ros = Number(params.weeklyROS) || 0;
  const ros2wk = params.weeklyROS2wk !== undefined ? Number(params.weeklyROS2wk) : ros;
  const wos = Number(params.storeFloorWOS) || 0;
  const str = Number(params.cumulativeSTR) || 0;
  const momentum = Number(params.momentumRatio ?? 1.0);

  // Legacy fixture compatibility when synthetic test omits dates/tenure completely
  if (!hasTenureTelemetry) {
    if (params.isSingleSize) {
      if (str >= 50.0 || ros >= b.SINGLE_SIZE_HIGH_ROS) {
        return {
          speedBand: 'FAST_HERO',
          isQualifiedHero: true,
          isLaunchShield: false,
          effectiveTenureWeeks: 0,
          strVelocityPctPerWeek: str,
          hasTenureTelemetry: false,
          reason: `Single-size fast demand (STR ${str.toFixed(1)}%, ROS ${ros.toFixed(1)} u/wk).`
        };
      }
    } else if (str >= b.ESTABLISHED_HERO_MIN_STR && params.hasHealthyCoreCurve && ros >= b.ESTABLISHED_HERO_MIN_ROS && wos <= 20.0) {
      return {
        speedBand: 'FAST_HERO',
        isQualifiedHero: true,
        isLaunchShield: false,
        effectiveTenureWeeks: 0,
        strVelocityPctPerWeek: str,
        hasTenureTelemetry: false,
        reason: `Core Hero demand verified (STR ${str.toFixed(1)}%, ROS ${ros.toFixed(1)} u/wk, WOS ${wos.toFixed(1)} wks).`
      };
    }
  }

  // Single-Size Evaluation (Cosmetics, Fragrances, Towels, Socks, One-Size Accessories)
  if (params.isSingleSize) {
    if (ros >= b.SINGLE_SIZE_HIGH_ROS && wos <= b.SINGLE_SIZE_FAST_MAX_WOS) {
      return {
        speedBand: 'FAST_HERO',
        isQualifiedHero: true,
        isLaunchShield: false,
        effectiveTenureWeeks,
        strVelocityPctPerWeek,
        hasTenureTelemetry,
        reason: `Surging single-size velocity (${ros.toFixed(1)} u/wk, ${wos.toFixed(1)} WOS runway). Full price protected.`
      };
    }
    if (hasTenureTelemetry && effectiveTenureWeeks <= b.DROP_CADENCE_WEEKS && str >= 50.0 && ros >= b.SINGLE_SIZE_FAST_MIN_ROS && wos <= b.SINGLE_SIZE_FAST_MAX_WOS) {
      return {
        speedBand: 'FAST_HERO',
        isQualifiedHero: true,
        isLaunchShield: false,
        effectiveTenureWeeks,
        strVelocityPctPerWeek,
        hasTenureTelemetry,
        reason: `2-Month Breakout Single-Size Hero: ${str.toFixed(1)}% STR in ${effectiveTenureWeeks.toFixed(1)} wks (${strVelocityPctPerWeek.toFixed(1)}%/wk), ${ros.toFixed(1)} u/wk.`
      };
    }
    if (str >= 50.0 && ros >= b.CONTINUITY_HERO_MIN_ROS && ros2wk >= b.CONTINUITY_HERO_MIN_2WK_ROS && wos <= b.CONTINUITY_HERO_MAX_WOS) {
      return {
        speedBand: 'ACTIVE_CONTINUITY_HERO',
        isQualifiedHero: true,
        isLaunchShield: false,
        effectiveTenureWeeks,
        strVelocityPctPerWeek,
        hasTenureTelemetry,
        reason: `Active Replenished Single-Size Captain: ${ros.toFixed(1)} u/wk live pull with tight ${wos.toFixed(1)} WOS despite ${effectiveTenureWeeks.toFixed(1)}w catalog tenure.`
      };
    }
    if (hasTenureTelemetry && effectiveTenureWeeks <= b.LAUNCH_SHIELD_WEEKS && !params.isOlderSeason) {
      return {
        speedBand: 'LAUNCH_SHIELD',
        isQualifiedHero: false,
        isLaunchShield: true,
        effectiveTenureWeeks,
        strVelocityPctPerWeek,
        hasTenureTelemetry,
        reason: `1-Month Launch Read Window (${effectiveTenureWeeks.toFixed(1)}w <= ${b.LAUNCH_SHIELD_WEEKS}w).`
      };
    }
    if (ros >= b.MEDIUM_MIN_ROS && wos <= b.MEDIUM_MAX_WOS) {
      const subBand: SpeedBand = (wos <= b.MEDIUM_STAGE2B_WOS && effectiveTenureWeeks <= b.DROP_CADENCE_WEEKS) || momentum >= 1.25
        ? 'MEDIUM_2A'
        : 'MEDIUM_2B';
      return {
        speedBand: subBand,
        isQualifiedHero: false,
        isLaunchShield: false,
        effectiveTenureWeeks,
        strVelocityPctPerWeek,
        hasTenureTelemetry,
        reason: `Single-size Medium Mover (${ros.toFixed(1)} u/wk, ${wos.toFixed(1)} WOS over ${effectiveTenureWeeks.toFixed(1)} wks). Multi-buy basket lift preserves margin.`
      };
    }
    return {
      speedBand: 'SLOW_OVERSTOCK',
      isQualifiedHero: false,
      isLaunchShield: false,
      effectiveTenureWeeks,
      strVelocityPctPerWeek,
      hasTenureTelemetry,
      reason: str >= 50.0
        ? `Stale high-STR tail (${str.toFixed(1)}% took ${effectiveTenureWeeks.toFixed(1)} wks = ${strVelocityPctPerWeek.toFixed(1)}%/wk; current ${ros.toFixed(1)} u/wk, ${wos.toFixed(1)} WOS) — failed time-bounded Hero test.`
        : `Slow single-size velocity (${ros.toFixed(1)} u/wk, ${wos.toFixed(1)} WOS) requires multi-buy acceleration.`
    };
  }

  // Multi-Size Apparel Evaluation:
  // STEP A: Analyze STR %, Sales Speed (ROS), Tenure (1-Month / 4.3w grace), and WOS BEFORE Size Health!
  if (!hasTenureTelemetry && str >= b.ESTABLISHED_HERO_MIN_STR && ros >= b.ESTABLISHED_HERO_MIN_ROS && wos <= 20.0) {
    const heroAllowed = params.hasHealthyCoreCurve;
    return {
      speedBand: 'FAST_HERO',
      isQualifiedHero: heroAllowed,
      isLaunchShield: false,
      effectiveTenureWeeks: 0,
      strVelocityPctPerWeek: str,
      hasTenureTelemetry: false,
      reason: heroAllowed
        ? `Core Hero demand verified (STR ${str.toFixed(1)}%, ROS ${ros.toFixed(1)} u/wk, WOS ${wos.toFixed(1)} wks).`
        : `Fast demand (STR ${str.toFixed(1)}%, ROS ${ros.toFixed(1)} u/wk, WOS ${wos.toFixed(1)} wks) with broken core sizes — routed to scenario check.`
    };
  }

  // Path A: 2-Month Drop Breakout (STR >= 50% inside <= 8.7 wks + strong ROS + tight WOS)
  if (
    hasTenureTelemetry &&
    effectiveTenureWeeks <= b.DROP_CADENCE_WEEKS &&
    str >= b.FAST_HERO_MIN_STR &&
    ros >= b.FAST_HERO_MIN_ROS &&
    wos <= b.FAST_HERO_MAX_WOS
  ) {
    const heroAllowed = params.hasHealthyCoreCurve;
    return {
      speedBand: 'FAST_HERO',
      isQualifiedHero: heroAllowed,
      isLaunchShield: false,
      effectiveTenureWeeks,
      strVelocityPctPerWeek,
      hasTenureTelemetry,
      reason: heroAllowed
        ? `2-Month Drop Breakout Hero: ${str.toFixed(1)}% STR in ${effectiveTenureWeeks.toFixed(1)} wks (${strVelocityPctPerWeek.toFixed(1)}%/wk) at ${ros.toFixed(1)} u/wk & ${wos.toFixed(1)} WOS.`
        : `Broken Fast Breakout: ${str.toFixed(1)}% STR in ${effectiveTenureWeeks.toFixed(1)} wks at ${ros.toFixed(1)} u/wk & ${wos.toFixed(1)} WOS, but missing core S/M/L/XL.`
    };
  }

  // Path B: Established Fast Hero (STR >= 70% inside <= 12.0 wks + active ROS + <= 14 WOS)
  if (
    hasTenureTelemetry &&
    effectiveTenureWeeks <= b.ESTABLISHED_HERO_MAX_WEEKS &&
    str >= b.ESTABLISHED_HERO_MIN_STR &&
    ros >= b.ESTABLISHED_HERO_MIN_ROS &&
    wos <= b.ESTABLISHED_HERO_MAX_WOS
  ) {
    const heroAllowed = params.hasHealthyCoreCurve;
    return {
      speedBand: 'FAST_HERO',
      isQualifiedHero: heroAllowed,
      isLaunchShield: false,
      effectiveTenureWeeks,
      strVelocityPctPerWeek,
      hasTenureTelemetry,
      reason: heroAllowed
        ? `Fast Hero: reached ${str.toFixed(1)}% STR within ${effectiveTenureWeeks.toFixed(1)} wks (${strVelocityPctPerWeek.toFixed(1)}%/wk), maintaining ${ros.toFixed(1)} u/wk & ${wos.toFixed(1)} WOS.`
        : `Broken Fast Mover: reached ${str.toFixed(1)}% STR within ${effectiveTenureWeeks.toFixed(1)} wks at ${ros.toFixed(1)} u/wk & ${wos.toFixed(1)} WOS, missing core sizes.`
    };
  }

  // Path C: Active Replenished Continuity Captain (mature > 12 wks proving live full-price pull)
  if (
    str >= b.ESTABLISHED_HERO_MIN_STR &&
    ros >= b.CONTINUITY_HERO_MIN_ROS &&
    ros2wk >= b.CONTINUITY_HERO_MIN_2WK_ROS &&
    wos <= b.CONTINUITY_HERO_MAX_WOS
  ) {
    const heroAllowed = params.hasHealthyCoreCurve;
    return {
      speedBand: 'ACTIVE_CONTINUITY_HERO',
      isQualifiedHero: heroAllowed,
      isLaunchShield: false,
      effectiveTenureWeeks,
      strVelocityPctPerWeek,
      hasTenureTelemetry,
      reason: heroAllowed
        ? `Active Continuity Captain: ${str.toFixed(1)}% cumulative STR backed by live ${ros.toFixed(1)} u/wk velocity & tight ${wos.toFixed(1)} WOS.`
        : `Broken Fast Continuity Mover: ${str.toFixed(1)}% STR & ${ros.toFixed(1)} u/wk velocity (${wos.toFixed(1)} WOS), missing core sizes.`
    };
  }

  // Path D: Broken High-Velocity Seller (> 12 wks or WOS 14-20 with >= 2.0 u/wk live pull & >= 50% STR)
  if (str >= b.BROKEN_FAST_MIN_STR && ros >= b.BROKEN_FAST_MIN_ROS && wos <= b.FAST_HERO_MAX_WOS) {
    return {
      speedBand: 'FAST_HERO',
      isQualifiedHero: params.hasHealthyCoreCurve && ros >= b.FAST_HERO_MIN_ROS,
      isLaunchShield: false,
      effectiveTenureWeeks,
      strVelocityPctPerWeek,
      hasTenureTelemetry,
      reason: params.hasHealthyCoreCurve
        ? `Strong Velocity (${str.toFixed(1)}% STR, ${ros.toFixed(1)} u/wk, ${wos.toFixed(1)} WOS).`
        : `Broken Fast Mover: ${str.toFixed(1)}% STR & ${ros.toFixed(1)} u/wk velocity (${wos.toFixed(1)} WOS) with missing core sizes.`
    };
  }

  // 1-Month Launch Read Shield (0 - 4.3 wks / 30 days for non-older seasonal drops)
  if (hasTenureTelemetry && effectiveTenureWeeks <= b.LAUNCH_SHIELD_WEEKS && !params.isOlderSeason) {
    return {
      speedBand: 'LAUNCH_SHIELD',
      isQualifiedHero: false,
      isLaunchShield: true,
      effectiveTenureWeeks,
      strVelocityPctPerWeek,
      hasTenureTelemetry,
      reason: `1-Month Launch Read Window (${effectiveTenureWeeks.toFixed(1)}w <= ${b.LAUNCH_SHIELD_WEEKS}w). Protected while initial drop builds velocity.`
    };
  }

  // Medium Mover vs Slow Overstock (assessed purely on velocity/STR/WOS before size-curve branch)
  if (ros >= b.MEDIUM_MIN_ROS && wos <= b.MEDIUM_MAX_WOS) {
    const isPastOneDropAndHeavy =
      (effectiveTenureWeeks > b.DROP_CADENCE_WEEKS && (wos > b.MEDIUM_STAGE2B_WOS || str < 40.0)) ||
      wos > b.MEDIUM_STAGE2B_WOS;
    const subBand: SpeedBand = (!isPastOneDropAndHeavy || momentum >= 1.25) && wos <= b.MEDIUM_STAGE2B_WOS
      ? 'MEDIUM_2A'
      : 'MEDIUM_2B';
    return {
      speedBand: subBand,
      isQualifiedHero: false,
      isLaunchShield: false,
      effectiveTenureWeeks,
      strVelocityPctPerWeek,
      hasTenureTelemetry,
      reason: subBand === 'MEDIUM_2A'
        ? `Medium Mover (Tier 2A — Gentle Lift): ${ros.toFixed(1)} u/wk, ${wos.toFixed(1)} WOS (${str.toFixed(1)}% STR over ${effectiveTenureWeeks.toFixed(1)}w).`
        : `Medium Mover (Tier 2B — Pre-Drop Escalation): ${ros.toFixed(1)} u/wk, ${wos.toFixed(1)} WOS after ${effectiveTenureWeeks.toFixed(1)}w; multi-buy bundle clears floor before next drop.`
    };
  }

  const staleHighStrNote = str >= 70.0
    ? `Aged ${str.toFixed(1)}% STR over ${effectiveTenureWeeks.toFixed(1)} wks (${strVelocityPctPerWeek.toFixed(1)}%/wk) failed Hero speed check (${ros.toFixed(1)} u/wk, ${wos.toFixed(1)} WOS)`
    : `Slow/Overstock (${ros.toFixed(1)} u/wk, ${wos.toFixed(1)} WOS, ${str.toFixed(1)}% STR over ${effectiveTenureWeeks.toFixed(1)}w)`;

  return {
    speedBand: 'SLOW_OVERSTOCK',
    isQualifiedHero: false,
    isLaunchShield: false,
    effectiveTenureWeeks,
    strVelocityPctPerWeek,
    hasTenureTelemetry,
    reason: staleHighStrNote
  };
}
