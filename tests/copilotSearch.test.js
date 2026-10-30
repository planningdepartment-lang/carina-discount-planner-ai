const test = require('node:test');
const assert = require('node:assert/strict');

// Simulated mock D1 for search logic verification
function createMockDb(rows) {
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async all() {
              if (sql.includes('style_code = ?')) {
                const code = args[0];
                const res = rows.filter(r => r.style_code === code);
                return { results: res.slice(0, 1) };
              }
              if (sql.includes('product_name LIKE ?')) {
                // args are LIKE expressions
                const res = rows.filter(r => {
                  return args.every(pattern => {
                    const cleanPat = pattern.replace(/^%|%$/g, '').toLowerCase();
                    return r.product_name.toLowerCase().includes(cleanPat);
                  });
                });
                return { results: res.slice(0, 1) };
              }
              return { results: [] };
            }
          };
        }
      };
    }
  };
}

const mockCatalog = [
  {
    style_code: '59399',
    product_name: 'One-Shoulder Ribbed Top G10012',
    category: 'Body',
    total_physical_stock: 60
  },
  {
    style_code: '59461',
    product_name: 'Perfume Silk Dream 50ML',
    category: 'Cosmetics',
    total_physical_stock: 324
  },
  {
    style_code: '59466',
    product_name: 'Body splash Silk Dream 100ML',
    category: 'Cosmetics',
    total_physical_stock: 257
  }
];

// Extracted search algorithm matching src/ai/copilot.ts
async function searchStylesInD1(db, userMessage, contextStyleCode) {
  if (!db) return [];
  const lowerMsg = userMessage.toLowerCase();

  const codeMatch = userMessage.match(/\b\d{5}\b/);
  if (codeMatch) {
    const code = codeMatch[0];
    const { results } = await db.prepare('SELECT * FROM style_plan_snapshots WHERE style_code = ? LIMIT 1').bind(code).all();
    if (results && results.length > 0) return results;
  }

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

  if (words.length > 0) {
    if (words.length > 1) {
      const whereClauses = words.map(() => 'product_name LIKE ?').join(' AND ');
      const bindings = words.map(w => `%${w}%`);
      const { results } = await db.prepare(`SELECT * FROM style_plan_snapshots WHERE ${whereClauses} LIMIT 1`).bind(...bindings).all();
      if (results && results.length > 0) return results;
    }

    const modifierWords = new Set(['ml', '100ml', '50ml', 'v', 'n']);
    const coreWords = words.filter(w => !modifierWords.has(w));
    if (coreWords.length > 1 && coreWords.length < words.length) {
      const whereClauses = coreWords.map(() => 'product_name LIKE ?').join(' AND ');
      const bindings = coreWords.map(w => `%${w}%`);
      const { results } = await db.prepare(`SELECT * FROM style_plan_snapshots WHERE ${whereClauses} LIMIT 1`).bind(...bindings).all();
      if (results && results.length > 0) return results;
    }
  }

  const isExplicitMacroQuery = /\b(entire catalog|all catalog|overall catalog|catalog wide|catalog-wide|whole catalog|catalog total|catalog average|catalog summary|catalog performance|catalog sales|all styles|across all styles|all products|across all products|entire store network|network total|all stores total|network density|store densities|all store densities|overall performance|macro|total units in catalog|all items in catalog)\b/i.test(lowerMsg);
  const isDataSourceQuery = /\b(data source|data-source|source of data|where is.*data|where does.*data come from|d1 schema|database table|odoo_stock_move_line|move line)\b/i.test(lowerMsg);
  const isSimulationQuery = /\b(what if.*(?:liquidat|clear|units?|margin|target|sales?)|simulate.*(?:liquidat|clear|units?|margin|scenario)|run.*simulation|what happens if we (?:liquidat|clear))\b/i.test(lowerMsg);
  const isRuleQuery = /\b(rule|policy|governance)\b/i.test(lowerMsg) && /\b(cap|exclude|floor|discount|enforce)\b/i.test(lowerMsg);

  if (!isExplicitMacroQuery && !isDataSourceQuery && !isSimulationQuery && !isRuleQuery && contextStyleCode && /^\d{5}$/.test(contextStyleCode)) {
    const { results } = await db.prepare('SELECT * FROM style_plan_snapshots WHERE style_code = ? LIMIT 1').bind(contextStyleCode).all();
    if (results && results.length > 0) return results;
  }

  return [];
}

