const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// Logic mirror of dynamic override options generation from public/app.js
function buildCandidateOffers(styleCode, name, cost, ticket, promo, offer, category = '', sizes = 2) {
  const floor = Math.round(cost * 1.15 * 100) / 100;
  const isSingleSize = /cosmetics|towel|scarf|pillow|duvet|sheets|bandana|eye cover|sleeves|bundle/i.test(category) || 
                       /\b(\d+ml|free size|one size|os)\b/i.test(name);

  const candidateOffers = [];

  // Primary AI Recommendation as top option
  candidateOffers.push({
    strategy: offer,
    price: promo,
    label: `🤖 AI Recommendation: ${offer} — ${promo.toFixed(2)} SAR`,
    isAiPrimary: true
  });

  if (isSingleSize) {
    const spend250Price = Math.max(floor, Math.round(ticket * 0.80 * 100) / 100);
    if (!offer.toLowerCase().includes('spend 250')) {
      candidateOffers.push({
        strategy: 'Spend 250 Save 50 (Basket Pack)',
        price: spend250Price,
        label: `Spend 250 Save 50 (Basket Pack) — ${spend250Price.toFixed(2)} SAR (20% Off)`
      });
    }

    const beautyMultiPrice = Math.max(floor, Math.round(ticket * (2 / 3) * 100) / 100);
    if (!offer.toLowerCase().includes('buy 2') && !offer.toLowerCase().includes('beauty multi')) {
      candidateOffers.push({
        strategy: 'Beauty Multi-Buy (Buy 2 Get 1 Free)',
        price: beautyMultiPrice,
        label: `Beauty Multi-Buy (Buy 2 Get 1 Free) — ${beautyMultiPrice.toFixed(2)} SAR/u (33% Off)`
      });
    }

    if (Math.abs(promo - ticket) > 0.05 && !offer.toLowerCase().includes('0% off')) {
      candidateOffers.push({
        strategy: 'Full Price Margin Protection (0% Off)',
        price: ticket,
        label: `Full Price Margin Protection (0% Off) — ${ticket.toFixed(2)} SAR`
      });
    }

    const mark40Price = Math.max(floor, Math.round(ticket * 0.60 * 100) / 100);
    if (!offer.toLowerCase().includes('40% off')) {
      candidateOffers.push({
        strategy: 'Category Markdown 40% Off',
        price: mark40Price,
        label: `Category Markdown 40% Off — ${mark40Price.toFixed(2)} SAR (40% Off)`
      });
    }

    const clear50Price = Math.max(floor, Math.round(ticket * 0.50 * 100) / 100);
    if (!offer.toLowerCase().includes('50% off')) {
      candidateOffers.push({
        strategy: '50% Off Dedicated Clearance Rail',
        price: clear50Price,
        label: `50% Off Dedicated Clearance Rail — ${clear50Price.toFixed(2)} SAR (50% Off)`
      });
    }
  } else if (sizes >= 3) {
    const bundleUnitPrice = Math.max(floor, Math.round(ticket * 0.75 * 100) / 100);
    const bundlePairPrice = Math.round(bundleUnitPrice * 2 * 100) / 100;
    if (!offer.toLowerCase().includes('bundle 2') && !offer.toLowerCase().includes('take 2')) {
      candidateOffers.push({
        strategy: `Dynamic Bundle 2 (Take 2 For ${bundlePairPrice} SAR)`,
        price: bundleUnitPrice,
        label: `Dynamic Bundle 2 (Take 2 For ${bundlePairPrice} SAR) — ${bundleUnitPrice.toFixed(2)} SAR/u (25% Off)`
      });
    }

    const spendSavePrice = Math.max(floor, Math.round(ticket * 0.80 * 100) / 100);
    if (!offer.toLowerCase().includes('spend & save')) {
      candidateOffers.push({
        strategy: 'Spend & Save Eligible (~20% Off)',
        price: spendSavePrice,
        label: `Spend & Save Eligible (~20% Off) — ${spendSavePrice.toFixed(2)} SAR (20% Off)`
      });
    }

    if (Math.abs(promo - ticket) > 0.05 && !offer.toLowerCase().includes('0% off')) {
      candidateOffers.push({
        strategy: 'Full Price Margin Protection (0% Off)',
        price: ticket,
        label: `Full Price Margin Protection (0% Off) — ${ticket.toFixed(2)} SAR`
      });
    }

    const mark40Price = Math.max(floor, Math.round(ticket * 0.60 * 100) / 100);
    if (!offer.toLowerCase().includes('40% off')) {
      candidateOffers.push({
        strategy: 'Category Markdown 40% Off',
        price: mark40Price,
        label: `Category Markdown 40% Off — ${mark40Price.toFixed(2)} SAR (40% Off)`
      });
    }

    const clear50Price = Math.max(floor, Math.round(ticket * 0.50 * 100) / 100);
    if (!offer.toLowerCase().includes('50% off')) {
      candidateOffers.push({
        strategy: '50% Off Dedicated Clearance Rail',
        price: clear50Price,
        label: `50% Off Dedicated Clearance Rail — ${clear50Price.toFixed(2)} SAR (50% Off)`
      });
    }
  } else {
    const rail33Price = Math.max(floor, 33.00);
    if (!offer.toLowerCase().includes('99') && !offer.toLowerCase().includes('3 for 99')) {
      candidateOffers.push({
        strategy: 'Take 3 For 99 SAR Rail (33 SAR/u)',
        price: rail33Price,
        label: `Take 3 For 99 SAR Rail — ${rail33Price.toFixed(2)} SAR/u`
      });
    }

    const clear50Price = Math.max(floor, Math.round(ticket * 0.50 * 100) / 100);
    if (!offer.toLowerCase().includes('50% off')) {
      candidateOffers.push({
        strategy: '50% Off Dedicated Clearance Rail',
        price: clear50Price,
        label: `50% Off Dedicated Clearance Rail — ${clear50Price.toFixed(2)} SAR (50% Off)`
      });
    }

    const mark40Price = Math.max(floor, Math.round(ticket * 0.60 * 100) / 100);
    if (!offer.toLowerCase().includes('40% off')) {
      candidateOffers.push({
        strategy: 'Category Markdown 40% Off',
        price: mark40Price,
        label: `Category Markdown 40% Off — ${mark40Price.toFixed(2)} SAR (40% Off)`
      });
    }

    if (Math.abs(promo - ticket) > 0.05 && !offer.toLowerCase().includes('0% off')) {
      candidateOffers.push({
        strategy: 'Full Price Margin Protection (0% Off)',
        price: ticket,
        label: `Full Price Margin Protection (0% Off) — ${ticket.toFixed(2)} SAR`
      });
    }
  }

  candidateOffers.push({
    strategy: 'CUSTOM',
    price: null,
    label: '✏️ Custom Promotional Price...'
  });

  return candidateOffers;
}

