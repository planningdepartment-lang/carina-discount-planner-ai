const test = require('node:test');
const assert = require('node:assert');

function calculateWeeklyROS(unitsPast56Days) {
  if (unitsPast56Days <= 0) return 0.0;
  return Math.round((unitsPast56Days / 8.0) * 10) / 10;
}

function calculateCumulativeSTR(lifetimeSold, stock) {
  const total = lifetimeSold + stock;
  if (total <= 0) return 0.0;
  return Math.round((lifetimeSold / total) * 1000) / 10;
}

function calculateStoreFloorWOS(andalus, yasmeen, jouri, ros) {
  const floorStock = andalus + yasmeen + jouri;
  if (ros <= 0) return 999.0;
  return Math.round((floorStock / ros) * 10) / 10;
}

test('Metrics: Weekly ROS 8-week calculation', () => {
  assert.strictEqual(calculateWeeklyROS(80), 10.0);
  assert.strictEqual(calculateWeeklyROS(91), 11.4);
  assert.strictEqual(calculateWeeklyROS(0), 0.0);
});

test('Metrics: Cumulative STR % calculation', () => {
  // Lifetime 8 sold, 91 on hand -> 8 / (8 + 91) = 8.1% (Round Neck SS)
  assert.strictEqual(calculateCumulativeSTR(8, 91), 8.1);
  // Lifetime 300 sold, 100 on hand -> 300 / 400 = 75.0%
  assert.strictEqual(calculateCumulativeSTR(300, 100), 75.0);
});

test('Metrics: Store Floor WOS handles zero velocity gracefully', () => {
  // Healthy turnover
  assert.strictEqual(calculateStoreFloorWOS(100, 100, 100, 15.0), 20.0);
  // Zero velocity returns 999.0 weeks (not Infinity or NaN)
  assert.strictEqual(calculateStoreFloorWOS(100, 100, 100, 0), 999.0);
});
