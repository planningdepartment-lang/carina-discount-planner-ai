import { StyleMetrics, RecommendationResult } from '../engine/lifecycleClassifier';
import { StylePlanRecord } from '../engine/posExporter';
import { BusinessRuleRecord } from '../engine/rulePipeline';
import { calculateZeroLossFloor } from '../engine/metricsCalculator';

export interface NetworkSummaryKPIs {
  totalPhysicalStock: number;
  totalCostCapital: number;
  totalRetailValue: number;
  blendedIMU: number;
  activeStylesCount: number;
  healthyCurvesCount: number;
  andalusDensity: number;
  yasmeenDensity: number;
  jouriDensity: number;
}

/**
 * Fetches all active business governance rules from D1.
 */
export async function fetchBusinessRules(db: D1Database): Promise<BusinessRuleRecord[]> {
  try {
    const { results } = await db
      .prepare('SELECT * FROM business_rules WHERE is_active = 1 ORDER BY created_at ASC')
      .all<BusinessRuleRecord>();
    return results || [];
  } catch (err) {
    console.error('Error fetching business rules from D1:', err);
    return [];
  }
}

/**
 * Saves or updates a dynamic governance rule in D1.
 */
export async function saveBusinessRule(db: D1Database, rule: BusinessRuleRecord): Promise<boolean> {
  try {
    await db
      .prepare(`
        INSERT OR REPLACE INTO business_rules 
        (rule_id, rule_name, rule_category, target_scope, condition_operator, rule_value, enforcement_level, is_active, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `)
      .bind(
        rule.rule_id,
        rule.rule_name,
        rule.rule_category,
        rule.target_scope,
        rule.condition_operator,
        rule.rule_value,
        rule.enforcement_level,
        rule.is_active
      )
      .run();
    return true;
  } catch (err) {
    console.error('Error saving business rule to D1:', err);
    return false;
  }
}

/**
 * Deletes a specific governance rule by rule_id from D1.
 */
export async function deleteBusinessRule(db: D1Database, ruleId: string): Promise<boolean> {
  try {
    await db.prepare('DELETE FROM business_rules WHERE rule_id = ?').bind(ruleId).run();
    return true;
  } catch (err) {
    console.error('Error deleting business rule from D1:', err);
    return false;
  }
}

/**
 * Removes all custom governance rules from D1.
 */
export async function clearAllBusinessRules(db: D1Database): Promise<boolean> {
  try {
    await db.prepare('DELETE FROM business_rules').run();
    return true;
  } catch (err) {
    console.error('Error clearing business rules from D1:', err);
    return false;
  }
}

/**
 * Standard baseline commercial governance policies for CARINA retail.
 */
export const DEFAULT_BUSINESS_RULES: BusinessRuleRecord[] = [
  {
    rule_id: 'RULE_ZERO_LOSS_VAT',
    rule_name: 'Saudi 15% VAT Zero-Loss Floor',
    rule_category: 'MARGIN',
    target_scope: 'GLOBAL',
    condition_operator: 'MIN',
    rule_value: '0.0',
    enforcement_level: 'HARD_BLOCK',
    is_active: 1
  },
  {
    rule_id: 'RULE_EXCLUDE_AW26',
    rule_name: 'Fresh Winter 2026 Exclusion',
    rule_category: 'EXCLUSION',
    target_scope: 'SEASON:AW26',
    condition_operator: 'EXCLUDE',
    rule_value: '1',
    enforcement_level: 'HARD_BLOCK',
    is_active: 1
  },
  {
    rule_id: 'RULE_CAP_NOOS_DISCOUNT',
    rule_name: 'Continuity Basic Discount Cap',
    rule_category: 'DISCOUNT_CAP',
    target_scope: 'SEASON:All Season 2018',
    condition_operator: 'MAX',
    rule_value: '25.0',
    enforcement_level: 'HARD_BLOCK',
    is_active: 1
  },
  {
    rule_id: 'RULE_MIN_NET_MARGIN',
    rule_name: 'Portfolio Net Margin Target Floor',
    rule_category: 'MARGIN',
    target_scope: 'GLOBAL',
    condition_operator: 'MIN',
    rule_value: '45.0',
    enforcement_level: 'WARNING',
    is_active: 1
  },
  {
    rule_id: 'RULE_DECONGEST_JOURI',
    rule_name: 'Taif Jouri Density Target',
    rule_category: 'STOCK_TARGET',
    target_scope: 'STORE:Jouri',
    condition_operator: 'MAX',
    rule_value: '36.0',
    enforcement_level: 'WARNING',
    is_active: 1
  },
  {
    rule_id: 'RULE_DECONGEST_YASMEEN',
    rule_name: 'Jeddah Yasmeen Density Target',
    rule_category: 'STOCK_TARGET',
    target_scope: 'STORE:Yasmeen',
    condition_operator: 'MAX',
    rule_value: '35.0',
    enforcement_level: 'WARNING',
    is_active: 1
  }
];

