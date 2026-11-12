import { Env } from '../config/env';
import { CAMPAIGN_MODE_LABELS, CampaignMode } from '../config/constants';
import {
  fetchActiveCampaignMode,
  saveActiveCampaignMode,
  clearStylePlanSnapshots
} from '../db/queries';
import { getOrComputeStylePlan } from './styleService';
import { evaluateSpeedAndHeroQualification } from '../engine/metricsCalculator';

/**
 * Computes portfolio tier & speed-band counts cleanly for UI summary feedback.
 */
function buildModeSummary(records: Awaited<ReturnType<typeof getOrComputeStylePlan>>) {
  let heroes = 0;
  let medium2A = 0;
  let medium2B = 0;
  let permanentRail = 0;
  let eventClearance = 0;
  let launchShield = 0;
  let zeroLossViolations = 0;

  for (const r of records) {
    const rec = r.recommendation;
    const band = rec.speedBand;
    if (rec.zeroLossStatus === 'FLAGGED') zeroLossViolations++;
    if (rec.tier === 'HERO_CORE' || rec.tier === 'FRESH_WINTER' || rec.tier === 'EXCLUDED_BY_RULE') {
      if (band === 'LAUNCH_SHIELD') launchShield++;
      else heroes++;
    } else if (rec.clearanceScope === 'EVENT_CLEARANCE') {
      eventClearance++;
    } else if (rec.clearanceScope === 'PERMANENT_ODDMENT_RAIL' || (rec.tier || '').includes('CLEARANCE') || rec.tier === 'MATURE_SUMMER_EXIT') {
      permanentRail++;
    } else if (band === 'MEDIUM_2B') {
      medium2B++;
    } else {
      medium2A++;
    }
  }

  return {
    totalStyles: records.length,
    heroes,
    launchShield,
    medium2A,
    medium2B,
    permanentRail,
    eventClearance,
    zeroLossViolations
  };
}

/**
 * GET /api/campaign/mode
 * Returns active Campaign Mode ('REGULAR_DROP_CYCLE' vs KSA Events) and available options.
 */
