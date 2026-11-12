import { StyleMetrics, RecommendationResult } from './lifecycleClassifier';
import { calculateZeroLossFloor } from './metricsCalculator';
import { LIFECYCLE_TIERS } from '../config/constants';

export interface BusinessRuleRecord {
  rule_id: string;
  rule_name: string;
  rule_category: string;       // 'MARGIN', 'DISCOUNT_CAP', 'EXCLUSION', 'STOCK_TARGET'
  target_scope: string;        // 'GLOBAL', 'SEASON:AW26', 'CATEGORY:Bra'
  condition_operator: string;  // 'MIN', 'MAX', 'EQUALS', 'EXCLUDE'
  rule_value: string;
  enforcement_level: string;   // 'HARD_BLOCK', 'WARNING'
  is_active: number;
}

/**
 * Evaluates active dynamic governance rules from D1 against a proposed style recommendation.
 * Clamps prices or overrides offers cleanly and keeps offer labels synchronized with discounted prices.
 */
export function applyBusinessRules(
  metrics: StyleMetrics,
  proposal: RecommendationResult,
  rules: BusinessRuleRecord[]
): RecommendationResult {
  // Never let exclusion/cap rules mask a flagged pricing error (ticket < landed cost + 15% VAT)
  if (proposal.tier === LIFECYCLE_TIERS.FLAGGED_PRICE_ERROR || proposal.zeroLossStatus === 'FLAGGED') {
    return { ...proposal };
  }

  let adjustedProposal: RecommendationResult = { ...proposal };

  for (const rule of rules) {
    if (!rule.is_active) continue;

    const scopeMatch = checkScopeMatch(metrics, rule.target_scope);
    if (!scopeMatch) continue;

    // 1. Exclusion Rules (e.g. EXCLUDE SEASON:AW26 / FW 26)
    if (rule.rule_category === 'EXCLUSION' && rule.condition_operator === 'EXCLUDE') {
      adjustedProposal.tier = 'EXCLUDED_BY_RULE';
      adjustedProposal.recommendedOffer = `${rule.rule_name} (0% Off)`;
      adjustedProposal.discountPct = 0;
      adjustedProposal.promotionalPriceSAR = metrics.ticketPrice;
      adjustedProposal.bundleQuantity = 1;
      adjustedProposal.bundlePriceSAR = metrics.ticketPrice;
      adjustedProposal.sharedRailTag = undefined;
      adjustedProposal.railCostCeilingSAR = undefined;
      adjustedProposal.rationale = `Protected by active policy: ${rule.rule_name}`;
    }

    // 2. Discount Cap Rules (e.g. MAX 25% discount on Continuity All Season 2018)
    if (rule.rule_category === 'DISCOUNT_CAP' && rule.condition_operator === 'MAX') {
      const maxCap = parseFloat(rule.rule_value);
      if (!isNaN(maxCap) && adjustedProposal.discountPct > maxCap) {
        const cappedPrice = Math.round(metrics.ticketPrice * (1 - (maxCap / 100)) * 100) / 100;
        const costPlusVat = calculateZeroLossFloor(metrics.unitCost);
        const finalPromo = Math.max(costPlusVat, cappedPrice);
        const actualDiscount = metrics.ticketPrice > 0
          ? Math.round((1 - (finalPromo / metrics.ticketPrice)) * 1000) / 10
          : 0;

        adjustedProposal.promotionalPriceSAR = finalPromo;
        adjustedProposal.discountPct = Math.round(actualDiscount * 10) / 10;
        adjustedProposal.zeroLossStatus = finalPromo >= (costPlusVat - 0.01) ? 'YES' : 'FLAGGED';
        adjustedProposal.bundleQuantity = 1;
        adjustedProposal.bundlePriceSAR = finalPromo;
        adjustedProposal.sharedRailTag = undefined;
        adjustedProposal.railCostCeilingSAR = undefined;
        adjustedProposal.tier = adjustedProposal.discountPct <= 0
          ? LIFECYCLE_TIERS.HERO_CORE
          : LIFECYCLE_TIERS.RULE_CAPPED_PROMO;
        adjustedProposal.recommendedOffer = adjustedProposal.discountPct <= 0
          ? 'Full Price Margin Protection (0% Off)'
          : `Continuity Capped Promo (${adjustedProposal.discountPct}% Off)`;
        adjustedProposal.rationale += ` (Discount capped at ${maxCap}% by rule ${rule.rule_name}).`;
      }
    }

    // 3. Margin Floor Rules (e.g. MIN 45% net margin)
    if (rule.rule_category === 'MARGIN' && rule.condition_operator === 'MIN') {
      const minMargin = parseFloat(rule.rule_value);
      if (!isNaN(minMargin) && adjustedProposal.promotionalPriceSAR > 0) {
        const netRev = adjustedProposal.promotionalPriceSAR / 1.15;
        const marginPct = ((netRev - metrics.unitCost) / netRev) * 100;
        if (marginPct < minMargin && rule.enforcement_level === 'HARD_BLOCK') {
          const requiredNetRev = metrics.unitCost / (1 - (minMargin / 100));
          const requiredPromo = Math.round(requiredNetRev * 1.15 * 100) / 100;
          if (requiredPromo <= metrics.ticketPrice) {
            const actualDiscount = Math.round((1 - (requiredPromo / metrics.ticketPrice)) * 100);
            adjustedProposal.promotionalPriceSAR = requiredPromo;
            adjustedProposal.discountPct = actualDiscount;
            adjustedProposal.bundleQuantity = 1;
            adjustedProposal.bundlePriceSAR = requiredPromo;
            adjustedProposal.sharedRailTag = undefined;
            adjustedProposal.railCostCeilingSAR = undefined;
            if (actualDiscount <= 0) {
              adjustedProposal.tier = LIFECYCLE_TIERS.HERO_CORE;
              adjustedProposal.recommendedOffer = 'Full Price Margin Protection (0% Off)';
            } else {
              adjustedProposal.tier = LIFECYCLE_TIERS.RULE_CAPPED_PROMO;
              adjustedProposal.recommendedOffer = `Margin-Protected Promo (${actualDiscount}% Off)`;
            }
            adjustedProposal.rationale += ` (Adjusted upward to satisfy ${minMargin}% margin floor).`;
          }
        }
      }
    }
  }

  return adjustedProposal;
}

