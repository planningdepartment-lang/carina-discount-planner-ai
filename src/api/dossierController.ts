import { Env } from '../config/env';
import { getOrComputeStylePlan } from './styleService';
import { buildExecutiveDossierData, renderBilingualDossierHTML } from '../engine/executiveDossier';
import { generatePortfolioRebalancingPlan } from '../engine/storeRebalancer';
import { KSA_RETAIL_CALENDAR, KsaEventId, getStyleEventStrategy } from '../engine/ksaRetailCalendar';

/**
 * Handles GET /api/reports/dossier
 * Formats: 'html' (default) or 'json'
 */
export async function handleGetExecutiveDossier(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const format = url.searchParams.get('format') || 'html';
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

    const rebalancePlan = generatePortfolioRebalancingPlan(mappedStyles);
    const dossierData = buildExecutiveDossierData(records, {
      totalTransfers: rebalancePlan.totalRecommendedTransfers,
      totalUnits: rebalancePlan.totalUnitsToMove,
      netMarginPreservedSAR: rebalancePlan.totalNetMarginPreservedSAR
    });

    if (format === 'json') {
      return new Response(JSON.stringify({ success: true, data: dossierData }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const html = renderBilingualDossierHTML(dossierData);
    return new Response(html, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
      }
    });
  } catch (err: any) {
    console.error('Error generating executive dossier:', err);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Handles GET /api/calendar/events
 * Returns the list of official KSA commercial events and markdown phases.
 */
export async function handleGetKsaCalendarEvents(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const eventId = url.searchParams.get('eventId') as KsaEventId | null;

    if (eventId && KSA_RETAIL_CALENDAR[eventId]) {
      return new Response(JSON.stringify({
        success: true,
        event: KSA_RETAIL_CALENDAR[eventId]
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const events = Object.values(KSA_RETAIL_CALENDAR);
    return new Response(JSON.stringify({
      success: true,
      events
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    console.error('Error fetching KSA calendar:', err);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}
