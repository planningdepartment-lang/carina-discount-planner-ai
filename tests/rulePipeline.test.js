const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

function calculateZeroLossFloor(cost) {
  if (cost <= 0) return 0;
  return Math.round(cost * 1.15 * 100) / 100;
}

function checkScopeMatch(metrics, targetScope) {
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

function applyBusinessRules(metrics, proposal, rules) {
  let adjustedProposal = { ...proposal };

  for (const rule of rules) {
    if (!rule.is_active) continue;

    const scopeMatch = checkScopeMatch(metrics, rule.target_scope);
    if (!scopeMatch) continue;

    // 1. Exclusion Rules
    if (rule.rule_category === 'EXCLUSION' && rule.condition_operator === 'EXCLUDE') {
      adjustedProposal.tier = 'EXCLUDED_BY_RULE';
      adjustedProposal.recommendedOffer = `${rule.rule_name} (0% Off)`;
      adjustedProposal.discountPct = 0;
      adjustedProposal.promotionalPriceSAR = metrics.ticketPrice;
      adjustedProposal.rationale = `Protected by active policy: ${rule.rule_name}`;
    }

    // 2. Discount Cap Rules
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

    // 3. Margin Floor Rules
    if (rule.rule_category === 'MARGIN' && rule.condition_operator === 'MIN') {
      const minMargin = parseFloat(rule.rule_value);
      if (!isNaN(minMargin) && adjustedProposal.promotionalPriceSAR > 0) {
        const netRev = adjustedProposal.promotionalPriceSAR / 1.15;
        const marginPct = ((netRev - metrics.unitCost) / netRev) * 100;
        if (marginPct < minMargin && rule.enforcement_level === 'HARD_BLOCK') {
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

describe('Commercial Governance Rule Pipeline Engine', () => {
  const baseMetrics = {
    styleCode: '58401',
    productName: 'Double Breasted Blazer',
    category: 'Jacket',
    season: 'SS26',
    unitCost: 50.0,
    ticketPrice: 200.0,
    totalPhysicalStock: 100,
    stockAndalus: 40,
    stockYasmeen: 40,
    stockJouri: 20,
    stockWH: 0,
    weeklyROS: 4.0,
    cumulativeSTR: 45.0,
    storeFloorWOS: 25.0,
    activeSizeCount: 4,
    isSingleSize: false
  };

  const baseProposal = {
    tier: 'CLEARANCE_50_PCT',
    recommendedOffer: '50% Off Dedicated Clearance Rail',
    discountPct: 50.0,
    promotionalPriceSAR: 100.0, // Net Rev = 100 / 1.15 = 86.95, Margin = (86.95 - 50) / 86.95 = 42.5%
    expectedClearancePct: 50,
    rationale: 'Liquidating floor space.',
    zeroLossStatus: 'YES'
  };

  test('Scope matching correctly handles GLOBAL, CATEGORY, SEASON, and STYLE', () => {
    assert.equal(checkScopeMatch(baseMetrics, 'GLOBAL'), true);
    assert.equal(checkScopeMatch(baseMetrics, 'CATEGORY:Jacket'), true);
    assert.equal(checkScopeMatch(baseMetrics, 'CATEGORY:Bra'), false);
    assert.equal(checkScopeMatch(baseMetrics, 'SEASON:SS26'), true);
    assert.equal(checkScopeMatch(baseMetrics, 'SEASON:AW26'), false);
    assert.equal(checkScopeMatch(baseMetrics, 'STYLE:58401'), true);
    assert.equal(checkScopeMatch(baseMetrics, 'STYLE:50003'), false);
  });

  test('Exclusion rules protect full price and assign EXCLUDED_BY_RULE tier', () => {
    const rules = [
      {
        rule_id: 'EXCLUDE_SS26',
        rule_name: 'Summer Protection Policy',
        rule_category: 'EXCLUSION',
        target_scope: 'SEASON:SS26',
        condition_operator: 'EXCLUDE',
        rule_value: '1',
        enforcement_level: 'HARD_BLOCK',
        is_active: 1
      }
    ];

    const result = applyBusinessRules(baseMetrics, baseProposal, rules);
    assert.equal(result.tier, 'EXCLUDED_BY_RULE');
    assert.equal(result.discountPct, 0);
    assert.equal(result.promotionalPriceSAR, 200.0);
    assert.ok(result.recommendedOffer.includes('0% Off'));
  });

  test('Discount Cap rules clamp excessive markdown while preserving zero-loss floor', () => {
    const rules = [
      {
        rule_id: 'CAP_DISCOUNT_30',
        rule_name: 'Max 30% Markdown Cap',
        rule_category: 'DISCOUNT_CAP',
        target_scope: 'GLOBAL',
        condition_operator: 'MAX',
        rule_value: '30.0',
        enforcement_level: 'HARD_BLOCK',
        is_active: 1
      }
    ];

    const result = applyBusinessRules(baseMetrics, baseProposal, rules);
    assert.equal(result.discountPct, 30.0);
    assert.equal(result.promotionalPriceSAR, 140.0); // 200 * (1 - 0.30)
    assert.ok(result.rationale.includes('Discount capped at 30%'));
  });

  test('Margin Floor rules elevate price to guarantee minimum net margin', () => {
    // Current margin at 100 SAR promo price is ~42.5%.
    // Rule requires minimum 55% net margin.
    // Required Net Rev = 50 / (1 - 0.55) = 111.11 SAR.
    // Required Promo Price = 111.11 * 1.15 = 127.78 SAR.
    const rules = [
      {
        rule_id: 'MIN_MARGIN_55',
        rule_name: 'Executive 55% Margin Hurdle',
        rule_category: 'MARGIN',
        target_scope: 'GLOBAL',
        condition_operator: 'MIN',
        rule_value: '55.0',
        enforcement_level: 'HARD_BLOCK',
        is_active: 1
      }
    ];

    const result = applyBusinessRules(baseMetrics, baseProposal, rules);
    assert.ok(result.promotionalPriceSAR >= 127.0);
    assert.ok(result.discountPct <= 37);
    assert.ok(result.rationale.includes('Adjusted upward to satisfy 55% margin floor'));
  });

  test('Inactive rules are ignored by pipeline', () => {
    const rules = [
      {
        rule_id: 'PAUSED_EXCLUSION',
        rule_name: 'Paused Exclusion Rule',
        rule_category: 'EXCLUSION',
        target_scope: 'GLOBAL',
        condition_operator: 'EXCLUDE',
        rule_value: '1',
        enforcement_level: 'HARD_BLOCK',
        is_active: 0
      }
    ];

    const result = applyBusinessRules(baseMetrics, baseProposal, rules);
    assert.equal(result.tier, baseProposal.tier);
    assert.equal(result.discountPct, baseProposal.discountPct);
    assert.equal(result.promotionalPriceSAR, baseProposal.promotionalPriceSAR);
  });
});
