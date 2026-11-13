import type { Request } from 'express';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { passwordResetTokens, staff, type Staff } from '../db/schema.js';
import { auditEntry } from '../lib/audit.js';
import type { Mailer } from '../lib/email.js';
import { AppError, invalid } from '../lib/errors.js';
import { generateToken, hashPassword, hashToken, verifyPassword } from './crypto.js';
import { findStaffByEmail, isLocked, recordFailedAttempt } from './login.js';
import { AUTH_POLICY, passwordProblem } from './policy.js';
import { deleteAllSessions, deleteOtherSessions } from './sessions.js';

const RESEND_AFTER_MS = 60_000;

export function assertAcceptablePassword(password: string, email: string): void {
  const problem = passwordProblem(password, email);
  if (problem) throw invalid(problem, 'WEAK_PASSWORD');
}

/**
 * Asks a signed-in person for their password again before a sensitive action. Wrong answers count
 * towards the same lock as login, so a stolen session can't be used to guess the password.
 */
export async function confirmPassword(account: Staff, password: unknown, req: Request): Promise<void> {
  if (isLocked(account)) throw new AppError(429, 'ACCOUNT_LOCKED', `Too many wrong passwords. Try again in ${AUTH_POLICY.lockMinutes} minutes.`);
  if (typeof password !== 'string' || !password) throw invalid('Enter your password to confirm.', 'PASSWORD_REQUIRED');
  if (!(await verifyPassword(account.passwordHash, password))) {
    await recordFailedAttempt(account.id);
    await auditEntry({ action: 'auth.confirm_failed', actorStaffId: account.id, entityType: 'staff', entityId: account.id, req });
    throw invalid('Your password is incorrect.', 'WRONG_PASSWORD');
  }
}

export async function changeOwnPassword(account: Staff, sessionId: string, currentPassword: unknown, newPassword: string, req: Request): Promise<Staff> {
  await confirmPassword(account, currentPassword, req);
  assertAcceptablePassword(newPassword, account.email);
  if (newPassword === currentPassword) throw invalid('Choose a password different from your current one.', 'WEAK_PASSWORD');

  const passwordHash = await hashPassword(newPassword);
  const [[updated]] = await db.batch([
    db
      .update(staff)
      .set({ passwordHash, mustChangePassword: false, failedLoginAttempts: 0, lockedUntil: null, passwordChangedAt: new Date(), updatedAt: new Date() })
      .where(eq(staff.id, account.id))
      .returning(),
    // Anyone else using this account is signed out; this device carries on.
    deleteOtherSessions(account.id, sessionId),
    auditEntry({ action: 'auth.password_changed', actorStaffId: account.id, entityType: 'staff', entityId: account.id, req }),
  ]);
  return updated!;
}

/** Does nothing visible for an unknown account: the caller's answer must not reveal who exists. */
export async function sendPasswordReset(email: string, mailer: Mailer, req: Request): Promise<void> {
  const account = await findStaffByEmail(email);
  if (!account || account.status !== 'active') return;

  const [recent] = await db
    .select({ id: passwordResetTokens.id })
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.staffId, account.id),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.createdAt, new Date(Date.now() - RESEND_AFTER_MS)),
      ),
    )
    .limit(1);
  if (recent) return;

  const token = generateToken();
  await db.batch([
    // Only the newest link works.
    db.delete(passwordResetTokens).where(eq(passwordResetTokens.staffId, account.id)),
    db.insert(passwordResetTokens).values({
      staffId: account.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + AUTH_POLICY.resetLinkMinutes * 60_000),
    }),
    auditEntry({ action: 'auth.reset_requested', entityType: 'staff', entityId: account.id, req }),
  ]);

  await mailer.send({
    to: account.email,
    subject: 'Reset your DK Operations password',
    text: [
      `Hello ${account.name},`,
      '',
      `Use this link to choose a new password. It works once and expires in ${AUTH_POLICY.resetLinkMinutes} minutes:`,
      '',
      `${config.ADMIN_ORIGIN}/reset-password?token=${token}`,
      '',
      'If you didn’t ask for this, ignore this email. Your password won’t change.',
    ].join('\n'),
  });
}

const INVALID_LINK = 'This reset link is invalid or has expired. Request a new one.';

export async function resetPasswordWithToken(token: string, newPassword: string, req: Request): Promise<void> {
  const tokenHash = hashToken(token);
  const [row] = await db
    .select({ account: staff })
    .from(passwordResetTokens)
    .innerJoin(staff, eq(staff.id, passwordResetTokens.staffId))
    .where(and(eq(passwordResetTokens.tokenHash, tokenHash), isNull(passwordResetTokens.usedAt), gt(passwordResetTokens.expiresAt, new Date())));
  if (!row || row.account.status !== 'active' || row.account.deletedAt) throw invalid(INVALID_LINK, 'INVALID_RESET_LINK');

  const { account } = row;
  // A rejected password leaves the link usable, so the person can simply try another.
  assertAcceptablePassword(newPassword, account.email);
  const passwordHash = await hashPassword(newPassword);

  // Marking it used in one statement means two requests with the same link can't both succeed.
  const used = await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(passwordResetTokens.tokenHash, tokenHash), isNull(passwordResetTokens.usedAt)))
    .returning({ id: passwordResetTokens.id });
  if (!used.length) throw invalid(INVALID_LINK, 'INVALID_RESET_LINK');

  await db.batch([
    db
      .update(staff)
      .set({ passwordHash, mustChangePassword: false, failedLoginAttempts: 0, lockedUntil: null, passwordChangedAt: new Date(), updatedAt: new Date() })
      .where(eq(staff.id, account.id)),
    deleteAllSessions(account.id),
    auditEntry({ action: 'auth.password_reset', actorStaffId: account.id, entityType: 'staff', entityId: account.id, req }),
  ]);
}
