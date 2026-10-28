/**
 * Cloudflare Worker Environment Bindings
 */
export interface Env {
  DB: D1Database;
  AI: any;
  ASSETS?: Fetcher;
  AI_GATEWAY_ID?: string;
  LORA_ADAPTER_NAME?: string;
}
