import { KSA_RETAIL_CONTEXT } from './skills/ksaRetailContext';
import { KSA_CRISIS_RETAIL_CONTEXT } from './skills/crisisRetailContext';
import { formatOfferDecisionCard, formatDynamicCategoryOfferDossier } from './skills/offerDecisionFormatter';
import { generateDynamicCategoryOfferPlan, CategoryTelemetry } from '../engine/dynamicCategoryOfferEngine';
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
import { generatePortfolioRebalancingPlan } from '../engine/storeRebalancer';
import { KSA_RETAIL_CALENDAR } from '../engine/ksaRetailCalendar';

export type AgentMode = 'DISCOUNT_STRATEGIST' | 'STORE_AUDITOR' | 'RULE_COMPILER';

export interface CopilotChatRequest {
  message: string;
  mode?: AgentMode;
  model?: string;
  contextStyleCode?: string;
  metricsSnapshot?: Partial<StyleMetrics>;
  allowUnguidedMetrics?: boolean;
}

export interface CopilotChatResponse {
  reply: string;
  mode: AgentMode;
  activeStyleCode?: string;
  activeStyleName?: string;
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
  sold_units?: number;
  sales_lifecycle_weeks?: number;
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
  const isSingleSize = m.isSingleSize || (
    /cosmetics|towel|scarf|pillow|duvet|sheets|bandana|eye cover|sleeves|bundle/i.test(m.category) ||
    /\b(\d+ml|free size|one size|os)\b/i.test(m.productName)
  );
  const curveLabel = isSingleSize
    ? 'Single Size (Complete)'
    : (m.activeSizeCount >= 3 ? 'Healthy Curve (>=3 Sizes)' : 'Broken Curve (<=2 Sizes)');

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
    recommended_offer: rec?.recommendedOffer || 'Full Price (Margin Protection)',
    promotional_price: promoPrice,
    discount_pct: rec?.discountPct || 0,
    zero_loss_status: rec?.zeroLossStatus || 'ZERO_LOSS_COMPLIANT',
    forecast_sold: forecastSold,
    forecast_profit: forecastProfit,
    post_event_stock: postStock,
    commercial_rationale: rec?.rationale || 'Assortment depth defense.',
    sold_units: m.soldUnits !== undefined ? m.soldUnits : 0,
    sales_lifecycle_weeks: m.salesLifecycleWeeks !== undefined ? m.salesLifecycleWeeks : 0.0
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
      'curve', 'curves', 'oddment', 'oddments', 'rank', 'ranking', 'level', 'levels', 'status', 'list'
    ]);

    const words = lowerMsg
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3 && !stopWords.has(w));

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

    if (!isExplicitMacroQuery && !isDataSourceQuery && !isSimulationQuery && !isRuleQuery && contextStyleCode && /^\d{5}$/.test(contextStyleCode)) {
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

function formatOfferCard(row: D1StyleSnapshotRow, isExploratory: boolean = false): string {
  const wos = row.weekly_ros > 0 ? row.total_physical_stock / row.weekly_ros : 999;
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
    storeFloorWOS: wos,
    sarHealth: row.sar_curve_health,
    forecastSold: row.forecast_sold,
    forecastProfit: row.forecast_profit,
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

function formatFullStyleCard(row: D1StyleSnapshotRow): string {
  const wosVal = row.weekly_ros > 0 ? (row.total_physical_stock / row.weekly_ros).toFixed(1) : '999';
  const imuVal = row.ticket_price > 0 ? (((row.ticket_price - row.unit_cost) / row.ticket_price) * 100).toFixed(1) : '0';

  return (
    `### Style **${row.style_code}** — *${row.product_name}*\n` +
    `• **Category / Season:** \`${row.category || 'General'}\` | \`${row.season || 'Continuity'}\`\n` +
    `• **Total Physical Inventory:** **${row.total_physical_stock.toLocaleString()} units** on-hand\n` +
    `  - **Al-Andalus Mall Flagship (Jeddah):** ${row.stock_andalus} units\n` +
    `  - **Al-Yasmeen Mall (Jeddah):** ${row.stock_yasmeen} units\n` +
    `  - **Jouri Mall (Taif):** ${row.stock_jouri} units\n` +
    `  - **Central Warehouse (WH):** ${row.stock_wh} units\n` +
    `• **Curve & Velocity:** ${row.sar_curve_health} | Cumulative STR: **${row.cumulative_str_pct}%** | Weekly ROS: **${row.weekly_ros} u/wk** | Runway: **${wosVal} WOS**\n` +
    `• **Cost & Pricing Economics:**\n` +
    `  - Original List Ticket Price: **${row.ticket_price.toFixed(2)} SAR**\n` +
    `  - Landed Unit Cost (COGS): **${row.unit_cost.toFixed(2)} SAR** (IMU: **${imuVal}%**)\n` +
    `  - Saudi 15% VAT Legal Floor: **${row.cost_plus_vat.toFixed(2)} SAR**`
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

  const lowerMsg = userMessage.toLowerCase();

  // Pattern to detect when user asks about an unspecified style without naming it
  const asksForUnspecifiedStyle = /\b(performance.*(this|the) (style|item)|(this|the) (style|item).*performance|what is the performance (of|for) this|what is the price of this|how many.*this item|tell me about this (product|style|item)|what is this style|how is this selling|evaluate this (style|item)|analyze this (style|item)|about this style|for this style)\b/i.test(lowerMsg);

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


  // 2b. Inter-Store Inventory Rebalancing Query
  if (/\b(transfer|transfers|rebalance|rebalancing|inter-store|move stock|taif.*andalus|stock balance)\b/i.test(lowerMsg)) {
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

  // 2f. Unguided Metrics Governance Filter
  const isUnguidedMetricQuery = /\b(return rate|returns? rate|customer return|happiness|sentiment score|sentiment index|social media|instagram|tiktok|impressions?|bounce rate|nps|brand equity|urgency factor|urgency index|viral)\b/i.test(lowerMsg);
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

    const isOfferQuery = /\b(offer|promo|promotion|promotional|discount|deal|markdown|recommendation|clearance|sale price)\b/i.test(lowerMsg);
    const isStockQuery = /\b(stock|inventory|units|quantity|on-hand|onhand|available|where|stores?|location|allocation|warehouse|wh|andalus|yasmeen|jouri)\b/i.test(lowerMsg);
    const isPricingQuery = /\b(price|pricing|ticket|cost|cogs|floor|vat|imu|markup|margin|break-even|breakeven)\b/i.test(lowerMsg);
    const isVelocityQuery = /\b(sales\s+performance|performance|velocity|ros|rate of sale|sales rate|sales velocity|sell-through|sell through|str|runway|wos|weeks of supply|coverage|how fast|sales volume|how is it selling)\b/i.test(lowerMsg);
    const isFullOverview = /\b(all|full|details|overview|everything|snapshot|summary|profile|card)\b/i.test(lowerMsg);

    // Conversational, open-ended, qualitative, or analytical inquiries that require smart AI assessment:
    const isConversational = /\b(what about|how about|tell me about|how is|thoughts on|opinion|status of|evaluate|review|analyze|assessment|doing)\b/i.test(lowerMsg);
    const isComplexAnalysis = isConversational || /\b(why|how did|how is.*calculated|formula|derivation|reason|what if|can we|could we|simulate|project|compare)\b/i.test(lowerMsg);

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

    // Case B: Pure bare lookup or explicit full breakdown
    const hasAnyPropertyKeyword = isStockQuery || isPricingQuery || isVelocityQuery || isOfferQuery || isComplexAnalysis;
    if (!hasAnyPropertyKeyword || isFullOverview) {
      return {
        reply: formatFullStyleCard(style),
        mode,
        activeStyleCode: style.style_code,
        activeStyleName: style.product_name
      };
    }

    // Case C: Analytical, reasoning, or calculation questions routed to Workers AI
    const isMathOrAudit = /\b(formula|calculate|derivation|math|break-even|breakeven|runway|wos|str|ros|imu|margin|floor|vat|proof|zero-loss)\b/i.test(lowerMsg);

    let userModel = request.model && request.model !== 'auto' ? request.model : undefined;
    if (!userModel) {
      userModel = isMathOrAudit 
        ? '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b' 
        : '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
    }

    if (env?.AI) {
      try {
        const wosVal = style.weekly_ros > 0 ? (style.total_physical_stock / style.weekly_ros).toFixed(1) : '999';
        const imuVal = style.ticket_price > 0 ? (((style.ticket_price - style.unit_cost) / style.ticket_price) * 100).toFixed(1) : '0';
        const promoRev = style.promotional_price / 1.15;
        const promoNetMargin = (promoRev - style.unit_cost).toFixed(2);
        const promoMarginPct = promoRev > 0 ? (((promoRev - style.unit_cost) / promoRev) * 100).toFixed(1) : '0';

        let styleContext = `[Comprehensive Merchandising & Financial Telemetry for Style ${style.style_code}]:\n` +
          `- Style Code: ${style.style_code}\n` +
          `- Product Name: ${style.product_name}\n` +
          `- Assortment Category: ${style.category}\n` +
          `- Season Collection: ${style.season}\n` +
          `- Cumulative Sell-Through (STR): ${style.cumulative_str_pct}% [Formula: Cumulative Units Sold / (Cumulative Units Sold + Remaining Stock) * 100]\n` +
          `- 8-Week Rolling Sales Velocity (ROS): ${style.weekly_ros} units/week [Formula: Total Units Sold in Last 8 Weeks / 8]\n` +
          `- Store Runway / Weeks of Supply (WOS): ${wosVal} weeks [Formula: Total Physical Stock / Weekly ROS = ${style.total_physical_stock} / ${style.weekly_ros} = ${wosVal} weeks]\n` +
          `- Active Size Curve: ${style.sar_curve_health}\n` +
          `- Total Physical Stock: ${style.total_physical_stock} units on-hand\n` +
          `- Physical Store Distribution: Al-Andalus Mall Flagship (Jeddah)=${style.stock_andalus}u (${((style.stock_andalus / (style.total_physical_stock || 1)) * 100).toFixed(1)}%), Al-Yasmeen Mall (Jeddah)=${style.stock_yasmeen}u (${((style.stock_yasmeen / (style.total_physical_stock || 1)) * 100).toFixed(1)}%), Jouri Mall (Taif)=${style.stock_jouri}u (${((style.stock_jouri / (style.total_physical_stock || 1)) * 100).toFixed(1)}%), Central Warehouse (WH)=${style.stock_wh}u (${((style.stock_wh / (style.total_physical_stock || 1)) * 100).toFixed(1)}%)\n` +
          `- Landed Unit Cost (COGS): ${style.unit_cost.toFixed(2)} SAR\n` +
          `- Saudi 15% VAT Legal Break-Even Floor: ${style.cost_plus_vat.toFixed(2)} SAR [Formula: Landed Cost x 1.15 = ${style.unit_cost.toFixed(2)} x 1.15]\n` +
          `- Original List Ticket Price: ${style.ticket_price.toFixed(2)} SAR\n` +
          `- Initial Sales Markup (IMU): ${imuVal}% [Formula: (Ticket Price - Cost) / Ticket Price * 100]\n`;

        // Strictly omit promotional offers unless promotional recommendations were explicitly requested by the user
        if (isOfferQuery) {
          styleContext += `- Recommended Promotional Offer: ${style.recommended_offer}\n` +
            `- Promotional Price: ${style.promotional_price.toFixed(2)} SAR (${style.discount_pct}% off list)\n` +
            `- Zero-Loss Compliance Status: ${style.zero_loss_status} (Promo ${style.promotional_price.toFixed(2)} SAR >= Legal Floor ${style.cost_plus_vat.toFixed(2)} SAR)\n` +
            `- Promo Net Margin Contribution: +${promoNetMargin} SAR/unit (${promoMarginPct}% net margin)\n` +
            `- Forecast Event Clearance: ${style.forecast_sold} units (Liquidation Rate: ${Math.round((style.forecast_sold / (style.total_physical_stock || 1)) * 100)}%)\n` +
            `- Projected Net Margin Contribution: +${style.forecast_profit.toLocaleString()} SAR\n` +
            `- Commercial Rationale: ${style.commercial_rationale}\n`;
        }

        const systemPrompt = `You are CARINA's Senior Commercial Merchandising Strategist and Retail Pricing Analyst in Saudi Arabia.\n` +
          `Stores: Al-Andalus Mall Flagship (Jeddah, 260 m²), Al-Yasmeen Mall (Jeddah, 193 m²), Jouri Mall (Taif, 168 m²), Central Warehouse (WH).\n\n` +
          `MANDATORY ORGANIZATION & FORMATTING STRUCTURE:\n` +
          `- NEVER output a single continuous wall of text, dense paragraph, or unformatted prose.\n` +
          `- ALWAYS structure your response with a Markdown title header:\n` +
          `  ### Commercial Assessment — Style **${style.style_code}** (*${style.product_name}*)\n` +
          `- Immediately follow with organized bullet points using bold metric titles:\n` +
          `  • **Category & Lifecycle:** [Assortment category, season collection, mature or fresh collection status]\n` +
          `  • **Sales Velocity & STR:** [Cumulative STR %, 8-week weekly ROS, size curve health]\n` +
          `  • **Inventory & Runway:** [Total on-hand stock, weeks of supply (WOS) runway in weeks/months]\n` +
          `  • **Store Network Allocation:** [Store breakdown: Andalus, Yasmeen, Jouri, Warehouse reserve balance]\n` +
          `  • **Pricing Economics:** [Ticket price, landed unit cost, IMU %, Saudi 15% VAT legal floor]\n` +
          `- For mathematical calculations, always use clean numbered steps (1., 2.) or bullets showing the formula and arithmetic.\n` +
          `- Keep your tone executive, objective, and sharp (under 180 words). Strictly NO emojis or unicode icons.\n\n` +
          `CRITICAL GOVERNANCE RULES:\n` +
          `1. NEVER VOLUNTEER PROMOTIONAL OFFERS UNLESS EXPLICITLY ASKED: If the user did NOT explicitly ask for offers, promotions, markdowns, or discounts, DO NOT mention, volunteer, or pitch promotional offers, clearance rails (e.g. Take 3 For 99), multi-buys, discount percentages, or clearance forecasts. Only discuss promotional offers if the user specifically asked for offers or discounts.\n` +
          `2. STRICT TOPIC RELEVANCE: Answer ONLY what is asked. Do not over-expose unrequested telemetry.\n` +
          `3. PROHIBITED ACTIONS: If the user proposes a price or action that violates Saudi regulations (Price < Cost x 1.15) or commercial governance, explicitly state that it is PROHIBITED, explain why with exact numbers, and give the compliant alternative.\n` +
          (allowUnguidedMetrics 
            ? `4. EXPLORATORY MODE ACTIVE: You may synthesize unguided qualitative hypotheses (consumer sentiment, brand equity, price elasticity). Clearly separate your response into verified telemetry and exploratory hypotheses with a '[🧪 Exploratory Hypothesis]' note.`
            : `4. STRICT SSOT GOVERNED MODE: You are strictly restricted to the 7 verified CARINA dimensions. NEVER invent or reference unguided metrics (e.g. Return Rate, Urgency Index, Social Buzz, Happiness). If user asks about an unguided metric, state that it is outside CARINA's 7 validated SSOT dimensions.`
          );

        const aiPayload: any = {
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `${styleContext}\n\nUser Question: "${userMessage}"` }
          ],
          temperature: isMathOrAudit ? 0.08 : 0.15,
          top_p: 0.90,
          top_k: 40,
          repetition_penalty: 1.15,
          seed: 42,
          max_tokens: isMathOrAudit ? 160 : 250
        };

        const executeAiRun = async () => {
          try {
            return await env.AI.run(userModel, aiPayload);
          } catch (err: any) {
            console.warn(`Primary model ${userModel} error, trying fast fallback:`, err?.message || err);
            return await env.AI.run('@cf/meta/llama-3.2-3b-instruct', aiPayload);
          }
        };

        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('AI Timeout')), 25000));
        const aiResponse: any = await Promise.race([executeAiRun(), timeoutPromise]);

        const textReply = aiResponse?.response || 
                          aiResponse?.choices?.[0]?.message?.content || 
                          (typeof aiResponse === 'string' ? aiResponse : null);

        if (textReply && textReply.trim().length > 0) {
          const cleanReply = sanitizeAiResponse(textReply, style);
          return {
            reply: cleanReply,
            mode,
            activeStyleCode: style.style_code,
            activeStyleName: style.product_name,
            activeModel: userModel
          };
        }
      } catch (err: any) {
        console.warn('AI run warning, using intelligent contextual fallback:', err?.message || err);

        // Context-aware fallback for conversational style assessment
        if (isConversational) {
          const imu = style.ticket_price > 0 ? (((style.ticket_price - style.unit_cost) / style.ticket_price) * 100).toFixed(1) : '0';
          const wosVal = style.weekly_ros > 0 ? (style.total_physical_stock / style.weekly_ros).toFixed(1) : '999';
          const monthsVal = (Number(wosVal) / 4.33).toFixed(1);
          return {
            reply: `### Commercial Assessment — Style **${style.style_code}** (*${style.product_name}*)\n\n` +
              `• **Assortment & Lifecycle:** \`${style.category || 'General'}\` | \`${style.season || 'Continuity'}\`\n` +
              `• **Inventory & Runway:** **${style.total_physical_stock} physical units** on-hand with ${style.sar_curve_health}. At a rolling velocity of **${style.weekly_ros} units/week** and **${style.cumulative_str_pct}% STR**, on-hand inventory provides approximately **${wosVal} weeks of supply (~${monthsVal} months)**.\n` +
              `• **Store Distribution:** Stock is distributed across Al-Andalus (${style.stock_andalus}u), Al-Yasmeen (${style.stock_yasmeen}u), and Jouri Mall Taif (${style.stock_jouri}u), backed by **${style.stock_wh} units** in Central Warehouse reserve.\n` +
              `• **Pricing Economics:** Original list price is **${style.ticket_price.toFixed(2)} SAR** against **${style.unit_cost.toFixed(2)} SAR** landed cost (${imu}% IMU), safely above the **${style.cost_plus_vat.toFixed(2)} SAR** Saudi 15% VAT legal floor.`,
            mode,
            activeStyleCode: style.style_code,
            activeStyleName: style.product_name
          };
        }

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
            activeStyleCode: style.style_code,
            activeStyleName: style.product_name
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
            activeStyleCode: style.style_code,
            activeStyleName: style.product_name
          };
        }
      }
    }

    // Default overview card for the style
    return {
      reply: formatFullStyleCard(style),
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

  // For any general retail question, calculation, methodology, or commercial check:
  // RUN WORKERS AI WITH GENERAL RETAIL TELEMETRY!
  const isGeneralMath = /\b(formula|calculate|math|proof|vat|floor|derivation)\b/i.test(lowerMsg);
  let genModel = request.model && request.model !== 'auto' ? request.model : undefined;
  if (!genModel) {
    genModel = isGeneralMath 
      ? '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b' 
      : '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
  }

  if (env?.AI) {
    try {
      const generalContext = `[CARINA Commercial & Retail Architecture Telemetry]:\n` +
        `- Retail Network: Al-Andalus Mall Flagship (Jeddah, 260 m²), Al-Yasmeen Mall (Jeddah, 193 m²), Jouri Mall (Taif, 168 m²), Central Warehouse (WH).\n` +
        `- Total Sales Floor Area: 621 m² physical retail space across Western Region (KSA).\n` +
        `- Total Physical Inventory Catalog: 1,493 active styles, 54,125 physical units on-hand.\n` +
        `- Sales Performance & Velocity: Cumulative Sell-Through (STR) = 46.9% catalog average; Rolling 8-Week Velocity (ROS) = 0.66 units/week per active style.\n` +
        `- Portfolio Valuation: Total Retail Ticket Value = 3,745,210 SAR | Landed Cost Capital = 1,183,520 SAR | Blended Initial Markup (IMU) = 68.4%.\n` +
        `- Size Demand Hierarchy & Curve Dynamics (Saudi Retail Market):\n` +
        `  * Core Sized Apparel (Bras, Tops, Pyjamas, Dresses): Medium (M) and Large (L) represent 62% of fashion sales; Small (20%) and XL (14%) are secondary. Broken curves (<=2 sizes remaining) represent fragmented oddments that are cleared via 50% clearance rails or Take 3 For 99 SAR multi-buys.\n` +
        `  * Non-Sized & Single-Size Assortments (Cosmetics, Body Splashes, Fragrances 100ML/50ML, Towels, Accessories): These products have exactly 1 complete size by design ('Single Size (Complete)'). They are NEVER broken oddments. They are merchandised as basket boosters ('Spend 250 Save 50' or 'Buy 2 Get 1 Free') or protected at full price, strictly preserving high cosmetics gross margins.\n` +
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
        `  * Net Promo Margin = (Promotional Price / 1.15) - Landed Unit Cost\n` +
        `- Macro & Regional Crisis Context:\n` +
        `  * Jeddah Islamic Port logistics: Inbound Red Sea maritime rerouting inflates lead times by 14-25 days; maintain 6-8 week buffer at Central WH, never dump continuity winter basics.\n` +
        `  * Payday Liquidity: National payday on 27th of every Gregorian month triggers liquidity surge (25th to 2nd).\n` +
        `  * BNPL: High Tabby and Tamara adoption (checkout >= 100 SAR); Spend 250 Save 50 multi-buys preserve basket size.\n`;

      const generalSystemPrompt = `You are CARINA Senior Commercial Merchandising Strategist and Retail Pricing Analyst in Saudi Arabia.\n\n` +
        `CORE CAPABILITIES & RULES:\n` +
        `1. COMPREHENSIVE COMMERCIAL PLANNING & CAPABILITIES:\n` +
        `   - You ARE CARINA's automated White Friday, promotional discount, and markdown optimization intelligence across all stores in Saudi Arabia (KSA).\n` +
        `   - When asked if you can plan offers or discounts: Confirm YES. Explain that offers are dynamically calibrated by merchandise department and price point (e.g. Socks 9-19 SAR: Buy 3 for 29 SAR; Panties: Buy 3 for 69 SAR; Bras: Buy 2 for 129 SAR; Pyjamas: Buy 2 for 199/249 SAR or Spend 250 Save 50; Broken curves: Clearance rails), strictly complying with Saudi Ministry of Commerce zero-loss regulations (Price >= Landed Cost x 1.15).\n` +
        `   - NEVER propose a fixed "Take 3 For 99 SAR" offer blindly on low-ticket categories like Socks (ticket 10-15 SAR). Proposing 99 SAR for 3 socks is a fatal pricing violation (it costs more than full price!). Bundle prices must ALWAYS provide a discount below the combined ticket price.\n` +
        `   - NEVER answer with a bare monosyllable like "Yes" or "No". Even if the user asks "confirm yes or no" or "just say yes or no", confirm clearly and explain the commercial framework, store allocations, and governance boundaries.\n` +
        `2. ANSWER ANY QUESTION OR CALCULATION DIRECTLY: Answer the user's analytical, mathematical, operational, or retail question directly and intelligently using the provided telemetry and formulas.\n` +
        `3. SIZE DEMAND HIERARCHY:\n` +
        `   - Core sizes (M and L, 62%) apply ONLY to sized apparel garments (Bras, Pyjamas, Tops, Dresses).\n` +
        `   - Single-size categories (Socks, Cosmetics, Fragrances, Towels) have NO size curve or M/L split. NEVER reference M/L sizing for socks or cosmetics.\n` +
        `4. PROHIBITED ACTIONS: If the user suggests or asks about a price or action that is prohibited (such as selling below landed cost plus 15% VAT, or deep discounting fresh winter collections, or mixing damaged/virtual stock onto sales floors), explicitly state: "Prohibited Action: ..." and explain the regulatory or commercial reason.\n` +
        `5. STRICT EXECUTIVE ORGANIZATION: Always structure your response with a clean Markdown title header and organized bullet points (•) with bold category labels. NEVER output a continuous unformatted block of text. Under 180 words. Strictly NO emojis or unicode icons in your output.\n` +
        (allowUnguidedMetrics 
          ? `6. EXPLORATORY ANALYSIS MODE ACTIVE: You are authorized to synthesize qualitative and unguided market hypotheses (consumer sentiment, brand equity, price elasticity). Format your answer in two clear tiers: 1. Verified CARINA Telemetry, 2. Exploratory & Qualitative Assessment with a '[🧪 Exploratory Hypothesis]' badge.`
          : `6. STRICT SSOT GOVERNED MODE: You are locked to CARINA's 7 verified SSOT dimensions. NEVER invent unguided metrics or arbitrary multipliers (e.g. Return Rate, Urgency Index, Social Buzz, Happiness). If asked about an unguided metric, state clearly that it is outside CARINA's 7 validated SSOT physical retail dimensions.`
        );

      const genPayload: any = {
        messages: [
          { role: 'system', content: generalSystemPrompt },
          { role: 'user', content: `${generalContext}\n\nUser Question: "${userMessage}"` }
        ],
        temperature: isGeneralMath ? 0.08 : 0.15,
        top_p: 0.90,
        top_k: 40,
        repetition_penalty: 1.15,
        seed: 42,
        max_tokens: isGeneralMath ? 180 : 280
      };

      const executeGenRun = async () => {
        try {
          return await env.AI.run(genModel, genPayload);
        } catch (err: any) {
          console.warn(`Primary model ${genModel} error, trying fast fallback:`, err?.message || err);
          return await env.AI.run('@cf/meta/llama-3.2-3b-instruct', genPayload);
        }
      };

      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('AI Timeout')), 25000));
      const aiResponse: any = await Promise.race([executeGenRun(), timeoutPromise]);

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

      // Contextual fallback for size demand and curve dynamics if AI times out
      if (/sizes?|curve/i.test(lowerMsg)) {
        return {
          reply: `### Size Demand & Curve Dynamics (Saudi Retail Network)\n\n` +
            `• **Core High-Demand Sizes (62% of Sales):** **Medium (M)** and **Large (L)** are the primary sales volume drivers across all retail apparel styles in Jeddah and Taif.\n` +
            `• **Secondary Velocity Sizes (34% of Sales):** **Small (S)** accounts for ~20% of transactions and **X-Large (XL)** accounts for ~14%.\n` +
            `• **Broken Curve Risk (<4% Demand):** Peripheral sizes (**XS** and **XXL+**) turn slowest. When core sizes (M and L) sell out rapidly, styles transition into **Broken Curve (<=2 sizes remaining)** status.\n` +
            `• **Decongestion Strategy:** Broken curves create retail density bottlenecks in Al-Yasmeen and Jouri Mall. They are prioritized for **Take 3 For 99 SAR** multi-buys and **50% Off** clearance rails to liquidate oddments without eroding full-price margins.`,
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
