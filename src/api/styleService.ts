import { D1Database } from '@cloudflare/workers-types';
import { 
  fetchStylePlanSnapshots, 
  saveStylePlanSnapshots, 
  aggregateStylesDirectFromD1, 
  fetchBusinessRules 
} from '../db/queries';
import { classifyStyleAndRecommend } from '../engine/lifecycleClassifier';
import { applyBusinessRules } from '../engine/rulePipeline';
import { StylePlanRecord } from '../engine/posExporter';

/**
 * Service to retrieve cached snapshot plan or compute dynamically from live D1 stock move transactions.
 */
export async function getOrComputeStylePlan(db: D1Database): Promise<StylePlanRecord[]> {
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
