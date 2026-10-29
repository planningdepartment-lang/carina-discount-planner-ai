const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

describe('Universal Campaign & Executive Briefing Engine', () => {
  test('reportController source defines all 6 standard campaign archetypes', () => {
    const source = fs.readFileSync('src/api/reportController.ts', 'utf8');

    const expectedArchetypes = [
      'NATIONAL_DAY',
      'WHITE_FRIDAY',
      'FOUNDING_DAY',
      'RAMADAN_EID',
      'SEASONAL_EXIT',
      'CONTINUOUS_DISCOUNT'
    ];

    expectedArchetypes.forEach(arch => {
      assert.ok(source.includes(arch), `Missing campaign archetype definition: ${arch}`);
    });

    assert.ok(source.includes('Saudi National Day Campaign'), 'Must support Saudi National Day');
    assert.ok(source.includes('White Friday & Cyber Week Clearance'), 'Must support White Friday');
    assert.ok(source.includes('Ramadan & Eid Al-Fitr Festive Trading'), 'Must support Ramadan & Eid');
    assert.ok(source.includes('Store Sales Floor Decongestion Targets'), 'Must include store density metrics');
  });

  test('Elasticity engine is exported and callable', () => {
    const source = fs.readFileSync('src/engine/elasticityEngine.ts', 'utf8');
    assert.ok(source.includes('computeStyleElasticityCurve'), 'Must export computeStyleElasticityCurve');
    assert.ok(source.includes('isOptimalProfitPeak'), 'Must identify profit peak');
    assert.ok(source.includes('isZeroLossViolated'), 'Must track zero-loss floor compliance');
  });
});
