import type { NextFunction, Request, Response } from 'express';
import { can, type Permission } from '../auth/permissions.js';
import { clearSessionCookie, findActiveSession, type ActiveSession } from '../auth/sessions.js';
import { AppError, forbidden, unauthorized } from '../lib/errors.js';

declare module 'express-serve-static-core' {
  interface Request {
    auth?: ActiveSession;
  }
}

export async function requireSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  const session = await findActiveSession(req);
  if (!session) {
    clearSessionCookie(res);
    throw unauthorized();
  }
  req.auth = session;
  next();
}

/** Blocks everything except changing the password while a temporary one is in use. */
export function requirePasswordCurrent(req: Request, _res: Response, next: NextFunction): void {
  if (req.auth?.staff.mustChangePassword) {
    throw new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'Change your temporary password to continue.');
  }
  next();
}

export const requirePermission =
  (permission: Permission) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth || !can(req.auth.staff.role, permission)) throw forbidden();
    next();
  };

/** The signed-in account. Only for handlers behind requireSession. */
export function currentAuth(req: Request): ActiveSession {
  if (!req.auth) throw unauthorized();
  return req.auth;
}
