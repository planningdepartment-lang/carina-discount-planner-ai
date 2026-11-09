import { StyleMetrics, RecommendationResult } from './lifecycleClassifier';
import { STORE_SPACES } from '../config/constants';
import { 
  computeStyleStatisticalForecast, 
  ForecastScenario 
} from './statisticalForecaster';

export interface SimulationParams {
  targetLiquidationUnits?: number;    // e.g. 20000
  minimumNetMarginFloorPct?: number;  // e.g. 48.0
  promotionWeeks?: number;            // User-controlled promotion duration (1 to 8 weeks, default 4)
  scenario?: ForecastScenario;        // 'conservative' | 'base' | 'optimistic'
}

export interface SimulationResult {
  promotionWeeks: number;
  scenario: ForecastScenario;
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
 * Real-Time What-If Statistical Inventory Liquidation Simulator
 * Uses empirical velocity, log-log elasticity, broken-size walkout penalties,
 * competitor substitution drag, and user-selected promotional duration.
 */
export function runWhatIfSimulation(
  styles: StyleMetrics[],
  recommendations: RecommendationResult[],
  params?: SimulationParams
): SimulationResult {
  const promotionWeeks = Math.max(1, Math.min(12, params?.promotionWeeks ?? 4));
  const scenario = params?.scenario ?? 'base';

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

  // 1. Compute statistical baseline sales across catalog over the user's chosen promotion period
  const statForecasts = styles.map((s, idx) => {
    const r = recommendations[idx] || {
      expectedClearancePct: 25,
      promotionalPriceSAR: s.ticketPrice * 0.8
    };
    return computeStyleStatisticalForecast(s, r, {
      promotionWeeks,
      scenario,
      applyCompetitorDrag: true
    });
  });

  // 2. Global scale factor if user requested a specific liquidation volume target
  let globalClearanceScale = 1.0;
  if (params?.targetLiquidationUnits && params.targetLiquidationUnits > 0) {
    const baselineStatUnits = statForecasts.reduce((sum, f) => sum + f.forecastSoldUnits, 0);
    if (baselineStatUnits > 0) {
      globalClearanceScale = params.targetLiquidationUnits / baselineStatUnits;
    }
  }

  // 3. Minimum Realized Net Margin Floor constraint (Hurdle Rate)
  const marginFloorPct = params?.minimumNetMarginFloorPct ?? 48.0;
  const marginFloorRatio = Math.min(0.85, Math.max(0.10, marginFloorPct / 100));

  for (let i = 0; i < styles.length; i++) {
    const s = styles[i];
    const r = recommendations[i] || {
      expectedClearancePct: 25,
      promotionalPriceSAR: s.ticketPrice * 0.8
    };
    const f = statForecasts[i];

    totalStartingStock += (s.totalPhysicalStock || 0);
    andalusStartingStock += (s.stockAndalus || 0);
    yasmeenStartingStock += (s.stockYasmeen || 0);
    jouriStartingStock += (s.stockJouri || 0);

    const basePromoPrice = r.promotionalPriceSAR || s.ticketPrice;
    let simPromoPrice = basePromoPrice;
    let elasticityDampener = 1.0;

    // Enforce Net Margin Floor: Net Revenue ex-VAT must satisfy (NetRev - Cost) / NetRev >= marginFloorRatio
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

    // Scaled units sold based on statistical model, target liquidation multiplier, and elasticity dampener
    const scaledUnits = Math.round(f.forecastSoldUnits * globalClearanceScale * elasticityDampener);
    const styleUnitsSold = Math.min(s.totalPhysicalStock || 0, Math.max(0, scaledUnits));

    const grossRev = styleUnitsSold * simPromoPrice;
    const netRev = grossRev / 1.15; // 15% VAT ex-tax
    const cogs = styleUnitsSold * (s.unitCost || 0);

    totalSold += styleUnitsSold;
    totalGrossRev += grossRev;
    totalNetRev += netRev;
    totalCOGS += cogs;

    // Distribute store-level clearance proportional to on-hand inventory
    const clearanceRatio = (s.totalPhysicalStock || 0) > 0 ? styleUnitsSold / s.totalPhysicalStock : 0;
    andalusSold += Math.round((s.stockAndalus || 0) * clearanceRatio);
    yasmeenSold += Math.round((s.stockYasmeen || 0) * clearanceRatio);
    jouriSold += Math.round((s.stockJouri || 0) * clearanceRatio);
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
    promotionWeeks,
    scenario,
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
