/**
 * CARINA Inter-Store Inventory Rebalancing Engine
 * 
 * Analyzes store-level stock allocation and sales velocity across Western Region KSA:
 * - Al-Andalus Mall Flagship (Jeddah, 260 m², ~66% sales volume share)
 * - Al-Yasmeen Mall (Jeddah, 193 m², ~20% sales volume share)
 * - Jouri Mall (Taif, 168 m², ~14% sales volume share)
 * - Central Warehouse (WH)
 * 
 * Recommends high-margin stock transfers from bottlenecked/overstocked locations
 * to high-demand locations to prevent margin-diluting markdowns.
 */

export interface StoreProfile {
  code: 'AND' | 'YAS' | 'JOU' | 'WH';
  name: string;
  city: 'Jeddah' | 'Taif';
  floorAreaSqm: number;
  salesVolumeShare: number; // Historical volume weighting
}

export const KSA_STORES: Record<'AND' | 'YAS' | 'JOU' | 'WH', StoreProfile> = {
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

export interface RebalanceTransferRecommendation {
  styleCode: string;
  productName: string;
  category: string;
  ticketPrice: number;
  unitCost: number;
  sourceStore: {
    code: 'AND' | 'YAS' | 'JOU' | 'WH';
    name: string;
    stockBefore: number;
    wosBefore: number;
  };
  destStore: {
    code: 'AND' | 'YAS' | 'JOU';
    name: string;
    stockBefore: number;
    wosBefore: number;
  };
  recommendedTransferUnits: number;
  rationale: string;
  financialImpact: {
    avoidedMarkdownPct: number;
    grossMarginSavedSAR: number;
    estimatedLogisticsCostSAR: number;
    netMarginPreservedSAR: number;
  };
  urgency: 'HIGH' | 'MEDIUM' | 'OPPORTUNITY';
}

export interface RebalanceSummary {
  totalRecommendedTransfers: number;
  totalUnitsToMove: number;
  totalGrossMarginSavedSAR: number;
  totalLogisticsCostSAR: number;
  totalNetMarginPreservedSAR: number;
  transfers: RebalanceTransferRecommendation[];
}

/**
 * Calculates estimated store-level Weeks of Supply (WOS).
 */
export function calculateStoreWOS(stock: number, storeROS: number): number {
  if (storeROS <= 0.05) {
    return stock > 0 ? 99.0 : 0.0;
  }
  return parseFloat((stock / storeROS).toFixed(1));
}

/**
 * Computes inter-store transfer recommendations for a single style.
 */
export function evaluateStyleRebalance(style: {
  styleCode: string;
  productName: string;
  category: string;
  ticketPrice: number;
  unitCost: number;
  weeklyROS: number;
  stockAndalus: number;
  stockYasmeen: number;
  stockJouri: number;
  stockWH?: number;
  recommendedOffer?: string;
}): RebalanceTransferRecommendation[] {
  const recommendations: RebalanceTransferRecommendation[] = [];
  const overallROS = Math.max(0.1, style.weeklyROS || 0);

  // Compute store-level ROS based on empirical store traffic distribution
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

  // Store status objects
  const stores = [
    { code: 'AND' as const, name: KSA_STORES.AND.name, stock: stockAND, ros: rosAND, wos: wosAND, city: 'Jeddah' as const },
    { code: 'YAS' as const, name: KSA_STORES.YAS.name, stock: stockYAS, ros: rosYAS, wos: wosYAS, city: 'Jeddah' as const },
    { code: 'JOU' as const, name: KSA_STORES.JOU.name, stock: stockJOU, ros: rosJOU, wos: wosJOU, city: 'Taif' as const }
  ];

  // Destination stores that are starving (WOS < 3.5 weeks or zero stock)
  const starvingStores = stores.filter(s => s.wos < 3.5 || s.stock <= 2);

  // Overstocked source stores (WOS >= 12 weeks or stock >= 8 units with low velocity)
  const overstockedStores = stores.filter(s => s.wos >= 12.0 && s.stock >= 5);

  // 1. Inter-Store Transfers (Store -> Store)
  for (const source of overstockedStores) {
    for (const dest of starvingStores) {
      if (source.code === dest.code) continue;

      // Calculate safe transfer quantity:
      // Leave at least 6 weeks of supply in source store (or min 3 units)
      const safeSourceRetain = Math.max(3, Math.ceil(source.ros * 6));
      const availableFromSource = Math.max(0, source.stock - safeSourceRetain);

      // Target 8 weeks of supply in destination store
      const targetDestSupply = Math.max(4, Math.ceil(dest.ros * 8));
      const neededByDest = Math.max(0, targetDestSupply - dest.stock);

      const transferUnits = Math.min(availableFromSource, neededByDest);

      if (transferUnits >= 3) {
        // Inter-city logistics cost (Jeddah <-> Taif is 1.50 SAR/unit, intra-Jeddah is 0.75 SAR/unit)
        const isInterCity = source.city !== dest.city;
        const logisticsRatePerUnit = isInterCity ? 1.50 : 0.75;
        const totalLogisticsCost = parseFloat((transferUnits * logisticsRatePerUnit).toFixed(2));

        // Margin calculation:
        // Without transfer, source store would clear at 40%-50% discount
        const avoidedMarkdownPct = style.recommendedOffer?.includes('50%') ? 0.50 : 0.40;
        const fullPriceTicket = style.ticketPrice || 50;
        const avoidedDiscountPerUnit = (fullPriceTicket * avoidedMarkdownPct);
        const grossMarginSaved = parseFloat((transferUnits * avoidedDiscountPerUnit).toFixed(2));
        const netMarginPreserved = parseFloat((grossMarginSaved - totalLogisticsCost).toFixed(2));

        const urgency: 'HIGH' | 'MEDIUM' | 'OPPORTUNITY' = 
          (dest.stock <= 2 && source.wos > 16) ? 'HIGH' :
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

  // 2. Warehouse Replenishment (WH -> Starving Store)
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

/**
 * Computes portfolio-wide rebalancing summary across all active styles.
 */
export function generatePortfolioRebalancingPlan(styles: Array<{
  styleCode: string;
  productName: string;
  category: string;
  ticketPrice: number;
  unitCost: number;
  weeklyROS: number;
  stockAndalus: number;
  stockYasmeen: number;
  stockJouri: number;
  stockWH?: number;
  recommendedOffer?: string;
}>): RebalanceSummary {
  const allTransfers: RebalanceTransferRecommendation[] = [];

  for (const s of styles) {
    const recs = evaluateStyleRebalance(s);
    allTransfers.push(...recs);
  }

  // Sort by net margin preserved descending
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
