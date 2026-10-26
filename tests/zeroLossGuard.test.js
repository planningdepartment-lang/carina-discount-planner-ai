const test = require('node:test');
const assert = require('node:assert');

// Simple JS mirror for direct node:test execution
function calculateZeroLossFloor(cost) {
  if (cost <= 0) return 0;
  return Math.round(cost * 1.15 * 100) / 100;
}

function enforceZeroLossGuard(promoPrice, cost) {
  const floor = calculateZeroLossFloor(cost);
  if (promoPrice < (floor - 0.01)) {
    return { compliant: false, safePrice: floor };
  }
  return { compliant: true, safePrice: promoPrice };
}

test('Zero-Loss Guard: enforces 15% VAT floor accurately', () => {
  // Test Case 1: Landed cost 4.71 SAR (e.g. Round Neck SS)
  const floor1 = calculateZeroLossFloor(4.71);
  assert.strictEqual(floor1, 5.42);

  // Test Case 2: Landed cost 10.17 SAR (e.g. Soft Bra)
  const floor2 = calculateZeroLossFloor(10.17);
  assert.strictEqual(floor2, 11.70);

  // Test Case 3: Landed cost 44.22 SAR (e.g. Pyjama Pant)
  const floor3 = calculateZeroLossFloor(44.22);
  assert.strictEqual(floor3, 50.85);
});

test('Zero-Loss Guard: clamps below-cost prices', () => {
  const cost = 20.00; // Floor is 23.00 SAR
  const violation = enforceZeroLossGuard(15.00, cost);
  assert.strictEqual(violation.compliant, false);
  assert.strictEqual(violation.safePrice, 23.00);

  const compliant = enforceZeroLossGuard(25.00, cost);
  assert.strictEqual(compliant.compliant, true);
  assert.strictEqual(compliant.safePrice, 25.00);
});
