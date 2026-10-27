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
    'hello', 'hi', 'hey', 'thanks', 'thank'
  ]);

  const words = lowerMsg
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2 && !stopWords.has(w));

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

  const isContextualFollowup = /\b(this|that|it|its|the item|this item|this product|this model|for this|for it)\b/i.test(lowerMsg);
  const isMacroOrGeneralQuery = /\b(analyze|analysis|sales|performance|overall|catalog|store|stores|density|total|summary|margin|profit|revenue)\b/i.test(lowerMsg);

  if (isContextualFollowup && !isMacroOrGeneralQuery && contextStyleCode && /^\d{5}$/.test(contextStyleCode)) {
    const { results } = await db.prepare('SELECT * FROM style_plan_snapshots WHERE style_code = ? LIMIT 1').bind(contextStyleCode).all();
    if (results && results.length > 0) return results;
  }

  return [];
}

test('Copilot Search: matches Perfume Silk Dream 50ML over active context style 59399', async () => {
  const db = createMockDb(mockCatalog);
  // User says "i'm talking about this one Perfume Silk Dream 50ML" while context was 59399
  const results = await searchStylesInD1(db, "i'm talking about this one Perfume Silk Dream 50ML", "59399");
  assert.equal(results.length, 1);
  assert.equal(results[0].style_code, '59461');
  assert.equal(results[0].product_name, 'Perfume Silk Dream 50ML');
});

test('Copilot Search: does NOT reuse previous context style for general "analyze the sales performance"', async () => {
  const db = createMockDb(mockCatalog);
  // User says "analyze the sales performance" while context was 59399
  const results = await searchStylesInD1(db, 'analyze the sales performance', '59399');
  assert.equal(results.length, 0); // Must be empty so it routes to Macro Sales Intelligence!
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