function normalizeCompactSeason(val: string): string {
  return (val || '').toUpperCase().replace(/[\s_-]+/g, '');
}

function checkScopeMatch(metrics: StyleMetrics, targetScope: string): boolean {
  if (targetScope === 'GLOBAL') return true;

  const [scopeType, scopeValue] = targetScope.split(':');
  if (!scopeType || !scopeValue) return false;

  const cleanVal = scopeValue.trim().toUpperCase();

  switch (scopeType.toUpperCase()) {
    case 'SEASON': {
      const rawSeason = (metrics.season || '').toUpperCase();
      if (rawSeason.includes(cleanVal)) return true;
      const compactSeason = normalizeCompactSeason(rawSeason);
      const compactScope = normalizeCompactSeason(cleanVal);
      if (compactSeason.includes(compactScope)) return true;
      if (compactScope === 'AW26' || compactScope === 'FW26' || compactScope === 'WINTER2026') {
        return compactSeason.includes('AW26') || compactSeason.includes('FW26') || compactSeason.includes('WINTER2026');
      }
      if (compactScope === 'SS26' || compactScope === 'SUMMER2026') {
        return compactSeason.includes('SS26') || compactSeason.includes('SUMMER2026');
      }
      if (compactScope === 'SS27' || compactScope === 'SUMMER2027') {
        return compactSeason.includes('SS27') || compactSeason.includes('SUMMER2027');
      }
      return false;
    }
    case 'CATEGORY':
      return (metrics.category || '').toUpperCase().includes(cleanVal);
    case 'STYLE':
      return metrics.styleCode.toUpperCase() === cleanVal;
    default:
      return false;
  }
}
