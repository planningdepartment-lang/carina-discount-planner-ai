import { StyleMetrics, RecommendationResult } from '../engine/lifecycleClassifier';
import { StylePlanRecord } from '../engine/posExporter';
import { BusinessRuleRecord } from '../engine/rulePipeline';
import {
  calculateZeroLossFloor,
  calculateWeeklyROS,
  calculateVelocityMomentum,
  formatCurveHealthLabel,
  evaluateSizeStockHealth,
  detectSingleSizeAssortment
} from '../engine/metricsCalculator';
import { LIFECYCLE_TIERS, CampaignMode, CAMPAIGN_MODE_LABELS } from '../config/constants';

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

function inferTierFromOffer(offer: string = '', zeroLossStatus: string = 'YES', discountPct: number = 0): string {
  const upper = offer.toUpperCase();
  if (zeroLossStatus === 'FLAGGED' || upper.includes('FLAGGED')) return LIFECYCLE_TIERS.FLAGGED_PRICE_ERROR;
  if (upper.includes('WINTER') || upper.includes('FULL TICKET PRICE')) return LIFECYCLE_TIERS.FRESH_WINTER;
  if (upper.includes('MARGIN PROTECTION') || (upper.includes('0% OFF') && discountPct === 0)) return LIFECYCLE_TIERS.HERO_CORE;
  if (upper.includes('BUY 2 FOR')) return LIFECYCLE_TIERS.BUNDLE_2;
  if (upper.includes('BASKET PACK') || upper.includes('BUY 2 GET 1')) return LIFECYCLE_TIERS.VOLUME_MULTI_BUY;
  if (upper.includes('99 SAR') || upper.includes('3 FOR 99')) return LIFECYCLE_TIERS.CLEARANCE_3_FOR_99;
  if (upper.includes('50%')) return LIFECYCLE_TIERS.CLEARANCE_50_PCT;
  if (upper.includes('40%')) return LIFECYCLE_TIERS.MATURE_SUMMER_EXIT;
  if (upper.includes('CAPPED PROMO')) return LIFECYCLE_TIERS.RULE_CAPPED_PROMO;
  if (upper.includes('CLEARANCE')) return LIFECYCLE_TIERS.CLEARANCE_PERCENT_SAFE;
  return LIFECYCLE_TIERS.STEADY_ACTIVE;
}

function parseBundleFromOffer(offer: string = '', promoPrice: number): {
  bundleQuantity: number;
  bundlePriceSAR: number;
  sharedRailTag?: string;
} {
  const m2 = offer.match(/Buy\s+(\d+)\s+For\s+(\d+(?:\.\d+)?)\s+SAR/i);
  if (m2) {
    const qty = Number(m2[1]) || 2;
    const price = Number(m2[2]) || promoPrice;
    return {
      bundleQuantity: qty,
      bundlePriceSAR: price,
      sharedRailTag: `RULE_BUNDLE_${qty}_${Math.round(price)}_RAIL`
    };
  }
  const m3 = offer.match(/Take\s+(\d+)\s+For\s+(\d+(?:\.\d+)?)\s+SAR/i);
  if (m3) {
    const qty = Number(m3[1]) || 3;
    const price = Number(m3[2]) || promoPrice;
    return {
      bundleQuantity: qty,
      bundlePriceSAR: price,
      sharedRailTag: `RULE_BUNDLE_${qty}_${Math.round(price)}_RAIL`
    };
  }
  return { bundleQuantity: 1, bundlePriceSAR: promoPrice };
}

/**
 * Fetches the active workspace Campaign Mode ('REGULAR_DROP_CYCLE' vs KSA Events like 'WHITE_FRIDAY').
 */
export async function fetchActiveCampaignMode(db: D1Database): Promise<CampaignMode> {
  try {
    const { results } = await db
      .prepare(`SELECT value FROM system_settings WHERE key = 'ACTIVE_CAMPAIGN_MODE' LIMIT 1`)
      .all<{ value: string }>();
    const raw = (results?.[0]?.value || 'REGULAR_DROP_CYCLE') as CampaignMode;
    return CAMPAIGN_MODE_LABELS[raw] ? raw : 'REGULAR_DROP_CYCLE';
  } catch {
    return 'REGULAR_DROP_CYCLE';
  }
}

/**
 * Updates the active workspace Campaign Mode and logs the audit event in D1.
 */
