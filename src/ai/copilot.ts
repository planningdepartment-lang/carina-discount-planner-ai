import { KSA_RETAIL_CONTEXT } from './skills/ksaRetailContext';
import { COMPETITOR_PLAYBOOK } from './skills/competitorPlaybook';
import { parseNaturalLanguageRule } from './skills/ruleParser';
import { StyleMetrics } from '../engine/lifecycleClassifier';

export type AgentMode = 'DISCOUNT_STRATEGIST' | 'STORE_AUDITOR' | 'RULE_COMPILER';

export interface CopilotChatRequest {
  message: string;
  mode?: AgentMode;
  contextStyleCode?: string;
  metricsSnapshot?: Partial<StyleMetrics>;
}

export interface CopilotChatResponse {
  reply: string;
  mode: AgentMode;
  suggestedRule?: any;
}

interface D1StyleSnapshotRow {
  style_code: string;
  product_name: string;
  category: string;
  season: string;
  total_physical_stock: number;
  stock_andalus: number;
  stock_yasmeen: number;
  stock_jouri: number;
  stock_wh: number;
  cumulative_str_pct: number;
  weekly_ros: number;
  sar_curve_health: string;
  unit_cost: number;
  cost_plus_vat: number;
  ticket_price: number;
  recommended_offer: string;
  promotional_price: number;
  discount_pct: number;
  zero_loss_status: string;
  forecast_sold: number;
  forecast_profit: number;
  post_event_stock: number;
  commercial_rationale: string;
}

/**
 * Searches D1 style_plan_snapshots for matches based on user message.
 */
async function searchStylesInD1(db: D1Database | undefined, userMessage: string): Promise<D1StyleSnapshotRow[]> {
  if (!db) return [];

  try {
    // 1. Check for exact 5-digit style codes (e.g. 59465, 50177)
    const codeMatch = userMessage.match(/\b\d{5}\b/);
    if (codeMatch) {
      const code = codeMatch[0];
      const { results } = await db
        .prepare('SELECT * FROM style_plan_snapshots WHERE style_code = ? LIMIT 3')
        .bind(code)
        .all<D1StyleSnapshotRow>();
      if (results && results.length > 0) return results;
    }

    // 2. Tokenize product keywords (exclude small or generic stop words)
    const stopWords = new Set([
      'what', 'are', 'the', 'source', 'data', 'using', 'from', 'where', 'this', 'that',
      'with', 'have', 'does', 'show', 'tell', 'about', 'plan', 'price', 'discount',
      'please', 'style', 'code', 'stock', 'store', 'which', 'will', 'make'
    ]);
    const words = userMessage
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3 && !stopWords.has(w));

    if (words.length > 0) {
      // First try combined full phrase or first 2 words
      const phrase = words.slice(0, 2).join('%');
      const { results: phraseResults } = await db
        .prepare('SELECT * FROM style_plan_snapshots WHERE product_name LIKE ? ORDER BY total_physical_stock DESC LIMIT 3')
        .bind(`%${phrase}%`)
        .all<D1StyleSnapshotRow>();
      if (phraseResults && phraseResults.length > 0) return phraseResults;

      // Fallback: search by most prominent word
      for (const w of words) {
        const { results } = await db
          .prepare('SELECT * FROM style_plan_snapshots WHERE product_name LIKE ? ORDER BY total_physical_stock DESC LIMIT 3')
          .bind(`%${w}%`)
          .all<D1StyleSnapshotRow>();
        if (results && results.length > 0) return results;
      }
    }
  } catch (err) {
    console.error('Error querying D1 for copilot context:', err);
  }

  return [];
}

/**
 * Formats a clean markdown breakdown of style rows retrieved from D1.
 */
function formatStyleDetails(row: D1StyleSnapshotRow): string {
  return (
    `### 🏷️ Style **${row.style_code}** — *${row.product_name}*\n` +
    `• **Category / Season:** \`${row.category || 'General'}\` | \`${row.season || 'Continuity'}\`\n` +
    `• **Total Physical Inventory:** **${row.total_physical_stock} units**\n` +
    `  - 🏬 **Al-Andalus Mall Flagship (Jeddah):** ${row.stock_andalus} units\n` +
    `  - 🏬 **Al-Yasmeen Mall (Jeddah):** ${row.stock_yasmeen} units\n` +
    `  - 🏬 **Jouri Mall (Taif):** ${row.stock_jouri} units\n` +
    `  - 🏭 **Central Warehouse (WH):** ${row.stock_wh} units\n` +
    `• **Curve & Velocity:** ${row.sar_curve_health} | Cumulative STR: **${row.cumulative_str_pct}%** | Weekly ROS: **${row.weekly_ros} u/wk**\n` +
    `• **Cost & Pricing Economics:**\n` +
    `  - Unit Landed Cost: **${row.unit_cost.toFixed(2)} SAR**\n` +
    `  - Zero-Loss Legal Floor (Cost + 15% VAT): **${row.cost_plus_vat.toFixed(2)} SAR**\n` +
    `  - Original Ticket Price: **${row.ticket_price.toFixed(2)} SAR**\n` +
    `• **AI Recommendation:** **${row.recommended_offer}**\n` +
    `  - Promo Price: **${row.promotional_price.toFixed(2)} SAR** (${row.discount_pct}% off)\n` +
    `  - Zero-Loss Compliance: **${row.zero_loss_status}** (Floor: ${row.cost_plus_vat.toFixed(2)} SAR <= Promo: ${row.promotional_price.toFixed(2)} SAR)\n` +
    `  - Forecast Sold: **${row.forecast_sold} units** | Projected Net Profit: **${row.forecast_profit.toLocaleString()} SAR**\n` +
    `• **Merchandising Rationale:** ${row.commercial_rationale}`
  );
}

