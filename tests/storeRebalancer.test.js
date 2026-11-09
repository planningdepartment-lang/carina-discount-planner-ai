const test = require('node:test');
const assert = require('node:assert/strict');

const KSA_STORES = {
  AND: {
    code: 'AND',
    name: 'Al-Andalus Mall Flagship',
    city: 'Jeddah',
    floorAreaSqm: 260,
    salesVolumeShare: 0.66
  },
  YAS: {
    code: 'YAS',
    name: 'Al-Yasmeen Mall',
    city: 'Jeddah',
    floorAreaSqm: 193,
    salesVolumeShare: 0.20
  },
  JOU: {
    code: 'JOU',
    name: 'Jouri Mall',
    city: 'Taif',
    floorAreaSqm: 168,
    salesVolumeShare: 0.14
  },
  WH: {
    code: 'WH',
    name: 'Central Warehouse',
    city: 'Jeddah',
    floorAreaSqm: 1200,
    salesVolumeShare: 0.00
  }
};

function calculateStoreWOS(stock, storeROS) {
  if (storeROS <= 0.05) {
    return stock > 0 ? 99.0 : 0.0;
  }
  return parseFloat((stock / storeROS).toFixed(1));
}

function evaluateStyleRebalance(style) {
  const recommendations = [];
  const overallROS = Math.max(0.1, style.weeklyROS || 0);

  const rosAND = parseFloat((overallROS * KSA_STORES.AND.salesVolumeShare).toFixed(2));
  const rosYAS = parseFloat((overallROS * KSA_STORES.YAS.salesVolumeShare).toFixed(2));
  const rosJOU = parseFloat((overallROS * KSA_STORES.JOU.salesVolumeShare).toFixed(2));

  const stockAND = Math.max(0, style.stockAndalus || 0);
  const stockYAS = Math.max(0, style.stockYasmeen || 0);
  const stockJOU = Math.max(0, style.stockJouri || 0);
  const stockWH = Math.max(0, style.stockWH || 0);

  const wosAND = calculateStoreWOS(stockAND, rosAND);
  const wosYAS = calculateStoreWOS(stockYAS, rosYAS);
  const wosJOU = calculateStoreWOS(stockJOU, rosJOU);

  const stores = [
    { code: 'AND', name: KSA_STORES.AND.name, stock: stockAND, ros: rosAND, wos: wosAND, city: 'Jeddah' },
    { code: 'YAS', name: KSA_STORES.YAS.name, stock: stockYAS, ros: rosYAS, wos: wosYAS, city: 'Jeddah' },
    { code: 'JOU', name: KSA_STORES.JOU.name, stock: stockJOU, ros: rosJOU, wos: wosJOU, city: 'Taif' }
  ];

  const starvingStores = stores.filter(s => s.wos < 3.5 || s.stock <= 2);
  const overstockedStores = stores.filter(s => s.wos >= 12.0 && s.stock >= 5);

  for (const source of overstockedStores) {
    for (const dest of starvingStores) {
      if (source.code === dest.code) continue;

      const safeSourceRetain = Math.max(3, Math.ceil(source.ros * 6));
      const availableFromSource = Math.max(0, source.stock - safeSourceRetain);

      const targetDestSupply = Math.max(4, Math.ceil(dest.ros * 8));
      const neededByDest = Math.max(0, targetDestSupply - dest.stock);

      const transferUnits = Math.min(availableFromSource, neededByDest);

      if (transferUnits >= 3) {
        const isInterCity = source.city !== dest.city;
        const logisticsRatePerUnit = isInterCity ? 1.50 : 0.75;
        const totalLogisticsCost = parseFloat((transferUnits * logisticsRatePerUnit).toFixed(2));

        const avoidedMarkdownPct = style.recommendedOffer?.includes('50%') ? 0.50 : 0.40;
        const fullPriceTicket = style.ticketPrice || 50;
        const avoidedDiscountPerUnit = (fullPriceTicket * avoidedMarkdownPct);
        const grossMarginSaved = parseFloat((transferUnits * avoidedDiscountPerUnit).toFixed(2));
        const netMarginPreserved = parseFloat((grossMarginSaved - totalLogisticsCost).toFixed(2));

        const urgency = (dest.stock <= 2 && source.wos > 16) ? 'HIGH' :
          (dest.wos < 2.0) ? 'MEDIUM' : 'OPPORTUNITY';

        recommendations.push({
          styleCode: style.styleCode,
          productName: style.productName,
          category: style.category,
          ticketPrice: style.ticketPrice,
          unitCost: style.unitCost,
          sourceStore: {
            code: source.code,
            name: source.name,
            stockBefore: source.stock,
            wosBefore: source.wos
          },
          destStore: {
            code: dest.code,
            name: dest.name,
            stockBefore: dest.stock,
            wosBefore: dest.wos
          },
          recommendedTransferUnits: transferUnits,
          rationale: `Transfer ${transferUnits} units from ${source.name} (WOS: ${source.wos}w, stock: ${source.stock}) to ${dest.name} (WOS: ${dest.wos}w, stock: ${dest.stock}). Avoids ${Math.round(avoidedMarkdownPct * 100)}% clearance markdown and generates +${netMarginPreserved} SAR net margin.`,
          financialImpact: {
            avoidedMarkdownPct,
            grossMarginSavedSAR: grossMarginSaved,
            estimatedLogisticsCostSAR: totalLogisticsCost,
            netMarginPreservedSAR: netMarginPreserved
          },
          urgency
        });
      }
    }
  }

  if (stockWH >= 6 && starvingStores.length > 0) {
    for (const dest of starvingStores) {
      const neededByDest = Math.max(3, Math.ceil(dest.ros * 8) - dest.stock);
      const unitsFromWH = Math.min(stockWH, neededByDest);

      if (unitsFromWH >= 3) {
        const isInterCity = dest.city === 'Taif';
        const logisticsCost = parseFloat((unitsFromWH * (isInterCity ? 1.50 : 0.75)).toFixed(2));
        const avoidedMarkdownPct = 0.35;
        const grossSaved = parseFloat((unitsFromWH * (style.ticketPrice * avoidedMarkdownPct)).toFixed(2));
        const netSaved = parseFloat((grossSaved - logisticsCost).toFixed(2));

        recommendations.push({
          styleCode: style.styleCode,
          productName: style.productName,
          category: style.category,
          ticketPrice: style.ticketPrice,
          unitCost: style.unitCost,
          sourceStore: {
            code: 'WH',
            name: KSA_STORES.WH.name,
            stockBefore: stockWH,
            wosBefore: 99.0
          },
          destStore: {
            code: dest.code,
            name: dest.name,
            stockBefore: dest.stock,
            wosBefore: dest.wos
          },
          recommendedTransferUnits: unitsFromWH,
          rationale: `Replenish ${unitsFromWH} units from Central Warehouse to ${dest.name} (current stock: ${dest.stock}, WOS: ${dest.wos}w) to prevent stockout.`,
          financialImpact: {
            avoidedMarkdownPct,
            grossMarginSavedSAR: grossSaved,
            estimatedLogisticsCostSAR: logisticsCost,
            netMarginPreservedSAR: netSaved
          },
          urgency: dest.stock === 0 ? 'HIGH' : 'MEDIUM'
        });
      }
    }
  }

  return recommendations;
}

