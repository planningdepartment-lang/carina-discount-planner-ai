const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// Logic mirror of runWhatIfSimulation for unit test verification
function runWhatIfSimulation(styles, recommendations, params) {
  let totalSold = 0;
  let totalGrossRev = 0;
  let totalNetRev = 0;
  let totalCOGS = 0;
  let totalStartingStock = 0;

  let globalClearanceScale = 1.0;
  if (params?.targetLiquidationUnits && params.targetLiquidationUnits > 0) {
    let baselineForecastSold = 0;
    for (let i = 0; i < styles.length; i++) {
      baselineForecastSold += Math.round(styles[i].totalPhysicalStock * ((recommendations[i]?.expectedClearancePct || 35) / 100));
    }
    if (baselineForecastSold > 0) {
      globalClearanceScale = params.targetLiquidationUnits / baselineForecastSold;
    }
  }

  const marginFloorPct = params?.minimumNetMarginFloorPct ?? 48.0;
  const marginFloorRatio = Math.min(0.85, Math.max(0.10, marginFloorPct / 100));

  for (let i = 0; i < styles.length; i++) {
    const s = styles[i];
    const r = recommendations[i] || {
      expectedClearancePct: 35,
      promotionalPriceSAR: s.ticketPrice * 0.8
    };

    totalStartingStock += (s.totalPhysicalStock || 0);

    const basePromoPrice = r.promotionalPriceSAR || s.ticketPrice;
    let simPromoPrice = basePromoPrice;
    let elasticityDampener = 1.0;

    if (s.unitCost > 0 && marginFloorRatio > 0 && marginFloorRatio < 1.0) {
      const minNetPriceExVat = s.unitCost / (1 - marginFloorRatio);
      const minPromoPriceInclVat = Math.round(minNetPriceExVat * 1.15 * 100) / 100;

      if (basePromoPrice < minPromoPriceInclVat) {
        simPromoPrice = Math.min(s.ticketPrice, minPromoPriceInclVat);
        const baseDiscount = s.ticketPrice > 0 ? Math.max(0, 1 - (basePromoPrice / s.ticketPrice)) : 0;
        const constrainedDiscount = s.ticketPrice > 0 ? Math.max(0, 1 - (simPromoPrice / s.ticketPrice)) : 0;
        if (baseDiscount > 0) {
          elasticityDampener = Math.max(0.20, constrainedDiscount / baseDiscount);
        } else {
          elasticityDampener = 0.50;
        }
      }
    }

    const baseClearance = r.expectedClearancePct || 35;
    const scaledRate = Math.min(0.95, (baseClearance / 100) * globalClearanceScale * elasticityDampener);
    const styleUnitsSold = Math.round((s.totalPhysicalStock || 0) * scaledRate);

    const grossRev = styleUnitsSold * simPromoPrice;
    const netRev = grossRev / 1.15;
    const cogs = styleUnitsSold * (s.unitCost || 0);

    totalSold += styleUnitsSold;
    totalGrossRev += grossRev;
    totalNetRev += netRev;
    totalCOGS += cogs;
  }

  const grossProfit = totalNetRev - totalCOGS;
  const realizedMargin = totalNetRev > 0 ? (grossProfit / totalNetRev) * 100 : 0;

  return {
    projectedGrossRevenue: Math.round(totalGrossRev) || 0,
    projectedNetRevenue: Math.round(totalNetRev) || 0,
    projectedCOGS: Math.round(totalCOGS) || 0,
    projectedNetProfit: Math.round(grossProfit) || 0,
    realizedMarginPct: Math.round(realizedMargin * 10) / 10,
    unitsSold: totalSold,
    marginFloorPreserved: realizedMargin >= (marginFloorPct - 0.05),
    targetMarginFloorPct: marginFloorPct
  };
}

describe('Dynamic Promotional Yield Simulator — Margin Floor Constraints', () => {
  const sampleStyles = [
    // Low margin clearance oddment: Ticket 60 SAR, Cost 25 SAR, Promo 30 SAR (50% Off) -> Base Net Margin: 4.2%
    { styleCode: '10001', ticketPrice: 60, unitCost: 25, totalPhysicalStock: 500, stockAndalus: 150, stockYasmeen: 150, stockJouri: 200 },
    // Healthy 2-pack bundle style: Ticket 199 SAR, Cost 46.95 SAR, Promo 149.50 SAR -> Net Margin: 63.9%
    { styleCode: '58401', ticketPrice: 199, unitCost: 46.95, totalPhysicalStock: 350, stockAndalus: 100, stockYasmeen: 100, stockJouri: 150 },
    // Full price protected item: Ticket 99 SAR, Cost 20 SAR, Promo 99 SAR -> Net Margin: 76.8%
    { styleCode: '51111', ticketPrice: 99, unitCost: 20, totalPhysicalStock: 200, stockAndalus: 50, stockYasmeen: 50, stockJouri: 100 }
  ];

  const sampleRecs = [
    { promotionalPriceSAR: 30.0, expectedClearancePct: 50 },
    { promotionalPriceSAR: 149.50, expectedClearancePct: 35 },
    { promotionalPriceSAR: 99.0, expectedClearancePct: 20 }
  ];

  test('Minimum Realized Net Margin Floor: Adjusting margin floor actively shifts simulated margin and revenue', () => {
    // 1. Moderate floor (45%)
    const simLow = runWhatIfSimulation(sampleStyles, sampleRecs, { minimumNetMarginFloorPct: 45 });
    
    // 2. High floor (60%) — must clamp deep discount style 10001 to satisfy 60% margin hurdle rate
    const simHigh = runWhatIfSimulation(sampleStyles, sampleRecs, { minimumNetMarginFloorPct: 60 });

    // Assert that higher margin floor yields higher realized margin %
    assert.ok(simHigh.realizedMarginPct > simLow.realizedMarginPct,
      `Expected high floor margin (${simHigh.realizedMarginPct}%) > low floor margin (${simLow.realizedMarginPct}%)`
    );

    // Assert that margin floor is preserved
    assert.equal(simHigh.marginFloorPreserved, true);
    assert.equal(simLow.marginFloorPreserved, true);

    // Assert that simulated profit per unit is higher under strict margin defense
    const profitPerUnitLow = simLow.projectedNetProfit / simLow.unitsSold;
    const profitPerUnitHigh = simHigh.projectedNetProfit / simHigh.unitsSold;
    assert.ok(profitPerUnitHigh > profitPerUnitLow,
      `Expected profit per unit under 60% floor (${profitPerUnitHigh.toFixed(2)}) > 45% floor (${profitPerUnitLow.toFixed(2)})`
    );
  });

  test('Target Liquidation Scaling: Adjusting liquidation volume scales units sold', () => {
    const sim10k = runWhatIfSimulation(sampleStyles, sampleRecs, { targetLiquidationUnits: 200 });
    const sim30k = runWhatIfSimulation(sampleStyles, sampleRecs, { targetLiquidationUnits: 400 });

    assert.ok(sim30k.unitsSold > sim10k.unitsSold);
    assert.ok(sim30k.projectedGrossRevenue > sim10k.projectedGrossRevenue);
  });
});
