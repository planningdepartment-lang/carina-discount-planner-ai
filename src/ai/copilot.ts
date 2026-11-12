import { KSA_RETAIL_CONTEXT } from './skills/ksaRetailContext';
import { KSA_CRISIS_RETAIL_CONTEXT } from './skills/crisisRetailContext';
import { 
  formatOfferDecisionCard, 
  formatDynamicCategoryOfferDossier,
  formatAlternativeOffersCard,
  formatSlowMoversIntelligenceCard,
  SlowMoversSummary
} from './skills/offerDecisionFormatter';
import { generateDynamicCategoryOfferPlan, CategoryTelemetry } from '../engine/dynamicCategoryOfferEngine';
import { 
  generateAlternativeOfferScenarios,
  DynamicOfferMetrics 
} from '../engine/dynamicOfferEngine';
import { COMPETITOR_PLAYBOOK } from './skills/competitorPlaybook';
import { parseNaturalLanguageRule } from './skills/ruleParser';
import { StyleMetrics } from '../engine/lifecycleClassifier';
import { runWhatIfSimulation } from '../engine/simulator';
import { getOrComputeStylePlan } from '../api/styleService';
import { 
  analyzeCompetitorPosition, 
  getCompetitorIntelligenceSummary, 
  KSA_COMPETITOR_BENCHMARKS 
} from '../engine/competitorAnalyzer';
import { ForecastScenario } from '../engine/statisticalForecaster';
import { formatCurveHealthLabel, evaluateSpeedAndHeroQualification } from '../engine/metricsCalculator';
import { CAMPAIGN_MODE_LABELS, CampaignMode } from '../config/constants';
import { generatePortfolioRebalancingPlan } from '../engine/storeRebalancer';
import { KSA_RETAIL_CALENDAR } from '../engine/ksaRetailCalendar';
import { checkAnswerable, isAnalyticalDataQuery, retrieveOntologyContext } from './ontology/semanticRetriever';
import { runOntologyAnalyticalQuery } from './ontology/analyticalRunner';

export type AgentMode = 'DISCOUNT_STRATEGIST' | 'STORE_AUDITOR' | 'RULE_COMPILER';

export interface CopilotChatHistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface CopilotChatRequest {
  message: string;
  mode?: AgentMode;
  model?: string;
  contextStyleCode?: string;
  metricsSnapshot?: Partial<StyleMetrics>;
  allowUnguidedMetrics?: boolean;
  history?: CopilotChatHistoryTurn[];
}

export interface CopilotChatResponse {
  reply: string;
  mode: AgentMode;
  activeStyleCode?: string;
  activeStyleName?: string;
  suggestedRule?: any;
  activeModel?: string;
}

function sanitizeChatHistory(history?: CopilotChatHistoryTurn[]): CopilotChatHistoryTurn[] {
  if (!Array.isArray(history) || history.length === 0) return [];
  return history
    .filter((t) => t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string' && t.content.trim().length > 0)
    .slice(-4)
    .map((t) => ({
      role: t.role,
      content: t.content
        .replace(/\|[^\n]+\|\n?/g, '') // Strip bulky markdown table rows from prior turns to keep prompt lean
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, 450)
    }))
    .filter((t) => t.content.length > 0);
}

function normalizeCopilotMessageLower(userMessage: string): string {
  return userMessage
    .toLowerCase()
    .replace(/\b(?:antoher|anothr|anothe|anoter|anthor)\b/g, 'another')
    .replace(/\b(?:reccomend|recomend|recommand)\b/g, 'recommend')
    .replace(/\b(?:dscount|disocunt)\b/g, 'discount')
    .replace(/\bofers\b/g, 'offers')
    .replace(/\bofer\b/g, 'offer')
    .replace(/\b(slow\s+)of(\s+(?:med|medium|fast))\b/g, '$1or$2');
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
  sold_units?: number;
  sales_lifecycle_weeks?: number;
  lifecycle_tier?: string;
  store_floor_wos?: number;
  active_size_count?: number;
  has_core_sizes?: number | boolean;
  is_single_size?: number | boolean;
  is_manual_override?: number | boolean;
  size_breakdown_json?: string;
  first_move_date?: string;
  weekly_ros_2wk?: number;
  momentum_ratio?: number;
}

export function styleRecordToSnapshotRow(r: any): D1StyleSnapshotRow {
  const m = r.metrics;
  const rec = r.recommendation;
  const costPlusVat = m.unitCost * 1.15;
  const forecastSold = Math.round(m.totalPhysicalStock * ((rec?.expectedClearancePct || 40) / 100));
  const postStock = Math.max(0, m.totalPhysicalStock - forecastSold);
  const promoPrice = rec?.promotionalPriceSAR || m.ticketPrice;
  const netRev = (forecastSold * promoPrice) / 1.15;
  const forecastProfit = Math.round(netRev - (forecastSold * m.unitCost));
  const curveLabel = formatCurveHealthLabel(m);

  return {
    style_code: m.styleCode,
    product_name: m.productName,
    category: m.category || 'General',
    season: m.season || 'Continuity',
    total_physical_stock: m.totalPhysicalStock,
    stock_andalus: m.stockAndalus,
    stock_yasmeen: m.stockYasmeen,
    stock_jouri: m.stockJouri,
    stock_wh: m.stockWH,
    cumulative_str_pct: m.cumulativeSTR,
    weekly_ros: m.weeklyROS,
    sar_curve_health: curveLabel,
    unit_cost: m.unitCost,
    cost_plus_vat: costPlusVat,
    ticket_price: m.ticketPrice,
    recommended_offer: rec?.recommendedOffer || 'Full Price Margin Protection (0% Off)',
    promotional_price: promoPrice,
    discount_pct: rec?.discountPct || 0,
    zero_loss_status: rec?.zeroLossStatus || 'ZERO_LOSS_COMPLIANT',
    forecast_sold: forecastSold,
    forecast_profit: forecastProfit,
    post_event_stock: postStock,
    commercial_rationale: rec?.rationale || 'Assortment depth defense.',
    sold_units: m.soldUnits !== undefined ? m.soldUnits : 0,
    sales_lifecycle_weeks: m.salesLifecycleWeeks !== undefined ? m.salesLifecycleWeeks : 0.0,
    lifecycle_tier: rec?.tier,
    store_floor_wos: m.storeFloorWOS,
    active_size_count: m.activeSizeCount,
    has_core_sizes: m.hasCoreSizes ? 1 : 0,
    is_single_size: m.isSingleSize ? 1 : 0,
    size_breakdown_json: m.sizeBreakdown ? JSON.stringify(m.sizeBreakdown) : '{}',
    first_move_date: m.firstMoveDate,
    weekly_ros_2wk: m.weeklyROS2wk ?? m.weeklyROS,
    momentum_ratio: m.momentumRatio ?? 1.0
  };
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

  const lowerMsg = normalizeCopilotMessageLower(userMessage);

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

      // Resilient fallback from live style plan
      const records = await getOrComputeStylePlan(db);
      const match = records.find(r => r.metrics.styleCode === code);
      if (match) return [styleRecordToSnapshotRow(match)];
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
      'hello', 'hi', 'hey', 'thanks', 'thank',
      'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being', 'do', 'did', 'has', 'had',
      'in', 'on', 'at', 'to', 'of', 'by', 'as', 'into', 'like', 'through', 'over', 'out',
      'before', 'after', 'styles', 'items', 'high', 'low', 'demand', 'demands', 'size', 'sizes',
      'slow', 'fast', 'move', 'moves', 'moving', 'end', 'ends', 'ending', 'season', 'seasons',
      'mature', 'fresh', 'continuity', 'unit', 'units', 'average', 'total', 'rate', 'rates',
      'curve', 'curves', 'oddment', 'oddments', 'rank', 'ranking', 'level', 'levels', 'status', 'list',
      'identify', 'identifying', 'movers', 'mover', 'recommend', 'recommends', 'recommendation', 'recommendations',
      'full', 'margin', 'protection', 'protected', 'cost', 'cogs', 'floor', 'vat', 'imu', 'ticket', 'tier',
      'bundle', 'bundles', 'clearance', 'explain', 'reason', 'behind', 'clarify', 'justify', 'rationale',
      'another', 'other', 'alternative', 'alternatives', 'options', 'option', 'offers', 'would', 'should',
      'could', 'different', 'instead', 'transfer', 'transfers', 'branch', 'branches', 'between', 'need', 'needs'
    ]);

    const words = lowerMsg
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3 && !stopWords.has(w));

    // Do not hijack multi-style analytical/slicing queries into a single-product LIKE match,
    // while still allowing Step 3 contextual resolution when contextStyleCode is active.
    const skipKeywordLikeSearch = isAnalyticalDataQuery(userMessage);

    // If product candidate words were found in current message, search D1 FIRST!
    if (!skipKeywordLikeSearch && words.length > 0) {
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

      // Step C: Contiguous phrase match (requires at least 2 words)
      if (coreWords.length > 1) {
        const phrase = `%${coreWords.join('%')}%`;
        const { results: phraseResults } = await db
          .prepare('SELECT * FROM style_plan_snapshots WHERE product_name LIKE ? ORDER BY total_physical_stock DESC LIMIT 1')
          .bind(phrase)
          .all<D1StyleSnapshotRow>();
        if (phraseResults && phraseResults.length > 0) return phraseResults;
      }

      // Step D: Individual specific words (ONLY when the user query is very short <= 2 words, e.g. "blazer" or "cardigan")
      // Never match an isolated word out of a multi-word analytical question!
      const isShortQuery = userMessage.trim().split(/\s+/).length <= 2;
      if (isShortQuery) {
        const genericSingleWords = new Set([
          'perfume', 'splash', 'cotton', 'basic', 'shirt', 'dress', 'pants', 'skirt', 'top', 'bottom',
          'neck', 'sleeve', 'sleeveless', 'high', 'low', 'long', 'short', 'blue', 'black', 'white',
          'gray', 'grey', 'pink', 'rose', 'red', 'green', 'yellow', 'gold', 'silver', 'dark', 'light',
          'pure', 'soft', 'cool', 'warm', 'wild', 'open', 'back', 'side', 'front', 'item', 'style', 'model'
        ]);
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
    }

    // 3. Contextual Resolution: If user has an active style in focus (contextStyleCode):
    // Prioritize the focused item unless the user query is an explicit macro catalog inquiry,
    // a database/architecture inquiry, a scenario simulation, or a business rule compiler command.
    const isExplicitMacroQuery = /\b(entire catalog|all catalog|overall catalog|catalog wide|catalog-wide|whole catalog|catalog total|catalog average|catalog summary|catalog performance|catalog sales|all styles|across all styles|all products|across all products|entire store network|network total|all stores total|network density|store densities|all store densities|overall performance|macro|total units in catalog|all items in catalog)\b/i.test(lowerMsg);
    const isDataSourceQuery = /\b(data source|data-source|source of data|where is.*data|where does.*data come from|d1 schema|database table|odoo_stock_move_line|move line)\b/i.test(lowerMsg);
    const isSimulationQuery = /\b(what if.*(?:liquidat|clear|units?|margin|target|sales?)|simulate.*(?:liquidat|clear|units?|margin|scenario)|run.*simulation|what happens if we (?:liquidat|clear))\b/i.test(lowerMsg);
    const isRuleQuery = /\b(rule|policy|governance)\b/i.test(lowerMsg) && /\b(cap|exclude|floor|discount|enforce)\b/i.test(lowerMsg);
    const isSlowMoverQuery = /\b(slow\s*movers?|slow\s*moving|dead\s*stock|stagnant|zombie\s*stock|aged\s*stock|aged\s*inventory|identify\s*slow|how.*identify.*slow|recommend.*slow|what.*ai.*recommend.*slow)\b/i.test(lowerMsg);

    if (!isExplicitMacroQuery && !isDataSourceQuery && !isSimulationQuery && !isRuleQuery && !isSlowMoverQuery && contextStyleCode && /^\d{5}$/.test(contextStyleCode)) {
      const { results } = await db
        .prepare('SELECT * FROM style_plan_snapshots WHERE style_code = ? LIMIT 1')
        .bind(contextStyleCode)
        .all<D1StyleSnapshotRow>();
      if (results && results.length > 0) return results;

      // Resilient fallback from live style plan
      const records = await getOrComputeStylePlan(db);
      const match = records.find(r => r.metrics.styleCode === contextStyleCode);
      if (match) return [styleRecordToSnapshotRow(match)];
    }
  } catch (err) {
    console.error('Error querying D1 for copilot context:', err);
  }

  return [];
}

/**
 * Formatters for targeted style property requests (Stock, Pricing, Velocity, Offer).
 * Guarantees zero data overexposure and zero token waste when answering specific questions.
 */
/**
 * Formats autonomous KSA competitor intelligence summary for Nayomi & Blooming.
 */
function formatCompetitorIntelligenceCard(): string {
  const summary = getCompetitorIntelligenceSummary();
  let text = '### KSA Competitor Intelligence — Autonomous Benchmarks\n\n' +
    'Real-time retail price positioning and active promotional offers across Saudi Arabia (Jeddah & Taif):\n\n' +
    '• **Direct Competitors Monitored:** **Nayomi (نعومي)** & **Blooming (بلومنج)**\n' +
    '• **Category Price Positioning & Market Dynamics:**\n';

  for (const s of summary) {
    text += `  - **${s.category}:**\n` +
      `    * **Nayomi:** ${s.nayomi.regularTicketSAR.toFixed(2)} SAR ticket | Active Promo: **${s.nayomi.promotionalOffer}** (${s.nayomi.effectivePromoPriceSAR.toFixed(2)} SAR/u, ${s.nayomi.impliedDiscountPct}% off)\n` +
      `    * **Blooming:** ${s.blooming.regularTicketSAR.toFixed(2)} SAR ticket | Active Promo: **${s.blooming.promotionalOffer}** (${s.blooming.effectivePromoPriceSAR.toFixed(2)} SAR/u, ${s.blooming.impliedDiscountPct}% off)\n`;
  }

  text += '\n• **Autonomous Competitor Demand Feedback:**\n' +
    '  - When CARINA prices are higher than Nayomi or Blooming (Price Index > 108), the AI automatically applies an 18% substitution drag to prevent overly optimistic sales forecasts.\n' +
    '  - When CARINA holds a value advantage (Price Index < 88), a 12% volume capture boost is applied.\n' +
    '• **Tactical Counter Recommendations:**\n' +
    '  - **Pyjamas:** Deploy CARINA Dynamic Bundle 2 starting at 149 SAR (elevated to charm floor when cost demands, e.g. 189 SAR for 3PC sets) strictly defending gross margin above Saudi VAT zero-loss floor.\n' +
    '  - **Bras:** Deploy 2 for 99 SAR to achieve direct parity with Blooming and defeat Nayomi (74.50 SAR/u).\n' +
    '  - **Socks & Hosiery:** Deploy Impulse Multipacks (3 for 15 SAR / 5.00 SAR/u) at POS checkout counters to capture footfall against Blooming (5.00 SAR/u).\n' +
    '  - **Cosmetics:** Protect 0% off single unit margin, using Spend 250 Save 50 multi-buys as basket boosters.';

  return text;
}

function formatStyleCompetitorCard(row: D1StyleSnapshotRow): string {
  const comp = analyzeCompetitorPosition(
    row.category,
    row.product_name,
    row.ticket_price,
    row.promotional_price,
    row.unit_cost
  );

  return (
    `### Competitor Analysis — Style **${row.style_code}** (*${row.product_name}*)\n\n` +
    `• **Assortment Category:** \`${row.category || 'General'}\` | CARINA Promo Price: **${row.promotional_price.toFixed(2)} SAR**\n` +
    `• **Saudi Market Price Index (PI):**\n` +
    `  - **vs Nayomi (نعومي):** **${comp.priceIndexVsNayomi.toFixed(1)}%** (${comp.priceIndexVsNayomi < 100 ? 'CARINA Value Advantage' : 'Nayomi Cheaper'})\n` +
    `    * Nayomi Offer: ${comp.nayomiBenchmark.promotionalOffer} (${comp.nayomiBenchmark.effectivePromoPriceSAR.toFixed(2)} SAR/u)\n` +
    `  - **vs Blooming (بلومنج):** **${comp.priceIndexVsBlooming.toFixed(1)}%** (${comp.priceIndexVsBlooming < 100 ? 'CARINA Value Advantage' : 'Blooming Cheaper'})\n` +
    `    * Blooming Offer: ${comp.bloomingBenchmark.promotionalOffer} (${comp.bloomingBenchmark.effectivePromoPriceSAR.toFixed(2)} SAR/u)\n` +
    `• **Competitive Posture:** **${comp.competitivePosture}** (Blended Market Index: ${comp.blendedMarketPriceIndex.toFixed(1)}%)\n` +
    `• **Demand Calibration:** Competitor Substitution Drag: **${comp.competitorDemandDrag.toFixed(2)}x** on statistical sales volume\n` +
    `• **Tactical Counter Offer:** **${comp.tacticalCounterOffer}**\n` +
    `• **Commercial Rationale:** ${comp.tacticalRationale}`
  );
}

