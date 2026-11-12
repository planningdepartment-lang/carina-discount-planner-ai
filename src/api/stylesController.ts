import { Env } from '../config/env';
import { getOrComputeStylePlan } from './styleService';
import { analyzeCompetitorPosition } from '../engine/competitorAnalyzer';

export async function handleGetStyles(
  request: Request, 
  env: Env, 
  corsHeaders: Record<string, string>
): Promise<Response> {
  const url = new URL(request.url);
  const records = await getOrComputeStylePlan(env.DB);
  const search = url.searchParams.get('search')?.toLowerCase() || '';
  const category = url.searchParams.get('category') || '';
  const tier = url.searchParams.get('tier') || '';

  let filtered = records;
  if (search) {
    const s = search.trim();
    const searchTerms = [s];
    if (s.endsWith('s') && s.length > 3) searchTerms.push(s.slice(0, -1));
    else if (!s.endsWith('s')) searchTerms.push(s + 's');

    filtered = filtered.filter(r => {
      const pName = r.metrics.productName.toLowerCase();
      const sCode = r.metrics.styleCode.toLowerCase();
      const cat = (r.metrics.category || '').toLowerCase();
      const offer = (r.recommendation.recommendedOffer || '').toLowerCase();
      
      return searchTerms.some(term => 
        pName.includes(term) || 
        sCode.includes(term) || 
        cat.includes(term) ||
        offer.includes(term)
      );
    });
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
      if (c === 'socks' || c === 'sock') return cat.includes('sock');
      return cat.includes(c);
    });
  }
  if (tier && tier !== 'ALL') {
    const t = tier.toUpperCase();
    filtered = filtered.filter(r => {
      const offer = (r.recommendation.recommendedOffer || '').toUpperCase();
      const recTier = (r.recommendation.tier || '').toUpperCase();
      const season = (r.metrics.season || '').toUpperCase();

      const compactSeason = season.replace(/[\s_-]+/g, '');
      if (t === 'FLAGGED' || t === 'FLAGGED_PRICE_ERROR') {
        return r.recommendation.zeroLossStatus === 'FLAGGED' || 
               offer.includes('FLAGGED') || 
               recTier.includes('FLAGGED') || 
               r.metrics.ticketPrice < (Math.round(r.metrics.unitCost * 1.15 * 100) / 100 - 0.01);
      }
      if (t === 'STEADY_ACTIVE') return recTier === 'STEADY_ACTIVE' || offer.includes('SPEND & SAVE');
      if (t === 'HERO_CORE') return recTier === 'HERO_CORE' || offer.includes('MARGIN PROTECTION') || (offer.includes('0% OFF') && !recTier.includes('FLAGGED'));
      if (t === 'MATURE_SUMMER_EXIT') return recTier === 'MATURE_SUMMER_EXIT' || offer.includes('40%');
      if (t === 'CLEARANCE_50_PCT') return recTier === 'CLEARANCE_50_PCT' || offer.includes('50%');
      if (t === 'CLEARANCE_3_FOR_99') return recTier === 'CLEARANCE_3_FOR_99' || offer.includes('99 SAR');
      if (t === 'CLEARANCE_PERCENT_SAFE') return recTier === 'CLEARANCE_PERCENT_SAFE' || offer.includes('CLEARANCE RAIL');
      if (t === 'BUNDLE_2') return recTier === 'BUNDLE_2' || offer.includes('BUY 2 FOR');
      if (t === 'VOLUME_MULTI_BUY') return recTier === 'VOLUME_MULTI_BUY' || offer.includes('BASKET PACK') || offer.includes('BUY 2 GET 1');
      if (t === 'RULE_CAPPED_PROMO') return recTier === 'RULE_CAPPED_PROMO' || offer.includes('CAPPED PROMO');
      if (t === 'FRESH_WINTER') {
        return recTier === 'FRESH_WINTER' ||
               compactSeason.includes('AW26') ||
               compactSeason.includes('FW26') ||
               compactSeason.includes('WINTER2026');
      }
      if (t === 'CLEARANCE') return recTier.includes('CLEARANCE') || offer.includes('CLEARANCE') || offer.includes('RAIL');
      if (t === 'ACTIVE') return recTier === 'ACTIVE' || recTier === 'STEADY_ACTIVE';

      return recTier === t || offer.includes(t);
    });
  }

  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = parseInt(url.searchParams.get('limit') || '50');
  const paginated = filtered.slice((page - 1) * limit, page * limit);

  // Autonomous competitor benchmark enrichment for live display
  const enriched = paginated.map(r => {
    const comp = analyzeCompetitorPosition(
      r.metrics.category,
      r.metrics.productName,
      r.metrics.ticketPrice,
      r.recommendation.promotionalPriceSAR,
      r.metrics.unitCost
    );
    return {
      ...r,
      competitorBenchmark: {
        category: comp.category,
        posture: comp.competitivePosture,
        priceIndexNayomi: comp.priceIndexVsNayomi,
        priceIndexBlooming: comp.priceIndexVsBlooming,
        blendedIndex: comp.blendedMarketPriceIndex,
        tacticalOffer: comp.tacticalCounterOffer
      }
    };
  });

  return new Response(JSON.stringify({
    total: filtered.length,
    page,
    limit,
    data: enriched
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

export async function handleStyleOverride(
  request: Request, 
  env: Env, 
  corsHeaders: Record<string, string>
): Promise<Response> {
  const body = (await request.json()) as {
    styleCode: string;
    promotionalPrice: number;
    recommendedOffer: string;
  };

  const { results } = await env.DB
    .prepare('SELECT unit_cost, ticket_price, total_physical_stock FROM style_plan_snapshots WHERE style_code = ?')
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
  const totalStock = Number(results[0].total_physical_stock) || 0;
  const floor = Math.round(cost * 1.15 * 100) / 100;

  if (body.promotionalPrice < (floor - 0.01)) {
    return new Response(JSON.stringify({
      error: `Promotional price (${body.promotionalPrice} SAR) violates legal zero-loss floor (${floor.toFixed(2)} SAR).`
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const discountPct = ticket > 0 ? Math.round((1 - (body.promotionalPrice / ticket)) * 1000) / 10 : 0;
  const clearancePct = discountPct >= 40 ? 45 : (discountPct > 0 ? 35 : 20);
  const forecastSold = Math.round(totalStock * (clearancePct / 100));
  const postEventStock = Math.max(0, totalStock - forecastSold);
  const netRev = (forecastSold * body.promotionalPrice) / 1.15;
  const forecastProfit = Math.round(netRev - (forecastSold * cost));

  await env.DB.prepare(`
    UPDATE style_plan_snapshots 
    SET promotional_price = ?, recommended_offer = ?, discount_pct = ?,
        zero_loss_status = 'YES',
        lifecycle_tier = 'MANUAL_OVERRIDE',
        is_manual_override = 1,
        forecast_sold = ?,
        forecast_profit = ?,
        post_event_stock = ?,
        commercial_rationale = 'Manual user override applied in live planner.',
        last_computed_at = CURRENT_TIMESTAMP
    WHERE style_code = ?
  `).bind(
    body.promotionalPrice,
    body.recommendedOffer,
    discountPct,
    forecastSold,
    forecastProfit,
    postEventStock,
    body.styleCode
  ).run();

  return new Response(JSON.stringify({ success: true, discountPct }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
