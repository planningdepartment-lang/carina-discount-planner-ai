import { Env } from '../config/env';
import { STORE_SPACES } from '../config/constants';
import { getOrComputeStylePlan } from './styleService';

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

  for (const { metrics } of records) {
    totalStock += metrics.totalPhysicalStock;
    totalCost += (metrics.totalPhysicalStock * metrics.unitCost);
    totalRetail += (metrics.totalPhysicalStock * metrics.ticketPrice);
    andalusStock += metrics.stockAndalus;
    yasmeenStock += metrics.stockYasmeen;
    jouriStock += metrics.stockJouri;
    if (metrics.activeSizeCount >= 3) healthyCount++;
  }

  const blendedIMU = totalRetail > 0 ? ((totalRetail - totalCost) / totalRetail) * 100 : 0;

  const summary = {
    totalPhysicalStock: totalStock,
    totalCostCapitalSAR: Math.round(totalCost),
    totalRetailValueSAR: Math.round(totalRetail),
    blendedIMU: Math.round(blendedIMU * 10) / 10,
    activeStylesCount: records.length,
    healthyCurvesCount: healthyCount,
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
