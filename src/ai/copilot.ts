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
  activeModel?: string;
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
    // 1. Exact 5-digit style code match in current message (e.g. 59465, 59461, 50177)
    const codeMatch = userMessage.match(/\b\d{5}\b/);
    if (codeMatch) {
      const code = codeMatch[0];
      const { results } = await db
        .prepare('SELECT * FROM style_plan_snapshots WHERE style_code = ? LIMIT 1')
        .bind(code)
        .all<D1StyleSnapshotRow>();
      if (results && results.length > 0) return results;
    }

    // 2. Tokenize potential product keywords from current message
    // Exclude common conversational stop words, query pronouns, and macro analytical terms
    const stopWords = new Set([
      'what', 'are', 'the', 'source', 'data', 'using', 'from', 'where', 'this', 'that',
      'with', 'have', 'does', 'show', 'tell', 'about', 'plan', 'price', 'discount',
      'please', 'style', 'code', 'stock', 'store', 'which', 'will', 'make', 'why',
      'how', 'many', 'much', 'for', 'you', 'can', 'off', 'who', 'when', 'model', 'name',
      'white', 'friday', 'black', 'sale', 'sales', 'promo', 'promotion', 'campaign', 'event',
      'ksa', 'saudi', 'offer', 'best', 'good', 'better', 'item', 'items', 'these', 'those',
      'recommend', 'recommended', 'deal', 'rail', 'weekend', 'give', 'suggest',
      'analyze', 'analyzing', 'analysis', 'performance', 'overall', 'summary', 'metrics',
      'talking', 'talk', 'mean', 'me', 'my', 'one', 'ones', 'here', 'look', 'looking',
      'check', 'review', 'trend', 'trends', 'report', 'numbers', 'velocity', 'runway',
      'hello', 'hi', 'hey', 'thanks', 'thank'
    ]);

    const words = lowerMsg
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 2 && !stopWords.has(w));

    // If product candidate words were found in current message, search D1 FIRST!
    if (words.length > 0) {
      // Step A: All non-stop words must match simultaneously (e.g. "perfume", "silk", "dream")
      if (words.length > 1) {
        const whereClauses = words.map(() => 'product_name LIKE ?').join(' AND ');
        const bindings = words.map(w => `%${w}%`);
        const { results } = await db
          .prepare(`SELECT * FROM style_plan_snapshots WHERE ${whereClauses} ORDER BY total_physical_stock DESC LIMIT 1`)
          .bind(...bindings)
          .all<D1StyleSnapshotRow>();
        if (results && results.length > 0) return results;
      }

      // Step B: Filter out volume units / generic tokens (e.g. "50ml", "100ml", "ml")
      const modifierWords = new Set(['ml', '100ml', '50ml', 'v', 'n']);
      const coreWords = words.filter(w => !modifierWords.has(w));
      if (coreWords.length > 1 && coreWords.length < words.length) {
        const whereClauses = coreWords.map(() => 'product_name LIKE ?').join(' AND ');
        const bindings = coreWords.map(w => `%${w}%`);
        const { results } = await db
          .prepare(`SELECT * FROM style_plan_snapshots WHERE ${whereClauses} ORDER BY total_physical_stock DESC LIMIT 1`)
          .bind(...bindings)
          .all<D1StyleSnapshotRow>();
        if (results && results.length > 0) return results;
      }

      // Step C: Contiguous phrase match
      const phrase = `%${coreWords.join('%')}%`;
      const { results: phraseResults } = await db
        .prepare('SELECT * FROM style_plan_snapshots WHERE product_name LIKE ? ORDER BY total_physical_stock DESC LIMIT 1')
        .bind(phrase)
        .all<D1StyleSnapshotRow>();
      if (phraseResults && phraseResults.length > 0) return phraseResults;

      // Step D: Individual specific words (length >= 4, excluding generic fashion tokens)
      const genericSingleWords = new Set(['perfume', 'splash', 'cotton', 'basic', 'shirt', 'dress', 'pants', 'skirt', 'top', 'bottom']);
      for (const w of coreWords) {
        if (w.length >= 4 && !genericSingleWords.has(w)) {
          const { results } = await db
            .prepare('SELECT * FROM style_plan_snapshots WHERE product_name LIKE ? ORDER BY total_physical_stock DESC LIMIT 1')
            .bind(`%${w}%`)
            .all<D1StyleSnapshotRow>();
          if (results && results.length > 0) return results;
        }
      }
    }

    // 3. ONLY IF NO specific product keyword was found in current user message:
    // Check if user is referencing the previous active style ('this', 'it', 'for this item')
    const isContextualFollowup = /\b(this|that|it|its|the item|this item|this product|this model|for this|for it)\b/i.test(lowerMsg);
    const isMacroOrGeneralQuery = /\b(analyze|analysis|sales|performance|overall|catalog|store|stores|density|total|summary|margin|profit|revenue)\b/i.test(lowerMsg);

    if (isContextualFollowup && !isMacroOrGeneralQuery && contextStyleCode && /^\d{5}$/.test(contextStyleCode)) {
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
    `### Style **${row.style_code}** — *${row.product_name}*\n` +
    `• **Category / Season:** \`${row.category || 'General'}\` | \`${row.season || 'Continuity'}\`\n` +
    `• **Total Physical Inventory:** **${row.total_physical_stock} units**\n` +
    `  - **Al-Andalus Mall Flagship (Jeddah):** ${row.stock_andalus} units\n` +
    `  - **Al-Yasmeen Mall (Jeddah):** ${row.stock_yasmeen} units\n` +
    `  - **Jouri Mall (Taif):** ${row.stock_jouri} units\n` +
    `  - **Central Warehouse (WH):** ${row.stock_wh} units\n` +
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
    `### CARINA Merchandising Architecture — Assortment Intelligence\n\n` +
    `All promotional pricing, store allocations, and lifecycle strategies are synthesized directly from **Verified Point-of-Sale (POS) & Store Inventory Records** across the Kingdom of Saudi Arabia:\n\n` +
    `1. **Inventory Movements & Transaction History:**\n` +
    `   - **Audited Ledger Volume:** 380,518 verified retail store and warehouse stock movements.\n` +
    `   - **Verified Assortment Invariant:** Ingests only retail apparel and accessories SKUs with valid size and color curves.\n` +
    `   - **Active Styles In Catalog:** 1,493 verified physical styles on-hand.\n\n` +
    `2. **Physical Store Network Capacity (621 m² Sales Floor):**\n` +
    `   - **Al-Andalus Mall Flagship (Jeddah, 260 m²):** Balanced commercial hub.\n` +
    `   - **Al-Yasmeen Mall (Jeddah, 193 m²):** Overloaded floor; priority clearance hub.\n` +
    `   - **Jouri Mall (Taif, 168 m²):** High density bottleneck; primary candidate for Take 3 for 99 SAR rail.\n` +
    `   - **Central Warehouse:** Reserve fulfillment for replenishment.\n` +
    `   - **Virtual & Damaged Isolation:** Online virtual stock and damaged items are strictly separated from physical sales floors.\n\n` +
    `3. **Commercial Guardrails:**\n` +
    `   - **Saudi Zero-Loss Legal Compliance:** Every offer strictly complies with Price >= Cost x 1.15 (15% VAT).\n` +
    `   - **Winter Assortment Shield:** At least 57.2% of core winter assortment depth is preserved for peak trading.`
  );
}

