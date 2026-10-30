-- ====================================================================
-- Rebuild style_plan_snapshots Directly from odoo_stock_move_line
-- Categorizes Non-Sized / Single-Size items (Cosmetics, Towels, Accessories)
-- as "Single Size (Complete)" instead of false-positive "Broken Curve".
-- Uses validated 'done' moves only and true unit_cost / standard_price.
-- Enforces Saudi Zero-Loss Floor & prevents promotional_price > ticket_price.
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

    COUNT(DISTINCT 
        CASE 
          WHEN INSTR(SUBSTR(TRIM(product_sku), 7), '-') > 0 
          THEN SUBSTR(SUBSTR(TRIM(product_sku), 7), 1, INSTR(SUBSTR(TRIM(product_sku), 7), '-') - 1)
          ELSE product_sku
        END
      ) AS size_count,
    COALESCE(
      ROUND(AVG(CASE 
        WHEN CAST(unit_cost AS REAL) > 0 THEN CAST(unit_cost AS REAL)
        WHEN CAST(standard_price AS REAL) > 0 THEN CAST(standard_price AS REAL)
        WHEN CAST(cost AS REAL) > 0 AND quantity > 0 AND (CAST(cost AS REAL) / quantity) < COALESCE(sales_price, 9999) THEN CAST(cost AS REAL) / quantity
      END), 2),
      10.0
    ) AS unit_cost,
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
    AND state = 'done'
    AND location_dest_id_name != 'Shofy/Stock'
    AND location_id_name != 'Shofy/Stock'
    AND location_dest_id_name != 'WH-D/Stock'
    AND location_id_name != 'WH-D/Stock'
  GROUP BY style_code
  HAVING total_physical_stock > 0
),
priced AS (
  SELECT 
    *,
    ROUND(unit_cost * 1.15, 2) AS cost_plus_vat,
    CASE WHEN ticket_price < ROUND(unit_cost * 1.15, 2) THEN 1 ELSE 0 END AS is_underwater,
    ROUND(CASE WHEN (lifetime_sold + total_physical_stock) > 0 THEN (lifetime_sold * 100.0 / (lifetime_sold + total_physical_stock)) ELSE 0.0 END, 1) AS cumulative_str_pct,
    ROUND(sold_8wk / 8.0, 1) AS weekly_ros,
    CASE 
      WHEN is_single_size = 1 THEN 'Single Size (Complete)'
      WHEN size_count >= 3 THEN 'Healthy Curve (>=3 Sizes)' 
      ELSE 'Broken Curve (<=2 Sizes)' 
    END AS sar_curve_health,
    CASE 
      -- Dynamic Expected Clearance Rates per Merchandising Tier:
      WHEN (CASE WHEN ticket_price < ROUND(unit_cost * 1.15, 2) THEN 1 ELSE 0 END) = 1 THEN 0.05
      WHEN UPPER(season) LIKE '%AW26%' OR UPPER(season) LIKE '%WINTER 2026%' THEN 0.15
      WHEN is_single_size = 1 AND (CASE WHEN (lifetime_sold + total_physical_stock) > 0 THEN (lifetime_sold * 100.0 / (lifetime_sold + total_physical_stock)) ELSE 0.0 END) >= 50.0 THEN 0.25
      WHEN is_single_size = 1 AND total_physical_stock > 100 THEN 0.40
      WHEN is_single_size = 1 THEN 0.45
      WHEN size_count >= 3 AND (CASE WHEN (lifetime_sold + total_physical_stock) > 0 THEN (lifetime_sold * 100.0 / (lifetime_sold + total_physical_stock)) ELSE 0.0 END) >= 70.0 THEN 0.20
      WHEN UPPER(season) LIKE '%SS26%' OR UPPER(season) LIKE '%SUMMER 2026%' OR UPPER(season) LIKE '%SS 26%' THEN 0.45
      WHEN is_single_size = 0 AND size_count <= 2 THEN (CASE WHEN ticket_price <= 40.0 THEN 0.50 ELSE 0.55 END)
      ELSE 0.25
    END AS expected_clearance_rate
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

  -- Recommended Offer
  CASE 
    -- 0. Guard against Catalog Price Error (Ticket < Landed Cost + 15% VAT)
    WHEN is_underwater = 1 THEN 'FLAGGED: System Price Error (0% Off)'

    -- 1. Winter Assortment Protection
    WHEN UPPER(season) LIKE '%AW26%' OR UPPER(season) LIKE '%WINTER 2026%' THEN '100% Full Ticket Price (0% Off)'
    
    -- 2. Non-Sized / Single Size Mechanics (Cosmetics, Towels, Beauty)
    WHEN is_single_size = 1 AND cumulative_str_pct >= 50.0 THEN 'Full Price Margin Protection (0% Off)'
    WHEN is_single_size = 1 AND total_physical_stock > 100 THEN 'Spend 250 Save 50 (Basket Pack)'
    WHEN is_single_size = 1 THEN 'Beauty Multi-Buy (Buy 2 Get 1 Free)'
    
    -- 3. Core Sized Apparel (Category Captains)
    WHEN size_count >= 3 AND cumulative_str_pct >= 70.0 THEN 'Full Price Margin Protection (0% Off)'
    
    -- 4. Summer Exit
    WHEN UPPER(season) LIKE '%SS26%' OR UPPER(season) LIKE '%SUMMER 2026%' OR UPPER(season) LIKE '%SS 26%' THEN 'Category Markdown 40% Off'
    
    -- 5. True Sized Apparel Broken Oddments (size_count <= 2 AND NOT single size)
    WHEN is_single_size = 0 AND size_count <= 2 THEN (CASE WHEN ticket_price <= 40.0 THEN '50% Off Dedicated Clearance Rail' ELSE 'Take 3 For 99 SAR Rail (33 SAR/u)' END)
    
    -- 6. Default Spend & Save
    ELSE 'Spend & Save Eligible (~20% Off)'
  END AS recommended_offer,

  -- Promotional Price
  CASE 
    WHEN is_underwater = 1 THEN ticket_price
    WHEN UPPER(season) LIKE '%AW26%' OR UPPER(season) LIKE '%WINTER 2026%' THEN ticket_price
    WHEN is_single_size = 1 AND cumulative_str_pct >= 50.0 THEN ticket_price
    WHEN is_single_size = 1 AND total_physical_stock > 100 THEN MIN(ticket_price, MAX(cost_plus_vat, ROUND(ticket_price * 0.80, 2)))
    WHEN is_single_size = 1 THEN MIN(ticket_price, MAX(cost_plus_vat, ROUND(ticket_price * 0.67, 2)))
    WHEN size_count >= 3 AND cumulative_str_pct >= 70.0 THEN ticket_price
    WHEN UPPER(season) LIKE '%SS26%' OR UPPER(season) LIKE '%SUMMER 2026%' OR UPPER(season) LIKE '%SS 26%' THEN MIN(ticket_price, MAX(cost_plus_vat, ROUND(ticket_price * 0.60, 2)))
    WHEN is_single_size = 0 AND size_count <= 2 THEN (CASE WHEN ticket_price <= 40.0 THEN MIN(ticket_price, MAX(cost_plus_vat, ROUND(ticket_price * 0.50, 2))) ELSE (CASE WHEN 33.00 >= cost_plus_vat AND 33.00 <= ticket_price THEN 33.00 ELSE MIN(ticket_price, MAX(cost_plus_vat, ROUND(ticket_price * 0.60, 2))) END) END)
    ELSE MIN(ticket_price, MAX(cost_plus_vat, ROUND(ticket_price * 0.80, 2)))
  END AS promotional_price,

  -- Discount %
  ROUND(MAX(0.0, CASE WHEN ticket_price > 0 THEN (1.0 - (
    (CASE 
      WHEN is_underwater = 1 THEN ticket_price
      WHEN UPPER(season) LIKE '%AW26%' OR UPPER(season) LIKE '%WINTER 2026%' THEN ticket_price
      WHEN is_single_size = 1 AND cumulative_str_pct >= 50.0 THEN ticket_price
      WHEN is_single_size = 1 AND total_physical_stock > 100 THEN MIN(ticket_price, MAX(cost_plus_vat, ROUND(ticket_price * 0.80, 2)))
      WHEN is_single_size = 1 THEN MIN(ticket_price, MAX(cost_plus_vat, ROUND(ticket_price * 0.67, 2)))
      WHEN size_count >= 3 AND cumulative_str_pct >= 70.0 THEN ticket_price
      WHEN UPPER(season) LIKE '%SS26%' OR UPPER(season) LIKE '%SUMMER 2026%' OR UPPER(season) LIKE '%SS 26%' THEN MIN(ticket_price, MAX(cost_plus_vat, ROUND(ticket_price * 0.60, 2)))
      WHEN is_single_size = 0 AND size_count <= 2 THEN (CASE WHEN ticket_price <= 40.0 THEN MIN(ticket_price, MAX(cost_plus_vat, ROUND(ticket_price * 0.50, 2))) ELSE (CASE WHEN 33.00 >= cost_plus_vat AND 33.00 <= ticket_price THEN 33.00 ELSE MIN(ticket_price, MAX(cost_plus_vat, ROUND(ticket_price * 0.60, 2))) END) END)
      ELSE MIN(ticket_price, MAX(cost_plus_vat, ROUND(ticket_price * 0.80, 2)))
    END) / ticket_price
  )) * 100.0 ELSE 0.0 END), 1) AS discount_pct,

  CASE WHEN is_underwater = 1 THEN 'FLAGGED' ELSE 'YES' END AS zero_loss_status,
  CAST(ROUND(total_physical_stock * expected_clearance_rate) AS INTEGER) AS forecast_sold,
  ROUND((CAST(ROUND(total_physical_stock * expected_clearance_rate) AS INTEGER) * (((
    CASE 
      WHEN is_underwater = 1 THEN ticket_price
      WHEN UPPER(season) LIKE '%AW26%' OR UPPER(season) LIKE '%WINTER 2026%' THEN ticket_price
      WHEN is_single_size = 1 AND cumulative_str_pct >= 50.0 THEN ticket_price
      WHEN is_single_size = 1 AND total_physical_stock > 100 THEN MIN(ticket_price, MAX(cost_plus_vat, ROUND(ticket_price * 0.80, 2)))
      WHEN is_single_size = 1 THEN MIN(ticket_price, MAX(cost_plus_vat, ROUND(ticket_price * 0.67, 2)))
      WHEN size_count >= 3 AND cumulative_str_pct >= 70.0 THEN ticket_price
      WHEN UPPER(season) LIKE '%SS26%' OR UPPER(season) LIKE '%SUMMER 2026%' OR UPPER(season) LIKE '%SS 26%' THEN MIN(ticket_price, MAX(cost_plus_vat, ROUND(ticket_price * 0.60, 2)))
      WHEN is_single_size = 0 AND size_count <= 2 THEN (CASE WHEN ticket_price <= 40.0 THEN MIN(ticket_price, MAX(cost_plus_vat, ROUND(ticket_price * 0.50, 2))) ELSE (CASE WHEN 33.00 >= cost_plus_vat AND 33.00 <= ticket_price THEN 33.00 ELSE MIN(ticket_price, MAX(cost_plus_vat, ROUND(ticket_price * 0.60, 2))) END) END)
      ELSE MIN(ticket_price, MAX(cost_plus_vat, ROUND(ticket_price * 0.80, 2)))
    END
  ) / 1.15) - unit_cost)), 2) AS forecast_profit,
  CAST(ROUND(total_physical_stock * (1.0 - expected_clearance_rate)) AS INTEGER) AS post_event_stock,
  CASE 
    WHEN is_underwater = 1 THEN 'Catalog Ticket Price is below Landed Unit Cost (15% VAT). Clamped to list ticket to prevent below-cost selling. Requires ERP catalog audit.'
    WHEN is_single_size = 1 THEN 'Core non-sized / volumetric merchandise. Merchandised as basket builder rather than broken-size oddment rail.'
    ELSE 'Assortment lifecycle strategy derived from store inventory, size curve health, and sales velocity.'
  END AS commercial_rationale,
  CURRENT_TIMESTAMP AS last_computed_at

FROM priced
ORDER BY total_physical_stock DESC;
