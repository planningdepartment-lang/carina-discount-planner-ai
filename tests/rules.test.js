const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

describe('Commercial Governance Rules & Resilience Engine', () => {
  test('DEFAULT_BUSINESS_RULES contains all 6 standard policies in queries.ts', () => {
    const queriesSource = fs.readFileSync('src/db/queries.ts', 'utf8');

    assert.ok(queriesSource.includes('export const DEFAULT_BUSINESS_RULES'), 'Must export DEFAULT_BUSINESS_RULES');

    const expectedRuleIds = [
      'RULE_ZERO_LOSS_VAT',
      'RULE_EXCLUDE_AW26',
      'RULE_CAP_NOOS_DISCOUNT',
      'RULE_MIN_NET_MARGIN',
      'RULE_DECONGEST_JOURI',
      'RULE_DECONGEST_YASMEEN'
    ];

    expectedRuleIds.forEach(id => {
      assert.ok(queriesSource.includes(id), `Missing standard rule id in DEFAULT_BUSINESS_RULES: ${id}`);
    });
  });

  test('rulesController sets Cache-Control: no-store and handles restore-defaults', () => {
    const controllerSource = fs.readFileSync('src/api/rulesController.ts', 'utf8');
    assert.ok(controllerSource.includes("'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'"), 'Must set no-cache headers');
    assert.ok(controllerSource.includes('restoreDefaultBusinessRules'), 'Must support restoring baseline rules');
    assert.ok(controllerSource.includes('clearStylePlanSnapshots'), 'Must invalidate style plan snapshot cache on rule change');
  });

  test('public/app.js handles loading spinner, HTTP errors, and empty rule states', () => {
    const appSource = fs.readFileSync('public/app.js', 'utf8');
    assert.ok(appSource.includes('luxury-spinner'), 'loadRules must render luxury-spinner while fetching');
    assert.ok(appSource.includes('Governance Engine Unavailable'), 'loadRules must show explicit error card on HTTP error');
    assert.ok(appSource.includes('restoreDefaultRules'), 'Must provide restoreDefaultRules action');
    assert.ok(appSource.includes('cache: \'no-store\''), 'loadRules must bypass browser cache with no-store');
  });
});
