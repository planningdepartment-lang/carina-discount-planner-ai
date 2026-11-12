import { D1Database } from '@cloudflare/workers-types';
import { 
  fetchStylePlanSnapshots, 
  saveStylePlanSnapshots, 
  aggregateStylesDirectFromD1, 
  fetchBusinessRules,
  fetchManualOverrideSnapshots,
  fetchActiveCampaignMode
} from '../db/queries';
import { classifyStyleAndRecommend } from '../engine/lifecycleClassifier';
import { applyBusinessRules } from '../engine/rulePipeline';
import { calculateZeroLossFloor, evaluateSpeedAndHeroQualification, detectSingleSizeAssortment } from '../engine/metricsCalculator';
import { StylePlanRecord } from '../engine/posExporter';
import { LIFECYCLE_TIERS, CampaignMode } from '../config/constants';

let inFlightComputePromise: Promise<StylePlanRecord[]> | null = null;

function buildStylePlanRecords(
  metricsList: ReturnType<typeof aggregateStylesDirectFromD1> extends Promise<infer T> ? T : never,
  activeRules: Awaited<ReturnType<typeof fetchBusinessRules>>,
  manualOverrides: Awaited<ReturnType<typeof fetchManualOverrideSnapshots>>,
  activeMode: CampaignMode
): StylePlanRecord[] {
  return metricsList.map(metrics => {
    const manual = manualOverrides.get(metrics.styleCode);
    if (manual) {
      const floor = calculateZeroLossFloor(metrics.unitCost);
      const promoPrice = Math.max(floor, Number(manual.promotional_price) || metrics.ticketPrice);
      const discPct = metrics.ticketPrice > 0
        ? Math.round((1 - (promoPrice / metrics.ticketPrice)) * 1000) / 10
        : 0;
      const isSingleSize = detectSingleSizeAssortment(metrics.category, metrics.productName, metrics.isSingleSize, metrics.sizeBreakdown, metrics.everSizes);
      const hasHealthyCoreCurve = metrics.activeSizeCount >= 3 && metrics.hasCoreSizes !== false;
      const speedEval = evaluateSpeedAndHeroQualification({
        cumulativeSTR: metrics.cumulativeSTR,
        weeklyROS: metrics.weeklyROS,
        weeklyROS2wk: metrics.weeklyROS2wk,
        storeFloorWOS: metrics.storeFloorWOS,
        salesLifecycleWeeks: metrics.salesLifecycleWeeks,
        firstMoveDate: metrics.firstMoveDate,
        isSingleSize,
        hasHealthyCoreCurve,
        momentumRatio: metrics.momentumRatio
      });
      return {
        isManualOverride: true,
        metrics,
        recommendation: {
          tier: LIFECYCLE_TIERS.MANUAL_OVERRIDE,
          recommendedOffer: manual.recommended_offer || 'Custom Manual Override',
          discountPct: discPct,
          promotionalPriceSAR: promoPrice,
          expectedClearancePct: discPct >= 40 ? 45 : (discPct > 0 ? 35 : 20),
          rationale: manual.commercial_rationale || 'Manual user override preserved across snapshot refresh.',
          zeroLossStatus: promoPrice >= (floor - 0.01) ? 'YES' : 'FLAGGED',
          speedBand: speedEval.speedBand,
          strVelocityPctPerWeek: speedEval.strVelocityPctPerWeek,
          effectiveTenureWeeks: speedEval.effectiveTenureWeeks,
          campaignMode: activeMode,
          clearanceScope: 'NONE'
        }
      };
    }

    const rawProposal = classifyStyleAndRecommend(metrics, { campaignMode: activeMode });
    const governedProposal = applyBusinessRules(metrics, rawProposal, activeRules);
    return {
      isManualOverride: false,
      metrics,
      recommendation: governedProposal
    };
  });
}

/**
 * Reclassifies existing cached StyleMetrics against updated rules or campaign mode
 * without re-scanning 389k+ odoo_stock_move_line rows. Falls back cleanly to full D1 scan if cache is empty.
 */
