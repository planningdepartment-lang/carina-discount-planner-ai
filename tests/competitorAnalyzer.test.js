const test = require('node:test');
const assert = require('node:assert/strict');

const KSA_COMPETITOR_BENCHMARKS = [
  // --- 1. Pyjamas & Nightwear ---
  {
    competitor: 'Nayomi',
    category: 'Pyjamas',
    subCategory: 'Satin & Cotton Loungewear Sets',
    regularTicketSAR: 199.00,
    promotionalOffer: '2 Sets for 199 SAR (Multi-Buy)',
    effectivePromoPriceSAR: 99.50,
    impliedDiscountPct: 50.0,
    marketPositioning: 'Romantic Glamour / Bridal Gifting'
  },
  {
    competitor: 'Blooming',
    category: 'Pyjamas',
    subCategory: 'Casual Sleepwear & Cotton Sets',
    regularTicketSAR: 139.00,
    promotionalOffer: '3 Pieces for 99 SAR Clearance Rail',
    effectivePromoPriceSAR: 33.00,
    impliedDiscountPct: 76.3,
    marketPositioning: 'Modern Everyday Comfort / Value Clearance'
  },

  // --- 2. Bras & Lingerie ---
  {
    competitor: 'Nayomi',
    category: 'Bra',
    subCategory: 'Everyday T-Shirt & Glamour Bras',
    regularTicketSAR: 129.00,
    promotionalOffer: 'Buy 2 Get 1 Free (2 for 149 SAR)',
    effectivePromoPriceSAR: 74.50,
    impliedDiscountPct: 42.2,
    marketPositioning: 'Premium Fit / Push-Up & Lace'
  },
  {
    competitor: 'Blooming',
    category: 'Bra',
    subCategory: 'Comfort Wireless & T-Shirt Bras',
    regularTicketSAR: 89.00,
    promotionalOffer: '2 for 99 SAR Multi-Buy',
    effectivePromoPriceSAR: 49.50,
    impliedDiscountPct: 44.4,
    marketPositioning: 'Seamless Everyday Basics'
  },

  // --- 3. Briefs & Panties ---
  {
    competitor: 'Nayomi',
    category: 'Brief',
    subCategory: 'Lace & Cotton Brief Packs',
    regularTicketSAR: 45.00,
    promotionalOffer: '3 Panties for 69 SAR Pack',
    effectivePromoPriceSAR: 23.00,
    impliedDiscountPct: 48.9,
    marketPositioning: 'Coordinated Lace Sets'
  },
  {
    competitor: 'Blooming',
    category: 'Brief',
    subCategory: 'Seamless Cotton Daily Briefs',
    regularTicketSAR: 29.00,
    promotionalOffer: '5 Panties for 79 SAR Bundle',
    effectivePromoPriceSAR: 15.80,
    impliedDiscountPct: 45.5,
    marketPositioning: 'High-Volume Cotton Multi-packs'
  },

  // --- 4. Shapewear & Body Contouring ---
  {
    competitor: 'Nayomi',
    category: 'Shapewear',
    subCategory: 'Waist Cinchers & Bodysuits',
    regularTicketSAR: 169.00,
    promotionalOffer: 'Buy 1 Get 1 at 50% Off',
    effectivePromoPriceSAR: 126.75,
    impliedDiscountPct: 25.0,
    marketPositioning: 'Targeted Compression & Bridal Sculpt'
  },
  {
    competitor: 'Blooming',
    category: 'Shapewear',
    subCategory: 'Seamless Shapers & High-Waist Briefs',
    regularTicketSAR: 99.00,
    promotionalOffer: '2 Shapers for 129 SAR',
    effectivePromoPriceSAR: 64.50,
    impliedDiscountPct: 34.8,
    marketPositioning: 'Postpartum & Daily Tummy Control'
  },

  // --- 5. Cosmetics, Fragrances & Body Splashes ---
  {
    competitor: 'Nayomi',
    category: 'Cosmetics',
    subCategory: 'Body Mists & Fragrances 250ML',
    regularTicketSAR: 89.00,
    promotionalOffer: 'Any 2 Mists for 99 SAR',
    effectivePromoPriceSAR: 49.50,
    impliedDiscountPct: 44.4,
    marketPositioning: 'Signature Perfumed Mists'
  },
  {
    competitor: 'Blooming',
    category: 'Cosmetics',
    subCategory: 'Body Splashes & Scents 150ML',
    regularTicketSAR: 49.00,
    promotionalOffer: 'Flat 35 SAR Promotional Price',
    effectivePromoPriceSAR: 35.00,
    impliedDiscountPct: 28.6,
    marketPositioning: 'Impulse Basket Add-on'
  },

  // --- 6. Socks & Hosiery ---
  {
    competitor: 'Nayomi',
    category: 'Socks',
    subCategory: 'Cotton Peds, Slipper Socks & Microfiber Hosiery',
    regularTicketSAR: 29.00,
    promotionalOffer: 'Any 2 Packs for 39 SAR (~8.00 SAR/u)',
    effectivePromoPriceSAR: 8.00,
    impliedDiscountPct: 44.8,
    marketPositioning: 'Coordinated Lace Trim & Soft Slipper Socks'
  },
  {
    competitor: 'Blooming',
    category: 'Socks',
    subCategory: 'Invisible Cotton Peds & Sneaker Socks (3-Pack)',
    regularTicketSAR: 25.00,
    promotionalOffer: 'Flat 15 SAR Multi-Pack (5.00 SAR/pair)',
    effectivePromoPriceSAR: 5.00,
    impliedDiscountPct: 40.0,
    marketPositioning: 'Everyday High-Volume Footwear Basics'
  },

  // --- 7. Basics, Tops & Layering ---
  {
    competitor: 'Nayomi',
    category: 'Basics',
    subCategory: 'Cotton Camisoles, Tank Tops & Layering',
    regularTicketSAR: 59.00,
    promotionalOffer: '2 Tops for 79 SAR',
    effectivePromoPriceSAR: 39.50,
    impliedDiscountPct: 33.1,
    marketPositioning: 'Lace Trim Silk/Cotton Blend Basics'
  },
  {
    competitor: 'Blooming',
    category: 'Basics',
    subCategory: 'Everyday T-Shirts, Tops & Pullovers',
    regularTicketSAR: 45.00,
    promotionalOffer: '2 for 59 SAR Multi-Buy',
    effectivePromoPriceSAR: 29.50,
    impliedDiscountPct: 34.4,
    marketPositioning: 'Seamless Cotton Layering Essentials'
  },

  // --- 8. Home, Bedding & Modest Accessories ---
  {
    competitor: 'Nayomi',
    category: 'Accessories',
    subCategory: 'Bath Towels, Hair Wraps & Silk Eye Masks',
    regularTicketSAR: 39.00,
    promotionalOffer: 'Special 25 SAR Promo Point',
    effectivePromoPriceSAR: 25.00,
    impliedDiscountPct: 35.9,
    marketPositioning: 'Luxury Bath & Bedtime Accessories'
  },
  {
    competitor: 'Blooming',
    category: 'Accessories',
    subCategory: 'Cotton Towels, Head Scarves & Hair Accessories',
    regularTicketSAR: 29.00,
    promotionalOffer: 'Flat 19 SAR Price Point',
    effectivePromoPriceSAR: 19.00,
    impliedDiscountPct: 34.5,
    marketPositioning: 'Practical Daily Living Accessories'
  }
];

