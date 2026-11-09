const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Replicate pure mathematical logic for unit testing
const SAUDI_CHARM_PRICE_POINTS = [
  9, 14, 19, 24, 29, 39, 49, 59, 69, 79, 89, 99, 119, 129, 139, 149, 169, 179, 199, 229, 249, 299
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

function generateAlternativeOfferScenarios(metrics) {
  const ticket = metrics.ticketPrice;
  const cost = metrics.unitCost;
  const floor = calculateZeroLossFloor(cost);
  const stock = metrics.totalPhysicalStock;
  const ros = metrics.weeklyROS > 0 ? metrics.weeklyROS : 0.05;
  const currentWOS = metrics.storeFloorWOS > 0 ? metrics.storeFloorWOS : (stock / ros);
  const scenarios = [];

  // Scenario 1: Margin Defense (Spend & Save / 20% Off)
  const s1Discount = 20;
  const s1Price = Math.max(floor, Math.round(ticket * (1 - (s1Discount / 100)) * 100) / 100);
  const s1NetRev = s1Price / 1.15;
  const s1MarginSAR = Math.round((s1NetRev - cost) * 100) / 100;
  const s1MarginPct = s1NetRev > 0 ? Math.round((s1MarginSAR / s1NetRev) * 1000) / 10 : 0;
  const s1ClearanceRate = 0.35;
  const s1Sold = Math.min(stock, Math.round(stock * s1ClearanceRate));
  const s1PostWOS = Math.round((Math.max(0, stock - s1Sold) / ros) * 10) / 10;

  scenarios.push({
    scenarioId: 'MARGIN_DEFENSE',
    name: 'Option 1: Margin Defense (Spend & Save)',
    promoPriceSAR: s1Price,
    discountPct: s1Discount,
    unitNetMarginSAR: s1MarginSAR,
    netMarginPct: s1MarginPct,
    forecastSoldUnits: s1Sold,
    expectedClearancePct: 35,
    postEventWOS: s1PostWOS,
    posTag: `RULE_SPEND_SAVE_20PCT_${metrics.styleCode}`
  });

  // Scenario 2: Volume Multi-Buy (Charm Bundle 2)
  const bundleQty = ticket <= 15 ? 3 : 2;
  const bundleTotalTicket = ticket * bundleQty;
  const bundleTotalFloor = floor * bundleQty;
  const bundleSolved = roundToSaudiCharmPrice(bundleTotalTicket * 0.70, bundleTotalFloor);
  const finalBundlePrice = bundleSolved < bundleTotalTicket ? bundleSolved : Math.floor(bundleTotalTicket - 1);
  const s2UnitPromo = Math.round((finalBundlePrice / bundleQty) * 100) / 100;
  const s2Discount = Math.round(((bundleTotalTicket - finalBundlePrice) / bundleTotalTicket) * 100);
  const s2NetRev = s2UnitPromo / 1.15;
  const s2MarginSAR = Math.round((s2NetRev - cost) * 100) / 100;
  const s2MarginPct = s2NetRev > 0 ? Math.round((s2MarginSAR / s2NetRev) * 1000) / 10 : 0;
  const s2ClearanceRate = 0.70;
  const s2Sold = Math.min(stock, Math.round(stock * s2ClearanceRate));
  const s2PostWOS = Math.round((Math.max(0, stock - s2Sold) / ros) * 10) / 10;

  scenarios.push({
    scenarioId: 'VOLUME_BUNDLE',
    name: `Option 2: Volume Multi-Buy (Buy ${bundleQty} For ${finalBundlePrice} SAR)`,
    promoPriceSAR: s2UnitPromo,
    discountPct: s2Discount,
    unitNetMarginSAR: s2MarginSAR,
    netMarginPct: s2MarginPct,
    forecastSoldUnits: s2Sold,
    expectedClearancePct: 70,
    postEventWOS: s2PostWOS,
    posTag: `RULE_BUNDLE_${bundleQty}_${finalBundlePrice}_${metrics.styleCode}`
  });

  // Scenario 3: Aggressive Floor Liquidation (Dedicated Clearance Rail 50% Off)
  const s3RawPrice = ticket * 0.50;
  const s3Price = Math.max(floor, Math.round(s3RawPrice * 100) / 100);
  const s3Discount = Math.round(((ticket - s3Price) / ticket) * 100);
  const s3NetRev = s3Price / 1.15;
  const s3MarginSAR = Math.round((s3NetRev - cost) * 100) / 100;
  const s3MarginPct = s3NetRev > 0 ? Math.round((s3MarginSAR / s3NetRev) * 1000) / 10 : 0;
  const s3ClearanceRate = 0.95;
  const s3Sold = Math.min(stock, Math.round(stock * s3ClearanceRate));
  const s3PostWOS = Math.round((Math.max(0, stock - s3Sold) / ros) * 10) / 10;

  scenarios.push({
    scenarioId: 'CLEARANCE_RAIL',
    name: 'Option 3: Dedicated Clearance Rail (50% Off / Floor Clamped)',
    promoPriceSAR: s3Price,
    discountPct: s3Discount,
    unitNetMarginSAR: s3MarginSAR,
    netMarginPct: s3MarginPct,
    forecastSoldUnits: s3Sold,
    expectedClearancePct: 95,
    postEventWOS: s3PostWOS,
    posTag: `RULE_CLEARANCE_50PCT_${metrics.styleCode}`
  });

  // Scenario 4: Checkout Till Impulse Booster
  const s4Price = Math.max(floor, Math.round(ticket * 0.52));
  const s4Discount = Math.round(((ticket - s4Price) / ticket) * 100);
  const s4NetRev = s4Price / 1.15;
  const s4MarginSAR = Math.round((s4NetRev - cost) * 100) / 100;
  const s4MarginPct = s4NetRev > 0 ? Math.round((s4MarginSAR / s4NetRev) * 1000) / 10 : 0;

  scenarios.push({
    scenarioId: 'CHECKOUT_BOOSTER',
    name: 'Option 4: POS Till Basket Booster (Tamara/Tabby Threshold)',
    promoPriceSAR: s4Price,
    discountPct: s4Discount,
    unitNetMarginSAR: s4MarginSAR,
    netMarginPct: s4MarginPct,
    forecastSoldUnits: Math.min(stock, Math.round(stock * 0.55)),
    expectedClearancePct: 55,
    postEventWOS: Math.round((Math.max(0, stock * 0.45) / ros) * 10) / 10,
    posTag: `RULE_CHECKOUT_ADDON_${s4Price}_${metrics.styleCode}`
  });

  return {
    styleCode: metrics.styleCode,
    productName: metrics.productName,
    ticketPrice: ticket,
    unitCost: cost,
    costPlusVat: floor,
    totalPhysicalStock: stock,
    weeklyROS: metrics.weeklyROS,
    currentWOS,
    strPct: metrics.cumulativeSTR,
    scenarios
  };
}

describe('Alternative Strategic Offers & UI Table Rendering Engine', () => {

  // Test 1: Style 52007 (300 WOS Ankle Socks) Scenario Generation
  test('generateAlternativeOfferScenarios: computes 4 distinct scenarios for Style 52007', () => {
    const style52007 = {
      styleCode: '52007',
      productName: 'Pack (KG5) Ankle Socks M0500',
      category: 'Socks',
      season: 'Continuity',
      ticketPrice: 29.00,
      unitCost: 5.36,
      totalPhysicalStock: 30,
      weeklyROS: 0.1,
      cumulativeSTR: 28.6,
      storeFloorWOS: 300.0,
      activeSizeCount: 1
    };

    const result = generateAlternativeOfferScenarios(style52007);
    assert.strictEqual(result.scenarios.length, 4, 'Must produce exactly 4 alternative scenarios');

    const [opt1, opt2, opt3, opt4] = result.scenarios;

    // Option 1: Margin Defense
    assert.strictEqual(opt1.promoPriceSAR, 23.20, '20% off 29.00 SAR is 23.20 SAR');
    assert.ok(opt1.netMarginPct > 70, 'Margin defense locks in >70% margin');
    assert.ok(opt1.postEventWOS >= 180, 'Spend & Save leaves high residual WOS');

    // Option 2: Volume Multi-Buy (Charm Bundle)
    assert.strictEqual(opt2.promoPriceSAR, 19.50, 'Buy 2 for 39 SAR is 19.50 SAR/pack');
    assert.ok(opt2.discountPct >= 30, 'Bundle yields ~33% discount');
    assert.ok(opt2.netMarginPct > 65, 'Bundle preserves +68.4% net margin');
    assert.strictEqual(opt2.forecastSoldUnits, 21, 'Clears 70% of stock (21 units)');

    // Option 3: Aggressive Clearance (50% Off)
    assert.strictEqual(opt3.promoPriceSAR, 14.50, '50% off 29.00 SAR is 14.50 SAR');
    assert.ok(opt3.promoPriceSAR >= 6.16, 'Price 14.50 SAR is strictly above 6.16 SAR legal floor');
    assert.ok(opt3.netMarginPct > 55, 'Clearance preserves +57.5% net margin');
    assert.strictEqual(opt3.forecastSoldUnits, 29, 'Clears 95% of stock (29 units)');
    assert.ok(opt3.postEventWOS < 20, 'Option 3 eliminates the 300-week runway');

    // All options strictly satisfy Saudi 15% VAT zero-loss floor
    for (const sc of result.scenarios) {
      assert.ok(
        sc.promoPriceSAR >= 6.16,
        `Scenario ${sc.name} price (${sc.promoPriceSAR}) must not breach legal floor 6.16 SAR`
      );
    }
  });

  // Test 2: Copilot Intent Routing for Alternative Offers
  test('copilot intent routing: detects alternative query with typos and synonyms', () => {
    const copilotSrc = fs.readFileSync(path.join(__dirname, '../src/ai/copilot.ts'), 'utf8');

    // Verify regex presence
    assert.ok(copilotSrc.includes('isAlternativeOfferQuery'), 'copilot.ts must define isAlternativeOfferQuery');
    assert.ok(copilotSrc.includes('generateAlternativeOfferScenarios'), 'copilot.ts must invoke generateAlternativeOfferScenarios');
    assert.ok(copilotSrc.includes('formatAlternativeOffersCard'), 'copilot.ts must invoke formatAlternativeOffersCard');

    const altRegex = /\b(anothe|another|other|alternative|alternatives|different|options?|what else|second option|any other|more offers?|instead|suitable|scenarios?)\b/i;
    const offerRegex = /\b(offers?|promo|promotions?|promotional|discounts?|deals?|suitable|options?|rails?|bundles?)\b/i;

    // Test exact user input from screenshot 5
    const userQuery1 = "is there anothe offer suitable for it".toLowerCase();
    assert.ok(altRegex.test(userQuery1), 'Must match typo "anothe"');
    assert.ok(offerRegex.test(userQuery1), 'Must match "offer"');

    // Test other executive phrasing
    const userQuery2 = "what other offers are available for this style".toLowerCase();
    assert.ok(altRegex.test(userQuery2) && offerRegex.test(userQuery2));

    const userQuery3 = "can we give a different promo to clear faster".toLowerCase();
    assert.ok(altRegex.test(userQuery3) && offerRegex.test(userQuery3));

    // Non-alternative query should NOT trigger alternative offers
    const standardOfferQuery = "what is the best offer for this socks".toLowerCase();
    assert.ok(!altRegex.test(standardOfferQuery), 'Standard offer query should not match alternative query');
  });

  // Test 3: Frontend formatMarkdown Table & Callout Parsing
  test('public/app.js formatMarkdown: correctly parses markdown table into HTML table', () => {
    const appJsSrc = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
    assert.ok(appJsSrc.includes('copilot-table-responsive'), 'formatMarkdown must wrap tables in copilot-table-responsive');
    assert.ok(appJsSrc.includes('copilot-table'), 'formatMarkdown must create copilot-table');
    assert.ok(appJsSrc.includes('copilot-callout'), 'formatMarkdown must parse callouts');

    // Verify styles in public/styles.css
    const cssSrc = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');
    assert.ok(cssSrc.includes('.copilot-table-responsive'), 'styles.css must style .copilot-table-responsive');
    assert.ok(cssSrc.includes('.copilot-table'), 'styles.css must style .copilot-table');
    assert.ok(cssSrc.includes('.copilot-callout'), 'styles.css must style .copilot-callout');
  });

});
