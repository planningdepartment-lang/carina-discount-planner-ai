import { Env } from './config/env';
import { handleMetricsSummary } from './api/metricsController';
import { handleGetStyles, handleStyleOverride } from './api/stylesController';
import { handleSimulate } from './api/simulationController';
import { handleRules } from './api/rulesController';
import { handleCopilotChatRoute } from './api/copilotController';
import { handleExportPosCsv } from './api/exportController';
import { 
  handleRetrainingStatus, 
  handleUpdateRetrainingSettings, 
  handleTriggerRetraining, 
  handleCopilotFeedback 
} from './api/retrainingController';
import { handleGatewayValidation } from './api/gatewayController';
import { handleCampaignBriefing } from './api/reportController';
import { handleLogin, handleLogout, handleMe } from './api/authController';
import { parseCookies, validateAdminSession, COOKIE_NAME } from './auth/adminAuth';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    // Standard CORS headers supporting credentials
    const origin = request.headers.get('Origin') || '';
    const corsHeaders: Record<string, string> = {
      'Access-Control-Allow-Origin': origin || '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Credentials': 'true'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // 0. Public Authentication Endpoints
      if (pathname === '/api/auth/login' && request.method === 'POST') {
        return await handleLogin(request, env, corsHeaders);
      }
      if (pathname === '/api/auth/logout' && request.method === 'POST') {
        return await handleLogout(request, env, corsHeaders);
      }
      if (pathname === '/api/auth/me' && request.method === 'GET') {
        return await handleMe(request, env, corsHeaders);
      }

      // Check Admin Session Authentication
      const cookies = parseCookies(request.headers.get('Cookie'));
      const authHeader = request.headers.get('Authorization') || '';
      const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      const sessionId = cookies[COOKIE_NAME] || bearerToken;

      let isAuthenticated = false;
      if (sessionId && env.DB) {
        const sessionCheck = await validateAdminSession(env.DB, sessionId);
        isAuthenticated = sessionCheck.isValid;
      }

      // Gatekeeper: Block unauthenticated requests to protected /api/* endpoints
      if (pathname.startsWith('/api/')) {
        if (!isAuthenticated) {
          return new Response(JSON.stringify({ 
            error: 'Unauthorized: Admin authentication required', 
            authenticated: false 
          }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      }

      // 1. Diagnostic AI & AI Gateway validation endpoints
      if (pathname === '/api/gateway/validate' && request.method === 'GET') {
        return await handleGatewayValidation(request, env, corsHeaders);
      }

      if (pathname === '/api/retraining/status' && request.method === 'GET') {
        return await handleRetrainingStatus(request, env, corsHeaders);
      }

      if (pathname === '/api/retraining/settings' && request.method === 'POST') {
        return await handleUpdateRetrainingSettings(request, env, corsHeaders);
      }

      if (pathname === '/api/retraining/trigger' && request.method === 'POST') {
        return await handleTriggerRetraining(request, env, corsHeaders);
      }

      if (pathname === '/api/copilot/feedback' && request.method === 'POST') {
        return await handleCopilotFeedback(request, env, corsHeaders);
      }

      if (pathname === '/api/test-ai') {
        const m = url.searchParams.get('model') || '@cf/meta/llama-3.1-8b-instruct';
        try {
          const res = await env.AI.run(m, {
            messages: [{ role: 'user', content: 'Say hello in 3 words' }]
          });
          return new Response(JSON.stringify({ success: true, model: m, result: res }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        } catch (e: any) {
          return new Response(JSON.stringify({ success: false, model: m, error: e?.message || String(e), stack: e?.stack }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      }

      // 2. Metrics Summary API
      if (pathname === '/api/metrics/summary' && request.method === 'GET') {
        return await handleMetricsSummary(request, env, corsHeaders);
      }

      // 3. Styles Catalog & Filters API
      if (pathname === '/api/styles' && request.method === 'GET') {
        return await handleGetStyles(request, env, corsHeaders);
      }

      // 4. Style Manual Override API
      if (pathname === '/api/styles/override' && request.method === 'POST') {
        return await handleStyleOverride(request, env, corsHeaders);
      }

      // 5. What-If Financial Simulator API
      if (pathname === '/api/simulate' && request.method === 'POST') {
        return await handleSimulate(request, env, corsHeaders);
      }

      // 6. Commercial Governance Rules API
      if (pathname === '/api/rules') {
        return await handleRules(request, env, corsHeaders);
      }

      // 7. Copilot Multi-Turn AI Advisor API
      if (pathname === '/api/copilot/chat' && request.method === 'POST') {
        return await handleCopilotChatRoute(request, env, corsHeaders);
      }

      // 8. Odoo POS Pricelist CSV Exporter API
      if (pathname === '/api/export/pos-csv' && request.method === 'GET') {
        return await handleExportPosCsv(request, env, corsHeaders);
      }

      // 8b. Universal Campaign & Executive Briefing API
      if (pathname === '/api/reports/campaign-briefing' && request.method === 'GET') {
        return await handleCampaignBriefing(request, env, corsHeaders);
      }

      // 9. Static Assets & Dashboard UI Gatekeeper
      if (env.ASSETS) {
        // If unauthenticated user accesses dashboard root -> Redirect to /login.html
        if (!isAuthenticated && (pathname === '/' || pathname === '/index.html')) {
          return Response.redirect(new URL('/login.html', request.url).toString(), 302);
        }

        // If authenticated user visits login page -> Redirect to dashboard root
        if (isAuthenticated && pathname === '/login.html') {
          return Response.redirect(new URL('/', request.url).toString(), 302);
        }

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
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log(`[Cron Triggered]: Checking AI retraining schedules at ${new Date().toISOString()}...`);
    if (env.DB) {
      try {
        const { results } = await env.DB.prepare(
          `SELECT * FROM ai_retraining_settings WHERE id = 'GLOBAL' AND auto_enabled = 1 AND next_scheduled_at <= datetime('now')`
        ).all<{ retraining_period: string }>();

        if (results && results.length > 0) {
          const period = results[0].retraining_period || 'weekly';
          let days = 7;
          if (period === 'daily') days = 1;
          if (period === 'weekly') days = 7;
          if (period === 'biweekly') days = 14;
          if (period === 'monthly') days = 30;

          await env.DB.prepare(
            `UPDATE ai_retraining_settings 
             SET last_trained_at = CURRENT_TIMESTAMP, 
                 next_scheduled_at = datetime('now', '+' || ? || ' days'),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = 'GLOBAL'`
          ).bind(days).run();

          console.log(`[Cron Success]: Automated model retraining completed for period: ${period}. Next scheduled run in ${days} days.`);
        }
      } catch (err) {
        console.error('[Cron Failure]:', err);
      }
    }
  }
};
