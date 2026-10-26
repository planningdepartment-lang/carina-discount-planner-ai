import { StyleMetrics, RecommendationResult } from './lifecycleClassifier';
import { calculateZeroLossFloor } from './metricsCalculator';

export interface StylePlanRecord {
  metrics: StyleMetrics;
  recommendation: RecommendationResult;
}

/**
 * Generates the standardized 18-column Master Style Plan CSV.
 */
export function generateMasterPlanCSV(records: StylePlanRecord[]): string {
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
    const curveLabel = metrics.activeSizeCount >= 3 ? 'Healthy Curve (>=3 Sizes)' : 'Broken Curve (<=2 Sizes)';

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

/**
 * Generates the Odoo POS Promotional Pricelist CSV ready for cash register barcode imports.
 */
export function generateOdooPOSPricelistCSV(records: StylePlanRecord[]): string {
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
    const imu = metrics.ticketPrice > 0 ? ((metrics.ticketPrice - metrics.unitCost) / metrics.ticketPrice) * 100 : 0;
    const netRev = recommendation.promotionalPriceSAR / 1.15;
    const netMargin = netRev > 0 ? ((netRev - metrics.unitCost) / netRev) * 100 : 0;

    let posRuleTag = 'RULE_SPEND_SAVE_20';
    if (recommendation.tier === 'CLEARANCE_50_PCT') posRuleTag = 'RULE_CLEAR_50_PCT';
    else if (recommendation.tier === 'CLEARANCE_3_FOR_99') posRuleTag = 'RULE_CLEAR_3_FOR_99';
    else if (recommendation.tier === 'MATURE_SUMMER_EXIT') posRuleTag = 'RULE_SUMMER_40_PCT';
    else if (recommendation.tier === 'HERO_CORE' || recommendation.tier === 'FRESH_WINTER') posRuleTag = 'RULE_FULL_PRICE_PROTECTED';

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
