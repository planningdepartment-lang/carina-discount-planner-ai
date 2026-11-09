const { test, describe } = require('node:test');
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

  let targetDiscountPct = 0.25;
  if (metrics.cumulativeSTR >= 60.0) targetDiscountPct = 0.15;
  else if (metrics.cumulativeSTR >= 45.0) targetDiscountPct = 0.20;
  else if (metrics.cumulativeSTR >= 30.0) targetDiscountPct = 0.25;
  else targetDiscountPct = 0.30;

  const rawBundlePrice = twoUnitTicket * (1 - targetDiscountPct);
  const charmBundlePrice = roundToSaudiCharmPrice(rawBundlePrice, twoUnitFloor);
  const safeBundlePrice = Math.max(twoUnitFloor, charmBundlePrice);

  const unitPromoPrice = Math.round((safeBundlePrice / 2) * 100) / 100;
  const actualDiscountPct = Math.round((1 - (safeBundlePrice / twoUnitTicket)) * 100);

  return {
    isBundleApplicable: true,
    bundleOfferLabel: `Buy 2 For ${safeBundlePrice} SAR (${unitPromoPrice.toFixed(2)} SAR/u)`,
    bundlePriceSAR: safeBundlePrice,
    unitPromoPriceSAR: unitPromoPrice,
    discountPct: actualDiscountPct,
    expectedClearancePct: 40,
    rationale: `Dynamic Bundle 2 for healthy curve multi-size apparel.`
  };
}

