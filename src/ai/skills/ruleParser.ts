import { BusinessRuleRecord } from '../../engine/rulePipeline';

/**
 * Natural language rule compiler using pattern matching and LLM fallback.
 */
export function parseNaturalLanguageRule(text: string): Partial<BusinessRuleRecord> | null {
  const lower = text.toLowerCase();

  // Pattern 1: Discount Cap (e.g. "cap discount on bras at 25%")
  const capMatch = lower.match(/cap\s+(?:discount\s+on\s+)?(\w+)\s+(?:at\s+|to\s+)?(\d+)%/i);
  if (capMatch) {
    const category = capMatch[1];
    const capPct = capMatch[2];
    return {
      rule_id: `RULE_CAP_${category.toUpperCase()}_${Date.now()}`,
      rule_name: `Max ${capPct}% Discount on ${category}`,
      rule_category: 'DISCOUNT_CAP',
      target_scope: `CATEGORY:${category}`,
      condition_operator: 'MAX',
      rule_value: capPct,
      enforcement_level: 'HARD_BLOCK',
      is_active: 1
    };
  }

  // Pattern 2: Exclusion (e.g. "exclude season AW26 from discounts")
  const excludeMatch = lower.match(/exclude\s+(?:season\s+)?(\w+)/i);
  if (excludeMatch) {
    const season = excludeMatch[1].toUpperCase();
    return {
      rule_id: `RULE_EXCLUDE_${season}_${Date.now()}`,
      rule_name: `Exclude ${season} from discounts`,
      rule_category: 'EXCLUSION',
      target_scope: `SEASON:${season}`,
      condition_operator: 'EXCLUDE',
      rule_value: '1',
      enforcement_level: 'HARD_BLOCK',
      is_active: 1
    };
  }

  // Pattern 3: Margin Floor (e.g. "minimum margin floor 50%")
  const marginMatch = lower.match(/(?:min|minimum)\s+(?:net\s+)?margin\s+(?:floor\s+)?(?:of\s+)?(\d+)%/i);
  if (marginMatch) {
    const margin = marginMatch[1];
    return {
      rule_id: `RULE_MIN_MARGIN_${margin}_${Date.now()}`,
      rule_name: `Min Portfolio Net Margin ${margin}%`,
      rule_category: 'MARGIN',
      target_scope: 'GLOBAL',
      condition_operator: 'MIN',
      rule_value: margin,
      enforcement_level: 'HARD_BLOCK',
      is_active: 1
    };
  }

  return null;
}