export async function recomputeCachedStylePlan(
  db: D1Database,
  overrideMode?: CampaignMode
): Promise<StylePlanRecord[]> {
  return getOrComputeStylePlan(db, overrideMode, true);
}

/**
 * Service to retrieve cached snapshot plan or compute dynamically from live D1 stock move transactions.
 * Preserves any user manual overrides stored in D1, respects active Campaign Mode,
 * and coalesces concurrent cold-cache requests to prevent D1 overload.
 */
export async function getOrComputeStylePlan(
  db: D1Database,
  overrideMode?: CampaignMode,
  forceReclassify: boolean = false
): Promise<StylePlanRecord[]> {
  const activeMode = overrideMode || await fetchActiveCampaignMode(db);
  const cached = await fetchStylePlanSnapshots(db);

  if (!overrideMode && !forceReclassify && cached && cached.length > 0) {
    return cached.map(r => {
      const m = r.metrics;
      const isSingleSize = detectSingleSizeAssortment(m.category, m.productName, m.isSingleSize, m.sizeBreakdown, m.everSizes);
      const hasHealthyCoreCurve = m.activeSizeCount >= 3 && m.hasCoreSizes !== false;
      const speedEval = evaluateSpeedAndHeroQualification({
        cumulativeSTR: m.cumulativeSTR,
        weeklyROS: m.weeklyROS,
        weeklyROS2wk: m.weeklyROS2wk,
        storeFloorWOS: m.storeFloorWOS,
        salesLifecycleWeeks: m.salesLifecycleWeeks,
        firstMoveDate: m.firstMoveDate,
        isSingleSize,
        hasHealthyCoreCurve,
        momentumRatio: m.momentumRatio
      });
      const recTier = (r.recommendation.tier || '').toUpperCase();
      const isClearance = recTier.includes('CLEARANCE') || recTier === 'MATURE_SUMMER_EXIT';
      const isBigEvent = activeMode === 'WHITE_FRIDAY' || activeMode === 'SUMMER_EXIT' || activeMode === 'WINTER_EXIT';
      return {
        ...r,
        recommendation: {
          ...r.recommendation,
          speedBand: r.recommendation.speedBand || speedEval.speedBand,
          strVelocityPctPerWeek: r.recommendation.strVelocityPctPerWeek ?? speedEval.strVelocityPctPerWeek,
          effectiveTenureWeeks: r.recommendation.effectiveTenureWeeks ?? speedEval.effectiveTenureWeeks,
          campaignMode: r.recommendation.campaignMode || activeMode,
          clearanceScope: r.recommendation.clearanceScope || (isClearance ? (isBigEvent ? 'EVENT_CLEARANCE' : 'PERMANENT_ODDMENT_RAIL') : 'NONE')
        }
      };
    });
  }

  // Fast in-memory reclassification when cached StyleMetrics already exist (0 move-line scan)
  if ((overrideMode || forceReclassify) && cached && cached.length > 0) {
    const [activeRules, manualOverrides] = await Promise.all([
      fetchBusinessRules(db),
      fetchManualOverrideSnapshots(db)
    ]);
    const records = buildStylePlanRecords(cached.map(c => c.metrics), activeRules, manualOverrides, activeMode);
    if (records.length > 0) {
      try {
        await saveStylePlanSnapshots(db, records);
      } catch (err) {
        console.error('Snapshot save error:', err);
      }
    }
    return records;
  }

  // Coalesce concurrent cold-cache recomputes inside the isolate
  if (inFlightComputePromise) {
    return inFlightComputePromise;
  }

  inFlightComputePromise = (async () => {
    try {
      const [metricsList, activeRules, manualOverrides] = await Promise.all([
        aggregateStylesDirectFromD1(db),
        fetchBusinessRules(db),
        fetchManualOverrideSnapshots(db)
      ]);

      const records = buildStylePlanRecords(metricsList, activeRules, manualOverrides, activeMode);
      if (records.length > 0) {
        try {
          await saveStylePlanSnapshots(db, records);
        } catch (err) {
          console.error('Snapshot save error:', err);
        }
      }
      return records;
    } finally {
      inFlightComputePromise = null;
    }
  })();

  return inFlightComputePromise;
}
