const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

/**
 * Compiles and executes real TypeScript source modules directly in Node test runner
 * without duplicating business logic or drifting from production code.
 */
function createTsLoader() {
  const cache = new Map();
  const rootDir = path.resolve(__dirname, '..');

  function loadTs(relPath) {
    const absPath = path.resolve(rootDir, relPath.endsWith('.ts') ? relPath : `${relPath}.ts`);
    if (cache.has(absPath)) return cache.get(absPath).exports;

    const source = fs.readFileSync(absPath, 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true
      },
      fileName: absPath
    });

    const mod = new Module(absPath);
    cache.set(absPath, mod);
    mod.filename = absPath;
    mod.paths = Module._nodeModulePaths(path.dirname(absPath));

    const origRequire = mod.require.bind(mod);
    mod.require = (id) => {
      if (id.startsWith('.')) {
        const resolved = path.resolve(path.dirname(absPath), id);
        if (fs.existsSync(`${resolved}.ts`)) {
          return loadTs(path.relative(rootDir, `${resolved}.ts`));
        }
      }
      return origRequire(id);
    };

    mod._compile(outputText, absPath);
    return mod.exports;
  }

  return loadTs;
}

const loadTs = createTsLoader();
const mc = loadTs('src/engine/metricsCalculator.ts');
const lc = loadTs('src/engine/lifecycleClassifier.ts');
const rp = loadTs('src/engine/rulePipeline.ts');
const ca = loadTs('src/engine/competitorAnalyzer.ts');
const pe = loadTs('src/engine/posExporter.ts');
const ed = loadTs('src/engine/executiveDossier.ts');
const { DEFAULT_BUSINESS_RULES } = loadTs('src/db/queries.ts');
const { LIFECYCLE_TIERS } = loadTs('src/config/constants.ts');

function makeStyle(overrides = {}) {
  return {
    styleCode: '90001',
    productName: 'Test Pyjama Set',
    category: 'Set',
    season: 'All Season 2025',
    totalPhysicalStock: 40,
    stockAndalus: 10,
    stockYasmeen: 10,
    stockJouri: 10,
    stockWH: 10,
    soldUnits: 20,
    salesLifecycleWeeks: 20,
    cumulativeSTR: 33.3,
    weeklyROS: 1.0,
    storeFloorWOS: 30.0,
    weeklyROS2wk: 1.0,
    weeklyROS4wk: 1.0,
    momentumRatio: 1.0,
    activeWeeks: 8,
    momentumLabel: 'Stable (+0%)',
    activeSizeCount: 4,
    hasCoreSizes: true,
    isSingleSize: false,
    sizeBreakdown: { S: 10, M: 10, L: 10, XL: 10 },
    everSizes: ['S', 'M', 'L', 'XL'],
    unitCost: 30,
    ticketPrice: 149,
    ...overrides
  };
}