function normalizeCategoryToCompetitor(category, productName = '', ticketPrice = 0) {
  const c = (category || '').toLowerCase();
  const p = (productName || '').toLowerCase();

  if (
    c.includes('sock') || c.includes('ped') || c.includes('hosiery') || 
    c.includes('panty hose') || c.includes('tight') || 
    p.includes('sock') || p.includes('ped') || p.includes('tight') || p.includes('den')
  ) {
    return 'Socks';
  }
  if (
    c.includes('bra') || p.includes('bra') || p.includes('bralette') || 
    c.includes('corset') || p.includes('corset')
  ) {
    return 'Bra';
  }
  if (
    c.includes('brief') || c.includes('panty') || c.includes('bikini') || 
    p.includes('brief') || p.includes('panty') || p.includes('bikini') || 
    p.includes('thong') || p.includes('boxer')
  ) {
    return 'Brief';
  }
  if (
    c.includes('cosmetic') || c.includes('fragrance') || c.includes('splash') || 
    p.includes('perfume') || p.includes('splash') || p.includes('mist') || 
    p.includes('scent')
  ) {
    return 'Cosmetics';
  }
  if (
    c.includes('towel') || c.includes('sheet') || c.includes('pillow') || 
    c.includes('duvet') || c.includes('scarf') || c.includes('neck cover') || 
    c.includes('bandana') || c.includes('sleeves') || c.includes('eye cover') || 
    c.includes('prayer') || c.includes('abaya') || c.includes('accessory') ||
    p.includes('towel') || p.includes('scarf') || p.includes('pillow') || 
    p.includes('bandana') || p.includes('sleeves')
  ) {
    return 'Accessories';
  }
  if (
    c.includes('top') || c.includes('t-shirt') || c.includes('shirt') || 
    c.includes('pullover') || c.includes('cardigan') || c.includes('coat') || 
    c.includes('jacket') || c.includes('vest') || c.includes('thermal') || 
    c.includes('skirt') || c.includes('blouse') ||
    p.includes('top') || p.includes('t-shirt') || p.includes('shirt') || 
    p.includes('pullover') || p.includes('cardigan')
  ) {
    return 'Basics';
  }
  if (
    c.includes('shapewear') || c.includes('body') || c.includes('bermuda') || 
    c.includes('trunk') || c.includes('boxer') || 
    p.includes('shapewear') || p.includes('cincher') || p.includes('shaper')
  ) {
    return 'Shapewear';
  }
  if (
    c.includes('pyjama') || c.includes('pijama') || c.includes('robe') || 
    c.includes('night') || c.includes('gown') || c.includes('kimono') || 
    c.includes('pant') || c.includes('short') || c.includes('dress') || 
    c.includes('set') ||
    p.includes('pyjama') || p.includes('pj') || p.includes('robe') || 
    p.includes('night') || p.includes('kimono') || p.includes('short')
  ) {
    if (ticketPrice > 0 && ticketPrice <= 15.0) {
      return 'Socks';
    }
    return 'Pyjamas';
  }

  if (ticketPrice > 0 && ticketPrice <= 20.0) {
    return 'Socks';
  }
  if (ticketPrice > 0 && ticketPrice <= 60.0) {
    return 'Basics';
  }

  return 'Pyjamas';
}

