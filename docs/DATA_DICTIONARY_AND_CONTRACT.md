# Data Dictionary & Interface Contract Specification

This document details the database schema, data transformations, and the standard 18-column Odoo POS data contract.

---

## 1. Cloudflare D1 Source Tables

### Table 1: `odoo_raw_products` (Product Master)
| Column Name | Type | Description |
| :--- | :--- | :--- |
| `id` | INTEGER | Internal Odoo Product ID |
| `name` | TEXT | Product Description (e.g. `Soft Bra -N`) |
| `default_code` | TEXT | Primary Internal Reference / SKU (e.g. `50003-01-2XL`) |
| `product_sku` | TEXT | SKU variant string |
| `standard_price` | REAL | Landed unit acquisition cost in SAR |
| `list_price` / `lst_price` | REAL | System list ticket price in SAR (inclusive of VAT) |
| `season_id_name` | TEXT | Season identifier (e.g. `All Season 2018`, `SS26`, `AW26`) |
| `product_tmpl_id_name` | TEXT | Product Template Grouping Name |
| `all_fields_json` | TEXT | Extended Odoo attributes JSON |

### Table 2: `odoo_stock_move_line` (Stock Movements)
| Column Name | Type | Description |
| :--- | :--- | :--- |
| `id` | INTEGER | Move line unique ID |
| `product_id_name` | TEXT | Product Name (must be trimmed) |
| `product_sku` | TEXT | SKU code (used for style code extraction) |
| `location_id_name` | TEXT | Source location (e.g. `WH/Stock`, `AND/Stock`) |
| `location_dest_id_name`| TEXT | Destination location (e.g. `AND/Stock`, `Partners/Customers`) |
| `quantity` / `qty_done`| REAL | Quantity moved |
| `date` | TEXT | Timestamp of move (`YYYY-MM-DDTHH:MM:SSZ`) |
| `unit_cost` / `cost` | REAL | Cost per unit recorded at time of move |
| `sales_price` | REAL | Retail price recorded at time of move |

---

## 2. D1 Auxiliary System Tables

### Table 3: `business_rules` (Dynamic Governance Ledger)
```sql
CREATE TABLE IF NOT EXISTS business_rules (
    rule_id TEXT PRIMARY KEY,
    rule_name TEXT NOT NULL,
    rule_category TEXT NOT NULL,       -- 'MARGIN', 'DISCOUNT_CAP', 'EXCLUSION', 'STOCK_TARGET'
    target_scope TEXT NOT NULL,        -- 'GLOBAL', 'CATEGORY:Bra', 'STYLE:50003', 'STORE:Jouri'
    condition_operator TEXT NOT NULL,  -- 'MIN', 'MAX', 'EQUALS', 'EXCLUDE'
    rule_value TEXT NOT NULL,          -- e.g. '45.0', 'AW26', '20.0'
    enforcement_level TEXT NOT NULL,   -- 'HARD_BLOCK' or 'WARNING'
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Table 4: `style_plan_snapshots` (Cached Plan Results)
```sql
CREATE TABLE IF NOT EXISTS style_plan_snapshots (
    style_code TEXT PRIMARY KEY,
    product_name TEXT NOT NULL,
    category TEXT,
    season TEXT,
    total_physical_stock INTEGER,
    stock_andalus INTEGER,
    stock_yasmeen INTEGER,
    stock_jouri INTEGER,
    stock_wh INTEGER,
    cumulative_str_pct REAL,
    weekly_ros REAL,
    sar_curve_health TEXT,
    unit_cost REAL,
    cost_plus_vat REAL,
    ticket_price REAL,
    recommended_offer TEXT,
    promotional_price REAL,
    discount_pct REAL,
    zero_loss_status TEXT,
    forecast_sold INTEGER,
    forecast_profit REAL,
    post_event_stock INTEGER,
    commercial_rationale TEXT,
    last_computed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 3. Standard 18-Column Export Contract

Every generated plan and POS export conforms to this exact 18-field schema:

| # | Field Name | Type | Sample Value | Description |
| :-: | :--- | :--- | :--- | :--- |
| **1** | `Product_Style_Code` | String | `50003` | 5-digit master style code |
| **2** | `Product_Name` | String | `Soft Bra -N` | Cleaned product description |
| **3** | `Category` | String | `Bra` | Merchandising category |
| **4** | `Season_Group` | String | `All Season 2018` | Continuity vs Seasonal classification |
| **5** | `Total_Stock_Physical`| Integer | `142` | Total units across AND, YAS, Jouri, WH |
| **6** | `Stock_Breakdown` | String | `AND:45 \| YAS:52 \| Jouri:30 \| WH:15` | Location allocation |
| **7** | `Cumulative_STR_%` | Float | `82.1%` | Lifetime sell-through percentage |
| **8** | `Weekly_ROS_Units` | Float | `14.2` | Units sold/week over active 8-week baseline |
| **9** | `Curve_Health` | String | `Healthy Curve (>=3 Sizes)` | Size curve classification |
| **10** | `Landed_Unit_Cost_SAR` | Float | `10.17` | Landed acquisition cost in SAR |
| **11** | `Cost_Plus_15%_VAT_SAR`| Float | `11.70` | Legal zero-loss floor |
| **12** | `Original_Ticket_Price_SAR`| Float | `49.00` | Full catalog price |
| **13** | `Recommended_Offer` | String | `Buy 2 Packs 20% Off` | Customer-facing mechanic |
| **14** | `Recommended_Discount_%`| Float | `20.0%` | Discount depth |
| **15** | `Promotional_Price_SAR` | Float | `39.20` | VAT-inclusive price scanned at register |
| **16** | `Zero_Loss_Verified` | String | `YES` | Automated mathematical compliance flag |
| **17** | `Offer_Dates` | String | `2026-11-25 to 2026-12-05` | Campaign lifecycle window |
| **18** | `Commercial_Rationale` | String | `Core continuity line. Preserves 80% price realization.` | Strategic justification |