export async function saveActiveCampaignMode(db: D1Database, mode: CampaignMode): Promise<boolean> {
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    await db.prepare(`
      INSERT OR REPLACE INTO system_settings (key, value, updated_at)
      VALUES ('ACTIVE_CAMPAIGN_MODE', ?, CURRENT_TIMESTAMP)
    `).bind(mode).run();

    await db.prepare(`
      INSERT INTO plan_audit_log (action_type, actor, details)
      VALUES ('CAMPAIGN_MODE_SWITCH', 'USER', ?)
    `).bind(`Switched active planning mode to ${mode} (${CAMPAIGN_MODE_LABELS[mode]})`).run().catch(() => {});

    return true;
  } catch (err) {
    console.error('Error saving active campaign mode in D1:', err);
    return false;
  }
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
 * Clears non-overridden style plan snapshots to force fresh re-computation with new rules
 * while preserving user manual overrides (`is_manual_override = 1`).
 */
export async function clearStylePlanSnapshots(db: D1Database): Promise<boolean> {
  try {
    await db.prepare('DELETE FROM style_plan_snapshots WHERE COALESCE(is_manual_override, 0) = 0').run();
    return true;
  } catch (err) {
    try {
      await db.prepare('DELETE FROM style_plan_snapshots').run();
      return true;
    } catch (innerErr) {
      console.error('Error clearing style plan snapshots from D1:', innerErr);
      return false;
    }
  }
}

/**
 * Returns any preserved user manual overrides keyed by styleCode.
 */
