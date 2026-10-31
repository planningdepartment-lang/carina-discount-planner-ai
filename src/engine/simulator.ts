import { StyleMetrics, RecommendationResult } from './lifecycleClassifier';
import { STORE_SPACES } from '../config/constants';

export interface SimulationParams {
  targetLiquidationUnits?: number;    // e.g. 20000
  minimumNetMarginFloorPct?: number;  // e.g. 48.0
}

export interface SimulationResult {
  projectedGrossRevenue: number;
  projectedNetRevenue: number;
  projectedCOGS: number;
  projectedGrossProfit: number;
  projectedNetProfit: number;
  realizedMarginPct: number;
  realizedNetMarginPct: number;
  unitsSold: number;
  retainedStockUnits: number;
  retainedStockPct: number;
  retainedWinterUnits: number;
  retainedWinterPct: number;
  clearanceSharePct: number;
  postEventDensities: {
    andalusDensity: number;
    yasmeenDensity: number;
    jouriDensity: number;
  };
  postEventJouriDensity: number;
  jouriStatus: string;
  marginFloorPreserved: boolean;
  targetMarginFloorPct: number;
}

/**
 * Real-Time What-If Inventory Liquidation Simulator
 * Evaluates the impact of target liquidation volumes and minimum net margin floors
 * on cash generation, margin retention, and store physics.
 */
export function runWhatIfSimulation(
  styles: StyleMetrics[],
  recommendations: RecommendationResult[],
  params?: SimulationParams
): SimulationResult {
  let totalSold = 0;
  let totalGrossRev = 0;
  let totalNetRev = 0;
  let totalCOGS = 0;
  let totalStartingStock = 0;

  let andalusStartingStock = 0;
  let yasmeenStartingStock = 0;
  let jouriStartingStock = 0;

  let andalusSold = 0;
  let yasmeenSold = 0;
  let jouriSold = 0;

  // 1. Global scale factor if user requested a specific liquidation volume target
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

  // 2. Minimum Realized Net Margin Floor constraint (Hurdle Rate)
  const marginFloorPct = params?.minimumNetMarginFloorPct ?? 48.0;
  const marginFloorRatio = Math.min(0.85, Math.max(0.10, marginFloorPct / 100));

  for (let i = 0; i < styles.length; i++) {
    const s = styles[i];
    const r = recommendations[i] || {
      expectedClearancePct: 35,
      promotionalPriceSAR: s.ticketPrice * 0.8
    };

    totalStartingStock += (s.totalPhysicalStock || 0);
    andalusStartingStock += (s.stockAndalus || 0);
    yasmeenStartingStock += (s.stockYasmeen || 0);
    jouriStartingStock += (s.stockJouri || 0);

    const basePromoPrice = r.promotionalPriceSAR || s.ticketPrice;
    let simPromoPrice = basePromoPrice;
    let elasticityDampener = 1.0;

    // Enforce Net Margin Floor: Net Revenue ex-VAT must satisfy (NetRev - Cost) / NetRev >= marginFloorRatio
    // => NetRev >= Cost / (1 - marginFloorRatio)
    // => PromoPrice (incl. 15% VAT) >= (Cost / (1 - marginFloorRatio)) * 1.15
    if (s.unitCost > 0 && marginFloorRatio > 0 && marginFloorRatio < 1.0) {
      const minNetPriceExVat = s.unitCost / (1 - marginFloorRatio);
      const minPromoPriceInclVat = Math.round(minNetPriceExVat * 1.15 * 100) / 100;

      if (basePromoPrice < minPromoPriceInclVat) {
        // Price must be elevated to satisfy the executive net margin hurdle rate
        simPromoPrice = Math.min(s.ticketPrice, minPromoPriceInclVat);

        // Shallower discount dampens clearance velocity
        const baseDiscount = s.ticketPrice > 0 ? Math.max(0, 1 - (basePromoPrice / s.ticketPrice)) : 0;
        const constrainedDiscount = s.ticketPrice > 0 ? Math.max(0, 1 - (simPromoPrice / s.ticketPrice)) : 0;

        if (baseDiscount > 0) {
          elasticityDampener = Math.max(0.20, constrainedDiscount / baseDiscount);
        } else {
          elasticityDampener = 0.50;
        }
      }
    }

    // Calculate scaled clearance units incorporating volume scaling and margin-floor elasticity
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

    // Distribute store-level clearance proportional to on-hand inventory
    andalusSold += Math.round((s.stockAndalus || 0) * scaledRate);
    yasmeenSold += Math.round((s.stockYasmeen || 0) * scaledRate);
    jouriSold += Math.round((s.stockJouri || 0) * scaledRate);
  }

  const grossProfit = totalNetRev - totalCOGS;
  const realizedMargin = totalNetRev > 0 ? (grossProfit / totalNetRev) * 100 : 0;
  const retainedStock = Math.max(0, totalStartingStock - totalSold);
  const retainedShare = totalStartingStock > 0 ? (retainedStock / totalStartingStock) * 100 : 0;
  const clearanceShare = totalStartingStock > 0 ? (totalSold / totalStartingStock) * 100 : 0;

  const jouriEndStock = Math.max(0, jouriStartingStock - jouriSold);
  const jouriDensity = Math.round((jouriEndStock / STORE_SPACES.JOURI.areaM2) * 10) / 10;
  const jouriStatus = jouriDensity <= 40 ? 'Clean' : (jouriDensity <= 55 ? 'Manageable' : 'Bottleneck');

  return {
    projectedGrossRevenue: Math.round(totalGrossRev) || 0,
    projectedNetRevenue: Math.round(totalNetRev) || 0,
    projectedCOGS: Math.round(totalCOGS) || 0,
    projectedGrossProfit: Math.round(grossProfit) || 0,
    projectedNetProfit: Math.round(grossProfit) || 0,
    realizedMarginPct: Math.round(realizedMargin * 10) / 10,
    realizedNetMarginPct: Math.round(realizedMargin * 10) / 10,
    unitsSold: totalSold,
    retainedStockUnits: retainedStock,
    retainedStockPct: Math.round(retainedShare * 10) / 10,
    retainedWinterUnits: retainedStock,
    retainedWinterPct: Math.round(retainedShare * 10) / 10,
    clearanceSharePct: Math.round(clearanceShare * 10) / 10,
    postEventDensities: {
      andalusDensity: Math.round((Math.max(0, andalusStartingStock - andalusSold) / STORE_SPACES.ANDALUS.areaM2) * 10) / 10,
      yasmeenDensity: Math.round((Math.max(0, yasmeenStartingStock - yasmeenSold) / STORE_SPACES.YASMEEN.areaM2) * 10) / 10,
      jouriDensity: jouriDensity,
    },
    postEventJouriDensity: jouriDensity,
    jouriStatus: jouriStatus,
    marginFloorPreserved: realizedMargin >= (marginFloorPct - 0.05),
    targetMarginFloorPct: marginFloorPct
  };
}
