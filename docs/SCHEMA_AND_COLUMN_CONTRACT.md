# CARINA D1 Schema & Column Contract Specification
## Permanent Autonomous Data Engine Reference

---

### Executive Overview
This document serves as the permanent, immutable technical specification for data ingestion, column mapping, and anomaly handling in the **CARINA Autonomous Style Lifecycle Monitor & Strategic Discount Planner**. It provides strict rules for Cloudflare Workers, AI Copilot, and ETL processes to eliminate guessing.

---

### 1. `odoo_stock_move_line` Data Dictionary & Column Contract

The D1 table `odoo_stock_move_line` mirrors Odoo ERP stock operations. The table contains 82 raw columns. The table below documents the core operational columns, their required data types, and extraction instructions:

| Field Name | Type | Contract Role | Rule & Handling Logic |
| :--- | :--- | :--- | :--- |
| `id` | INTEGER | Primary Key | Unique line ID in Odoo ERP. |
| `product_id` | INTEGER | Foreign Key | Foreign key to `product.product`. |
| `product_id_name` | TEXT | Display Name | Format `[SKU] Product Name` or `Product Name`. Must be trimmed. |
| `product_sku` | TEXT | **Master SKU Key** | **Strict Validation Required**: Must match `^\d{5}-[A-Za-z0-9\s]+-[A-Za-z0-9]+$` (e.g. `55915-XS-88` where `55915` is model, `XS` is size, `88` is color code). Non-matching values are discarded from style analysis. |
| `location_id` | INTEGER | Source Loc ID | Origin storage location. |
| `location_id_name` | TEXT | Source Name | Full path name (e.g., `WH/Stock`, `AND/Stock`, `YAS/Stock`, `JOU/Stock`, `Partners/Customers`). |
| `location_dest_id` | INTEGER | Dest Loc ID | Target storage location. |
| `location_dest_id_name`| TEXT | Dest Name | Destination location name. Used to compute POS departures vs warehouse receipts. |
| `quantity` / `qty_done` | REAL | Quantity Moved | Movement volume. Positive float. Default to `0.0` if null. |
| `date` | TEXT | Movement Timestamp | ISO 8601 string `YYYY-MM-DDTHH:MM:SSZ`. |
| `state` | TEXT | Workflow State | Values: `'done'`, `'assigned'`, `'confirmed'`, `'cancel'`. **Only `'done'` records count towards physical on-hand stock and sales history.** |
| `reference` | TEXT | Picking Doc Ref | Odoo transfer identifier (e.g. `WH/OUT/01294`, `POS/2026/10/0042`). |
| `origin` | TEXT | Source Document | Sales order, POS session, or replenishment reference. |
| `company_id` | INTEGER | Entity Filter | KSA operating company ID (`company_id = 1`). |
| `cost` / `unit_cost` | REAL | Cost Currency SAR | Landed acquisition cost at time of transaction. |
| `sales_price` | REAL | Retail List SAR | Retail ticket price at time of transaction. |
| *Auxiliary 66 columns*| VARIOUS | System & Audit | Retained in D1 for ERP integrity (`create_uid`, `write_date`, `lot_id`, `package_id`, etc.). Not required for merchandising calculations. |

---

### 2. Physical Store Discovery & New Store Dynamic Onboarding

#### Active Store Identification:
- Inventory is calculated across **Physical Sales Nodes** and **Central Hubs**:
  1. `AND/Stock` -> **Al-Andalus Mall Flagship** (Jeddah, 260 m²)
  2. `YAS/Stock` -> **Al-Yasmeen Mall** (Jeddah, 193 m²)
  3. `JOU/Stock` -> **Jouri Mall** (Taif, 168 m²)
  4. `WH/Stock` -> **Central Warehouse** (Replenishment Reserve)
- **Excluded Locations**:
  - `Shofy/Stock` (Shopify eCommerce — isolated inventory; excluded from physical store density).
  - `WH-D/Stock` (Defects / Quarantine / Write-off depot).
  - `Virtual Locations/*` (Inventory adjustments, scrap, procurement).