test('Copilot Search: "what are the sizes that have high demand" does NOT match any style in D1', async () => {
  const db = createMockDb(mockCatalog);
  const results = await searchStylesInD1(db, 'what are the sizes that have high demand', null);
  assert.equal(results.length, 0);
});

test('Copilot Search: matches Perfume Silk Dream 50ML over active context style 59399', async () => {
  const db = createMockDb(mockCatalog);
  // User says "i'm talking about this one Perfume Silk Dream 50ML" while context was 59399
  const results = await searchStylesInD1(db, "i'm talking about this one Perfume Silk Dream 50ML", "59399");
  assert.equal(results.length, 1);
  assert.equal(results[0].style_code, '59461');
  assert.equal(results[0].product_name, 'Perfume Silk Dream 50ML');
});

test('Copilot Search: reuses active context style for "sales performance" when style is in focus', async () => {
  const db = createMockDb(mockCatalog);
  // User says "sales performance" while style 59399 is active in focus
  const results = await searchStylesInD1(db, 'sales performance', '59399');
  assert.equal(results.length, 1);
  assert.equal(results[0].style_code, '59399');
});

test('Copilot Search: reuses active context style for "performance" when style is in focus', async () => {
  const db = createMockDb(mockCatalog);
  const results = await searchStylesInD1(db, 'performance', '59399');
  assert.equal(results.length, 1);
  assert.equal(results[0].style_code, '59399');
});

test('Copilot Search: bypasses active context style for explicit macro "overall catalog sales performance"', async () => {
  const db = createMockDb(mockCatalog);
  // Explicit macro catalog query must bypass context style
  const results = await searchStylesInD1(db, 'overall catalog sales performance', '59399');
  assert.equal(results.length, 0); // Empty routes to macro catalog analysis
});

test('Copilot Search: bypasses active context style for explicit macro "all styles sales performance"', async () => {
  const db = createMockDb(mockCatalog);
  const results = await searchStylesInD1(db, 'all styles sales performance', '59399');
  assert.equal(results.length, 0);
});

test('Copilot Search: "sales performance" without active context returns empty for macro routing', async () => {
  const db = createMockDb(mockCatalog);
  const results = await searchStylesInD1(db, 'sales performance', null);
  assert.equal(results.length, 0);
});

test('Copilot Search: reuses active context style for "what is the performance for this style?" when context style is active', async () => {
  const db = createMockDb(mockCatalog);
  const results = await searchStylesInD1(db, 'what is the performance for this style?', '59461');
  assert.equal(results.length, 1);
  assert.equal(results[0].style_code, '59461');
});

test('Copilot Search: reuses previous context style only for explicit follow-up question', async () => {
  const db = createMockDb(mockCatalog);
  // User asks explicit follow-up "what is its runway"
  const results = await searchStylesInD1(db, 'what is its runway', '59461');
  assert.equal(results.length, 1);
  assert.equal(results[0].style_code, '59461');
});

test('Copilot Search: "what is the performance for this style?" without context triggers clarification', () => {
  const lowerMsg = 'what is the performance for this style?'.toLowerCase();
  const asksForUnspecifiedStyle = /\b(performance.*(this|the) (style|item)|(this|the) (style|item).*performance|what is the price of this|how many.*this item|tell me about this (product|style|item)|what is this style|how is this selling|evaluate this (style|item)|analyze this (style|item)|about this style|for this style)\b/i.test(lowerMsg);
  assert.equal(asksForUnspecifiedStyle, true);
});