function formatCapabilitiesCard(): string {
  return (
    '### CARINA Merchandising Intelligence — Autonomous Capabilities\n\n' +
    'I am your autonomous Commercial Merchandising Strategist and Retail Pricing Intelligence for Saudi Arabia. Here is what I can do:\n\n' +
    '• **1. Statistical Demand Forecasting & Horizon Control:**\n' +
    '  - User-controlled promotional horizon (1 to 8 weeks, e.g., *"simulate a 3-week promotion"*).\n' +
    '  - Empirical Log-Log price elasticity models, baseline velocity tracking, and broken size walkout penalties (45% degradation when sizes <= 2).\n' +
    '  - Three statistical confidence scenarios: **Conservative (P10)**, **Expected Base (P50)**, and **Optimistic (P90)**.\n\n' +
    '• **2. Autonomous KSA Competitor Intelligence (Nayomi & Blooming):**\n' +
    '  - Real-time price indexing against **Nayomi (نعومي)** and **Blooming (بلومنج)** across all 8 catalog departments (Nightwear, Bras, Panties, Shapewear, Socks, Basics, Accessories, and Cosmetics).\n' +
    '  - Automatic competitor substitution drag (dampening overly optimistic sales when competitor prices are lower).\n' +
    '  - Tactical counter-offer generation (e.g. Dynamic Bundle 2 vs Nayomi Buy 2 Get 1).\n\n' +
    '• **3. Differentiated Promotional Architecture:**\n' +
    '  - **Dynamic Bundle 2:** Tailored 2-pack bundles driving 2.0 Units Per Transaction (UPT).\n' +
    '  - **Dedicated Clearance Rails:** 50% Off and Take 3 For 99 SAR rails for fragmented broken oddments.\n' +
    '  - **Assortment Shield:** Strict 0% Off full ticket margin protection for fresh Winter AW26 and hero bestsellers.\n\n' +
    '• **4. Store Floor Space Physics (621 m² Footprint):**\n' +
    '  - Real-time density monitoring and bottleneck diagnostics for Al-Andalus Flagship (260 m²), Al-Yasmeen (193 m²), and Jouri Mall Taif (168 m²).\n\n' +
    '• **5. Saudi Regulatory Zero-Loss Compliance:**\n' +
    '  - Enforcing the mandatory 15% VAT legal floor (Promotional Price >= Landed Cost x 1.15) with zero exceptions.\n\n' +
    '*Tip: Ask about any style code (e.g. 58424, 59465), compare with competitors (e.g. "compare pyjamas with Nayomi"), or run a what-if simulation (e.g. "simulate 2 weeks promotion with 50% margin").*'
  );
}

function formatStockCard(row: D1StyleSnapshotRow): string {
  const total = row.total_physical_stock || 1;
  const andalusPct = ((row.stock_andalus / total) * 100).toFixed(1);
  const yasmeenPct = ((row.stock_yasmeen / total) * 100).toFixed(1);
  const jouriPct = ((row.stock_jouri / total) * 100).toFixed(1);
  const whPct = ((row.stock_wh / total) * 100).toFixed(1);

  return (
    `### Stock & Store Distribution — Style **${row.style_code}** (*${row.product_name}*)\n` +
    `• **Category / Season:** \`${row.category || 'General'}\` | \`${row.season || 'Continuity'}\`\n` +
    `• **Total Physical Inventory:** **${row.total_physical_stock.toLocaleString()} units** on-hand\n` +
    `• **Store Network Allocation:**\n` +
    `  - **Al-Andalus Mall Flagship (Jeddah):** ${row.stock_andalus} units (${andalusPct}%)\n` +
    `  - **Al-Yasmeen Mall (Jeddah):** ${row.stock_yasmeen} units (${yasmeenPct}%)\n` +
    `  - **Jouri Mall (Taif):** ${row.stock_jouri} units (${jouriPct}%)\n` +
    `  - **Central Warehouse (WH):** ${row.stock_wh} units (${whPct}%)\n` +
    `• **Active Size Curve Status:** ${row.sar_curve_health}`
  );
}

function formatPricingCard(row: D1StyleSnapshotRow): string {
  const imuVal = row.ticket_price > 0 ? (((row.ticket_price - row.unit_cost) / row.ticket_price) * 100).toFixed(1) : '0';
  const promoRev = row.promotional_price / 1.15;
  const promoNetMargin = (promoRev - row.unit_cost).toFixed(2);
  const promoMarginPct = promoRev > 0 ? (((promoRev - row.unit_cost) / promoRev) * 100).toFixed(1) : '0';

  return (
    `### Pricing & Margin Economics — Style **${row.style_code}** (*${row.product_name}*)\n` +
    `• **Original List Ticket Price:** **${row.ticket_price.toFixed(2)} SAR**\n` +
    `• **Landed Unit Cost (COGS):** **${row.unit_cost.toFixed(2)} SAR**\n` +
    `• **Saudi 15% VAT Legal Floor:** **${row.cost_plus_vat.toFixed(2)} SAR** (Formula: Landed Cost x 1.15)\n` +
    `• **Initial Sales Markup (IMU):** **${imuVal}%** (Formula: (Ticket - Cost) / Ticket)\n` +
    `• **Recommended Promo Price:** **${row.promotional_price.toFixed(2)} SAR** (${row.discount_pct}% discount)\n` +
    `• **Unit Net Margin Contribution:** **+${promoNetMargin} SAR/unit** (${promoMarginPct}% net margin)\n` +
    `• **Zero-Loss Compliance:** **${row.zero_loss_status}** (Promo Price >= Legal Floor)`
  );
}

function formatVelocityCard(row: D1StyleSnapshotRow): string {
  const wosVal = row.weekly_ros > 0 ? (row.total_physical_stock / row.weekly_ros).toFixed(1) : '999';
  const monthsVal = (Number(wosVal) / 4.33).toFixed(1);

  return (
    `### Sales Performance & Runway — Style **${row.style_code}** (*${row.product_name}*)\n` +
    `• **Cumulative Sell-Through (STR):** **${row.cumulative_str_pct}%**\n` +
    `• **8-Week Rolling Sales Velocity (ROS):** **${row.weekly_ros} units/week**\n` +
    `• **Store Runway (Weeks of Supply / WOS):** **${wosVal} weeks** (~${monthsVal} months)\n` +
    `• **Runway Arithmetic:** ${row.total_physical_stock} units / ${row.weekly_ros} u/wk = ${wosVal} WOS\n` +
    `• **Size Curve Health:** ${row.sar_curve_health}`
  );
}

async function raceWithTimeout<T>(work: Promise<T>, timeoutMs: number = 25000): Promise<T> {
  let timerId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => reject(new Error('AI Timeout')), timeoutMs);
  });
  try {
    return await Promise.race([work, timeoutPromise]);
  } finally {
    if (timerId !== undefined) clearTimeout(timerId);
  }
}

function parseSizeBreakdownText(jsonStr?: string): string {
  if (!jsonStr) return 'Live breakdown not cached';
  try {
    const obj = JSON.parse(jsonStr);
    if (!obj || typeof obj !== 'object') return 'Live breakdown not cached';
    const order = ['XXS', 'XS', 'S', 'SM', 'M', 'L', 'LXL', 'XL', '2XL', '3XL', '4XL', 'OS', 'FREE'];
    const entries = Object.entries(obj)
      .filter(([, q]) => Number(q) > 0)
      .sort(([a], [b]) => {
        const ia = order.indexOf(a.toUpperCase());
        const ib = order.indexOf(b.toUpperCase());
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        return a.localeCompare(b);
      });
    if (entries.length === 0) return '0 active sizes with stock';
    return entries.map(([s, q]) => `${s}: ${q}u`).join(', ');
  } catch {
    return 'Live breakdown unavailable';
  }
}

function computeStyleFloorRunway(row: D1StyleSnapshotRow) {
  const storeUnits = (Number(row.stock_andalus) || 0) + (Number(row.stock_yasmeen) || 0) + (Number(row.stock_jouri) || 0);
  const ros = Number(row.weekly_ros) || 0;
  const derivedFloorWos = ros > 0 ? Math.round((storeUnits / ros) * 10) / 10 : 999;
  const storeFloorWos = (row.store_floor_wos !== undefined && row.store_floor_wos !== null && !Number.isNaN(Number(row.store_floor_wos)))
    ? Number(row.store_floor_wos)
    : derivedFloorWos;
  const networkWos = ros > 0 ? Math.round((Number(row.total_physical_stock || 0) / ros) * 10) / 10 : 999;
  return { storeUnits, ros, storeFloorWos, networkWos };
}

function formatOfferCard(row: D1StyleSnapshotRow, isExploratory: boolean = false): string {
  const { storeFloorWos } = computeStyleFloorRunway(row);
  return formatOfferDecisionCard({
    styleCode: row.style_code,
    productName: row.product_name,
    category: row.category,
    season: row.season,
    ticketPrice: row.ticket_price,
    unitCost: row.unit_cost,
    costPlusVat: row.cost_plus_vat,
    recommendedPrice: row.promotional_price,
    discountPct: row.discount_pct,
    recommendedOffer: row.recommended_offer,
    totalStock: row.total_physical_stock,
    storeStock: {
      andalus: row.stock_andalus,
      yasmeen: row.stock_yasmeen,
      jouri: row.stock_jouri,
      wh: row.stock_wh
    },
    weeklyROS: row.weekly_ros,
    storeFloorWOS: storeFloorWos,
    sarHealth: row.sar_curve_health,
    forecastSold: row.forecast_sold,
    forecastProfit: row.forecast_profit,
    rationale: row.commercial_rationale,
    isExploratory
  });
}

/**
 * Formats full style profile card (stock, velocity, and pricing economics).
 * Strictly omits promotional offers unless promotional recommendations are explicitly requested.
 */
function formatSimulationCard(res: any, targetUnits: number, marginFloor: number): string {
  const isHealthy = res.realizedNetMarginPct >= marginFloor;
  const statusBadge = isHealthy ? 'HEALTHY_MARGIN_COMPLIANT' : 'MARGIN_DILUTION_WARNING';
  const weeks = res.promotionWeeks || 4;
  const scenarioLabel = (res.scenario || 'base').toUpperCase();

  let advice = '';
  if (res.unitsSold >= 25000) {
    advice = `Liquidating ${res.unitsSold.toLocaleString()} units over ${weeks} weeks successfully decongests Taif Jouri to ${res.postEventDensities.jouriDensity.toFixed(1)} u/m², yielding +${Math.round(res.projectedNetProfit).toLocaleString()} SAR net cash margin.`;
  } else {
    advice = `Statistical liquidation over ${weeks} weeks protects ${res.retainedWinterPct.toFixed(1)}% of core assortment depth while generating +${Math.round(res.projectedNetProfit).toLocaleString()} SAR net cash margin.`;
  }

  return (
    `### Statistical Inventory & Promotional Simulation\n\n` +
    `• **Simulation Parameters:** Horizon: **${weeks} Weeks** | Scenario: **${scenarioLabel}** | Net Margin Floor: **${marginFloor.toFixed(1)}%**` + (targetUnits > 0 ? ` | Target: **${targetUnits.toLocaleString()} u**` : '') + `\n` +
    `• **Liquidation Volume:** **${res.unitsSold.toLocaleString()} units** cleared (${res.clearanceSharePct.toFixed(1)}% clearance rate)\n` +
    `• **Financial Impact (Net Cash Recovery):**\n` +
    `  - **Projected Gross Revenue:** ${Math.round(res.projectedGrossRevenue).toLocaleString()} SAR\n` +
    `  - **Projected Net Revenue (Ex-VAT):** ${Math.round(res.projectedNetRevenue).toLocaleString()} SAR\n` +
    `  - **Total Cost of Goods Sold (COGS):** ${Math.round(res.projectedCOGS).toLocaleString()} SAR\n` +
    `  - **Projected Net Cash Margin Contribution:** **+${Math.round(res.projectedNetProfit).toLocaleString()} SAR**\n` +
    `  - **Realized Portfolio Net Margin:** **${res.realizedNetMarginPct.toFixed(1)}%** [${statusBadge}]\n` +
    `• **Post-Event Store Rack Densities (621 m² Footprint):**\n` +
    `  - **Al-Andalus Mall Flagship (Jeddah, 260 m²):** **${res.postEventDensities.andalusDensity.toFixed(1)} u/m²** (Balanced)\n` +
    `  - **Al-Yasmeen Mall (Jeddah, 193 m²):** **${res.postEventDensities.yasmeenDensity.toFixed(1)} u/m²** (Relieved)\n` +
    `  - **Jouri Mall (Taif, 168 m²):** **${res.postEventDensities.jouriDensity.toFixed(1)} u/m²** (${res.jouriStatus})\n` +
    `• **Winter Assortment Shield:** **${res.retainedWinterUnits.toLocaleString()} units** preserved (${res.retainedWinterPct.toFixed(1)}% of winter depth strictly protected)\n` +
    `• **Strategic Commercial Assessment:** ${advice}`
  );
}

