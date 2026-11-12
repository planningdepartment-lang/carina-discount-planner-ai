import { CARINA_ONTOLOGY } from './compiledOntology';
import { checkAnswerable, retrieveOntologyContext } from './semanticRetriever';
import { extractSqlFromModelOutput, validateReadOnlySql } from './sqlGuard';
import { RetrievedOntologyContext } from './types';

export interface AnalyticalRunnerResult {
  reply: string;
  usedModel?: string;
  executedSql?: string;
  certifiedTerms: string[];
  rowCount: number;
}

function formatCellValue(val: unknown, colName: string): string {
  if (val === null || val === undefined) return '-';
  if (typeof val === 'number') {
    const lowerCol = colName.toLowerCase();
    if (lowerCol.includes('pct') || lowerCol.includes('discount') || lowerCol.includes('str')) {
      return `${val.toFixed(1)}%`;
    }
    if (lowerCol.includes('wos') || lowerCol.includes('ros') || lowerCol.includes('ratio') || lowerCol.includes('u_m2')) {
      return val.toFixed(1);
    }
    if (
      lowerCol.includes('price') ||
      lowerCol.includes('cost') ||
      lowerCol.includes('profit') ||
      lowerCol.includes('capital') ||
      lowerCol.includes('margin') ||
      lowerCol.includes('sar') ||
      lowerCol.includes('vat_floor')
    ) {
      return Number.isInteger(val) ? `${val.toLocaleString()} SAR` : `${val.toFixed(2)} SAR`;
    }
    return Number.isInteger(val) ? val.toLocaleString() : val.toFixed(2);
  }
  return String(val).replace(/\|/g, '/').trim();
}