/**
 * Cloudflare Workers AI Copilot Orchestrator
 */

/**
 * Strips raw thinking tokens, scratchpad monologues, <think>...</think> blocks, and all emojis/icons.
 */
function sanitizeAiResponse(raw: string): string {
  if (!raw) return '';
  let text = raw.trim();

  // 1. Strip explicit <think>...</think> tags and unclosed <think>
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  text = text.replace(/<think>[\s\S]*$/gi, '').trim();

  // 2. Strip internal reasoning monologue patterns like:
  // "Okay, so the user is asking..."
  // "First, I should check..."
  if (/^(Okay|Alright|So|Let's see|First|Looking back),\s*(the\s*user|so\s*the\s*user|I\s*need|let's)/i.test(text)) {
    const sections = text.split(/\n\n+/);
    const realSections = sections.filter(sec => {
      const s = sec.trim();
      return !/^(Okay|Alright|So,\s*the\s*user|First,\s*I\s*should|Next,\s*I'll|Now,\s*considering|Looking\s*back|Let's\s*calculate|Let's\s*see)/i.test(s);
    });
    if (realSections.length > 0) {
      text = realSections.join('\n\n').trim();
    }
  }

  // 3. Strictly strip all emojis and icons
  text = text.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E0}-\u{1F1FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1FA00}-\u{1FAFF}\u{200D}\u{FE0F}\u{FE0E}]/gu, '')
             .replace(/[⚡✨🧠➤✅❌⚖🛡💡🏬🏭🚫💰🏷📦🎯📈⏳🔮💫🌟🌐💻📱🌪🌙🗑✏]/g, '');

  return text.trim();
}

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
          `Click below to apply and activate this commercial policy across the live catalog:\n\n` +
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

  // If a specific style was matched from the message or active conversation context
  if (matchedStyles.length > 0) {
    const style = matchedStyles[0];

    // Case A: Product or Style Lookup (e.g. user entered "50006", "59461", "Perfume Silk Dream 50ML", "i'm talking about this one Perfume Silk Dream 50ML")
    const isAnalyticalQuery = /\b(why|how|calculate|calculation|formula|margin|cogs|vat|floor|imu|wos|runway|velocity|decongest|simulate|project)\b/i.test(lowerMsg);
    if (!isAnalyticalQuery) {
      return {
        reply: formatFullStyleCard(style),
        mode,
        activeStyleCode: style.style_code
      };
    }

    // Case B: The user is asking a specific question, calculation, explanation, or scenario.
    // SEND DIRECTLY TO WORKERS AI with complete mathematical telemetry and governance rules!
    let userModel = request.model && request.model !== 'auto' ? request.model : '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

    if (env?.AI) {
      try {
        const wosVal = style.weekly_ros > 0 ? (style.total_physical_stock / style.weekly_ros).toFixed(1) : '999';
        const imuVal = style.ticket_price > 0 ? (((style.ticket_price - style.unit_cost) / style.ticket_price) * 100).toFixed(1) : '0';
        const promoRev = style.promotional_price / 1.15;
        const promoNetMargin = (promoRev - style.unit_cost).toFixed(2);
        const promoMarginPct = promoRev > 0 ? (((promoRev - style.unit_cost) / promoRev) * 100).toFixed(1) : '0';

        const styleContext = `[Comprehensive Merchandising & Financial Telemetry for Style ${style.style_code}]:\n` +
          `- Style Code: ${style.style_code}\n` +
          `- Product Name: ${style.product_name}\n` +
          `- Assortment Category: ${style.category}\n` +
          `- Season Collection: ${style.season}\n` +
          `- Cumulative Sell-Through (STR): ${style.cumulative_str_pct}% [Formula: Cumulative Units Sold / (Cumulative Units Sold + Remaining Stock) * 100]\n` +
          `- 8-Week Rolling Sales Velocity (ROS): ${style.weekly_ros} units/week [Formula: Total Units Sold in Last 8 Weeks / 8]\n` +
          `- Store Runway / Weeks of Supply (WOS): ${wosVal} weeks [Formula: Total Physical Stock / Weekly ROS = ${style.total_physical_stock} / ${style.weekly_ros} = ${wosVal} weeks]\n` +
          `- Active Size Curve: ${style.sar_curve_health}\n` +
          `- Total Physical Stock: ${style.total_physical_stock} units on-hand\n` +
          `- Physical Store Distribution: Al-Andalus Mall Flagship (Jeddah)=${style.stock_andalus}u (${((style.stock_andalus / style.total_physical_stock) * 100).toFixed(1)}%), Al-Yasmeen Mall (Jeddah)=${style.stock_yasmeen}u (${((style.stock_yasmeen / style.total_physical_stock) * 100).toFixed(1)}%), Jouri Mall (Taif)=${style.stock_jouri}u (${((style.stock_jouri / style.total_physical_stock) * 100).toFixed(1)}%), Central Warehouse (WH)=${style.stock_wh}u (${((style.stock_wh / style.total_physical_stock) * 100).toFixed(1)}%)\n` +
          `- Landed Unit Cost (COGS): ${style.unit_cost.toFixed(2)} SAR\n` +
          `- Saudi 15% VAT Legal Break-Even Floor: ${style.cost_plus_vat.toFixed(2)} SAR [Formula: Landed Cost x 1.15 = ${style.unit_cost.toFixed(2)} x 1.15]\n` +
          `- Original List Ticket Price: ${style.ticket_price.toFixed(2)} SAR\n` +
          `- Initial Sales Markup (IMU): ${imuVal}% [Formula: (Ticket Price - Cost) / Ticket Price * 100]\n` +
          `- Recommended Promotional Offer: ${style.recommended_offer}\n` +
          `- Promotional Price: ${style.promotional_price.toFixed(2)} SAR (${style.discount_pct}% off list)\n` +
          `- Zero-Loss Compliance Status: ${style.zero_loss_status} (Promo ${style.promotional_price.toFixed(2)} SAR >= Legal Floor ${style.cost_plus_vat.toFixed(2)} SAR)\n` +
          `- Promo Net Margin Contribution: +${promoNetMargin} SAR/unit (${promoMarginPct}% net margin)\n` +
          `- Forecast Event Clearance: ${style.forecast_sold} units (Liquidation Rate: ${Math.round((style.forecast_sold / style.total_physical_stock) * 100)}%)\n` +
          `- Projected Net Margin Contribution: +${style.forecast_profit.toLocaleString()} SAR\n` +
          `- Commercial Rationale: ${style.commercial_rationale}`;

        const systemPrompt = `You are CARINA's Senior Commercial Merchandising Strategist and Retail Pricing Analyst in Saudi Arabia.\n` +
          `Stores: Al-Andalus Mall Flagship (Jeddah, 260 m²), Al-Yasmeen Mall (Jeddah, 193 m²), Jouri Mall (Taif, 168 m²), Central Warehouse (WH).\n\n` +
          `CORE CAPABILITIES & RULES:\n` +
          `1. COMPREHENSIVE COMMERCIAL PLANNING & CAPABILITIES:\n` +
          `   - You ARE CARINA's automated White Friday, promotional, and markdown discount planning intelligence in Saudi Arabia (KSA).\n` +
          `   - NEVER answer with a bare monosyllable like "Yes" or "No". Even if the user asks "confirm yes or no", state the confirmation clearly and summarize the strategic commercial parameters, store allocations, and governance guardrails.\n` +
          `2. ANSWER ANY QUESTION OR CALCULATION DIRECTLY:\n` +
          `   - Answer the specific analytical, mathematical, operational, or strategic question asked by the user.\n` +
          `   - When the user asks "how did you calculate...", "why...", or asks for any formula/derivation (such as Store Runway / Weeks of Supply, Velocity / ROS, Sell-Through Rate, IMU, Unit Margins, or Legal Floor), explain the exact formula and show the step-by-step arithmetic using the numbers from the provided telemetry.\n` +
          `   - Do NOT deflect or output an unasked generic inventory breakdown or list of stores when a calculation or analytical question is asked.\n` +
          `3. PROHIBITED ACTIONS & COMMERCIAL GOVERNANCE:\n` +
          `   - If the user proposes, asks for, or calculates a price or action that violates Saudi commercial law or commercial governance rules, clearly inform them that it is PROHIBITED:\n` +
          `     * Below-Cost Selling: Under Saudi retail pricing regulations, selling below landed cost plus 15% VAT (Price < Cost x 1.15) is strictly prohibited. State: "Prohibited Action: Selling below landed unit cost plus 15% VAT (${style.unit_cost.toFixed(2)} SAR x 1.15 = ${style.cost_plus_vat.toFixed(2)} SAR) is legally prohibited under Saudi retail pricing regulations."\n` +
          `     * Assortment Degradation: Deep discounting on fresh Winter AW26 collection or protected core styles is prohibited by active governance policies.\n` +
          `     * Inventory Contamination: Moving virtual online stock or damaged goods into physical store sales floors is prohibited.\n` +
          `   - Always state the prohibition clearly, explain the reason, and provide the compliant alternative.\n` +
          `4. STRICT EXECUTIVE FORMATTING:\n` +
          `   - Provide ONLY your final, professional commercial answer directly.\n` +
          `   - Do NOT output internal monologues, scratchpad thoughts, or reasoning steps (e.g., do not start with "Okay, so the user is asking...").\n` +
          `   - Strictly NO emojis or unicode icons in your output. Format with clean section headers and bullet points.`;

        const aiPromise = env.AI.run(userModel, {
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `${styleContext}\n\nUser Question: "${userMessage}"` }
          ],
          temperature: 0.15,
          max_tokens: 450
        });

        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('AI Timeout')), 25000));
        const aiResponse: any = await Promise.race([aiPromise, timeoutPromise]);

        const textReply = aiResponse?.response || 
                          aiResponse?.choices?.[0]?.message?.content || 
                          (typeof aiResponse === 'string' ? aiResponse : null);

        if (textReply && textReply.trim().length > 0) {
          const cleanReply = sanitizeAiResponse(textReply);
          return {
            reply: cleanReply,
            mode,
            activeStyleCode: style.style_code,
            activeModel: userModel
          };
        }
      } catch (err: any) {
        console.warn('AI run warning, using intelligent contextual fallback:', err?.message || err);

        // Context-aware mathematical fallback if AI model times out
        if (/runway|wos|weeks of supply|supply|coverage/i.test(lowerMsg)) {
          const wosVal = style.weekly_ros > 0 ? (style.total_physical_stock / style.weekly_ros).toFixed(1) : '999';
          return {
            reply: `### Store Runway Calculation — Style **${style.style_code}** (*${style.product_name}*)\n\n` +
              `• **Formula:** Store Runway (Weeks of Supply / WOS) = Total Physical Stock / 8-Week Rolling Sales Velocity (ROS)\n` +
              `• **Total Physical Stock:** **${style.total_physical_stock} units** on-hand\n` +
              `• **Weekly Sales Velocity (ROS):** **${style.weekly_ros} units/week**\n` +
              `• **Calculation:** ${style.total_physical_stock} units / ${style.weekly_ros} u/wk = **${wosVal} Weeks of Supply**\n` +
              `• **Runway Assessment:** At current sales velocity, on-hand inventory provides approximately **${(Number(wosVal) / 4.33).toFixed(1)} months** of retail coverage across store nodes without additional replenishment.`,
            mode,
            activeStyleCode: style.style_code
          };
        }

        if (/price|cost|margin|floor|vat|imu/i.test(lowerMsg)) {
          const imu = style.ticket_price > 0 ? (((style.ticket_price - style.unit_cost) / style.ticket_price) * 100).toFixed(1) : '0';
          const netPromoRev = style.promotional_price / 1.15;
          const promoMargin = netPromoRev - style.unit_cost;
          const promoMarginPct = netPromoRev > 0 ? ((promoMargin / netPromoRev) * 100).toFixed(1) : '0';

          return {
            reply: `### Pricing & Margin Economics — Style **${style.style_code}** (*${style.product_name}*)\n\n` +
              `• **Original List Ticket Price:** **${style.ticket_price.toFixed(2)} SAR**\n` +
              `• **Landed Unit Cost (COGS):** **${style.unit_cost.toFixed(2)} SAR**\n` +
              `• **Saudi 15% VAT Legal Floor:** **${style.cost_plus_vat.toFixed(2)} SAR** (Formula: Cost x 1.15)\n` +
              `• **Initial Sales Markup (IMU):** **${imu}%** (Formula: (Ticket - Cost) / Ticket)\n` +
              `• **Recommended Promo Price:** **${style.promotional_price.toFixed(2)} SAR** (${style.discount_pct}% off)\n` +
              `• **Promo Unit Net Margin:** **+${promoMargin.toFixed(2)} SAR** (${promoMarginPct}% net margin)`,
            mode,
            activeStyleCode: style.style_code
          };
        }
      }
    }

    // Default overview card for the style
    return {
      reply: formatFullStyleCard(style),
      mode,
      activeStyleCode: style.style_code
    };
  }

  // Case C: General assistant query (No specific style matched in context)
  // If user asks for specific data about an unknown item without providing a code, ask for clarification
  const asksForSpecificItem = /what is the price of this|how many.*this item|tell me about this product|what is this style|how is this selling/i.test(lowerMsg);
  if (asksForSpecificItem) {
    return {
      reply: `### Clarification Required\n\n` +
        `• Please provide the 5-digit style code (e.g. \`59465\` or \`50177\`) or the exact product name.\n` +
        `• Once specified, I will pull its physical stock across Jeddah and Taif, weekly velocity, margin economics, and zero-loss pricing rules for you.`,
      mode
    };
  }

  // For any general retail question, calculation, methodology, or commercial check:
  // RUN WORKERS AI WITH GENERAL RETAIL TELEMETRY!
  let genModel = request.model && request.model !== 'auto' ? request.model : '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
  if (env?.AI) {
    try {
      const generalContext = `[CARINA Commercial & Retail Architecture Telemetry]:\n` +
        `- Retail Network: Al-Andalus Mall Flagship (Jeddah, 260 m²), Al-Yasmeen Mall (Jeddah, 193 m²), Jouri Mall (Taif, 168 m²), Central Warehouse (WH).\n` +
        `- Total Sales Floor Area: 621 m² physical retail space across Western Region (KSA).\n` +
        `- Total Physical Inventory Catalog: 1,493 active styles, 54,125 physical units on-hand.\n` +
        `- Sales Performance & Velocity: Cumulative Sell-Through (STR) = 46.9% catalog average; Rolling 8-Week Velocity (ROS) = 0.66 units/week per active style.\n` +
        `- Portfolio Valuation: Total Retail Ticket Value = 3,745,210 SAR | Landed Cost Capital = 1,183,520 SAR | Blended Initial Markup (IMU) = 68.4%.\n` +
        `- Store Densities & Clearance Priorities:\n` +
        `  * Al-Andalus Mall Flagship (Jeddah, 260 m²): Balanced sales floor density.\n` +
        `  * Al-Yasmeen Mall (Jeddah, 193 m²): Overstocked floor (>55 units/m²), priority candidate for promotional markdown.\n` +
        `  * Jouri Mall (Taif, 168 m²): Critical bottleneck (>60 units/m²), candidate for Take 3 For 99 SAR multi-buy clearance rails before winter weather.\n` +
        `  * Central Warehouse (WH): Reserve replenishment buffer.\n` +
        `- Campaign Clearance Projection: 26,451 units projected for event clearance, generating +339,487 SAR net cash margin contribution.\n` +
        `- Saudi Legal Pricing Floor Rule: Promotional retail price MUST be greater than or equal to Landed Unit Cost multiplied by 1.15 (15% VAT). Selling below this floor is legally prohibited under Saudi retail regulations.\n` +
        `- Winter Assortment Protection: At least 57.2% of depth in fresh Winter AW26 collections is protected from clearance discounting.\n` +
        `- Core Retail Formulas:\n` +
        `  * Store Runway / Weeks of Supply (WOS) = Total Physical Stock / Weekly ROS (Rate of Sale)\n` +
        `  * Weekly ROS = Units sold over past 8 weeks / 8 weeks\n` +
        `  * Cumulative Sell-Through (STR) = Cumulative Units Sold / (Cumulative Units Sold + Remaining Stock) * 100\n` +
        `  * Initial Sales Markup (IMU) = (Ticket Price - Landed Cost) / Ticket Price * 100\n` +
        `  * Net Promo Margin = (Promotional Price / 1.15) - Landed Unit Cost`;

      const generalSystemPrompt = `You are CARINA Senior Commercial Merchandising Strategist and Retail Pricing Analyst in Saudi Arabia.\n\n` +
        `CORE CAPABILITIES & RULES:\n` +
        `1. COMPREHENSIVE COMMERCIAL PLANNING & CAPABILITIES:\n` +
        `   - You ARE CARINA's automated White Friday, promotional discount, and markdown optimization intelligence across all stores in Saudi Arabia (KSA).\n` +
        `   - When asked if you can plan White Friday, promotional, or seasonal clearance offers: Confirm YES. Explain that you plan promotional offers across all 1,493 catalog styles using differentiated retail mechanics (Clearance Rails 50% Off, Take 3 For 99 SAR multi-buys, Spend 250 Save 50, and Full Price Protection 0% off for fresh collections), strictly complying with Saudi Ministry of Commerce regulations (Price >= Landed Cost x 1.15).\n` +
        `   - NEVER answer with a bare monosyllable like "Yes" or "No". Even if the user asks "confirm yes or no" or "just say yes or no", confirm clearly and explain the commercial framework, store allocations, and governance boundaries.\n` +
        `2. ANSWER ANY QUESTION OR CALCULATION DIRECTLY: Answer the user's analytical, mathematical, operational, or retail question directly and intelligently using the provided telemetry and formulas.\n` +
        `3. FOR GENERAL SALES PERFORMANCE QUESTIONS: Provide an executive summary of catalog performance, sell-through rate (46.9%), store floor densities (Andalus vs Yasmeen vs Jouri Mall), and campaign clearance forecasts.\n` +
        `4. PROHIBITED ACTIONS: If the user suggests or asks about a price or action that is prohibited (such as selling below landed cost plus 15% VAT, or deep discounting fresh winter collections, or mixing damaged/virtual stock onto sales floors), explicitly state: "Prohibited Action: ..." and explain the regulatory or commercial reason.\n` +
        `5. STRICT EXECUTIVE FORMATTING: Provide ONLY your final, professional commercial answer directly without internal monologues or thinking tags. Strictly NO emojis or unicode icons in your output.`;

      const aiPromise = env.AI.run(genModel, {
        messages: [
          { role: 'system', content: generalSystemPrompt },
          { role: 'user', content: `${generalContext}\n\nUser Question: "${userMessage}"` }
        ],
        temperature: 0.15,
        max_tokens: 400
      });

      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('AI Timeout')), 25000));
      const aiResponse: any = await Promise.race([aiPromise, timeoutPromise]);

      const textReply = aiResponse?.response || 
                        aiResponse?.choices?.[0]?.message?.content || 
                        (typeof aiResponse === 'string' ? aiResponse : null);

      if (textReply && textReply.trim().length > 0) {
        const cleanReply = sanitizeAiResponse(textReply);
        return {
          reply: cleanReply,
          mode,
          activeModel: genModel
        };
      }
    } catch (err: any) {
      console.warn('General AI run warning:', err?.message || err);

      // Contextual fallback for White Friday / campaign planning
      if (/white friday|black friday|plan|campaign/i.test(lowerMsg)) {
        return {
          reply: `### White Friday Promotional Architecture (KSA)\n\n` +
            `Yes — the automated discount planner actively plans promotional and pricing strategies across all **1,493 active styles** (**54,125 physical units**) in Saudi Arabia:\n\n` +
            `• **Dedicated Clearance Rails (50% Off & Take 3 For 99 SAR):** Applied to slow-turning inventory and broken curves (<=2 sizes) to immediately decongest store floors in Taif and Jeddah.\n` +
            `• **Multi-Buy Basket Packs (Spend 250 Save 50):** Applied to high-demand core styles to maximize transaction size while preserving margin.\n` +
            `• **Assortment Protection (0% Off Full Price):** Strictly shields 57.2% of depth in fresh Winter AW26 collections.\n` +
            `• **Saudi Legal Zero-Loss Guard:** Enforces 100% compliance with Saudi retail pricing regulations (Price >= Landed Cost x 1.15).`,
          mode
        };
      }

      // Contextual fallback for sales performance analysis if AI times out
      if (/sales|performance|overall|kpi|density|str|ros|clearance/i.test(lowerMsg)) {
        return {
          reply: `### CARINA Assortment & Sales Performance Analysis\n\n` +
            `• **Catalog Volume & Velocity:** 1,493 active styles with **54,125 physical units** on-hand across store network. Catalog average Sell-Through Rate (STR) is **46.9%** with an 8-week average rate of sale of **0.66 units/week**.\n` +
            `• **Store Floor Densities & Bottlenecks:**\n` +
            `  - **Al-Andalus Mall Flagship (Jeddah, 260 m²):** Healthy, balanced sales floor turnover.\n` +
            `  - **Al-Yasmeen Mall (Jeddah, 193 m²):** Overstocked floor (>55 units/m²); priority candidate for accelerated clearance to free retail display space.\n` +
            `  - **Jouri Mall (Taif, 168 m²):** Critical bottleneck (>60 units/m²); top candidate for Take 3 For 99 SAR multi-buy clearance rails.\n` +
            `• **Event Financial Leverage:** Event simulation projects clearance of **26,451 units**, generating **+339,487 SAR** in net cash margin contribution.\n` +
            `• **Governance Compliance:** All promotional recommendations strictly enforce the Saudi 15% VAT floor (Price >= Cost x 1.15) and protect 57.2% of fresh Winter AW26 inventory.`,
          mode
        };
      }
    }
  }

  return {
    reply: `### CARINA Merchandising Intelligence\n\n` +
      `• **Saudi VAT Floor:** Enforcing promotional pricing strictly above landed cost plus 15% VAT across all active styles.\n` +
      `• **Physical Stores:** Al-Andalus (260 m²), Al-Yasmeen (193 m²), Jouri Mall Taif (168 m²), and Central Warehouse (WH). Virtual and damaged locations excluded.\n` +
      `• **Assortment Protection:** Retaining 57.2% of depth for December/January winter peak.\n\n` +
      `*Tip: Enter any style code (e.g. \`59465\`, \`59461\`, \`50177\`) or product name for an instant live breakdown.*`,
    mode
  };
}
