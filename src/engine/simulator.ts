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
  realizedMarginPct: number;
  unitsSold: number;
  retainedStockUnits: number;
  retainedStockPct: number;
  clearanceSharePct: number;
  postEventDensities: {
    andalusDensity: number; // Target <= 25 u/m²
    yasmeenDensity: number; // Target <= 35 u/m²
    jouriDensity: number;   // Target <= 36 u/m²
  };
}

/**
 * Real-Time What-If Inventory Liquidation Simulator
 * Evaluates the impact of target liquidation volumes and margin floors on cash and store physics.
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

  // Global scale factor if user requested a specific liquidation target
  let globalClearanceScale = 1.0;
  if (params?.targetLiquidationUnits && params.targetLiquidationUnits > 0) {
    let baselineForecastSold = 0;
    for (let i = 0; i < styles.length; i++) {
      baselineForecastSold += Math.round(styles[i].totalPhysicalStock * (recommendations[i].expectedClearancePct / 100));
    }
    if (baselineForecastSold > 0) {
      globalClearanceScale = params.targetLiquidationUnits / baselineForecastSold;
    }
  }

  for (let i = 0; i < styles.length; i++) {
    const s = styles[i];
    const r = recommendations[i];

    totalStartingStock += s.totalPhysicalStock;
    andalusStartingStock += s.stockAndalus;
    yasmeenStartingStock += s.stockYasmeen;
    jouriStartingStock += s.stockJouri;

    // Calculate scaled clearance units
    const scaledRate = Math.min(0.95, (r.expectedClearancePct / 100) * globalClearanceScale);
    const styleUnitsSold = Math.round(s.totalPhysicalStock * scaledRate);

    const grossRev = styleUnitsSold * r.promotionalPriceSAR;
    const netRev = grossRev / 1.15;
    const cogs = styleUnitsSold * s.unitCost;

    totalSold += styleUnitsSold;
    totalGrossRev += grossRev;
    totalNetRev += netRev;
    totalCOGS += cogs;

    // Distribute store-level clearance proportional to on-hand inventory
    andalusSold += Math.round(s.stockAndalus * scaledRate);
    yasmeenSold += Math.round(s.stockYasmeen * scaledRate);
    jouriSold += Math.round(s.stockJouri * scaledRate);
  }

  const grossProfit = totalNetRev - totalCOGS;
  const realizedMargin = totalNetRev > 0 ? (grossProfit / totalNetRev) * 100 : 0;
  const retainedStock = Math.max(0, totalStartingStock - totalSold);
  const retainedShare = totalStartingStock > 0 ? (retainedStock / totalStartingStock) * 100 : 0;
  const clearanceShare = totalStartingStock > 0 ? (totalSold / totalStartingStock) * 100 : 0;

  return {
    projectedGrossRevenue: Math.round(totalGrossRev),
    projectedNetRevenue: Math.round(totalNetRev),
    projectedCOGS: Math.round(totalCOGS),
    projectedGrossProfit: Math.round(grossProfit),
    realizedMarginPct: Math.round(realizedMargin * 10) / 10,
    unitsSold: totalSold,
    retainedStockUnits: retainedStock,
    retainedStockPct: Math.round(retainedShare * 10) / 10,
    clearanceSharePct: Math.round(clearanceShare * 10) / 10,
    postEventDensities: {
      andalusDensity: Math.round((Math.max(0, andalusStartingStock - andalusSold) / STORE_SPACES.ANDALUS.areaM2) * 10) / 10,
      yasmeenDensity: Math.round((Math.max(0, yasmeenStartingStock - yasmeenSold) / STORE_SPACES.YASMEEN.areaM2) * 10) / 10,
      jouriDensity: Math.round((Math.max(0, jouriStartingStock - jouriSold) / STORE_SPACES.JOURI.areaM2) * 10) / 10,
    }
  };
}