const SAUDI_CHARM_PRICE_POINTS = [
  9, 12, 15, 19, 25, 29, 39, 49, 59, 69, 79, 89, 99, 119, 129, 149, 169, 189, 199, 219, 249, 299, 349
];

function resolveSafeBundlePrice(preferredPrice, quantity, unitCost, ticketPrice) {
  const legalUnitFloor = unitCost > 0 ? Math.ceil(unitCost * 1.15 * 100) / 100 : 0;
  const totalFloor = legalUnitFloor * quantity;
  const totalTicket = ticketPrice * quantity;

  if (totalFloor <= 0 || preferredPrice >= totalFloor) {
    return {
      bundlePrice: preferredPrice,
      unitPrice: Math.round((preferredPrice / quantity) * 100) / 100,
      isElevatedForFloor: false,
      legalFloor: legalUnitFloor
    };
  }

  const safeCandidates = SAUDI_CHARM_PRICE_POINTS.filter(p => p >= totalFloor && (totalTicket <= 0 || p < totalTicket));
  if (safeCandidates.length > 0) {
    const safeBundle = safeCandidates[0];
    return {
      bundlePrice: safeBundle,
      unitPrice: Math.round((safeBundle / quantity) * 100) / 100,
      isElevatedForFloor: true,
      legalFloor: legalUnitFloor
    };
  }

  const fallbackBundle = Math.ceil(totalFloor);
  return {
    bundlePrice: fallbackBundle,
    unitPrice: Math.round((fallbackBundle / quantity) * 100) / 100,
    isElevatedForFloor: true,
    legalFloor: legalUnitFloor
  };
}