function buildPlainEnglishDecisionNarrative(row: D1StyleSnapshotRow): string {
  const { storeUnits, ros, storeFloorWos, networkWos } = computeStyleFloorRunway(row);
  const totalStock = Number(row.total_physical_stock) || 0;
  const soldUnits = Number(row.sold_units ?? 0);
  const lifecycleWks = Number(row.sales_lifecycle_weeks ?? 0);
  const imuVal = row.ticket_price > 0 ? (((row.ticket_price - row.unit_cost) / row.ticket_price) * 100).toFixed(1) : '0.0';
  const netPromoRev = row.promotional_price / 1.15;
  const promoNetMargin = (netPromoRev - row.unit_cost).toFixed(2);
  const sizesText = parseSizeBreakdownText(row.size_breakdown_json);
  const whPct = totalStock > 0 ? Math.round((row.stock_wh / totalStock) * 100) : 0;

  const isSingleSize = Boolean(row.is_single_size) || /Single Size/i.test(row.sar_curve_health || '');
  const hasHealthyCoreCurve = !(/Broken/i.test(row.sar_curve_health || ''));
  const speedEval = evaluateSpeedAndHeroQualification({
    cumulativeSTR: Number(row.cumulative_str_pct) || 0,
    weeklyROS: ros,
    weeklyROS2wk: Number(row.weekly_ros_2wk ?? ros),
    storeFloorWOS: storeFloorWos,
    salesLifecycleWeeks: lifecycleWks,
    firstMoveDate: row.first_move_date,
    isSingleSize,
    hasHealthyCoreCurve,
    momentumRatio: Number(row.momentum_ratio ?? 1.0)
  });
  const tier = (row.lifecycle_tier || '').toUpperCase();
  const offerUpper = (row.recommended_offer || '').toUpperCase();
  const isFullMargin =
    tier === 'HERO_CORE' ||
    tier === 'FRESH_WINTER' ||
    tier === 'EXCLUDED_BY_RULE' ||
    offerUpper.includes('FULL PRICE') ||
    offerUpper.includes('MARGIN PROTECTION') ||
    row.discount_pct === 0;

  const compactSeason = (row.season || '').toUpperCase().replace(/[\s_-]+/g, '');
  const isWinter = compactSeason.includes('AW26') || compactSeason.includes('FW26') || compactSeason.includes('WINTER2026');

  if (tier === 'FLAGGED_PRICE_ERROR' || offerUpper.includes('FLAGGED')) {
    return `This item is flagged because its current Odoo ticket price (${row.ticket_price.toFixed(2)} SAR) is already below the Saudi 15% VAT legal floor (${row.cost_plus_vat.toFixed(2)} SAR = ${row.unit_cost.toFixed(2)} SAR cost x 1.15). Any promotional markdown is blocked until list pricing is corrected in Odoo.`;
  }

  if (tier === 'MANUAL_OVERRIDE' || Boolean(row.is_manual_override)) {
    return `This style currently reflects a manual merchandising override (${row.recommended_offer} at ${row.promotional_price.toFixed(2)} SAR, ${row.discount_pct}% off ${row.ticket_price.toFixed(2)} SAR). It still clears the Saudi 15% VAT legal floor (${row.cost_plus_vat.toFixed(2)} SAR) with +${promoNetMargin} SAR net margin per unit across ${totalStock} on-hand units.`;
  }

  if (tier === 'RULE_CAPPED_PROMO' || offerUpper.includes('CAPPED')) {
    return `Although aging/clearance rules would otherwise push this item into a deeper discount, an active Commercial Governance Discount Cap restrained the markdown to ${row.discount_pct}% (${row.promotional_price.toFixed(2)} SAR). That keeps unit net margin at +${promoNetMargin} SAR cleanly above the ${row.cost_plus_vat.toFixed(2)} SAR VAT floor.`;
  }

  if (isFullMargin) {
    if (isWinter || tier === 'FRESH_WINTER' || tier === 'EXCLUDED_BY_RULE') {
      return `Full margin (0% off at ${row.ticket_price.toFixed(2)} SAR) is protected because this belongs to the active ${row.season} winter assortment (${soldUnits} units sold over ${lifecycleWks.toFixed(1)} wks). Winter collections in peak selling season avoid premature discounting so CARINA captures full ${imuVal}% initial margin before seasonal exit.`;
    }
    if (isSingleSize) {
      return `Full Price Margin Protection (0% off at ${row.ticket_price.toFixed(2)} SAR) applies here: ${speedEval.reason} First, as a Single-Size ${row.category || 'Continuity'} product (${sizesText}), it has zero broken-size walkout risk. Second, ${soldUnits} units sold over ${speedEval.effectiveTenureWeeks.toFixed(1)} wks (${speedEval.strVelocityPctPerWeek.toFixed(1)}% STR/wk, ${ros} u/wk velocity, ${storeFloorWos.toFixed(1)} WOS door runway) proves live full-price demand (${imuVal}% IMU), while ${whPct}% of inventory (${row.stock_wh}u) sits safely in Central Warehouse reserve without overcrowding stores.`;
    }
    return `Full Price Margin Protection (0% off at ${row.ticket_price.toFixed(2)} SAR) applies because ${speedEval.reason} Core sizing remains healthy (${row.sar_curve_health}; sizes: ${sizesText}) with ${soldUnits} sold over ${speedEval.effectiveTenureWeeks.toFixed(1)} wks (${speedEval.strVelocityPctPerWeek.toFixed(1)}% STR/wk) and ${whPct}% (${row.stock_wh}u) in Central Warehouse reserve, eliminating any need to dilute your ${imuVal}% margin.`;
  }

  if (tier.includes('CLEARANCE') || tier === 'MATURE_SUMMER_EXIT' || offerUpper.includes('CLEARANCE') || offerUpper.includes('99 SAR') || offerUpper.includes('40%') || offerUpper.includes('50%')) {
    const curveReason = (!isSingleSize && row.has_core_sizes === false)
      ? `its core S/M/L/XL size depth is broken (${row.sar_curve_health}: ${sizesText}), which causes shoppers to walk out without buying at full price`
      : `${speedEval.reason} (STR ${row.cumulative_str_pct}% over ${speedEval.effectiveTenureWeeks.toFixed(1)} wks = ${speedEval.strVelocityPctPerWeek.toFixed(1)}%/wk, ${storeFloorWos.toFixed(1)} WOS floor runway)`;
    return `This style is routed to ${row.recommended_offer} (${row.promotional_price.toFixed(2)} SAR, ${row.discount_pct}% off) because ${curveReason}. The markdown frees store space before the next 2-month drop while staying above the Saudi 15% VAT floor (${row.cost_plus_vat.toFixed(2)} SAR), preserving +${promoNetMargin} SAR net margin per unit.`;
  }

  if (tier === 'BUNDLE_2' || tier === 'VOLUME_MULTI_BUY') {
    const stageLabel = speedEval.speedBand === 'MEDIUM_2B'
      ? 'Medium Mover Tier 2B (Pre-Drop Escalation past 8.7w drop window)'
      : 'Medium Mover Tier 2A (Gentle Basket Lift)';
    return `Classified as ${stageLabel}: instead of a flat clearance cut, this style uses ${row.recommended_offer} (${row.promotional_price.toFixed(2)} SAR effective unit price, ${row.discount_pct}% off) because sizing is intact (${row.sar_curve_health}: ${sizesText}) and ${speedEval.strVelocityPctPerWeek.toFixed(1)}% STR/wk at ${ros} u/wk justifies lifting Units Per Transaction (+${promoNetMargin} SAR/u net profit) above the ${row.cost_plus_vat.toFixed(2)} SAR VAT floor.`;
  }

  return row.commercial_rationale || `Assigned ${row.recommended_offer} (${row.promotional_price.toFixed(2)} SAR) based on ${row.sar_curve_health}, ${row.cumulative_str_pct}% STR, and ${row.weekly_ros} u/wk velocity above the ${row.cost_plus_vat.toFixed(2)} SAR VAT floor.`;
}

function buildStyleAnalyticalExplanation(
  row: D1StyleSnapshotRow,
  lowerMsg: string,
  allowUnguidedMetrics: boolean
): string {
  const { storeUnits, storeFloorWos, networkWos } = computeStyleFloorRunway(row);
  const soldUnits = Number(row.sold_units ?? 0);
  const lifecycleWks = Number(row.sales_lifecycle_weeks ?? 0);
  const imuVal = row.ticket_price > 0 ? (((row.ticket_price - row.unit_cost) / row.ticket_price) * 100).toFixed(1) : '0.0';
  const netPromoRev = row.promotional_price / 1.15;
  const promoNetMargin = (netPromoRev - row.unit_cost).toFixed(2);
  const promoMarginPct = netPromoRev > 0 ? (((netPromoRev - row.unit_cost) / netPromoRev) * 100).toFixed(1) : '0.0';
  const sizesText = parseSizeBreakdownText(row.size_breakdown_json);
  const comp = analyzeCompetitorPosition(row.category, row.product_name, row.ticket_price, row.promotional_price, row.unit_cost);
  const narrative = buildPlainEnglishDecisionNarrative(row);
  const isSingleSz = Boolean(row.is_single_size) || /Single Size/i.test(row.sar_curve_health || '');
  const hasCoreCurve = !(/Broken/i.test(row.sar_curve_health || ''));
  const speedEval = evaluateSpeedAndHeroQualification({
    cumulativeSTR: Number(row.cumulative_str_pct) || 0,
    weeklyROS: Number(row.weekly_ros) || 0,
    weeklyROS2wk: Number(row.weekly_ros_2wk ?? row.weekly_ros ?? 0),
    storeFloorWOS: storeFloorWos,
    salesLifecycleWeeks: lifecycleWks,
    firstMoveDate: row.first_move_date,
    isSingleSize: isSingleSz,
    hasHealthyCoreCurve: hasCoreCurve,
    momentumRatio: Number(row.momentum_ratio ?? 1.0)
  });
  const speedLabel = speedEval.speedBand === 'FAST_HERO' || speedEval.speedBand === 'ACTIVE_CONTINUITY_HERO'
    ? 'FAST (Fast Mover / Hero)'
    : speedEval.speedBand === 'LAUNCH_SHIELD'
      ? 'LAUNCH SHIELD (Initial Read Window)'
      : speedEval.speedBand.startsWith('MEDIUM')
        ? 'MEDIUM (Steady / Medium Mover)'
        : 'SLOW (Slow / Overstock)';
  const isSpeedQuestion = /\b(slow|med|medium|fast|speed|hero)\b/i.test(lowerMsg);

  let out =
    `### Commercial Decision Analysis — Style **${row.style_code}** (*${row.product_name}*)\n\n` +
    (isSpeedQuestion
      ? `• **Speed Classification:** **${speedLabel}** (\`${speedEval.speedBand}\`) — ${speedEval.reason}\n\n`
      : '') +
    `• **Why This Decision Applies:** ${narrative}\n\n` +
    `• **Active Pricing & Offer:** **${row.recommended_offer}** at **${row.promotional_price.toFixed(2)} SAR** (${row.discount_pct}% off ${row.ticket_price.toFixed(2)} SAR ticket) | Tier: \`${row.lifecycle_tier || 'AUTO'}\` | Zero-Loss: **${row.zero_loss_status}**\n` +
    `• **Margin & Saudi 15% VAT Legal Floor:** Landed Cost **${row.unit_cost.toFixed(2)} SAR** | Legal Floor (Cost x 1.15): **${row.cost_plus_vat.toFixed(2)} SAR** | IMU: **${imuVal}%** | Promo Net Margin: **+${promoNetMargin} SAR/u** (${promoMarginPct}%)\n` +
    `• **Sales Velocity & Store vs WH Runway:** **${soldUnits} sold units** over **${lifecycleWks.toFixed(1)} wks** | **${row.weekly_ros} u/wk** ROS | **${row.cumulative_str_pct}%** STR | **${storeUnits} store units** (**${storeFloorWos.toFixed(1)} WOS** floor runway: Andalus ${row.stock_andalus}u, Yasmeen ${row.stock_yasmeen}u, Jouri ${row.stock_jouri}u) + **${row.stock_wh}u** WH buffer (**${networkWos} WOS** total network)\n` +
    `• **Size Curve & Breakdown:** **${row.sar_curve_health}** (${sizesText})\n` +
    `• **Market Benchmark (${comp.category}):** Blended Index **${comp.blendedMarketPriceIndex.toFixed(1)}%** vs Nayomi (${comp.priceIndexVsNayomi.toFixed(1)}%) & Blooming (${comp.priceIndexVsBlooming.toFixed(1)}%) | Basket Tactic: **${comp.tacticalCounterOffer}**`;

  if (allowUnguidedMetrics) {
    out +=
      `\n\n> [!NOTE]\n> **Exploratory Hypothesis (Qualitative & Basket Strategy):**\n` +
      `> Because customers consistently convert on *${row.product_name}* without needing a direct price cut, keeping the ticket intact protects brand value and cash profit. To move more of the ${row.stock_wh}-unit WH reserve faster without eroding unit margin, use threshold basket incentives (**${comp.tacticalCounterOffer}**) or refill top stores incrementally as floor stock dips below 6 WOS.`;
  }

  return out;
}

function formatFullStyleCard(row: D1StyleSnapshotRow): string {
  const { storeUnits, storeFloorWos, networkWos } = computeStyleFloorRunway(row);
  const imuVal = row.ticket_price > 0 ? (((row.ticket_price - row.unit_cost) / row.ticket_price) * 100).toFixed(1) : '0';
  const soldUnits = Number(row.sold_units ?? 0);
  const lifecycleWks = Number(row.sales_lifecycle_weeks ?? 0);
  const sizesText = parseSizeBreakdownText(row.size_breakdown_json);

  return (
    `### Style **${row.style_code}** — *${row.product_name}*\n` +
    `• **Category / Season:** \`${row.category || 'General'}\` | \`${row.season || 'Continuity'}\`\n` +
    `• **Total Physical Inventory:** **${row.total_physical_stock.toLocaleString()} units** on-hand (${storeUnits} in stores, ${row.stock_wh} in Central WH)\n` +
    `  - **Al-Andalus Mall Flagship (Jeddah):** ${row.stock_andalus} units\n` +
    `  - **Al-Yasmeen Mall (Jeddah):** ${row.stock_yasmeen} units\n` +
    `  - **Jouri Mall (Taif):** ${row.stock_jouri} units\n` +
    `  - **Central Warehouse (WH):** ${row.stock_wh} units\n` +
    `• **Curve & Size Breakdown:** ${row.sar_curve_health} (${sizesText})\n` +
    `• **Sales & Runway:** **${soldUnits} sold** (${lifecycleWks.toFixed(1)} wks) | STR: **${row.cumulative_str_pct}%** | Velocity: **${row.weekly_ros} u/wk** | Store Floor WOS: **${storeFloorWos.toFixed(1)} WOS** (Network incl. WH: **${networkWos} WOS**)\n` +
    `• **Cost & Pricing Economics:**\n` +
    `  - Original List Ticket Price: **${row.ticket_price.toFixed(2)} SAR**\n` +
    `  - Landed Unit Cost (COGS): **${row.unit_cost.toFixed(2)} SAR** (IMU: **${imuVal}%**)\n` +
    `  - Saudi 15% VAT Legal Floor: **${row.cost_plus_vat.toFixed(2)} SAR**`
  );
}

interface LiveCatalogTelemetry {
  styleCount: number;
  totalStock: number;
  avgSTR: number;
  avgROS: number;
  totalRetailSAR: number;
  totalCostSAR: number;
  blendedIMU: number;
  projectedLiquidationUnits: number;
  projectedProfitSAR: number;
  winterProtectedPct: number;
  ledgerCount?: number;
}

/**
 * Fetches live catalog summary telemetry directly from D1 snapshots (and move ledger count if available).
 */
async function fetchLiveCatalogTelemetry(db?: D1Database): Promise<LiveCatalogTelemetry | null> {
  if (!db) return null;
  try {
    const agg = await db.prepare(`
      SELECT
        COUNT(*) AS style_count,
        COALESCE(SUM(total_physical_stock), 0) AS total_stock,
        COALESCE(AVG(cumulative_str_pct), 0) AS avg_str,
        COALESCE(AVG(weekly_ros), 0) AS avg_ros,
        COALESCE(SUM(total_physical_stock * ticket_price), 0) AS total_retail_sar,
        COALESCE(SUM(total_physical_stock * unit_cost), 0) AS total_cost_sar,
        COALESCE(SUM(forecast_sold), 0) AS projected_liq_units,
        COALESCE(SUM(forecast_profit), 0) AS projected_profit_sar,
        COALESCE(SUM(CASE WHEN UPPER(REPLACE(COALESCE(season, ''), ' ', '')) IN ('AW26', 'FW26') THEN total_physical_stock ELSE 0 END), 0) AS winter_total_stock,
        COALESCE(SUM(CASE WHEN UPPER(REPLACE(COALESCE(season, ''), ' ', '')) IN ('AW26', 'FW26') AND (recommended_offer LIKE '%Full%' OR recommended_offer LIKE '%0%%' OR recommended_offer LIKE '%Protect%' OR lifecycle_tier = 'FRESH_WINTER') THEN total_physical_stock ELSE 0 END), 0) AS winter_protected_stock
      FROM style_plan_snapshots
    `).first<any>();

    if (!agg || Number(agg.style_count || 0) === 0) return null;

    let ledgerCount: number | undefined;
    try {
      const ledgerRow = await db.prepare('SELECT COUNT(*) AS cnt FROM odoo_stock_move_line').first<any>();
      if (ledgerRow && Number(ledgerRow.cnt) > 0) {
        ledgerCount = Number(ledgerRow.cnt);
      }
    } catch {
      // Optional move ledger count
    }

    const totalRetailSAR = Number(agg.total_retail_sar || 0);
    const totalCostSAR = Number(agg.total_cost_sar || 0);
    const blendedIMU = totalRetailSAR > 0 ? ((totalRetailSAR - totalCostSAR) / totalRetailSAR) * 100 : 0;
    const winterTotal = Number(agg.winter_total_stock || 0);
    const winterProtected = Number(agg.winter_protected_stock || 0);
    const winterProtectedPct = winterTotal > 0 ? (winterProtected / winterTotal) * 100 : 0;

    return {
      styleCount: Number(agg.style_count || 0),
      totalStock: Number(agg.total_stock || 0),
      avgSTR: Number(agg.avg_str || 0),
      avgROS: Number(agg.avg_ros || 0),
      totalRetailSAR,
      totalCostSAR,
      blendedIMU,
      projectedLiquidationUnits: Number(agg.projected_liq_units || 0),
      projectedProfitSAR: Number(agg.projected_profit_sar || 0),
      winterProtectedPct,
      ledgerCount
    };
  } catch (e) {
    console.warn('fetchLiveCatalogTelemetry warning:', e);
    return null;
  }
}

/**
 * Returns architectural documentation for data-source questions hydrated with live D1 telemetry.
 */
