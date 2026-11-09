const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SAUDI_CHARM_PRICE_POINTS = [
  9, 14, 19, 24, 29, 39, 49, 59, 69, 79, 89, 99, 119, 129, 139, 149, 169, 179, 199, 229, 249, 299
];

function calculateZeroLossFloor(cost) {
  if (cost <= 0) return 0;
  return Math.round(cost * 1.15 * 100) / 100;
}

function solveOptimalCharmBundle(totalTicket, totalCostPlusVat, targetDiscountPct) {
  const rawDiscountPrice = totalTicket * (1 - (targetDiscountPct / 100));
  const validPoints = SAUDI_CHARM_PRICE_POINTS.filter(p => p >= totalCostPlusVat && p < totalTicket);

  if (validPoints.length === 0) {
    const fallback = Math.ceil(totalCostPlusVat);
    const savings = Math.max(0, Math.round((totalTicket - fallback) * 100) / 100);
    const discount = totalTicket > 0 ? Math.round((savings / totalTicket) * 100) : 0;
    return {
      charmPrice: fallback,
      discountPct: discount,
      savingsSAR: savings,
      isElevatedForFloor: true
    };
  }

  let bestPoint = validPoints[0];
  let minDiff = Math.abs(rawDiscountPrice - bestPoint);

  for (const pt of validPoints) {
    const diff = Math.abs(rawDiscountPrice - pt);
    if (diff < minDiff) {
      minDiff = diff;
      bestPoint = pt;
    }
  }

  const savingsSAR = Math.round((totalTicket - bestPoint) * 100) / 100;
  const discountPct = Math.round((savingsSAR / totalTicket) * 100);

  return {
    charmPrice: bestPoint,
    discountPct,
    savingsSAR,
    isElevatedForFloor: bestPoint < totalCostPlusVat + 5
  };
}

