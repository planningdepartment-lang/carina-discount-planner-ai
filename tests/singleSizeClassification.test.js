const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

function calculateZeroLossFloor(cost) {
  return Math.round(cost * 1.15 * 100) / 100;
}

function classifyStyleAndRecommend(metrics) {
  const costPlusVat = calculateZeroLossFloor(metrics.unitCost);
  
  const seasonUpper = (metrics.season || '').toUpperCase();
  if (seasonUpper.includes('AW26') || seasonUpper.includes('WINTER 2026')) {
    return {
      tier: 'FRESH_WINTER',
      recommendedOffer: '100% Full Ticket Price (0% Off)',
      discountPct: 0,
      promotionalPriceSAR: metrics.ticketPrice,
      zeroLossStatus: 'YES'
    };
  }

  const isSingleSize = metrics.isSingleSize ?? (
    /cosmetics|towel|scarf|pillow|duvet|sheets|bandana|eye cover|sleeves|bundle/i.test(metrics.category) ||
    /\b(\d+ml|free size|one size|os)\b/i.test(metrics.productName)
  );

  // Single-Size / Beauty Promotional Mechanics
  if (isSingleSize) {
    if (metrics.cumulativeSTR >= 50.0 || metrics.weeklyROS >= 4.0) {
      return {
        tier: 'HERO_CORE',
        recommendedOffer: 'Full Price Margin Protection (0% Off)',
        discountPct: 0,
        promotionalPriceSAR: metrics.ticketPrice,
        zeroLossStatus: 'YES'
      };
    }

    if (metrics.totalPhysicalStock > 100) {
      const promoPrice = Math.max(costPlusVat, Math.round(metrics.ticketPrice * 0.80 * 100) / 100);
      const discPct = metrics.ticketPrice > 0 ? Math.round((1 - (promoPrice / metrics.ticketPrice)) * 100) : 0;
      return {
        tier: 'VOLUME_MULTI_BUY',
        recommendedOffer: 'Spend 250 Save 50 (Basket Pack)',
        discountPct: discPct,
        promotionalPriceSAR: promoPrice,
        zeroLossStatus: 'YES'
      };
    } else {
      const promoPrice = Math.max(costPlusVat, Math.round(metrics.ticketPrice * 0.67 * 100) / 100);
      const discPct = metrics.ticketPrice > 0 ? Math.round((1 - (promoPrice / metrics.ticketPrice)) * 100) : 0;
      return {
        tier: 'VOLUME_MULTI_BUY',
        recommendedOffer: 'Beauty Multi-Buy (Buy 2 Get 1 Free)',
        discountPct: discPct,
        promotionalPriceSAR: promoPrice,
        zeroLossStatus: 'YES'
      };
    }
  }

  // Sized apparel clearance
  if (!isSingleSize && (metrics.cumulativeSTR < 10.0 || metrics.activeSizeCount <= 2 || metrics.storeFloorWOS > 40.0)) {
    if (metrics.ticketPrice <= 40.0) {
      const halfPrice = Math.round(metrics.ticketPrice * 0.50 * 100) / 100;
      const safePromo = Math.max(costPlusVat, halfPrice);
      return {
        tier: 'CLEARANCE_50_PCT',
        recommendedOffer: '50% Off Dedicated Clearance Rail',
        discountPct: Math.round((1 - (safePromo / metrics.ticketPrice)) * 100),
        promotionalPriceSAR: safePromo,
        zeroLossStatus: 'YES'
      };
    } else {
      const bundleUnit = 33.00;
      if (bundleUnit >= costPlusVat) {
        return {
          tier: 'CLEARANCE_3_FOR_99',
          recommendedOffer: 'Take 3 For 99 SAR Rail (33 SAR/u)',
          discountPct: Math.round((1 - (bundleUnit / metrics.ticketPrice)) * 100),
          promotionalPriceSAR: bundleUnit,
          zeroLossStatus: 'YES'
        };
      }
    }
  }

  return {
    tier: 'STEADY_ACTIVE',
    recommendedOffer: 'Spend & Save Eligible (~20% Off)',
    discountPct: 20,
    promotionalPriceSAR: Math.round(metrics.ticketPrice * 0.80 * 100) / 100,
    zeroLossStatus: 'YES'
  };
}

describe('Single-Size & Non-Sized Assortment Governance', () => {
  it('Style 59465 Body Splash is classified as single size and receives basket pack instead of clearance rail', () => {
    const splashMetrics = {
      styleCode: '59465',
      productName: 'Body splash Secret Desire 100ML',
      category: 'Cosmetics',
      season: 'All Season 2026',
      unitCost: 15.0,
      ticketPrice: 69.0,
      totalPhysicalStock: 395,
      stockAndalus: 27,
      stockYasmeen: 29,
      stockJouri: 9,
      stockWH: 330,
      weeklyROS: 3.5,
      cumulativeSTR: 17.5,
      storeFloorWOS: 18.5,
      activeSizeCount: 1,
      isSingleSize: true
    };

    const rec = classifyStyleAndRecommend(splashMetrics);
    
    // Crucial Assertions:
    assert.notEqual(rec.recommendedOffer, 'Take 3 For 99 SAR Rail (33 SAR/u)');
    assert.notEqual(rec.recommendedOffer, '50% Off Dedicated Clearance Rail');
    assert.equal(rec.recommendedOffer, 'Spend 250 Save 50 (Basket Pack)');
    assert.equal(rec.discountPct, 20);
    assert.equal(rec.promotionalPriceSAR, 55.2);
    assert.equal(rec.zeroLossStatus, 'YES');
  });

  it('Small stock cosmetic item receives Beauty Multi-Buy instead of apparel clearance', () => {
    const lipstickMetrics = {
      styleCode: '59400',
      productName: 'Lip Gloss Rose 15ML',
      category: 'Cosmetics',
      season: 'Continuity',
      unitCost: 10.0,
      ticketPrice: 49.0,
      totalPhysicalStock: 60,
      stockAndalus: 20,
      stockYasmeen: 20,
      stockJouri: 10,
      stockWH: 10,
      weeklyROS: 1.5,
      cumulativeSTR: 25.0,
      storeFloorWOS: 33.3,
      activeSizeCount: 1,
      isSingleSize: true
    };

    const rec = classifyStyleAndRecommend(lipstickMetrics);
    assert.equal(rec.recommendedOffer, 'Beauty Multi-Buy (Buy 2 Get 1 Free)');
    assert.equal(rec.zeroLossStatus, 'YES');
  });

  it('True sized apparel with <= 2 sizes correctly remains on apparel clearance rail', () => {
    const brokenTShirtMetrics = {
      styleCode: '50177',
      productName: 'Cotton Basic T-Shirt',
      category: 'Top',
      season: 'Continuity',
      unitCost: 15.0,
      ticketPrice: 49.0,
      totalPhysicalStock: 80,
      stockAndalus: 30,
      stockYasmeen: 30,
      stockJouri: 20,
      stockWH: 0,
      weeklyROS: 0.8,
      cumulativeSTR: 85.0,
      storeFloorWOS: 100.0,
      activeSizeCount: 1, // Only XS remains, M & L sold out!
      isSingleSize: false
    };

    const rec = classifyStyleAndRecommend(brokenTShirtMetrics);
    assert.equal(rec.recommendedOffer, 'Take 3 For 99 SAR Rail (33 SAR/u)');
    assert.equal(rec.promotionalPriceSAR, 33.0);
  });
});
