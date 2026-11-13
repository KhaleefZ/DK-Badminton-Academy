import type { CookieOptions, Request, Response } from 'express';
import { and, eq, gt, lt, ne } from 'drizzle-orm';
import { isProduction } from '../config.js';
import { db } from '../db/client.js';
import { adminSessions, staff, type Staff } from '../db/schema.js';
import { generateToken, hashToken } from './crypto.js';
import { clientIp } from '../lib/rateLimit.js';
import { AUTH_POLICY } from './policy.js';

export const SESSION_COOKIE = 'dk_admin_session';

// Writing last-seen on every request would add a database write to each API call.
const LAST_SEEN_INTERVAL_MS = 5 * 60 * 1000;

const baseCookie: CookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'lax',
  path: '/',
};

export async function createSession(staffId: string, remember: boolean, req: Request, res: Response): Promise<void> {
  const lifetimeMs = remember ? AUTH_POLICY.rememberDays * 86_400_000 : AUTH_POLICY.sessionHours * 3_600_000;
  const token = generateToken();
  await db.insert(adminSessions).values({
    staffId,
    tokenHash: hashToken(token),
    remember,
    ip: clientIp(req),
    userAgent: req.get('user-agent'),
    expiresAt: new Date(Date.now() + lifetimeMs),
  });
  // Without "keep me signed in" the cookie also ends when the browser closes.
  res.cookie(SESSION_COOKIE, token, remember ? { ...baseCookie, maxAge: lifetimeMs } : baseCookie);
  // Expired rows have no use; clearing them at login keeps the table small without a scheduler.
  await db.delete(adminSessions).where(lt(adminSessions.expiresAt, new Date()));
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, baseCookie);
}

const sessionToken = (req: Request): string | undefined => {
  const value: unknown = req.cookies?.[SESSION_COOKIE];
  return typeof value === 'string' && value ? value : undefined;
};

export type ActiveSession = { sessionId: string; staff: Staff };

/** Checked on every request, so deactivation or a role change takes effect immediately. */
export async function findActiveSession(req: Request): Promise<ActiveSession | null> {
  const token = sessionToken(req);
  if (!token) return null;
  const [row] = await db
    .select({ session: adminSessions, staff })
    .from(adminSessions)
    .innerJoin(staff, eq(staff.id, adminSessions.staffId))
    .where(and(eq(adminSessions.tokenHash, hashToken(token)), gt(adminSessions.expiresAt, new Date())));
  if (!row || row.staff.status !== 'active' || row.staff.deletedAt) return null;

  if (Date.now() - row.session.lastSeenAt.getTime() > LAST_SEEN_INTERVAL_MS) {
    await db.update(adminSessions).set({ lastSeenAt: new Date() }).where(eq(adminSessions.id, row.session.id));
  }
  return { sessionId: row.session.id, staff: row.staff };
}

export async function deleteSessionByToken(req: Request): Promise<void> {
  const token = sessionToken(req);
  if (token) await db.delete(adminSessions).where(eq(adminSessions.tokenHash, hashToken(token)));
}

/** Returned unrun, so it can join a `db.batch`; awaiting it runs it on its own. */
export const deleteAllSessions = (staffId: string) => db.delete(adminSessions).where(eq(adminSessions.staffId, staffId));

export const deleteOtherSessions = (staffId: string, keepSessionId: string) =>
  db.delete(adminSessions).where(and(eq(adminSessions.staffId, staffId), ne(adminSessions.id, keepSessionId)));