export async function fetchManualOverrideSnapshots(db: D1Database): Promise<Map<string, any>> {
  const overrides = new Map<string, any>();
  try {
    const { results } = await db
      .prepare('SELECT * FROM style_plan_snapshots WHERE COALESCE(is_manual_override, 0) = 1')
      .all<any>();
    for (const row of results || []) {
      overrides.set(row.style_code, row);
    }
  } catch {
    // Graceful fallback if table/column doesn't exist yet
  }
  return overrides;
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

    // If clearStylePlanSnapshots cleared all auto rows leaving only manual overrides, trigger recompute
    if (results.every(r => Number(r.is_manual_override) === 1)) {
      return [];
    }

    return results.map(row => {
      let sizeBreakdown: Record<string, number> | undefined;
      if (row.size_breakdown_json) {
        try {
          sizeBreakdown = JSON.parse(row.size_breakdown_json);
        } catch {
          sizeBreakdown = undefined;
        }
      }

      const weeklyROS = Number(row.weekly_ros) || 0;
      const floorStock = (Number(row.stock_andalus) || 0) + (Number(row.stock_yasmeen) || 0) + (Number(row.stock_jouri) || 0);
      const wos = (row.store_floor_wos !== undefined && row.store_floor_wos !== null)
        ? Number(row.store_floor_wos)
        : (weeklyROS > 0 ? Math.round((floorStock / weeklyROS) * 10) / 10 : 999.0);

      const isSingleSize = row.is_single_size !== undefined && row.is_single_size !== null
        ? Number(row.is_single_size) === 1
        : (row.sar_curve_health?.includes('Single') || false);

      const hasCoreSizes = row.has_core_sizes !== undefined && row.has_core_sizes !== null
        ? Number(row.has_core_sizes) === 1
        : !row.sar_curve_health?.includes('Non-Core');

      const activeSizeCount = (row.active_size_count !== undefined && row.active_size_count !== null && Number(row.active_size_count) > 0)
        ? Number(row.active_size_count)
        : (row.sar_curve_health?.includes('>=3') ? 4 : (isSingleSize ? 1 : 2));

      const tier = row.lifecycle_tier || inferTierFromOffer(row.recommended_offer, row.zero_loss_status, row.discount_pct);
      const bundleMeta = parseBundleFromOffer(row.recommended_offer, row.promotional_price);

      return {
        isManualOverride: Number(row.is_manual_override) === 1,
        metrics: {
          styleCode: row.style_code,
          productName: row.product_name,
          category: row.category,
          season: row.season,
          unitCost: Number(row.unit_cost) || 0,
          ticketPrice: Number(row.ticket_price) || 0,
          totalPhysicalStock: Number(row.total_physical_stock) || 0,
          stockAndalus: Number(row.stock_andalus) || 0,
          stockYasmeen: Number(row.stock_yasmeen) || 0,
          stockJouri: Number(row.stock_jouri) || 0,
          stockWH: Number(row.stock_wh) || 0,
          weeklyROS,
          weeklyROS2wk: row.weekly_ros_2wk ?? weeklyROS,
          weeklyROS4wk: row.weekly_ros_4wk ?? weeklyROS,
          momentumRatio: row.momentum_ratio ?? 1.0,
          momentumLabel: row.momentum_label ?? 'Stable',
          activeWeeks: row.active_weeks ?? 8.0,
          cumulativeSTR: Number(row.cumulative_str_pct) || 0,
          storeFloorWOS: wos,
          activeSizeCount,
          hasCoreSizes,
          isSingleSize,
          sizeBreakdown,
          firstMoveDate: row.first_move_date || undefined,
          soldUnits: Number(row.sold_units) || 0,
          salesLifecycleWeeks: Number(row.sales_lifecycle_weeks) || 0.0
        },
        recommendation: {
          tier,
          recommendedOffer: row.recommended_offer,
          discountPct: Number(row.discount_pct) || 0,
          promotionalPriceSAR: Number(row.promotional_price) || 0,
          expectedClearancePct: row.total_physical_stock > 0
            ? Math.round(((row.forecast_sold || 0) / row.total_physical_stock) * 100)
            : 0,
          rationale: row.commercial_rationale,
          zeroLossStatus: (row.zero_loss_status as 'YES' | 'FLAGGED') || 'YES',
          bundleQuantity: bundleMeta.bundleQuantity,
          bundlePriceSAR: bundleMeta.bundlePriceSAR,
          sharedRailTag: bundleMeta.sharedRailTag
        }
      };
    });
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
        commercial_rationale, last_computed_at,
        weekly_ros_2wk, weekly_ros_4wk, momentum_ratio, active_weeks, momentum_label,
        sold_units, sales_lifecycle_weeks,
        lifecycle_tier, store_floor_wos, active_size_count, has_core_sizes,
        is_single_size, is_manual_override, size_breakdown_json, first_move_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const BATCH_SIZE = 50;
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const chunk = records.slice(i, i + BATCH_SIZE);
      const statements = chunk.map(({ metrics, recommendation, isManualOverride }) => {
        const costPlusVat = calculateZeroLossFloor(metrics.unitCost);
        const forecastSold = Math.round(metrics.totalPhysicalStock * ((recommendation.expectedClearancePct || 0) / 100));
        const postStock = Math.max(0, metrics.totalPhysicalStock - forecastSold);
        const netRev = (forecastSold * recommendation.promotionalPriceSAR) / 1.15;
        const forecastProfit = Math.round(netRev - (forecastSold * metrics.unitCost));
        const curveLabel = formatCurveHealthLabel(metrics);
        const sizeJson = metrics.sizeBreakdown ? JSON.stringify(metrics.sizeBreakdown) : null;

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
          recommendation.rationale,
          metrics.weeklyROS2wk ?? metrics.weeklyROS,
          metrics.weeklyROS4wk ?? metrics.weeklyROS,
          metrics.momentumRatio ?? 1.0,
          metrics.activeWeeks ?? 8.0,
          metrics.momentumLabel ?? 'Stable',
          metrics.soldUnits ?? 0,
          metrics.salesLifecycleWeeks ?? 0.0,
          recommendation.tier || 'STEADY_ACTIVE',
          metrics.storeFloorWOS ?? 0.0,
          metrics.activeSizeCount ?? 0,
          metrics.hasCoreSizes === false ? 0 : 1,
          metrics.isSingleSize ? 1 : 0,
          isManualOverride ? 1 : 0,
          sizeJson,
          metrics.firstMoveDate || null
        );
      });
      await db.batch(statements);
    }
  } catch (err) {
    console.error('Error saving style snapshots to D1:', err);
  }
}

/**
 * Resilient single-pass SQL aggregation from odoo_stock_move_line on D1.
 * Scans move lines ONCE grouped by (style_code, size_code) so Worker memory
 * computes both style totals and per-size depth without doubling D1 row scans.
 */