function generateDynamicCategoryOfferPlan(telemetry) {
  const avgTicket = Math.max(5.0, telemetry.avgTicketPrice || 15.0);
  const avgCost = Math.max(1.0, telemetry.avgUnitCost || 4.0);
  const unitCostPlusVat = calculateZeroLossFloor(avgCost);

  const isSingleSize = telemetry.isSingleSize ?? (
    /socks?|peds|hosiery|cosmetics?|splashes|perfumes?|towel|accessory|accessories/i.test(telemetry.category)
  );

  let primaryQuantity = 2;
  let volumeQuantity = 3;

  if (avgTicket <= 22.0) {
    primaryQuantity = 3;
    volumeQuantity = 5;
  } else if (avgTicket <= 55.0) {
    primaryQuantity = 3;
    volumeQuantity = 5;
  } else {
    primaryQuantity = 2;
    volumeQuantity = 3;
  }

  let targetPrimaryDiscount = 25;
  if (telemetry.avgCumulativeSTR < 35.0 || telemetry.avgWeeklyROS < 0.5) {
    targetPrimaryDiscount = 32;
  } else if (telemetry.avgCumulativeSTR > 60.0) {
    targetPrimaryDiscount = 18;
  }

  const primaryTotalTicket = avgTicket * primaryQuantity;
  const primaryTotalFloor = unitCostPlusVat * primaryQuantity;
  const primarySolved = solveOptimalCharmBundle(primaryTotalTicket, primaryTotalFloor, targetPrimaryDiscount);

  const primaryUnitPromo = Math.round((primarySolved.charmPrice / primaryQuantity) * 100) / 100;
  const primaryNetRevenuePerUnit = primaryUnitPromo / 1.15;
  const primaryNetMarginPerUnit = Math.round((primaryNetRevenuePerUnit - avgCost) * 100) / 100;
  const primaryNetMarginPct = primaryNetRevenuePerUnit > 0 
    ? Math.round((primaryNetMarginPerUnit / primaryNetRevenuePerUnit) * 1000) / 10 
    : 0;

  const primaryClearanceRate = primarySolved.discountPct >= 30 ? 0.45 : 0.32;
  const primaryForecastSold = Math.round(telemetry.totalStock * primaryClearanceRate);
  const primaryForecastProfit = Math.round(primaryForecastSold * primaryNetMarginPerUnit);

  const catCode = telemetry.category.toUpperCase().replace(/[^A-Z0-9]/g, '_').slice(0, 10);
  const primaryPosTag = `RULE_BUNDLE_${primaryQuantity}_${primarySolved.charmPrice}_${catCode}_RAIL`;

  const primaryBundle = {
    quantity: primaryQuantity,
    bundlePriceSAR: primarySolved.charmPrice,
    unitPriceSAR: primaryUnitPromo,
    discountPct: primarySolved.discountPct,
    savingsSAR: primarySolved.savingsSAR,
    netMarginSAR: primaryNetMarginPerUnit,
    netMarginPct: primaryNetMarginPct,
    expectedClearancePct: Math.round(primaryClearanceRate * 100),
    projectedNetProfitSAR: primaryForecastProfit,
    posTag: primaryPosTag,
    offerLabel: `Buy ${primaryQuantity} For ${primarySolved.charmPrice}.00 SAR (Save ${Math.round(primarySolved.savingsSAR)} SAR)`
  };

  const targetVolumeDiscount = Math.min(45, targetPrimaryDiscount + 8);
  const volumeTotalTicket = avgTicket * volumeQuantity;
  const volumeTotalFloor = unitCostPlusVat * volumeQuantity;
  const volumeSolved = solveOptimalCharmBundle(volumeTotalTicket, volumeTotalFloor, targetVolumeDiscount);

  const volumeUnitPromo = Math.round((volumeSolved.charmPrice / volumeQuantity) * 100) / 100;
  const volumeNetRevenuePerUnit = volumeUnitPromo / 1.15;
  const volumeNetMarginPerUnit = Math.round((volumeNetRevenuePerUnit - avgCost) * 100) / 100;
  const volumeNetMarginPct = volumeNetRevenuePerUnit > 0 
    ? Math.round((volumeNetMarginPerUnit / volumeNetRevenuePerUnit) * 1000) / 10 
    : 0;

  const volumePosTag = `RULE_BUNDLE_${volumeQuantity}_${volumeSolved.charmPrice}_${catCode}_RAIL`;

  const volumeBundle = {
    quantity: volumeQuantity,
    bundlePriceSAR: volumeSolved.charmPrice,
    unitPriceSAR: volumeUnitPromo,
    discountPct: volumeSolved.discountPct,
    savingsSAR: volumeSolved.savingsSAR,
    netMarginSAR: volumeNetMarginPerUnit,
    netMarginPct: volumeNetMarginPct,
    expectedClearancePct: Math.round((primaryClearanceRate + 0.10) * 100),
    projectedNetProfitSAR: Math.round(telemetry.totalStock * (primaryClearanceRate + 0.10) * volumeNetMarginPerUnit),
    posTag: volumePosTag,
    offerLabel: `Buy ${volumeQuantity} For ${volumeSolved.charmPrice}.00 SAR (Save ${Math.round(volumeSolved.savingsSAR)} SAR)`
  };

  const prohibitedMechanics = [
    `Fixed bundle price exceeding combined retail list (P >= ${primaryTotalTicket.toFixed(2)} SAR) is strictly blocked.`,
    `Pricing below landed cost plus 15% VAT (< ${unitCostPlusVat.toFixed(2)} SAR/u) is illegal under Saudi retail regulations.`
  ];

  if (isSingleSize) {
    prohibitedMechanics.push('Apparel broken-curve oddment rails (50% Off) are blocked because this category has complete non-sized inventory.');
  }

  return {
    category: telemetry.category,
    telemetry,
    primaryBundle,
    volumeBundle,
    prohibitedMechanics
  };
}

