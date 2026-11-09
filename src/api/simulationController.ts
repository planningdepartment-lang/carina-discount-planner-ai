import { Env } from '../config/env';
import { runWhatIfSimulation } from '../engine/simulator';
import { getOrComputeStylePlan } from './styleService';
import { ForecastScenario } from '../engine/statisticalForecaster';

export async function handleSimulate(
  request: Request, 
  env: Env, 
  corsHeaders: Record<string, string>
): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as any;
  const targetUnits = body.targetLiquidationUnits || body.targetLiquidation || undefined;
  const marginFloor = body.minimumNetMarginFloorPct || body.marginFloor || 48.0;
  const promotionWeeks = body.promotionWeeks || body.weeks || 4;
  const scenario = (body.scenario as ForecastScenario) || 'base';

  const records = await getOrComputeStylePlan(env.DB);
  
  const styles = records.map(r => r.metrics);
  const recs = records.map(r => r.recommendation);
  const result = runWhatIfSimulation(styles, recs, {
    targetLiquidationUnits: targetUnits,
    minimumNetMarginFloorPct: marginFloor,
    promotionWeeks,
    scenario
  });

  return new Response(JSON.stringify(result), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