#### What Happens When a New Store Appears in Data?
1. **Autonomous Store Discovery**:
   - The query dynamically aggregates by `location_dest_id_name` and `location_id_name`.
   - When a new location matching `%/Stock` appears (e.g. `MOA/Stock` for Mall of Arabia):
     - The engine registers the store code (`MOA`) dynamically.
     - Units in `MOA/Stock` are automatically summed into `totalPhysicalStock`.
2. **Floor Density Physics**:
   - If a new store has no preset floor area in `store_parameters`, the system assigns the network median floor area (**193 m²**) as a fallback default.
   - Operations teams can adjust the exact square meters in the governance UI without requiring code deployments.
3. **Assortment Balancing**:
   - The new store is immediately visible in the store breakdown column: `AND:12 | YAS:8 | JOU:15 | MOA:6`.

---

### 3. New Item & Style Ingestion Contract

#### What Happens When a New Product/Style Appears in Data?
1. **Master Style Extraction**:
   - Incoming SKU format: `55555-01-xs`
   - Master Style Code regex: `^(\d{5})` -> Extracts `55555`.
   - Color code: `-01-`
   - Size code: `-xs`
2. **Autonomous Lifecycle Classification**:
   - If the style has no prior sales history (`total_units_sold == 0` or age $< 14$ days):
     - Tier assigned: `FRESH_WINTER` or `ACTIVE_LAUNCH`.
     - Discount Policy: **0% Markdown / Protected Margin** (Full Price Margin Protection).
     - Rationale: *Freshly received assortment; markdown prohibited during launch window.*
3. **Legal Zero-Loss Floor Enforcement**:
   - $P_{\text{promo\_floor}} = \text{Unit Landed Cost} \times 1.15$
   - Any manual or automated offer proposing a price below this floor is blocked by Cloudflare Worker validation with HTTP 400.
4. **Size Curve Health Calculation**:
   - Unique active sizes in physical stock:
     - $\ge 3$ sizes on hand $\implies$ **Healthy Assortment** (`PASS`).
     - $\le 2$ sizes on hand $\implies$ **Broken Curve / Oddment** (`FLAGGED` for accelerated clearance).

---

### 4. Deterministic D1 SQL Extraction Queries

To ensure the AI engine and background workers never guess column names, all data pipelines execute these exact pre-compiled SQL statements:

#### On-Hand Stock Calculation:
```sql
SELECT 
  SUBSTR(product_sku, 1, 5) AS style_code,
  SUM(CASE WHEN location_dest_id_name LIKE '%AND/Stock%' THEN quantity ELSE 0 END) -
  SUM(CASE WHEN location_id_name LIKE '%AND/Stock%' THEN quantity ELSE 0 END) AS stock_andalus,
  SUM(CASE WHEN location_dest_id_name LIKE '%YAS/Stock%' THEN quantity ELSE 0 END) -
  SUM(CASE WHEN location_id_name LIKE '%YAS/Stock%' THEN quantity ELSE 0 END) AS stock_yasmeen,
  SUM(CASE WHEN location_dest_id_name LIKE '%JOU/Stock%' THEN quantity ELSE 0 END) -
  SUM(CASE WHEN location_id_name LIKE '%JOU/Stock%' THEN quantity ELSE 0 END) AS stock_jouri,
  SUM(CASE WHEN location_dest_id_name LIKE '%WH/Stock%' THEN quantity ELSE 0 END) -
  SUM(CASE WHEN location_id_name LIKE '%WH/Stock%' THEN quantity ELSE 0 END) AS stock_wh
FROM odoo_stock_move_line
WHERE state = 'done'
  AND product_sku GLOB '[0-9][0-9][0-9][0-9][0-9]-*'
GROUP BY SUBSTR(product_sku, 1, 5);
```

#### POS Real-Time Movement Calculation:
```sql
SELECT 
  SUBSTR(product_sku, 1, 5) AS style_code,
  COUNT(DISTINCT SUBSTR(product_sku, INSTR(product_sku, '-', -1) + 1)) AS active_size_count,
  SUM(quantity) AS units_sold,
  SUM(quantity * sales_price) AS gross_sales_sar
FROM odoo_stock_move_line
WHERE state = 'done'
  AND location_dest_id_name LIKE '%Customers%'
  AND date >= DATE('now', '-56 days')
GROUP BY SUBSTR(product_sku, 1, 5);
```
