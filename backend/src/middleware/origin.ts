import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Stops other websites from sending requests using a signed-in browser's cookie.
 * Browsers always attach Origin to these requests and page scripts can't change it.
 */
export const requireTrustedOrigin =
  (trustedOrigin: string) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (!SAFE_METHODS.has(req.method) && req.get('origin') !== trustedOrigin) {
      throw new AppError(403, 'UNTRUSTED_ORIGIN', 'This request was blocked.');
    }
    next();
  };
