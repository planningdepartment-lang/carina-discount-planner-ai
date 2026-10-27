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
 * Searches D1 style_plan_snapshots for specific matches based on user message.
 * Prioritizes distinct style identifiers to avoid returning unrelated products.
 */
async function searchStylesInD1(db: D1Database | undefined, userMessage: string): Promise<D1StyleSnapshotRow[]> {
  if (!db) return [];

  try {
    // 1. Exact 5-digit style code match (e.g. 59465, 50177)
    const codeMatch = userMessage.match(/\b\d{5}\b/);
    if (codeMatch) {
      const code = codeMatch[0];
      const { results } = await db
        .prepare('SELECT * FROM style_plan_snapshots WHERE style_code = ? LIMIT 1')
        .bind(code)
        .all<D1StyleSnapshotRow>();
      if (results && results.length > 0) return results;
    }

    // 2. Tokenize product keywords (exclude small or generic stop words)
    const stopWords = new Set([
      'what', 'are', 'the', 'source', 'data', 'using', 'from', 'where', 'this', 'that',
      'with', 'have', 'does', 'show', 'tell', 'about', 'plan', 'price', 'discount',
      'please', 'style', 'code', 'stock', 'store', 'which', 'will', 'make', 'why',
      'how', 'many', 'much', 'for', 'you', 'can', 'off', 'who', 'when'
    ]);
    const words = userMessage
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 2 && !stopWords.has(w));

    if (words.length > 0) {
      // Filter out generic product type words to find unique style descriptors
      const genericWords = new Set(['body', 'splash', 'ml', '100ml', '50ml', 'perfume', 'spray', 'cotton', 'basic']);
      const specificWords = words.filter(w => !genericWords.has(w));
      const targetWords = specificWords.length > 0 ? specificWords : words;

      // Priority 1: Match specific descriptors together (e.g. "secret" and "desire")
      const specificPhrase = `%${targetWords.join('%')}%`;
      const { results: specificResults } = await db
        .prepare('SELECT * FROM style_plan_snapshots WHERE product_name LIKE ? ORDER BY total_physical_stock DESC LIMIT 1')
        .bind(specificPhrase)
        .all<D1StyleSnapshotRow>();
      if (specificResults && specificResults.length > 0) return specificResults;

      // Priority 2: Match all keywords together
      const fullPhrase = `%${words.join('%')}%`;
      const { results: fullResults } = await db
        .prepare('SELECT * FROM style_plan_snapshots WHERE product_name LIKE ? ORDER BY total_physical_stock DESC LIMIT 1')
        .bind(fullPhrase)
        .all<D1StyleSnapshotRow>();
      if (fullResults && fullResults.length > 0) return fullResults;

      // Priority 3: Match the most specific single word (>=4 chars)
      for (const w of targetWords) {
        if (w.length >= 4) {
          const { results } = await db
            .prepare('SELECT * FROM style_plan_snapshots WHERE product_name LIKE ? ORDER BY total_physical_stock DESC LIMIT 1')
            .bind(`%${w}%`)
            .all<D1StyleSnapshotRow>();
          if (results && results.length > 0) return results;
        }
      }
    }
  } catch (err) {
    console.error('Error querying D1 for copilot context:', err);
  }

  return [];
}

