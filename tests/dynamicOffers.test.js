const test = require('node:test');
const assert = require('node:assert/strict');

const SAUDI_CHARM_PRICE_POINTS = [
  29, 39, 49, 59, 69, 79, 89, 99, 119, 129, 149, 169, 189, 199, 219, 249, 299, 349
];

function calculateZeroLossFloor(cost) {
  if (cost <= 0) return 0;
  return Math.round(cost * 1.15 * 100) / 100;
}

function calculateRailCostCeiling(bundlePrice, quantity) {
  if (quantity <= 0 || bundlePrice <= 0) return 0;
  const promoPerUnit = bundlePrice / quantity;
  return Math.floor((promoPerUnit / 1.15) * 100) / 100;
}

function isStyleEligibleForRail(landedCost, bundlePrice, quantity) {
  const ceiling = calculateRailCostCeiling(bundlePrice, quantity);
  return landedCost <= (ceiling + 0.005);
}

function generateSharedRailTag(bundlePrice, quantity) {
  const roundedPrice = Math.round(bundlePrice);
  return `RULE_BUNDLE_${quantity}_${roundedPrice}_RAIL`;
}

function roundToSaudiCharmPrice(rawPrice, floorPrice) {
  const points = SAUDI_CHARM_PRICE_POINTS.filter(p => p >= floorPrice);
  if (points.length === 0) return Math.ceil(floorPrice);

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

function computeDynamicBundle2(metrics) {
  const unitFloor = calculateZeroLossFloor(metrics.unitCost);
  const twoUnitFloor = unitFloor * 2;
  const twoUnitTicket = metrics.ticketPrice * 2;

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

  let targetDiscount = 0.25;
  let expectedClearance = 35;

  if (metrics.storeFloorWOS > 35.0 || metrics.cumulativeSTR < 30.0) {
    targetDiscount = 0.33;
    expectedClearance = 45;
  } else if (metrics.storeFloorWOS <= 20.0 && metrics.cumulativeSTR >= 50.0) {
    targetDiscount = 0.20;
    expectedClearance = 30;
  }

  const rawBundlePrice = twoUnitTicket * (1 - targetDiscount);
  let charmBundlePrice = roundToSaudiCharmPrice(rawBundlePrice, twoUnitFloor);

  if (charmBundlePrice >= twoUnitTicket) {
    const lowerPoints = SAUDI_CHARM_PRICE_POINTS.filter(p => p < twoUnitTicket && p >= twoUnitFloor);
    if (lowerPoints.length > 0) {
      charmBundlePrice = lowerPoints[lowerPoints.length - 1];
    } else {
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
  const offerLabel = `Buy 2 For ${charmBundlePrice} SAR (Save ${Math.round(savingsSAR)} SAR)`;
  const sharedRailTag = generateSharedRailTag(charmBundlePrice, 2);
  const railCostCeilingSAR = calculateRailCostCeiling(charmBundlePrice, 2);

  return {
    isBundleApplicable: true,
    bundleOfferLabel: offerLabel,
    bundleQuantity: 2,
    bundlePriceSAR: charmBundlePrice,
    unitPromoPriceSAR: unitPromoPrice,
    discountPct: realizedDiscountPct,
    savingsAmountSAR: savingsSAR,
    expectedClearancePct: expectedClearance,
    rationale: `Dynamic 2-pack bundle calibrated to performance (WOS ${metrics.storeFloorWOS.toFixed(1)} wks, STR ${metrics.cumulativeSTR.toFixed(1)}%). Drives 2.0 UPT at ${charmBundlePrice} SAR commercial charm point.`,
    sharedRailTag,
    railCostCeilingSAR
  };
}

function classifyStyleAndRecommend(metrics) {
  const costPlusVat = calculateZeroLossFloor(metrics.unitCost);

  if (metrics.ticketPrice < costPlusVat) {
    return {
      tier: 'FLAGGED_PRICE_ERROR',
      recommendedOffer: 'FLAGGED: System Price Error (0% Off)',
      discountPct: 0,
      promotionalPriceSAR: metrics.ticketPrice,
      expectedClearancePct: 0,
      zeroLossStatus: 'FLAGGED',
      bundleQuantity: 1
    };
  }

  const hasHistoricalSales = metrics.historicalASP !== undefined && metrics.historicalASP > 0;
  const histDiscountDepthPct = (hasHistoricalSales && metrics.ticketPrice > 0 && metrics.historicalASP < metrics.ticketPrice)
    ? Math.round((1 - (metrics.historicalASP / metrics.ticketPrice)) * 100)
    : 0;

  const seasonUpper = (metrics.season || '').toUpperCase();
  if (seasonUpper.includes('AW26') || seasonUpper.includes('WINTER 2026')) {
    return {
      tier: 'FRESH_WINTER',
      recommendedOffer: '100% Full Ticket Price (0% Off)',
      discountPct: 0,
      promotionalPriceSAR: metrics.ticketPrice,
      expectedClearancePct: 15,
      zeroLossStatus: 'YES',
      bundleQuantity: 1,
      historicalDiscountDepthPct: histDiscountDepthPct
    };
  }

  const isSingleSize = metrics.isSingleSize ?? (
    /cosmetics|towel|scarf|pillow|duvet|sheets|bandana|eye cover|sleeves|bundle/i.test(metrics.category) ||
    /\b(\d+ml|free size|one size|os)\b/i.test(metrics.productName)
  );

  if (isSingleSize) {
    if (metrics.cumulativeSTR >= 50.0 || metrics.weeklyROS >= 4.0) {
      return {
        tier: 'HERO_CORE',
        recommendedOffer: 'Full Price Margin Protection (0% Off)',
        discountPct: 0,
        promotionalPriceSAR: metrics.ticketPrice,
        expectedClearancePct: 25,
        zeroLossStatus: 'YES',
        bundleQuantity: 1,
        historicalDiscountDepthPct: histDiscountDepthPct
      };
    }
    if (metrics.totalPhysicalStock > 100) {
      const promoPrice = Math.max(costPlusVat, Math.round(metrics.ticketPrice * 0.80 * 100) / 100);
      return {
        tier: 'VOLUME_MULTI_BUY',
        recommendedOffer: 'Spend 250 Save 50 (Basket Pack)',
        discountPct: Math.round((1 - (promoPrice / metrics.ticketPrice)) * 100),
        promotionalPriceSAR: promoPrice,
        expectedClearancePct: 40,
        zeroLossStatus: 'YES',
        bundleQuantity: 1,
        historicalDiscountDepthPct: histDiscountDepthPct
      };
    } else {
      const promoPrice = Math.max(costPlusVat, Math.round(metrics.ticketPrice * 0.67 * 100) / 100);
      return {
        tier: 'VOLUME_MULTI_BUY',
        recommendedOffer: 'Beauty Multi-Buy (Buy 2 Get 1 Free)',
        discountPct: Math.round((1 - (promoPrice / metrics.ticketPrice)) * 100),
        promotionalPriceSAR: promoPrice,
        expectedClearancePct: 45,
        zeroLossStatus: 'YES',
        bundleQuantity: 3,
        historicalDiscountDepthPct: histDiscountDepthPct
      };
    }
  }

  if (metrics.cumulativeSTR >= 70.0 && metrics.activeSizeCount >= 3) {
    return {
      tier: 'HERO_CORE',
      recommendedOffer: 'Full Price Margin Protection (0% Off)',
      discountPct: 0,
      promotionalPriceSAR: metrics.ticketPrice,
      expectedClearancePct: 20,
      zeroLossStatus: 'YES',
      bundleQuantity: 1,
      historicalDiscountDepthPct: histDiscountDepthPct
    };
  }

  // Historical Discount Rule 1: High Organic Demand / Pricing Power Margin Protection
  const hasOrganicPricingPower = histDiscountDepthPct <= 10 && 
                                metrics.cumulativeSTR >= 40.0 && 
                                (metrics.momentumRatio || 1.0) >= 1.25 && 
                                metrics.activeSizeCount >= 3;

  if (hasOrganicPricingPower) {
    const bundle2 = computeDynamicBundle2(metrics);
    if (bundle2.isBundleApplicable) {
      return {
        tier: 'BUNDLE_2',
        recommendedOffer: bundle2.bundleOfferLabel,
        discountPct: bundle2.discountPct,
        promotionalPriceSAR: bundle2.unitPromoPriceSAR,
        expectedClearancePct: bundle2.expectedClearancePct,
        rationale: `Organic pricing power verified (historical discount ${histDiscountDepthPct}%). Preserves margin via 2-pack bundle rather than 40% exit markdown.`,
        zeroLossStatus: 'YES',
        bundleQuantity: bundle2.bundleQuantity,
        bundlePriceSAR: bundle2.bundlePriceSAR,
        sharedRailTag: bundle2.sharedRailTag,
        railCostCeilingSAR: bundle2.railCostCeilingSAR,
        historicalDiscountDepthPct: histDiscountDepthPct
      };
    } else {
      return {
        tier: 'HERO_CORE',
        recommendedOffer: 'Full Price Margin Protection (0% Off)',
        discountPct: 0,
        promotionalPriceSAR: metrics.ticketPrice,
        expectedClearancePct: 25,
        zeroLossStatus: 'YES',
        bundleQuantity: 1,
        bundlePriceSAR: metrics.ticketPrice,
        historicalDiscountDepthPct: histDiscountDepthPct
      };
    }
  }

  if (seasonUpper.includes('SS26') || seasonUpper.includes('SUMMER 2026')) {
    const rawPromo = Math.round(metrics.ticketPrice * 0.60 * 100) / 100;
    const safePromo = Math.max(costPlusVat, rawPromo);
    return {
      tier: 'MATURE_SUMMER_EXIT',
      recommendedOffer: 'Category Markdown 40% Off',
      discountPct: Math.round((1 - (safePromo / metrics.ticketPrice)) * 100),
      promotionalPriceSAR: safePromo,
      expectedClearancePct: 45,
      zeroLossStatus: 'YES',
      bundleQuantity: 1,
      historicalDiscountDepthPct: histDiscountDepthPct
    };
  }

  if (!isSingleSize && (metrics.cumulativeSTR < 10.0 || metrics.activeSizeCount <= 2 || metrics.storeFloorWOS > 40.0)) {
    if (metrics.ticketPrice <= 40.0) {
      const halfPrice = Math.round(metrics.ticketPrice * 0.50 * 100) / 100;
      const safePromo = Math.max(costPlusVat, halfPrice);
      return {
        tier: 'CLEARANCE_50_PCT',
        recommendedOffer: '50% Off Dedicated Clearance Rail',
        discountPct: Math.round((1 - (safePromo / metrics.ticketPrice)) * 100),
        promotionalPriceSAR: safePromo,
        expectedClearancePct: 50,
        zeroLossStatus: 'YES',
        bundleQuantity: 1,
        historicalDiscountDepthPct: histDiscountDepthPct
      };
    } else {
      const bundleUnit = 33.00;
      if (bundleUnit >= costPlusVat) {
        return {
          tier: 'CLEARANCE_3_FOR_99',
          recommendedOffer: 'Take 3 For 99 SAR Rail (33 SAR/u)',
          discountPct: Math.round((1 - (bundleUnit / metrics.ticketPrice)) * 100),
          promotionalPriceSAR: bundleUnit,
          expectedClearancePct: 55,
          zeroLossStatus: 'YES',
          bundleQuantity: 3,
          bundlePriceSAR: 99.00,
          sharedRailTag: generateSharedRailTag(99, 3),
          railCostCeilingSAR: calculateRailCostCeiling(99, 3),
          historicalDiscountDepthPct: histDiscountDepthPct
        };
      } else {
        const safePrice = Math.max(costPlusVat, Math.round(metrics.ticketPrice * 0.60 * 100) / 100);
        return {
          tier: 'CLEARANCE_PERCENT_SAFE',
          recommendedOffer: 'Clearance Rail (Safe Floor)',
          discountPct: Math.round((1 - (safePrice / metrics.ticketPrice)) * 100),
          promotionalPriceSAR: safePrice,
          expectedClearancePct: 40,
          zeroLossStatus: 'YES',
          bundleQuantity: 1,
          historicalDiscountDepthPct: histDiscountDepthPct
        };
      }
    }
  }

  if (!isSingleSize && metrics.activeSizeCount >= 3) {
    const bundle2 = computeDynamicBundle2(metrics);
    if (bundle2.isBundleApplicable) {
      return {
        tier: 'BUNDLE_2',
        recommendedOffer: bundle2.bundleOfferLabel,
        discountPct: bundle2.discountPct,
        promotionalPriceSAR: bundle2.unitPromoPriceSAR,
        expectedClearancePct: bundle2.expectedClearancePct,
        zeroLossStatus: 'YES',
        bundleQuantity: bundle2.bundleQuantity,
        bundlePriceSAR: bundle2.bundlePriceSAR,
        sharedRailTag: bundle2.sharedRailTag,
        railCostCeilingSAR: bundle2.railCostCeilingSAR,
        historicalDiscountDepthPct: histDiscountDepthPct
      };
    }
  }

  const rawSpendSave = Math.round(metrics.ticketPrice * 0.80 * 100) / 100;
  const spendSavePrice = Math.max(costPlusVat, rawSpendSave);
  return {
    tier: 'STEADY_ACTIVE',
    recommendedOffer: 'Spend & Save Eligible (~20% Off)',
    discountPct: Math.round((1 - (spendSavePrice / metrics.ticketPrice)) * 100),
    promotionalPriceSAR: spendSavePrice,
    expectedClearancePct: 25,
    zeroLossStatus: 'YES',
    bundleQuantity: 1,
    historicalDiscountDepthPct: histDiscountDepthPct
  };
}

test.describe('Dynamic Performance Offers & "Bundle 2" Engine', () => {

  test('Saudi Charm Price Rounding: always rounds to clean commercial points >= floor', () => {
    assert.equal(roundToSaudiCharmPrice(68, 20), 69);
    assert.equal(roundToSaudiCharmPrice(76, 20), 79);
    assert.equal(roundToSaudiCharmPrice(112, 40), 119);
    assert.equal(roundToSaudiCharmPrice(193, 80), 189);
    assert.equal(roundToSaudiCharmPrice(197, 80), 199);
    assert.equal(roundToSaudiCharmPrice(56, 30), 59);
    assert.equal(roundToSaudiCharmPrice(36, 20), 39);

    const highFloor = 95;
    const rounded = roundToSaudiCharmPrice(85, highFloor);
    assert.ok(rounded >= highFloor, `Expected rounded ${rounded} >= floor ${highFloor}`);
    assert.equal(rounded, 99);
  });

  test('Dynamic Bundle 2: computes accurate 2-pack bundle price and savings for Bras (79 SAR ticket)', () => {
    const braMetrics = {
      styleCode: '52084',
      productName: 'Soft Touch Comfort Bra',
      category: 'Bra',
      season: 'Continuity',
      unitCost: 18.50,
      ticketPrice: 79.00,
      totalPhysicalStock: 140,
      weeklyROS: 4.5,
      cumulativeSTR: 48.0,
      storeFloorWOS: 28.9,
      activeSizeCount: 4,
      isSingleSize: false
    };

    const bundle = computeDynamicBundle2(braMetrics);
    assert.equal(bundle.isBundleApplicable, true);
    assert.equal(bundle.bundleQuantity, 2);
    assert.equal(bundle.bundlePriceSAR, 119);
    assert.equal(bundle.unitPromoPriceSAR, 59.5);
    assert.equal(bundle.savingsAmountSAR, 39);
    assert.equal(bundle.discountPct, 25);
    assert.ok(bundle.bundleOfferLabel.includes('Buy 2 For 119 SAR'));
    assert.equal(bundle.sharedRailTag, 'RULE_BUNDLE_2_119_RAIL');
    assert.equal(bundle.railCostCeilingSAR, 51.73);
  });

  test('Dynamic Bundle 2: computes accurate bundle for Cotton Leggings (53.97 SAR ticket)', () => {
    const leggingMetrics = {
      styleCode: '50177',
      productName: 'Legging Cotton M133-N',
      category: 'Legging',
      season: 'Continuity',
      unitCost: 9.20,
      ticketPrice: 53.97,
      totalPhysicalStock: 210,
      weeklyROS: 3.2,
      cumulativeSTR: 52.4,
      storeFloorWOS: 18.5,
      activeSizeCount: 4,
      isSingleSize: false
    };

    const bundle = computeDynamicBundle2(leggingMetrics);
    assert.equal(bundle.isBundleApplicable, true);
    assert.equal(bundle.bundleQuantity, 2);
    assert.equal(bundle.bundlePriceSAR, 89);
    assert.equal(bundle.unitPromoPriceSAR, 44.5);
    assert.ok(bundle.bundleOfferLabel.includes('Buy 2 For 89 SAR'));
    assert.equal(bundle.sharedRailTag, 'RULE_BUNDLE_2_89_RAIL');
    assert.equal(bundle.railCostCeilingSAR, 38.69);
  });

  test('Universal Classification: Healthy Curve receives Bundle 2 while Broken Curve receives Clearance Rail', () => {
    const healthyStyle = {
      styleCode: '52084',
      productName: 'Soft Touch Comfort Bra',
      category: 'Bra',
      season: 'Continuity',
      unitCost: 18.50,
      ticketPrice: 79.00,
      totalPhysicalStock: 140,
      weeklyROS: 4.5,
      cumulativeSTR: 48.0,
      storeFloorWOS: 28.9,
      activeSizeCount: 4,
      isSingleSize: false
    };

    const healthyRec = classifyStyleAndRecommend(healthyStyle);
    assert.equal(healthyRec.tier, 'BUNDLE_2');
    assert.ok(healthyRec.recommendedOffer.includes('Buy 2 For 119 SAR'));
    assert.equal(healthyRec.promotionalPriceSAR, 59.50);
    assert.equal(healthyRec.sharedRailTag, 'RULE_BUNDLE_2_119_RAIL');
    assert.equal(healthyRec.railCostCeilingSAR, 51.73);

    const brokenStyle = {
      ...healthyStyle,
      activeSizeCount: 2
    };

    const brokenRec = classifyStyleAndRecommend(brokenStyle);
    assert.equal(brokenRec.tier, 'CLEARANCE_3_FOR_99');
    assert.ok(brokenRec.recommendedOffer.includes('Take 3 For 99 SAR'));
    assert.equal(brokenRec.promotionalPriceSAR, 33.00);
    assert.equal(brokenRec.sharedRailTag, 'RULE_BUNDLE_3_99_RAIL');
    assert.equal(brokenRec.railCostCeilingSAR, 28.69);
  });

  test('Universal Classification: Single-Size Cosmetic receives Basket Pack rather than clearance rail', () => {
    const cosmeticStyle = {
      styleCode: '59465',
      productName: 'Body splash Secret Desire 100ML',
      category: 'Cosmetics',
      season: 'Continuity',
      unitCost: 17.33,
      ticketPrice: 69.00,
      totalPhysicalStock: 395,
      weeklyROS: 2.2,
      cumulativeSTR: 24.1,
      storeFloorWOS: 152.3,
      activeSizeCount: 1,
      isSingleSize: true
    };

    const cosmeticRec = classifyStyleAndRecommend(cosmeticStyle);
    assert.equal(cosmeticRec.tier, 'VOLUME_MULTI_BUY');
    assert.equal(cosmeticRec.recommendedOffer, 'Spend 250 Save 50 (Basket Pack)');
    assert.equal(cosmeticRec.zeroLossStatus, 'YES');
    assert.ok(cosmeticRec.promotionalPriceSAR >= calculateZeroLossFloor(cosmeticStyle.unitCost));
  });

  test('Universal Classification: Hero Core with Healthy Curve receives 0% Margin Protection', () => {
    const heroStyle = {
      styleCode: '51111',
      productName: 'Hero Seamless Bra Top',
      category: 'Bra',
      season: 'Continuity',
      unitCost: 20.00,
      ticketPrice: 99.00,
      totalPhysicalStock: 80,
      weeklyROS: 8.0,
      cumulativeSTR: 76.5,
      storeFloorWOS: 10.0,
      activeSizeCount: 4,
      isSingleSize: false
    };

    const heroRec = classifyStyleAndRecommend(heroStyle);
    assert.equal(heroRec.tier, 'HERO_CORE');
    assert.equal(heroRec.discountPct, 0);
    assert.equal(heroRec.promotionalPriceSAR, 99.00);
    assert.ok(heroRec.recommendedOffer.includes('Full Price Margin Protection'));
  });

  test('SKU Anatomy Extraction: accurately parses model, color code, and size (e.g. 58401-27-M)', () => {
    function parseSku(sku) {
      const trimmed = sku.trim();
      const styleCode = trimmed.substring(0, 5);
      const afterFirstDash = trimmed.substring(6);
      const dashPos = afterFirstDash.indexOf('-');
      const color = dashPos > 0 ? afterFirstDash.substring(0, dashPos) : '';
      const size = dashPos > 0 ? afterFirstDash.substring(dashPos + 1) : afterFirstDash;
      return { styleCode, color, size };
    }

    const item1 = parseSku('58401-27-M');
    assert.equal(item1.styleCode, '58401');
    assert.equal(item1.color, '27');
    assert.equal(item1.size, 'M');

    const item2 = parseSku('58401-01-Free Size');
    assert.equal(item2.styleCode, '58401');
    assert.equal(item2.color, '01');
    assert.equal(item2.size, 'Free Size');

    const item3 = parseSku('55573-01-75B');
    assert.equal(item3.styleCode, '55573');
    assert.equal(item3.color, '01');
    assert.equal(item3.size, '75B');

    const skus = ['58401-27-M', '58401-01-M', '58401-27-S', '58401-01-S'];
    const distinctSizes = new Set(skus.map(s => parseSku(s).size));
    assert.equal(distinctSizes.size, 2);
  });

  test('Cross-Style Mix & Match: calculates rail cost ceilings and validates individual style eligibility', () => {
    // 2 for 299 SAR rail: 299 / 2 = 149.50 SAR incl VAT -> 149.50 / 1.15 = 130.00 SAR max cost ceiling
    const ceiling299 = calculateRailCostCeiling(299, 2);
    assert.equal(ceiling299, 130.00);

    // Style 58401 (Landed Cost: 46.95 SAR) is well under 130.00 SAR ceiling -> PASS
    assert.equal(isStyleEligibleForRail(46.95, 299, 2), true);

    // Style 58402 (Landed Cost: 42.50 SAR) -> PASS
    assert.equal(isStyleEligibleForRail(42.50, 299, 2), true);

    // Expensive Luxury Style (Landed Cost: 135.00 SAR) -> REJECTED (Zero-loss floor 155.25 > 149.50)
    assert.equal(isStyleEligibleForRail(135.00, 299, 2), false);

    // 3 for 99 SAR clearance rail: 99 / 3 = 33.00 SAR incl VAT -> 33.00 / 1.15 = 28.69 SAR ceiling
    const ceiling99 = calculateRailCostCeiling(99, 3);
    assert.equal(ceiling99, 28.69);
    assert.equal(isStyleEligibleForRail(15.00, 99, 3), true);
    assert.equal(isStyleEligibleForRail(30.00, 99, 3), false);

    // POS Rule Tag Generation
    assert.equal(generateSharedRailTag(299, 2), 'RULE_BUNDLE_2_299_RAIL');
    assert.equal(generateSharedRailTag(99, 3), 'RULE_BUNDLE_3_99_RAIL');
  });

  test('Historical Discount & Organic Pricing Power: Style 58401 avoids 40% markdown dilution and receives Buy 2 For 299 SAR bundle', () => {
    // Style 58401 Pyjama Pant SS26-PT-PJ-5163:
    // Historical sales: 262 units sold at 189.00 SAR, 20 units at 199.00 SAR -> Historical ASP: 189.71 SAR
    // Historical discount depth: 1 - (189.71 / 199.00) = 4.67% (~5%)
    // Cumulative STR: 45.4%, Momentum: +85% (ratio 1.85), Sizes: 4
    const pyjamaStyle = {
      styleCode: '58401',
      productName: 'Pyjama Pant SS26-PT-PJ-5163',
      category: 'Pyjama',
      season: 'SS26',
      unitCost: 46.95,
      ticketPrice: 199.00,
      totalPhysicalStock: 339,
      weeklyROS: 14.9,
      cumulativeSTR: 45.4,
      storeFloorWOS: 22.8,
      activeSizeCount: 4,
      isSingleSize: false,
      historicalASP: 189.71,
      momentumRatio: 1.85,
      momentumLabel: 'Surging'
    };

    const rec = classifyStyleAndRecommend(pyjamaStyle);
    // Despite having season 'SS26', it MUST NOT be given 40% exit markdown!
    assert.notEqual(rec.tier, 'MATURE_SUMMER_EXIT', 'Surging organic demand style must NOT be dumped into 40% exit markdown');
    assert.equal(rec.tier, 'BUNDLE_2');
    assert.ok(rec.recommendedOffer.includes('Buy 2 For 299 SAR'));
    assert.equal(rec.promotionalPriceSAR, 149.50);
    assert.equal(rec.historicalDiscountDepthPct, 5);
    assert.equal(rec.sharedRailTag, 'RULE_BUNDLE_2_299_RAIL');
    assert.equal(rec.railCostCeilingSAR, 130.00);
  });

});