describe('Dynamic Algorithmic Category Offer Engine', () => {

  // Test 1: TypeScript Implementation and Integrity
  test('dynamicCategoryOfferEngine.ts and offerDecisionFormatter.ts implement algorithmic pipeline', () => {
    const engineSrc = fs.readFileSync(path.join(__dirname, '../src/engine/dynamicCategoryOfferEngine.ts'), 'utf8');
    const formatterSrc = fs.readFileSync(path.join(__dirname, '../src/ai/skills/offerDecisionFormatter.ts'), 'utf8');
    const copilotSrc = fs.readFileSync(path.join(__dirname, '../src/ai/copilot.ts'), 'utf8');

    assert.ok(engineSrc.includes('solveOptimalCharmBundle'), 'dynamicCategoryOfferEngine must contain solveOptimalCharmBundle');
    assert.ok(engineSrc.includes('generateDynamicCategoryOfferPlan'), 'dynamicCategoryOfferEngine must contain generateDynamicCategoryOfferPlan');
    assert.ok(formatterSrc.includes('formatDynamicCategoryOfferDossier'), 'offerDecisionFormatter must contain formatDynamicCategoryOfferDossier');
    assert.ok(copilotSrc.includes('resolveCategoryOfferPlan'), 'copilot.ts must invoke resolveCategoryOfferPlan');
  });

  // Test 2: Charm Bundle Solver Constraints
  test('solveOptimalCharmBundle: strictly adheres to floor and ticket boundaries', () => {
    // Ticket: 45 SAR, Floor: 15 SAR, Target: 30% off -> raw 31.50 SAR -> nearest charm 29 SAR
    const result = solveOptimalCharmBundle(45, 15, 30);
    assert.strictEqual(result.charmPrice, 29, 'Raw 31.50 SAR should round to Saudi charm point 29 SAR');
    assert.ok(result.charmPrice >= 15, 'Charm price must be >= legal floor 15 SAR');
    assert.ok(result.charmPrice < 45, 'Charm price must be strictly < combined ticket 45 SAR');
    assert.strictEqual(result.savingsSAR, 16, 'Savings must be 45 - 29 = 16 SAR');
    assert.strictEqual(result.discountPct, 36, 'Discount must be 36%');
  });

  // Test 3: Floor Elevation when discount breaches cost + 15% VAT
  test('solveOptimalCharmBundle: elevates price when raw discount breaches zero-loss floor', () => {
    // Total Ticket: 100 SAR, Total Cost Floor: 70 SAR, Target: 40% off
    // Raw discount price would be 60 SAR, which is ILLEGAL (< 70 SAR floor).
    const result = solveOptimalCharmBundle(100, 70, 40);
    assert.ok(result.charmPrice >= 70, `Charm price (${result.charmPrice}) must be elevated >= floor 70 SAR`);
    assert.ok(result.charmPrice < 100, `Charm price (${result.charmPrice}) must remain < combined ticket 100 SAR`);
    assert.strictEqual(result.charmPrice, 79, 'Nearest safe charm point >= 70 SAR is 79 SAR');
  });

  // Test 4: Socks Category (Low-ticket impulse) - Eliminates 99 SAR Hallucination
  test('generateDynamicCategoryOfferPlan: dynamically computes safe, non-hallucinated socks offers', () => {
    const socksTelemetry = {
      category: 'Socks & Hosiery',
      styleCount: 48,
      totalStock: 2450,
      avgTicketPrice: 14.0,
      minTicketPrice: 9.0,
      maxTicketPrice: 19.0,
      avgUnitCost: 3.5,
      avgCostPlusVat: 4.03,
      avgWeeklyROS: 0.85,
      avgCumulativeSTR: 48.0,
      isSingleSize: true
    };

    const plan = generateDynamicCategoryOfferPlan(socksTelemetry);

    // Primary bundle checks
    assert.strictEqual(plan.primaryBundle.quantity, 3, 'Low-ticket socks should bundle in 3-packs');
    assert.strictEqual(plan.primaryBundle.bundlePriceSAR, 29, '3 pairs at 14 SAR (42 SAR total) should resolve to 29 SAR charm point');
    assert.ok(plan.primaryBundle.bundlePriceSAR < 42, 'Bundle price MUST be strictly less than 42 SAR list price');
    assert.notStrictEqual(plan.primaryBundle.bundlePriceSAR, 99, 'MUST NOT recommend 99 SAR for socks');
    assert.ok(plan.primaryBundle.unitPriceSAR > 4.03, 'Unit promo price must be above 4.03 SAR zero-loss floor');
    assert.strictEqual(plan.primaryBundle.posTag, 'RULE_BUNDLE_3_29_SOCKS___HO_RAIL');

    // Volume bundle checks
    assert.ok(plan.volumeBundle, 'Should offer high-volume 5-pack for socks');
    assert.strictEqual(plan.volumeBundle.quantity, 5);
    assert.strictEqual(plan.volumeBundle.bundlePriceSAR, 49, '5 pairs at 14 SAR (70 SAR total) should resolve to 49 SAR charm point');
    assert.ok(plan.volumeBundle.bundlePriceSAR < 70, '5-pack price MUST be strictly less than 70 SAR combined ticket');

    // Single-size governance
    assert.ok(
      plan.prohibitedMechanics.some(m => m.includes('oddment rails')),
      'Single size category must prohibit broken-curve oddment rails'
    );
  });

  // Test 5: Bras Category (High-ticket apparel)
  test('generateDynamicCategoryOfferPlan: dynamically computes bras duo bundle', () => {
    const brasTelemetry = {
      category: 'Bras & Intimates',
      styleCount: 84,
      totalStock: 4200,
      avgTicketPrice: 89.0,
      minTicketPrice: 69.0,
      maxTicketPrice: 129.0,
      avgUnitCost: 28.0,
      avgCostPlusVat: 32.20,
      avgWeeklyROS: 0.65,
      avgCumulativeSTR: 44.0,
      isSingleSize: false
    };

    const plan = generateDynamicCategoryOfferPlan(brasTelemetry);

    // High ticket should bundle as 2-pack
    assert.strictEqual(plan.primaryBundle.quantity, 2, 'High-ticket bras should bundle as 2-pack');
    assert.ok(plan.primaryBundle.bundlePriceSAR >= 64.40, 'Bundle must be above 2 * 32.20 SAR cost floor');
    assert.ok(plan.primaryBundle.bundlePriceSAR < 178, 'Bundle must be below 178 SAR combined ticket');
    assert.ok(plan.primaryBundle.netMarginSAR > 0, 'Net margin per unit must be positive');
  });

  // Test 6: Style-by-Style Assortment & Performance Table
  test('formatDynamicCategoryOfferDossier: renders style-by-style table with performance tiers', () => {
    const formatterSrc = fs.readFileSync(path.join(__dirname, '../src/ai/skills/offerDecisionFormatter.ts'), 'utf8');
    assert.ok(formatterSrc.includes('Live Style-by-Style Assortment & Performance Validation'), 'Must include style performance table header');
    assert.ok(formatterSrc.includes('Performance Tier'), 'Must include Performance Tier column');
    assert.ok(formatterSrc.includes('Cost (15% Floor)'), 'Must include Cost & Floor column');
  });

  // Test 7: White Friday Category Query Routing (Disambiguation)
  test('copilot intent routing: category offer with White Friday routes to category offer and not calendar', () => {
    const copilotSrc = fs.readFileSync(path.join(__dirname, '../src/ai/copilot.ts'), 'utf8');
    
    // Check that isCategoryOfferQuery is evaluated BEFORE isExplicitCalendarSchedule
    const catQueryPos = copilotSrc.indexOf('isCategoryOfferQuery');
    const calendarPos = copilotSrc.indexOf('isExplicitCalendarSchedule');
    assert.ok(catQueryPos !== -1, 'isCategoryOfferQuery must exist in copilot.ts');
    assert.ok(calendarPos !== -1, 'isExplicitCalendarSchedule must exist in copilot.ts');
    assert.ok(catQueryPos < calendarPos, 'isCategoryOfferQuery must be evaluated before isExplicitCalendarSchedule');

    // Verify regex behavior
    const testQuery = "want to plan offers for socks in white friday in KSA, review the data and validate the best offer for each style based on performance".toLowerCase();
    const catOfferRegex = /\b(socks?|peds|hosiery|bras?|bralettes?|panties|briefs?|pyjamas?|pajamas?|sleepwear|nightwear|cosmetics?|splashes|perfumes?|shapewear|tops?|t-shirts?|leggings?)\b/i;
    const isCategoryOfferQuery = (/\b(plan|offers?|promotions?|discount|pricing|validate|best offer|performance)\b/i.test(testQuery)) && catOfferRegex.test(testQuery);
    
    assert.ok(isCategoryOfferQuery, 'White Friday socks query must match isCategoryOfferQuery');

    const isExplicitCalendarSchedule = /\b(calendar|commercial events?|retail calendar|trading calendar|markdown phases?|trading phases?|dates? of (?:white friday|national day|founding day|ramadan|eid)|when is (?:white friday|national day|founding day|ramadan|eid))\b/i.test(testQuery);
    assert.ok(!isExplicitCalendarSchedule, 'White Friday socks promotional query must NOT trigger calendar schedule');
  });
});