function analyzeCompetitorPosition(category, productName, carinaTicketSAR, carinaPromoPriceSAR, unitCost = 0) {
  let normCat = normalizeCategoryToCompetitor(category, productName, carinaTicketSAR);

  if (carinaTicketSAR > 0 && carinaTicketSAR <= 15.0 && (normCat === 'Pyjamas' || normCat === 'Shapewear')) {
    normCat = 'Socks';
  }

  const nayomi = KSA_COMPETITOR_BENCHMARKS.find(b => b.competitor === 'Nayomi' && b.category === normCat) ||
    KSA_COMPETITOR_BENCHMARKS[0];

  const blooming = KSA_COMPETITOR_BENCHMARKS.find(b => b.competitor === 'Blooming' && b.category === normCat) ||
    KSA_COMPETITOR_BENCHMARKS[1];

  const rawNayomi = nayomi.effectivePromoPriceSAR > 0
    ? Math.round((carinaPromoPriceSAR / nayomi.effectivePromoPriceSAR) * 1000) / 10
    : 100.0;
  const priceIndexVsNayomi = Math.max(25.0, Math.min(300.0, rawNayomi));

  const rawBlooming = blooming.effectivePromoPriceSAR > 0
    ? Math.round((carinaPromoPriceSAR / blooming.effectivePromoPriceSAR) * 1000) / 10
    : 100.0;
  const priceIndexVsBlooming = Math.max(25.0, Math.min(300.0, rawBlooming));

  const blendedMarketPriceIndex = Math.round(((priceIndexVsNayomi + priceIndexVsBlooming) / 2) * 10) / 10;

  let competitivePosture = 'MARKET_PARITY';
  let competitorDemandDrag = 1.00;

  if (blendedMarketPriceIndex < 88.0) {
    competitivePosture = 'VALUE_LEADER';
    competitorDemandDrag = 1.12;
  } else if (blendedMarketPriceIndex > 108.0) {
    competitivePosture = 'PREMIUM_EXPOSURE';
    competitorDemandDrag = 0.82;
  } else {
    competitivePosture = 'MARKET_PARITY';
    competitorDemandDrag = 1.00;
  }

  let tacticalCounterOffer = '';
  let tacticalRationale = '';

  if (carinaTicketSAR > 0 && carinaTicketSAR <= 15.0) {
    tacticalCounterOffer = `Impulse Multipack (Buy 3 For 15 SAR / 5.00 SAR/u) or Impulse Add-On (${carinaPromoPriceSAR.toFixed(2)} SAR)`;
    tacticalRationale = `Low-ticket impulse accessory. Merchandised at POS cash counter to drive basket UPT and beat Blooming's 5.00 SAR unit pricing.`;
  } else if (normCat === 'Socks') {
    tacticalCounterOffer = 'Multipack Bundle (Buy 2 Packs For 35 SAR)';
    tacticalRationale = `Matches Blooming's bundle price point directly while defending landed cost floor.`;
  } else if (normCat === 'Pyjamas') {
    if (carinaTicketSAR >= 90.0) {
      if (competitivePosture === 'PREMIUM_EXPOSURE') {
        const safe = resolveSafeBundlePrice(149, 2, unitCost, carinaTicketSAR);
        tacticalCounterOffer = `Dynamic Bundle 2 at ${safe.bundlePrice} SAR (${safe.unitPrice.toFixed(2)} SAR/u)`;
        tacticalRationale = safe.isElevatedForFloor
          ? `Nayomi runs 2 for 199 SAR. Tactical bundle elevated to ${safe.bundlePrice} SAR (${safe.unitPrice.toFixed(2)} SAR/u) to strictly enforce the ${safe.legalFloor.toFixed(2)} SAR Saudi zero-loss floor (cost ${unitCost.toFixed(2)} SAR + 15% VAT).`
          : `Nayomi is running 2 for 199 SAR and Blooming 3 for 99 SAR. CARINA Dynamic Bundle 2 at 149 SAR defeats Nayomi by 25% while defending gross margin above cost floor.`;
      } else {
        const safe = resolveSafeBundlePrice(159, 2, unitCost, carinaTicketSAR);
        tacticalCounterOffer = `Dynamic Bundle 2 at ${safe.bundlePrice} SAR or Spend 250 Save 50`;
        tacticalRationale = safe.isElevatedForFloor
          ? `Current CARINA promo (${carinaPromoPriceSAR.toFixed(2)} SAR) is competitive. Tactical bundle elevated to ${safe.bundlePrice} SAR (${safe.unitPrice.toFixed(2)} SAR/u) to enforce the ${safe.legalFloor.toFixed(2)} SAR zero-loss floor.`
          : `Current CARINA promo (${carinaPromoPriceSAR.toFixed(2)} SAR) is highly competitive against Nayomi (${nayomi.effectivePromoPriceSAR} SAR). Leverage multi-buy to drive 2.0 UPT.`;
      }
    } else {
      const safe = resolveSafeBundlePrice(69, 2, unitCost, carinaTicketSAR);
      tacticalCounterOffer = `Dynamic Bundle 2 (2 for ${safe.bundlePrice} SAR)`;
      tacticalRationale = safe.isElevatedForFloor
        ? `Mid-ticket sleepwear bundle elevated to ${safe.bundlePrice} SAR (${safe.unitPrice.toFixed(2)} SAR/u) to defend zero-loss floor.`
        : `Mid-ticket sleepwear separates bundled to encourage complete loungewear outfit building.`;
    }
  } else if (normCat === 'Bra') {
    const safe = resolveSafeBundlePrice(99, 2, unitCost, carinaTicketSAR);
    tacticalCounterOffer = `Dynamic Bundle 2 (2 Bras for ${safe.bundlePrice} SAR)`;
    tacticalRationale = safe.isElevatedForFloor
      ? `Bra bundle elevated to ${safe.bundlePrice} SAR (${safe.unitPrice.toFixed(2)} SAR/u) to strictly defend the ${safe.legalFloor.toFixed(2)} SAR Saudi zero-loss floor.`
      : `Matches Blooming's 2 for 99 SAR price point directly and severely undercuts Nayomi (74.50 SAR/u), winning footfall in shared mall corridors.`;
  } else if (normCat === 'Brief') {
    const safe = resolveSafeBundlePrice(59, 3, unitCost, carinaTicketSAR);
    tacticalCounterOffer = `Multipack 3 for ${safe.bundlePrice} SAR Rail`;
    tacticalRationale = safe.isElevatedForFloor
      ? `Multipack elevated to ${safe.bundlePrice} SAR (${safe.unitPrice.toFixed(2)} SAR/u) to comply with Saudi VAT zero-loss regulation.`
      : `Positioned between Blooming (15.80 SAR/u) and Nayomi (23.00 SAR/u), capturing volume while defending Saudi VAT compliance.`;
  } else if (normCat === 'Basics') {
    const safe = resolveSafeBundlePrice(59, 2, unitCost, carinaTicketSAR);
    tacticalCounterOffer = `Dynamic Bundle 2 (2 for ${safe.bundlePrice} SAR)`;
    tacticalRationale = safe.isElevatedForFloor
      ? `Basics bundle elevated to ${safe.bundlePrice} SAR (${safe.unitPrice.toFixed(2)} SAR/u) to defend zero-loss floor.`
      : `Matches Blooming's 2 for 59 SAR promotional rail while protecting gross margin above landed cost.`;
  } else if (normCat === 'Accessories') {
    const safe = resolveSafeBundlePrice(39, 2, unitCost, carinaTicketSAR);
    tacticalCounterOffer = `Multi-Buy Bundle (Buy 2 For ${safe.bundlePrice} SAR) or Basket Add-On`;
    tacticalRationale = safe.isElevatedForFloor
      ? `Accessory bundle elevated to ${safe.bundlePrice} SAR (${safe.unitPrice.toFixed(2)} SAR/u) to defend zero-loss floor.`
      : `Encourages impulse home and bath gifting additions during seasonal footfall surges.`;
  } else if (normCat === 'Cosmetics') {
    tacticalCounterOffer = 'Spend 250 Save 50 (Basket Pack) & 0% Off Ticket';
    tacticalRationale = `Maintain full ticket protection on single-unit sales to preserve 70%+ gross margin, using cosmetics as checkout add-ons rather than clearance rails.`;
  } else {
    tacticalCounterOffer = 'Spend 250 Save 50 Basket Driver';
    tacticalRationale = `Protects margin while encouraging multi-item transaction basket sizes across the KSA store network.`;
  }

  return {
    category: normCat,
    carinaTicketSAR,
    carinaPromoPriceSAR,
    nayomiBenchmark: nayomi,
    bloomingBenchmark: blooming,
    priceIndexVsNayomi,
    priceIndexVsBlooming,
    blendedMarketPriceIndex,
    competitivePosture,
    competitorDemandDrag,
    tacticalCounterOffer,
    tacticalRationale
  };
}