/**
 * Restores all baseline commercial governance policies into D1.
 */
export async function restoreDefaultBusinessRules(db: D1Database): Promise<boolean> {
  try {
    for (const rule of DEFAULT_BUSINESS_RULES) {
      await saveBusinessRule(db, rule);
    }
    await clearStylePlanSnapshots(db);
    return true;
  } catch (err) {
    console.error('Error restoring default business rules in D1:', err);
    return false;
  }
}

/**
 * Clears style plan snapshots cache to force fresh re-computation with new rules.
 */
export async function clearStylePlanSnapshots(db: D1Database): Promise<boolean> {
  try {
    await db.prepare('DELETE FROM style_plan_snapshots').run();
    return true;
  } catch (err) {
    console.error('Error clearing style plan snapshots from D1:', err);
    return false;
  }
}

/**
 * Reads pre-computed style snapshots from D1 (<10ms fast load).
 */
export async function fetchStylePlanSnapshots(db: D1Database): Promise<StylePlanRecord[]> {
  try {
    const { results } = await db
      .prepare('SELECT * FROM style_plan_snapshots ORDER BY total_physical_stock DESC')
      .all<any>();

    if (!results || results.length === 0) return [];

    return results.map(row => ({
      metrics: {
        styleCode: row.style_code,
        productName: row.product_name,
        category: row.category,
        season: row.season,
        unitCost: row.unit_cost,
        ticketPrice: row.ticket_price,
        totalPhysicalStock: row.total_physical_stock,
        stockAndalus: row.stock_andalus,
        stockYasmeen: row.stock_yasmeen,
        stockJouri: row.stock_jouri,
        stockWH: row.stock_wh,
        weeklyROS: row.weekly_ros,
        cumulativeSTR: row.cumulative_str_pct,
        storeFloorWOS: row.store_floor_wos || 0,
        activeSizeCount: row.sar_curve_health?.includes('>=3') ? 4 : (row.sar_curve_health?.includes('Single') ? 1 : 2),
        isSingleSize: row.sar_curve_health?.includes('Single') || false
      },
      recommendation: {
        tier: row.recommended_offer?.includes('Clearance') ? 'CLEARANCE' : 'ACTIVE',
        recommendedOffer: row.recommended_offer,
        discountPct: row.discount_pct,
        promotionalPriceSAR: row.promotional_price,
        expectedClearancePct: Math.round(((row.forecast_sold || 0) / (row.total_physical_stock || 1)) * 100),
        rationale: row.commercial_rationale,
        zeroLossStatus: row.zero_loss_status || 'YES'
      }
    }));
  } catch (err) {
    console.error('Error fetching style snapshots from D1:', err);
    return [];
  }
}

/**
 * Caches calculated style plans into D1 `style_plan_snapshots` using batching.
 */
