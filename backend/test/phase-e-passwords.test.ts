import { eq } from 'drizzle-orm';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { hashToken, verifyPassword } from '../src/auth/crypto.js';
import { db } from '../src/db/client.js';
import { adminSessions, auditLog, passwordResetTokens, staff } from '../src/db/schema.js';
import { RESET_REQUESTED_MESSAGE } from '../src/routes/auth.js';
import { addStaff, ORIGIN, PASSWORD, signIn, testApp } from './helpers.js';

const NEW_PASSWORD = 'brand-new-shuttle-2031';

let app: ReturnType<typeof createApp>;
let sent: ReturnType<typeof testApp>['sent'];

beforeEach(() => {
  ({ app, sent } = testApp());
});

const post = (path: string, body: object, cookie?: string) => {
  const req = request(app).post(path).set('Origin', ORIGIN);
  if (cookie) void req.set('Cookie', cookie);
  return req.send(body);
};
const forgot = (email: string) => post('/auth/forgot-password', { email });
const linkToken = () => /token=([\w-]+)/.exec(sent.at(-1)!.text)![1]!;
const emailArrives = (count = 1) => vi.waitFor(() => expect(sent).toHaveLength(count));
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));
const stateOf = async (id: string) => (await db.select().from(staff).where(eq(staff.id, id)))[0]!;

describe('forgot password', () => {
  it('emails a working link to a real account and stores only its hash', async () => {
    const account = await addStaff({ role: 'owner', email: 'owner@example.com' });
    const res = await forgot('OWNER@example.com');
    expect(res.body).toEqual({ message: RESET_REQUESTED_MESSAGE });
    await emailArrives();

    expect(sent[0]!.to).toBe('owner@example.com');
    expect(sent[0]!.text).toContain(`${ORIGIN}/reset-password?token=`);
    const [row] = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.staffId, account.id));
    expect(row!.tokenHash).toBe(hashToken(linkToken()));
    expect((row!.expiresAt.getTime() - Date.now()) / 60_000).toBeCloseTo(30, 0);
  });

  it('answers the same for unknown, inactive and deleted accounts, and sends nothing', async () => {
    await addStaff({ role: 'owner', email: 'owner@example.com' });
    await addStaff({ email: 'inactive@example.com', status: 'inactive' });
    await addStaff({ email: 'gone@example.com', deletedAt: new Date() });
    for (const email of ['nobody@example.com', 'inactive@example.com', 'gone@example.com']) {
      const res = await forgot(email);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: RESET_REQUESTED_MESSAGE });
    }
    await settle();
    expect(sent).toHaveLength(0);
  });

  it('does not send a second email within a minute', async () => {
    await addStaff({ role: 'owner', email: 'owner@example.com' });
    await forgot('owner@example.com');
    await emailArrives();
    await forgot('owner@example.com');
    await settle();
    expect(sent).toHaveLength(1);
  });

  it('replaces an older link with the newest one', async () => {
    const account = await addStaff({ role: 'owner', email: 'owner@example.com' });
    await forgot('owner@example.com');
    await emailArrives();
    const oldToken = linkToken();
    await db.update(passwordResetTokens).set({ createdAt: new Date(Date.now() - 120_000) }).where(eq(passwordResetTokens.staffId, account.id));
    await forgot('owner@example.com');
    await emailArrives(2);

    expect((await post('/auth/reset-password', { token: oldToken, newPassword: NEW_PASSWORD })).status).toBe(400);
    expect((await post('/auth/reset-password', { token: linkToken(), newPassword: NEW_PASSWORD })).status).toBe(204);
  });

  it('still answers normally when the email can’t be sent', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    await addStaff({ role: 'owner', email: 'owner@example.com' });
    const failing = createApp({ resetLimitPerWindow: 100, mailer: { send: () => Promise.reject(new Error('smtp down')) } });
    const res = await request(failing).post('/auth/forgot-password').set('Origin', ORIGIN).send({ email: 'owner@example.com' });
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(quiet).toHaveBeenCalled());
    quiet.mockRestore();
  });

  it('limits requests from one network', async () => {
    const limited = createApp({ resetLimitPerWindow: 2, mailer: { send: async () => {} } });
    const ask = () => request(limited).post('/auth/forgot-password').set('Origin', ORIGIN).send({ email: 'a@example.com' });
    await ask();
    await ask();
    expect((await ask()).status).toBe(429);
  });
});