function getCompetitorIntelligenceSummary() {
  const categories = ['Pyjamas', 'Bra', 'Brief', 'Shapewear', 'Cosmetics', 'Socks', 'Basics', 'Accessories'];
  return categories.map(cat => {
    const nayomi = KSA_COMPETITOR_BENCHMARKS.find(b => b.competitor === 'Nayomi' && b.category === cat);
    const blooming = KSA_COMPETITOR_BENCHMARKS.find(b => b.competitor === 'Blooming' && b.category === cat);
    return {
      category: cat,
      nayomi,
      blooming
    };
  });
}

test('Competitor Analyzer: KSA benchmarks matrix includes Nayomi and Blooming across 8 departments', () => {
  assert.equal(KSA_COMPETITOR_BENCHMARKS.length, 16);
  const summary = getCompetitorIntelligenceSummary();
  assert.equal(summary.length, 8);
  
  const categories = summary.map(s => s.category);
  assert.ok(categories.includes('Pyjamas'));
  assert.ok(categories.includes('Bra'));
  assert.ok(categories.includes('Brief'));
  assert.ok(categories.includes('Shapewear'));
  assert.ok(categories.includes('Cosmetics'));
  assert.ok(categories.includes('Socks'));
  assert.ok(categories.includes('Basics'));
  assert.ok(categories.includes('Accessories'));
});

