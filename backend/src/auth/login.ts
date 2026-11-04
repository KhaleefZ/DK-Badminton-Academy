import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { staff, type Staff } from '../db/schema.js';
import { verifyDecoy, verifyPassword } from './crypto.js';
import { AUTH_POLICY } from './policy.js';

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export async function findStaffByEmail(email: string): Promise<Staff | undefined> {
  const [row] = await db
    .select()
    .from(staff)
    .where(and(eq(sql`lower(${staff.email})`, normalizeEmail(email)), isNull(staff.deletedAt)));
  return row;
}

export const isLocked = (account: Pick<Staff, 'lockedUntil'>) => Boolean(account.lockedUntil && account.lockedUntil > new Date());

/** One failure, counted in a single statement so simultaneous attempts can't undercount. */
export async function recordFailedAttempt(staffId: string): Promise<{ locked: boolean }> {
  const { maxFailedAttempts, lockMinutes } = AUTH_POLICY;
  // A lock that has already ended starts a fresh count.
  const count = sql`CASE WHEN ${staff.lockedUntil} IS NOT NULL AND ${staff.lockedUntil} <= now() THEN 1 ELSE ${staff.failedLoginAttempts} + 1 END`;
  const [row] = await db
    .update(staff)
    .set({
      failedLoginAttempts: sql`${count}`,
      lockedUntil: sql`CASE WHEN ${count} >= ${maxFailedAttempts} THEN now() + make_interval(mins => ${lockMinutes}) ELSE NULL END`,
    })
    .where(eq(staff.id, staffId))
    .returning({ lockedUntil: staff.lockedUntil });
  return { locked: Boolean(row?.lockedUntil) };
}

export type LoginResult =
  | { ok: true; account: Staff }
  // Why it failed stays on the server. The person signing in only ever sees one message.
  | { ok: false; reason: 'unknown_email' | 'unavailable' | 'locked' | 'wrong_password'; account?: Staff; nowLocked?: boolean };

export async function attemptLogin(email: string, password: string): Promise<LoginResult> {
  const account = await findStaffByEmail(email);
  if (!account) {
    await verifyDecoy(password);
    return { ok: false, reason: 'unknown_email' };
  }
  // These two still spend the hashing time, so the response speed reveals nothing.
  if (account.status !== 'active') {
    await verifyDecoy(password);
    return { ok: false, reason: 'unavailable', account };
  }
  if (isLocked(account)) {
    await verifyDecoy(password);
    return { ok: false, reason: 'locked', account };
  }
  if (!(await verifyPassword(account.passwordHash, password))) {
    const { locked } = await recordFailedAttempt(account.id);
    return { ok: false, reason: 'wrong_password', account, nowLocked: locked };
  }
  await db.update(staff).set({ failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(staff.id, account.id));
  return { ok: true, account };
}
