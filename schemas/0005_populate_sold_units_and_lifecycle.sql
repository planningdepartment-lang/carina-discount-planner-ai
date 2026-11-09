UPDATE style_plan_snapshots
SET 
  sold_units = MAX(0, s.sold_lifetime),
  sales_lifecycle_weeks = CASE 
    WHEN s.sold_lifetime > 0 AND s.min_sale_date IS NOT NULL 
    THEN ROUND(MAX(0.0, (julianday('now') - julianday(s.min_sale_date)) / 7.0), 1)
    ELSE 0.0 
  END
FROM (
  SELECT 
    SUBSTR(TRIM(product_sku), 1, 5) AS style_code,
    SUM(CASE WHEN location_dest_id_name = 'Partners/Customers' THEN COALESCE(quantity, qty_done, 0) ELSE 0 END) -
    SUM(CASE WHEN location_id_name = 'Partners/Customers' THEN COALESCE(quantity, qty_done, 0) ELSE 0 END) AS sold_lifetime,
    MIN(CASE WHEN location_dest_id_name = 'Partners/Customers' THEN date END) AS min_sale_date
  FROM odoo_stock_move_line
  WHERE product_sku GLOB '[0-9][0-9][0-9][0-9][0-9]-*-*'
    AND state = 'done'
  GROUP BY style_code
) AS s
WHERE style_plan_snapshots.style_code = s.style_code;
