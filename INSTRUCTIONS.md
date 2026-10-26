# CARINA Style Lifecycle Monitor & Strategic Discount Planner: Operational Manual & Instructions

This document provides clear, actionable instructions for **Developers**, **Merchandising Planners**, and **System Administrators** operating the platform.

---

## 1. Quick Start Guide for Developers

### Prerequisites
* **Node.js**: `v20.x` or `v24.x` (Currently installed: `v24.18.0`)
* **Cloudflare Wrangler CLI**: `v4.x` (Currently installed: `v4.153.0`)
* **Authenticated Cloudflare Account**: `planning.department@carinawear.com`

### Step 1: Install Dependencies
```bash
cd "c:\Users\14045\Desktop\CARINA\Analysis\Styles\Discount planner AI"
npm install
```

### Step 2: Initialize Auxiliary D1 Tables
Run the initial SQL migration against the remote database to create governance tables:
```bash
npx wrangler d1 execute odoo-report-db-ksa --remote --file=./src/db/schema.sql
```

### Step 3: Start the Local Development Server
Launch Wrangler's edge dev server with live remote D1 bindings:
```bash
npm run dev
# Or directly:
npx wrangler dev --remote
```
Open `http://localhost:8787` in your browser to access the live dashboard.

### Step 4: Run Automated Tests
```bash
npm test
```
This runs the verification suite ensuring:
* 100% zero-loss compliance across all 1,470 active styles.
* Proper whitespace trimming on product names (e.g. `" Round Neck SS"`).
* Accurate floor space density calculations for Jeddah and Taif stores.

---

## 2. GitHub & Deployment Workflow

### Git Branching Model
* **`dev` branch**: Use this branch for daily development, experimenting with new rules, and testing UI components locally.
* **`main` branch**: Production branch. Connected to Cloudflare Workers & Pages CI/CD.

### Pushing to GitHub
```bash
# 1. Switch to dev branch for active work
git checkout -b dev

# 2. Stage and commit changes
git add .
git commit -m "feat: complete initial worker and dashboard setup"

# 3. Add remote (if not already set)
git remote add origin https://github.com/<YOUR-ORG-OR-USERNAME>/carina-discount-planner-ai.git

# 4. Push dev branch
git push -u origin dev

# 5. When verified, merge to main for production deployment
git checkout main
git merge dev
git push origin main
```

---

## 3. Merchandiser & Commercial Operator Guide

### 1. Reading the Executive Dashboard
* **Store Density Status:**
  * **Al-Andalus (Jeddah - 260 m²):** Target: $\le 45\text{ u/m}^2$. High commercial capacity.
  * **Al-Yasmeen (Jeddah - 193 m²):** If flagged RED ($> 55\text{ u/m}^2$), prioritize liquidation in this store.
  * **Jouri Mall (Taif - 168 m²):** If flagged RED ($> 60\text{ u/m}^2$), initiate clearance rails immediately.
* **What-If Simulation Slider:**
  * Adjust the **"Target Liquidation Units"** slider (e.g. 15,000 to 22,000 units).
  * Adjust the **"Minimum Net Margin Floor"** slider (e.g. 45% to 55%).
  * The dashboard instantly re-computes projected gross revenue, realized cash profit, and post-event rack density without re-querying the database.

### 2. Exporting the Odoo POS Promotional Pricelist
1. Review the proposed style offers in the interactive table.
2. Click the **"Export Odoo POS Pricelist CSV"** button at the top right.
3. The browser will download `Odoo_POS_Promotional_Pricelist.csv` pre-formatted with:
   * Barcode / SKU mapping
   * Promotional Price (inclusive of 15% Saudi VAT)
   * Odoo POS Rule Tags (`RULE_SPEND_SAVE_20`, `RULE_CLEAR_3_FOR_99`, `RULE_CLEAR_50_PCT`, etc.)
   * Activation and Expiration dates (capturing the 27th KSA payday).

---

## 4. How to Add New Business Requirements in the Future

### Method A: Via the Web Dashboard (No Code)
1. Click **"Governance Rules"** in the top navigation bar.
2. To modify an existing rule (e.g. raise margin floor from 45% to 50%), edit the field and click **Save**.
3. To add a new requirement:
   * Select Rule Type (e.g., `DISCOUNT_CAP`, `EXCLUSION`, `MARGIN_FLOOR`).
   * Select Scope (e.g., `CATEGORY:Bra` or `SEASON:AW26`).
   * Set Condition and Value.
   * Click **Activate Rule**. The engine immediately enforces it.

### Method B: Via the AI Copilot Chat Drawer (Natural Language)
1. Open the **"Ask Merchandising Copilot"** drawer.
2. Type your requirement in plain English or Arabic:
   * *"Do not discount any style in Pyjama category if unit cost is above 35 SAR."*
   * *"Make sure all clearance items in Taif store end in .95 SAR."*
3. The AI Copilot parses the sentence, generates a formal JSON-Logic rule, shows you a preview of how many styles are affected, and asks for confirmation.
4. Reply **"Yes"** to activate it directly into Cloudflare D1.

### Method C: Via Developer Plugin (`src/engine/rulePipeline.ts`)
For complex multi-stage business logic (e.g. supplier buy-back agreements):
1. Create a new file in `src/engine/rules/yourRuleName.ts` implementing `BusinessRulePlugin`.
2. Add your rule to `rulePipeline.ts`.
3. Run `npm test` to verify zero-loss compliance before merging to `main`.

---

## 5. Security & Compliance Checklist

* [x] **Zero-Loss Guarantee:** Mathematical constraint $P_{\text{promo}} \ge \text{Unit Cost} \times 1.15$ runs deterministically in TypeScript; never relies on AI discretion.
* [x] **Zero Phantom Inventory:** E-Commerce (`Shofy/Stock`) and Damaged (`WH-D/Stock`) are hard-excluded from inventory sums.
* [x] **D1 Scoping:** Database credentials use Cloudflare native bindings (`env.DB`), eliminating exposed database passwords.
* [x] **Token & Secret Safety:** No credentials or API tokens exist in source code. `.gitignore` permanently excludes `.dev.vars` and `.wrangler`.