function generatePortfolioRebalancingPlan(styles) {
  const allTransfers = [];

  for (const s of styles) {
    const recs = evaluateStyleRebalance(s);
    allTransfers.push(...recs);
  }

  allTransfers.sort((a, b) => b.financialImpact.netMarginPreservedSAR - a.financialImpact.netMarginPreservedSAR);

  const totalUnits = allTransfers.reduce((sum, t) => sum + t.recommendedTransferUnits, 0);
  const totalGrossSaved = allTransfers.reduce((sum, t) => sum + t.financialImpact.grossMarginSavedSAR, 0);
  const totalLogistics = allTransfers.reduce((sum, t) => sum + t.financialImpact.estimatedLogisticsCostSAR, 0);
  const totalNetSaved = allTransfers.reduce((sum, t) => sum + t.financialImpact.netMarginPreservedSAR, 0);

  return {
    totalRecommendedTransfers: allTransfers.length,
    totalUnitsToMove: totalUnits,
    totalGrossMarginSavedSAR: parseFloat(totalGrossSaved.toFixed(2)),
    totalLogisticsCostSAR: parseFloat(totalLogistics.toFixed(2)),
    totalNetMarginPreservedSAR: parseFloat(totalNetSaved.toFixed(2)),
    transfers: allTransfers
  };
}

