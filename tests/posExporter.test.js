const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

function calculateZeroLossFloor(cost) {
  if (cost <= 0) return 0;
  return Math.round(cost * 1.15 * 100) / 100;
}

function generateMasterPlanCSV(records) {
  const headers = [
    'Product_Style_Code',
    'Product_Name',
    'Category',
    'Season_Group',
    'Total_Stock_Physical',
    'Stock_Breakdown_Stores',
    'Cumulative_STR_%',
    'Weekly_ROS_Units',
    'Curve_Health',
    'Landed_Unit_Cost_SAR',
    'Cost_Plus_15%_VAT_SAR',
    'Original_Ticket_Price_SAR',
    'Recommended_Offer',
    'Recommended_Discount_%',
    'Promotional_Price_SAR',
    'Zero_Loss_Verified',
    'Offer_Dates',
    'Commercial_Rationale'
  ];

  const lines = [headers.join(',')];

  for (const { metrics, recommendation } of records) {
    const costPlusVat = calculateZeroLossFloor(metrics.unitCost);
    const breakdown = `AND:${metrics.stockAndalus} | YAS:${metrics.stockYasmeen} | JOU:${metrics.stockJouri} | WH:${metrics.stockWH}`;
    const isSingleSize = metrics.isSingleSize || (
      /cosmetics|towel|scarf|pillow|duvet|sheets|bandana|eye cover|sleeves|bundle/i.test(metrics.category) ||
      /\b(\d+ml|free size|one size|os)\b/i.test(metrics.productName)
    );
    const curveLabel = isSingleSize
      ? 'Single Size (Complete)'
      : (metrics.activeSizeCount >= 3 ? 'Healthy Curve (>=3 Sizes)' : 'Broken Curve (<=2 Sizes)');

    const row = [
      metrics.styleCode,
      `"${metrics.productName.replace(/"/g, '""')}"`,
      `"${metrics.category || 'General'}"`,
      `"${metrics.season || 'Continuity'}"`,
      metrics.totalPhysicalStock,
      `"${breakdown}"`,
      metrics.cumulativeSTR.toFixed(1) + '%',
      metrics.weeklyROS.toFixed(1),
      `"${curveLabel}"`,
      metrics.unitCost.toFixed(2),
      costPlusVat.toFixed(2),
      metrics.ticketPrice.toFixed(2),
      `"${recommendation.recommendedOffer}"`,
      recommendation.discountPct.toFixed(1) + '%',
      recommendation.promotionalPriceSAR.toFixed(2),
      recommendation.zeroLossStatus,
      '"2026-11-22 to 2026-12-03"',
      `"${recommendation.rationale.replace(/"/g, '""')}"`
    ];
    lines.push(row.join(','));
  }

  return lines.join('\n');
}

