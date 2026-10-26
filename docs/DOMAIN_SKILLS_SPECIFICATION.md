# Domain Skills Specification: CARINA Merchandising Intelligence

This document details the three native domain skills embedded into Worker B (AI Copilot) to provide grounded, highly accurate merchandising recommendations.

---

## Skill 1: `ksaMarketSkill` (Saudi Retail Realities)

### Purpose
Grounds every pricing decision, campaign date, and bundle recommendation in authentic Saudi market economics.

### Key Knowledge Constants
1. **The 27th Payday Wave:**
   * Public and private sector payroll occurs on the **27th of each Gregorian month**.
   * Liquidity surge window: **25th through the 2nd of the following month**.
   * Promotional activation recommendation: Always start 2-3 days before the 27th to capture pre-payday wishlist browsing.
2. **Saudi 15% Standard VAT:**
   * All POS shelf tags and consumer-facing promotional prices in KSA must legally be **inclusive of 15% VAT**.
   * Realized revenue formula: $\text{Net Realized} = \frac{\text{Promo Price}}{1.15}$.
   * Zero-loss constraint: $\text{Promo Price} \ge \text{Landed Cost} \times 1.15$.
3. **Regional Climate & Space Differences:**
   * **Jeddah (Andalus & Yasmeen):** Coastal Red Sea climate, warm year-round. Light cottons, active shorts, and seamless bras turn year-round.
   * **Taif (Jouri Mall):** Mountainous elevation, significantly colder winter (Nov–Feb). Heavy sleepwear, fleece sets, and long robes see peak winter demand.
4. **Payment Preferences:**
   * High adoption of BNPL (Tabby / Tamara).
   * Minimum transaction size for BNPL is typically 100 SAR, making multi-buy pack offers (e.g. "Buy 2 Packs Save 20%") natural basket builders.

---

## Skill 2: `competitorPlaybookSkill` (Promotional Counter-Tactics)

### Purpose
Provides tactical guidance on countering aggressive 365-day discounters in Saudi malls without destroying CARINA's brand equity.

### Competitor Benchmarks & Counter-Strategies
1. **Centrepoint & Max Fashion (Landmark Group):**
   * *Their Tactic:* Constant red-tag sales, flat 50%-70% off racks, low initial ticket prices.
   * *CARINA Counter-Strategy:* Protect full price on core basics. Avoid flat single-item price matching. Use **volume bundle rails** ("Take 3 for 99 SAR") exclusively for broken-size orphans to compete on value without devaluing full-curve inventory.
2. **H&M (Alshaya Group):**
   * *Their Tactic:* Rapid seasonal markdowns on summer fashion to make space for autumn/winter drops.
   * *CARINA Counter-Strategy:* Execute **Category Markdowns (35%–40% Off)** on Past Summer (`SS26`) styles to exit ahead of winter cold in Taif, while preserving fresh winter (`AW26`) arrivals at 100% full ticket price.
3. **Nayomi (Kamal Osman Jamjoom):**
   * *Their Tactic:* "Buy 2 Get 1 Free" on bra packs and checkout fragrance splash add-ons.
   * *CARINA Counter-Strategy:* Cross-merchandise high-margin impulse items at the cash register (e.g., Body Splash for 19 SAR with 250 SAR spend) to lift Average Order Value (AOV).

---

## Skill 3: `retailMathSkill` (Merchandising Mathematics)

### Mathematical Formulations

1. **Velocity / Rate of Sale (ROS):**
   $$\text{Weekly ROS} = \frac{\text{Total Units Sold over past 8 Weeks}}{8.0}$$

2. **Cumulative Sell-Through Rate (STR %):**
   $$\text{Cumulative STR \%} = \frac{\text{Lifetime Units Sold}}{\text{Starting Inventory Received (Physical Stock + Lifetime Sold)}} \times 100$$

3. **Weeks of Supply (WOS):**
   $$\text{Store Floor WOS} = \frac{\text{Stock}_{\text{Andalus}} + \text{Stock}_{\text{Yasmeen}} + \text{Stock}_{\text{Jouri}}}{\text{Weekly ROS}}$$

4. **Size Availability Ratio (SAR - Curve Health):**
   $$\text{SAR} = \frac{\text{Number of Active Sizes with Stock } \ge 2 \text{ units}}{\text{Total Historical Sizes for Style}}$$
   * Healthy Curve: $\ge 3$ active sizes (e.g., S, M, L available).
   * Broken Curve: $\le 2$ sizes remaining (e.g., only XS or 3XL left).

5. **Initial Markup % (IMU):**
   $$\text{IMU \%} = \frac{\text{Ticket Price} - \text{Landed Cost}}{\text{Ticket Price}} \times 100$$
