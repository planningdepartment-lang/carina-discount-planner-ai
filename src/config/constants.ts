/**
 * CARINA Physical Retail Constants & Benchmarks
 */
export const SAUDI_VAT_RATE = 0.15; // 15% standard VAT in KSA

export const STORE_SPACES = {
  ANDALUS: {
    code: 'AND/Stock',
    name: 'Al-Andalus Mall Flagship',
    city: 'Jeddah',
    areaM2: 260,
    targetDensity: 25.0 // Ideal target display units/m²
  },
  YASMEEN: {
    code: 'YAS/Stock',
    name: 'Al-Yasmeen Mall',
    city: 'Jeddah',
    areaM2: 193,
    targetDensity: 34.0 // Decongestion target display units/m²
  },
  JOURI: {
    code: 'Jouri/Stock',
    name: 'Jouri Mall',
    city: 'Taif',
    areaM2: 168,
    targetDensity: 35.0 // Decongestion target display units/m²
  },
  WAREHOUSE: {
    code: 'WH/Stock',
    name: 'Central Distribution Center',
    city: 'Central',
    areaM2: 0,
    targetDensity: 0
  }
} as const;

export const EXCLUDED_LOCATIONS = [
  'Shofy/Stock', // Shopify e-commerce (phantom inventory ignored)
  'WH-D/Stock'   // Defective / Damaged items
] as const;

export const LIFECYCLE_TIERS = {
  HERO_CORE: 'HERO_CORE',
  STEADY_ACTIVE: 'STEADY_ACTIVE',
  MATURE_SUMMER_EXIT: 'MATURE_SUMMER_EXIT',
  CLEARANCE_50_PCT: 'CLEARANCE_50_PCT',
  CLEARANCE_3_FOR_99: 'CLEARANCE_3_FOR_99',
  CLEARANCE_PERCENT_SAFE: 'CLEARANCE_PERCENT_SAFE',
  FRESH_WINTER: 'FRESH_WINTER',
  FLAGGED_PRICE_ERROR: 'FLAGGED_PRICE_ERROR',
  VOLUME_MULTI_BUY: 'VOLUME_MULTI_BUY',
  BUNDLE_2: 'BUNDLE_2',
  RULE_CAPPED_PROMO: 'RULE_CAPPED_PROMO',
  EXCLUDED_BY_RULE: 'EXCLUDED_BY_RULE',
  MANUAL_OVERRIDE: 'MANUAL_OVERRIDE'
} as const;

export const SAUDI_CHARM_PRICE_POINTS = [
  9, 12, 15, 19, 25, 29, 39, 49, 59, 69, 79, 89, 99, 119, 129, 149, 169, 189, 199, 219, 249, 299, 349
] as const;

export const CAMPAIGN_DEFAULTS = {
  CAMPAIGN_NAME: 'White Friday 2026',
  START_DATE: '2026-11-22',
  END_DATE: '2026-12-03',
  PAYDAY_DATE: '2026-11-27',
  TARGET_CLEARANCE_SHARE_PCT: 42.8,
  MIN_RETAINED_SHARE_PCT: 57.2
} as const;

export const DROP_CYCLE_BENCHMARKS = {
  DROP_CADENCE_WEEKS: 8.7,          // ~2-month new collection drop cadence (~6 drops/yr)
  LAUNCH_SHIELD_WEEKS: 3.0,         // First 21 days protected from premature markdown
  ESTABLISHED_HERO_MAX_WEEKS: 12.0, // ~3-month window for 70%+ established Hero validation
  FAST_HERO_MIN_STR: 50.0,
  FAST_HERO_MIN_ROS: 2.5,
  FAST_HERO_MAX_WOS: 12.0,
  ESTABLISHED_HERO_MIN_STR: 70.0,
  ESTABLISHED_HERO_MIN_ROS: 1.5,
  ESTABLISHED_HERO_MAX_WOS: 14.0,
  CONTINUITY_HERO_MIN_ROS: 2.5,     // Mature NOOS (>12w) must prove live floor pull
  CONTINUITY_HERO_MIN_2WK_ROS: 1.0,
  CONTINUITY_HERO_MAX_WOS: 14.0,
  SINGLE_SIZE_HIGH_ROS: 4.0,
  SINGLE_SIZE_FAST_MIN_ROS: 1.5,
  SINGLE_SIZE_FAST_MAX_WOS: 16.0,
  MEDIUM_MIN_ROS: 0.8,
  MEDIUM_STAGE2B_WOS: 20.0,
  SLOW_OVERSTOCK_WOS: 26.0,
  MEDIUM_MAX_WOS: 32.0
} as const;

export type CampaignMode =
  | 'REGULAR_DROP_CYCLE'
  | 'WHITE_FRIDAY'
  | 'NATIONAL_DAY'
  | 'FOUNDING_DAY'
  | 'RAMADAN_PREP'
  | 'EID_AL_FITR'
  | 'SUMMER_EXIT'
  | 'WINTER_EXIT';

export const CAMPAIGN_MODE_LABELS: Record<CampaignMode, string> = {
  REGULAR_DROP_CYCLE: 'Regular 2-Month Drop Cycle (Permanent Rail Only)',
  WHITE_FRIDAY: 'White Friday / Cyber Week (Big Event Clearance)',
  NATIONAL_DAY: 'Saudi National Day (Basket Builder)',
  FOUNDING_DAY: 'Saudi Founding Day (Basket Builder)',
  RAMADAN_PREP: 'Ramadan Prep (Margin-First Loungewear)',
  EID_AL_FITR: 'Eid Al-Fitr (High-Margin Festive Harvest)',
  SUMMER_EXIT: 'Summer Final Exit (Aggressive Decongestion)',
  WINTER_EXIT: 'Winter Final Exit (Aggressive Decongestion)'
};
