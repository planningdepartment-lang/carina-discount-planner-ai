import { Env } from '../config/env';
import { runWhatIfSimulation } from '../engine/simulator';
import { getOrComputeStylePlan } from './styleService';

export async function handleSimulate(
  request: Request, 
  env: Env, 
  corsHeaders: Record<string, string>
): Promise<Response> {
  const body = (await request.json()) as any;
  const targetUnits = body.targetLiquidationUnits || body.targetLiquidation || 22550;
  const marginFloor = body.minimumNetMarginFloorPct || body.marginFloor || 48.0;
  const records = await getOrComputeStylePlan(env.DB);
  
  const styles = records.map(r => r.metrics);
  const recs = records.map(r => r.recommendation);
  const result = runWhatIfSimulation(styles, recs, {
    targetLiquidationUnits: targetUnits,
    minimumNetMarginFloorPct: marginFloor
  });

  return new Response(JSON.stringify(result), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