export async function saveStylePlanSnapshots(db: D1Database, records: StylePlanRecord[]): Promise<void> {
  try {
    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO style_plan_snapshots (
        style_code, product_name, category, season,
        total_physical_stock, stock_andalus, stock_yasmeen, stock_jouri, stock_wh,
        cumulative_str_pct, weekly_ros, sar_curve_health,
        unit_cost, cost_plus_vat, ticket_price,
        recommended_offer, promotional_price, discount_pct,
        zero_loss_status, forecast_sold, forecast_profit, post_event_stock,
        commercial_rationale, last_computed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    // D1 batches up to 50 statements per roundtrip
    const BATCH_SIZE = 40;
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const chunk = records.slice(i, i + BATCH_SIZE);
      const statements = chunk.map(({ metrics, recommendation }) => {
        const costPlusVat = calculateZeroLossFloor(metrics.unitCost);
        const forecastSold = Math.round(metrics.totalPhysicalStock * (recommendation.expectedClearancePct / 100));
        const postStock = Math.max(0, metrics.totalPhysicalStock - forecastSold);
        const netRev = (forecastSold * recommendation.promotionalPriceSAR) / 1.15;
        const forecastProfit = Math.round(netRev - (forecastSold * metrics.unitCost));
        const isSingleSize = metrics.isSingleSize || (
          /cosmetics|towel|scarf|pillow|duvet|sheets|bandana|eye cover|sleeves|bundle/i.test(metrics.category) ||
          /\b(\d+ml|free size|one size|os)\b/i.test(metrics.productName)
        );
        const curveLabel = isSingleSize
          ? 'Single Size (Complete)'
          : (metrics.activeSizeCount >= 3 ? 'Healthy Curve (>=3 Sizes)' : 'Broken Curve (<=2 Sizes)');

        return insertStmt.bind(
          metrics.styleCode,
          metrics.productName,
          metrics.category || 'General',
          metrics.season || 'Continuity',
          metrics.totalPhysicalStock,
          metrics.stockAndalus,
          metrics.stockYasmeen,
          metrics.stockJouri,
          metrics.stockWH,
          metrics.cumulativeSTR,
          metrics.weeklyROS,
          curveLabel,
          metrics.unitCost,
          costPlusVat,
          metrics.ticketPrice,
          recommendation.recommendedOffer,
          recommendation.promotionalPriceSAR,
          recommendation.discountPct,
          recommendation.zeroLossStatus,
          forecastSold,
          forecastProfit,
          postStock,
          recommendation.rationale
        );
      });
      await db.batch(statements);
    }
  } catch (err) {
    console.error('Error saving style snapshots to D1:', err);
  }
}

/**
 * Resilient direct SQL aggregation from odoo_stock_move_line on D1.
 */
