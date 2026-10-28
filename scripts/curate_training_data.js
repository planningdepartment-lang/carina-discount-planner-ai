const fs = require('fs');
const path = require('path');

const SYSTEM_PROMPT = `You are CARINA Senior Commercial Merchandising Strategist and Retail Pricing Analyst in Saudi Arabia.\n` +
  `Stores: Al-Andalus Mall Flagship (Jeddah, 260 m²), Al-Yasmeen Mall (Jeddah, 193 m²), Jouri Mall (Taif, 168 m²), Central Warehouse (WH).\n\n` +
  `CRITICAL GOVERNANCE RULES:\n` +
  `1. Strictly NO emojis or unicode icons in your output.\n` +
  `2. NEVER volunteer promotional offers unless the user specifically asks for offers or markdowns.\n` +
  `3. MANDATORY STRUCTURE: Markdown title header followed by structured bullet points using bold metric titles.\n` +
  `4. Enforce Saudi 15% VAT floor: Price >= Landed Cost x 1.15. Selling below cost is PROHIBITED.`;

function curateInstructionPairs(styles) {
  const dataset = [];

  for (const row of styles) {
    const wos = row.weekly_ros > 0 ? (row.total_physical_stock / row.weekly_ros).toFixed(1) : '999';
    const months = (Number(wos) / 4.33).toFixed(1);
    const imu = row.ticket_price > 0 ? (((row.ticket_price - row.unit_cost) / row.ticket_price) * 100).toFixed(1) : '0';

    // Pair 1: Commercial Style Performance Assessment (Offers strictly omitted)
    dataset.push({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `What is the commercial performance of Style ${row.style_code} (${row.product_name})?` },
        {
          role: 'assistant',
          content: `### Commercial Assessment — Style **${row.style_code}** (*${row.product_name}*)\n\n` +
            `• **Category & Lifecycle:** \`${row.category}\` | \`${row.season}\`\n` +
            `• **Sales Velocity:** 8-week rolling velocity is **${row.weekly_ros} units/week** with **${row.cumulative_str_pct}% STR** and ${row.sar_curve_health}.\n` +
            `• **Inventory & Runway:** **${row.total_physical_stock} units** on-hand across stores, providing approximately **${wos} weeks of supply (~${months} months)**.\n` +
            `• **Store Network Allocation:** Al-Andalus (${row.stock_andalus}u), Al-Yasmeen (${row.stock_yasmeen}u), Jouri Mall (${row.stock_jouri}u), Central Warehouse (${row.stock_wh}u).\n` +
            `• **Pricing Economics:** Original list price is **${row.ticket_price.toFixed(2)} SAR** against **${row.unit_cost.toFixed(2)} SAR** landed cost (${imu}% IMU), safely above the **${row.cost_plus_vat.toFixed(2)} SAR** Saudi VAT legal floor.`
        }
      ]
    });

    // Pair 2: Explicit Promotional Strategy Inquiry
    dataset.push({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `What promotional offer do you recommend for Style ${row.style_code}?` },
        {
          role: 'assistant',
          content: `### Promotional Strategy & Recommendations — Style **${row.style_code}** (*${row.product_name}*)\n\n` +
            `• **Primary Offer:** **${row.recommended_offer}** at **${row.promotional_price.toFixed(2)} SAR** (${row.discount_pct}% off list)\n` +
            `• **Zero-Loss Compliance:** **${row.zero_loss_status}** (Promo ${row.promotional_price.toFixed(2)} SAR >= Floor ${row.cost_plus_vat.toFixed(2)} SAR)\n` +
            `• **Forecast Clearance:** **${row.forecast_sold} units** liquidation projected\n` +
            `• **Projected Net Cash Margin:** **+${row.forecast_profit.toLocaleString()} SAR**\n` +
            `• **Commercial Rationale:** ${row.commercial_rationale}`
        }
      ]
    });

    // Pair 3: Negative Constraint / Prohibited Below-Cost Rejection
    const illegalPrice = (row.unit_cost * 0.9).toFixed(2);
    dataset.push({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Can we sell Style ${row.style_code} for ${illegalPrice} SAR?` },
        {
          role: 'assistant',
          content: `### Regulatory Compliance Check — Style **${row.style_code}** (*${row.product_name}*)\n\n` +
            `• **Prohibited Action:** Selling at **${illegalPrice} SAR** is strictly prohibited under Saudi Ministry of Commerce retail pricing regulations.\n` +
            `• **Landed Unit Cost (COGS):** **${row.unit_cost.toFixed(2)} SAR**\n` +
            `• **Saudi 15% VAT Legal Floor:** **${row.cost_plus_vat.toFixed(2)} SAR** (Formula: Landed Cost x 1.15)\n` +
            `• **Statutory Violation:** Proposed price of ${illegalPrice} SAR incurs a statutory loss of -${(row.cost_plus_vat - Number(illegalPrice)).toFixed(2)} SAR/unit.\n` +
            `• **Compliant Minimum:** The lowest permissible promotional price is **${row.cost_plus_vat.toFixed(2)} SAR** or higher.`
        }
      ]
    });
  }

  return dataset;
}

module.exports = { curateInstructionPairs };

if (require.main === module) {
  const sampleStyles = [
    {
      style_code: '59465',
      product_name: 'High Neck Sleeveless Top (V)',
      category: 'Top',
      season: 'Continuity',
      total_physical_stock: 180,
      stock_andalus: 60,
      stock_yasmeen: 50,
      stock_jouri: 40,
      stock_wh: 30,
      cumulative_str_pct: 54.2,
      weekly_ros: 3.2,
      sar_curve_health: 'Healthy Curve (>=3 Sizes)',
      unit_cost: 33.74,
      cost_plus_vat: 38.80,
      ticket_price: 119.0,
      recommended_offer: 'Spend 250 Save 50 (Basket Pack)',
      promotional_price: 95.20,
      discount_pct: 20,
      zero_loss_status: 'COMPLIANT_PROFITABLE',
      forecast_sold: 90,
      forecast_profit: 4410,
      commercial_rationale: 'Core continuity style with healthy velocity.'
    }
  ];

  const pairs = curateInstructionPairs(sampleStyles);
  const outDir = path.resolve(__dirname, '../dist');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'sample_training_dataset.jsonl');
  fs.writeFileSync(outFile, pairs.map(p => JSON.stringify(p)).join('\n'), 'utf8');
  console.log(`Generated ${pairs.length} training pairs in ${outFile}`);
}
