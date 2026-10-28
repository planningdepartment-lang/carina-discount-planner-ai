const { curateInstructionPairs } = require('./curate_training_data');

function runBenchmark() {
  const testStyles = [
    {
      style_code: '50177',
      product_name: 'Cotton Basic T-Shirt',
      category: 'Top',
      season: 'Continuity',
      total_physical_stock: 450,
      stock_andalus: 150,
      stock_yasmeen: 150,
      stock_jouri: 100,
      stock_wh: 50,
      cumulative_str_pct: 62.0,
      weekly_ros: 5.0,
      sar_curve_health: 'Healthy Curve (>=3 Sizes)',
      unit_cost: 15.0,
      cost_plus_vat: 17.25,
      ticket_price: 49.0,
      recommended_offer: 'Take 3 For 99 SAR (33 SAR/u)',
      promotional_price: 33.0,
      discount_pct: 32,
      zero_loss_status: 'COMPLIANT_PROFITABLE',
      forecast_sold: 220,
      forecast_profit: 3014,
      commercial_rationale: 'Volume driver with high STR.'
    },
    {
      style_code: '59399',
      product_name: 'Perfume Silk Dream 50ML',
      category: 'Cosmetics',
      season: 'All Season 2018',
      total_physical_stock: 120,
      stock_andalus: 40,
      stock_yasmeen: 40,
      stock_jouri: 20,
      stock_wh: 20,
      cumulative_str_pct: 78.5,
      weekly_ros: 2.5,
      sar_curve_health: 'Healthy Curve (>=3 Sizes)',
      unit_cost: 45.0,
      cost_plus_vat: 51.75,
      ticket_price: 189.0,
      recommended_offer: 'Full Price Margin Protection (0% Off)',
      promotional_price: 189.0,
      discount_pct: 0,
      zero_loss_status: 'COMPLIANT_PROFITABLE',
      forecast_sold: 40,
      forecast_profit: 4776,
      commercial_rationale: 'High gross margin prestige cosmetic SKU.'
    }
  ];

  const pairs = curateInstructionPairs(testStyles);
  let passed = 0;
  let zeroLossChecks = 0;
  let formattingChecks = 0;
  let emojiChecks = 0;

  for (const pair of pairs) {
    const assistant = pair.messages.find(m => m.role === 'assistant')?.content || '';

    // Check 1: Zero emojis or unicode icons
    const hasEmojis = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E0}-\u{1F1FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1FA00}-\u{1FAFF}]/u.test(assistant);
    if (!hasEmojis) emojiChecks++;

    // Check 2: Mandatory markdown title header + bullet formatting
    const hasHeader = /^###\s+/m.test(assistant);
    const hasBullets = /^[•\*\-]\s+\*\*/m.test(assistant);
    if (hasHeader && hasBullets) formattingChecks++;

    // Check 3: Saudi 15% VAT Legal Compliance
    const mentionsVatOrFloor = /Saudi.*VAT|Legal Floor|Floor|Zero-Loss|Prohibited Action|15% VAT/i.test(assistant);
    if (mentionsVatOrFloor) zeroLossChecks++;

    if (!hasEmojis && hasHeader && hasBullets && mentionsVatOrFloor) {
      passed++;
    }
  }

  const total = pairs.length;
  return {
    total_tests: total,
    passed_tests: passed,
    failed_tests: total - passed,
    accuracy_pct: (passed / total) * 100,
    zero_loss_compliance_pct: (zeroLossChecks / total) * 100,
    formatting_integrity_pct: (formattingChecks / total) * 100,
    emoji_cleanliness_pct: (emojiChecks / total) * 100
  };
}

module.exports = { runBenchmark };

if (require.main === module) {
  const res = runBenchmark();
  console.log('--- Model Evaluation Benchmark Results ---');
  console.log(`Total Scenarios: ${res.total_tests}`);
  console.log(`Passed: ${res.passed_tests} (${res.accuracy_pct}%)`);
  console.log(`Zero-Loss Compliance: ${res.zero_loss_compliance_pct}%`);
  console.log(`Formatting Integrity: ${res.formatting_integrity_pct}%`);
  console.log(`Emoji Cleanliness: ${res.emoji_cleanliness_pct}%`);
}
