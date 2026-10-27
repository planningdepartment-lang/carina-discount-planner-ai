import { Env } from './config/env';
import { 
  fetchBusinessRules, 
  saveBusinessRule, 
  fetchStylePlanSnapshots, 
  saveStylePlanSnapshots, 
  aggregateStylesDirectFromD1 
} from './db/queries';
import { classifyStyleAndRecommend, StyleMetrics, RecommendationResult } from './engine/lifecycleClassifier';
import { applyBusinessRules, BusinessRuleRecord } from './engine/rulePipeline';
import { runWhatIfSimulation, SimulationParams } from './engine/simulator';
import { generateOdooPOSPricelistCSV, StylePlanRecord } from './engine/posExporter';
import { handleCopilotChat, CopilotChatRequest } from './ai/copilot';
import { STORE_SPACES } from './config/constants';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    // CORS headers for cross-origin and local testing
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // 1. GET /api/metrics/summary
      if (pathname === '/api/metrics/summary' && request.method === 'GET') {
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

      // 2. GET /api/styles
      if (pathname === '/api/styles' && request.method === 'GET') {
        const records = await getOrComputeStylePlan(env.DB);
        const search = url.searchParams.get('search')?.toLowerCase() || '';
        const category = url.searchParams.get('category') || '';
        const tier = url.searchParams.get('tier') || '';

        let filtered = records;
        if (search) {
          filtered = filtered.filter(r => 
            r.metrics.productName.toLowerCase().includes(search) || 
            r.metrics.styleCode.toLowerCase().includes(search)
          );
        }
        if (category && category !== 'ALL') {
          const c = category.toLowerCase();
          filtered = filtered.filter(r => {
            const cat = (r.metrics.category || '').toLowerCase();
            if (c === 'beauty' || c === 'cosmetics') return cat.includes('cosmetic') || cat.includes('beauty');
            if (c === 'leggings' || c === 'pant' || c === 'pants') return cat.includes('legging') || cat.includes('pant') || cat.includes('bermuda');
            if (c === 'pyjama' || c === 'sleepwear') return cat.includes('pijama') || cat.includes('night gown') || cat.includes('robe');
            if (c === 'tops' || c === 'top') return cat.includes('top') || cat.includes('t-shirt') || cat.includes('shirt');
            if (c === 'brief' || c === 'panty') return cat.includes('brief') || cat.includes('panty') || cat.includes('bikini');
            if (c === 'short' || c === 'shorts') return cat.includes('short');
            return cat.includes(c);
          });
        }
        if (tier && tier !== 'ALL') {
          const t = tier.toUpperCase();
          filtered = filtered.filter(r => {
            const offer = (r.recommendation.recommendedOffer || '').toUpperCase();
            const recTier = (r.recommendation.tier || '').toUpperCase();
            const season = (r.metrics.season || '').toUpperCase();

            if (t === 'STEADY_ACTIVE') return offer.includes('SPEND & SAVE');
            if (t === 'HERO_CORE') return offer.includes('MARGIN PROTECTION') || offer.includes('0% OFF');
            if (t === 'MATURE_SUMMER_EXIT') return offer.includes('40%');
            if (t === 'CLEARANCE_50_PCT') return offer.includes('50%');
            if (t === 'CLEARANCE_3_FOR_99') return offer.includes('99 SAR');
            if (t === 'FRESH_WINTER') return season.includes('AW26') || season.includes('WINTER 2026');
            if (t === 'CLEARANCE') return recTier === 'CLEARANCE' || offer.includes('CLEARANCE') || offer.includes('RAIL');
            if (t === 'ACTIVE') return recTier === 'ACTIVE';

            return recTier === t || offer.includes(t);
          });
        }

        const page = parseInt(url.searchParams.get('page') || '1');
        const limit = parseInt(url.searchParams.get('limit') || '50');
        const paginated = filtered.slice((page - 1) * limit, page * limit);

        return new Response(JSON.stringify({
          total: filtered.length,
          page,
          limit,
          data: paginated
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // 2b. POST /api/styles/override (Manual Offer Override with Zero-Loss Lock)
      if (pathname === '/api/styles/override' && request.method === 'POST') {
        const body = (await request.json()) as {
          styleCode: string;
          promotionalPrice: number;
          recommendedOffer: string;
        };

        const { results } = await env.DB
          .prepare('SELECT unit_cost, ticket_price FROM style_plan_snapshots WHERE style_code = ?')
          .bind(body.styleCode)
          .all<any>();

        if (!results || results.length === 0) {
          return new Response(JSON.stringify({ error: 'Style not found' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const cost = Number(results[0].unit_cost) || 0;
        const ticket = Number(results[0].ticket_price) || 0;
        const floor = cost * 1.15;

        if (body.promotionalPrice < floor) {
          return new Response(JSON.stringify({
            error: `Promotional price (${body.promotionalPrice} SAR) violates legal zero-loss floor (${floor.toFixed(2)} SAR).`
          }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const discountPct = ticket > 0 ? Math.round((1 - (body.promotionalPrice / ticket)) * 100) : 0;

        await env.DB.prepare(`
          UPDATE style_plan_snapshots 
          SET promotional_price = ?, recommended_offer = ?, discount_pct = ?,
              commercial_rationale = 'Manual user override applied in live planner.'
          WHERE style_code = ?
        `).bind(body.promotionalPrice, body.recommendedOffer, discountPct, body.styleCode).run();

        return new Response(JSON.stringify({ success: true, discountPct }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // 3. POST /api/simulate
      if (pathname === '/api/simulate' && request.method === 'POST') {
        const body = (await request.json()) as SimulationParams;
        const records = await getOrComputeStylePlan(env.DB);
        
        const styles = records.map(r => r.metrics);
        const recs = records.map(r => r.recommendation);
        const result = runWhatIfSimulation(styles, recs, body);

        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // 4. GET /api/rules & POST /api/rules
      if (pathname === '/api/rules') {
        if (request.method === 'GET') {
          const rules = await fetchBusinessRules(env.DB);
          return new Response(JSON.stringify(rules), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        if (request.method === 'POST') {
          const ruleBody = (await request.json()) as BusinessRuleRecord;
          const ok = await saveBusinessRule(env.DB, ruleBody);
          return new Response(JSON.stringify({ success: ok }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      }

      // 5. POST /api/copilot/chat
      if (pathname === '/api/copilot/chat' && request.method === 'POST') {
        const chatReq = (await request.json()) as CopilotChatRequest;
        const chatRes = await handleCopilotChat(env, chatReq);
        return new Response(JSON.stringify(chatRes), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // 6. GET /api/export/pos-csv
      if (pathname === '/api/export/pos-csv' && request.method === 'GET') {
        const records = await getOrComputeStylePlan(env.DB);
        const csv = generateOdooPOSPricelistCSV(records);
        return new Response(csv, {
          headers: {
            ...corsHeaders,
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename="Odoo_POS_Promotional_Pricelist.csv"'
          }
        });
      }

      // 7. Serve Static Assets (Pages Dashboard)
      if (env.ASSETS) {
        return await env.ASSETS.fetch(request);
      }

      return new Response('CARINA Discount Planner API running on Cloudflare Workers.', {
        headers: { 'Content-Type': 'text/plain' }
      });
    } catch (err: any) {
      console.error('API Error:', err);
      return new Response(JSON.stringify({ error: err.message || 'Internal Server Error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};

/**
 * Helper to fetch cached plan or aggregate dynamically from D1 moves.
 */
async function getOrComputeStylePlan(db: D1Database): Promise<StylePlanRecord[]> {
  const cached = await fetchStylePlanSnapshots(db);
  if (cached && cached.length > 0) {
    return cached;
  }

  const metricsList = await aggregateStylesDirectFromD1(db);
  const activeRules = await fetchBusinessRules(db);

  const records: StylePlanRecord[] = metricsList.map(metrics => {
    const rawProposal = classifyStyleAndRecommend(metrics);
    const governedProposal = applyBusinessRules(metrics, rawProposal, activeRules);
    return {
      metrics,
      recommendation: governedProposal
    };
  });

  if (records.length > 0) {
    saveStylePlanSnapshots(db, records).catch(err => console.error('Snapshot background save error:', err));
  }

  return records;
}
