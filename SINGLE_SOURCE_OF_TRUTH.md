# CARINA Discount Planner AI: Single Source of Truth (SSOT) & Agent Anchor

> [!IMPORTANT]
> **ATTENTION AGENT / DEVELOPER:**  
> If you ever lose context, receive ambiguous instructions, or need to validate project state, **STOP and read this file first**. This is the definitive, immutable Single Source of Truth (SSOT) for the entire project.

---

## 1. What This System Is (and Is NOT)

* **WHAT IT IS:**
  * An autonomous, real-time **Style Lifecycle Monitor & Strategic Discount Planner** built on Cloudflare Workers (TypeScript), Cloudflare D1 (SQLite), Cloudflare Workers AI (Llama 3.3 70B), and Cloudflare Pages.
  * Dedicated exclusively to **CARINA's Physical Retail Store Network in Saudi Arabia**.
  * Built to automate markdown planning, space decongestion, and What-If inventory simulations anytime without manual Excel spreadsheets.
* **WHAT IT IS NOT:**
  * It is **NOT** an e-commerce optimizer (Shopify `Shofy/Stock` is completely excluded).
  * It is **NOT** a 100% full liquidation tool (it guarantees preserving evergreen winter continuity stock).
  * It is **NOT** an unconstrained AI generator (all prices and offers are strictly governed by deterministic TypeScript mathematical guardrails).

---

## 2. The 5 Invariant Laws (Never Violate)

1. **The Saudi 15% VAT Zero-Loss Floor:**
   $$\text{Promotional Price (VAT-inclusive)} \ge \text{Landed Unit Cost} \times 1.15$$
   * No product may ever be sold at a loss or below landed cost + 15% VAT.
   * Enforced in `src/engine/zeroLossGuard.ts`.
2. **Physical Store Network Only:**
   * Active store locations:
     * `AND/Stock`: Al-Andalus Mall (**Jeddah**, 260 m²) — High-velocity volume hub.
     * `YAS/Stock`: Al-Yasmeen Mall (**Jeddah**, 193 m²) — Choked floor ($62.5\text{ u/m}^2$).
     * `Jouri/Stock`: Jouri Mall (**Taif**, 168 m²) — Critically overcrowded floor ($66.3\text{ u/m}^2$).
     * `WH/Stock`: Central Distribution Center (DC buffer).
   * **`Shofy/Stock` (Shopify) and `WH-D/Stock` (Defects) are permanently excluded from inventory calculations.**
3. **Assortment Preservation Mandate:**
   * Never liquidate 100% of inventory.
   * Target campaign clearance: $\approx 42.8\%$ of stock.
   * Guaranteed retained stock for December–January peak winter trading: $\ge 57.2\%$.
4. **Decoupled Architecture (Zero Hallucination of Numbers):**
   * **Worker A (`src/engine/`):** Pure deterministic TypeScript. Handles all math (STR%, ROS, WOS, SAR, zero-loss, simulations) in $<10\text{ ms}$ with zero AI tokens.
   * **Worker B (`src/ai/`):** Workers AI (`@cf/meta/llama-3.3-70b-instruct`). Handles qualitative merchandising rationale, KSA market context, and natural language rule compilation.
5. **Data Resilience & Hygiene:**
   * Product names in Odoo have leading/trailing whitespace (e.g. `" Round Neck SS"`). Always use `TRIM(product_id_name)`.
   * SKU structure is `[5-digit style]-[size]-[color code]` (e.g. `55915-XS-88` where `55915` is model, `XS` is size, `88` is color code). Extract style using `SUBSTR(product_sku, 1, 5)` and size from the middle segment between dashes.

---

## 3. Production Infrastructure & Credentials Anchor

| Resource | Value | Notes |
| :--- | :--- | :--- |
| **Cloudflare Account** | `planning.department@carinawear.com` | Account ID: `ee26206b4f1fe6fc3e77201500fdc25f` |
| **D1 Database Name** | `odoo-report-db-ksa` | UUID: `7cf6d49e-e9cc-421b-8a80-b63af95bb063` |
| **Live Database Size** | `2.61 GB` | Contains 381k moves and 13k products |
| **Primary Raw Tables** | `odoo_raw_products`, `odoo_stock_move_line` | Read-only raw transaction tables |
| **System Tables** | `business_rules`, `style_plan_snapshots` | Managed auxiliary governance tables |
| **Workers AI Model** | `@cf/meta/llama-3.3-70b-instruct` | Primary LLM for Copilot |
| **Local Project Path** | `c:\Users\14045\Desktop\CARINA\Analysis\Styles\Discount planner AI` | Git repository root |