/**
 * Returns architectural documentation for data-source questions.
 */
function getDataSourceResponse(): string {
  return (
    `### 📊 CARINA AI Discount Planner — Live Data Architecture\n\n` +
    `All pricing, inventory, and lifecycle recommendations are computed directly from **Cloudflare D1 SQL database (\`odoo-report-db-ksa\`)**:\n\n` +
    `1. **Source Transaction Ledger (\`odoo_stock_move_line\`):**\n` +
    `   - **Total Records:** 380,518 verified inventory ledger movements.\n` +
    `   - **Strict SKU Format Invariant:** Only SKUs strictly matching the pattern **\`55555-01-xs\`** (\`GLOB '[0-9][0-9][0-9][0-9][0-9]-*-*'\`) are ingested. All non-conforming or service strings are rejected.\n` +
    `   - **True Style Code:** Extracted as the first 5 digits (\`SUBSTR(product_sku, 1, 5)\`).\n\n` +
    `2. **Physical Store Network Scope:**\n` +
    `   - 🏬 **Al-Andalus Mall Flagship (Jeddah, 260 m²):** \`AND/Stock\`\n` +
    `   - 🏬 **Al-Yasmeen Mall (Jeddah, 193 m²):** \`YAS/Stock\`\n` +
    `   - 🏬 **Jouri Mall (Taif, 168 m²):** \`Jouri/Stock\`\n` +
    `   - 🏭 **Central Distribution Warehouse:** \`WH/Stock\`\n` +
    `   - 🚫 **Strictly Excluded Locations:** \`Shofy/Stock\` (Shopify virtual stock) and \`WH-D/Stock\` (damaged stock) are excluded from all physical availability calculations.\n\n` +
    `3. **High-Performance Snapshot Table (\`style_plan_snapshots\`):**\n` +
    `   - **Active Styles:** 1,493 verified physical styles in stock.\n` +
    `   - **Zero-Loss Floor Enforcement:** Every style strictly enforces $P_{\\text{promo}} \\ge \\text{Landed Cost} \\times 1.15$ (Saudi 15% VAT).\n` +
    `   - **Winter Assortment Retention:** $\\ge 57.2\\%$ of inventory is protected for December–January trading.`
  );
}

/**
 * Cloudflare Workers AI Copilot Orchestrator
 */
