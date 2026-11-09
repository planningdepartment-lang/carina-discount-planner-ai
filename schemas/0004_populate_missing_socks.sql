
-- ====================================================================
-- Populate Missing Socks & Legwear Styles into style_plan_snapshots
-- ====================================================================

-- 1. Correct Style 58275 category to 'Socks'
UPDATE style_plan_snapshots
SET category = 'Socks'
WHERE style_code = '58275';

-- 2. Insert missing styles from odoo_stock_move_line
INSERT OR IGNORE INTO style_plan_snapshots (
  style_code,
  product_name,
  category,
  season,
  total_physical_stock,
  stock_andalus,
  stock_yasmeen,
  stock_jouri,
  stock_wh,
  cumulative_str_pct,
  weekly_ros,
  sar_curve_health,
  unit_cost,
  cost_plus_vat,
  ticket_price,
  recommended_offer,
  promotional_price,
  discount_pct,
  zero_loss_status,
  forecast_sold,
  forecast_profit,
  post_event_stock,
  commercial_rationale,
  last_computed_at,
  weekly_ros_2wk,
  weekly_ros_4wk,
  momentum_ratio,
  active_weeks,
  momentum_label
)
WITH raw_agg AS (
  SELECT 
    SUBSTR(product_sku, 1, 5) AS style_code,
    TRIM(product_id_name) AS product_name,
    COALESCE(MAX(product_category_id_name), 'Socks') AS category,
    COALESCE(MAX(season_id_name), 'Continuity') AS season,

    SUM(CASE WHEN location_dest_id_name IN ('AND/Stock', 'YAS/Stock', 'Jouri/Stock', 'WH/Stock') THEN COALESCE(quantity, qty_done, 0) ELSE 0 END) -
    SUM(CASE WHEN location_id_name IN ('AND/Stock', 'YAS/Stock', 'Jouri/Stock', 'WH/Stock') THEN COALESCE(quantity, qty_done, 0) ELSE 0 END) AS total_physical_stock,

    MAX(0, SUM(CASE WHEN location_dest_id_name = 'AND/Stock' THEN COALESCE(quantity, qty_done, 0) ELSE 0 END) -
           SUM(CASE WHEN location_id_name = 'AND/Stock' THEN COALESCE(quantity, qty_done, 0) ELSE 0 END)) AS stock_andalus,

    MAX(0, SUM(CASE WHEN location_dest_id_name = 'YAS/Stock' THEN COALESCE(quantity, qty_done, 0) ELSE 0 END) -
           SUM(CASE WHEN location_id_name = 'YAS/Stock' THEN COALESCE(quantity, qty_done, 0) ELSE 0 END)) AS stock_yasmeen,

    MAX(0, SUM(CASE WHEN location_dest_id_name = 'Jouri/Stock' THEN COALESCE(quantity, qty_done, 0) ELSE 0 END) -
           SUM(CASE WHEN location_id_name = 'Jouri/Stock' THEN COALESCE(quantity, qty_done, 0) ELSE 0 END)) AS stock_jouri,

    MAX(0, SUM(CASE WHEN location_dest_id_name = 'WH/Stock' THEN COALESCE(quantity, qty_done, 0) ELSE 0 END) -
           SUM(CASE WHEN location_id_name = 'WH/Stock' THEN COALESCE(quantity, qty_done, 0) ELSE 0 END)) AS stock_wh,

    SUM(CASE WHEN location_dest_id_name = 'Partners/Customers' THEN COALESCE(quantity, qty_done, 0) ELSE 0 END) -
    SUM(CASE WHEN location_id_name = 'Partners/Customers' THEN COALESCE(quantity, qty_done, 0) ELSE 0 END) AS lifetime_sold,

    SUM(CASE 
      WHEN location_dest_id_name = 'Partners/Customers' AND date >= datetime('now', '-14 days') 
      THEN COALESCE(quantity, qty_done, 0) ELSE 0 
    END) AS sold_2wk,

    SUM(CASE 
      WHEN location_dest_id_name = 'Partners/Customers' AND date >= datetime('now', '-28 days') 
      THEN COALESCE(quantity, qty_done, 0) ELSE 0 
    END) AS sold_4wk,

    SUM(CASE 
      WHEN location_dest_id_name = 'Partners/Customers' AND date >= datetime('now', '-56 days') 
      THEN COALESCE(quantity, qty_done, 0) ELSE 0 
    END) AS sold_8wk,

    COALESCE(
      ROUND(AVG(CASE 
        WHEN CAST(unit_cost AS REAL) > 0 THEN CAST(unit_cost AS REAL)
        WHEN CAST(standard_price AS REAL) > 0 THEN CAST(standard_price AS REAL)
        WHEN CAST(cost AS REAL) > 0 AND quantity > 0 AND (CAST(cost AS REAL) / quantity) < COALESCE(sales_price, 9999) THEN CAST(cost AS REAL) / quantity
      END), 2),
      5.50
    ) AS unit_cost,
    ROUND(MAX(CASE WHEN sales_price > 0 THEN sales_price ELSE 19.0 END), 2) AS ticket_price

  FROM odoo_stock_move_line
  WHERE product_sku GLOB '[0-9][0-9][0-9][0-9][0-9]-*-*'
    AND state = 'done'
    AND location_dest_id_name NOT IN ('Shofy/Stock', 'WH-D/Stock')
    AND location_id_name NOT IN ('Shofy/Stock', 'WH-D/Stock')
  GROUP BY style_code
  HAVING total_physical_stock > 0
    AND style_code NOT IN (SELECT style_code FROM style_plan_snapshots)
),
priced AS (
  SELECT 
    *,
    ROUND(unit_cost * 1.15, 2) AS cost_plus_vat,
    CASE WHEN ticket_price < ROUND(unit_cost * 1.15, 2) THEN 1 ELSE 0 END AS is_underwater,
    ROUND(CASE WHEN (lifetime_sold + total_physical_stock) > 0 THEN (lifetime_sold * 100.0 / (lifetime_sold + total_physical_stock)) ELSE 0.0 END, 1) AS cumulative_str_pct,
    ROUND(sold_8wk / 8.0, 1) AS weekly_ros,
    ROUND(sold_2wk / 2.0, 1) AS weekly_ros_2wk,
    ROUND(sold_4wk / 4.0, 1) AS weekly_ros_4wk,
    'Single Size (Complete)' AS sar_curve_health,
    0.35 AS expected_clearance_rate
  FROM raw_agg
)
SELECT 
  style_code,
  product_name,
  category,
  season,
  total_physical_stock,
  stock_andalus,
  stock_yasmeen,
  stock_jouri,
  stock_wh,
  cumulative_str_pct,
  weekly_ros,
  sar_curve_health,
  unit_cost,
  cost_plus_vat,
  ticket_price,
  'Spend & Save Eligible (~20% Off)' AS recommended_offer,
  MIN(ticket_price, MAX(cost_plus_vat, ROUND(ticket_price * 0.80, 2))) AS promotional_price,
  ROUND(MAX(0.0, (1.0 - (MIN(ticket_price, MAX(cost_plus_vat, ROUND(ticket_price * 0.80, 2))) / ticket_price)) * 100.0), 1) AS discount_pct,
  'YES' AS zero_loss_status,
  CAST(ROUND(total_physical_stock * expected_clearance_rate) AS INTEGER) AS forecast_sold,
  ROUND(CAST(ROUND(total_physical_stock * expected_clearance_rate) AS INTEGER) * ((MIN(ticket_price, MAX(cost_plus_vat, ROUND(ticket_price * 0.80, 2))) / 1.15) - unit_cost), 2) AS forecast_profit,
  CAST(ROUND(total_physical_stock * (1.0 - expected_clearance_rate)) AS INTEGER) AS post_event_stock,
  'High-velocity staple socks assortment merchandised with Spend & Save basket builder.' AS commercial_rationale,
  CURRENT_TIMESTAMP AS last_computed_at,
  weekly_ros_2wk,
  weekly_ros_4wk,
  1.0 AS momentum_ratio,
  8.0 AS active_weeks,
  'Stable' AS momentum_label
FROM priced
ORDER BY total_physical_stock DESC;
