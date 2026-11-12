const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

/**
 * Loads live TypeScript source files directly without duplicating logic.
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
        if (fs.existsSync(path.join(resolved, 'index.ts'))) {
          return loadTs(path.relative(rootDir, path.join(resolved, 'index.ts')));
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
const { evaluateSpeedAndHeroQualification } = loadTs('src/engine/metricsCalculator');
const { classifyStyleAndRecommend } = loadTs('src/engine/lifecycleClassifier');
const { evaluatePostPromoAlert } = loadTs('src/api/monitoringController');

function buildBaseStyle(overrides = {}) {
  return {
    styleCode: '59999',
    productName: 'Everyday Cotton Tank Top',
    category: 'Tops',
    season: 'Continuity',
    totalPhysicalStock: 60,
    stockAndalus: 20,
    stockYasmeen: 20,
    stockJouri: 10,
    stockWH: 10,
    cumulativeSTR: 45,
    weeklyROS: 1.8,
    weeklyROS2wk: 1.8,
    weeklyROS4wk: 1.8,
    activeWeeks: 6.0,
    momentumRatio: 1.0,
    momentumLabel: 'Stable',
    soldUnits: 45,
    salesLifecycleWeeks: 6.0,
    storeFloorWOS: 20.0,
    activeSizeCount: 4,
    hasCoreSizes: true,
    isSingleSize: false,
    sizeBreakdown: { S: 12, M: 15, L: 13, XL: 10 },
    unitCost: 22.0,
    ticketPrice: 99.0,
    ...overrides
  };
}

describe('2-Month Drop-Cycle Speed Calibration & Hero Qualification', () => {
  test('3-week Launch Shield protects brand-new drop arrivals at full price (0% Off)', () => {
    const style = buildBaseStyle({
      styleCode: '60001',
      salesLifecycleWeeks: 2.0,
      activeWeeks: 2.0,
      cumulativeSTR: 18,
      weeklyROS: 2.0,
      weeklyROS2wk: 2.0,
      storeFloorWOS: 22.0
    });

    const speed = evaluateSpeedAndHeroQualification({
      cumulativeSTR: style.cumulativeSTR,
      weeklyROS: style.weeklyROS,
      weeklyROS2wk: style.weeklyROS2wk,
      storeFloorWOS: style.storeFloorWOS,
      salesLifecycleWeeks: style.salesLifecycleWeeks,
      isSingleSize: false,
      hasHealthyCoreCurve: true,
      momentumRatio: 1.0
    });
    assert.equal(speed.speedBand, 'LAUNCH_SHIELD');

    const rec = classifyStyleAndRecommend(style, { campaignMode: 'REGULAR_DROP_CYCLE' });
    assert.equal(rec.tier, 'HERO_CORE');
    assert.equal(rec.discountPct, 0);
    assert.equal(rec.speedBand, 'LAUNCH_SHIELD');
    assert.equal(rec.zeroLossStatus, 'YES');
  });

  test('2-Month Breakout Hero (>=50% STR within <=8.7w drop cycle) earns full-price protection', () => {
    const style = buildBaseStyle({
      styleCode: '60002',
      salesLifecycleWeeks: 7.0,
      cumulativeSTR: 56,
      weeklyROS: 4.2,
      weeklyROS2wk: 4.0,
      storeFloorWOS: 8.5
    });

    const rec = classifyStyleAndRecommend(style, { campaignMode: 'REGULAR_DROP_CYCLE' });
    assert.equal(rec.speedBand, 'FAST_HERO');
    assert.equal(rec.tier, 'HERO_CORE');
    assert.equal(rec.discountPct, 0);
  });

  test('1-Year Tortoise (73% STR accumulated over 57 wks at 0.1 u/wk) is disqualified from Hero protection', () => {
    const style = buildBaseStyle({
      styleCode: '60003',
      salesLifecycleWeeks: 57.0,
      activeWeeks: 8.0,
      cumulativeSTR: 73,
      weeklyROS: 0.1,
      weeklyROS2wk: 0.0,
      storeFloorWOS: 85.0,
      totalPhysicalStock: 35,
      stockAndalus: 12,
      stockYasmeen: 12,
      stockJouri: 11,
      stockWH: 0
    });

    const speed = evaluateSpeedAndHeroQualification({
      cumulativeSTR: style.cumulativeSTR,
      weeklyROS: style.weeklyROS,
      weeklyROS2wk: style.weeklyROS2wk,
      storeFloorWOS: style.storeFloorWOS,
      salesLifecycleWeeks: style.salesLifecycleWeeks,
      isSingleSize: false,
      hasHealthyCoreCurve: true,
      momentumRatio: 0.2
    });
    assert.equal(speed.speedBand, 'SLOW_OVERSTOCK');

    const rec = classifyStyleAndRecommend(style, { campaignMode: 'REGULAR_DROP_CYCLE' });
    assert.notEqual(rec.tier, 'HERO_CORE');
    assert.ok(rec.discountPct >= 40, `Expected clearance discount >=40%, got ${rec.discountPct}%`);
    assert.equal(rec.clearanceScope, 'PERMANENT_ODDMENT_RAIL');
    assert.ok(rec.promotionalPriceSAR >= style.unitCost * 1.15);
  });

  test('Active Replenished Continuity Captain (>12w NOOS with >=70% STR & >=2.5 u/wk pull) keeps HERO_CORE', () => {
    const style = buildBaseStyle({
      styleCode: '60004',
      salesLifecycleWeeks: 59.0,
      cumulativeSTR: 74,
      weeklyROS: 5.5,
      weeklyROS2wk: 4.5,
      storeFloorWOS: 9.0,
      totalPhysicalStock: 50,
      stockAndalus: 20,
      stockYasmeen: 18,
      stockJouri: 12,
      stockWH: 0
    });

    const rec = classifyStyleAndRecommend(style, { campaignMode: 'REGULAR_DROP_CYCLE' });
    assert.equal(rec.speedBand, 'ACTIVE_CONTINUITY_HERO');
    assert.equal(rec.tier, 'HERO_CORE');
    assert.equal(rec.discountPct, 0);
  });
});

describe('Medium Movers (Tier 2A vs Tier 2B) & Commercial Modes', () => {
  test('Tier 2A Medium Mover inside 2-month drop cycle gets gentle ~20% multi-buy vs Tier 2B post-drop escalation ~30%', () => {
    const tier2AStyle = buildBaseStyle({
      styleCode: '60010',
      salesLifecycleWeeks: 6.0,
      cumulativeSTR: 36,
      weeklyROS: 1.6,
      weeklyROS2wk: 1.5,
      storeFloorWOS: 18.0
    });
    const rec2A = classifyStyleAndRecommend(tier2AStyle, { campaignMode: 'REGULAR_DROP_CYCLE' });
    assert.equal(rec2A.speedBand, 'MEDIUM_2A');
    assert.equal(rec2A.tier, 'BUNDLE_2');
    assert.ok(rec2A.discountPct >= 15 && rec2A.discountPct <= 25, `Expected gentle ~20% bundle, got ${rec2A.discountPct}%`);

    const tier2BStyle = buildBaseStyle({
      styleCode: '60011',
      salesLifecycleWeeks: 10.5,
      cumulativeSTR: 36,
      weeklyROS: 1.4,
      weeklyROS2wk: 1.1,
      storeFloorWOS: 22.0
    });
    const rec2B = classifyStyleAndRecommend(tier2BStyle, { campaignMode: 'REGULAR_DROP_CYCLE' });
    assert.equal(rec2B.speedBand, 'MEDIUM_2B');
    assert.equal(rec2B.tier, 'BUNDLE_2');
    assert.ok(rec2B.discountPct >= 28 && rec2B.discountPct <= 40, `Expected deeper ~30-35% escalation, got ${rec2B.discountPct}%`);
    assert.ok(rec2B.promotionalPriceSAR >= tier2BStyle.unitCost * 1.15);
  });

  test('Campaign Modes separate Permanent Clearance Rail from White Friday & Eid Margin Harvest', () => {
    const slowStyle = buildBaseStyle({
      styleCode: '60020',
      salesLifecycleWeeks: 18.0,
      cumulativeSTR: 18,
      weeklyROS: 0.4,
      weeklyROS2wk: 0.3,
      storeFloorWOS: 55.0,
      activeSizeCount: 2,
      hasCoreSizes: false,
      sizeBreakdown: { M: 10, L: 10 }
    });

    const railRec = classifyStyleAndRecommend(slowStyle, { campaignMode: 'REGULAR_DROP_CYCLE' });
    assert.equal(railRec.clearanceScope, 'PERMANENT_ODDMENT_RAIL');
    assert.match(railRec.rationale, /Permanent Clearance Rail/i);

    const wfRec = classifyStyleAndRecommend(slowStyle, { campaignMode: 'WHITE_FRIDAY' });
    assert.equal(wfRec.clearanceScope, 'EVENT_CLEARANCE');
    assert.match(wfRec.rationale, /Event Clearance/i);
    assert.ok(wfRec.promotionalPriceSAR >= slowStyle.unitCost * 1.15);

    const mediumStyle = buildBaseStyle({
      styleCode: '60021',
      salesLifecycleWeeks: 5.5,
      cumulativeSTR: 38,
      weeklyROS: 1.7,
      weeklyROS2wk: 1.8,
      storeFloorWOS: 16.0
    });
    const eidRec = classifyStyleAndRecommend(mediumStyle, { campaignMode: 'EID_AL_FITR' });
    assert.equal(eidRec.tier, 'HERO_CORE');
    assert.equal(eidRec.discountPct, 0);
    assert.match(eidRec.recommendedOffer, /Festive Harvest/i);
    assert.match(eidRec.rationale, /EID_AL_FITR/i);

    const ndStyle = buildBaseStyle({
      styleCode: '60022',
      ticketPrice: 119.0,
      unitCost: 22.0,
      salesLifecycleWeeks: 5.5,
      cumulativeSTR: 38,
      weeklyROS: 1.7,
      weeklyROS2wk: 1.8,
      storeFloorWOS: 16.0
    });
    const ndRec = classifyStyleAndRecommend(ndStyle, { campaignMode: 'NATIONAL_DAY' });
    assert.equal(ndRec.campaignMode, 'NATIONAL_DAY');
    assert.equal(ndRec.bundlePriceSAR, 194);
    assert.ok(ndRec.promotionalPriceSAR >= ndStyle.unitCost * 1.15);
  });
});

describe('Post-Promo Performance Watchdog (Trust & Re-Evaluation)', () => {
  test('Flags EARLY_SELLOUT when live pace spikes >=1.6x baseline and stock runway drops below 3.5 wks', () => {
    const res = evaluatePostPromoAlert({
      discountPct: 25,
      stock: 14,
      baselineWeeklyROS: 2.0,
      actualLast7dUnits: 7,
      actualLast14dUnits: 12,
      forecastSold14d: 8
    });
    assert.equal(res.alertStatus, 'EARLY_SELLOUT');
    assert.ok(res.observedLiftMultiplier >= 1.6);
  });

  test('Flags PROMO_STALL when promoted high-stock style sells <=1 unit in 14 days below 0.75x baseline', () => {
    const res = evaluatePostPromoAlert({
      discountPct: 30,
      stock: 25,
      baselineWeeklyROS: 1.5,
      actualLast7dUnits: 0,
      actualLast14dUnits: 1,
      forecastSold14d: 6
    });
    assert.equal(res.alertStatus, 'PROMO_STALL');
    assert.ok(res.observedLiftMultiplier < 0.75);
  });

  test('Returns NORMAL when promoted style tracks inside expected velocity bounds', () => {
    const res = evaluatePostPromoAlert({
      discountPct: 20,
      stock: 40,
      baselineWeeklyROS: 2.0,
      actualLast7dUnits: 2,
      actualLast14dUnits: 5,
      forecastSold14d: 6
    });
    assert.equal(res.alertStatus, 'NORMAL');
  });
});