export async function handleGetCampaignMode(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const mode = await fetchActiveCampaignMode(env.DB);
  return new Response(JSON.stringify({
    success: true,
    campaignMode: mode,
    label: CAMPAIGN_MODE_LABELS[mode],
    availableModes: Object.entries(CAMPAIGN_MODE_LABELS).map(([id, label]) => ({ id, label }))
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

/**
 * POST /api/campaign/mode
 * Switches workspace Campaign Mode, clears non-override snapshots, and recomputes styles immediately.
 */
export async function handleSetCampaignMode(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as { campaignMode?: string };
    const mode = (body.campaignMode || 'REGULAR_DROP_CYCLE').toUpperCase() as CampaignMode;
    if (!CAMPAIGN_MODE_LABELS[mode]) {
      return new Response(JSON.stringify({
        error: `Invalid campaignMode '${body.campaignMode}'. Expected one of: ${Object.keys(CAMPAIGN_MODE_LABELS).join(', ')}`
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    await saveActiveCampaignMode(env.DB, mode);
    const records = await getOrComputeStylePlan(env.DB, mode, true);
    const summary = buildModeSummary(records);

    return new Response(JSON.stringify({
      success: true,
      campaignMode: mode,
      label: CAMPAIGN_MODE_LABELS[mode],
      summary
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || 'Error updating campaign mode' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

export interface MonitoringPerformanceItem {
  styleCode: string;
  productName: string;
  category: string;
  tier: string;
  speedBand: string;
  recommendedOffer: string;
  discountPct: number;
  promoPriceSAR: number;
  stock: number;
  baselineWeeklyROS: number;
  actualLast7dUnits: number;
  actualLast14dUnits: number;
  actualWeeklyROS: number;
  expectedWeeklyUnits: number;
  observedLiftMultiplier: number;
  alertStatus: 'EARLY_SELLOUT' | 'PROMO_STALL' | 'NORMAL';
  actionAdvice: string;
}

/**
 * Evaluates live post-launch performance alert status cleanly for unit tests and live API.
 */
export function evaluatePostPromoAlert(params: {
  discountPct: number;
  stock: number;
  baselineWeeklyROS: number;
  actualLast7dUnits: number;
  actualLast14dUnits: number;
  forecastSold14d: number;
}): {
  actualWeeklyROS: number;
  expectedWeeklyUnits: number;
  observedLiftMultiplier: number;
  alertStatus: 'EARLY_SELLOUT' | 'PROMO_STALL' | 'NORMAL';
  actionAdvice: string;
} {
  const actualWeeklyROS = Math.round((params.actualLast14dUnits / 2.0) * 10) / 10;
  const baseline = Math.max(0.2, Number(params.baselineWeeklyROS) || 0);
  const expectedWeeklyUnits = Math.max(baseline, Math.round((params.forecastSold14d / 2.0) * 10) / 10);
  const observedLiftMultiplier = Math.round((actualWeeklyROS / baseline) * 100) / 100;
  const weeksLeftAtLivePace = actualWeeklyROS > 0 ? params.stock / actualWeeklyROS : 999;

  // EARLY_SELLOUT: Promoted item selling >= 1.6x baseline and remaining stock < 3 weeks (or >75% forecast sold in 7d)
  if (
    params.discountPct > 0 &&
    params.actualLast14dUnits >= 3 &&
    observedLiftMultiplier >= 1.6 &&
    (weeksLeftAtLivePace <= 3.5 || (params.forecastSold14d > 0 && params.actualLast7dUnits >= params.forecastSold14d * 0.75))
  ) {
    return {
      actualWeeklyROS,
      expectedWeeklyUnits,
      observedLiftMultiplier,
      alertStatus: 'EARLY_SELLOUT',
      actionAdvice: 'Selling fast — consider ending discount early and restoring Full Price to save margin.'
    };
  }

  // PROMO_STALL: Promoted medium/clearance item with >=10 units sitting at <=1 unit sold in last 14 days
  if (
    params.discountPct >= 15 &&
    params.stock >= 10 &&
    params.actualLast14dUnits <= 1 &&
    observedLiftMultiplier < 0.75
  ) {
    return {
      actualWeeklyROS,
      expectedWeeklyUnits,
      observedLiftMultiplier,
      alertStatus: 'PROMO_STALL',
      actionAdvice: 'Promo stalled over last 14 days — step up offer to Clearance Rail or rebalance Jouri/Yasmeen stock to Al-Andalus.'
    };
  }

  return {
    actualWeeklyROS,
    expectedWeeklyUnits,
    observedLiftMultiplier,
    alertStatus: 'NORMAL',
    actionAdvice: 'Demand is tracking smoothly inside forecasted bounds.'
  };
}

/**
 * GET /api/monitoring/performance
 * Real-time AI Trust & Post-Promo Reality Check: compares forecasted speed vs actual recent Odoo sales.
 */
export async function handleGetMonitoringPerformance(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const [activeMode, records, recentSalesRes] = await Promise.all([
      fetchActiveCampaignMode(env.DB),
      getOrComputeStylePlan(env.DB),
      env.DB.prepare(`
        SELECT
          SUBSTR(TRIM(product_sku), 1, 5) AS style_code,
          SUM(CASE WHEN date >= datetime('now', '-7 days') THEN COALESCE(quantity, qty_done, 0) ELSE 0 END) AS sold_7d,
          SUM(CASE WHEN date >= datetime('now', '-14 days') THEN COALESCE(quantity, qty_done, 0) ELSE 0 END) AS sold_14d
        FROM odoo_stock_move_line
        WHERE product_sku GLOB '[0-9][0-9][0-9][0-9][0-9]-*'
          AND state = 'done'
          AND location_dest_id_name = 'Partners/Customers'
          AND date >= datetime('now', '-14 days')
        GROUP BY SUBSTR(TRIM(product_sku), 1, 5)
      `).all<{ style_code: string; sold_7d: number; sold_14d: number }>()
    ]);

    const salesMap = new Map<string, { sold7d: number; sold14d: number }>();
    for (const row of recentSalesRes.results || []) {
      salesMap.set(row.style_code, {
        sold7d: Math.max(0, Math.round(Number(row.sold_7d) || 0)),
        sold14d: Math.max(0, Math.round(Number(row.sold_14d) || 0))
      });
    }

    const tracked: MonitoringPerformanceItem[] = [];
    let earlySelloutCount = 0;
    let promoStallCount = 0;
    let normalCount = 0;
    let zeroLossPassCount = 0;
    let forecastErrWeightedSum = 0;
    let forecastActualTotal = 0;

    for (const r of records) {
      const m = r.metrics;
      const rec = r.recommendation;
      if (rec.zeroLossStatus === 'YES') zeroLossPassCount++;

      const actual = salesMap.get(m.styleCode) || { sold7d: 0, sold14d: 0 };
      const forecastSold14d = Math.max(0, Math.round((m.totalPhysicalStock || 0) * ((rec.expectedClearancePct || 0) / 100)));
      const evalAlert = evaluatePostPromoAlert({
        discountPct: rec.discountPct || 0,
        stock: m.totalPhysicalStock || 0,
        baselineWeeklyROS: m.weeklyROS || 0,
        actualLast7dUnits: actual.sold7d,
        actualLast14dUnits: actual.sold14d,
        forecastSold14d
      });

      if (evalAlert.alertStatus === 'EARLY_SELLOUT') earlySelloutCount++;
      else if (evalAlert.alertStatus === 'PROMO_STALL') promoStallCount++;
      else normalCount++;

      // Baseline weekly tracking accuracy over active styles (|actual_weekly - expected_baseline_weekly|)
      const baselineExpected14d = Math.max(0, (m.weeklyROS || 0) * 2);
      if (baselineExpected14d > 0 || actual.sold14d > 0) {
        forecastErrWeightedSum += Math.abs(actual.sold14d - baselineExpected14d);
        forecastActualTotal += Math.max(actual.sold14d, baselineExpected14d);
      }

      const speedEval = evaluateSpeedAndHeroQualification({
        cumulativeSTR: m.cumulativeSTR,
        weeklyROS: m.weeklyROS,
        weeklyROS2wk: m.weeklyROS2wk,
        storeFloorWOS: m.storeFloorWOS,
        salesLifecycleWeeks: m.salesLifecycleWeeks,
        firstMoveDate: m.firstMoveDate,
        isSingleSize: Boolean(m.isSingleSize),
        hasHealthyCoreCurve: m.activeSizeCount >= 3 && m.hasCoreSizes !== false,
        momentumRatio: m.momentumRatio
      });

      if (evalAlert.alertStatus !== 'NORMAL' || actual.sold14d >= 4 || m.totalPhysicalStock >= 30) {
        tracked.push({
          styleCode: m.styleCode,
          productName: m.productName,
          category: m.category,
          tier: rec.tier,
          speedBand: rec.speedBand || speedEval.speedBand,
          recommendedOffer: rec.recommendedOffer,
          discountPct: rec.discountPct,
          promoPriceSAR: rec.promotionalPriceSAR,
          stock: m.totalPhysicalStock,
          baselineWeeklyROS: m.weeklyROS,
          actualLast7dUnits: actual.sold7d,
          actualLast14dUnits: actual.sold14d,
          actualWeeklyROS: evalAlert.actualWeeklyROS,
          expectedWeeklyUnits: evalAlert.expectedWeeklyUnits,
          observedLiftMultiplier: evalAlert.observedLiftMultiplier,
          alertStatus: evalAlert.alertStatus,
          actionAdvice: evalAlert.actionAdvice
        });
      }
    }

    // Prioritize actionable alerts first, then top live velocity items
    tracked.sort((a, b) => {
      const rank = (s: string) => (s === 'EARLY_SELLOUT' ? 0 : s === 'PROMO_STALL' ? 1 : 2);
      const rDiff = rank(a.alertStatus) - rank(b.alertStatus);
      if (rDiff !== 0) return rDiff;
      return b.actualLast14dUnits - a.actualLast14dUnits || b.stock - a.stock;
    });

    const baselineAccuracyPct = forecastActualTotal > 0
      ? Math.max(0, Math.round((1 - Math.min(1, forecastErrWeightedSum / (forecastActualTotal * 2))) * 1000) / 10)
      : 100.0;

    return new Response(JSON.stringify({
      success: true,
      campaignMode: activeMode,
      campaignLabel: CAMPAIGN_MODE_LABELS[activeMode],
      trustScorecard: {
        totalActiveStyles: records.length,
        zeroLossCompliantCount: zeroLossPassCount,
        zeroLossCompliancePct: records.length > 0 ? Math.round((zeroLossPassCount / records.length) * 1000) / 10 : 100.0,
        baselineVelocityAlignmentPct: baselineAccuracyPct,
        earlySelloutCount,
        promoStallCount,
        normalCount
      },
      alerts: tracked.filter(t => t.alertStatus !== 'NORMAL').slice(0, 40),
      topActiveStyles: tracked.filter(t => t.alertStatus === 'NORMAL').slice(0, 25)
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || 'Error computing monitoring performance' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

/**
 * POST /api/monitoring/snapshot
 * Persists today's live post_promo_monitoring audit rows into D1 for longitudinal history.
 */
export async function handleRecordMonitoringSnapshot(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const perfRes = await handleGetMonitoringPerformance(request, env, corsHeaders);
    const data = (await perfRes.json()) as any;
    if (!data?.success) {
      return perfRes;
    }

    const today = new Date().toISOString().slice(0, 10);
    const items: MonitoringPerformanceItem[] = [
      ...(data.alerts || []),
      ...(data.topActiveStyles || [])
    ].slice(0, 50);

    await env.DB.prepare('DELETE FROM post_promo_monitoring WHERE audit_date = ?').bind(today).run().catch(() => {});
    const stmt = env.DB.prepare(`
      INSERT INTO post_promo_monitoring (
        style_code, audit_date, units_sold_today, cumulative_sold_post_launch,
        pre_promo_baseline_ros, observed_lift_multiplier, alert_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const BATCH = 25;
    for (let i = 0; i < items.length; i += BATCH) {
      const slice = items.slice(i, i + BATCH).map(it =>
        stmt.bind(
          it.styleCode,
          today,
          Math.round(it.actualLast7dUnits / 7),
          it.actualLast14dUnits,
          it.baselineWeeklyROS,
          it.observedLiftMultiplier,
          it.alertStatus
        )
      );
      if (slice.length > 0) await env.DB.batch(slice);
    }

    return new Response(JSON.stringify({
      success: true,
      auditDate: today,
      recordedCount: items.length,
      trustScorecard: data.trustScorecard
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || 'Error recording monitoring snapshot' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}
