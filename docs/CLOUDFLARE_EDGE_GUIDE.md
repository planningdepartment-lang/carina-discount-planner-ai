# Cloudflare Edge Development & Optimization Guide

This guide establishes runtime best practices for developing and deploying the CARINA Discount Planner on Cloudflare Workers, D1, Workers AI, and Pages.

---

## 1. Cloudflare D1 Best Practices

### A. Query Optimization on 380k+ Rows
1. **Never perform unindexed `SELECT *` scans:**
   Always filter by `location_dest_id_name` and `location_id_name` when aggregating physical stock.
2. **Batch Multiple Statements:**
   D1 supports batching multiple SQL statements in a single roundtrip using `env.DB.batch([stmt1, stmt2])`. This reduces edge-to-database latency by up to 60%.
3. **Use SQLite Functions Wisely:**
   * Use `TRIM()` on product names to avoid whitespace mismatches.
   * Use `ROUND(val, 2)` inside SQL for fast initial aggregations.
   * Extract style codes using `SUBSTR(product_sku, 1, 5)`.

### B. Pre-Aggregation & Caching (`style_plan_snapshots`)
* Running full aggregations across 381,529 stock move lines takes ~200-500ms on first run.
* Worker A caches the aggregated results into the auxiliary table `style_plan_snapshots` after every scheduled sync.
* Dashboard requests read from the snapshot table in **< 10ms**.

---

## 2. Cloudflare Workers AI Controller & Parameter Settings

### A. Recommended Model Configuration
* **Primary Model:** `@cf/meta/llama-3.3-70b-instruct`
  * Strongest reasoning, zero-shot instruction following, and accurate JSON rule generation.
* **Secondary / Fast Model (Optional):** `@cf/meta/llama-3.1-8b-instruct`
  * High-speed, lower resource utilization for quick style summaries.

### B. Inference Parameter Tuning
```typescript
const response = await env.AI.run('@cf/meta/llama-3.3-70b-instruct', {
  messages: promptMessages,
  temperature: 0.2,       // Low temperature prevents hallucination of numbers
  max_tokens: 1024,       // Adequate for concise merchandising rationale
  top_p: 0.9,
});
```

---

## 3. Worker Limits & Resource Boundaries (Tier 3 Account)

| Metric | Cloudflare Worker Limit | CARINA Optimization Strategy |
| :--- | :---: | :--- |
| **CPU Time per Request** | 50ms (Free) / 30,000ms (Paid) | All calculations run in < 15ms CPU time. |
| **Worker Bundle Size** | 10 MB (Compressed) | Pure TypeScript without heavy node polyfills (bundle is < 300 KB). |
| **D1 Query Rows per Call** | 100,000 rows | Sub-queries group by style code, reducing returned rows to ~1,470. |
| **Subrequest Limit** | 50 subrequests | Batching D1 statements ensures < 3 subrequests per dashboard load. |
| **Static Assets** | 25 MB per file | Pages assets (HTML, CSS, JS) total < 100 KB. |

---

## 4. Local Development vs Remote Production

```bash
# Run local worker connected to the remote D1 production database:
npx wrangler dev --remote

# Execute a query directly against remote D1:
npx wrangler d1 execute odoo-report-db-ksa --remote --command "SELECT count(*) FROM odoo_stock_move_line;"

# Deploy worker to Cloudflare edge:
npx wrangler deploy
```
