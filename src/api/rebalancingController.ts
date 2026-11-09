import { Env } from '../config/env';
import { getOrComputeStylePlan } from './styleService';
import { generatePortfolioRebalancingPlan, evaluateStyleRebalance } from '../engine/storeRebalancer';

/**
 * Handles GET /api/stores/rebalance
 * Returns portfolio-wide or style-specific inter-store stock rebalancing recommendations.
 */
export async function handleGetStoreRebalance(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const styleCode = url.searchParams.get('style');
    const records = await getOrComputeStylePlan(env.DB);

    const mappedStyles = records.map(r => ({
      styleCode: r.metrics.styleCode,
      productName: r.metrics.productName,
      category: r.metrics.category || 'General',
      ticketPrice: r.metrics.ticketPrice,
      unitCost: r.metrics.unitCost,
      weeklyROS: r.metrics.weeklyROS,
      stockAndalus: r.metrics.stockAndalus,
      stockYasmeen: r.metrics.stockYasmeen,
      stockJouri: r.metrics.stockJouri,
      stockWH: r.metrics.stockWH,
      recommendedOffer: r.recommendation.recommendedOffer
    }));

    if (styleCode) {
      const match = mappedStyles.find(s => s.styleCode === styleCode);
      if (!match) {
        return new Response(JSON.stringify({ success: false, error: 'Style not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      const transfers = evaluateStyleRebalance(match);
      return new Response(JSON.stringify({
        success: true,
        style: match,
        transfers
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const rebalancePlan = generatePortfolioRebalancingPlan(mappedStyles);

    return new Response(JSON.stringify({
      success: true,
      timestamp: new Date().toISOString(),
      summary: {
        totalTransfers: rebalancePlan.totalRecommendedTransfers,
        totalUnits: rebalancePlan.totalUnitsToMove,
        grossMarginSavedSAR: rebalancePlan.totalGrossMarginSavedSAR,
        logisticsCostSAR: rebalancePlan.totalLogisticsCostSAR,
        netMarginPreservedSAR: rebalancePlan.totalNetMarginPreservedSAR
      },
      topTransfers: rebalancePlan.transfers.slice(0, 50)
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    console.error('Error computing store rebalance:', err);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}
