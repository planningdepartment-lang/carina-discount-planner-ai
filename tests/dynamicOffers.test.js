const test = require('node:test');
const assert = require('node:assert/strict');

const SAUDI_CHARM_PRICE_POINTS = [
  29, 39, 49, 59, 69, 79, 89, 99, 119, 129, 149, 169, 189, 199, 219, 249, 299, 349
];

function calculateZeroLossFloor(cost) {
  if (cost <= 0) return 0;
  return Math.round(cost * 1.15 * 100) / 100;
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

  return {
    isBundleApplicable: true,
    bundleOfferLabel: offerLabel,
    bundleQuantity: 2,
    bundlePriceSAR: charmBundlePrice,
    unitPromoPriceSAR: unitPromoPrice,
    discountPct: realizedDiscountPct,
    savingsAmountSAR: savingsSAR,
    expectedClearancePct: expectedClearance,
    rationale: `Dynamic 2-pack bundle calibrated to performance (WOS ${metrics.storeFloorWOS.toFixed(1)} wks, STR ${metrics.cumulativeSTR.toFixed(1)}%). Drives 2.0 UPT at ${charmBundlePrice} SAR commercial charm point.`
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

  const seasonUpper = (metrics.season || '').toUpperCase();
  if (seasonUpper.includes('AW26') || seasonUpper.includes('WINTER 2026')) {
    return {
      tier: 'FRESH_WINTER',
      recommendedOffer: '100% Full Ticket Price (0% Off)',
      discountPct: 0,
      promotionalPriceSAR: metrics.ticketPrice,
      expectedClearancePct: 15,
      zeroLossStatus: 'YES',
      bundleQuantity: 1
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
        bundleQuantity: 1
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
        bundleQuantity: 1
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
        bundleQuantity: 3
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
      bundleQuantity: 1
    };
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
      bundleQuantity: 1
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
        bundleQuantity: 1
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
          bundleQuantity: 3
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
          bundleQuantity: 1
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
        bundlePriceSAR: bundle2.bundlePriceSAR
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
    bundleQuantity: 1
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
    assert.equal(bundle.unitPromoPriceSAR, 59.50);
    assert.equal(bundle.savingsAmountSAR, 39.00);
    assert.equal(bundle.discountPct, 25);
    assert.ok(bundle.bundleOfferLabel.includes('Buy 2 For 119 SAR'));

    const costPlusVat = calculateZeroLossFloor(braMetrics.unitCost);
    assert.ok(bundle.unitPromoPriceSAR >= costPlusVat, 'Unit promo price must be >= landed cost + 15% VAT');
  });

  test('Dynamic Bundle 2: computes accurate bundle for Cotton Leggings (53.97 SAR ticket)', () => {
    const leggingMetrics = {
      styleCode: '50003',
      productName: 'Legging Cotton M133-N',
      category: 'Pants',
      season: 'Continuity',
      unitCost: 8.82,
      ticketPrice: 53.97,
      totalPhysicalStock: 386,
      weeklyROS: 14.5,
      cumulativeSTR: 58.4,
      storeFloorWOS: 21.7,
      activeSizeCount: 5,
      isSingleSize: false
    };

    const bundle = computeDynamicBundle2(leggingMetrics);
    assert.equal(bundle.isBundleApplicable, true);
    assert.equal(bundle.bundleQuantity, 2);
    assert.equal(bundle.bundlePriceSAR, 79);
    assert.equal(bundle.unitPromoPriceSAR, 39.50);
    assert.ok(bundle.bundleOfferLabel.includes('Buy 2 For 79 SAR'));
    assert.ok(bundle.unitPromoPriceSAR >= calculateZeroLossFloor(leggingMetrics.unitCost));
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
    assert.ok(healthyRec.recommendedOffer.startsWith('Buy 2 For'));
    assert.equal(healthyRec.bundleQuantity, 2);
    assert.equal(healthyRec.zeroLossStatus, 'YES');

    const brokenStyle = {
      styleCode: '50177',
      productName: 'Pyjama Set AW25-PJ-5017',
      category: 'Pyjama',
      season: 'AW25',
      unitCost: 42.49,
      ticketPrice: 149.00,
      totalPhysicalStock: 234,
      weeklyROS: 2.1,
      cumulativeSTR: 8.2,
      storeFloorWOS: 111.4,
      activeSizeCount: 1, // Broken curve
      isSingleSize: false
    };

    const brokenRec = classifyStyleAndRecommend(brokenStyle);
    assert.notEqual(brokenRec.tier, 'BUNDLE_2');
    assert.ok(brokenRec.recommendedOffer.includes('Clearance Rail'));
    assert.equal(brokenRec.zeroLossStatus, 'YES');
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

    // Real Odoo SKU Anatomy: {MODEL}-{COLOR}-{SIZE}
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

    // Multi-color same-size aggregation: 4 SKU rows across 2 colors with only 2 true sizes (S and M)
    const skus = ['58401-27-M', '58401-01-M', '58401-27-S', '58401-01-S'];
    const distinctSizes = new Set(skus.map(s => parseSku(s).size));
    assert.equal(distinctSizes.size, 2); // Correctly classified as broken oddment (<=2 true sizes), NOT 4!
  });

});