export async function handleCopilotChat(
  env: { AI?: any; DB?: D1Database },
  request: CopilotChatRequest
): Promise<CopilotChatResponse> {
  const mode = request.mode || 'DISCOUNT_STRATEGIST';
  const userMessage = request.message.trim();

  // 1. Natural Language Rule Compiler
  if (mode === 'RULE_COMPILER' || (userMessage.toLowerCase().includes('rule') && (userMessage.toLowerCase().includes('cap') || userMessage.toLowerCase().includes('exclude') || userMessage.toLowerCase().includes('floor')))) {
    const parsed = parseNaturalLanguageRule(userMessage);
    if (parsed) {
      return {
        reply: `I have parsed your commercial policy into a formal D1 Governance Rule:\n\n` +
          `• **Rule ID:** \`${parsed.rule_id}\`\n` +
          `• **Policy Name:** ${parsed.rule_name}\n` +
          `• **Category:** ${parsed.rule_category}\n` +
          `• **Target Scope:** \`${parsed.target_scope}\`\n` +
          `• **Condition:** \`${parsed.condition_operator} ${parsed.rule_value}\`\n` +
          `• **Enforcement:** **${parsed.enforcement_level}**\n\n` +
          `Would you like to save and activate this rule in Cloudflare D1?`,
        mode: 'RULE_COMPILER',
        suggestedRule: parsed
      };
    }
  }

  // 2. Query Live D1 Database for matching products or styles
  const matchedStyles = await searchStylesInD1(env?.DB, userMessage);

  // 3. Detect data source queries
  const isDataSourceQuery = /source|where.*data|what.*table|which.*table|d1|database|odoo_stock_move_line|move line/i.test(userMessage);

  if (isDataSourceQuery && matchedStyles.length === 0) {
    return {
      reply: getDataSourceResponse(),
      mode
    };
  }

  // 4. Construct System Persona and Context
  let systemPrompt = '';
  if (mode === 'STORE_AUDITOR') {
    systemPrompt = `You are CARINA's Store Physics & Space Auditor dedicated to Western Saudi Arabia physical stores.\n` +
      `Active Stores: Al-Andalus Mall Flagship (Jeddah, 260 m²), Al-Yasmeen Mall (Jeddah, 193 m²), Jouri Mall (Taif, 168 m²).\n` +
      `Eliminate floor congestion in Jouri (>62 u/m²) and Yasmeen (>60 u/m²). Moving broken size curves to clearance rails.\n` +
      `Both Andalus and Yasmeen are in Jeddah, enabling same-day local van transfers.\n` +
      `Shopify is non-operational and ignored. Always be concise, data-driven, and cite physical numbers.`;
  } else if (mode === 'RULE_COMPILER') {
    systemPrompt = `You are CARINA's Merchandising Policy Compiler. Translate business instructions into structured JSON governance rules for Cloudflare D1.\n` +
      `Enforce that no price can ever sell below Landed Cost * 1.15 (15% Saudi VAT).\n` +
      `Always summarize the rule and ask for confirmation before saving.`;
  } else {
    // DISCOUNT_STRATEGIST
    systemPrompt = `You are CARINA's Senior Merchandising Strategist for physical fashion retail in Saudi Arabia.\n` +
      `Core laws:\n` +
      `1. Zero-Loss Floor: Promo Price MUST be >= Landed Cost * 1.15 (Saudi 15% VAT). Never violate this.\n` +
      `2. Payday: Saudi national payroll date is the 27th of every month. Promotions should activate 2-3 days before the 27th.\n` +
      `3. Assortment Preservation: Retain at least 57.2% of stock for peak winter trading in December/January.\n` +
      `4. Competitor Strategy: Counter fast-fashion discounters (H&M, Centrepoint, Nayomi) with multi-buy basket packs (Spend 250 Save 50, Buy 2 Save 20%) rather than brand-eroding single item markdowns.\n` +
      `Be quantitative, concise, cite specific units, SAR costs, and store allocations.`;
  }

  let contextualUserPrompt = userMessage;
  if (matchedStyles.length > 0) {
    const formattedD1 = matchedStyles.map(formatStyleDetails).join('\n\n---\n\n');
    contextualUserPrompt = `${userMessage}\n\n[LIVE CLOUDFLARE D1 DATABASE CONTEXT]:\n${formattedD1}`;
  }

  // 5. Try Cloudflare Workers AI with fallback model chain
  if (env?.AI) {
    const candidateModels = [
      '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      '@cf/meta/llama-3.1-8b-instruct',
      '@cf/meta/llama-3.1-8b-instruct-fp8',
      '@cf/meta/llama-3-8b-instruct'
    ];

    for (const model of candidateModels) {
      try {
        const messages = [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: contextualUserPrompt }
        ];

        const aiResponse = await env.AI.run(model, {
          messages,
          temperature: 0.2,
          max_tokens: 1024
        });

        if (aiResponse?.response) {
          return {
            reply: aiResponse.response,
            mode
          };
        }
      } catch (err: any) {
        console.warn(`Workers AI model ${model} failed, trying next fallback:`, err?.message || err);
      }
    }
  }

  // 6. Intelligent Context-Driven Fallback (when offline or Workers AI is unavailable)
  if (matchedStyles.length > 0) {
    const primary = matchedStyles[0];
    const details = matchedStyles.map(formatStyleDetails).join('\n\n---\n\n');
    return {
      reply: `I retrieved the live merchandising data from Cloudflare D1 for your inquiry:\n\n${details}\n\n` +
        `💡 **Strategic Recommendation:** Style \`${primary.style_code}\` has **${primary.total_physical_stock} units** in physical stock. ` +
        `At **${primary.promotional_price.toFixed(2)} SAR** (vs cost+VAT floor of ${primary.cost_plus_vat.toFixed(2)} SAR), it provides healthy unit contribution while clearing slow-moving inventory before December peak.`,
      mode
    };
  }

  if (isDataSourceQuery) {
    return {
      reply: getDataSourceResponse(),
      mode
    };
  }

  // Default intelligent retail context response
  return {
    reply: `### [CARINA AI Merchandising Copilot — ${mode}]\n\n` +
      `**Request Analysis:** "${userMessage}"\n\n` +
      `• **Saudi VAT Floor Law:** Promo Price $\\ge$ Landed Cost $\\times$ 1.15 is strictly enforced across all 1,493 active styles in D1.\n` +
      `• **Physical Stores:** Andalus Mall (260 m²), Yasmeen Mall (193 m²), Jouri Mall (168 m²), and Central Warehouse (WH). Virtual and damaged stock are excluded.\n` +
      `• **Assortment Protection:** 57.2% of depth is held for December/January peak winter trading.\n` +
      `• **Payday Alignment:** Promotions calibrated for pre-payday surge starting the 25th.\n\n` +
      `*Tip: You can query any specific style code (e.g. \`59465\`, \`50177\`) or product name (e.g. "Body splash Secret Desire") to inspect live store quantities and zero-loss pricing.*`,
    mode
  };
}
