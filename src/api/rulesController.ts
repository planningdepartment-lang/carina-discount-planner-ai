import { Env } from '../config/env';
import { 
  fetchBusinessRules, 
  saveBusinessRule, 
  deleteBusinessRule, 
  clearAllBusinessRules 
} from '../db/queries';
import { BusinessRuleRecord } from '../engine/rulePipeline';

export async function handleRules(
  request: Request, 
  env: Env, 
  corsHeaders: Record<string, string>
): Promise<Response> {
  const url = new URL(request.url);

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

  if (request.method === 'DELETE') {
    const ruleId = url.searchParams.get('rule_id');
    const isClearAll = url.searchParams.get('all') === 'true';
    let ok = false;

    if (isClearAll) {
      ok = await clearAllBusinessRules(env.DB);
    } else if (ruleId) {
      ok = await deleteBusinessRule(env.DB, ruleId);
    } else {
      const body = await request.json().catch(() => ({})) as any;
      if (body.clearAll) {
        ok = await clearAllBusinessRules(env.DB);
      } else if (body.rule_id) {
        ok = await deleteBusinessRule(env.DB, body.rule_id);
      }
    }

    return new Response(JSON.stringify({ success: ok }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
    status: 405,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