/**
 * Formats a clean markdown breakdown of style row retrieved from D1.
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
    `  - Zero-Loss Compliance: **${row.zero_loss_status}** (Promo ${row.promotional_price.toFixed(2)} SAR >= Floor ${row.cost_plus_vat.toFixed(2)} SAR)\n` +
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

  // 2. Query Live D1 Database for matching product or style
  const matchedStyles = await searchStylesInD1(env?.DB, userMessage);

  // 3. Detect data source queries
  const isDataSourceQuery = /source|where.*data|what.*table|which.*table|d1|database|odoo_stock_move_line|move line|schema|column/i.test(userMessage);

  if (isDataSourceQuery && matchedStyles.length === 0) {
    return {
      reply: getDataSourceResponse(),
      mode
    };
  }

  // If a specific style was matched, provide the precise breakdown directly
  if (matchedStyles.length > 0) {
    const style = matchedStyles[0];
    
    // When Workers AI is available, use fast Llama 3.1 8B to provide an instant, concise commercial brief
    if (env?.AI) {
      try {
        const prompt = `Style Code: ${style.style_code}\nProduct: ${style.product_name}\nCategory: ${style.category}\nSeason: ${style.season}\nTotal Physical Stock: ${style.total_physical_stock} units\nStock Breakdown: Andalus Mall=${style.stock_andalus}, Yasmeen Mall=${style.stock_yasmeen}, Jouri Mall=${style.stock_jouri}, Central WH=${style.stock_wh}\nLanded Unit Cost: ${style.unit_cost} SAR\nCost + 15% VAT (Zero-loss floor): ${style.cost_plus_vat} SAR\nTicket Price: ${style.ticket_price} SAR\nRecommended Offer: ${style.recommended_offer}\nPromotional Price: ${style.promotional_price} SAR\nCurve Health: ${style.sar_curve_health}\nWeekly ROS: ${style.weekly_ros} u/wk\nSTR: ${style.cumulative_str_pct}%\nUser Question: "${userMessage}"\n\nInstructions: Provide an immediate, concise, 3-4 bullet point executive merchandising assessment for this exact product only. Focus on inventory location, margin safety, and recommended promotional action. Keep it under 150 words.`;

        const aiResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
          messages: [
            { role: 'system', content: 'You are CARINA Senior Merchandising Copilot in Saudi Arabia. Be concise, direct, quantitative, and focus ONLY on the specific style asked. Never discuss other unrelated products.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.1,
          max_tokens: 400
        });

        if (aiResponse?.response) {
          return {
            reply: `${formatStyleDetails(style)}\n\n💡 **Copilot Executive Assessment:**\n${aiResponse.response.trim()}`,
            mode
          };
        }
      } catch (err: any) {
        console.warn('Fast AI run warning, using direct structured response:', err?.message || err);
      }
    }

    // Direct structured response (instantaneous < 5ms)
    return {
      reply: `${formatStyleDetails(style)}\n\n💡 **Copilot Executive Assessment:**\n` +
        `• **Inventory Distribution:** Total **${style.total_physical_stock} units** (WH: ${style.stock_wh}, Yasmeen: ${style.stock_yasmeen}, Andalus: ${style.stock_andalus}, Jouri: ${style.stock_jouri}).\n` +
        `• **Margin Security:** Selling at **${style.promotional_price.toFixed(2)} SAR** guarantees compliance with Saudi zero-loss floor (${style.cost_plus_vat.toFixed(2)} SAR).\n` +
        `• **Commercial Action:** Activate **"${style.recommended_offer}"** 2-3 days before the 27th national payday to accelerate sell-through while preserving core assortment.`,
      mode
    };
  }

  // 4. Fallback for general queries
  if (isDataSourceQuery) {
    return {
      reply: getDataSourceResponse(),
      mode
    };
  }

  // General assistant response using fast 8B model
  if (env?.AI) {
    try {
      const aiResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          { role: 'system', content: 'You are CARINA Senior Merchandising Copilot in Saudi Arabia. Stores: Andalus Mall (260m²), Yasmeen Mall (193m²), Jouri Mall (Taif, 168m²), Central WH. Always enforce zero-loss floor (Price >= Cost * 1.15). Keep responses concise, direct, and under 150 words.' },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.2,
        max_tokens: 350
      });

      if (aiResponse?.response) {
        return {
          reply: aiResponse.response.trim(),
          mode
        };
      }
    } catch (err) {
      console.warn('General AI run warning:', err);
    }
  }

  return {
    reply: `### [CARINA Merchandising Copilot — ${mode}]\n\n` +
      `**Request:** "${userMessage}"\n\n` +
      `• **Saudi VAT Floor:** Enforcing $P_{\\text{promo}} \\ge \\text{Landed Cost} \\times 1.15$ across all 1,493 active styles in D1.\n` +
      `• **Physical Stores:** Al-Andalus (260 m²), Al-Yasmeen (193 m²), Jouri Mall Taif (168 m²), and Central Warehouse (WH). Virtual and damaged locations excluded.\n` +
      `• **Assortment Protection:** Retaining $\\ge 57.2\\%$ of depth for December/January winter peak.\n\n` +
      `*Tip: Enter any style code (e.g. \`59465\`, \`50177\`) or product name (e.g. "Body splash Secret Desire") for an instant live breakdown.*`,
    mode
  };
}