function getDataSourceResponse(telemetry?: LiveCatalogTelemetry | null): string {
  const ledgerText = telemetry?.ledgerCount
    ? `${telemetry.ledgerCount.toLocaleString()} verified retail store and warehouse stock movements.`
    : `Synced Odoo retail store and warehouse stock movements (\`odoo_stock_move_line\`).`;
  const catalogText = telemetry
    ? `${telemetry.styleCount.toLocaleString()} verified active physical styles (${telemetry.totalStock.toLocaleString()} units) on-hand.`
    : `Active physical styles with stock > 0 hydrated in D1 \`style_plan_snapshots\`.`;
  const winterText = telemetry
    ? `${telemetry.winterProtectedPct.toFixed(1)}% of Fresh Winter (AW26 / FW26) unit depth is currently shielded at Full Price.`
    : `Fresh Winter (AW26 / FW26) unit depth is dynamically shielded at Full Price.`;

  return (
    `### CARINA Merchandising Architecture — Assortment Intelligence\n\n` +
    `All promotional pricing, store allocations, and lifecycle strategies are synthesized directly from **Verified Point-of-Sale (POS) & Store Inventory Records** across the Kingdom of Saudi Arabia:\n\n` +
    `1. **Inventory Movements & Transaction History:**\n` +
    `   - **Audited Ledger Volume:** ${ledgerText}\n` +
    `   - **Core Size Integrity Standard:** Sized apparel requires all 4 core sizes (**S, M, L, XL**) with >= 2 units per size (or dual-letter SM/LXL equivalents) for a Healthy Curve.\n` +
    `   - **Active Styles In Catalog:** ${catalogText}\n\n` +
    `2. **Physical Store Network Capacity (621 m² Sales Floor):**\n` +
    `   - **Al-Andalus Mall Flagship (Jeddah, 260 m²):** Balanced commercial hub.\n` +
    `   - **Al-Yasmeen Mall (Jeddah, 193 m²):** Overloaded floor; priority clearance hub.\n` +
    `   - **Jouri Mall (Taif, 168 m²):** High density bottleneck; primary candidate for clearance rails.\n` +
    `   - **Central Warehouse:** Reserve fulfillment for replenishment.\n` +
    `   - **Virtual & Damaged Isolation:** Online virtual stock and damaged items are strictly separated from physical sales floors.\n\n` +
    `3. **Commercial Guardrails:**\n` +
    `   - **Saudi Zero-Loss Legal Compliance:** Every offer strictly complies with Price >= Cost x 1.15 (15% VAT).\n` +
    `   - **Winter Assortment Shield:** ${winterText}`
  );
}

/**
 * Cloudflare Workers AI Copilot Orchestrator
 */

/**
 * Strips raw thinking tokens, scratchpad monologues, <think>...</think> blocks, all emojis/icons,
 * and guarantees clean, organized bulleted markdown formatting.
 */
function sanitizeAiResponse(raw: string, style?: D1StyleSnapshotRow): string {
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

  text = text.trim();

  // 4. Structural organization check: If response is a single dense paragraph without bullets or headers, format into organized bullets
  const hasBullets = /^[•\*\-]|\n[•\*\-]|\d+\.\s/m.test(text);
  const hasHeader = /^#{2,4}\s/m.test(text);

  if (!hasBullets && text.length > 60) {
    const sentences = text
      .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    if (sentences.length >= 2) {
      const header = (!hasHeader && style) ? `### Commercial Assessment — Style **${style.style_code}** (*${style.product_name}*)\n\n` : '';
      text = `${header}` + sentences.map(s => `• ${s}`).join('\n');
    }
  } else if (hasBullets && !hasHeader && style) {
    text = `### Commercial Assessment — Style **${style.style_code}** (*${style.product_name}*)\n\n${text}`;
  }

  // 5. Zero-Loss Regulatory Safety Clamp: Enforce Saudi 15% VAT minimum price invariant
  if (style && style.cost_plus_vat > 0) {
    const priceMatch = text.match(/(?:sell|price|promo|offer)\s*(?:at|for|to)?\s*(\d+(?:\.\d+)?)\s*SAR/i);
    if (priceMatch) {
      const proposedPrice = parseFloat(priceMatch[1]);
      if (proposedPrice < style.cost_plus_vat && !/prohibited|violation|illegal|below floor/i.test(text)) {
        text += `\n\n• **Prohibited Action Warning:** A promotional price of ${proposedPrice.toFixed(2)} SAR violates Saudi 15% VAT regulations (below landed cost + 15% VAT). Mandatory legal floor is **${style.cost_plus_vat.toFixed(2)} SAR**.`;
      }
    }
  }

  return text.trim();
}


function formatRebalanceCard(plan: any): string {
  const topTransfers = (plan.transfers || []).slice(0, 3);
  let transferList = '';
  for (const t of topTransfers) {
    transferList += `  - **Style ${t.styleCode}** (*${t.productName}*): Move **${t.recommendedTransferUnits} units** from **${t.sourceStore.name}** (WOS: ${t.sourceStore.wosBefore}w) to **${t.destStore.name}** (WOS: ${t.destStore.wosBefore}w) &bull; Preserves **+${t.financialImpact.netMarginPreservedSAR} SAR** net margin vs ${Math.round(t.financialImpact.avoidedMarkdownPct * 100)}% markdown.\n`;
  }

  return (
    `### Inter-Store Stock Balancing & Margin Preservation\n\n` +
    `  **Recommended Store Transfers:** **${plan.totalRecommendedTransfers} transfer batches**\n` +
    `  **Total Physical Units to Move:** **${plan.totalUnitsToMove.toLocaleString()} units**\n` +
    `  **Gross Markdown Dilution Avoided:** **+${plan.totalGrossMarginSavedSAR.toLocaleString()} SAR**\n` +
    `  **Inter-City Logistics Cost:** **-${plan.totalLogisticsCostSAR.toLocaleString()} SAR**\n` +
    `  **Net Margin Preserved:** **+${plan.totalNetMarginPreservedSAR.toLocaleString()} SAR** (vs clearance rails)\n\n` +
    `**Top Urgent Transfer Actions:**\n${transferList}\n` +
    `*Strategy: Transferring overstock from Taif Jouri to Jeddah Al-Andalus sells at 100% full ticket price instead of sacrificing 40% to 50% discount in Taif.*`
  );
}

function formatCalendarCard(query: string): string {
  const events = Object.values(KSA_RETAIL_CALENDAR);
  let eventRows = '';
  for (const ev of events) {
    eventRows += `  - **${ev.nameEn}** (*${ev.nameAr}*):\n` +
      `    Posture: \`${ev.recommendedCommercialPosture}\` &bull; Timing: ${ev.seasonPeriod}\n` +
      `    Phases: P1 (${ev.markdownPhases.phase1.targetEffectiveDiscountPct}% off) &rarr; P2 (${ev.markdownPhases.phase2.targetEffectiveDiscountPct}% off) &rarr; P3 (${ev.markdownPhases.phase3.targetEffectiveDiscountPct}% off)\n`;
  }

  return (
    `### Official KSA Commercial Retail Calendar & Markdown Phases\n\n` +
    `The system continuously schedules promotions through 3 progressive phases tied to Saudi commercial trading seasons:\n\n` +
    `${eventRows}\n` +
    `*Compliance Note: Every phase strictly clamps promotional prices above Landed Cost plus 15% VAT.*`
  );
}

function formatExecutiveDossierCard(): string {
  return (
    `### Dual-Language Executive Commercial Dossier (KSA)\n\n` +
    `Institutional-grade executive briefing for General Management, Merchandising, and Store Operations:\n\n` +
    `  - **English Executive Briefing:** Portfolio valuation, initial markup (IMU), sell-through (STR), gross margin bridge, and 15% VAT cost floor compliance.\n` +
    `  - **التقرير التنفيذي باللغة العربية:** تعليمات مدراء معارض المنطقة الغربية (الأندلس مول، الياسمين مول، جوري مول بالطائف)، خطة المناقلات لتفادي الخصومات العميقة، والالتزام النظامي بضريبة القيمة المضافة.\n\n` +
    `**Direct Access:**\n` +
    `[Click here to view / print the full Executive Commercial Dossier](/api/reports/dossier)`
  );
}

function formatCrisisStrategyCard(isExploratory: boolean): string {
  const badge = isExploratory 
    ? '`🧪 EXPLORATORY RESILIENCE ANALYSIS (QUALITATIVE SYNTHESIS)`'
    : '`🔒 AUDITED KSA SUPPLY & COMMERCIAL GOVERNANCE`';

  let card = `### Strategic Merchandising & Commercial Considerations During Regional Turbulence\n`;
  card += `${badge}\n\n`;
  card += `• **Jeddah Port & Inbound Supply Resilience:** Regional maritime disruptions in the Red Sea / Bab el-Mandeb inflate shipping lead times by 14–25 days into Jeddah Islamic Port. When replenishment is delayed, **do not aggressively liquidate continuity winter or core basics (NOOS)**. Maintain a 6-to-8 week safety buffer at the Central Warehouse (WH) to prevent stockouts.\n`;
  card += `• **Selective Clearance Rails:** Restrict clearance discounts (e.g. 50% Off or Take 3 For 99 SAR) strictly to broken-size oddments (SAR <= 2 sizes) and past-season summer stock (SS26) that physically bottlenecks store floor racks in Jouri Mall and Al-Yasmeen.\n`;
  card += `• **Consumer Psychology & BNPL Alignment:** During macro uncertainty, discretionary apparel footfall shifts toward deliberate value. Leverage Tamara and Tabby split-payments (minimum ~100 SAR checkout) with multi-pack mechanics (**Spend 250 Save 50** or **Take 3 For 99 SAR**) to defend basket size without eroding ticket price perception.\n`;
  card += `• **Store Network Differentials:**\n`;
  card += `  - **Al-Andalus Flagship (Jeddah, 260 m²):** Commercial volume anchor; resilient family footfall capable of absorbing bundle volume.\n`;
  card += `  - **Al-Yasmeen Mall (North Jeddah, 193 m²):** High-density floor (62.5 u/m²); execute same-day van rebalancing to Central WH to avoid premature price cuts.\n`;
  card += `  - **Jouri Mall (Taif, 168 m²):** Mountain cold climate creates urgent demand for pyjamas, loungewear, and thermals; maintain full-price margin protection regardless of coastal sentiment.\n`;
  card += `• **Ministry of Commerce Zero-Loss Mandate:** Strict legal barrier: promotional prices must remain above Landed Cost + 15% VAT (Price >= Landed Cost × 1.15). Margin protection remains legally non-negotiable.\n`;
  card += `• **Marketing Communication Tone:** Avoid aggressive, loud, or celebratory promotional campaigns. Emphasize dignified family value, seasonal warmth, and quiet multi-pack savings.\n`;

  if (isExploratory) {
    card += `\n> [!NOTE]\n> **Exploratory & Qualitative Assessment (Unguided Hypotheses):**\n` +
      `> In exploratory mode, cross-functional risk indices indicate consumer anxiety reduces impulse checkout by ~18% for high-ticket solo items, but basket conversion remains stable when financing (Tabby/Tamara) is presented at shelf edge. Prioritize customer retention and basket loyalty over aggressive single-item markdown dumping.`;
  }

  return card;
}

function getCategoryFallbackTelemetry(categoryToken: string): CategoryTelemetry {
  const cat = categoryToken.toLowerCase();
  if (/socks?|peds|hosiery/i.test(cat)) {
    return {
      category: 'Socks & Hosiery',
      styleCount: 48,
      totalStock: 2450,
      avgTicketPrice: 14.0,
      minTicketPrice: 9.0,
      maxTicketPrice: 19.0,
      avgUnitCost: 3.5,
      avgCostPlusVat: 4.03,
      avgWeeklyROS: 0.85,
      avgCumulativeSTR: 48.0,
      isSingleSize: true
    };
  }
  if (/bras?|bralettes?/i.test(cat)) {
    return {
      category: 'Bras & Intimates',
      styleCount: 84,
      totalStock: 4200,
      avgTicketPrice: 89.0,
      minTicketPrice: 69.0,
      maxTicketPrice: 129.0,
      avgUnitCost: 28.0,
      avgCostPlusVat: 32.20,
      avgWeeklyROS: 0.65,
      avgCumulativeSTR: 44.0,
      isSingleSize: false
    };
  }
  if (/panties|briefs?/i.test(cat)) {
    return {
      category: 'Panties & Daily Briefs',
      styleCount: 72,
      totalStock: 3800,
      avgTicketPrice: 32.0,
      minTicketPrice: 25.0,
      maxTicketPrice: 45.0,
      avgUnitCost: 9.0,
      avgCostPlusVat: 10.35,
      avgWeeklyROS: 0.90,
      avgCumulativeSTR: 52.0,
      isSingleSize: false
    };
  }
  if (/pyjamas?|pajamas?|sleepwear|nightwear/i.test(cat)) {
    return {
      category: 'Pyjamas & Loungewear',
      styleCount: 112,
      totalStock: 5600,
      avgTicketPrice: 189.0,
      minTicketPrice: 139.0,
      maxTicketPrice: 299.0,
      avgUnitCost: 55.0,
      avgCostPlusVat: 63.25,
      avgWeeklyROS: 0.55,
      avgCumulativeSTR: 40.0,
      isSingleSize: false
    };
  }
  if (/cosmetics?|splashes|perfumes?/i.test(cat)) {
    return {
      category: 'Cosmetics & Fragrances',
      styleCount: 36,
      totalStock: 1800,
      avgTicketPrice: 79.0,
      minTicketPrice: 49.0,
      maxTicketPrice: 129.0,
      avgUnitCost: 18.0,
      avgCostPlusVat: 20.70,
      avgWeeklyROS: 0.70,
      avgCumulativeSTR: 50.0,
      isSingleSize: true
    };
  }
  return {
    category: categoryToken.toUpperCase(),
    styleCount: 50,
    totalStock: 2500,
    avgTicketPrice: 65.0,
    minTicketPrice: 29.0,
    maxTicketPrice: 149.0,
    avgUnitCost: 20.0,
    avgCostPlusVat: 23.0,
    avgWeeklyROS: 0.60,
    avgCumulativeSTR: 45.0,
    isSingleSize: false
  };
}

async function resolveCategoryOfferPlan(
  db: D1Database | undefined,
  categoryToken: string,
  isExploratory: boolean,
  eventContext?: string
): Promise<string> {
  const cat = categoryToken.toLowerCase();
  let telemetry: CategoryTelemetry | null = null;
  let categoryStyles: any[] = [];

  if (db) {
    try {
      const { results } = await db.prepare(`
        SELECT 
          COALESCE(MAX(category), ?) as category,
          COUNT(DISTINCT style_code) as style_count,
          SUM(total_physical_stock) as total_stock,
          AVG(ticket_price) as avg_ticket,
          MIN(ticket_price) as min_ticket,
          MAX(ticket_price) as max_ticket,
          AVG(unit_cost) as avg_cost,
          AVG(cost_plus_vat) as avg_floor,
          AVG(weekly_ros) as avg_ros,
          AVG(cumulative_str_pct) as avg_str
        FROM style_plan_snapshots
        WHERE LOWER(category) LIKE ? OR LOWER(product_name) LIKE ?
      `).bind(categoryToken, `%${cat}%`, `%${cat}%`).all<any>();

      if (results && results.length > 0 && Number(results[0].style_count) > 0 && Number(results[0].avg_ticket) > 0) {
        const r = results[0];
        telemetry = {
          category: r.category || categoryToken,
          styleCount: Number(r.style_count) || 1,
          totalStock: Number(r.total_stock) || 0,
          avgTicketPrice: Number(r.avg_ticket) || 50,
          minTicketPrice: Number(r.min_ticket) || Number(r.avg_ticket) || 50,
          maxTicketPrice: Number(r.max_ticket) || Number(r.avg_ticket) || 50,
          avgUnitCost: Number(r.avg_cost) || 15,
          avgCostPlusVat: Number(r.avg_floor) || (Number(r.avg_cost) || 15) * 1.15,
          avgWeeklyROS: Number(r.avg_ros) || 0.6,
          avgCumulativeSTR: Number(r.avg_str) || 45.0
        };
      }

      // Query top active styles in this category for style-by-style performance validation
      const { results: styles } = await db.prepare(`
        SELECT 
          style_code, 
          product_name, 
          category,
          ticket_price, 
          unit_cost, 
          cost_plus_vat, 
          total_physical_stock, 
          weekly_ros, 
          cumulative_str_pct, 
          sar_curve_health, 
          recommended_offer, 
          promotional_price, 
          discount_pct
        FROM style_plan_snapshots
        WHERE LOWER(category) LIKE ? OR LOWER(product_name) LIKE ?
        ORDER BY total_physical_stock DESC
        LIMIT 8
      `).bind(`%${cat}%`, `%${cat}%`).all<any>();

      if (styles && styles.length > 0) {
        categoryStyles = styles;
      }
    } catch (e) {
      console.warn('Error querying live D1 category telemetry:', e);
    }
  }

  if (!telemetry) {
    telemetry = getCategoryFallbackTelemetry(categoryToken);
  }

  const plan = generateDynamicCategoryOfferPlan(telemetry);
  return formatDynamicCategoryOfferDossier(plan, isExploratory, categoryStyles, eventContext);
}

