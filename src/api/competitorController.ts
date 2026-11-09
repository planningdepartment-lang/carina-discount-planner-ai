import { Env } from '../config/env';
import { 
  KSA_COMPETITOR_BENCHMARKS, 
  getCompetitorIntelligenceSummary, 
  analyzeCompetitorPosition 
} from '../engine/competitorAnalyzer';

/**
 * GET /api/competitors/summary
 * Returns autonomous KSA competitor intelligence for Nayomi and Blooming.
 */
export async function handleGetCompetitorsSummary(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const summary = getCompetitorIntelligenceSummary();

  const responsePayload = {
    competitors: ['Nayomi', 'Blooming'],
    marketScope: 'Kingdom of Saudi Arabia (Jeddah Flagship & Mall Network, Taif)',
    categories: summary,
    benchmarks: KSA_COMPETITOR_BENCHMARKS,
    lastUpdated: new Date().toISOString()
  };

  return new Response(JSON.stringify(responsePayload), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