export async function aggregateStylesDirectFromD1(db: D1Database): Promise<StyleMetrics[]> {
  const query = `
    SELECT 
      TRIM(product_id_name) AS product_name,
      SUBSTR(TRIM(product_sku), 1, 5) AS style_code,
      
      SUM(CASE WHEN location_dest_id_name = 'AND/Stock' THEN COALESCE(quantity, qty_done, 0) ELSE 0 END) -
      SUM(CASE WHEN location_id_name = 'AND/Stock' THEN COALESCE(quantity, qty_done, 0) ELSE 0 END) AS stock_and,

      SUM(CASE WHEN location_dest_id_name = 'YAS/Stock' THEN COALESCE(quantity, qty_done, 0) ELSE 0 END) -
      SUM(CASE WHEN location_id_name = 'YAS/Stock' THEN COALESCE(quantity, qty_done, 0) ELSE 0 END) AS stock_yas,

      SUM(CASE WHEN location_dest_id_name = 'Jouri/Stock' THEN COALESCE(quantity, qty_done, 0) ELSE 0 END) -
      SUM(CASE WHEN location_id_name = 'Jouri/Stock' THEN COALESCE(quantity, qty_done, 0) ELSE 0 END) AS stock_jou,

      SUM(CASE WHEN location_dest_id_name = 'WH/Stock' THEN COALESCE(quantity, qty_done, 0) ELSE 0 END) -
      SUM(CASE WHEN location_id_name = 'WH/Stock' THEN COALESCE(quantity, qty_done, 0) ELSE 0 END) AS stock_wh,

      SUM(CASE WHEN location_dest_id_name = 'Partners/Customers' THEN COALESCE(quantity, qty_done, 0) ELSE 0 END) -
      SUM(CASE WHEN location_id_name = 'Partners/Customers' THEN COALESCE(quantity, qty_done, 0) ELSE 0 END) AS sold_lifetime,

      SUM(CASE 
        WHEN location_dest_id_name = 'Partners/Customers' AND date >= datetime('now', '-56 days')
        THEN COALESCE(quantity, qty_done, 0) ELSE 0 END) AS sold_8wk,

      COUNT(DISTINCT product_sku) AS size_count,
      COALESCE(
        ROUND(AVG(CASE 
          WHEN CAST(unit_cost AS REAL) > 0 THEN CAST(unit_cost AS REAL)
          WHEN CAST(standard_price AS REAL) > 0 THEN CAST(standard_price AS REAL)
          WHEN CAST(cost AS REAL) > 0 AND quantity > 0 THEN CAST(cost AS REAL) / quantity
        END), 2),
        10.0
      ) AS unit_cost,
      MAX(COALESCE(sales_price, 0)) AS ticket_price,
      MAX(product_category_id_name) AS category,
      MAX(season_id_name) AS season

    FROM odoo_stock_move_line
    WHERE product_sku GLOB '[0-9][0-9][0-9][0-9][0-9]-*-*'
      AND state = 'done'
      AND location_dest_id_name != 'Shofy/Stock' 
      AND location_id_name != 'Shofy/Stock'
      AND location_dest_id_name != 'WH-D/Stock' 
      AND location_id_name != 'WH-D/Stock'
    GROUP BY style_code
    HAVING (stock_and + stock_yas + stock_jou + stock_wh) > 0
    ORDER BY (stock_and + stock_yas + stock_jou + stock_wh) DESC;
  `;

  try {
    const { results } = await db.prepare(query).all<any>();
    if (!results || results.length === 0) return [];

    return results.map(row => {
      const stockAnd = Math.max(0, Math.round(row.stock_and || 0));
      const stockYas = Math.max(0, Math.round(row.stock_yas || 0));
      const stockJou = Math.max(0, Math.round(row.stock_jou || 0));
      const stockWh = Math.max(0, Math.round(row.stock_wh || 0));
      const totalStock = stockAnd + stockYas + stockJou + stockWh;

      const lifetimeSold = Math.max(0, Math.round(row.sold_lifetime || 0));
      const sold8wk = Math.max(0, Math.round(row.sold_8wk || 0));
      const weeklyROS = Math.round((sold8wk / 8.0) * 10) / 10;
      const strPct = (lifetimeSold + totalStock) > 0 ? (lifetimeSold / (lifetimeSold + totalStock)) * 100 : 0;
      const floorStock = stockAnd + stockYas + stockJou;
      const wos = weeklyROS > 0 ? Math.round((floorStock / weeklyROS) * 10) / 10 : 999.0;

      return {
        styleCode: row.style_code,
        productName: row.product_name,
        category: row.category || 'General',
        season: row.season || 'Continuity',
        unitCost: Number(row.unit_cost) || 10.0,
        ticketPrice: Number(row.ticket_price) || 39.0,
        totalPhysicalStock: totalStock,
        stockAndalus: stockAnd,
        stockYasmeen: stockYas,
        stockJouri: stockJou,
        stockWH: stockWh,
        weeklyROS: weeklyROS,
        cumulativeSTR: Math.round(strPct * 10) / 10,
        storeFloorWOS: wos,
        activeSizeCount: row.size_count || 1
      };
    });
  } catch (err) {
    console.error('Error executing direct D1 style aggregation:', err);
    return [];
  }
}