export async function handleCopilotChat(
  env: { AI?: any; DB?: D1Database; AI_GATEWAY_ID?: string; LORA_ADAPTER_NAME?: string },
  request: CopilotChatRequest
): Promise<CopilotChatResponse> {
  const mode = request.mode || 'DISCOUNT_STRATEGIST';
  const userMessage = request.message.trim();
  const contextStyleCode = request.contextStyleCode;
  const allowUnguidedMetrics = !!request.allowUnguidedMetrics;

  // 1. Natural Language Rule Compiler
  if (mode === 'RULE_COMPILER' || (userMessage.toLowerCase().includes('rule') && (userMessage.toLowerCase().includes('cap') || userMessage.toLowerCase().includes('exclude') || userMessage.toLowerCase().includes('floor') || userMessage.toLowerCase().includes('discount')))) {
    const parsed = parseNaturalLanguageRule(userMessage);
    if (parsed) {
      let impactLine = '';
      if (env?.DB) {
        try {
          const scope = String(parsed.target_scope || 'GLOBAL');
          let whereSql = '1 = 1';
          const bindings: any[] = [];
          if (scope.startsWith('CATEGORY:')) {
            whereSql = 'LOWER(category) LIKE ?';
            bindings.push(`%${scope.slice('CATEGORY:'.length).trim().toLowerCase()}%`);
          } else if (scope.startsWith('SEASON:')) {
            whereSql = 'LOWER(season) LIKE ?';
            bindings.push(`%${scope.slice('SEASON:'.length).trim().toLowerCase()}%`);
          } else if (scope.startsWith('STYLE:')) {
            whereSql = 'style_code = ?';
            bindings.push(scope.slice('STYLE:'.length).trim());
          } else if (scope.startsWith('STORE:')) {
            const st = scope.slice('STORE:'.length).trim().toLowerCase();
            if (st.includes('jouri') || st.includes('taif')) whereSql = 'stock_jouri > 0';
            else if (st.includes('yasmeen')) whereSql = 'stock_yasmeen > 0';
            else if (st.includes('andalus')) whereSql = 'stock_andalus > 0';
          }
          const stmt = env.DB.prepare(
            `SELECT COUNT(*) AS style_cnt, COALESCE(SUM(total_physical_stock), 0) AS unit_cnt, COALESCE(ROUND(SUM(total_physical_stock * unit_cost), 0), 0) AS capital_sar FROM style_plan_snapshots WHERE ${whereSql}`
          );
          const preview = bindings.length > 0
            ? await stmt.bind(...bindings).first<any>()
            : await stmt.first<any>();
          if (preview && Number(preview.style_cnt) > 0) {
            impactLine = `• **Live D1 Impact Preview:** Affects **${Number(preview.style_cnt).toLocaleString()} styles** (**${Number(preview.unit_cnt).toLocaleString()} units**, **${Number(preview.capital_sar).toLocaleString()} SAR** cost capital)\n`;
          }
        } catch {
          // Optional preview; do not block rule compilation if DB preview fails
        }
      }

      return {
        reply: `I have compiled your commercial instruction into a formal Governance Rule:\n\n` +
          `• **Rule ID:** \`${parsed.rule_id}\`\n` +
          `• **Policy Name:** ${parsed.rule_name}\n` +
          `• **Category:** \`${parsed.rule_category}\`\n` +
          `• **Scope Target:** \`${parsed.target_scope}\`\n` +
          `• **Condition:** \`${parsed.condition_operator} ${parsed.rule_value}\`\n` +
          `• **Enforcement:** **${parsed.enforcement_level}**\n` +
          impactLine +
          `\nClick below to apply and activate this commercial policy across the live catalog:\n\n` +
          `[APPLY_RULE:${JSON.stringify(parsed)}]`,
        mode: 'RULE_COMPILER',
        suggestedRule: parsed
      };
    }
  }

  const lowerMsg = normalizeCopilotMessageLower(userMessage);
  const recentHistory = sanitizeChatHistory(request.history);

  // Pattern to detect when user asks about an unspecified style without naming it
  const asksForUnspecifiedStyle = /\b(performance.*(this|the) (style|item)|(this|the) (style|item).*performance|what is the performance (of|for) this|what is the price of this|how many.*this item|tell me about this (product|style|item)|what is this style|how is this selling|evaluate this (style|item)|analyze this (style|item)|about this (style|item|product)|for this (style|item|product))\b/i.test(lowerMsg);

  // 2. Query Live D1 Database for matching product or style (with context tracking)
  const matchedStyles = await searchStylesInD1(env?.DB, userMessage, contextStyleCode);

  // 3. Detect data source queries
  const isDataSourceQuery = /source|where.*data|what.*table|which.*table|d1|database|odoo_stock_move_line|move line|schema|column/i.test(userMessage);

  if (isDataSourceQuery && matchedStyles.length === 0) {
    const liveTelemetry = await fetchLiveCatalogTelemetry(env?.DB);
    return {
      reply: getDataSourceResponse(liveTelemetry),
      mode
    };
  }

  // 3a. Detect Capabilities / Help inquiries
  const isCapabilitiesQuery = /\b(what (?:you can|can you|you) do|what can you do|what you can do|what are your capabilities|what are your features|who are you|how can you help|explain your features|what do you do|features|capabilities)\b/i.test(lowerMsg);
  if (isCapabilitiesQuery && matchedStyles.length === 0) {
    return {
      reply: formatCapabilitiesCard(),
      mode
    };
  }

  // 3b. Detect Competitor Intelligence inquiries (Nayomi & Blooming)
  const isCompetitorQuery = /\b(competitor|competitors|competition|nayomi|blooming|market price|benchmark|market comparison|market share)\b/i.test(lowerMsg);
  if (isCompetitorQuery && matchedStyles.length === 0) {
    return {
      reply: formatCompetitorIntelligenceCard(),
      mode
    };
  }

  // 3bb. Detect Slow Movers Identification & AI Recommendations inquiries
  const isSlowMoverInquiry = /\b(slow\s*movers?|slow\s*moving|dead\s*stock|stagnant|zombie\s*stock|aged\s*stock|aged\s*inventory|identify\s*slow|how.*identify.*slow|recommend.*slow|what.*ai.*recommend.*slow)\b/i.test(lowerMsg);
  if (isSlowMoverInquiry && matchedStyles.length === 0) {
    let summary: SlowMoversSummary = {
      totalSlowStyles: 0,
      totalSlowUnits: 0,
      totalCatalogStyles: 0,
      totalCatalogUnits: 0,
      capitalTiedUpSAR: 0,
      avgWOS: 0,
      sampleStyles: []
    };

    if (env?.DB) {
      try {
        const stats = await env.DB.prepare(`
          SELECT 
            COUNT(*) as total_slow_styles,
            COALESCE(SUM(total_physical_stock), 0) as total_slow_units,
            COALESCE(SUM(total_physical_stock * unit_cost), 0) as total_capital_cogs,
            COALESCE(AVG(CASE WHEN weekly_ros > 0 THEN total_physical_stock / weekly_ros ELSE 52.0 END), 0) as avg_wos
          FROM style_plan_snapshots 
          WHERE recommended_offer LIKE '%Clearance%' OR recommended_offer LIKE '%99 SAR%' OR lifecycle_tier IN ('CLEARANCE_50_PCT', 'CLEARANCE_3_FOR_99', 'CLEARANCE_PERCENT_SAFE') OR weekly_ros <= 0.1
        `).first<any>();

        const catalogTotals = await env.DB.prepare(`
          SELECT COUNT(*) as total_catalog_styles, COALESCE(SUM(total_physical_stock), 0) as total_catalog_units FROM style_plan_snapshots
        `).first<any>();

        const rows = await env.DB.prepare(`
          SELECT * FROM style_plan_snapshots 
          WHERE recommended_offer LIKE '%Clearance%' OR recommended_offer LIKE '%99 SAR%' OR lifecycle_tier IN ('CLEARANCE_50_PCT', 'CLEARANCE_3_FOR_99', 'CLEARANCE_PERCENT_SAFE') OR weekly_ros <= 0.1
          ORDER BY total_physical_stock DESC 
          LIMIT 6
        `).all<D1StyleSnapshotRow>();

        if (stats) {
          summary.totalSlowStyles = Number(stats.total_slow_styles) || 0;
          summary.totalSlowUnits = Number(stats.total_slow_units) || 0;
          summary.capitalTiedUpSAR = Math.round(Number(stats.total_capital_cogs) || 0);
          summary.avgWOS = Math.round((Number(stats.avg_wos) || 0) * 10) / 10;
        }

        if (catalogTotals) {
          summary.totalCatalogStyles = Number(catalogTotals.total_catalog_styles) || 0;
          summary.totalCatalogUnits = Number(catalogTotals.total_catalog_units) || 0;
        }

        if (rows && rows.results && rows.results.length > 0) {
          summary.sampleStyles = rows.results.map((r: any) => {
            const ticket = Number(r.ticket_price) || 29;
            const cost = Number(r.unit_cost) || 10;
            const floor = Number(r.cost_plus_vat) || (cost * 1.15);
            const stock = Number(r.total_physical_stock) || 0;
            const ros = Number(r.weekly_ros) || 0;
            const str = Number(r.cumulative_str_pct) || 0;
            const wos = ros > 0 ? (stock / ros) : 99;

            let bottleneck = 'Overhang Runway';
            if (ros <= 0.1 && str < 10) bottleneck = 'Stagnant Velocity';
            else if (wos > 40) bottleneck = 'Runway Bottleneck';

            let aiRec = r.recommended_offer || '50% Off Clearance Rail';
            let promoPrice = Number(r.promotional_price) || Math.max(floor, ticket * 0.5);

            if (ticket > 40 && cost * 1.15 <= 33) {
              aiRec = 'Take 3 For 99 SAR Shared Rail';
              promoPrice = 33.0;
            } else if (ticket <= 40) {
              aiRec = `50% Off Dedicated Rail (${Math.max(floor, ticket * 0.5).toFixed(2)} SAR)`;
              promoPrice = Math.max(floor, ticket * 0.5);
            }

            const netRev = promoPrice / 1.15;
            const netMargin = netRev - cost;
            const netMarginPct = netRev > 0 ? (netMargin / netRev) * 100 : 0;

            return {
              style_code: r.style_code,
              product_name: r.product_name,
              category: r.category,
              ticket_price: ticket,
              unit_cost: cost,
              cost_plus_vat: floor,
              total_physical_stock: stock,
              weekly_ros: ros,
              cumulative_str_pct: str,
              store_floor_wos: wos,
              identified_bottleneck: bottleneck,
              ai_recommendation: aiRec,
              promo_price: promoPrice,
              net_margin_pct: Math.round(netMarginPct * 10) / 10,
              pos_tag: `RULE_CLEARANCE_${r.style_code}`
            };
          });
        }
      } catch (err) {
        console.warn('Error fetching live D1 slow movers telemetry:', err);
      }
    }

    // Default sample styles if D1 returned no rows
    if (summary.sampleStyles.length === 0) {
      summary.sampleStyles = [
        {
          style_code: '52007',
          product_name: 'Ankle Socks M0500',
          ticket_price: 16.0,
          unit_cost: 3.8,
          cost_plus_vat: 4.37,
          total_physical_stock: 48,
          weekly_ros: 0.1,
          cumulative_str_pct: 14.5,
          store_floor_wos: 48.0,
          identified_bottleneck: 'Stagnant Velocity',
          ai_recommendation: '50% Off Dedicated Rail (8.00 SAR)',
          promo_price: 8.0,
          net_margin_pct: 45.4,
          pos_tag: 'RULE_CLEARANCE_52007'
        },
        {
          style_code: '53087',
          product_name: 'Girly Peds',
          ticket_price: 6.0,
          unit_cost: 1.5,
          cost_plus_vat: 1.73,
          total_physical_stock: 45,
          weekly_ros: 0.05,
          cumulative_str_pct: 9.8,
          store_floor_wos: 90.0,
          identified_bottleneck: 'Runway Bottleneck',
          ai_recommendation: '50% Off Dedicated Rail (3.00 SAR)',
          promo_price: 3.0,
          net_margin_pct: 42.5,
          pos_tag: 'RULE_CLEARANCE_53087'
        },
        {
          style_code: '58424',
          product_name: 'Pyjama Set AW25-PJ',
          ticket_price: 89.0,
          unit_cost: 21.0,
          cost_plus_vat: 24.15,
          total_physical_stock: 62,
          weekly_ros: 0.2,
          cumulative_str_pct: 22.0,
          store_floor_wos: 31.0,
          identified_bottleneck: 'Broken Size Curve',
          ai_recommendation: 'Take 3 For 99 SAR Shared Rail',
          promo_price: 33.0,
          net_margin_pct: 26.8,
          pos_tag: 'RULE_CLEARANCE_3_99_58424'
        }
      ];
    }

    return {
      reply: formatSlowMoversIntelligenceCard(summary, allowUnguidedMetrics),
      mode
    };
  }

  // 3c. Detect Scenario Simulation / What-If Inquiries with User-Decided Duration
  const isSimulationQuery = /\b(what if.*(?:liquidat|clear|units?|margin|target|sales?|weeks?)|simulate.*(?:liquidat|clear|units?|margin|scenario|weeks?)|run.*simulation|what happens if we (?:liquidat|clear)|promote for \d+ weeks?|plan for \d+ weeks?)\b/i.test(lowerMsg);

  if (isSimulationQuery && matchedStyles.length === 0 && env?.DB) {
    try {
      let targetUnits = 0;
      const unitsMatch = lowerMsg.match(/(\d{1,3}(?:,\d{3})+|\d+)\s*(?:k\b|units?|items?|pcs)/i);
      if (unitsMatch) {
        let rawUnits = unitsMatch[1].replace(/,/g, '');
        let parsed = parseInt(rawUnits, 10);
        if (lowerMsg.includes(unitsMatch[1] + 'k') || lowerMsg.includes(unitsMatch[1] + ' k')) {
          parsed *= 1000;
        }
        if (parsed >= 1000 && parsed <= 60000) {
          targetUnits = parsed;
        }
      }

      let marginFloor = 48.0;
      const marginMatch = lowerMsg.match(/(\d+(?:\.\d+)?)\s*(?:%|percent)\s*(?:margin|floor)?/i);
      if (marginMatch) {
        const parsedMargin = parseFloat(marginMatch[1]);
        if (parsedMargin >= 10 && parsedMargin <= 80) {
          marginFloor = parsedMargin;
        }
      }

      // User-decided promotion duration
      let promoWeeks = 4;
      const weeksMatch = lowerMsg.match(/(\d+)\s*(?:weeks?|wks?)/i);
      if (weeksMatch) {
        const parsedWeeks = parseInt(weeksMatch[1], 10);
        if (parsedWeeks >= 1 && parsedWeeks <= 12) {
          promoWeeks = parsedWeeks;
        }
      }

      // User-selected scenario
      let scenario: ForecastScenario = 'base';
      if (/conservative|p10|worst/i.test(lowerMsg)) {
        scenario = 'conservative';
      } else if (/optimistic|p90|best/i.test(lowerMsg)) {
        scenario = 'optimistic';
      }

      const records = await getOrComputeStylePlan(env.DB);
      if (records && records.length > 0) {
        const styles = records.map(r => r.metrics);
        const recs = records.map(r => r.recommendation);
        const simResult = runWhatIfSimulation(styles, recs, {
          targetLiquidationUnits: targetUnits > 0 ? targetUnits : undefined,
          minimumNetMarginFloorPct: marginFloor,
          promotionWeeks: promoWeeks,
          scenario
        });

        const reply = formatSimulationCard(simResult, targetUnits, marginFloor);
        return {
          reply,
          mode
        };
      }
    } catch (err) {
      console.error('Error running conversational simulation:', err);
    }
  }


  // 2b. Inter-Store Inventory Rebalancing Query (portfolio-wide only when no single style is in focus)
  if (/\b(transfer|transfers|rebalance|rebalancing|inter-store|move stock|taif.*andalus|stock balance)\b/i.test(lowerMsg) && matchedStyles.length === 0) {
    if (env.DB) {
      try {
        const records = await getOrComputeStylePlan(env.DB);
        const mapped = records.map(r => ({
          styleCode: r.metrics.styleCode,
          productName: r.metrics.productName,
          category: r.metrics.category || 'General',
          ticketPrice: r.metrics.ticketPrice,
          unitCost: r.metrics.unitCost,
          weeklyROS: r.metrics.weeklyROS,
          stockAndalus: r.metrics.stockAndalus,
          stockYasmeen: r.metrics.stockYasmeen,
          stockJouri: r.metrics.stockJouri,
          stockWH: r.metrics.stockWH,
          recommendedOffer: r.recommendation.recommendedOffer
        }));
        const plan = generatePortfolioRebalancingPlan(mapped);
        return {
          reply: formatRebalanceCard(plan),
          mode
        };
      } catch (e) {
        console.error('Error in rebalancing chat:', e);
      }
    }
  }

  // 2b. Category Promotional Planning & Style Performance Validation (e.g. "plan offers for socks in white friday", "offers for bras", "what is your plan for pyjamas")
  const catOfferRegex = /\b(socks?|peds|hosiery|bras?|bralettes?|panties|briefs?|pyjamas?|pajamas?|sleepwear|nightwear|cosmetics?|splashes|perfumes?|shapewear|tops?|t-shirts?|leggings?)\b/i;
  const isCategoryOfferQuery = (/\b(plan|offers?|promotions?|discount|pricing|validate|best offer|performance)\b/i.test(lowerMsg)) && catOfferRegex.test(lowerMsg);

  if (isCategoryOfferQuery && matchedStyles.length === 0) {
    const match = lowerMsg.match(catOfferRegex);
    const categoryToken = match ? match[1] : 'General';

    // Detect event context if present in query
    let eventContext: string | undefined = undefined;
    if (/white friday|black friday|cyber/i.test(lowerMsg)) eventContext = 'White Friday';
    else if (/national day/i.test(lowerMsg)) eventContext = 'Saudi National Day';
    else if (/founding day/i.test(lowerMsg)) eventContext = 'Saudi Founding Day';
    else if (/ramadan/i.test(lowerMsg)) eventContext = 'Ramadan Preparatory Season';
    else if (/eid/i.test(lowerMsg)) eventContext = 'Eid al-Fitr Season';

    return {
      reply: await resolveCategoryOfferPlan(env?.DB, categoryToken, allowUnguidedMetrics, eventContext),
      mode
    };
  }

  // 2c. KSA Retail Calendar Query (strictly when user asks about the retail calendar schedule, dates, or markdown phases)
  const isExplicitCalendarSchedule = /\b(calendar|commercial events?|retail calendar|trading calendar|markdown phases?|trading phases?|dates? of (?:white friday|national day|founding day|ramadan|eid)|when is (?:white friday|national day|founding day|ramadan|eid))\b/i.test(lowerMsg);
  if (isExplicitCalendarSchedule && matchedStyles.length === 0) {
    return {
      reply: formatCalendarCard(lowerMsg),
      mode
    };
  }

  // 2d. Executive Commercial Dossier Query
  if (/\b(dossier|executive report|bilingual report|arabic report|executive briefing)\b/i.test(lowerMsg)) {
    return {
      reply: formatExecutiveDossierCard(),
      mode
    };
  }

  // 2e. Regional Crisis & Supply Chain Query (Jeddah Port & Macro Resilience)
  const isCrisisOrMacroQuery = /\b(war|crisis|conflict|geopolitical|red sea|shipping|logistics|turbulence|turbulent|recession|anxiety|sanction|inbound delay|port|customs delay)\b/i.test(lowerMsg);
  if (isCrisisOrMacroQuery && matchedStyles.length === 0) {
    return {
      reply: formatCrisisStrategyCard(allowUnguidedMetrics),
      mode
    };
  }

  // 2f. Unguided Metrics Governance Filter (Backed by Certified Ontology Answerability Gate)
  const answerabilityCheck = checkAnswerable(userMessage, allowUnguidedMetrics);
  const isUnguidedMetricQuery = !answerabilityCheck.answerable || /\b(return rate|returns? rate|customer return|happiness|sentiment score|sentiment index|social media|instagram|tiktok|impressions?|bounce rate|nps|brand equity|urgency factor|urgency index|viral)\b/i.test(lowerMsg);
  if (isUnguidedMetricQuery && !allowUnguidedMetrics && matchedStyles.length === 0) {
    return {
      reply: `### Metric Governance & Boundary Notice\n\n` +
        `The metric you inquired about is **outside CARINA's 7 validated SSOT physical retail dimensions**:\n\n` +
        `• **Authorized Telemetry Allowlist:** Landed Unit Cost (15% VAT Floor), Weekly ROS, Cumulative STR %, Store Floor WOS Runway, Size Availability Ratio (SAR), Seasonality Window, and Physical Store Floor Density (Units/m²).\n` +
        `• **Governance Enforcement:** To prevent financial loss and hallucinated pricing, promotional offers and discounts are mathematically locked to verified store inventory and accounting costs.\n\n` +
        `💡 *Tip: If you want to brainstorm hypothetical scenarios or synthesize qualitative and external factors, enable **Exploratory Analysis Mode** using the toggle switch in the Copilot header.*`,
      mode
    };
  }

  // If a specific style was matched from the message or active conversation context
  if (matchedStyles.length > 0) {
    const style = matchedStyles[0];

    // Intent classification for targeted queries
    const isCompetitorStyleQuery = /\b(competitor|nayomi|blooming|benchmark|vs nayomi|vs blooming|market price)\b/i.test(lowerMsg);
    if (isCompetitorStyleQuery) {
      return {
        reply: formatStyleCompetitorCard(style),
        mode,
        activeStyleCode: style.style_code,
        activeStyleName: style.product_name
      };
    }

    // Alternative Promotional Scenarios Query (e.g. "is there another offer suitable for it", "do you recommend antoher offer?")
    const isAlternativeOfferQuery = /\b(anothe|another|other|alternative|alternatives|different|options?|what else|second option|any other|more offers?|instead|suitable|scenarios?)\b/i.test(lowerMsg) &&
      /\b(offers?|promo|promotions?|promotional|discounts?|deals?|suitable|options?|rails?|bundles?)\b/i.test(lowerMsg);
    let alternativeOffersCard: string | null = null;
    let alternativeScenariosContext = '';
    if (isAlternativeOfferQuery) {
      const { storeFloorWos: accurateFloorWos } = computeStyleFloorRunway(style);
      const isSingleSz = Boolean(style.is_single_size) || /Single Size/i.test(style.sar_curve_health || '');
      const hasCoreSz = style.has_core_sizes === undefined
        ? !/Broken/i.test(style.sar_curve_health || '')
        : Boolean(style.has_core_sizes);
      const dynamicMetrics: DynamicOfferMetrics = {
        styleCode: style.style_code,
        productName: style.product_name,
        category: style.category || 'General',
        season: style.season || 'Continuity',
        unitCost: Number(style.unit_cost) || 10,
        ticketPrice: Number(style.ticket_price) || 29,
        totalPhysicalStock: Number(style.total_physical_stock) || 0,
        weeklyROS: Number(style.weekly_ros) || 0.1,
        cumulativeSTR: Number(style.cumulative_str_pct) || 0,
        storeFloorWOS: accurateFloorWos,
        activeSizeCount: Number(style.active_size_count) || (hasCoreSz ? 4 : 1),
        hasCoreSizes: hasCoreSz,
        isSingleSize: isSingleSz,
        stockWH: Number(style.stock_wh) || 0,
        salesLifecycleWeeks: Number(style.sales_lifecycle_weeks ?? 0)
      };
      const altResult = generateAlternativeOfferScenarios(dynamicMetrics);
      alternativeOffersCard = formatAlternativeOffersCard(altResult, allowUnguidedMetrics);
      alternativeScenariosContext = (altResult.selectionReason ? `Recommended Winner [${altResult.recommendedScenarioId}]: ${altResult.selectionReason}\n` : '') +
        altResult.scenarios.map((sc, idx) =>
          `${idx + 1}. ${sc.name}${altResult.recommendedScenarioId === sc.scenarioId ? ' [BEST CHOICE]' : ''} — ${sc.offerLabel} [${sc.strategicPosture}]: ${sc.promoPriceSAR.toFixed(2)} SAR (${sc.discountPct}% off list ${style.ticket_price.toFixed(2)} SAR; Net Margin +${sc.unitNetMarginSAR.toFixed(2)} SAR/u = ${sc.netMarginPct.toFixed(1)}%; Forecast ${sc.forecastSoldUnits}u / ${sc.expectedClearancePct}% clearance, post-event ${sc.postEventWOS.toFixed(1)} WOS) — ${sc.tradeOffSummary}`
        ).join('\n');

      // Only return the static card alone if Workers AI is unavailable
      if (!env?.AI) {
        return {
          reply: alternativeOffersCard,
          mode,
          activeStyleCode: style.style_code,
          activeStyleName: style.product_name
        };
      }
    }

    const isOfferQuery = /\b(offer|promo|promotion|promotional|discount|deal|markdown|recommendation|recommend|clearance|sale price|full\s*margin|margin\s*protection|full\s*price|0%\s*off|no\s*discount|bundle|take\s*3|tier)\b/i.test(lowerMsg);
    const isStockQuery = /\b(stock|inventory|units|quantity|on-hand|onhand|available|where|stores?|location|allocation|warehouse|wh|andalus|yasmeen|jouri)\b/i.test(lowerMsg);
    const isPricingQuery = /\b(price|pricing|ticket|cost|cogs|floor|vat|imu|markup|margin|break-even|breakeven)\b/i.test(lowerMsg);
    const isVelocityQuery = /\b(sales\s+performance|performance|velocity|ros|rate of sale|sales rate|sales velocity|sell-through|sell through|str|runway|wos|weeks of supply|coverage|how fast|sales volume|how is it selling)\b/i.test(lowerMsg);
    // Conversational, open-ended, qualitative, or analytical inquiries that require plain-English AI reasoning:
    const isConversational = /\b(what about|how about|tell me about|how is|thoughts on|opinion|status of|evaluate|review|analyze|assessment|doing|should i|what can i|what should|how can|how to|increase|boost|grow|improve|accelerate|strategy|suggest|advice|help me|do you|would you|should we|better|another|other|alternative|alternatives|different|instead|replace|switch|fit|transfer|transfers|rebalance|move stock)\b/i.test(lowerMsg);
    const isDecisionWhyQuery = /\b(why|explain|reason|behind|how come|how did|what makes|why does|why is|why did|justify|rationale|clarify)\b/i.test(lowerMsg);
    const isComplexAnalysis = isAlternativeOfferQuery || isConversational || isDecisionWhyQuery || /\b(how is.*calculated|formula|derivation|what if|can we|could we|simulate|project|compare)\b/i.test(lowerMsg);
    const isFullOverview = /\b(details|overview|everything|snapshot|summary|profile|card|full\s*(?:details|overview|summary|card|breakdown|profile)|all\s*(?:details|info|information|metrics|numbers))\b/i.test(lowerMsg) && !isComplexAnalysis;

    // Case A: Specific property queries without analytical reasoning (Zero LLM Tokens, Instant Deterministic Accuracy)
    if (!isComplexAnalysis && !isFullOverview) {
      if (isStockQuery && !isPricingQuery && !isVelocityQuery && !isOfferQuery) {
        return {
          reply: formatStockCard(style),
          mode,
          activeStyleCode: style.style_code,
          activeStyleName: style.product_name
        };
      }
      if (isPricingQuery && !isStockQuery && !isVelocityQuery && !isOfferQuery) {
        return {
          reply: formatPricingCard(style),
          mode,
          activeStyleCode: style.style_code,
          activeStyleName: style.product_name
        };
      }
      if (isVelocityQuery && !isStockQuery && !isPricingQuery && !isOfferQuery) {
        return {
          reply: formatVelocityCard(style),
          mode,
          activeStyleCode: style.style_code,
          activeStyleName: style.product_name
        };
      }
      if (isOfferQuery && !isStockQuery && !isPricingQuery && !isVelocityQuery) {
        return {
          reply: formatOfferCard(style, allowUnguidedMetrics),
          mode,
          activeStyleCode: style.style_code,
          activeStyleName: style.product_name
        };
      }
      if (isOfferQuery && !isStockQuery) {
        return {
          reply: formatOfferCard(style, allowUnguidedMetrics),
          mode,
          activeStyleCode: style.style_code,
          activeStyleName: style.product_name
        };
      }
      if (isStockQuery && !isPricingQuery && !isOfferQuery) {
        return {
          reply: formatStockCard(style),
          mode,
          activeStyleCode: style.style_code,
          activeStyleName: style.product_name
        };
      }
      if (isPricingQuery && !isStockQuery) {
        return {
          reply: formatPricingCard(style),
          mode,
          activeStyleCode: style.style_code,
          activeStyleName: style.product_name
        };
      }
      if (isVelocityQuery) {
        return {
          reply: formatVelocityCard(style),
          mode,
          activeStyleCode: style.style_code,
          activeStyleName: style.product_name
        };
      }
      if (isOfferQuery) {
        return {
          reply: formatOfferCard(style, allowUnguidedMetrics),
          mode,
          activeStyleCode: style.style_code,
          activeStyleName: style.product_name
        };
      }
    }

    // Case B: Pure bare lookup (style code / product name only) or explicit full breakdown.
    // Natural open-ended questions (e.g., "is it slow of med or fast?", "does it have healthy sizes?") bypass this dump and route into Case C (Ontology-Grounded Style AI).
    const isNaturalQuestionOrSentence = userMessage.includes('?') ||
      /\b(is|are|was|were|do|does|did|can|could|should|will|would|may|might|has|have|had|which|what|who|when|where|why|how|slow|med|medium|fast|speed|healthy|broken|overstock|overstocked|transfer|rebalance|better|worse|good|bad|worth|safe|legal|allowed|prohibited|risk|problem|issue|fit|classify|classification|category)\b/i.test(lowerMsg);
    const hasAnyPropertyKeyword = isStockQuery || isPricingQuery || isVelocityQuery || isOfferQuery || isComplexAnalysis;
    if (isFullOverview || (!hasAnyPropertyKeyword && !isNaturalQuestionOrSentence)) {
      return {
        reply: formatFullStyleCard(style),
        mode,
        activeStyleCode: style.style_code,
        activeStyleName: style.product_name
      };
    }

    // Case C: Analytical, reasoning, or calculation questions routed to Workers AI
    // Reserve DeepSeek R1 strictly for explicit mathematical/formula derivation requests (non-"why" prose)
    const isExplicitFormulaMath = /\b(formula|calculate|derivation|arithmetic|equation|proof|zero-loss\s*proof)\b/i.test(lowerMsg) && !isDecisionWhyQuery;
    const includeOfferContext = isOfferQuery || isDecisionWhyQuery || isComplexAnalysis;

    let userModel = request.model && request.model !== 'auto' ? request.model : undefined;
    if (!userModel) {
      userModel = isExplicitFormulaMath
        ? '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b'
        : '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
    }

    if (env?.AI) {
      try {
        const { storeUnits, storeFloorWos, networkWos } = computeStyleFloorRunway(style);
        const imuVal = style.ticket_price > 0 ? (((style.ticket_price - style.unit_cost) / style.ticket_price) * 100).toFixed(1) : '0';
        const promoRev = style.promotional_price / 1.15;
        const promoNetMargin = (promoRev - style.unit_cost).toFixed(2);
        const promoMarginPct = promoRev > 0 ? (((promoRev - style.unit_cost) / promoRev) * 100).toFixed(1) : '0';
        const sizesText = parseSizeBreakdownText(style.size_breakdown_json);
        const soldUnits = Number(style.sold_units ?? 0);
        const lifecycleWks = Number(style.sales_lifecycle_weeks ?? 0);
        const isSingleSz = Boolean(style.is_single_size) || /Single Size/i.test(style.sar_curve_health || '');
        const hasCoreCurve = !(/Broken/i.test(style.sar_curve_health || ''));
        const speedEval = evaluateSpeedAndHeroQualification({
          cumulativeSTR: Number(style.cumulative_str_pct) || 0,
          weeklyROS: Number(style.weekly_ros) || 0,
          weeklyROS2wk: Number(style.weekly_ros_2wk ?? style.weekly_ros ?? 0),
          storeFloorWOS: storeFloorWos,
          salesLifecycleWeeks: lifecycleWks,
          firstMoveDate: style.first_move_date,
          isSingleSize: isSingleSz,
          hasHealthyCoreCurve: hasCoreCurve,
          momentumRatio: Number(style.momentum_ratio ?? 1.0)
        });
        const comp = analyzeCompetitorPosition(style.category, style.product_name, style.ticket_price, style.promotional_price, style.unit_cost);
        const deterministicNarrative = buildPlainEnglishDecisionNarrative(style);
        const speedLabel = speedEval.speedBand === 'FAST_HERO' || speedEval.speedBand === 'ACTIVE_CONTINUITY_HERO'
          ? 'FAST (Fast Mover / Hero)'
          : speedEval.speedBand === 'LAUNCH_SHIELD'
            ? 'LAUNCH SHIELD (Initial Read Window)'
            : speedEval.speedBand.startsWith('MEDIUM')
              ? 'MEDIUM (Steady / Medium Mover)'
              : 'SLOW (Slow / Overstock)';
        const ontologyMatch = retrieveOntologyContext(userMessage, 4);

        let styleContext = `[Comprehensive Merchandising & Financial Telemetry for Style ${style.style_code}]:\n` +
          `- Style Code: ${style.style_code}\n` +
          `- Product Name: ${style.product_name}\n` +
          `- Assortment Category: ${style.category}\n` +
          `- Season Collection: ${style.season}\n` +
          `- EVALUATION SEQUENCE (CARINA POLICY): Step 1 Check Store vs WH & Cost x 1.15 Floor -> Step 2 Analyze STR % & Sales Speed (ROS, WOS, 1-Month / 4.3w arrival grace) FIRST -> Step 3 Evaluate Size Health (>= 1 unit across S, M, L, XL) SECOND -> Step 4 If Fast Mover + Broken Sizes, validate 4 Discount Planner Scenarios (Hold Full Price if <= 3.0 WOS sellout; WH Release + Bundle if WH >= 5u & store WOS <= 3.0; else Clearance Rail).\n` +
          `- Historical Total Sold (Lifetime) & Tenure: ${soldUnits} total units sold lifetime over ${speedEval.effectiveTenureWeeks.toFixed(1)} wks (${speedEval.strVelocityPctPerWeek.toFixed(1)}% STR/wk; 1-Month arrival grace = 4.3 wks)\n` +
          `- Current 8-Week Rolling Rate of Sale (ROS): ${style.weekly_ros} units/week [Do NOT say "${style.weekly_ros} units/week sold" — say "${style.weekly_ros} u/wk recent velocity" vs "${soldUnits} total units sold"]\n` +
          `- Certified Speed Band Classification: ${speedLabel} [${speedEval.speedBand}] — ${speedEval.reason}\n` +
          `- CARINA Speed Thresholds: FAST_HERO (>= 2.5 u/wk & <= 12 WOS, or >= 1.5 u/wk & <= 16 WOS for single-size); MEDIUM (>= 0.8 u/wk & <= 32 WOS); SLOW (< 0.8 u/wk or > 26-32 WOS); LAUNCH_SHIELD (<= 4.3 weeks / 1 month).\n` +
          `- Cumulative Sell-Through (STR): ${style.cumulative_str_pct}% total STR (evaluated BEFORE size health)\n` +
          `- Store Floor Stock & Door Runway: ${storeUnits} units across retail doors (${storeFloorWos.toFixed(1)} WOS door runway; Andalus=${style.stock_andalus}u, Yasmeen=${style.stock_yasmeen}u, Jouri=${style.stock_jouri}u)\n` +
          `- Central Warehouse (WH) Buffer & Network Tension: ${style.stock_wh} units sitting in WH reserve (${style.total_physical_stock} total network units = ${networkWos} WOS total network runway). Note: WH reserve vs store-floor runway tension determines whether to hold price & push WH replenishment or offer a multi-buy/alternative.\n` +
          `- Active Size Curve & Live Sizes (>= 1 unit/size required for healthy S, M, L, XL): ${style.sar_curve_health} (${sizesText}) | Single Size: ${isSingleSz ? 'YES' : 'NO'} | Core S/M/L/XL Intact: ${style.has_core_sizes === false || style.has_core_sizes === 0 ? 'NO' : 'YES'}\n` +
          `- Landed Unit Cost (COGS): ${style.unit_cost.toFixed(2)} SAR\n` +
          `- Saudi 15% VAT Legal Break-Even Floor: ${style.cost_plus_vat.toFixed(2)} SAR [Formula: Landed Cost x 1.15 = ${style.unit_cost.toFixed(2)} x 1.15]\n` +
          `- Original List Ticket Price: ${style.ticket_price.toFixed(2)} SAR\n` +
          `- Initial Sales Markup (IMU): ${imuVal}% [Formula: (Ticket Price - Cost) / Ticket Price * 100]\n`;

        if (ontologyMatch.promptBlock) {
          styleContext += `\n${ontologyMatch.promptBlock}\n`;
        }

        if (includeOfferContext) {
          styleContext +=
            `- Active Lifecycle Tier: ${style.lifecycle_tier || 'AUTO'}\n` +
            `- Recommended Offer / Policy: ${style.recommended_offer}\n` +
            `- Promotional Price: ${style.promotional_price.toFixed(2)} SAR (${style.discount_pct}% off list)\n` +
            `- Zero-Loss Compliance Status: ${style.zero_loss_status} (Promo ${style.promotional_price.toFixed(2)} SAR >= Legal Floor ${style.cost_plus_vat.toFixed(2)} SAR)\n` +
            `- Net Margin at Current Price: +${promoNetMargin} SAR/unit (${promoMarginPct}% ex-VAT net margin)\n` +
            `- Forecast Event Clearance: ${style.forecast_sold} units (${Math.round((style.forecast_sold / (style.total_physical_stock || 1)) * 100)}% of total stock, +${style.forecast_profit.toLocaleString()} SAR net profit)\n` +
            `- Deterministic Rationale: ${style.commercial_rationale}\n` +
            `- Plain-English Business Cause Behind Decision: ${deterministicNarrative}\n` +
            `- KSA Competitor Context (${comp.category}): Nayomi PI ${comp.priceIndexVsNayomi.toFixed(1)}%, Blooming PI ${comp.priceIndexVsBlooming.toFixed(1)}%, Blended PI ${comp.blendedMarketPriceIndex.toFixed(1)}% (${comp.competitivePosture}) | Tactical Counter: ${comp.tacticalCounterOffer}\n`;
        }

        if (alternativeScenariosContext) {
          styleContext += `\n[Pre-Computed VAT-Compliant Alternative Offer Options for Style ${style.style_code}]:\n${alternativeScenariosContext}\n`;
        }

        const openingBulletInstruction = alternativeScenariosContext
          ? `- IMMEDIATELY answer whether you recommend keeping **${style.recommended_offer}** OR switching to a specific alternative option, naming the #1 alternative with exact SAR price & margin:\n` +
            `  • **Recommendation Verdict:** [2-3 crisp sentences directly comparing keeping ${style.recommended_offer} vs the strongest alternative scenario above, considering ${style.weekly_ros} u/wk velocity, ${storeFloorWos.toFixed(1)} WOS door runway, and ${style.stock_wh}u WH reserve (${networkWos} WOS network).]\n`
          : (isDecisionWhyQuery || isOfferQuery)
            ? `- IMMEDIATELY explain WHY **${style.recommended_offer}** applies AND call out any important operational nuance (such as store-floor WOS vs ${style.stock_wh}u Central WH depth):\n` +
              `  • **Why This Decision Applies:** [2-3 clear, natural merchandising sentences explaining the real commercial logic—never sound like a template.]\n`
            : `- IMMEDIATELY answer the user's exact question in plain English first (for example, state clearly whether the style is **FAST**, **MEDIUM**, or **SLOW**, or give the exact answer requested):\n` +
              `  • **Direct Answer:** [2-3 crisp sentences directly answering the user's exact question with verified figures.]\n`;

        const systemPrompt = `You are CARINA's Senior Commercial Merchandising Strategist and Retail Pricing Analyst in Saudi Arabia.\n` +
          `Stores: Al-Andalus Mall Flagship (Jeddah, 260 m²), Al-Yasmeen Mall (Jeddah, 193 m²), Jouri Mall (Taif, 168 m²), Central Warehouse (WH).\n\n` +
          `RESPONSE STYLE (CONVERSATIONAL, SHARP, NON-ROBOTIC):\n` +
          `- Start with a clear Markdown title header:\n` +
          `  ### Commercial Decision Analysis — Style **${style.style_code}** (*${style.product_name}*)\n` +
          openingBulletInstruction +
          `- Follow with ONLY 2-3 concise, question-specific supporting bullets (do NOT dump a repetitive 4-part boilerplate list of fixed headings; pick only the insights relevant to THIS question, e.g., net margin expressed as '+X SAR/unit (Y%)', store vs WH stock tension, or VAT floor safety).\n` +
          `- Use prior chat history turns naturally if the user is following up on earlier turns.\n` +
          `- Keep total length crisp and executive (under 170 words), complete sentences, NO emojis or unicode icons.\n\n` +
          `CRITICAL GOVERNANCE RULES:\n` +
          (alternativeScenariosContext
            ? `1. COMPARE ALTERNATIVES HONESTLY: Explain both why ${style.recommended_offer} exists AND when picking the top computed alternative (with exact SAR price and net margin %) is smarter—never blindly repeat "0% Off" without weighing the ${style.stock_wh}u WH buffer!\n`
            : includeOfferContext
              ? `1. EXPLAIN WITH NUANCE: Focus directly on the drivers and store vs WH trade-offs behind ${style.recommended_offer}.\n`
              : `1. STAY FOCUSED ON WHAT WAS ASKED: Do not pitch unrelated discounts unless asked.\n`) +
          `2. PROHIBITED ACTIONS: If the user proposes a price below Cost x 1.15 (${style.cost_plus_vat.toFixed(2)} SAR) or breaking governance, state it is PROHIBITED with exact math and give a compliant alternative.\n` +
          (allowUnguidedMetrics
            ? `3. EXPLORATORY MODE ACTIVE: After verified bullets, finish with a two-line blockquote starting strictly with '> [!NOTE]' on line 1 and '> **Exploratory Hypothesis:** [1 sharp hypothesis specific to Style ${style.style_code} (${style.category}, ${storeUnits}u stores vs ${style.stock_wh}u WH) — NEVER generic boilerplate like "explore loyalty rewards"]' on line 2.`
            : `3. STRICT SSOT GOVERNED MODE: Stay strictly grounded in CARINA's verified telemetry dimensions. NEVER invent unguided metrics (Return Rate, Urgency Index, Social Buzz, Happiness).`
          );

        const buildPayloadForModel = (modelId: string) => ({
          messages: [
            { role: 'system', content: systemPrompt },
            ...recentHistory,
            { role: 'user', content: `${styleContext}\n\nUser Question: "${userMessage}"` }
          ],
          temperature: isExplicitFormulaMath ? 0.08 : 0.18,
          top_p: 0.90,
          top_k: 40,
          repetition_penalty: 1.15,
          seed: 42,
          max_tokens: modelId.includes('deepseek-r1') ? 1400 : 600
        });

        const tryModelChain = async (): Promise<{ reply: string; usedModel: string } | null> => {
          const candidates = Array.from(new Set([
            userModel!,
            '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
            '@cf/meta/llama-3.2-3b-instruct'
          ]));
          for (const candidate of candidates) {
            try {
              const perModelTimeout = candidate.includes('deepseek-r1') ? 15000 : 12000;
              const res = await raceWithTimeout<any>(
                env.AI.run(candidate, buildPayloadForModel(candidate)),
                perModelTimeout
              );
              const raw = res?.response || res?.choices?.[0]?.message?.content || (typeof res === 'string' ? res : '');
              const sanitized = sanitizeAiResponse(raw, style);
              if (sanitized && sanitized.trim().length >= 40) {
                return { reply: sanitized, usedModel: candidate };
              }
              console.warn(`Model ${candidate} yielded empty/insufficient reply after sanitization (len=${sanitized?.length || 0}), trying next fallback.`);
            } catch (modelErr: any) {
              console.warn(`Model ${candidate} error, trying next fallback:`, modelErr?.message || modelErr);
            }
          }
          return null;
        };

        const aiResult = await raceWithTimeout(tryModelChain(), 25000);

        if (aiResult && aiResult.reply) {
          const finalReply = alternativeOffersCard
            ? `${aiResult.reply}\n\n---\n\n${alternativeOffersCard}`
            : aiResult.reply;
          return {
            reply: finalReply,
            mode,
            activeStyleCode: style.style_code,
            activeStyleName: style.product_name,
            activeModel: aiResult.usedModel
          };
        }
      } catch (err: any) {
        console.warn('AI run warning, using natural-language analytical fallback:', err?.message || err);
      }
    }

    // Natural-language analytical fallback whenever Workers AI is unavailable, times out, or returns empty
    return {
      reply: alternativeOffersCard || buildStyleAnalyticalExplanation(style, lowerMsg, allowUnguidedMetrics),
      mode,
      activeStyleCode: style.style_code,
      activeStyleName: style.product_name
    };
  }

  // Case C: General assistant query (No specific style matched in context)
  // If user asks about an unspecified style ("this style", "this item", "its performance"), ask for clarification!
  if (asksForUnspecifiedStyle) {
    return {
      reply: `### Clarification Required\n\n` +
        `You asked about *"this style"*, but no specific style is currently in focus.\n\n` +
        `• Please enter the **5-digit style code** (e.g., \`59465\`, \`50177\`, \`59461\`) or the **product name**.\n` +
        `• Or click on any style code badge in the catalog table to immediately focus Copilot on that item.`,
      mode
    };
  }

  // Case C-0: Ontology-Grounded Ad-Hoc Analytical Query (Certified Term Resolution + Read-Only D1 SQL)
  if (env?.DB && isAnalyticalDataQuery(userMessage)) {
    try {
      const analyticalResult = await raceWithTimeout(
        runOntologyAnalyticalQuery({
          env,
          userMessage,
          allowUnguidedMetrics,
          modelOverride: request.model
        }),
        25000
      );
      if (analyticalResult && analyticalResult.reply) {
        return {
          reply: analyticalResult.reply,
          mode,
          activeModel: analyticalResult.usedModel || 'ontology-sql-planner'
        };
      }
    } catch (ontologyErr: any) {
      console.warn('Ontology analytical query warning, falling back to general telemetry AI:', ontologyErr?.message || ontologyErr);
    }
  }

  // For any general retail question, calculation, methodology, or commercial check:
  // RUN WORKERS AI WITH GENERAL RETAIL TELEMETRY + CERTIFIED ONTOLOGY CONTEXT!
  const ontologySlice = retrieveOntologyContext(userMessage, 4);
  const isGeneralMath = /\b(formula|calculate|math|proof|vat|floor|derivation)\b/i.test(lowerMsg);
  let genModel = request.model && request.model !== 'auto' ? request.model : undefined;
  if (!genModel) {
    genModel = isGeneralMath 
      ? '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b' 
      : '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
  }

  const liveTelemetry = await fetchLiveCatalogTelemetry(env?.DB);
  const stylesLabel = liveTelemetry ? `${liveTelemetry.styleCount.toLocaleString()} active styles` : 'all active catalog styles';
  const unitsLabel = liveTelemetry ? `${liveTelemetry.totalStock.toLocaleString()} physical units` : 'live on-hand store/warehouse stock';
  const strLabel = liveTelemetry ? `${liveTelemetry.avgSTR.toFixed(1)}%` : 'live catalog average';
  const rosLabel = liveTelemetry ? `${liveTelemetry.avgROS.toFixed(2)} units/week` : 'live 8-week velocity';
  const retailLabel = liveTelemetry ? `${Math.round(liveTelemetry.totalRetailSAR).toLocaleString()} SAR` : 'N/A (no D1 bound)';
  const costLabel = liveTelemetry ? `${Math.round(liveTelemetry.totalCostSAR).toLocaleString()} SAR` : 'N/A';
  const imuLabel = liveTelemetry ? `${liveTelemetry.blendedIMU.toFixed(1)}%` : 'N/A';
  const liqUnitsLabel = liveTelemetry ? `${Math.round(liveTelemetry.projectedLiquidationUnits).toLocaleString()} units` : 'projected event units';
  const liqProfitSign = liveTelemetry && liveTelemetry.projectedProfitSAR >= 0 ? '+' : '';
  const liqProfitLabel = liveTelemetry ? `${liqProfitSign}${Math.round(liveTelemetry.projectedProfitSAR).toLocaleString()} SAR` : 'net cash margin contribution';
  const winterPctLabel = liveTelemetry ? `${liveTelemetry.winterProtectedPct.toFixed(1)}%` : 'fresh winter assortment depth';

  if (env?.AI) {
    try {
      const generalContext = `[CARINA Commercial & Retail Architecture Telemetry]:\n` +
        `- Retail Network: Al-Andalus Mall Flagship (Jeddah, 260 m²), Al-Yasmeen Mall (Jeddah, 193 m²), Jouri Mall (Taif, 168 m²), Central Warehouse (WH).\n` +
        `- Total Sales Floor Area: 621 m² physical retail space across Western Region (KSA).\n` +
        `- Total Physical Inventory Catalog: ${stylesLabel}, ${unitsLabel} on-hand.\n` +
        `- Sales Performance & Velocity: Cumulative Sell-Through (STR) = ${strLabel}; Rolling 8-Week Velocity (ROS) = ${rosLabel} per active style.\n` +
        `- Portfolio Valuation: Total Retail Ticket Value = ${retailLabel} | Landed Cost Capital = ${costLabel} | Blended Initial Markup (IMU) = ${imuLabel}.\n` +
        `- Evaluation Order & Drop Grace Window:\n` +
        `  * Evaluation Order: Always analyze STR % & Sales Speed (ROS, WOS, and 1-Month / 4.3-week arrival grace window) BEFORE checking Size Health (>= 1 unit per size across S, M, L, XL).\n` +
        `  * Broken Fast-Mover Rule: When a fast seller (ROS >= 2.0 u/wk) has broken sizes, evaluate 4 scenarios: hold Full Price if remaining stock sells out in <= 3.0 WOS; Release WH + gentle Buy-2 / Full Price if WH >= 5u & store WOS <= 3.0; else route > 3.0 WOS tail to Clearance.\n` +
        `- Size Demand Hierarchy & Curve Dynamics (Saudi Retail Market):\n` +
        `  * Core Sized Apparel (Bras, Tops, Pyjamas, Dresses): ALL 4 core sizes (**S, M, L, XL**) must carry >= 1 unit per size (or dual-letter SM + LXL equivalent, with verified M-3XL / M-2XL allowance only where size S never existed). Missing any core size (S, M, L, or XL = 0 units) or having < 3 active sizes (>= 1u) creates a Broken Curve ('Broken Curve (Non-Core Sizes)' or 'Broken Curve (<=2 Sizes)').\n` +
        `  * Non-Sized & Single-Size Assortments (Cosmetics, Body Splashes, Fragrances 100ML/50ML, Towels, Socks, Accessories, One-Size robes): These products have 1 complete size by design ('Single Size (Complete)'). They are NEVER broken oddments and are merchandised as basket boosters ('Spend 250 Save 50', low-ticket multi-packs, or full price) while strictly clearing Saudi VAT Cost x 1.15 floors.\n` +
        `- Store Densities & Clearance Priorities:\n` +
        `  * Al-Andalus Mall Flagship (Jeddah, 260 m²): Balanced sales floor density.\n` +
        `  * Al-Yasmeen Mall (Jeddah, 193 m²): Overstocked floor (>55 units/m²), priority candidate for promotional markdown.\n` +
        `  * Jouri Mall (Taif, 168 m²): Critical bottleneck (>60 units/m²), priority candidate for clearance multi-buy rails before winter weather.\n` +
        `  * Central Warehouse (WH): Reserve replenishment buffer.\n` +
        `- Campaign Clearance Projection: ${liqUnitsLabel} projected for event clearance, generating ${liqProfitLabel} net cash margin contribution.\n` +
        `- Saudi Legal Pricing Floor Rule: Promotional retail price MUST be greater than or equal to Landed Unit Cost multiplied by 1.15 (15% VAT). Selling below this floor is legally prohibited under Saudi retail regulations.\n` +
        `- Winter Assortment Protection: ${winterPctLabel} of fresh Winter (AW26 / FW26) unit depth is currently protected at Full Price.\n` +
        `- Core Retail Formulas:\n` +
        `  * Store Runway / Weeks of Supply (WOS) = Total Physical Stock / Weekly ROS (Rate of Sale)\n` +
        `  * Weekly ROS = Units sold over past 8 weeks / 8 weeks\n` +
        `  * Cumulative Sell-Through (STR) = Cumulative Units Sold / (Cumulative Units Sold + Remaining Stock) * 100\n` +
        `  * Initial Sales Markup (IMU) = (Ticket Price - Landed Cost) / Ticket Price * 100\n` +
        `  * Net Promo Margin = (Promotional Price / 1.15) - Landed Unit Cost\n` +
        `- Macro & Regional Crisis Context:\n` +
        `  * Jeddah Islamic Port logistics: Inbound Red Sea maritime rerouting inflates lead times by 14-25 days; maintain 6-8 week buffer at Central WH, never dump continuity winter basics.\n` +
        `  * Payday Liquidity: National payday on 27th of every Gregorian month triggers liquidity surge (25th to 2nd).\n` +
        `  * BNPL: High Tabby and Tamara adoption (checkout >= 100 SAR); Spend 250 Save 50 multi-buys preserve basket size.\n\n` +
        `${ontologySlice.promptBlock}\n`;

      const generalSystemPrompt = `You are CARINA Senior Commercial Merchandising Strategist and Retail Pricing Analyst in Saudi Arabia.\n\n` +
        `CORE CAPABILITIES & RULES:\n` +
        `1. COMPREHENSIVE COMMERCIAL PLANNING & CAPABILITIES:\n` +
        `   - You ARE CARINA's automated White Friday, promotional discount, and markdown optimization intelligence across all stores in Saudi Arabia (KSA).\n` +
        `   - When asked if you can plan offers or discounts: Confirm YES. Explain that offers are dynamically calibrated by merchandise department and price point (e.g. low-ticket items strictly validated above VAT Cost x 1.15; Pyjamas/Bras: floor-safe bundles or Spend 250 Save 50; Broken curves: Safe Clearance rails), strictly complying with Saudi Ministry of Commerce zero-loss regulations (Price >= Landed Cost x 1.15).\n` +
        `   - NEVER propose a fixed "Take 3 For 99 SAR" offer blindly on low-ticket categories or high-cost items where 33 SAR/unit falls below Cost x 1.15. Bundle unit prices must ALWAYS stay >= Cost x 1.15 and < Ticket Price.\n` +
        `   - NEVER answer with a bare monosyllable like "Yes" or "No". Even if the user asks "confirm yes or no" or "just say yes or no", confirm clearly and explain the commercial framework, store allocations, and governance boundaries.\n` +
        `2. ANSWER ANY QUESTION OR CALCULATION DIRECTLY: Answer the user's analytical, mathematical, operational, or retail question directly and intelligently using the provided telemetry and formulas.\n` +
        `3. EVALUATION ORDER & SIZE DEMAND HIERARCHY:\n` +
        `   - Analyze STR % and Sales Speed (ROS, WOS, 1-Month / 4.3-week launch grace window) BEFORE evaluating Size Health.\n` +
        `   - Core sizes (**S, M, L, XL** with >= 1 unit per core size) apply ONLY to sized apparel garments (Bras, Pyjamas, Tops, Dresses).\n` +
        `   - Broken Fast Movers (ROS >= 2.0 u/wk with missing core sizes): Hold Full Price if selling out within <= 3.0 WOS, or Release WH + gentle Buy-2 if WH >= 5u & Store WOS <= 3.0.\n` +
        `   - Single-size categories (Socks, Cosmetics, Fragrances, Towels, One-Size accessories) have NO multi-size core requirement ('Single Size (Complete)'). NEVER classify valid Single-Size items as broken curves.\n` +
        `4. PROHIBITED ACTIONS: If the user suggests or asks about a price or action that is prohibited (such as selling below landed cost plus 15% VAT, or deep discounting fresh winter collections, or mixing damaged/virtual stock onto sales floors), explicitly state: "Prohibited Action: ..." and explain the regulatory or commercial reason.\n` +
        `5. STRICT EXECUTIVE ORGANIZATION: Always structure your response with a clean Markdown title header and organized bullet points (•) with bold category labels. NEVER output a continuous unformatted block of text. Under 180 words. Strictly NO emojis or unicode icons in your output.\n` +
        (allowUnguidedMetrics 
          ? `6. EXPLORATORY ANALYSIS MODE ACTIVE: You are authorized to synthesize qualitative and unguided market hypotheses (consumer sentiment, brand equity, price elasticity). Format your answer in two clear tiers: 1. Verified CARINA Telemetry, 2. Exploratory & Qualitative Assessment with a 'Exploratory Hypothesis' label.`
          : `6. STRICT SSOT GOVERNED MODE: You are locked to CARINA's 7 verified SSOT dimensions. NEVER invent unguided metrics or arbitrary multipliers (e.g. Return Rate, Urgency Index, Social Buzz, Happiness). If asked about an unguided metric, state clearly that it is outside CARINA's 7 validated SSOT physical retail dimensions.`
        );

      const buildGeneralPayload = (modelId: string) => ({
        messages: [
          { role: 'system', content: generalSystemPrompt },
          ...recentHistory,
          { role: 'user', content: `${generalContext}\n\nUser Question: "${userMessage}"` }
        ],
        temperature: isGeneralMath ? 0.08 : 0.15,
        top_p: 0.90,
        top_k: 40,
        repetition_penalty: 1.15,
        seed: 42,
        max_tokens: modelId.includes('deepseek-r1') ? 1400 : (isGeneralMath ? 320 : 420)
      });

      const executeGenChain = async (): Promise<{ reply: string; usedModel: string } | null> => {
        const candidates = Array.from(new Set([
          genModel!,
          '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
          '@cf/meta/llama-3.2-3b-instruct'
        ]));
        for (const candidate of candidates) {
          try {
            const perModelTimeout = candidate.includes('deepseek-r1') ? 15000 : 12000;
            const res = await raceWithTimeout<any>(
              env.AI.run(candidate, buildGeneralPayload(candidate)),
              perModelTimeout
            );
            const raw = res?.response || res?.choices?.[0]?.message?.content || (typeof res === 'string' ? res : '');
            const cleanReply = sanitizeAiResponse(raw);
            if (cleanReply && cleanReply.trim().length >= 25) {
              return { reply: cleanReply, usedModel: candidate };
            }
            console.warn(`General model ${candidate} yielded empty/short reply after sanitization (len=${cleanReply?.length || 0}), trying next fallback.`);
          } catch (err: any) {
            console.warn(`General model ${candidate} error, trying next fallback:`, err?.message || err);
          }
        }
        return null;
      };

      const aiResult = await raceWithTimeout(executeGenChain(), 25000);
      if (aiResult && aiResult.reply) {
        return {
          reply: aiResult.reply,
          mode,
          activeModel: aiResult.usedModel
        };
      }
    } catch (err: any) {
      console.warn('General AI run warning:', err?.message || err);

      // Contextual fallback for White Friday / campaign planning
      if (/white friday|black friday|plan|campaign/i.test(lowerMsg)) {
        return {
          reply: `### White Friday Promotional Architecture (KSA)\n\n` +
            `Yes — the automated discount planner actively plans promotional and pricing strategies across **${stylesLabel}** (**${unitsLabel}**) in Saudi Arabia:\n\n` +
            `• **Dedicated Clearance Rails (Floor-Safe % Off & Multi-Buys):** Applied to slow-turning inventory, summer exits, and broken curves (missing core S/M/L/XL or <=2 sizes) to decongest store floors in Taif and Jeddah.\n` +
            `• **Multi-Buy Basket Packs (Spend 250 Save 50 & Dynamic Bundles):** Applied to high-demand core styles above VAT cost floors to maximize basket size while preserving margin.\n` +
            `• **Assortment Protection (0% Off Full Price):** Currently shields ${winterPctLabel} of fresh Winter (AW26 / FW26) unit depth.\n` +
            `• **Saudi Legal Zero-Loss Guard:** Enforces 100% compliance with Saudi retail pricing regulations (Price >= Landed Cost x 1.15).`,
          mode
        };
      }

      // Contextual fallback for size demand and curve dynamics if AI times out
      if (/sizes?|curve/i.test(lowerMsg)) {
        return {
          reply: `### Size Demand & Curve Dynamics (Saudi Retail Network)\n\n` +
            `• **Evaluation Sequence:** CARINA analyzes **STR % & Sales Speed (with a 1-Month / 4.3-week arrival grace window)** BEFORE checking Size Health.\n` +
            `• **Strict Core Sizes (S, M, L, XL):** Healthy retail apparel styles must carry **>= 1 unit** across all four core sizes (**S, M, L, XL**, including dual-letter SM/LXL equivalents).\n` +
            `• **Extended Plus-Line Allowance (M-3XL / M-2XL):** Verified styles where Small (S) never existed in historical Odoo receipts remain Healthy when **M, L, XL, and 2XL/3XL** each carry >= 1 unit.\n` +
            `• **Broken Curve Triggers & Fast-Mover Scenario Exception:** Styles missing any required core size (**0 units**) or having **<= 2 active sizes** route to clearance unless they are **Broken Fast Movers** (<= 3.0 WOS sellout holds Full Price; WH >= 5u transfers with gentle Buy-2).\n` +
            `• **Single-Size Exception:** Socks, One-Size (OS/FREE), Cosmetics, Fragrances, and accessories classify as **Single Size (Complete)** rather than broken curves.`,
          mode
        };
      }

      // Contextual fallback for sales performance analysis if AI times out
      if (/sales|performance|overall|kpi|density|str|ros|clearance/i.test(lowerMsg)) {
        return {
          reply: `### CARINA Assortment & Sales Performance Analysis\n\n` +
            `• **Catalog Volume & Velocity:** ${stylesLabel} with **${unitsLabel}** on-hand across the store network. Catalog average Sell-Through Rate (STR) is **${strLabel}** with an 8-week average rate of sale of **${rosLabel}**.\n` +
            `• **Store Floor Densities & Bottlenecks:**\n` +
            `  - **Al-Andalus Mall Flagship (Jeddah, 260 m²):** Healthy, balanced sales floor turnover.\n` +
            `  - **Al-Yasmeen Mall (Jeddah, 193 m²):** Overstocked floor (>55 units/m²); priority candidate for accelerated clearance to free retail display space.\n` +
            `  - **Jouri Mall (Taif, 168 m²):** Critical bottleneck (>60 units/m²); top candidate for floor-safe clearance rails.\n` +
            `• **Event Financial Leverage:** Event simulation projects clearance of **${liqUnitsLabel}**, generating **${liqProfitLabel}** net cash margin contribution.\n` +
            `• **Governance Compliance:** All promotional recommendations strictly enforce the Saudi 15% VAT floor (Price >= Cost x 1.15) and protect ${winterPctLabel} of fresh Winter (AW26 / FW26) unit depth.`,
          mode
        };
      }
    }
  }

  return {
    reply: `### CARINA Merchandising Intelligence\n\n` +
      `• **Saudi VAT Floor:** Enforcing promotional pricing strictly above landed cost plus 15% VAT across **${stylesLabel}**.\n` +
      `• **Physical Stores:** Al-Andalus (260 m²), Al-Yasmeen (193 m²), Jouri Mall Taif (168 m²), and Central Warehouse (WH). Virtual and damaged locations excluded.\n` +
      `• **Assortment Protection:** Currently retaining **${winterPctLabel}** of fresh Winter (AW26 / FW26) unit depth at Full Price.\n\n` +
      `*Tip: Enter any style code (e.g. \`59465\`, \`59461\`, \`50177\`) or product name for an instant live breakdown.*`,
    mode
  };
}
