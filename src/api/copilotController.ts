import { Env } from '../config/env';
import { handleCopilotChat, CopilotChatRequest } from '../ai/copilot';

export async function handleCopilotChatRoute(
  request: Request, 
  env: Env, 
  corsHeaders: Record<string, string>
): Promise<Response> {
  const chatReq = (await request.json()) as CopilotChatRequest;
  const chatRes = await handleCopilotChat(env, chatReq);
  return new Response(JSON.stringify(chatRes), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
