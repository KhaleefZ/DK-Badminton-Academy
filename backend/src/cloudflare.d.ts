// Types for the two Cloudflare runtime modules the Worker entry uses. The bindings match wrangler.jsonc.
declare module 'cloudflare:workers' {
  import type { D1Database, KVNamespace } from '@cloudflare/workers-types';
  import type { RateLimitBinding } from './lib/rateLimit.js';
  export const env: {
    DB: D1Database;
    PHOTOS: KVNamespace;
    LOGIN_LIMIT: RateLimitBinding;
    RESET_LIMIT: RateLimitBinding;
    PUBLIC_WRITE_LIMIT: RateLimitBinding;
  };
}

declare module 'cloudflare:node' {
  export function httpServerHandler(options: { port: number }): { fetch(request: Request, env: unknown, ctx: unknown): Promise<Response> };
}