describe('Dynamic Override Modal & Exact Price Synchronization', () => {
  test('Style 59465 (Body splash Secret Desire 100ML) offers are tailored to cosmetics with accurate price binding', () => {
    // Style 59465: Cost 15.07 SAR, Floor 17.33 SAR, Ticket 69.00 SAR, Promo 55.20 SAR
    const offers = buildCandidateOffers('59465', 'Body splash Secret Desire 100ML', 15.07, 69.00, 55.20, 'Spend 250 Save 50 (Basket Pack)', 'Cosmetics', 1);

    // Primary AI option
    assert.equal(offers[0].strategy, 'Spend 250 Save 50 (Basket Pack)');
    assert.equal(offers[0].price, 55.20);
    assert.ok(offers[0].label.includes('🤖 AI Recommendation'));

    // Must NOT contain apparel broken curve 3 for 99 SAR rail
    assert.equal(offers.some(o => o.strategy.includes('Take 3 For 99')), false, 'Single-size cosmetics must NOT have apparel 3 for 99 rail');

    // Full Price Margin Protection price must be 69.00 SAR (NOT 16.50 SAR!)
    const fullPriceOpt = offers.find(o => o.strategy.includes('Full Price'));
    assert.ok(fullPriceOpt, 'Must offer Full Price option');
    assert.equal(fullPriceOpt.price, 69.00, 'Full price for 69 SAR ticket must be exactly 69.00 SAR');

    // 50% Off Dedicated Clearance Rail price must be 34.50 SAR (NOT 16.50 SAR!)
    const halfPriceOpt = offers.find(o => o.strategy.includes('50% Off'));
    assert.ok(halfPriceOpt, 'Must offer 50% off clearance option');
    assert.equal(halfPriceOpt.price, 34.50, '50% off 69 SAR ticket must be 34.50 SAR');

    // All prices must satisfy Saudi 15% VAT floor (17.33 SAR)
    for (const opt of offers) {
      if (opt.price !== null) {
        assert.ok(opt.price >= 17.33, `Option ${opt.strategy} price (${opt.price}) must be >= floor (17.33)`);
      }
    }
  });

  test('Healthy Multi-Size Apparel (Style 50177) offers include Dynamic Bundle 2', () => {
    // Style 50177: Cost 9.20 SAR, Floor 10.58 SAR, Ticket 59.00 SAR, Promo 44.25 SAR, Sizes 4
    const offers = buildCandidateOffers('50177', 'Legging Cotton M133-N', 9.20, 59.00, 44.25, 'Take 3 For 99 SAR Rail (33 SAR/u)', 'Legging', 4);

    const bundle2Opt = offers.find(o => o.strategy.includes('Dynamic Bundle 2'));
    assert.ok(bundle2Opt, 'Healthy curve apparel must have Dynamic Bundle 2 option');
    assert.ok(bundle2Opt.price > 10.58, 'Bundle unit price must exceed floor');
  });
});
