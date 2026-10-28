-- ====================================================================
-- Rebuild style_plan_snapshots Directly from odoo_stock_move_line
-- Categorizes Non-Sized / Single-Size items (Cosmetics, Towels, Accessories)
-- as "Single Size (Complete)" instead of false-positive "Broken Curve".
-- ====================================================================

DELETE FROM style_plan_snapshots;

INSERT INTO style_plan_snapshots (
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
  last_computed_at
)
WITH raw_agg AS (
  SELECT 
    SUBSTR(product_sku, 1, 5) AS style_code,
    TRIM(product_id_name) AS product_name,
    COALESCE(MAX(product_category_id_name), 'General') AS category,
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
      WHEN location_dest_id_name = 'Partners/Customers' AND date >= datetime('now', '-56 days') 
      THEN COALESCE(quantity, qty_done, 0) ELSE 0 
    END) AS sold_8wk,

    COUNT(DISTINCT product_sku) AS size_count,
    ROUND(MAX(COALESCE(cost, unit_cost, 10.0)), 2) AS unit_cost,
    ROUND(MAX(CASE WHEN sales_price > 0 THEN sales_price ELSE 39.0 END), 2) AS ticket_price,

    -- Single Size / Non-Sized Identification:
    CASE 
      WHEN UPPER(COALESCE(MAX(product_category_id_name), '')) IN (
        'COSMETICS', 'TOWEL', 'SCARF', 'PILLOW', 'PILLOWCASES', 
        'DUVET', 'SHEETS', 'BANDANA', 'EYE COVER', 'SLEEVES', 'BUNDLE'
      ) 
      OR UPPER(TRIM(product_id_name)) GLOB '*[0-9][0-9]ML*'
      OR UPPER(TRIM(product_id_name)) GLOB '*[0-9][0-9][0-9]ML*'
      OR UPPER(TRIM(product_id_name)) LIKE '%FREE SIZE%'
      OR UPPER(TRIM(product_id_name)) LIKE '%ONE SIZE%'
      OR UPPER(TRIM(product_id_name)) LIKE '%100ML%'
      OR UPPER(TRIM(product_id_name)) LIKE '%50ML%'
      OR UPPER(TRIM(product_id_name)) LIKE '%250ML%'
      THEN 1 ELSE 0 
    END AS is_single_size

  FROM odoo_stock_move_line
  WHERE product_sku GLOB '[0-9][0-9][0-9][0-9][0-9]-*-*'
    AND location_dest_id_name != 'Shofy/Stock'
    AND location_id_name != 'Shofy/Stock'
    AND location_dest_id_name != 'WH-D/Stock'
  GROUP BY style_code
  HAVING total_physical_stock > 0
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

  ROUND(CASE WHEN (lifetime_sold + total_physical_stock) > 0 THEN (lifetime_sold * 100.0 / (lifetime_sold + total_physical_stock)) ELSE 0.0 END, 1) AS cumulative_str_pct,
  ROUND(sold_8wk / 8.0, 1) AS weekly_ros,
  
  -- SAR Curve Health:
  CASE 
    WHEN is_single_size = 1 THEN 'Single Size (Complete)'
    WHEN size_count >= 3 THEN 'Healthy Curve (>=3 Sizes)' 
    ELSE 'Broken Curve (<=2 Sizes)' 
  END AS sar_curve_health,

  unit_cost,
  ROUND(unit_cost * 1.15, 2) AS cost_plus_vat,
  ticket_price,

  -- Recommended Offer
  CASE 
    -- 1. Winter Assortment Protection
    WHEN UPPER(season) LIKE '%AW26%' OR UPPER(season) LIKE '%WINTER 2026%' THEN '100% Full Ticket Price (0% Off)'
    
    -- 2. Non-Sized / Single Size Mechanics (Cosmetics, Towels, Beauty)
    WHEN is_single_size = 1 AND (CASE WHEN (lifetime_sold + total_physical_stock) > 0 THEN (lifetime_sold * 100.0 / (lifetime_sold + total_physical_stock)) ELSE 0.0 END) >= 50.0 THEN 'Full Price Margin Protection (0% Off)'
    WHEN is_single_size = 1 AND total_physical_stock > 100 THEN 'Spend 250 Save 50 (Basket Pack)'
    WHEN is_single_size = 1 THEN 'Beauty Multi-Buy (Buy 2 Get 1 Free)'
    
    -- 3. Core Sized Apparel (Category Captains)
    WHEN size_count >= 3 AND (CASE WHEN (lifetime_sold + total_physical_stock) > 0 THEN (lifetime_sold * 100.0 / (lifetime_sold + total_physical_stock)) ELSE 0.0 END) >= 70.0 THEN 'Full Price Margin Protection (0% Off)'
    
    -- 4. Summer Exit
    WHEN UPPER(season) LIKE '%SS26%' OR UPPER(season) LIKE '%SUMMER 2026%' OR UPPER(season) LIKE '%SS 26%' THEN 'Category Markdown 40% Off'
    
    -- 5. True Sized Apparel Broken Oddments (size_count <= 2 AND NOT single size)
    WHEN is_single_size = 0 AND size_count <= 2 THEN (CASE WHEN ticket_price <= 40.0 THEN '50% Off Dedicated Clearance Rail' ELSE 'Take 3 For 99 SAR Rail (33 SAR/u)' END)
    
    -- 6. Default Spend & Save
    ELSE 'Spend & Save Eligible (~20% Off)'
  END AS recommended_offer,

  -- Promotional Price
  CASE 
    WHEN UPPER(season) LIKE '%AW26%' OR UPPER(season) LIKE '%WINTER 2026%' THEN ticket_price
    WHEN is_single_size = 1 AND (CASE WHEN (lifetime_sold + total_physical_stock) > 0 THEN (lifetime_sold * 100.0 / (lifetime_sold + total_physical_stock)) ELSE 0.0 END) >= 50.0 THEN ticket_price
    WHEN is_single_size = 1 AND total_physical_stock > 100 THEN MAX(ROUND(unit_cost * 1.15, 2), ROUND(ticket_price * 0.80, 2))
    WHEN is_single_size = 1 THEN MAX(ROUND(unit_cost * 1.15, 2), ROUND(ticket_price * 0.67, 2))
    WHEN size_count >= 3 AND (CASE WHEN (lifetime_sold + total_physical_stock) > 0 THEN (lifetime_sold * 100.0 / (lifetime_sold + total_physical_stock)) ELSE 0.0 END) >= 70.0 THEN ticket_price
    WHEN UPPER(season) LIKE '%SS26%' OR UPPER(season) LIKE '%SUMMER 2026%' OR UPPER(season) LIKE '%SS 26%' THEN MAX(ROUND(unit_cost * 1.15, 2), ROUND(ticket_price * 0.60, 2))
    WHEN is_single_size = 0 AND size_count <= 2 THEN (CASE WHEN ticket_price <= 40.0 THEN MAX(ROUND(unit_cost * 1.15, 2), ROUND(ticket_price * 0.50, 2)) ELSE (CASE WHEN 33.00 >= ROUND(unit_cost * 1.15, 2) THEN 33.00 ELSE ROUND(ticket_price * 0.60, 2) END) END)
    ELSE MAX(ROUND(unit_cost * 1.15, 2), ROUND(ticket_price * 0.80, 2))
  END AS promotional_price,

  -- Discount %
  ROUND(CASE WHEN ticket_price > 0 THEN (1.0 - (
    CASE 
      WHEN UPPER(season) LIKE '%AW26%' OR UPPER(season) LIKE '%WINTER 2026%' THEN ticket_price
      WHEN is_single_size = 1 AND (CASE WHEN (lifetime_sold + total_physical_stock) > 0 THEN (lifetime_sold * 100.0 / (lifetime_sold + total_physical_stock)) ELSE 0.0 END) >= 50.0 THEN ticket_price
      WHEN is_single_size = 1 AND total_physical_stock > 100 THEN MAX(ROUND(unit_cost * 1.15, 2), ROUND(ticket_price * 0.80, 2))
      WHEN is_single_size = 1 THEN MAX(ROUND(unit_cost * 1.15, 2), ROUND(ticket_price * 0.67, 2))
      WHEN size_count >= 3 AND (CASE WHEN (lifetime_sold + total_physical_stock) > 0 THEN (lifetime_sold * 100.0 / (lifetime_sold + total_physical_stock)) ELSE 0.0 END) >= 70.0 THEN ticket_price
      WHEN UPPER(season) LIKE '%SS26%' OR UPPER(season) LIKE '%SUMMER 2026%' OR UPPER(season) LIKE '%SS 26%' THEN MAX(ROUND(unit_cost * 1.15, 2), ROUND(ticket_price * 0.60, 2))
      WHEN is_single_size = 0 AND size_count <= 2 THEN (CASE WHEN ticket_price <= 40.0 THEN MAX(ROUND(unit_cost * 1.15, 2), ROUND(ticket_price * 0.50, 2)) ELSE (CASE WHEN 33.00 >= ROUND(unit_cost * 1.15, 2) THEN 33.00 ELSE ROUND(ticket_price * 0.60, 2) END) END)
      ELSE MAX(ROUND(unit_cost * 1.15, 2), ROUND(ticket_price * 0.80, 2))
    END / ticket_price
  )) * 100.0 ELSE 0.0 END, 1) AS discount_pct,

  'YES' AS zero_loss_status,
  CAST(ROUND(total_physical_stock * 0.40) AS INTEGER) AS forecast_sold,
  ROUND((CAST(ROUND(total_physical_stock * 0.40) AS INTEGER) * ((MAX(ROUND(unit_cost * 1.15, 2), ROUND(ticket_price * 0.80, 2)) / 1.15) - unit_cost)), 2) AS forecast_profit,
  CAST(ROUND(total_physical_stock * 0.60) AS INTEGER) AS post_event_stock,
  CASE 
    WHEN is_single_size = 1 THEN 'Core non-sized / volumetric merchandise. Merchandised as basket builder rather than broken-size oddment rail.'
    ELSE 'Assortment lifecycle strategy derived from store inventory, size curve health, and sales velocity.'
  END AS commercial_rationale,
  CURRENT_TIMESTAMP AS last_computed_at

FROM raw_agg
ORDER BY total_physical_stock DESC;