export async function aggregateStylesDirectFromD1(db: D1Database): Promise<StyleMetrics[]> {
  const singlePassQuery = `
    WITH base_moves AS (
      SELECT
        TRIM(product_id_name) AS product_name,
        SUBSTR(TRIM(product_sku), 1, 5) AS style_code,
        CASE
          WHEN INSTR(SUBSTR(TRIM(product_sku), 7), '-') > 0
          THEN UPPER(TRIM(SUBSTR(SUBSTR(TRIM(product_sku), 7), INSTR(SUBSTR(TRIM(product_sku), 7), '-') + 1)))
          ELSE 'OS'
        END AS size_code,
        location_id_name,
        location_dest_id_name,
        COALESCE(quantity, qty_done, 0) AS qty,
        date,
        CASE
          WHEN CAST(unit_cost AS REAL) > 0 THEN CAST(unit_cost AS REAL)
          WHEN CAST(standard_price AS REAL) > 0 THEN CAST(standard_price AS REAL)
          WHEN CAST(cost AS REAL) > 0 AND quantity > 0 THEN CAST(cost AS REAL) / quantity
        END AS eff_unit_cost,
        CAST(list_price AS REAL) AS num_list_price,
        CASE
          WHEN location_dest_id_name = 'Partners/Customers' AND CAST(sales_price AS REAL) > 0
          THEN CAST(sales_price AS REAL)
        END AS cust_sales_price,
        CASE WHEN sales_price > 0 THEN sales_price END AS pos_sales_price,
        product_category_id_name,
        season_id_name
      FROM odoo_stock_move_line
      WHERE state = 'done'
        AND product_sku GLOB '[0-9][0-9][0-9][0-9][0-9]-*'
    )
    SELECT
      style_code,
      size_code,
      MAX(product_name) AS product_name,
      SUM(CASE WHEN location_dest_id_name = 'AND/Stock' THEN qty ELSE 0 END) -
      SUM(CASE WHEN location_id_name = 'AND/Stock' THEN qty ELSE 0 END) AS stock_and,
      SUM(CASE WHEN location_dest_id_name = 'YAS/Stock' THEN qty ELSE 0 END) -
      SUM(CASE WHEN location_id_name = 'YAS/Stock' THEN qty ELSE 0 END) AS stock_yas,
      SUM(CASE WHEN location_dest_id_name = 'Jouri/Stock' THEN qty ELSE 0 END) -
      SUM(CASE WHEN location_id_name = 'Jouri/Stock' THEN qty ELSE 0 END) AS stock_jou,
      SUM(CASE WHEN location_dest_id_name = 'WH/Stock' THEN qty ELSE 0 END) -
      SUM(CASE WHEN location_id_name = 'WH/Stock' THEN qty ELSE 0 END) AS stock_wh,
      SUM(CASE WHEN location_dest_id_name = 'Partners/Customers' THEN qty ELSE 0 END) -
      SUM(CASE WHEN location_id_name = 'Partners/Customers' THEN qty ELSE 0 END) AS sold_lifetime,
      SUM(CASE WHEN location_dest_id_name = 'Partners/Customers' AND date >= datetime('now', '-14 days') THEN qty ELSE 0 END) -
      SUM(CASE WHEN location_id_name = 'Partners/Customers' AND date >= datetime('now', '-14 days') THEN qty ELSE 0 END) AS sold_2wk,
      SUM(CASE WHEN location_dest_id_name = 'Partners/Customers' AND date >= datetime('now', '-28 days') THEN qty ELSE 0 END) -
      SUM(CASE WHEN location_id_name = 'Partners/Customers' AND date >= datetime('now', '-28 days') THEN qty ELSE 0 END) AS sold_4wk,
      SUM(CASE WHEN location_dest_id_name = 'Partners/Customers' AND date >= datetime('now', '-56 days') THEN qty ELSE 0 END) -
      SUM(CASE WHEN location_id_name = 'Partners/Customers' AND date >= datetime('now', '-56 days') THEN qty ELSE 0 END) AS sold_8wk,
      MIN(CASE WHEN location_dest_id_name = 'Partners/Customers' THEN date END) AS first_sale_date,
      MIN(date) AS first_move_date,
      SUM(COALESCE(eff_unit_cost, 0)) AS cost_sum,
      COUNT(eff_unit_cost) AS cost_cnt,
      MAX(COALESCE(num_list_price, 0)) AS max_list_price,
      MAX(COALESCE(pos_sales_price, 0)) AS max_sales_price,
      SUM(COALESCE(cust_sales_price, 0)) AS asp_sum,
      COUNT(cust_sales_price) AS asp_cnt,
      TRIM(MAX(product_category_id_name)) AS category,
      TRIM(MAX(season_id_name)) AS season
    FROM base_moves
    GROUP BY style_code, size_code;
  `;

  try {
    const { results: sizeRows } = await db.prepare(singlePassQuery).all<any>();
    if (!sizeRows || sizeRows.length === 0) return [];

    interface StyleAccumulator {
      styleCode: string;
      productName: string;
      stockAnd: number;
      stockYas: number;
      stockJou: number;
      stockWh: number;
      soldLifetime: number;
      sold2wk: number;
      sold4wk: number;
      sold8wk: number;
      firstSaleDate: string | null;
      firstMoveDate: string | null;
      costSum: number;
      costCnt: number;
      maxListPrice: number;
      maxSalesPrice: number;
      aspSum: number;
      aspCnt: number;
      category: string;
      season: string;
      sizeBreakdown: Record<string, number>;
      everSizes: string[];
    }

    const byStyle = new Map<string, StyleAccumulator>();
    const nowMs = Date.now();

    for (const sr of sizeRows) {
      const code = sr.style_code;
      if (!code) continue;
      let acc = byStyle.get(code);
      if (!acc) {
        acc = {
          styleCode: code,
          productName: sr.product_name || code,
          stockAnd: 0,
          stockYas: 0,
          stockJou: 0,
          stockWh: 0,
          soldLifetime: 0,
          sold2wk: 0,
          sold4wk: 0,
          sold8wk: 0,
          firstSaleDate: null,
          firstMoveDate: null,
          costSum: 0,
          costCnt: 0,
          maxListPrice: 0,
          maxSalesPrice: 0,
          aspSum: 0,
          aspCnt: 0,
          category: '',
          season: '',
          sizeBreakdown: {},
          everSizes: []
        };
        byStyle.set(code, acc);
      }

      if (sr.product_name && String(sr.product_name) > acc.productName) {
        acc.productName = String(sr.product_name);
      }
      const sAnd = Number(sr.stock_and) || 0;
      const sYas = Number(sr.stock_yas) || 0;
      const sJou = Number(sr.stock_jou) || 0;
      const sWh = Number(sr.stock_wh) || 0;
      acc.stockAnd += sAnd;
      acc.stockYas += sYas;
      acc.stockJou += sJou;
      acc.stockWh += sWh;

      acc.soldLifetime += Number(sr.sold_lifetime) || 0;
      acc.sold2wk += Number(sr.sold_2wk) || 0;
      acc.sold4wk += Number(sr.sold_4wk) || 0;
      acc.sold8wk += Number(sr.sold_8wk) || 0;

      if (sr.first_sale_date && (!acc.firstSaleDate || String(sr.first_sale_date) < acc.firstSaleDate)) {
        acc.firstSaleDate = String(sr.first_sale_date);
      }
      if (sr.first_move_date && (!acc.firstMoveDate || String(sr.first_move_date) < acc.firstMoveDate)) {
        acc.firstMoveDate = String(sr.first_move_date);
      }

      acc.costSum += Number(sr.cost_sum) || 0;
      acc.costCnt += Number(sr.cost_cnt) || 0;
      acc.maxListPrice = Math.max(acc.maxListPrice, Number(sr.max_list_price) || 0);
      acc.maxSalesPrice = Math.max(acc.maxSalesPrice, Number(sr.max_sales_price) || 0);
      acc.aspSum += Number(sr.asp_sum) || 0;
      acc.aspCnt += Number(sr.asp_cnt) || 0;

      if (sr.category && String(sr.category) > acc.category) acc.category = String(sr.category);
      if (sr.season && String(sr.season) > acc.season) acc.season = String(sr.season);

      const sz = (sr.size_code || 'OS').trim().toUpperCase();
      acc.everSizes.push(sz);
      const sizeQty = Math.max(0, Math.round(sAnd + sYas + sJou + sWh));
      if (sizeQty > 0) {
        acc.sizeBreakdown[sz] = (acc.sizeBreakdown[sz] || 0) + sizeQty;
      }
    }

    const out: StyleMetrics[] = [];
    for (const acc of byStyle.values()) {
      const stockAnd = Math.max(0, Math.round(acc.stockAnd));
      const stockYas = Math.max(0, Math.round(acc.stockYas));
      const stockJou = Math.max(0, Math.round(acc.stockJou));
      const stockWh = Math.max(0, Math.round(acc.stockWh));
      const totalStock = stockAnd + stockYas + stockJou + stockWh;
      if (totalStock <= 0) continue;

      const lifetimeSold = Math.max(0, Math.round(acc.soldLifetime));
      const sold2wk = Math.max(0, Math.round(acc.sold2wk));
      const sold4wk = Math.max(0, Math.round(acc.sold4wk));
      const sold8wk = Math.max(0, Math.round(acc.sold8wk));

      let daysActive = 56.0;
      if (acc.firstMoveDate) {
        const moveMs = new Date(acc.firstMoveDate).getTime();
        if (!Number.isNaN(moveMs)) {
          daysActive = Math.max(1.0, Math.round(((nowMs - moveMs) / (24 * 3600 * 1000)) * 10) / 10);
        }
      }
      const rawActiveWeeks = Math.round((daysActive / 7.0) * 10) / 10;
      const activeWeeks = Math.min(8.0, Math.max(1.0, rawActiveWeeks));

      const weeklyROS = calculateWeeklyROS(sold8wk, 8.0, activeWeeks);
      const weeklyROS2wk = calculateWeeklyROS(sold2wk, 2.0, Math.min(2.0, activeWeeks));
      const weeklyROS4wk = calculateWeeklyROS(sold4wk, 4.0, Math.min(4.0, activeWeeks));
      const momentum = calculateVelocityMomentum(weeklyROS2wk, weeklyROS);

      const strPct = (lifetimeSold + totalStock) > 0 ? (lifetimeSold / (lifetimeSold + totalStock)) * 100 : 0;
      const floorStock = stockAnd + stockYas + stockJou;
      const wos = weeklyROS > 0 ? Math.round((floorStock / weeklyROS) * 10) / 10 : 999.0;

      let salesLifecycleWeeks = 0.0;
      if (lifetimeSold > 0 && acc.firstSaleDate) {
        const msDiff = nowMs - new Date(acc.firstSaleDate).getTime();
        if (!Number.isNaN(msDiff)) {
          salesLifecycleWeeks = Math.max(0.0, Math.round((msDiff / (7 * 24 * 3600 * 1000)) * 10) / 10);
        }
      }

      const unitCost = acc.costCnt > 0 ? Math.round((acc.costSum / acc.costCnt) * 100) / 100 : 10.0;
      const ticketRaw = acc.maxListPrice > 0 ? acc.maxListPrice : (acc.maxSalesPrice > 0 ? acc.maxSalesPrice : 39.0);
      const ticketPrice = Math.round(ticketRaw * 100) / 100;
      const historicalASP = (lifetimeSold > 0 && acc.aspCnt > 0)
        ? Math.round((acc.aspSum / acc.aspCnt) * 100) / 100
        : undefined;

      const category = (acc.category || 'General').trim();
      const season = (acc.season || 'Continuity').trim();
      const isSingleSize = detectSingleSizeAssortment(category, acc.productName, undefined, acc.sizeBreakdown, acc.everSizes);
      const sizeHealth = evaluateSizeStockHealth(acc.sizeBreakdown, acc.everSizes);

      out.push({
        styleCode: acc.styleCode,
        productName: acc.productName,
        category,
        season,
        unitCost,
        ticketPrice,
        totalPhysicalStock: totalStock,
        stockAndalus: stockAnd,
        stockYasmeen: stockYas,
        stockJouri: stockJou,
        stockWH: stockWh,
        weeklyROS,
        weeklyROS2wk,
        weeklyROS4wk,
        activeWeeks,
        momentumRatio: momentum.momentumRatio,
        momentumLabel: momentum.momentumLabel,
        cumulativeSTR: Math.round(strPct * 10) / 10,
        storeFloorWOS: wos,
        activeSizeCount: isSingleSize ? 1 : sizeHealth.activeSizesGE2,
        hasCoreSizes: isSingleSize ? true : sizeHealth.hasCoreSizes,
        isSingleSize,
        sizeBreakdown: Object.keys(acc.sizeBreakdown).length > 0 ? acc.sizeBreakdown : undefined,
        everSizes: acc.everSizes.length > 0 ? acc.everSizes : undefined,
        firstMoveDate: acc.firstMoveDate || undefined,
        soldUnits: lifetimeSold,
        salesLifecycleWeeks,
        historicalASP
      });
    }

    out.sort((a, b) => b.totalPhysicalStock - a.totalPhysicalStock);
    return out;
  } catch (err) {
    console.error('Error executing single-pass D1 style aggregation:', err);
    return [];
  }
}
