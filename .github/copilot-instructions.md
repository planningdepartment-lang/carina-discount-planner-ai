# GitHub Copilot & Coding Assistant Guidelines: CARINA Discount Planner AI

> **SINGLE SOURCE OF TRUTH (SSOT):**  
> If you ever lose context or need to validate project invariants, read: [`SINGLE_SOURCE_OF_TRUTH.md`](file:///c:/Users/14045/Desktop/CARINA/Analysis/Styles/Discount%20planner%20AI/SINGLE_SOURCE_OF_TRUTH.md).

This repository contains the production code for CARINA's autonomous Style Lifecycle Monitor & Strategic Discount Planner built on Cloudflare Workers, D1, Workers AI, and Pages.

## Essential Context
* **Company**: CARINA (Physical Fashion & Intimate Apparel Retail Network in Saudi Arabia).
* **Database**: Cloudflare D1 (`odoo-report-db-ksa`) with tables `odoo_raw_products` and `odoo_stock_move_line`.
* **Stores**:
  * Al-Andalus Mall (`AND/Stock` - Jeddah, 260 m²)
  * Al-Yasmeen Mall (`YAS/Stock` - Jeddah, 193 m²)
  * Jouri Mall (`Jouri/Stock` - Taif, 168 m²)
  * Central Distribution Center (`WH/Stock`)
  * Shopify (`Shofy/Stock`) is non-operational and ignored.
* **Legal Tax Floor**: Saudi 15% VAT. Zero-loss formula: `P_promo >= Unit_Cost * 1.15`.
* **Saudi Payday**: 27th of every month (peak liquidity window).
* **Retail Formulas**:
  * `Rate of Sale (ROS)` = units sold to `Partners/Customers` over past 8 weeks / 8.0.
  * `Sell-Through (STR %)` = (Units Sold / (Units Sold + Current Physical Stock)) * 100.
  * `Size Availability Ratio (SAR)` = Active sizes / Total sizes. Healthy >= 3, Broken <= 2.
  * `Weeks of Supply (WOS)` = Physical Store Floor Stock / ROS.

## Code Structure
* `src/engine/`: Pure deterministic TypeScript calculation engine. Keep it free of AI calls.
* `src/ai/`: Cloudflare Workers AI integration and prompt skills.
* `src/db/`: Cloudflare D1 query and migration layer.
* `public/`: Cloudflare Pages executive dashboard.