function formatHeaderLabel(colName: string): string {
  return colName
    .split('_')
    .map(part => {
      const upper = part.toUpperCase();
      if (['WOS', 'ROS', 'STR', 'SAR', 'WH', 'VAT', 'ID', 'PCT'].includes(upper)) return upper;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ');
}

function formatResultsAsMarkdownTable(rows: Record<string, unknown>[], maxDisplayRows: number = 12): string {
  if (rows.length === 0) {
    return 'No matching rows were found in the live D1 snapshot for those exact criteria.';
  }

  const cols = Object.keys(rows[0]);
  const displayRows = rows.slice(0, maxDisplayRows);

  const headerLine = `| ${cols.map(formatHeaderLabel).join(' | ')} |`;
  const sepLine = `| ${cols.map(() => '---').join(' | ')} |`;
  const bodyLines = displayRows.map(
    row => `| ${cols.map(c => formatCellValue(row[c], c)).join(' | ')} |`
  );

  let table = [headerLine, sepLine, ...bodyLines].join('\n');
  if (rows.length > maxDisplayRows) {
    table += `\n\n*Showing top ${maxDisplayRows} of ${rows.length} returned rows.*`;
  }
  return table;
}

/**
 * Deterministic certified SQL fallback for high-value merchandising queries when Workers AI
 * is unavailable, times out, or emits invalid SQL.
 */
export function resolveDeterministicFallbackSql(
  userMessage: string
): { sql: string; title: string; formulaUsed: string } | null {
  const lower = userMessage.toLowerCase();

  // 1. Warehouse-trapped & store-starved
  if (
    (/\b(warehouse|wh|reserve|backstock)\b/i.test(lower) &&
      /\b(zero|low|no stock|empty|starved|missing|yasmeen|andalus|jouri|store)\b/i.test(lower)) ||
    /\bwarehouse_trapped\b/i.test(lower)
  ) {
    const attr = CARINA_ONTOLOGY.sqlAttributes.find(a => a.id === 'warehouse_trapped_store_starved');
    if (attr) {
      return {
        sql: attr.sql,
        title: 'Warehouse Reserve Ready for Store Replenishment',
        formulaUsed: 'stock_wh >= 20 AND (stock_andalus + stock_yasmeen + stock_jouri) <= 5'
      };
    }
  }

  // 2. Accelerating momentum currently discounted
  if (/\b(momentum|accelerat|trending)\b/i.test(lower)) {
    const attr = CARINA_ONTOLOGY.sqlAttributes.find(a => a.id === 'accelerating_momentum_discounted');
    if (attr) {
      return {
        sql: attr.sql,
        title: 'Accelerating 2-Week Momentum Styles Under Discount',
        formulaUsed: 'momentum_ratio >= 1.2 AND discount_pct > 0'
      };
    }
  }

  // 3. Broken curve capital
  if (/\b(broken curve|broken|oddment)\b/i.test(lower) && /\b(capital|cost|total|by category|category|how much)\b/i.test(lower)) {
    const attr = CARINA_ONTOLOGY.sqlAttributes.find(a => a.id === 'broken_curve_capital_summary');
    if (attr) {
      return {
        sql: attr.sql,
        title: 'Capital Tied Up in Broken-Curve Sized Apparel (Excludes Single-Size)',
        formulaUsed: 'SUM(total_physical_stock * unit_cost) WHERE is_single_size = 0 AND broken curve'
      };
    }
  }

  // 4. Store density summary
  if (/\b(density|densities|u\/m2|sqm|footprint|compare stores|store comparison)\b/i.test(lower)) {
    const attr = CARINA_ONTOLOGY.sqlAttributes.find(a => a.id === 'network_store_density_summary');
    if (attr) {
      return {
        sql: attr.sql,
        title: 'KSA Store Network Stock & Floor Density (u/m2)',
        formulaUsed: 'Andalus / 260m2, Yasmeen / 193m2, Jouri / 168m2'
      };
    }
  }

  // 5. Category breakdown
  if (/\b(by category|each category|category breakdown|categories)\b/i.test(lower)) {
    const attr = CARINA_ONTOLOGY.sqlAttributes.find(a => a.id === 'category_capital_and_profit_breakdown');
    if (attr) {
      return {
        sql: attr.sql,
        title: 'Category Inventory Capital, WOS & Forecast Net Profit',
        formulaUsed: 'SUM(total_physical_stock * unit_cost), AVG(store_floor_wos), SUM(forecast_profit)'
      };
    }
  }

  // 6. Active governance rules query
  if (/\b(active|current|all|list|show)\b/i.test(lower) && /\b(rules?|policies)\b/i.test(lower)) {
    return {
      sql: 'SELECT rule_id, rule_name, rule_category, target_scope, condition_operator, rule_value, enforcement_level FROM business_rules WHERE is_active = 1 LIMIT 25',
      title: 'Active Commercial Governance Rules',
      formulaUsed: 'business_rules WHERE is_active = 1'
    };
  }

  // 7. Store-specific top overstock / high WOS query
  if (/\b(jouri|taif|yasmeen|andalus)\b/i.test(lower) && /\b(wos|runway|overstock|stock|top|which|highest)\b/i.test(lower)) {
    const storeCol = /jouri|taif/i.test(lower)
      ? 'stock_jouri'
      : /yasmeen/i.test(lower)
        ? 'stock_yasmeen'
        : 'stock_andalus';
    const storeLabel = /jouri|taif/i.test(lower)
      ? 'Jouri Mall (Taif)'
      : /yasmeen/i.test(lower)
        ? 'Al-Yasmeen Mall (Jeddah)'
        : 'Al-Andalus Mall Flagship (Jeddah)';

    const catFilter = /pyjama|pajama|sleepwear|nightwear/i.test(lower)
      ? ` AND (LOWER(category) IN ('set', 'night gown', 'pyjama', 'pyjamas', 'sleepwear') OR LOWER(product_name) LIKE '%pyjama%' OR LOWER(product_name) LIKE '%pajama%' OR LOWER(product_name) LIKE '%pj%')`
      : /\bbras?\b/i.test(lower)
        ? ` AND LOWER(category) LIKE '%bra%'`
        : /\bsocks?\b/i.test(lower)
          ? ` AND LOWER(category) LIKE '%sock%'`
          : /\b(panties|panty|briefs?)\b/i.test(lower)
            ? ` AND (LOWER(category) LIKE '%panty%' OR LOWER(category) LIKE '%brief%' OR LOWER(category) LIKE '%bikini%')`
            : '';

    return {
      sql: `SELECT style_code, product_name, category, ${storeCol}, store_floor_wos, sar_curve_health, recommended_offer, promotional_price FROM style_plan_snapshots WHERE ${storeCol} > 0${catFilter} ORDER BY store_floor_wos DESC, ${storeCol} DESC LIMIT 10`,
      title: `Top Runway Bottleneck Styles at ${storeLabel}`,
      formulaUsed: `Filtered ${storeCol} > 0 ordered by store_floor_wos DESC`
    };
  }

  return null;
}

/**
 * Runs an Ontology-Grounded Analytical Query:
 * 1. Checks answerability against CARINA's 7 SSOT dimensions.
 * 2. Retrieves only relevant certified terms and SQL attributes.
 * 3. Plans read-only SQLite/D1 SQL via Workers AI (with deterministic fallback).
 * 4. Validates SQL via sqlGuard and executes on D1.
 */
export async function runOntologyAnalyticalQuery(params: {
  env: { AI?: any; DB?: D1Database };
  userMessage: string;
  allowUnguidedMetrics: boolean;
  modelOverride?: string;
}): Promise<AnalyticalRunnerResult | null> {
  const { env, userMessage, allowUnguidedMetrics, modelOverride } = params;

  const answerability = checkAnswerable(userMessage, allowUnguidedMetrics);
  if (!answerability.answerable) {
    return {
      reply:
        `### Metric Governance & Boundary Notice\n\n` +
        `${answerability.reason}\n\n` +
        `• **Authorized Telemetry Allowlist:** Landed Unit Cost (15% VAT Floor), Weekly ROS, Cumulative STR %, Store Floor WOS Runway, Size Availability Ratio (SAR), Seasonality Window, and Physical Store Floor Density (Units/m²).\n` +
        `• **Governance Enforcement:** All analytical queries are validated against CARINA's certified ontology to prevent hallucinated KPIs.\n\n` +
        `*Tip: Enable Exploratory Analysis Mode in the Copilot header if you wish to brainstorm qualitative hypotheses.*`,
      certifiedTerms: answerability.matchedTermIds,
      rowCount: 0
    };
  }

  if (!env?.DB) return null;

  const context: RetrievedOntologyContext = retrieveOntologyContext(userMessage, 6);
  const fallbackPlan = resolveDeterministicFallbackSql(userMessage);

  let plannedSql: string | undefined;
  let summaryTitle = 'CARINA Live Catalog Analytical Query';
  let formulaUsed = context.matchedTerms.map(t => `${t.name}: ${t.sqlExpression}`).slice(0, 2).join('; ');
  let usedModel: string | undefined;

  if (env?.AI) {
    const modelId =
      modelOverride && modelOverride !== 'auto'
        ? modelOverride
        : '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

    const plannerSystemPrompt =
      `You are CARINA's Certified SQL Query Planner for Cloudflare D1 (SQLite).\n` +
      `Translate the user's question into a SINGLE read-only SELECT query using ONLY the authorized tables, columns, and certified formulas below.\n\n` +
      `${context.promptBlock}\n\n` +
      `STRICT RULES:\n` +
      `1. Return ONLY a JSON object: {"sql":"SELECT ...","summaryTitle":"Short Title","formulaUsed":"Key formula or filter used"}.\n` +
      `2. Only query authorized tables (primarily style_plan_snapshots, business_rules, post_promo_monitoring).\n` +
      `3. NEVER query admin_users, admin_sessions, copilot_feedback, or use INSERT/UPDATE/DELETE/PRAGMA.\n` +
      `4. Always include a LIMIT <= 25 for row-level listings.\n` +
      `5. For text filters like category or season, use LOWER(col) LIKE '%term%' for resilient matching.\n` +
      `6. Strictly NO emojis.`;

    try {
      const candidates = Array.from(
        new Set([modelId, '@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.2-3b-instruct'])
      );
      for (const candidate of candidates) {
        try {
          const aiRes = await env.AI.run(candidate, {
            messages: [
              { role: 'system', content: plannerSystemPrompt },
              { role: 'user', content: userMessage }
            ],
            temperature: 0.05,
            top_p: 0.9,
            max_tokens: candidate.includes('deepseek-r1') ? 1000 : 350
          });
          const rawContent =
            aiRes?.response || aiRes?.choices?.[0]?.message?.content || (typeof aiRes === 'string' ? aiRes : '');
          const rawText = String(rawContent || '')
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .replace(/<think>[\s\S]*$/gi, '')
            .trim();
          const extracted = extractSqlFromModelOutput(rawText);
          if (extracted.sql) {
            const check = validateReadOnlySql(extracted.sql);
            if (check.valid && check.sanitizedSql) {
              plannedSql = check.sanitizedSql;
              if (extracted.title) summaryTitle = extracted.title;
              if (extracted.formulaUsed) formulaUsed = extracted.formulaUsed;
              usedModel = candidate;
              break;
            }
          }
        } catch (err: any) {
          console.warn(`Ontology SQL planner warning on ${candidate}:`, err?.message || err);
        }
      }
    } catch (outerErr: any) {
      console.warn('Ontology SQL planner outer warning:', outerErr?.message || outerErr);
    }
  }

  // Fallback to deterministic certified SQL template if LLM unavailable or failed guard
  if (!plannedSql && fallbackPlan) {
    const check = validateReadOnlySql(fallbackPlan.sql);
    if (check.valid && check.sanitizedSql) {
      plannedSql = check.sanitizedSql;
      summaryTitle = fallbackPlan.title;
      formulaUsed = fallbackPlan.formulaUsed;
    }
  }

  if (!plannedSql) return null;

  let rows: Record<string, unknown>[] = [];
  let executedSql = plannedSql;

  try {
    const res = await env.DB.prepare(plannedSql).all<Record<string, unknown>>();
    rows = res?.results || [];
  } catch (dbErr: any) {
    console.warn('Planned SQL D1 execution failed, attempting deterministic fallback:', dbErr?.message || dbErr);
    if (fallbackPlan && fallbackPlan.sql !== plannedSql) {
      const check = validateReadOnlySql(fallbackPlan.sql);
      if (check.valid && check.sanitizedSql) {
        try {
          const fallbackRes = await env.DB.prepare(check.sanitizedSql).all<Record<string, unknown>>();
          rows = fallbackRes?.results || [];
          executedSql = check.sanitizedSql;
          summaryTitle = fallbackPlan.title;
          formulaUsed = fallbackPlan.formulaUsed;
        } catch {
          return null;
        }
      } else {
        return null;
      }
    } else {
      return null;
    }
  }

  const tableMd = formatResultsAsMarkdownTable(rows);
  const termNames = context.matchedTerms.map(t => t.name).join(', ') || 'Catalog Telemetry';

  const reply =
    `### ${summaryTitle}\n\n` +
    `${tableMd}\n\n` +
    `• **Certified Ontology Terms:** ${termNames}\n` +
    `• **Applied Formula / Logic:** \`${formulaUsed || 'Certified D1 Snapshot Query'}\`\n` +
    `• **Governance Verified:** Read-only D1 execution; \`Shofy/Stock\` excluded; Saudi 15% VAT floor enforced.\n` +
    `• **Executed Query:** \`${executedSql}\``;

  return {
    reply,
    usedModel,
    executedSql,
    certifiedTerms: context.matchedTerms.map(t => t.id),
    rowCount: rows.length
  };
}
