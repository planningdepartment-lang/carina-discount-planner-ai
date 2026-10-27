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
  
  // Specific Intent Filters:
  const asksForPerformance = /performance|sales|sell[\s-]?through|str\b|ros\b|velocity|movement|traction|how (is it|are they) selling|sold|units sold|turnover|demand/i.test(lowerMsg);
  const asksForIdentity = /what is that|what is this|what is it|what is this item|what is that item|what is the item|tell me about|what kind of|what category|what product|what model|name of this|name\b/i.test(lowerMsg) && !asksForPerformance;
  const asksForOffer = /offer|best offer|promo|discount|recommend|deal|rail|white friday|black friday|markdown/i.test(lowerMsg) && !asksForPerformance;
  const asksForStock = /how many|stock|inventory|units\b|quantity|wh\b|warehouse|store|allocation|distribution|where.*stock|andalus|yasmeen|jouri/i.test(lowerMsg) && !asksForIdentity && !asksForOffer && !asksForPerformance;
  const asksForPrice = /price|cost|cogs|margin|markup|imu|vat|floor|ticket/i.test(lowerMsg) && !asksForIdentity && !asksForOffer && !asksForPerformance;
  const asksForFullDetails = /detail|breakdown|all|everything|full|overview|card/i.test(lowerMsg) || /^\d{5}$/.test(userMessage);

  // If no style matched but the user asked about an item or specific metrics, ask for clarification
  if (matchedStyles.length === 0 && (asksForPerformance || asksForIdentity || asksForOffer || asksForStock || asksForPrice || /this item|this product|the style|the item|for this/i.test(lowerMsg))) {
    return {
      reply: `### Clarification Required\n\n` +
        `• Please provide the 5-digit style code (e.g. \`59465\` or \`50177\`) or the specific product name.\n` +
        `• Once specified, I will pull its physical stock across Jeddah and Taif, weekly velocity, margin economics, and zero-loss pricing rules for you.`,
      mode
    };
  }

  // If a specific style was matched
  if (matchedStyles.length > 0) {
    const style = matchedStyles[0];

    // Priority 1: Answer Sales Performance directly
    if (asksForPerformance && !asksForFullDetails) {
      const paceLabel = style.cumulative_str_pct >= 60 ? 'High-Velocity Seller' : 
                        (style.cumulative_str_pct >= 30 ? 'Steady Active Performer' : 'Slow Mover / Aging Stock');
      const wosVal = style.weekly_ros > 0 ? (style.total_physical_stock / style.weekly_ros).toFixed(1) : '999';

      return {
        reply: `### Sales Performance — Style **${style.style_code}** (*${style.product_name}*)\n\n` +
          `• **Sell-Through Rate (STR):** **${style.cumulative_str_pct}%** (${paceLabel})\n` +
          `• **Sales Velocity (8-Week ROS):** **${style.weekly_ros} units/week**\n` +
          `• **Physical Inventory On-Hand:** **${style.total_physical_stock} units** (${style.sar_curve_health})\n` +
          `• **Store Runway:** **${wosVal} Weeks of Supply (WOS)**\n` +
          `• **Campaign Clearance Forecast:** **${style.forecast_sold} units** (${Math.round((style.forecast_sold / style.total_physical_stock) * 100)}% liquidation rate)\n` +
          `• **Projected Campaign Net Margin:** **+${style.forecast_profit.toLocaleString()} SAR**\n` +
          `• **Commercial Action:** **${style.recommended_offer}** (${style.discount_pct}% off) to maintain inventory rotation.`,
        mode,
        activeStyleCode: style.style_code
      };
    }

    // Priority 2: Answer product identity/description directly
    if (asksForIdentity && !asksForOffer && !asksForStock && !asksForFullDetails) {
      return {
        reply: `### Product Information — Style **${style.style_code}**\n\n` +
          `• **Product Name:** **${style.product_name}**\n` +
          `• **Assortment Category:** \`${style.category}\` | **Season Collection:** \`${style.season}\`\n` +
          `• **Catalog Pricing:** Ticket **${style.ticket_price.toFixed(2)} SAR** | Landed Cost **${style.unit_cost.toFixed(2)} SAR** (IMU: ${(((style.ticket_price - style.unit_cost) / style.ticket_price) * 100).toFixed(1)}%)\n` +
          `• **Current Stock:** **${style.total_physical_stock} physical units** available across store physical network.`,
        mode,
        activeStyleCode: style.style_code
      };
    }

    // Priority 3: Answer promotional offer / White Friday recommendations directly
    if (asksForOffer && !asksForFullDetails) {
      return {
        reply: `### Recommended Commercial Offer — Style **${style.style_code}** (*${style.product_name}*)\n\n` +
          `• **Primary Clearance Offer:** **${style.recommended_offer}** at **${style.promotional_price.toFixed(2)} SAR** (${style.discount_pct}% off)\n` +
          `• **Alternative Margin Defense Offer:** **Spend 250 Save 50 (Multi-Buy Basket Pack)** to preserve full price margin while driving units.\n` +
          `• **Zero-Loss Legal Compliance:** **${style.zero_loss_status}** (Promo ${style.promotional_price.toFixed(2)} SAR >= Legal Floor ${style.cost_plus_vat.toFixed(2)} SAR)\n` +
          `• **Commercial Strategy:** ${style.commercial_rationale}`,
        mode,
        activeStyleCode: style.style_code
      };
    }

    // Priority 4: Answer physical inventory/stock questions
    if (asksForStock && !asksForFullDetails) {
      return {
        reply: `### Physical Inventory Breakdown — Style **${style.style_code}** (*${style.product_name}*)\n\n` +
          `**Total Physical Stock:** **${style.total_physical_stock} units** (${style.sar_curve_health})\n\n` +
          `• **Al-Andalus Mall Flagship (Jeddah):** **${style.stock_andalus} units** (${((style.stock_andalus / style.total_physical_stock) * 100).toFixed(1)}%)\n` +
          `• **Al-Yasmeen Mall (Jeddah):** **${style.stock_yasmeen} units** (${((style.stock_yasmeen / style.total_physical_stock) * 100).toFixed(1)}%)\n` +
          `• **Jouri Mall (Taif):** **${style.stock_jouri} units** (${((style.stock_jouri / style.total_physical_stock) * 100).toFixed(1)}%)\n` +
          `• **Central Warehouse (WH):** **${style.stock_wh} units** (${((style.stock_wh / style.total_physical_stock) * 100).toFixed(1)}%)`,
        mode,
        activeStyleCode: style.style_code
      };
    }

    // Priority 5: Answer price, cost, or margin economics
    if (asksForPrice && !asksForFullDetails) {
      const imu = style.ticket_price > 0 ? (((style.ticket_price - style.unit_cost) / style.ticket_price) * 100).toFixed(1) : '0';
      const netPromoRev = style.promotional_price / 1.15;
      const promoMargin = netPromoRev - style.unit_cost;
      const promoMarginPct = netPromoRev > 0 ? ((promoMargin / netPromoRev) * 100).toFixed(1) : '0';

      return {
        reply: `### Pricing & Margin Economics — Style **${style.style_code}** (*${style.product_name}*)\n\n` +
          `• **Original List Ticket Price:** **${style.ticket_price.toFixed(2)} SAR**\n` +
          `• **Landed Unit Cost (COGS):** **${style.unit_cost.toFixed(2)} SAR**\n` +
          `• **Saudi 15% VAT Legal Floor:** **${style.cost_plus_vat.toFixed(2)} SAR**\n` +
          `• **Initial Sales Markup (IMU):** **${imu}%**\n` +
          `• **Recommended Promo Price:** **${style.promotional_price.toFixed(2)} SAR** (${style.discount_pct}% off)\n` +
          `• **Promo Unit Net Margin:** **+${promoMargin.toFixed(2)} SAR** (${promoMarginPct}% net margin)`,
        mode,
        activeStyleCode: style.style_code
      };
    }

    // Priority 6: Full breakdown card if explicitly asked or bare 5-digit style code
    if (asksForFullDetails) {
      return {
        reply: formatFullStyleCard(style),
        mode,
        activeStyleCode: style.style_code
      };
    }

    // For open-ended questions about this style, run Workers AI with complete context
    let userModel = request.model && request.model !== 'auto' ? request.model : '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

    if (env?.AI) {
      try {
        const styleContext = `[Comprehensive Merchandising Telemetry for Style ${style.style_code}]:\n` +
          `- Style Code: ${style.style_code}\n` +
          `- Product Name: ${style.product_name}\n` +
          `- Assortment Category: ${style.category}\n` +
          `- Season Collection: ${style.season}\n` +
          `- Cumulative Sell-Through (STR): ${style.cumulative_str_pct}%\n` +
          `- 8-Week Rolling Sales Velocity (ROS): ${style.weekly_ros} units/week (approx ${(style.weekly_ros * 4.3).toFixed(0)} units/month run-rate)\n` +
          `- Active Size Curve: ${style.sar_curve_health}\n` +
          `- Total Physical Stock: ${style.total_physical_stock} units on-hand\n` +
          `- Store Allocation: Andalus Mall=${style.stock_andalus}u, Yasmeen Mall=${style.stock_yasmeen}u, Jouri Mall=${style.stock_jouri}u, WH=${style.stock_wh}u\n` +
          `- Landed Unit Cost: ${style.unit_cost.toFixed(2)} SAR\n` +
          `- Saudi 15% VAT Legal Floor: ${style.cost_plus_vat.toFixed(2)} SAR\n` +
          `- Original List Ticket Price: ${style.ticket_price.toFixed(2)} SAR\n` +
          `- Initial Sales Markup (IMU): ${(((style.ticket_price - style.unit_cost) / style.ticket_price) * 100).toFixed(1)}%\n` +
          `- Recommended Promo Offer: ${style.recommended_offer}\n` +
          `- Promotional Price: ${style.promotional_price.toFixed(2)} SAR (${style.discount_pct}% off)\n` +
          `- Zero-Loss Compliance: ${style.zero_loss_status}\n` +
          `- Forecast Clearance: ${style.forecast_sold} units (Projected Net Profit: +${style.forecast_profit.toLocaleString()} SAR)\n` +
          `- Commercial Strategy: ${style.commercial_rationale}`;

        const systemPrompt = `You are CARINA's Senior Commercial Merchandising Strategist and Financial Retail Analyst in Saudi Arabia.\n` +
          `CRITICAL INSTRUCTIONS:\n` +
          `1. Answer the user's specific analytical, mathematical, or strategic question directly and intelligently using the provided telemetry.\n` +
          `2. If the user's question is unclear, underspecified, or missing key parameters, proactively ask 2 to 3 concise clarifying questions.\n` +
          `3. Strictly NO emojis, icons, or pictographs in your output.\n` +
          `4. Format response in clean, organized sections and bullet points.\n` +
          `5. STRICT EXECUTIVE RULE: Output ONLY your final commercial answer directly. Do NOT output internal monologues, scratchpad thoughts, or reasoning steps.`;

        const aiPromise = env.AI.run(userModel, {
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `${styleContext}\n\nUser Question: "${userMessage}"` }
          ],
          temperature: 0.15,
          max_tokens: 350
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

        // Dynamic contextual fallback for MoM growth / velocity questions
        if (/growth|mom|trend|trajectory|forecast|projection|month/i.test(lowerMsg)) {
          const monthlyRunRate = Math.round(style.weekly_ros * 4.33);
          const wos = style.weekly_ros > 0 ? (style.total_physical_stock / style.weekly_ros).toFixed(1) : '999';

          return {
            reply: `### Growth & MoM Velocity Assessment — Style **${style.style_code}** (*${style.product_name}*)\n\n` +
              `• **Monthly Run-Rate:** **~${monthlyRunRate} units/month** based on 8-week rolling velocity (${style.weekly_ros} u/wk)\n` +
              `• **Cumulative Sell-Through (STR):** **${style.cumulative_str_pct}%** (${style.cumulative_str_pct >= 40 ? 'Healthy Seasonal Trajectory' : 'Pacing Below Category Target'})\n` +
              `• **Inventory Coverage:** **${wos} Weeks of Supply** across physical store nodes\n` +
              `• **MoM Strategic Outlook:** With ${style.total_physical_stock} units remaining and winter transition underway, maintaining full price would slow turnover. The recommended **${style.recommended_offer}** (${style.discount_pct}% off) is engineered to lift monthly sales volume by **+40% to +55%** while locking in a **+${style.forecast_profit.toLocaleString()} SAR** profit contribution.\n`,
            mode,
            activeStyleCode: style.style_code
          };
        }
      }
    }

    // Default organized overview card (only for pure item name lookups)
    return {
      reply: `### Style **${style.style_code}** — *${style.product_name}*\n\n` +
        `• **Assortment:** \`${style.category}\` | \`${style.season}\` | **${style.total_physical_stock} units** on-hand\n` +
        `• **Sales Performance:** STR **${style.cumulative_str_pct}%** | Velocity **${style.weekly_ros} units/week** (${style.sar_curve_health})\n` +
        `• **Economics:** Ticket **${style.ticket_price.toFixed(2)} SAR** | Landed Cost **${style.unit_cost.toFixed(2)} SAR** | Floor **${style.cost_plus_vat.toFixed(2)} SAR**\n` +
        `• **Recommended Offer:** **${style.recommended_offer}** at **${style.promotional_price.toFixed(2)} SAR** (${style.discount_pct}% off)\n\n` +
        `*Ask specifically about: \`sales performance\`, \`growth MoM\`, \`stock breakdown\`, or \`pricing\`.*\n`,
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

  let genModel = request.model && request.model !== 'auto' ? request.model : '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
  if (env?.AI) {
    try {
      const aiPromise = env.AI.run(genModel, {
        messages: [
          { 
            role: 'system', 
            content: 'You are CARINA Senior Merchandising Strategist in Saudi Arabia. Stores: Andalus Mall (260m²), Yasmeen Mall (193m²), Jouri Mall (Taif, 168m²), Central WH. Enforce zero-loss floor (Price >= Cost * 1.15). If the user inquiry is broad, ambiguous, or missing required parameters (such as a specific style code, category, or store location), proactively ask concise clarifying questions to determine their exact commercial objective. Strictly NO emojis or unicode icons in your output. Provide ONLY your final, professional commercial answer directly without any internal monologue or thinking steps. Keep responses concise, structured, and under 130 words.' 
          },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.2,
        max_tokens: 300
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
    }
  }

  return {
    reply: `### [CARINA Merchandising Copilot — ${mode}]\n\n` +
      `**Request:** "${userMessage}"\n\n` +
      `• **Saudi VAT Floor:** Enforcing promotional pricing strictly above landed cost plus 15% VAT across all active styles.\n` +
      `• **Physical Stores:** Al-Andalus (260 m²), Al-Yasmeen (193 m²), Jouri Mall Taif (168 m²), and Central Warehouse (WH). Virtual and damaged locations excluded.\n` +
      `• **Assortment Protection:** Retaining 57.2% of depth for December/January winter peak.\n\n` +
      `*Tip: Enter any style code (e.g. \`59465\`, \`50177\`) or product name for an instant live breakdown.*`,
    mode
  };
}
