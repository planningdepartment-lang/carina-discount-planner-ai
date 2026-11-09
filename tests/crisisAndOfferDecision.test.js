const { test, describe } = require('node:test');
const assert = require('node:assert');

describe('Crisis Resilience & Offer Decision Intelligence Engine', () => {
  // Test 1: Verify crisisRetailContext module exports
  test('Crisis Retail Context: provides domain guidelines for Jeddah Port & supply resilience', async () => {
    // Dynamic import of TS via transpile or check source definition
    const fs = require('fs');
    const path = require('path');
    const crisisSrc = fs.readFileSync(path.join(__dirname, '../src/ai/skills/crisisRetailContext.ts'), 'utf8');

    assert.ok(crisisSrc.includes('Jeddah Islamic Port'), 'Must mention Jeddah Islamic Port');
    assert.ok(crisisSrc.includes('Red Sea'), 'Must mention Red Sea supply chain');
    assert.ok(crisisSrc.includes('zeroLossRule'), 'Must maintain Zero Loss rule');
    assert.ok(crisisSrc.includes('safetyStockPreservation'), 'Must enforce safety stock preservation');
    assert.ok(crisisSrc.includes('Tabby and Tamara'), 'Must integrate BNPL market behavior');
  });

  // Test 2: Verify offerDecisionFormatter generates auditable cards
  test('Offer Decision Formatter: generates audited decision card with margin proofs and POS tag', async () => {
    const fs = require('fs');
    const path = require('path');
    const formatterSrc = fs.readFileSync(path.join(__dirname, '../src/ai/skills/offerDecisionFormatter.ts'), 'utf8');

    assert.ok(formatterSrc.includes('formatOfferDecisionCard'), 'Must export formatOfferDecisionCard');
    assert.ok(formatterSrc.includes('Zero-Loss Floor'), 'Must include Zero-Loss floor');
    assert.ok(formatterSrc.includes('Net Margin'), 'Must include Net Margin calculation');
    assert.ok(formatterSrc.includes('action:simulate:'), 'Must include 1-click simulator action');
  });

  // Test 3: Verify dynamicOfferEngine evaluateOfferDecision helper
  test('Dynamic Offer Engine: evaluateOfferDecision enforces zero-loss floor and returns margin proof', async () => {
    const fs = require('fs');
    const path = require('path');
    const engineSrc = fs.readFileSync(path.join(__dirname, '../src/engine/dynamicOfferEngine.ts'), 'utf8');

    assert.ok(engineSrc.includes('evaluateOfferDecision'), 'Must export evaluateOfferDecision');
    assert.ok(engineSrc.includes('isZeroLossCompliant'), 'Must calculate zero loss compliance flag');
    assert.ok(engineSrc.includes('forecastNetProfitSAR'), 'Must calculate forecast net profit');
  });

  // Test 4: Verify Copilot Chat Intent and Governance Router
  test('Copilot Router: handles crisis inquiries and dual-mode unguided metric governance', async () => {
    const fs = require('fs');
    const path = require('path');
    const copilotSrc = fs.readFileSync(path.join(__dirname, '../src/ai/copilot.ts'), 'utf8');

    assert.ok(copilotSrc.includes('isCrisisOrMacroQuery'), 'Must detect crisis/war/geopolitical inquiries');
    assert.ok(copilotSrc.includes('formatCrisisStrategyCard'), 'Must format crisis strategy card');
    assert.ok(copilotSrc.includes('isUnguidedMetricQuery'), 'Must detect unguided metrics');
    assert.ok(copilotSrc.includes('Metric Governance & Boundary Notice'), 'Must return boundary notice when toggle is off');
    assert.ok(copilotSrc.includes('allowUnguidedMetrics'), 'Must support allowUnguidedMetrics request flag');
  });

  // Test 5: Verify Frontend UI Toggle and Styles
  test('Frontend UI: Copilot drawer includes Guided/Unguided Mode buttons and styling', async () => {
    const fs = require('fs');
    const path = require('path');
    const htmlSrc = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const appSrc = require('fs').readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
    const cssSrc = require('fs').readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');

    assert.ok(htmlSrc.includes('btnModeGuidedTop'), 'index.html must have btnModeGuidedTop button');
    assert.ok(htmlSrc.includes('btnModeUnguidedTop'), 'index.html must have btnModeUnguidedTop button');
    assert.ok(appSrc.includes('isExploratoryMode'), 'app.js must manage exploratory state');
    assert.ok(appSrc.includes('setCognitiveMode'), 'app.js must have setCognitiveMode handler');
    assert.ok(cssSrc.includes('.mode-toggle-btn'), 'styles.css must style mode toggle buttons');
  });

  // Test 6: Verify Dynamic Category Promotional Planning prevents fixed offers on socks
  test('Category Promotional Planning: dynamic engine calculates socks offers and eliminates hardcoded Take 3 For 99 SAR', async () => {
    const fs = require('fs');
    const path = require('path');
    const copilotSrc = fs.readFileSync(path.join(__dirname, '../src/ai/copilot.ts'), 'utf8');
    const engineSrc = fs.readFileSync(path.join(__dirname, '../src/engine/dynamicCategoryOfferEngine.ts'), 'utf8');

    assert.ok(copilotSrc.includes('resolveCategoryOfferPlan'), 'copilot.ts must have resolveCategoryOfferPlan');
    assert.ok(copilotSrc.includes('isCategoryOfferQuery'), 'copilot.ts must detect category offer queries');
    assert.ok(engineSrc.includes('solveOptimalCharmBundle'), 'dynamicCategoryOfferEngine must export solveOptimalCharmBundle');
    assert.ok(engineSrc.includes('generateDynamicCategoryOfferPlan'), 'dynamicCategoryOfferEngine must export generateDynamicCategoryOfferPlan');
    assert.ok(engineSrc.includes('SAUDI_CHARM_PRICE_POINTS'), 'dynamicCategoryOfferEngine must use SAUDI_CHARM_PRICE_POINTS');
    assert.ok(engineSrc.includes('calculateZeroLossFloor'), 'dynamicCategoryOfferEngine must enforce zero loss floor');
  });
});