---

## 4. The 7 Style Judgement Dimensions & Offer Criteria

1. **Regulatory Zero-Loss Margin Floor:**
   $$\text{Promotional Price (VAT-inclusive)} \ge \text{Landed Unit Cost} \times 1.15$$
   *Strict hard barrier against selling below cost + 15% Saudi VAT.*
2. **Velocity (ROS - Rate of Sale):**
   $$\text{Weekly ROS} = \frac{\text{Units Sold to Partners/Customers over past 56 days}}{8.0\text{ weeks}}$$
   *Filters single-day flash distortions across an active 8-week baseline.*
3. **Lifecycle Maturity (Cumulative STR % - NRF Standards):**
   $$\text{Cumulative STR \%} = \frac{\text{Lifetime Units Sold}}{\text{Starting Inventory Received (Physical Stock + Lifetime Sold)}} \times 100$$
   *$\text{STR} \ge 70\%$ (Hero Core / 0% Off), $40\%–70\%$ (Steady Continuity / Spend & Save), $10\%–40\%$ (Slow / 40% Off), $< 10\%$ (Clearance Rail).*
4. **Runway (Weeks of Supply - WOS):**
   $$\text{Store Floor WOS} = \frac{\text{Stock}_{\text{Andalus}} + \text{Stock}_{\text{Yasmeen}} + \text{Stock}_{\text{Jouri}}}{\text{Weekly ROS}}$$
   *Measures physical sales floor rack congestion; $\text{WOS} > 40\text{ wks}$ triggers liquidation intervention.*
5. **Size Availability Ratio (SAR) & Single-Size Distinction:**
   *Apparel: Healthy ($\ge 3$ active sizes with stock $\ge 2$ units) vs. Broken ($\le 2$ sizes, clearance rail).*
   *Single-Size / Volumetric (Cosmetics, Towels, One-Size): Immune to broken curve penalties; deployed as basket builders.*
6. **Seasonality Window & Assortment Mandate:**
   *Fresh Winter (`AW26`): 100% full ticket price protected (0% Off).*
   *Past Summer (`SS26`): Category markdown (35%–40% Off) before cold weather.*
   *Continuity NOOS basics (85% of catalog): Preserve $\ge 57.2\%$ of stock for peak winter trading.*
7. **Physical Store Floor Space Decongestion:**
   *Jouri ($66.2\text{ u/m}^2$) & Yasmeen ($62.4\text{ u/m}^2$) congestion relief vs. Al-Andalus ($46.1\text{ u/m}^2$) volume hub.*


---

## 5. Master File & Documentation Directory

If you need deeper details on any specific area, refer to these canonical documents:

```
Discount planner AI/
├── SINGLE_SOURCE_OF_TRUTH.md        <-- (YOU ARE HERE) The Anchor File
├── CODING_AND_LOGIC_SSOT.md         <-- Algorithms, Math Formulas & TS Signatures
├── SYSTEM_MAP.md                    <-- Complete architecture & data flow diagrams
├── INSTRUCTIONS.md                  <-- Operational & Developer manual (SOPs)
├── .cursorrules                     <-- Hard coding rules for AI assistants
├── .github/copilot-instructions.md  <-- Repository context for Copilot
└── docs/
    ├── CLOUDFLARE_EDGE_GUIDE.md     <-- D1 query batching & Workers AI controllers
    ├── DOMAIN_SKILLS_SPECIFICATION.md <-- ksaMarketSkill, competitorPlaybook, retailMath
    ├── DATA_DICTIONARY_AND_CONTRACT.md <-- DB schemas & 18-column POS export contract
    └── AGENT_MODES_SPECIFICATION.md  <-- DISCOUNT_STRATEGIST, STORE_AUDITOR, RULE_COMPILER
```

---

## 6. Agent Self-Validation & Recovery Protocol

If you ever suspect your state or calculations are out of sync, execute these 3 steps:

1. **Step 1: Check Live D1 Connection:**
   ```bash
   npx wrangler d1 execute odoo-report-db-ksa --remote --command "SELECT count(*) FROM odoo_stock_move_line;"
   ```
   *Expected output: $\approx 381,529$ rows.*

2. **Step 2: Run Unit Test Suite:**
   ```bash
   npm test
   ```
   *Verifies 0% zero-loss violations and tests metrics math.*

3. **Step 3: Review Git Status:**
   ```bash
   git status
   ```
   *Ensure you are on the `dev` branch for active work, not `main`.*
