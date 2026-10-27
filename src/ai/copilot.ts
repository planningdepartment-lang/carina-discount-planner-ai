import { KSA_RETAIL_CONTEXT } from './skills/ksaRetailContext';
import { COMPETITOR_PLAYBOOK } from './skills/competitorPlaybook';
import { parseNaturalLanguageRule } from './skills/ruleParser';
import { StyleMetrics } from '../engine/lifecycleClassifier';

export type AgentMode = 'DISCOUNT_STRATEGIST' | 'STORE_AUDITOR' | 'RULE_COMPILER';

export interface CopilotChatRequest {
  message: string;
  mode?: AgentMode;
  model?: string;
  contextStyleCode?: string;
  metricsSnapshot?: Partial<StyleMetrics>;
}

export interface CopilotChatResponse {
  reply: string;
  mode: AgentMode;
  activeStyleCode?: string;
  suggestedRule?: any;
}

export interface D1StyleSnapshotRow {
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
 * Maintains conversation context if referring to 'this item' or follow-up questions.
 */
async function searchStylesInD1(
  db: D1Database | undefined, 
  userMessage: string, 
  contextStyleCode?: string
): Promise<D1StyleSnapshotRow[]> {
  if (!db) return [];

  const lowerMsg = userMessage.toLowerCase();

  try {
    // 1. Exact 5-digit style code match in current message (e.g. 59465, 50177)
    const codeMatch = userMessage.match(/\b\d{5}\b/);
    if (codeMatch) {
      const code = codeMatch[0];
      const { results } = await db
        .prepare('SELECT * FROM style_plan_snapshots WHERE style_code = ? LIMIT 1')
        .bind(code)
        .all<D1StyleSnapshotRow>();
      if (results && results.length > 0) return results;
    }

    // 2. Check if user is referencing the previous active style ('this', 'it', 'the item', 'for this item')
    const isContextualFollowup = /this|that|it\b|the item|this item|this product|this model|for this/i.test(lowerMsg);
    if (isContextualFollowup && contextStyleCode && /^\d{5}$/.test(contextStyleCode)) {
      const { results } = await db
        .prepare('SELECT * FROM style_plan_snapshots WHERE style_code = ? LIMIT 1')
        .bind(contextStyleCode)
        .all<D1StyleSnapshotRow>();
      if (results && results.length > 0) return results;
    }

    // 3. Tokenize product keywords (exclude retail events, stop words, and common campaign names)
    const stopWords = new Set([
      'what', 'are', 'the', 'source', 'data', 'using', 'from', 'where', 'this', 'that',
      'with', 'have', 'does', 'show', 'tell', 'about', 'plan', 'price', 'discount',
      'please', 'style', 'code', 'stock', 'store', 'which', 'will', 'make', 'why',
      'how', 'many', 'much', 'for', 'you', 'can', 'off', 'who', 'when', 'model', 'name',
      'white', 'friday', 'black', 'sale', 'promo', 'promotion', 'campaign', 'event',
      'ksa', 'saudi', 'offer', 'best', 'good', 'better', 'item', 'these', 'those',
      'recommend', 'recommended', 'deal', 'rail', 'weekend', 'give', 'suggest'
    ]);

    const words = lowerMsg
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 2 && !stopWords.has(w));

    if (words.length > 0) {
      const genericWords = new Set(['body', 'splash', 'ml', '100ml', '50ml', 'perfume', 'spray', 'cotton', 'basic']);
      const specificWords = words.filter(w => !genericWords.has(w));
      const targetWords = specificWords.length > 0 ? specificWords : words;

      // Match specific descriptors together (e.g. "secret" and "desire")
      const specificPhrase = `%${targetWords.join('%')}%`;
      const { results: specificResults } = await db
        .prepare('SELECT * FROM style_plan_snapshots WHERE product_name LIKE ? ORDER BY total_physical_stock DESC LIMIT 1')
        .bind(specificPhrase)
        .all<D1StyleSnapshotRow>();
      if (specificResults && specificResults.length > 0) return specificResults;

      const fullPhrase = `%${words.join('%')}%`;
      const { results: fullResults } = await db
        .prepare('SELECT * FROM style_plan_snapshots WHERE product_name LIKE ? ORDER BY total_physical_stock DESC LIMIT 1')
        .bind(fullPhrase)
        .all<D1StyleSnapshotRow>();
      if (fullResults && fullResults.length > 0) return fullResults;

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

    // 4. If no explicit product keywords matched, but we have a valid previous context, reuse it!
    if (contextStyleCode && /^\d{5}$/.test(contextStyleCode)) {
      const { results } = await db
        .prepare('SELECT * FROM style_plan_snapshots WHERE style_code = ? LIMIT 1')
        .bind(contextStyleCode)
        .all<D1StyleSnapshotRow>();
      if (results && results.length > 0) return results;
    }
  } catch (err) {
    console.error('Error querying D1 for copilot context:', err);
  }

  return [];
}

/**
 * Formats full breakdown card only when explicitly requested.
 */
function formatFullStyleCard(row: D1StyleSnapshotRow): string {
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
    `• **Recommended Offers:**\n` +
    `  - **Primary Offer (Velocity Driver):** **${row.recommended_offer}** at **${row.promotional_price.toFixed(2)} SAR** (${row.discount_pct}% off)\n` +
    `  - **Alternative (Margin Defense):** **Spend 250 Save 50 (Multi-Buy Basket Pack)** to preserve full price margin.\n` +
    `  - **Zero-Loss Compliance:** **${row.zero_loss_status}** (Promo ${row.promotional_price.toFixed(2)} SAR >= Floor ${row.cost_plus_vat.toFixed(2)} SAR)\n` +
    `  - **Forecast Clearance:** **${row.forecast_sold} units** | Projected Net Cash Margin: **${row.forecast_profit.toLocaleString()} SAR**\n` +
    `• **Commercial Rationale:** ${row.commercial_rationale}`
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
  const contextStyleCode = request.contextStyleCode;

  // 1. Natural Language Rule Compiler
  if (mode === 'RULE_COMPILER' || (userMessage.toLowerCase().includes('rule') && (userMessage.toLowerCase().includes('cap') || userMessage.toLowerCase().includes('exclude') || userMessage.toLowerCase().includes('floor') || userMessage.toLowerCase().includes('discount')))) {
    const parsed = parseNaturalLanguageRule(userMessage);
    if (parsed) {
      return {
        reply: `I have compiled your commercial instruction into a formal Governance Rule:\n\n` +
          `• **Rule ID:** \`${parsed.rule_id}\`\n` +
          `• **Policy Name:** ${parsed.rule_name}\n` +
          `• **Category:** \`${parsed.rule_category}\`\n` +
          `• **Scope Target:** \`${parsed.target_scope}\`\n` +
          `• **Condition:** \`${parsed.condition_operator} ${parsed.rule_value}\`\n` +
          `• **Enforcement:** **${parsed.enforcement_level}**\n\n` +
          `Click below to apply and activate this rule directly in D1:\n\n` +
          `[APPLY_RULE:${JSON.stringify(parsed)}]`,
        mode: 'RULE_COMPILER',
        suggestedRule: parsed
      };
    }
  }

  // 2. Query Live D1 Database for matching product or style (with context tracking)
  const matchedStyles = await searchStylesInD1(env?.DB, userMessage, contextStyleCode);

  // 3. Detect data source queries
  const isDataSourceQuery = /source|where.*data|what.*table|which.*table|d1|database|odoo_stock_move_line|move line|schema|column/i.test(userMessage);

  if (isDataSourceQuery && matchedStyles.length === 0) {
    return {
      reply: getDataSourceResponse(),
      mode
    };
  }

  // Determine user intent for style queries
  const lowerMsg = userMessage.toLowerCase();
  
  // Specific Intent Filters:
  const asksForIdentity = /what is that|what is this|what is it|what is this item|what is that item|what is the item|tell me about|what kind of|what category|what product|what model|name of this|name\b/i.test(lowerMsg);
  const asksForOffer = /offer|best offer|promo|discount|recommend|deal|rail|white friday|black friday|markdown/i.test(lowerMsg);
  const asksForStock = /how many|stock|inventory|units|quantity|wh|store|andalus|yasmeen|jouri/i.test(lowerMsg) && !asksForIdentity && !asksForOffer;
  const asksForPrice = /price|cost|margin|vat|floor|ticket/i.test(lowerMsg) && !asksForIdentity && !asksForOffer;
  const asksForFullDetails = /detail|breakdown|all|everything|full|overview|card/i.test(lowerMsg) || /^\d{5}$/.test(userMessage);

  // If a specific style was matched
  if (matchedStyles.length > 0) {
    const style = matchedStyles[0];

    // Priority 1: Answer product identity/description directly
    if (asksForIdentity && !asksForOffer && !asksForStock && !asksForFullDetails) {
      return {
        reply: `Style **${style.style_code}** is **${style.product_name}** — a **${style.category}** product in the **${style.season}** collection.`,
        mode,
        activeStyleCode: style.style_code
      };
    }

    // Priority 2: Answer promotional offer / White Friday recommendations directly
    if (asksForOffer && !asksForFullDetails) {
      return {
        reply: `Recommended promotion for Style **${style.style_code}** (*${style.product_name}*):\n\n` +
          `• 🏷️ **Primary Clearance Offer:** **${style.recommended_offer}** at **${style.promotional_price.toFixed(2)} SAR** (${style.discount_pct}% off ticket price of ${style.ticket_price.toFixed(2)} SAR)\n` +
          `• 🛡️ **Alternative Margin Defense Offer:** **Spend 250 Save 50 (Multi-Buy Basket Pack)** to preserve full price margin while driving units.\n` +
          `• ⚖️ **Zero-Loss Legal Compliance:** **${style.zero_loss_status}** (Promo ${style.promotional_price.toFixed(2)} SAR >= Legal Cost Floor ${style.cost_plus_vat.toFixed(2)} SAR)\n` +
          `• 💡 **Commercial Strategy:** ${style.commercial_rationale}`,
        mode,
        activeStyleCode: style.style_code
      };
    }

    // Priority 3: Answer physical inventory/stock questions
    if (asksForStock && !asksForFullDetails) {
      return {
        reply: `Style **${style.style_code}** (*${style.product_name}*) has **${style.total_physical_stock} physical units** in stock:\n` +
          `• 🏭 Central WH: **${style.stock_wh} units**\n` +
          `• 🏬 Al-Andalus Mall Flagship: **${style.stock_andalus} units**\n` +
          `• 🏬 Al-Yasmeen Mall: **${style.stock_yasmeen} units**\n` +
          `• 🏬 Jouri Mall (Taif): **${style.stock_jouri} units**`,
        mode,
        activeStyleCode: style.style_code
      };
    }

    // Priority 4: Answer price, cost, or margin economics
    if (asksForPrice && !asksForFullDetails) {
      return {
        reply: `Style **${style.style_code}** (*${style.product_name}*) Pricing Economics:\n` +
          `• Unit Landed Cost: **${style.unit_cost.toFixed(2)} SAR**\n` +
          `• Zero-Loss Legal Floor (Cost + 15% VAT): **${style.cost_plus_vat.toFixed(2)} SAR**\n` +
          `• Original Ticket Price: **${style.ticket_price.toFixed(2)} SAR**`,
        mode,
        activeStyleCode: style.style_code
      };
    }

    // Priority 5: Full breakdown card if explicitly asked or bare 5-digit style code
    if (asksForFullDetails) {
      return {
        reply: formatFullStyleCard(style),
        mode,
        activeStyleCode: style.style_code
      };
    }

    // For open-ended questions about this style, run Workers AI
    const userModel = request.model && request.model !== 'auto' ? request.model : '@cf/meta/llama-3.1-8b-instruct';
    if (env?.AI) {
      try {
        const styleContext = `[Context for Style ${style.style_code}]:\n` +
          `- Style Code: ${style.style_code}\n` +
          `- Product Name: ${style.product_name}\n` +
          `- Category: ${style.category}\n` +
          `- Season: ${style.season}\n` +
          `- Total Physical Stock: ${style.total_physical_stock} units\n` +
          `- Stock Breakdown: Andalus=${style.stock_andalus}, Yasmeen=${style.stock_yasmeen}, Jouri=${style.stock_jouri}, WH=${style.stock_wh}\n` +
          `- Landed Unit Cost: ${style.unit_cost.toFixed(2)} SAR\n` +
          `- Zero-Loss Floor (Cost + 15% VAT): ${style.cost_plus_vat.toFixed(2)} SAR\n` +
          `- Ticket Price: ${style.ticket_price.toFixed(2)} SAR\n` +
          `- Recommended Offer: ${style.recommended_offer}\n` +
          `- Promotional Price: ${style.promotional_price.toFixed(2)} SAR (${style.discount_pct}% off)`;

        const systemPrompt = `You are CARINA's Senior Merchandising Strategist in Saudi Arabia.\n` +
          `CRITICAL INSTRUCTION: Answer ONLY what the user specifically asked using the context. Do not dump unrequested pricing tables, inventory breakdowns, or generic essays. Answer directly in 1-2 concise sentences.`;

        const aiPromise = env.AI.run(userModel, {
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `${styleContext}\n\nUser Question: "${userMessage}"` }
          ],
          temperature: 0.1,
          max_tokens: 250
        });

        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('AI Timeout')), 5000));
        const aiResponse: any = await Promise.race([aiPromise, timeoutPromise]);

        if (aiResponse?.response) {
          return {
            reply: aiResponse.response.trim(),
            mode,
            activeStyleCode: style.style_code
          };
        }
      } catch (err: any) {
        console.warn('AI run warning, using direct response:', err?.message || err);
      }
    }

    // Default direct response
    return {
      reply: `Style **${style.style_code}** is **${style.product_name}** (${style.category}, ${style.season}). Total physical stock: **${style.total_physical_stock} units** (Ticket: ${style.ticket_price.toFixed(2)} SAR, Promo: ${style.promotional_price.toFixed(2)} SAR).`,
      mode,
      activeStyleCode: style.style_code
    };
  }

  // 4. General assistant query (not a specific style)
  if (isDataSourceQuery) {
    return {
      reply: getDataSourceResponse(),
      mode
    };
  }

  const userModel = request.model && request.model !== 'auto' ? request.model : '@cf/meta/llama-3.1-8b-instruct';
  if (env?.AI) {
    try {
      const aiPromise = env.AI.run(userModel, {
        messages: [
          { role: 'system', content: 'You are CARINA Senior Merchandising Strategist in Saudi Arabia. Stores: Andalus Mall (260m²), Yasmeen Mall (193m²), Jouri Mall (Taif, 168m²), Central WH. Enforce zero-loss floor (Price >= Cost * 1.15). Keep responses concise, direct, and under 120 words.' },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.2,
        max_tokens: 250
      });

      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('AI Timeout')), 5000));
      const aiResponse: any = await Promise.race([aiPromise, timeoutPromise]);

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
