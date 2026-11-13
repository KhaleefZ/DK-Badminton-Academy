import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Says whether one more request from this key is allowed now. */
export type Limiter = { allow(key: string): Promise<boolean> };

/** Cloudflare's rate-limit binding, set up in wrangler.jsonc. */
export type RateLimitBinding = { limit(options: { key: string }): Promise<{ success: boolean }> };

/** The visitor's address. On Cloudflare this header is set by Cloudflare itself and can't be forged. */
export const clientIp = (req: Request): string | undefined => req.get('cf-connecting-ip') ?? req.ip;

/**
 * Counts in this process's memory. Used in tests and local runs. On Cloudflare each copy of the
 * Worker counts on its own, so production uses the binding below.
 */
export function memoryLimiter(max: number, windowMs: number): Limiter {
  const windows = new Map<string, { started: number; count: number }>();
  return {
    async allow(key) {
      const now = Date.now();
      const current = windows.get(key);
      if (!current || now - current.started >= windowMs) {
        if (windows.size > 10_000) windows.clear();
        windows.set(key, { started: now, count: 1 });
        return true;
      }
      current.count += 1;
      return current.count <= max;
    },
  };
}

export function bindingLimiter(binding: RateLimitBinding): Limiter {
  return { allow: async (key) => (await binding.limit({ key })).success };
}

/** Refuses with 429 once the visitor's address has used up its allowance. */
export function limitRequests(limiter: Limiter, message: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    limiter
      .allow(clientIp(req) ?? 'unknown')
      .then((allowed) => {
        if (allowed) next();
        else res.status(429).json({ error: { code: 'TOO_MANY_REQUESTS', message } });
      })
      .catch(next);
  };
}
