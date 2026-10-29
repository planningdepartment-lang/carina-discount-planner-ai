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
  BUNDLE_2: 'BUNDLE_2'
} as const;

export const SAUDI_CHARM_PRICE_POINTS = [
  29, 39, 49, 59, 69, 79, 89, 99, 119, 129, 149, 169, 189, 199, 219, 249, 299, 349
] as const;

export const CAMPAIGN_DEFAULTS = {
  CAMPAIGN_NAME: 'White Friday 2026',
  START_DATE: '2026-11-22',
  END_DATE: '2026-12-03',
  PAYDAY_DATE: '2026-11-27',
  TARGET_CLEARANCE_SHARE_PCT: 42.8,
  MIN_RETAINED_SHARE_PCT: 57.2
} as const;