function generateOdooPOSPricelistCSV(records) {
  const headers = [
    'SKU',
    'Product',
    'Category',
    'Season_Group',
    'Store_Floor_Units',
    'Ticket_Price_SAR',
    'Unit_Cost_SAR',
    'Cost_Plus_15%_VAT_SAR',
    'Initial_Markup_IMU_%',
    'POS_Rule_Tag',
    'Recommended_Offer',
    'Recommended_Discount_%',
    'Promo_Price_SAR',
    'Net_Margin_%',
    'Zero_Loss_Verified'
  ];

  const lines = [headers.join(',')];

  for (const { metrics, recommendation } of records) {
    const costPlusVat = calculateZeroLossFloor(metrics.unitCost);
    const floorStock = metrics.stockAndalus + metrics.stockYasmeen + metrics.stockJouri;
    const imu = metrics.ticketPrice > 0 
      ? ((metrics.ticketPrice - metrics.unitCost) / metrics.ticketPrice) * 100 
      : 0;
    
    const netRev = recommendation.promotionalPriceSAR / 1.15;
    const netMargin = netRev > 0 
      ? ((netRev - metrics.unitCost) / netRev) * 100 
      : 0;

    let posRuleTag = 'RULE_SPEND_SAVE_20';
    if (recommendation.zeroLossStatus === 'FLAGGED' || (recommendation.tier || '').includes('FLAGGED') || metrics.ticketPrice < costPlusVat) {
      posRuleTag = 'RULE_FLAGGED_PRICE_ERROR_LOCKED';
    } else if (recommendation.sharedRailTag) {
      posRuleTag = recommendation.sharedRailTag;
    } else if (recommendation.tier === 'CLEARANCE_50_PCT') {
      posRuleTag = 'RULE_CLEAR_50_PCT';
    } else if (recommendation.tier === 'CLEARANCE_3_FOR_99') {
      posRuleTag = 'RULE_BUNDLE_3_99_RAIL';
    } else if (recommendation.tier === 'MATURE_SUMMER_EXIT') {
      posRuleTag = 'RULE_SUMMER_40_PCT';
    } else if (recommendation.tier === 'HERO_CORE' || recommendation.tier === 'FRESH_WINTER') {
      posRuleTag = 'RULE_FULL_PRICE_PROTECTED';
    } else if (recommendation.tier === 'BUNDLE_2') {
      posRuleTag = recommendation.bundlePriceSAR 
        ? `RULE_BUNDLE_${recommendation.bundleQuantity || 2}_${Math.round(recommendation.bundlePriceSAR)}_RAIL`
        : 'RULE_BUNDLE_2_PAIRS';
    } else if (recommendation.tier === 'VOLUME_MULTI_BUY') {
      posRuleTag = 'RULE_VOLUME_MULTI_BUY';
    }

    const row = [
      metrics.styleCode,
      `"${metrics.productName.replace(/"/g, '""')}"`,
      `"${metrics.category || 'General'}"`,
      `"${metrics.season || 'Continuity'}"`,
      floorStock,
      metrics.ticketPrice.toFixed(2),
      metrics.unitCost.toFixed(2),
      costPlusVat.toFixed(2),
      imu.toFixed(1),
      posRuleTag,
      `"${recommendation.recommendedOffer}"`,
      recommendation.discountPct.toFixed(1),
      recommendation.promotionalPriceSAR.toFixed(2),
      netMargin.toFixed(1),
      recommendation.zeroLossStatus
    ];
    lines.push(row.join(','));
  }

  return lines.join('\n');
}

