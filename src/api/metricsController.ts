import { Env } from '../config/env';
import { STORE_SPACES } from '../config/constants';
import { getOrComputeStylePlan } from './styleService';
import { classifyCurveHealth } from '../engine/metricsCalculator';

export async function handleMetricsSummary(
  request: Request, 
  env: Env, 
  corsHeaders: Record<string, string>
): Promise<Response> {
  const records = await getOrComputeStylePlan(env.DB);
  
  let totalStock = 0;
  let totalCost = 0;
  let totalRetail = 0;
  let andalusStock = 0;
  let yasmeenStock = 0;
  let jouriStock = 0;
  let healthyCount = 0;
  let winterStock = 0;
  let winterProtectedStock = 0;
  let retainedTotalStock = 0;
  let flaggedStylesCount = 0;

  for (const { metrics, recommendation } of records) {
    totalStock += metrics.totalPhysicalStock;
    totalCost += (metrics.totalPhysicalStock * metrics.unitCost);
    totalRetail += (metrics.totalPhysicalStock * metrics.ticketPrice);
    andalusStock += metrics.stockAndalus;
    yasmeenStock += metrics.stockYasmeen;
    jouriStock += metrics.stockJouri;

    const isAssortmentComplete = Boolean(metrics.isSingleSize) ||
      classifyCurveHealth(metrics.activeSizeCount, metrics.hasCoreSizes !== false).isHealthy;
    if (isAssortmentComplete) healthyCount++;

    if (recommendation.zeroLossStatus === 'FLAGGED' || recommendation.tier === 'FLAGGED_PRICE_ERROR') {
      flaggedStylesCount++;
    }

    const expectedClrPct = Math.min(100, Math.max(0, recommendation.expectedClearancePct || 0));
    const projectedSold = Math.round(metrics.totalPhysicalStock * (expectedClrPct / 100));
    const retained = Math.max(0, metrics.totalPhysicalStock - projectedSold);
    retainedTotalStock += retained;

    const compactSeason = (metrics.season || '').toUpperCase().replace(/[\s_-]+/g, '');
    if (compactSeason.includes('AW26') || compactSeason.includes('FW26') || compactSeason.includes('WINTER')) {
      winterStock += metrics.totalPhysicalStock;
      winterProtectedStock += recommendation.discountPct === 0 ? metrics.totalPhysicalStock : retained;
    }
  }

  const blendedIMU = totalRetail > 0 ? ((totalRetail - totalCost) / totalRetail) * 100 : 0;
  const healthyCurvesPct = records.length > 0 ? Math.round((healthyCount / records.length) * 1000) / 10 : 0;
  const assortmentRetentionPct = totalStock > 0 ? Math.round((retainedTotalStock / totalStock) * 1000) / 10 : 0;
  const winterProtectedPct = winterStock > 0
    ? Math.round((winterProtectedStock / winterStock) * 1000) / 10
    : assortmentRetentionPct;

  const summary = {
    totalPhysicalStock: totalStock,
    totalCostCapitalSAR: Math.round(totalCost),
    totalRetailValueSAR: Math.round(totalRetail),
    blendedIMU: Math.round(blendedIMU * 10) / 10,
    activeStylesCount: records.length,
    healthyCurvesCount: healthyCount,
    healthyCurvesPct,
    assortmentRetentionPct,
    winterProtectedPct,
    flaggedStylesCount,
    storeDensities: {
      andalus: {
        name: STORE_SPACES.ANDALUS.name,
        areaM2: STORE_SPACES.ANDALUS.areaM2,
        stock: andalusStock,
        density: Math.round((andalusStock / STORE_SPACES.ANDALUS.areaM2) * 10) / 10,
        status: andalusStock / STORE_SPACES.ANDALUS.areaM2 > 50 ? 'WARNING' : 'HEALTHY'
      },
      yasmeen: {
        name: STORE_SPACES.YASMEEN.name,
        areaM2: STORE_SPACES.YASMEEN.areaM2,
        stock: yasmeenStock,
        density: Math.round((yasmeenStock / STORE_SPACES.YASMEEN.areaM2) * 10) / 10,
        status: yasmeenStock / STORE_SPACES.YASMEEN.areaM2 > 55 ? 'CHOKED' : 'HEALTHY'
      },
      jouri: {
        name: STORE_SPACES.JOURI.name,
        areaM2: STORE_SPACES.JOURI.areaM2,
        stock: jouriStock,
        density: Math.round((jouriStock / STORE_SPACES.JOURI.areaM2) * 10) / 10,
        status: jouriStock / STORE_SPACES.JOURI.areaM2 > 60 ? 'CHOKED' : 'HEALTHY'
      }
    }
  };

  return new Response(JSON.stringify(summary), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