test('Competitor Analyzer: Computes Price Index vs Nayomi & Blooming for Pyjama Style 58424', () => {
  const analysis = analyzeCompetitorPosition('Pyjamas', 'Pyjama Short SS26-SH-PJ-5164', 159.0, 95.40);
  assert.equal(analysis.category, 'Pyjamas');
  assert.equal(analysis.nayomiBenchmark.competitor, 'Nayomi');
  assert.equal(analysis.bloomingBenchmark.competitor, 'Blooming');
  assert.ok(analysis.priceIndexVsNayomi < 100.0, 'CARINA should have a price advantage over Nayomi');
  assert.equal(analysis.priceIndexVsNayomi.toFixed(1), '95.9');
  assert.ok(analysis.priceIndexVsBlooming > 100.0);
});

test('Competitor Analyzer: Accurately benchmarks Style 53087 Girly Peds against Socks and scales tactical offer', () => {
  // Style 53087 Girly Peds: Ticket 6.00 SAR, Promo 4.80 SAR
  const sockAnalysis = analyzeCompetitorPosition('Socks', 'Girly Peds', 6.00, 4.80);

  // Must map to Socks, NOT Pyjamas
  assert.equal(sockAnalysis.category, 'Socks');
  assert.equal(sockAnalysis.nayomiBenchmark.category, 'Socks');
  assert.equal(sockAnalysis.bloomingBenchmark.category, 'Socks');

  // Nayomi effective unit price = 8.00 SAR -> PI = (4.80 / 8.00) * 100 = 60.0%
  assert.equal(sockAnalysis.priceIndexVsNayomi, 60.0);

  // Blooming effective unit price = 5.00 SAR -> PI = (4.80 / 5.00) * 100 = 96.0%
  assert.equal(sockAnalysis.priceIndexVsBlooming, 96.0);

  // Blended PI = (60.0 + 96.0) / 2 = 78.0% (Value Leader)
  assert.equal(sockAnalysis.blendedMarketPriceIndex, 78.0);
  assert.equal(sockAnalysis.competitivePosture, 'VALUE_LEADER');
  assert.equal(sockAnalysis.competitorDemandDrag, 1.12);

  // Tactical offer MUST be scaled to micro-ticket (Impulse Add-on / 3 for 15 SAR)
  // and MUST NOT contain "159 SAR" or "Spend 250"
  assert.ok(sockAnalysis.tacticalCounterOffer.includes('Impulse'));
  assert.ok(!sockAnalysis.tacticalCounterOffer.includes('159 SAR'));
  assert.ok(!sockAnalysis.tacticalCounterOffer.includes('Spend 250'));
});

