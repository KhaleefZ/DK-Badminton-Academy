import { Router } from 'express';
import type { RequestHandler } from 'express';
import { z } from 'zod';
import { attemptLogin } from '../auth/login.js';
import { changeOwnPassword, resetPasswordWithToken, sendPasswordReset } from '../auth/passwords.js';
import { permissionsFor } from '../auth/permissions.js';
import { clearSessionCookie, createSession, deleteAllSessions, deleteSessionByToken, findActiveSession } from '../auth/sessions.js';
import type { Staff } from '../db/schema.js';
import { writeAudit } from '../lib/audit.js';
import type { Mailer } from '../lib/email.js';
import { AppError, invalid } from '../lib/errors.js';
import { currentAuth, requireSession } from '../middleware/auth.js';

export const publicAccount = (account: Staff) => ({
  id: account.id,
  staffNo: account.staffNo,
  name: account.name,
  email: account.email,
  role: account.role,
  mustChangePassword: account.mustChangePassword,
  permissions: permissionsFor(account.role),
});

const loginBody = z.object({
  email: z.string().trim().min(1).max(254),
  // Long enough for any valid password, short enough that hashing can't be abused.
  password: z.string().min(1).max(1024),
  remember: z.boolean().optional().default(false),
});

export const LOGIN_FAILED_MESSAGE = 'Email or password is incorrect, or the account is locked for a few minutes.';

const forgotBody = z.object({ email: z.string().trim().min(1).max(254) });
const resetBody = z.object({ token: z.string().min(1).max(256), newPassword: z.string().max(1024) });
const changeBody = z.object({ currentPassword: z.string().max(1024), newPassword: z.string().max(1024) });

export const RESET_REQUESTED_MESSAGE = 'If that email has an account, a reset link is on its way. It expires in 30 minutes.';

type AuthRouterOptions = { loginLimiter: RequestHandler; resetLimiter: RequestHandler; mailer: Mailer };

export function authRouter({ loginLimiter, resetLimiter, mailer }: AuthRouterOptions): Router {
  const router = Router();

  router.post('/login', loginLimiter, async (req, res) => {
    const parsed = loginBody.safeParse(req.body);
    if (!parsed.success) throw invalid('Enter your email and password.');
    const { email, password, remember } = parsed.data;

    const result = await attemptLogin(email, password);
    if (!result.ok) {
      // Unknown emails aren't logged: people sometimes type a password into the email box.
      if (result.account) {
        const entity = { entityType: 'staff', entityId: result.account.id, req };
        await writeAudit({ action: 'auth.login_failed', newValues: { reason: result.reason }, ...entity });
        if (result.nowLocked) await writeAudit({ action: 'auth.account_locked', ...entity });
      }
      throw new AppError(401, 'LOGIN_FAILED', LOGIN_FAILED_MESSAGE);
    }

    await createSession(result.account.id, remember, req, res);
    await writeAudit({ action: 'auth.login', actorStaffId: result.account.id, entityType: 'staff', entityId: result.account.id, newValues: { remember }, req });
    res.json({ user: publicAccount(result.account) });
  });

  // Signing out always succeeds, even if the session has already ended.
  router.post('/logout', async (req, res) => {
    const session = await findActiveSession(req);
    await deleteSessionByToken(req);
    clearSessionCookie(res);
    if (session) {
      await writeAudit({ action: 'auth.logout', actorStaffId: session.staff.id, entityType: 'staff', entityId: session.staff.id, req });
    }
    res.status(204).end();
  });

  router.post('/logout-all', requireSession, async (req, res) => {
    const { staff } = currentAuth(req);
    await deleteAllSessions(staff.id);
    clearSessionCookie(res);
    await writeAudit({ action: 'auth.logout_all', actorStaffId: staff.id, entityType: 'staff', entityId: staff.id, req });
    res.status(204).end();
  });

  router.get('/me', requireSession, (req, res) => {
    res.json({ user: publicAccount(currentAuth(req).staff) });
  });

  router.post('/forgot-password', resetLimiter, (req, res) => {
    const parsed = forgotBody.safeParse(req.body);
    if (!parsed.success) throw invalid('Enter your email address.');
    // Sent in the background: waiting for it would make known emails answer more slowly.
    sendPasswordReset(parsed.data.email, mailer, req).catch((err: unknown) => {
      console.error('Password reset email failed:', err instanceof Error ? err.message : err);
    });
    res.json({ message: RESET_REQUESTED_MESSAGE });
  });

  router.post('/reset-password', resetLimiter, async (req, res) => {
    const parsed = resetBody.safeParse(req.body);
    if (!parsed.success) throw invalid('Enter a new password.');
    await resetPasswordWithToken(parsed.data.token, parsed.data.newPassword, req);
    clearSessionCookie(res);
    res.status(204).end();
  });

  // Open while a temporary password is in use: this is how it gets replaced.
  router.post('/change-password', requireSession, async (req, res) => {
    const parsed = changeBody.safeParse(req.body);
    if (!parsed.success) throw invalid('Enter your current and new passwords.');
    const { staff, sessionId } = currentAuth(req);
    const updated = await changeOwnPassword(staff, sessionId, parsed.data.currentPassword, parsed.data.newPassword, req);
    res.json({ user: publicAccount(updated) });
  });

  return router;
}