// Intent classification and targeted property card tests
function routeStyleQueryIntent(lowerMsg) {
  const isOfferQuery = /\b(offer|promo|promotion|promotional|discount|deal|markdown|recommendation|clearance|sale price)\b/i.test(lowerMsg);
  const isStockQuery = /\b(stock|inventory|units|quantity|on-hand|onhand|available|where|stores?|location|allocation|warehouse|wh|andalus|yasmeen|jouri)\b/i.test(lowerMsg);
  const isPricingQuery = /\b(price|pricing|ticket|cost|cogs|floor|vat|imu|markup|margin|break-even|breakeven)\b/i.test(lowerMsg);
  const isVelocityQuery = /\b(sales\s+performance|performance|velocity|ros|rate of sale|sales rate|sales velocity|sell-through|sell through|str|runway|wos|weeks of supply|coverage|how fast|sales volume|how is it selling)\b/i.test(lowerMsg);
  const isFullOverview = /\b(all|full|details|overview|everything|snapshot|summary|profile|card)\b/i.test(lowerMsg);

  const isConversational = /\b(what about|how about|tell me about|how is|thoughts on|opinion|status of|evaluate|review|analyze|assessment|doing)\b/i.test(lowerMsg);
  const isComplexAnalysis = isConversational || /\b(why|how did|how is.*calculated|formula|derivation|reason|what if|can we|could we|simulate|project|compare)\b/i.test(lowerMsg);

  if (!isComplexAnalysis && !isFullOverview) {
    if (isStockQuery && !isPricingQuery && !isVelocityQuery && !isOfferQuery) return 'STOCK_CARD';
    if (isPricingQuery && !isStockQuery && !isVelocityQuery && !isOfferQuery) return 'PRICING_CARD';
    if (isVelocityQuery && !isStockQuery && !isPricingQuery && !isOfferQuery) return 'VELOCITY_CARD';
    if (isOfferQuery && !isStockQuery && !isPricingQuery && !isVelocityQuery) return 'OFFER_CARD';
    if (isStockQuery && !isPricingQuery && !isOfferQuery) return 'STOCK_CARD';
    if (isPricingQuery && !isStockQuery) return 'PRICING_CARD';
    if (isVelocityQuery) return 'VELOCITY_CARD';
    if (isOfferQuery) return 'OFFER_CARD';
  }

  const hasAnyPropertyKeyword = isStockQuery || isPricingQuery || isVelocityQuery || isOfferQuery || isComplexAnalysis;
  if (!hasAnyPropertyKeyword || isFullOverview) return 'FULL_CARD';

  return 'COMPLEX_AI';
}

test('Copilot Intent: "sales performance" routes strictly to VELOCITY_CARD', () => {
  const intent = routeStyleQueryIntent('sales performance');
  assert.equal(intent, 'VELOCITY_CARD');
});

test('Copilot Intent: "performance" routes strictly to VELOCITY_CARD', () => {
  const intent = routeStyleQueryIntent('performance');
  assert.equal(intent, 'VELOCITY_CARD');
});

test('Copilot Intent: "what about this style High Neck Sleeveless Top (V)" routes to SMART AI assessment', () => {
  const intent = routeStyleQueryIntent('what about this style high neck sleeveless top (v)');
  assert.equal(intent, 'COMPLEX_AI');
});

test('Copilot Intent: "Pyjama Set AW25-PJ-5017 stock" routes strictly to STOCK_CARD without exposing price/offer', () => {
  const intent = routeStyleQueryIntent('pyjama set aw25-pj-5017 stock');
  assert.equal(intent, 'STOCK_CARD');
});

test('Copilot Intent: "what is the price of 57805" routes strictly to PRICING_CARD without store distribution', () => {
  const intent = routeStyleQueryIntent('what is the price of 57805');
  assert.equal(intent, 'PRICING_CARD');
});

test('Copilot Intent: "what is the runway for 50177" routes strictly to VELOCITY_CARD', () => {
  const intent = routeStyleQueryIntent('what is the runway for 50177');
  assert.equal(intent, 'VELOCITY_CARD');
});

test('Copilot Intent: "what offer is recommended for 50177" routes strictly to OFFER_CARD', () => {
  const intent = routeStyleQueryIntent('what offer is recommended for 50177');
  assert.equal(intent, 'OFFER_CARD');
});

test('Copilot Intent: bare style code "50177" routes to FULL_CARD for complete overview', () => {
  const intent = routeStyleQueryIntent('50177');
  assert.equal(intent, 'FULL_CARD');
});

test('Copilot Intent: "why did you recommend Take 3 for 50177" routes to COMPLEX_AI', () => {
  const intent = routeStyleQueryIntent('why did you recommend take 3 for 50177');
  assert.equal(intent, 'COMPLEX_AI');
});