function classifyStyleAndRecommend(metrics) {
  const costPlusVat = calculateZeroLossFloor(metrics.unitCost);

  // 0. Price error guard
  if (metrics.ticketPrice < costPlusVat) {
    return {
      tier: 'FLAGGED_PRICE_ERROR',
      recommendedOffer: 'FLAGGED: System Price Error (0% Off)',
      discountPct: 0,
      promotionalPriceSAR: metrics.ticketPrice,
      expectedClearancePct: 0,
      zeroLossStatus: 'FLAGGED'
    };
  }

  // 1. Fresh Winter 2026
  const seasonUpper = (metrics.season || '').toUpperCase();
  if (seasonUpper.includes('AW26') || seasonUpper.includes('WINTER 2026')) {
    return {
      tier: 'FRESH_WINTER',
      recommendedOffer: '100% Full Ticket Price (0% Off)',
      discountPct: 0,
      promotionalPriceSAR: metrics.ticketPrice,
      expectedClearancePct: 15,
      zeroLossStatus: 'YES'
    };
  }

  // Detect single-size
  const isSingleSize = metrics.isSingleSize || (
    /cosmetics|towel|scarf|pillow|duvet|sheets|bandana|eye cover|sleeves|bundle/i.test(metrics.category) ||
    /\b(\d+ml|free size|one size|os)\b/i.test(metrics.productName)
  );

  // Single-size promotional mechanics
  if (isSingleSize) {
    if (metrics.cumulativeSTR >= 50.0 || metrics.weeklyROS >= 4.0) {
      return {
        tier: 'HERO_CORE',
        recommendedOffer: 'Full Price Margin Protection (0% Off)',
        discountPct: 0,
        promotionalPriceSAR: metrics.ticketPrice,
        expectedClearancePct: 25,
        zeroLossStatus: 'YES'
      };
    }

    if (metrics.totalPhysicalStock > 100) {
      const promoPrice = Math.max(costPlusVat, Math.round(metrics.ticketPrice * 0.80 * 100) / 100);
      const discPct = Math.round((1 - (promoPrice / metrics.ticketPrice)) * 100);
      return {
        tier: 'VOLUME_MULTI_BUY',
        recommendedOffer: 'Spend 250 Save 50 (Basket Pack)',
        discountPct: discPct,
        promotionalPriceSAR: promoPrice,
        expectedClearancePct: 40,
        zeroLossStatus: 'YES'
      };
    } else {
      const promoPrice = Math.max(costPlusVat, Math.round(metrics.ticketPrice * 0.67 * 100) / 100);
      const discPct = Math.round((1 - (promoPrice / metrics.ticketPrice)) * 100);
      return {
        tier: 'VOLUME_MULTI_BUY',
        recommendedOffer: 'Beauty Multi-Buy (Buy 2 Get 1 Free)',
        discountPct: discPct,
        promotionalPriceSAR: promoPrice,
        expectedClearancePct: 45,
        zeroLossStatus: 'YES'
      };
    }
  }

  // Tier 1: Hero Core
  if (metrics.cumulativeSTR >= 70.0 && metrics.activeSizeCount >= 3) {
    return {
      tier: 'HERO_CORE',
      recommendedOffer: 'Full Price Margin Protection (0% Off)',
      discountPct: 0,
      promotionalPriceSAR: metrics.ticketPrice,
      expectedClearancePct: 20,
      zeroLossStatus: 'YES'
    };
  }

  // Tier 3: Summer 2026 exit
  if (seasonUpper.includes('SS26') || seasonUpper.includes('SUMMER 2026')) {
    const rawPromo = Math.round(metrics.ticketPrice * 0.60 * 100) / 100;
    const safePromo = Math.max(costPlusVat, rawPromo);
    const discPct = Math.round((1 - (safePromo / metrics.ticketPrice)) * 100);
    return {
      tier: 'MATURE_SUMMER_EXIT',
      recommendedOffer: 'Category Markdown 40% Off',
      discountPct: discPct,
      promotionalPriceSAR: safePromo,
      expectedClearancePct: 45,
      zeroLossStatus: 'YES'
    };
  }

  // Tier 4/5: Broken curve, stagnant, or runway overhang
  const isBrokenCurve = !isSingleSize && metrics.activeSizeCount <= 2;
  const isStagnant = !isSingleSize && metrics.cumulativeSTR < 10.0;
  const isOverhang = !isSingleSize && metrics.storeFloorWOS > 40.0 && metrics.cumulativeSTR < 30.0;

  if (isBrokenCurve || isStagnant || isOverhang) {
    if (metrics.ticketPrice <= 40.0) {
      const safePromo = Math.max(costPlusVat, Math.round(metrics.ticketPrice * 0.50 * 100) / 100);
      const discPct = Math.round((1 - (safePromo / metrics.ticketPrice)) * 100);
      return {
        tier: 'CLEARANCE_50_PCT',
        recommendedOffer: '50% Off Dedicated Clearance Rail',
        discountPct: discPct,
        promotionalPriceSAR: safePromo,
        expectedClearancePct: 50,
        zeroLossStatus: 'YES'
      };
    } else {
      const bundleUnit = 33.00;
      if (bundleUnit >= costPlusVat) {
        const discPct = Math.round((1 - (bundleUnit / metrics.ticketPrice)) * 100);
        return {
          tier: 'CLEARANCE_3_FOR_99',
          recommendedOffer: 'Take 3 For 99 SAR Rail (33 SAR/u)',
          discountPct: discPct,
          promotionalPriceSAR: bundleUnit,
          expectedClearancePct: 55,
          zeroLossStatus: 'YES'
        };
      } else {
        const safePromo = Math.max(costPlusVat, Math.round(metrics.ticketPrice * 0.60 * 100) / 100);
        const discPct = Math.round((1 - (safePromo / metrics.ticketPrice)) * 100);
        return {
          tier: 'CLEARANCE_PERCENT_SAFE',
          recommendedOffer: 'Clearance Rail (Safe Floor)',
          discountPct: discPct,
          promotionalPriceSAR: safePromo,
          expectedClearancePct: 40,
          zeroLossStatus: 'YES'
        };
      }
    }
  }

  // Tier 2: Dynamic Bundle 2 for healthy curve multi-size apparel
  if (!isSingleSize && metrics.activeSizeCount >= 3) {
    const bundle2 = computeDynamicBundle2(metrics);
    return {
      tier: 'BUNDLE_2',
      recommendedOffer: bundle2.bundleOfferLabel,
      discountPct: bundle2.discountPct,
      promotionalPriceSAR: bundle2.unitPromoPriceSAR,
      expectedClearancePct: bundle2.expectedClearancePct,
      zeroLossStatus: 'YES'
    };
  }

  return {
    tier: 'STEADY_ACTIVE',
    recommendedOffer: 'Spend 250 Save 50 (Basket Builder)',
    discountPct: 20,
    promotionalPriceSAR: Math.max(costPlusVat, Math.round(metrics.ticketPrice * 0.80 * 100) / 100),
    expectedClearancePct: 35,
    zeroLossStatus: 'YES'
  };
}

