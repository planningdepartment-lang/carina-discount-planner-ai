const test = require('node:test');
const assert = require('node:assert');

function calculateWeeklyROS(unitsSold, lookbackWeeks = 8.0, actualActiveWeeks) {
  if (unitsSold <= 0) return 0.0;
  const effectiveWeeks = actualActiveWeeks !== undefined && actualActiveWeeks > 0
    ? Math.min(lookbackWeeks, Math.max(1.0, actualActiveWeeks))
    : lookbackWeeks;
  if (effectiveWeeks <= 0) return 0.0;
  return Math.round((unitsSold / effectiveWeeks) * 10) / 10;
}

function calculateVelocityMomentum(ros2wk, rosBaseline) {
  if (rosBaseline <= 0) {
    if (ros2wk > 0) {
      return {
        momentumRatio: 2.0,
        momentumLabel: 'Surging (New Demand)',
        trendDirection: 'ACCELERATING',
        percentageChange: 100
      };
    }
    return {
      momentumRatio: 1.0,
      momentumLabel: 'Stable (0%)',
      trendDirection: 'STABLE',
      percentageChange: 0
    };
  }

  const ratio = Math.round((ros2wk / rosBaseline) * 100) / 100;
  const pctChange = Math.round(((ros2wk - rosBaseline) / rosBaseline) * 100);

  if (ratio >= 1.25) {
    return {
      momentumRatio: ratio,
      momentumLabel: `Accelerating (+${pctChange}%)`,
      trendDirection: 'ACCELERATING',
      percentageChange: pctChange
    };
  } else if (ratio <= 0.75) {
    return {
      momentumRatio: ratio,
      momentumLabel: `Decelerating (${pctChange}%)`,
      trendDirection: 'DECELERATING',
      percentageChange: pctChange
    };
  } else {
    return {
      momentumRatio: ratio,
      momentumLabel: `Stable (${pctChange >= 0 ? '+' : ''}${pctChange}%)`,
      trendDirection: 'STABLE',
      percentageChange: pctChange
    };
  }
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

test('Metrics: Weekly ROS 8-week calculation (default 8 weeks)', () => {
  assert.strictEqual(calculateWeeklyROS(80), 10.0);
  assert.strictEqual(calculateWeeklyROS(91), 11.4);
  assert.strictEqual(calculateWeeklyROS(0), 0.0);
});

test('Metrics: Weekly ROS with actual active weeks denominator', () => {
  // Fresh arrival on floor for 3 weeks: 9 units sold -> 9 / 3 = 3.0 u/wk (not 9 / 8 = 1.1 u/wk)
  assert.strictEqual(calculateWeeklyROS(9, 8.0, 3.0), 3.0);
  
  // Style 55321 (33 days active ~ 4.7 weeks): 3 units sold -> 3 / 4.7 = 0.6 u/wk
  assert.strictEqual(calculateWeeklyROS(3, 8.0, 4.7), 0.6);

  // Mature continuity on floor > 8 weeks: clamps to 8.0 max
  assert.strictEqual(calculateWeeklyROS(80, 8.0, 24.0), 10.0);

  // Minimum floor tenure clamp of 1.0 week prevents division by tiny fractions
  assert.strictEqual(calculateWeeklyROS(5, 8.0, 0.4), 5.0);
});

test('Metrics: Multi-horizon velocity momentum classification', () => {
  // Accelerating: 2-week ROS = 6.0, 8-week ROS = 4.0 -> ratio 1.5 (+50%)
  const accel = calculateVelocityMomentum(6.0, 4.0);
  assert.strictEqual(accel.trendDirection, 'ACCELERATING');
  assert.strictEqual(accel.momentumRatio, 1.5);
  assert.strictEqual(accel.momentumLabel, 'Accelerating (+50%)');

  // Decelerating: 2-week ROS = 2.0, 8-week ROS = 5.0 -> ratio 0.4 (-60%)
  const decel = calculateVelocityMomentum(2.0, 5.0);
  assert.strictEqual(decel.trendDirection, 'DECELERATING');
  assert.strictEqual(decel.momentumRatio, 0.4);
  assert.strictEqual(decel.momentumLabel, 'Decelerating (-60%)');

  // Stable: 2-week ROS = 4.2, 8-week ROS = 4.0 -> ratio 1.05 (+5%)
  const stable = calculateVelocityMomentum(4.2, 4.0);
  assert.strictEqual(stable.trendDirection, 'STABLE');
  assert.strictEqual(stable.momentumRatio, 1.05);
  assert.strictEqual(stable.momentumLabel, 'Stable (+5%)');

  // Surging new demand: Baseline ROS = 0, 2-week ROS = 3.0
  const surge = calculateVelocityMomentum(3.0, 0.0);
  assert.strictEqual(surge.trendDirection, 'ACCELERATING');
  assert.strictEqual(surge.momentumLabel, 'Surging (New Demand)');
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
