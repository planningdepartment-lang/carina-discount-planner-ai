import { StyleMetrics, RecommendationResult } from './lifecycleClassifier';
import { calculateZeroLossFloor } from './metricsCalculator';

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
 * Clamps prices or overrides offers if a rule is violated.
 */
export function applyBusinessRules(
  metrics: StyleMetrics,
  proposal: RecommendationResult,
  rules: BusinessRuleRecord[]
): RecommendationResult {
  let adjustedProposal = { ...proposal };

  for (const rule of rules) {
    if (!rule.is_active) continue;

    // Check scope match
    const scopeMatch = checkScopeMatch(metrics, rule.target_scope);
    if (!scopeMatch) continue;

    // 1. Exclusion Rules (e.g. EXCLUDE SEASON:AW26)
    if (rule.rule_category === 'EXCLUSION' && rule.condition_operator === 'EXCLUDE') {
      adjustedProposal.tier = 'EXCLUDED_BY_RULE';
      adjustedProposal.recommendedOffer = `${rule.rule_name} (0% Off)`;
      adjustedProposal.discountPct = 0;
      adjustedProposal.promotionalPriceSAR = metrics.ticketPrice;
      adjustedProposal.rationale = `Protected by active policy: ${rule.rule_name}`;
    }

    // 2. Discount Cap Rules (e.g. MAX 25% discount)
    if (rule.rule_category === 'DISCOUNT_CAP' && rule.condition_operator === 'MAX') {
      const maxCap = parseFloat(rule.rule_value);
      if (!isNaN(maxCap) && adjustedProposal.discountPct > maxCap) {
        adjustedProposal.discountPct = maxCap;
        const cappedPrice = Math.round(metrics.ticketPrice * (1 - (maxCap / 100)) * 100) / 100;
        const costPlusVat = calculateZeroLossFloor(metrics.unitCost);
        adjustedProposal.promotionalPriceSAR = Math.max(costPlusVat, cappedPrice);
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
          // Adjust price upward to satisfy minimum margin floor
          const requiredNetRev = metrics.unitCost / (1 - (minMargin / 100));
          const requiredPromo = Math.round(requiredNetRev * 1.15 * 100) / 100;
          if (requiredPromo <= metrics.ticketPrice) {
            adjustedProposal.promotionalPriceSAR = requiredPromo;
            adjustedProposal.discountPct = Math.round((1 - (requiredPromo / metrics.ticketPrice)) * 100);
            adjustedProposal.rationale += ` (Adjusted upward to satisfy ${minMargin}% margin floor).`;
          }
        }
      }
    }
  }

  return adjustedProposal;
}

function checkScopeMatch(metrics: StyleMetrics, targetScope: string): boolean {
  if (targetScope === 'GLOBAL') return true;

  const [scopeType, scopeValue] = targetScope.split(':');
  if (!scopeType || !scopeValue) return false;

  const cleanVal = scopeValue.trim().toUpperCase();

  switch (scopeType.toUpperCase()) {
    case 'SEASON':
      return (metrics.season || '').toUpperCase().includes(cleanVal);
    case 'CATEGORY':
      return (metrics.category || '').toUpperCase().includes(cleanVal);
    case 'STYLE':
      return metrics.styleCode.toUpperCase() === cleanVal;
    default:
      return false;
  }
}