describe('Odoo POS & Master Style Plan Exporter Engine', () => {
  const sampleRecords = [
    {
      metrics: {
        styleCode: '58401',
        productName: 'Double Breasted Blazer "Elegance"',
        category: 'Jacket',
        season: 'SS26',
        unitCost: 85.0,
        ticketPrice: 299.0,
        totalPhysicalStock: 300,
        stockAndalus: 100,
        stockYasmeen: 100,
        stockJouri: 60,
        stockWH: 40,
        weeklyROS: 6.5,
        cumulativeSTR: 55.0,
        storeFloorWOS: 40.0,
        activeSizeCount: 4,
        isSingleSize: false
      },
      recommendation: {
        tier: 'BUNDLE_2',
        recommendedOffer: 'Buy 2 For 349 SAR (174.50 SAR/u)',
        discountPct: 41.6,
        promotionalPriceSAR: 174.50,
        expectedClearancePct: 45,
        rationale: 'Healthy curve with high stock. Bundling protects margin.',
        zeroLossStatus: 'YES',
        bundleQuantity: 2,
        bundlePriceSAR: 349,
        sharedRailTag: 'RULE_BUNDLE_2_349_RAIL'
      }
    },
    {
      metrics: {
        styleCode: '59465',
        productName: 'Body Splash Secret Desire 100ML',
        category: 'Cosmetics',
        season: 'All Season 2018',
        unitCost: 12.0,
        ticketPrice: 49.0,
        totalPhysicalStock: 150,
        stockAndalus: 50,
        stockYasmeen: 50,
        stockJouri: 30,
        stockWH: 20,
        weeklyROS: 3.2,
        cumulativeSTR: 42.0,
        storeFloorWOS: 40.6,
        activeSizeCount: 1,
        isSingleSize: true
      },
      recommendation: {
        tier: 'VOLUME_MULTI_BUY',
        recommendedOffer: 'Spend 250 Save 50 (Basket Pack)',
        discountPct: 20.0,
        promotionalPriceSAR: 39.20,
        expectedClearancePct: 40,
        rationale: 'Non-sized beauty basket builder.',
        zeroLossStatus: 'YES'
      }
    },
    {
      metrics: {
        styleCode: '99999',
        productName: 'Defective Cost Item',
        category: 'Top',
        season: 'AW26',
        unitCost: 50.0,
        ticketPrice: 40.0, // Error: Ticket price < Cost + VAT (57.50)
        totalPhysicalStock: 20,
        stockAndalus: 10,
        stockYasmeen: 5,
        stockJouri: 5,
        stockWH: 0,
        weeklyROS: 0.5,
        cumulativeSTR: 12.0,
        storeFloorWOS: 40.0,
        activeSizeCount: 1,
        isSingleSize: false
      },
      recommendation: {
        tier: 'FLAGGED_PRICE_ERROR',
        recommendedOffer: 'FLAGGED: System Price Error (0% Off)',
        discountPct: 0.0,
        promotionalPriceSAR: 40.0,
        expectedClearancePct: 0,
        rationale: 'Ticket price below cost + VAT.',
        zeroLossStatus: 'FLAGGED'
      }
    }
  ];

  test('generateMasterPlanCSV: Emits exactly 18 standard header columns', () => {
    const csv = generateMasterPlanCSV(sampleRecords);
    const rows = csv.split('\n');
    const headerCols = rows[0].split(',');

    assert.equal(headerCols.length, 18);
    assert.equal(headerCols[0], 'Product_Style_Code');
    assert.equal(headerCols[5], 'Stock_Breakdown_Stores');
    assert.equal(headerCols[8], 'Curve_Health');
    assert.equal(headerCols[10], 'Cost_Plus_15%_VAT_SAR');
    assert.equal(headerCols[15], 'Zero_Loss_Verified');
    assert.equal(headerCols[16], 'Offer_Dates');
    assert.equal(headerCols[17], 'Commercial_Rationale');
  });

  test('generateMasterPlanCSV: Escapes quotes and formats store breakdowns accurately', () => {
    const csv = generateMasterPlanCSV(sampleRecords);
    const rows = csv.split('\n');

    // First row: Blazer with quotes in name
    assert.ok(rows[1].includes('"Double Breasted Blazer ""Elegance"""'));
    assert.ok(rows[1].includes('"AND:100 | YAS:100 | JOU:60 | WH:40"'));
    assert.ok(rows[1].includes('"Healthy Curve (>=3 Sizes)"'));
    assert.ok(rows[1].includes('97.75')); // 85 * 1.15

    // Second row: Single size cosmetics
    assert.ok(rows[2].includes('"Single Size (Complete)"'));
    assert.ok(rows[2].includes('13.80')); // 12 * 1.15

    // Third row: Flagged error
    assert.ok(rows[3].includes('FLAGGED'));
  });

  test('generateOdooPOSPricelistCSV: Emits 15 columns with POS rule tags and IMU', () => {
    const posCsv = generateOdooPOSPricelistCSV(sampleRecords);
    const rows = posCsv.split('\n');
    const headerCols = rows[0].split(',');

    assert.equal(headerCols.length, 15);
    assert.equal(headerCols[0], 'SKU');
    assert.equal(headerCols[4], 'Store_Floor_Units');
    assert.equal(headerCols[8], 'Initial_Markup_IMU_%');
    assert.equal(headerCols[9], 'POS_Rule_Tag');
    assert.equal(headerCols[13], 'Net_Margin_%');

    // First row: Bundle 2 rule tag
    const row1 = rows[1];
    assert.ok(row1.includes('RULE_BUNDLE_2_349_RAIL'));
    assert.ok(row1.includes('260')); // Store floor stock: 100 + 100 + 60
    assert.ok(row1.includes('71.6')); // IMU: (299 - 85)/299 = 71.57%

    // Second row: Volume multi buy
    const row2 = rows[2];
    assert.ok(row2.includes('RULE_VOLUME_MULTI_BUY'));

    // Third row: Locked pricing error
    const row3 = rows[3];
    assert.ok(row3.includes('RULE_FLAGGED_PRICE_ERROR_LOCKED'));
  });
});