test('Competitor Analyzer: Cross-department ticket sanity guard prevents 10 SAR accessories from mapping to Pyjamas', () => {
  // Misclassified input with category 'Pyjamas' but ticket 10 SAR
  const sanityCheck = analyzeCompetitorPosition('Pyjamas', 'Basic Lace Hair Band', 10.00, 8.00);
  assert.equal(sanityCheck.category, 'Socks');
  assert.ok(sanityCheck.tacticalCounterOffer.includes('Impulse'));
  assert.ok(!sanityCheck.tacticalCounterOffer.includes('159 SAR'));
});

test('Competitor Analyzer: Value advantage position applies demand boost while premium disadvantage applies drag', () => {
  const valueAdvantage = analyzeCompetitorPosition('Bra', 'Everyday T-Shirt Bra', 79.0, 45.0);
  assert.equal(valueAdvantage.competitivePosture, 'VALUE_LEADER');
  assert.ok(valueAdvantage.competitorDemandDrag > 1.0, 'Demand boost expected for value advantage');

  const premiumDisadvantage = analyzeCompetitorPosition('Pyjamas', 'Silk Pyjama Set', 189.0, 139.0);
  assert.equal(premiumDisadvantage.competitivePosture, 'PREMIUM_EXPOSURE');
  assert.ok(premiumDisadvantage.competitorDemandDrag < 1.0, 'Demand drag expected for premium exposure');
});

test('Competitor Analyzer: Generates actionable tactical counter-strategies', () => {
  const pyjamaAnalysis = analyzeCompetitorPosition('Pyjamas', 'Pyjama Set SS26', 169.0, 135.0);
  assert.ok(pyjamaAnalysis.tacticalCounterOffer.includes('Dynamic Bundle 2'));
  assert.ok(pyjamaAnalysis.tacticalRationale.includes('Nayomi'));

  const cosmeticsAnalysis = analyzeCompetitorPosition('Cosmetics', 'Body splash Secret Desire 100ML', 59.0, 47.0);
  assert.ok(cosmeticsAnalysis.tacticalCounterOffer.includes('Spend 250 Save 50'));
});

test('Competitor Analyzer: Zero-Loss Floor strictly clamps tactical bundle offers (Style 58613)', () => {
  // Style 58613: Pyjama Set (3PC) SS26-PJ-5242
  // Ticket: 299.00 SAR, Promo: 179.40 SAR, Unit Cost: 77.20 SAR
  // Legal Floor = 77.20 * 1.15 = 88.78 SAR. Two-unit floor = 177.56 SAR.
  const analysis58613 = analyzeCompetitorPosition(
    'Pyjamas',
    'Pyjama Set (3PC) SS26-PJ-5242',
    299.00,
    179.40,
    77.20
  );

  // Must NOT recommend 149 SAR (since 149 / 2 = 74.50 SAR/u < 77.20 SAR unit cost)
  assert.ok(!analysis58613.tacticalCounterOffer.includes('149 SAR'), 'Must not recommend 149 SAR when below unit cost');
  // Must elevate to 189 SAR (lowest charm price >= 177.56 SAR)
  assert.ok(analysis58613.tacticalCounterOffer.includes('189 SAR'), 'Must elevate to 189 SAR charm floor');
  // Effective unit price in bundle must be 94.50 SAR which is strictly >= 88.78 SAR (legal floor)
  assert.ok(analysis58613.tacticalCounterOffer.includes('94.50 SAR/u'));
  assert.ok(analysis58613.tacticalRationale.includes('zero-loss floor'));

  // Conversely, when unit cost is low (e.g. 35.00 SAR, floor = 40.25 SAR), 149 SAR bundle (74.50 SAR/u) is legal and preserved
  const analysisNormal = analyzeCompetitorPosition(
    'Pyjamas',
    'Pyjama Set SS26',
    199.00,
    139.00,
    35.00
  );
  assert.ok(analysisNormal.tacticalCounterOffer.includes('149 SAR'));
  assert.ok(analysisNormal.tacticalCounterOffer.includes('74.50 SAR/u'));
});
