/**
 * Cloudflare Worker Environment Bindings
 */
export interface Env {
  DB: D1Database;
  AI: any;
  ASSETS?: Fetcher;
}