describe('Full 7-Tier Style Lifecycle Decision Cascade', () => {
  test('Tier 6 (FLAGGED_PRICE_ERROR): Detects list price below cost + 15% VAT', () => {
    const rec = classifyStyleAndRecommend({
      styleCode: '90001',
      productName: 'List Price Error Item',
      category: 'Top',
      season: 'Continuity',
      unitCost: 100.0,
      ticketPrice: 90.0, // Cost + VAT is 115 SAR!
      totalPhysicalStock: 50,
      activeSizeCount: 4,
      cumulativeSTR: 50.0,
      weeklyROS: 3.0,
      storeFloorWOS: 15.0
    });

    assert.equal(rec.tier, 'FLAGGED_PRICE_ERROR');
    assert.equal(rec.discountPct, 0);
    assert.equal(rec.zeroLossStatus, 'FLAGGED');
  });

  test('Tier 0 (FRESH_WINTER): Protects AW26 arrivals at 100% full ticket price', () => {
    const rec = classifyStyleAndRecommend({
      styleCode: '50177',
      productName: 'Heavy Knit Winter Cardigan',
      category: 'Knitwear',
      season: 'AW26',
      unitCost: 40.0,
      ticketPrice: 199.0,
      totalPhysicalStock: 200,
      activeSizeCount: 4,
      cumulativeSTR: 20.0,
      weeklyROS: 5.0,
      storeFloorWOS: 30.0
    });

    assert.equal(rec.tier, 'FRESH_WINTER');
    assert.equal(rec.discountPct, 0);
    assert.equal(rec.promotionalPriceSAR, 199.0);
    assert.equal(rec.zeroLossStatus, 'YES');
  });

  test('Tier 7 (VOLUME_MULTI_BUY): Single-size cosmetics receive basket builder, never clearance rail', () => {
    const rec = classifyStyleAndRecommend({
      styleCode: '59465',
      productName: 'Body Splash 100ML Secret Desire',
      category: 'Cosmetics',
      season: 'All Season 2018',
      unitCost: 10.0,
      ticketPrice: 49.0,
      totalPhysicalStock: 250,
      activeSizeCount: 1, // Only 1 size because it is a cosmetic!
      cumulativeSTR: 35.0,
      weeklyROS: 2.0,
      storeFloorWOS: 50.0
    });

    assert.equal(rec.tier, 'VOLUME_MULTI_BUY');
    assert.ok(rec.recommendedOffer.includes('Spend 250 Save 50'));
    assert.equal(rec.zeroLossStatus, 'YES');
  });

  test('Tier 1 (HERO_CORE): Apparel with STR >= 70% and healthy curve gets margin protection', () => {
    const rec = classifyStyleAndRecommend({
      styleCode: '50003',
      productName: 'Soft Seamless Bra',
      category: 'Bra',
      season: 'Continuity',
      unitCost: 15.0,
      ticketPrice: 79.0,
      totalPhysicalStock: 120,
      activeSizeCount: 4,
      cumulativeSTR: 78.5,
      weeklyROS: 6.2,
      storeFloorWOS: 18.0
    });

    assert.equal(rec.tier, 'HERO_CORE');
    assert.equal(rec.discountPct, 0);
    assert.equal(rec.promotionalPriceSAR, 79.0);
  });

  test('Tier 3 (MATURE_SUMMER_EXIT): Summer 2026 apparel receives 40% exit markdown', () => {
    const rec = classifyStyleAndRecommend({
      styleCode: '58424',
      productName: 'Pyjama Short SS26',
      category: 'Sleepwear',
      season: 'SS26',
      unitCost: 25.0,
      ticketPrice: 129.0,
      totalPhysicalStock: 80,
      activeSizeCount: 3,
      cumulativeSTR: 55.0,
      weeklyROS: 2.5,
      storeFloorWOS: 25.0
    });

    assert.equal(rec.tier, 'MATURE_SUMMER_EXIT');
    assert.equal(rec.discountPct, 40);
    assert.equal(rec.promotionalPriceSAR, 77.40);
  });

  test('Tier 4A (CLEARANCE_50_PCT): Broken curve apparel with ticket <= 40 SAR gets 50% rail', () => {
    const rec = classifyStyleAndRecommend({
      styleCode: '51101',
      productName: 'Basic Camisole',
      category: 'Top',
      season: 'Continuity',
      unitCost: 8.0,
      ticketPrice: 35.0,
      totalPhysicalStock: 40,
      activeSizeCount: 1, // Broken curve (<= 2 sizes)
      cumulativeSTR: 60.0,
      weeklyROS: 1.0,
      storeFloorWOS: 35.0
    });

    assert.equal(rec.tier, 'CLEARANCE_50_PCT');
    assert.equal(rec.discountPct, 50);
    assert.equal(rec.promotionalPriceSAR, 17.50);
  });

  test('Tier 4B (CLEARANCE_3_FOR_99): Broken curve apparel with ticket > 40 SAR gets 3-for-99 rail', () => {
    const rec = classifyStyleAndRecommend({
      styleCode: '52202',
      productName: 'Lace Trim Bralette',
      category: 'Bra',
      season: 'Continuity',
      unitCost: 15.0,
      ticketPrice: 89.0,
      totalPhysicalStock: 45,
      activeSizeCount: 2, // Broken curve (<= 2 sizes)
      cumulativeSTR: 50.0,
      weeklyROS: 1.2,
      storeFloorWOS: 32.0
    });

    assert.equal(rec.tier, 'CLEARANCE_3_FOR_99');
    assert.equal(rec.promotionalPriceSAR, 33.0);
    assert.ok(rec.recommendedOffer.includes('Take 3 For 99'));
  });

  test('Tier 2 (BUNDLE_2): Healthy curve multi-size apparel receives Dynamic Bundle 2', () => {
    const rec = classifyStyleAndRecommend({
      styleCode: '58401',
      productName: 'Cotton Leggings Full Length',
      category: 'Pants',
      season: 'Continuity',
      unitCost: 18.0,
      ticketPrice: 69.0,
      totalPhysicalStock: 160,
      activeSizeCount: 4,
      cumulativeSTR: 48.0,
      weeklyROS: 4.5,
      storeFloorWOS: 28.0
    });

    assert.equal(rec.tier, 'BUNDLE_2');
    assert.ok(rec.recommendedOffer.includes('Buy 2 For'));
    assert.ok(rec.promotionalPriceSAR < 69.0);
  });
});