describe('Real TypeScript Engine Invariants — Core Sizes, Seasons, Rules, Competitor & Exporter', () => {
  test('Core sizes require S, M, L, XL >= 2 units per size (unless M-3XL without S ever)', () => {
    const completeCore = mc.evaluateSizeStockHealth({ S: 2, M: 2, L: 2, XL: 2 }, 'Set', 'Pyjama', ['S', 'M', 'L', 'XL']);
    assert.equal(completeCore.hasCoreSizes, true);
    assert.equal(completeCore.activeSizesGE2, 4);

    // Style 56163 (SS25-PJ-941) missing M & L and S=1, XL=1 -> Broken Curve (Non-Core Sizes)
    const pj941 = mc.evaluateSizeStockHealth({ '2XL': 6, '3XL': 4, S: 1, XL: 1 }, 'Set', 'Pyjama Set SS25-PJ-941', ['2XL', '3XL', 'S', 'L', 'M', 'XL']);
    assert.equal(pj941.hasCoreSizes, false);
    assert.equal(pj941.activeSizesGE2, 2);
    assert.equal(mc.formatCurveHealthLabel({ isSingleSize: false, activeSizeCount: pj941.activeSizesGE2, hasCoreSizes: pj941.hasCoreSizes }), 'Broken Curve (Non-Core Sizes)');

    // Dual-letter SM + LXL expands to S, M, L, XL
    const dualFull = mc.evaluateSizeStockHealth({ SM: 46, LXL: 44 }, 'Night Gown', 'Night Gown AW26-NG-5514', ['SM', 'LXL']);
    assert.equal(dualFull.hasCoreSizes, true);
    assert.equal(dualFull.activeSizesGE2, 4);

    // Dual-letter missing S & M -> Broken Non-Core
    const dualPeripheral = mc.evaluateSizeStockHealth({ LXL: 5, '23X': 4 }, 'Set', 'Pyjama', ['SM', 'LXL', '23X']);
    assert.equal(dualPeripheral.hasCoreSizes, false);

    // Genuine M-2XL where S never existed in Odoo -> Healthy
    const plusOnly = mc.evaluateSizeStockHealth({ M: 12, L: 12, XL: 13, '2XL': 14 }, 'Boxer M', 'Boxer (Man)-BX50006', ['M', 'L', 'XL', '2XL']);
    assert.equal(plusOnly.hasCoreSizes, true);

    // Neck Cover (56654) and Bundle Short (95075) with apparel sizes are NOT single size
    assert.equal(mc.detectSingleSizeAssortment('Neck Cover', 'Neck Cover 119', undefined, { L: 30, M: 18, XL: 18 }, ['L', 'M', 'XL']), false);
    assert.equal(mc.detectSingleSizeAssortment('Bundle', 'Bundle Short Sport (3)', undefined, { M: 20, L: 18, XL: 25, '2XL': 23, '3XL': 29 }, ['M', 'L', 'XL', '2XL', '3XL']), false);
    assert.equal(mc.detectSingleSizeAssortment('Socks', 'Knee High Heavy Socks-1505', undefined, { '38-41': 18 }, ['38-41']), true);
  });

  test('SS25-PJ-941 broken non-core curve receives Clearance instead of Full Margin Protection', () => {
    const metrics = makeStyle({
      styleCode: '56163',
      productName: 'Pyjama Set SS25-PJ-941',
      season: 'Ss 25',
      totalPhysicalStock: 12,
      soldUnits: 228,
      salesLifecycleWeeks: 59.7,
      cumulativeSTR: 95.0,
      weeklyROS: 3.0,
      activeSizeCount: 2,
      hasCoreSizes: false,
      sizeBreakdown: { '2XL': 6, '3XL': 4, S: 1, XL: 1 },
      everSizes: ['2XL', '3XL', 'S', 'L', 'M', 'XL'],
      unitCost: 50.3,
      ticketPrice: 199
    });
    const rec = lc.classifyStyleAndRecommend(metrics);
    assert.notEqual(rec.tier, LIFECYCLE_TIERS.HERO_CORE);
    assert.equal(rec.discountPct > 0, true);
    assert.equal(rec.promotionalPriceSAR >= mc.calculateZeroLossFloor(50.3), true);
  });

  test('Zero sold units always forces 0% historicalDiscountDepthPct regardless of stale historicalASP', () => {
    const metrics = makeStyle({
      styleCode: '58613',
      productName: 'Pyjama Set (3PC) SS26-PJ-5242',
      season: 'Ss 26',
      soldUnits: 0,
      salesLifecycleWeeks: 0,
      cumulativeSTR: 0,
      weeklyROS: 0,
      historicalASP: 215.28,
      unitCost: 77.2,
      ticketPrice: 299,
      activeSizeCount: 5,
      sizeBreakdown: { S: 19, M: 15, L: 20, XL: 16, '2XL': 11 }
    });
    const rec = lc.classifyStyleAndRecommend(metrics);
    assert.equal(rec.historicalDiscountDepthPct, 0);
  });

  test('FW 26 winter shield, Continuity 25% cap label sync, and FLAGGED_PRICE_ERROR priority', () => {
    // 1. FW 26 style shielded at 0% Off
    const winterStyle = makeStyle({
      styleCode: '60896',
      productName: 'Night Gown AW26-NG-5514',
      category: 'Night Gown',
      season: 'FW 26',
      activeSizeCount: 4,
      sizeBreakdown: { SM: 46, LXL: 44 },
      unitCost: 24.83,
      ticketPrice: 99
    });
    const rawWinter = lc.classifyStyleAndRecommend(winterStyle);
    assert.equal(rawWinter.tier, LIFECYCLE_TIERS.FRESH_WINTER);
    const ruledWinter = rp.applyBusinessRules(winterStyle, rawWinter, DEFAULT_BUSINESS_RULES);
    assert.equal(ruledWinter.discountPct, 0);
    assert.equal(ruledWinter.promotionalPriceSAR, 99);

    // 2. All Season 2018 continuity cap syncs recommendedOffer + tier to RULE_CAPPED_PROMO when proposal exceeds 25%
    const contStyle = makeStyle({
      styleCode: '50177',
      productName: 'Legging Cotton M133-N',
      category: 'Legging',
      season: 'All Season 2018',
      totalPhysicalStock: 392,
      cumulativeSTR: 25.0,
      weeklyROS: 0.75,
      storeFloorWOS: 80.0,
      unitCost: 9.2,
      ticketPrice: 59,
      activeSizeCount: 5
    });
    const rawCont = lc.classifyStyleAndRecommend(contStyle);
    assert.ok(rawCont.discountPct > 25, `Expected pre-rule discount > 25%, got ${rawCont.discountPct}`);
    const ruledCont = rp.applyBusinessRules(contStyle, rawCont, DEFAULT_BUSINESS_RULES);
    assert.equal(ruledCont.tier, LIFECYCLE_TIERS.RULE_CAPPED_PROMO);
    assert.equal(ruledCont.discountPct, 25);
    assert.equal(ruledCont.promotionalPriceSAR, 44.25);
    assert.match(ruledCont.recommendedOffer, /Continuity Capped Promo \(25% Off\)/);

    // Defensive check: omitted storeFloorWOS does not throw in computeDynamicBundle2
    const omittedWosStyle = makeStyle({ styleCode: '50178', storeFloorWOS: undefined, weeklyROS: 0.75, ticketPrice: 99, unitCost: 20 });
    const recNoWos = lc.classifyStyleAndRecommend(omittedWosStyle);
    assert.ok(recNoWos && recNoWos.promotionalPriceSAR >= mc.calculateZeroLossFloor(20));

    // 3. Exclusion rule never suppresses FLAGGED_PRICE_ERROR
    const underwaterWinter = makeStyle({
      styleCode: '99998',
      season: 'FW 26',
      unitCost: 100,
      ticketPrice: 99
    });
    const rawErr = lc.classifyStyleAndRecommend(underwaterWinter);
    assert.equal(rawErr.tier, LIFECYCLE_TIERS.FLAGGED_PRICE_ERROR);
    const ruledErr = rp.applyBusinessRules(underwaterWinter, rawErr, DEFAULT_BUSINESS_RULES);
    assert.equal(ruledErr.tier, LIFECYCLE_TIERS.FLAGGED_PRICE_ERROR);
  });

  test('Competitor Analyzer enforces VAT floor and strict < totalTicket on bundles', () => {
    // Style 58613 (cost 77.20 => floor 88.78, ticket 299): must never offer 2 for 149 (74.50/u < 88.78)
    const pj = ca.analyzeCompetitorPosition('Set', 'Pyjama Set (3PC) SS26-PJ-5242', 299, 179.4, 77.2);
    assert.ok(!/149/.test(pj.tacticalCounterOffer), `Unexpected below-floor 149 bundle: ${pj.tacticalCounterOffer}`);
    assert.match(pj.tacticalCounterOffer, /189 SAR/);

    // Style 57594 Socks (ticket 15, cost 4.56 => floor 5.24)
    const socks = ca.analyzeCompetitorPosition('Socks', 'Knee High Heavy Socks-1505', 15, 10.05, 4.56);
    const sockMatch = socks.tacticalCounterOffer.match(/Buy\s+(\d+)\s+(?:Packs\s+)?(?:for|at)\s+([\d.]+)/i);
    if (sockMatch) {
      const n = Number(sockMatch[1]);
      const tot = Number(sockMatch[2]);
      assert.ok(tot / n >= mc.calculateZeroLossFloor(4.56) - 0.01);
      assert.ok(tot < 15 * n);
    }

    // Thin-margin style where floor > ticket (cost 13.50 => floor 15.53 >= ticket 15) -> no unprofitable bundle
    const thinMargin = ca.analyzeCompetitorPosition('Socks', 'Premium Sock', 15, 15.53, 13.5);
    assert.ok(!/Buy\s+\d+\s+For/i.test(thinMargin.tacticalCounterOffer), `Should not propose bundle when floor*N >= ticket*N: ${thinMargin.tacticalCounterOffer}`);
  });

  test('POS Exporter and Executive Dossier reflect dynamic simulation and governance tags', () => {
    const contStyle = makeStyle({ styleCode: '50177', season: 'All Season 2018', unitCost: 9.2, ticketPrice: 59 });
    const recCapped = {
      tier: LIFECYCLE_TIERS.RULE_CAPPED_PROMO,
      recommendedOffer: 'Continuity Capped Promo (25% Off)',
      discountPct: 25,
      promotionalPriceSAR: 44.25,
      expectedClearancePct: 25,
      rationale: 'Capped',
      zeroLossStatus: 'YES',
      bundleQuantity: 1,
      bundlePriceSAR: 44.25
    };
    const errStyle = makeStyle({ styleCode: '99998', unitCost: 100, ticketPrice: 80 });
    const recErr = lc.classifyStyleAndRecommend(errStyle);

    const csv = pe.generateOdooPOSPricelistCSV([
      { metrics: contStyle, recommendation: recCapped },
      { metrics: errStyle, recommendation: recErr }
    ]);
    assert.match(csv, /RULE_CAPPED_25PCT/);
    assert.match(csv, /RULE_FLAGGED_PRICE_ERROR_LOCKED/);

    const dossier = ed.buildExecutiveDossierData([
      { metrics: contStyle, recommendation: recCapped },
      { metrics: errStyle, recommendation: recErr }
    ]);
    assert.equal(dossier.financialSimulation.zeroLossViolationCount, 1);
    assert.equal(typeof dossier.financialSimulation.unitsToLiquidate, 'number');
    assert.ok(dossier.financialSimulation.unitsToLiquidate > 0);
  });

  test('Copilot "why full margin?" explains plain-English reasons beside numbers and survives empty AI responses', async () => {
    const loader = createTsLoader();
    const copilot = loader('src/ai/copilot.ts');

    const row59465 = {
      style_code: '59465',
      product_name: 'Body splash Secret Desire 100ML',
      category: 'Cosmetics',
      season: 'All Season 2026',
      total_physical_stock: 375,
      stock_andalus: 19,
      stock_yasmeen: 28,
      stock_jouri: 8,
      stock_wh: 320,
      cumulative_str_pct: 20,
      weekly_ros: 4,
      sar_curve_health: 'Single Size (Complete)',
      unit_cost: 15.07,
      cost_plus_vat: 17.33,
      ticket_price: 69.0,
      recommended_offer: 'Full Price Margin Protection (0% Off)',
      promotional_price: 69.0,
      discount_pct: 0,
      zero_loss_status: 'YES',
      forecast_sold: 94,
      forecast_profit: 4224,
      post_event_stock: 281,
      commercial_rationale: 'Core single-size product with healthy sell-through. Organic demand protects full ticket margin.',
      sold_units: 94,
      sales_lifecycle_weeks: 24.8,
      lifecycle_tier: 'HERO_CORE',
      store_floor_wos: 13.8,
      active_size_count: 1,
      has_core_sizes: 1,
      is_single_size: 1,
      size_breakdown_json: JSON.stringify({ '100ML': 375 })
    };

    const mockDb = {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async all() {
                if (sql.includes('style_code = ?') && args[0] === '59465') {
                  return { results: [row59465] };
                }
                return { results: [] };
              },
              async first() { return null; }
            };
          }
        };
      }
    };

    // Case 1: Model returns empty after <think> -> must cascade and fall back cleanly to natural-language explanation
    const aiModelsCalled = [];
    let capturedPrompt = '';
    const resFallback = await copilot.handleCopilotChat(
      {
        DB: mockDb,
        AI: {
          async run(modelId, payload) {
            aiModelsCalled.push(modelId);
            capturedPrompt = payload.messages.map(m => m.content).join('\n');
            return { response: '<think>reasoning only</think>' };
          }
        }
      },
      {
        message: 'why full margin?',
        model: 'auto',
        contextStyleCode: '59465',
        allowUnguidedMetrics: true
      }
    );

    assert.equal(aiModelsCalled[0], '@cf/meta/llama-3.3-70b-instruct-fp8-fast');
    assert.match(capturedPrompt, /Full Price Margin Protection/i);
    assert.match(capturedPrompt, /Plain-English Business Cause Behind Decision/i);
    assert.match(resFallback.reply, /Why This Decision Applies/i);
    assert.match(resFallback.reply, /Single-Size/i);
    assert.match(resFallback.reply, /13\.8 WOS/);
    assert.match(resFallback.reply, /Central Warehouse/i);
    assert.match(resFallback.reply, /Exploratory Hypothesis/i);
    assert.equal(resFallback.activeStyleCode, '59465');

    // Case 2: Live LLM succeeds with plain-English answer + metrics
    const resAi = await copilot.handleCopilotChat(
      {
        DB: mockDb,
        AI: {
          async run() {
            return {
              response:
                '### Commercial Decision Analysis — Style **59465** (*Body splash Secret Desire 100ML*)\n\n' +
                '• **Why This Decision Applies:** Full Price Margin Protection (0% Off) applies because this single-size fragrance converts organically at 4 u/wk without broken size oddments, while only 55 units sit on store shelves (13.8 WOS) and 320 units sit safely in WH reserve.'
            };
          }
        }
      },
      {
        message: 'why full margin?',
        model: 'auto',
        contextStyleCode: '59465',
        allowUnguidedMetrics: false
      }
    );
    assert.equal(resAi.activeModel, '@cf/meta/llama-3.3-70b-instruct-fp8-fast');
    assert.match(resAi.reply, /Why This Decision Applies/);
  });

  test('Frontend Copilot feedback chips guard event bubbling so drawer stays open', () => {
    const appJs = fs.readFileSync(path.resolve(__dirname, '../public/app.js'), 'utf8');
    assert.match(appJs, /e\.composedPath/);
    assert.match(appJs, /isConnected/);
    assert.match(appJs, /chipEvent\.stopPropagation\(\)/);
    assert.match(appJs, /chipsDiv\.replaceChildren\(statusSpan\)/);
  });
});
