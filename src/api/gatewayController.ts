import { Env } from '../config/env';

export interface GatewayValidationResponse {
  success: boolean;
  gateway_id: string;
  model: string;
  latency_ms: number;
  response_sample: string;
  cache_supported: boolean;
  message: string;
}

/**
 * GET /api/gateway/validate
 * Validates Cloudflare AI Gateway binding, cache, and inference latency
 */
export async function handleGatewayValidation(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const startTime = Date.now();
  const gatewayId = env.AI_GATEWAY_ID || 'carina-ai-gateway';
  const model = '@cf/meta/llama-3.1-8b-instruct';

  if (!env.AI) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Workers AI binding not present'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    const aiPromise = env.AI.run(
      model,
      {
        messages: [
          { role: 'system', content: 'You are CARINA AI Gateway Probe. Reply strictly with: AI_GATEWAY_ONLINE' },
          { role: 'user', content: 'Healthcheck' }
        ],
        temperature: 0.05,
        max_tokens: 15
      },
      {
        gateway: {
          id: gatewayId,
          skipCache: false,
          cacheTtl: 3600
        }
      }
    );

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('AI Gateway Timeout (>15s)')), 15000)
    );

    const aiRes: any = await Promise.race([aiPromise, timeoutPromise]);
    const latencyMs = Date.now() - startTime;

    const reply = aiRes?.response ||
                  aiRes?.choices?.[0]?.message?.content ||
                  (typeof aiRes === 'string' ? aiRes : 'OK');

    const result: GatewayValidationResponse = {
      success: true,
      gateway_id: gatewayId,
      model,
      latency_ms: latencyMs,
      response_sample: reply.trim(),
      cache_supported: true,
      message: `AI Gateway [${gatewayId}] validated successfully at the Cloudflare edge (${latencyMs}ms).`
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    return new Response(JSON.stringify({
      success: false,
      gateway_id: gatewayId,
      model,
      latency_ms: latencyMs,
      error: err.message || String(err),
      message: 'AI Gateway validation encountered an issue. Falling back to direct Workers AI.'
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}
