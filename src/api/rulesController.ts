import { Env } from '../config/env';
import { 
  fetchBusinessRules, 
  saveBusinessRule, 
  deleteBusinessRule, 
  clearAllBusinessRules,
  restoreDefaultBusinessRules,
  clearStylePlanSnapshots
} from '../db/queries';
import { BusinessRuleRecord } from '../engine/rulePipeline';

export async function handleRules(
  request: Request, 
  env: Env, 
  corsHeaders: Record<string, string>
): Promise<Response> {
  const url = new URL(request.url);

  // Response headers enforcing zero caching for real-time consistency
  const responseHeaders = {
    ...corsHeaders,
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
  };

  try {
    if (request.method === 'GET') {
      if (url.searchParams.get('restore') === 'true') {
        await restoreDefaultBusinessRules(env.DB);
      }
      const rules = await fetchBusinessRules(env.DB);
      return new Response(JSON.stringify(rules), {
        headers: responseHeaders
      });
    }

    if (request.method === 'POST') {
      if (url.searchParams.get('restore') === 'true') {
        const ok = await restoreDefaultBusinessRules(env.DB);
        const rules = await fetchBusinessRules(env.DB);
        return new Response(JSON.stringify({ success: ok, restored: true, rules }), {
          headers: responseHeaders
        });
      }

      const ruleBody = (await request.json().catch(() => ({}))) as any;
      if (ruleBody && ruleBody.action === 'restore_defaults') {
        const ok = await restoreDefaultBusinessRules(env.DB);
        const rules = await fetchBusinessRules(env.DB);
        return new Response(JSON.stringify({ success: ok, restored: true, rules }), {
          headers: responseHeaders
        });
      }

      const ok = await saveBusinessRule(env.DB, ruleBody as BusinessRuleRecord);
      await clearStylePlanSnapshots(env.DB);
      return new Response(JSON.stringify({ success: ok }), {
        headers: responseHeaders
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
        const body = (await request.json().catch(() => ({}))) as any;
        if (body.clearAll) {
          ok = await clearAllBusinessRules(env.DB);
        } else if (body.rule_id) {
          ok = await deleteBusinessRule(env.DB, body.rule_id);
        }
      }

      await clearStylePlanSnapshots(env.DB);
      return new Response(JSON.stringify({ success: ok }), {
        headers: responseHeaders
      });
    }

    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: responseHeaders
    });
  } catch (err: any) {
    console.error('Error handling /api/rules:', err);
    return new Response(JSON.stringify({ 
      error: 'Failed to process governance rules', 
      message: err?.message || String(err) 
    }), {
      status: 500,
      headers: responseHeaders
    });
  }
}