describe('reset password', () => {
  async function resetLink(email = 'owner@example.com') {
    await forgot(email);
    await emailArrives();
    return linkToken();
  }

  it('sets the new password, ends every session and clears any lock', async () => {
    const account = await addStaff({ role: 'owner', email: 'owner@example.com' });
    const cookie = await signIn(app, 'owner@example.com');
    const token = await resetLink();
    await db.update(staff).set({ failedLoginAttempts: 10, lockedUntil: new Date(Date.now() + 60_000) }).where(eq(staff.id, account.id));

    expect((await post('/auth/reset-password', { token, newPassword: NEW_PASSWORD })).status).toBe(204);

    const after = await stateOf(account.id);
    expect(await verifyPassword(after.passwordHash, NEW_PASSWORD)).toBe(true);
    expect(after).toMatchObject({ failedLoginAttempts: 0, lockedUntil: null });
    expect((await request(app).get('/auth/me').set('Cookie', cookie)).status).toBe(401);
    await signIn(app, 'owner@example.com', NEW_PASSWORD);
    await expect(signIn(app, 'owner@example.com', PASSWORD)).rejects.toThrow();
  });

  it('refuses a used link', async () => {
    await addStaff({ role: 'owner', email: 'owner@example.com' });
    const token = await resetLink();
    await post('/auth/reset-password', { token, newPassword: NEW_PASSWORD });
    const again = await post('/auth/reset-password', { token, newPassword: 'another-good-password' });
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('INVALID_RESET_LINK');
  });

  it('lets only one of two simultaneous requests use a link', async () => {
    await addStaff({ role: 'owner', email: 'owner@example.com' });
    const token = await resetLink();
    const results = await Promise.all([
      post('/auth/reset-password', { token, newPassword: NEW_PASSWORD }),
      post('/auth/reset-password', { token, newPassword: 'another-good-password' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([204, 400]);
  });

  it('refuses an expired or made-up link', async () => {
    const account = await addStaff({ role: 'owner', email: 'owner@example.com' });
    const token = await resetLink();
    await db.update(passwordResetTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(passwordResetTokens.staffId, account.id));
    expect((await post('/auth/reset-password', { token, newPassword: NEW_PASSWORD })).status).toBe(400);
    expect((await post('/auth/reset-password', { token: 'made-up', newPassword: NEW_PASSWORD })).status).toBe(400);
  });

  it('refuses a link once the account is deactivated', async () => {
    await addStaff({ role: 'owner' });
    const account = await addStaff({ email: 'desk@example.com' });
    const token = await resetLink('desk@example.com');
    await db.update(staff).set({ status: 'inactive' }).where(eq(staff.id, account.id));
    expect((await post('/auth/reset-password', { token, newPassword: NEW_PASSWORD })).status).toBe(400);
  });

  it('rejects a weak password but leaves the link usable', async () => {
    await addStaff({ role: 'owner', email: 'owner@example.com' });
    const token = await resetLink();
    const weak = await post('/auth/reset-password', { token, newPassword: 'password123' });
    expect(weak.status).toBe(400);
    expect(weak.body.error.code).toBe('WEAK_PASSWORD');
    expect((await post('/auth/reset-password', { token, newPassword: NEW_PASSWORD })).status).toBe(204);
  });
});

describe('change password', () => {
  const change = (cookie: string, currentPassword: string, newPassword: string) => post('/auth/change-password', { currentPassword, newPassword }, cookie);

  it('needs the current password', async () => {
    await addStaff({ role: 'owner', email: 'owner@example.com' });
    const cookie = await signIn(app, 'owner@example.com');
    const res = await change(cookie, 'wrong-password-here', NEW_PASSWORD);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('WRONG_PASSWORD');
  });

  it('needs a signed-in session', async () => {
    expect((await post('/auth/change-password', { currentPassword: PASSWORD, newPassword: NEW_PASSWORD })).status).toBe(401);
  });

  it('keeps this device signed in and signs out the others', async () => {
    await addStaff({ role: 'owner', email: 'owner@example.com' });
    const laptop = await signIn(app, 'owner@example.com');
    const phone = await signIn(app, 'owner@example.com');
    expect((await change(laptop, PASSWORD, NEW_PASSWORD)).status).toBe(200);
    expect((await request(app).get('/auth/me').set('Cookie', laptop)).status).toBe(200);
    expect((await request(app).get('/auth/me').set('Cookie', phone)).status).toBe(401);
    expect(await db.$count(adminSessions)).toBe(1);
  });

  it('refuses weak passwords and the same password again', async () => {
    await addStaff({ role: 'owner', email: 'owner@example.com' });
    const cookie = await signIn(app, 'owner@example.com');
    expect((await change(cookie, PASSWORD, 'short')).body.error.code).toBe('WEAK_PASSWORD');
    expect((await change(cookie, PASSWORD, 'password123')).body.error.code).toBe('WEAK_PASSWORD');
    expect((await change(cookie, PASSWORD, 'owner-picks-this-one')).body.error.code).toBe('WEAK_PASSWORD');
    expect((await change(cookie, PASSWORD, PASSWORD)).body.error.code).toBe('WEAK_PASSWORD');
  });

  it('counts wrong guesses towards the lock, so a stolen session can’t keep guessing', async () => {
    const account = await addStaff({ role: 'owner', email: 'owner@example.com' });
    const cookie = await signIn(app, 'owner@example.com');
    for (let i = 0; i < 10; i += 1) await change(cookie, 'wrong-password-here', NEW_PASSWORD);
    expect((await stateOf(account.id)).lockedUntil).not.toBeNull();
    expect((await change(cookie, PASSWORD, NEW_PASSWORD)).status).toBe(429);
  });

  it('never records a password in the history', async () => {
    await addStaff({ role: 'owner', email: 'owner@example.com' });
    const cookie = await signIn(app, 'owner@example.com');
    await change(cookie, PASSWORD, NEW_PASSWORD);
    const stored = JSON.stringify(await db.select().from(auditLog));
    expect(stored).toContain('auth.password_changed');
    expect(stored).not.toContain(PASSWORD);
    expect(stored).not.toContain(NEW_PASSWORD);
  });
});