test('CARINA Inter-Store Rebalancer: correctly calculates Weeks of Supply (WOS)', () => {
  assert.equal(calculateStoreWOS(20, 2.0), 10.0);
  assert.equal(calculateStoreWOS(0, 1.5), 0.0);
  assert.equal(calculateStoreWOS(15, 0.0), 99.0);
});

test('CARINA Inter-Store Rebalancer: generates transfer from bottlenecked Jouri Mall to starving Al-Andalus Flagship', () => {
  const style = {
    styleCode: '58276',
    productName: 'Knee High Socks15/Den (2PCS)',
    category: 'Socks',
    ticketPrice: 20.0,
    unitCost: 4.5,
    weeklyROS: 3.0,
    stockAndalus: 1,
    stockYasmeen: 10,
    stockJouri: 25,
    stockWH: 0,
    recommendedOffer: 'Clearance 50% Off'
  };

  const transfers = evaluateStyleRebalance(style);
  assert.ok(transfers.length > 0, 'Should generate transfer recommendation');

  const transfer = transfers.find(t => t.sourceStore.code === 'JOU' && t.destStore.code === 'AND');
  assert.ok(transfer, 'Should recommend Jouri to Andalus transfer');
  assert.ok(transfer.recommendedTransferUnits >= 5, 'Should transfer meaningful volume');
  assert.equal(transfer.sourceStore.code, 'JOU');
  assert.equal(transfer.destStore.code, 'AND');
  assert.equal(transfer.urgency, 'HIGH');

  const expectedLogistics = transfer.recommendedTransferUnits * 1.50;
  assert.equal(transfer.financialImpact.estimatedLogisticsCostSAR, expectedLogistics);
  assert.ok(transfer.financialImpact.netMarginPreservedSAR > 0);
});

test('CARINA Inter-Store Rebalancer: generates warehouse replenishment when flagship is low and warehouse has depth', () => {
  const style = {
    styleCode: '50177',
    productName: 'Cotton Leggings Classic',
    category: 'Pants',
    ticketPrice: 59.0,
    unitCost: 15.0,
    weeklyROS: 5.0,
    stockAndalus: 2,
    stockYasmeen: 15,
    stockJouri: 10,
    stockWH: 50,
    recommendedOffer: 'Bundle 2'
  };

  const transfers = evaluateStyleRebalance(style);
  const whTransfer = transfers.find(t => t.sourceStore.code === 'WH' && t.destStore.code === 'AND');
  assert.ok(whTransfer, 'Should replenish Andalus from WH');
  assert.ok(whTransfer.recommendedTransferUnits >= 5);
});

test('CARINA Inter-Store Rebalancer: aggregates portfolio-wide rebalancing plan with positive net cash yield', () => {
  const portfolio = [
    {
      styleCode: '58276',
      productName: 'Knee High Socks15/Den',
      category: 'Socks',
      ticketPrice: 20.0,
      unitCost: 4.5,
      weeklyROS: 3.0,
      stockAndalus: 1,
      stockYasmeen: 10,
      stockJouri: 25,
      stockWH: 0,
      recommendedOffer: '50% Off'
    },
    {
      styleCode: '58424',
      productName: 'Satin Pyjama Set',
      category: 'Pyjama',
      ticketPrice: 199.0,
      unitCost: 45.0,
      weeklyROS: 4.0,
      stockAndalus: 0,
      stockYasmeen: 8,
      stockJouri: 20,
      stockWH: 15,
      recommendedOffer: '40% Off'
    }
  ];

  const plan = generatePortfolioRebalancingPlan(portfolio);
  assert.ok(plan.totalRecommendedTransfers >= 2);
  assert.ok(plan.totalUnitsToMove > 0);
  assert.ok(plan.totalNetMarginPreservedSAR > 0);
  assert.ok(plan.totalGrossMarginSavedSAR > plan.totalLogisticsCostSAR);
});
