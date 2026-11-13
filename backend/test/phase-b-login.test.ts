import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/auth/crypto.js';
import { AUTH_POLICY } from '../src/auth/policy.js';
import { SESSION_COOKIE } from '../src/auth/sessions.js';
import { db } from '../src/db/client.js';
import { adminSessions, auditLog, staff } from '../src/db/schema.js';
import { LOGIN_FAILED_MESSAGE } from '../src/routes/auth.js';
import { addStaff, PASSWORD } from './helpers.js';

const ORIGIN = 'http://localhost:5174';
const app = createApp({ loginLimitPerWindow: 10_000 });

const login = (email: string, password: string, extra: object = {}) =>
  request(app).post('/auth/login').set('Origin', ORIGIN).send({ email, password, ...extra });

const cookieHeader = (res: request.Response) => (res.get('Set-Cookie') ?? []).find((c) => c.startsWith(`${SESSION_COOKIE}=`)) ?? '';
const tokenFrom = (res: request.Response) => cookieHeader(res).split(';')[0]!.split('=')[1]!;
const failLogin = (email: string, times: number) => Promise.all(Array.from({ length: times }, () => login(email, 'wrong-password-here')));

describe('signing in', () => {
  it('signs in with the correct password, ignoring email capitals', async () => {
    const account = await addStaff({ role: 'owner', email: 'owner@example.com' });
    const res = await login(' OWNER@example.com ', PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: account.id, role: 'owner', mustChangePassword: false });
    expect(res.body.user.permissions).toContain('staff.manage');
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('sets a cookie scripts can’t read, and stores only a hash of the token', async () => {
    await addStaff({ role: 'owner', email: 'owner@example.com' });
    const res = await login('owner@example.com', PASSWORD);
    expect(cookieHeader(res)).toMatch(/HttpOnly/i);
    expect(cookieHeader(res)).toMatch(/SameSite=Lax/i);

    const [row] = await db.select().from(adminSessions);
    expect(row!.tokenHash).toBe(hashToken(tokenFrom(res)));
    expect(row!.tokenHash).not.toBe(tokenFrom(res));
  });

  it('gives the same answer for a wrong password, an unknown email, an inactive and a locked account', async () => {
    await addStaff({ role: 'owner', email: 'owner@example.com' });
    await addStaff({ email: 'inactive@example.com', status: 'inactive' });
    await addStaff({ email: 'locked@example.com', lockedUntil: new Date(Date.now() + 60_000) });

    const answers = await Promise.all([
      login('owner@example.com', 'wrong-password-here'),
      login('nobody@example.com', PASSWORD),
      login('inactive@example.com', PASSWORD),
      login('locked@example.com', PASSWORD),
    ]);
    for (const res of answers) {
      expect(res.status).toBe(401);
      expect(res.body.error).toEqual({ code: 'LOGIN_FAILED', message: LOGIN_FAILED_MESSAGE });
      expect(cookieHeader(res)).toBe('');
    }
  });

  it('refuses a deleted account', async () => {
    await addStaff({ role: 'owner' });
    await addStaff({ email: 'gone@example.com', deletedAt: new Date() });
    expect((await login('gone@example.com', PASSWORD)).status).toBe(401);
  });

  it('rejects a missing or malformed login without a server error', async () => {
    const res = await request(app).post('/auth/login').set('Origin', ORIGIN).send({ email: 'a@example.com' });
    expect(res.status).toBe(400);
    const broken = await request(app).post('/auth/login').set('Origin', ORIGIN).set('Content-Type', 'application/json').send('{not json');
    expect(broken.status).toBe(400);
  });
});

describe('session length', () => {
  const hoursUntilExpiry = async () => {
    const [row] = await db.select().from(adminSessions);
    return (row!.expiresAt.getTime() - Date.now()) / 3_600_000;
  };

  it('lasts 12 hours with a browser-session cookie by default', async () => {
    await addStaff({ role: 'owner', email: 'owner@example.com' });
    const res = await login('owner@example.com', PASSWORD);
    expect(await hoursUntilExpiry()).toBeCloseTo(12, 1);
    expect(cookieHeader(res)).not.toMatch(/Max-Age|Expires/i);
  });

  it('lasts 30 days with "keep me signed in"', async () => {
    await addStaff({ role: 'owner', email: 'owner@example.com' });
    const res = await login('owner@example.com', PASSWORD, { remember: true });
    expect(await hoursUntilExpiry()).toBeCloseTo(30 * 24, 1);
    expect(cookieHeader(res)).toMatch(/Max-Age=2592000/);
  });
});

describe('locking after failed attempts', () => {
  const stateOf = async (id: string) => (await db.select().from(staff).where(eq(staff.id, id)))[0]!;

  it('uses the agreed policy of 10 failures and 5 minutes', () => {
    expect(AUTH_POLICY.maxFailedAttempts).toBe(10);
    expect(AUTH_POLICY.lockMinutes).toBe(5);
  });

  it('does not lock after 9 failures, and a correct login clears the count', async () => {
    const account = await addStaff({ role: 'owner', email: 'owner@example.com' });
    await failLogin('owner@example.com', 9);
    expect(await stateOf(account.id)).toMatchObject({ failedLoginAttempts: 9, lockedUntil: null });
    expect((await login('owner@example.com', PASSWORD)).status).toBe(200);
    expect((await stateOf(account.id)).failedLoginAttempts).toBe(0);
  });

  it('locks for 5 minutes on the 10th failure and refuses even the correct password', async () => {
    const account = await addStaff({ role: 'owner', email: 'owner@example.com' });
    await failLogin('owner@example.com', 10);

    const { lockedUntil, failedLoginAttempts } = await stateOf(account.id);
    expect(failedLoginAttempts).toBe(10);
    expect((lockedUntil!.getTime() - Date.now()) / 60_000).toBeCloseTo(5, 0);
    expect((await login('owner@example.com', PASSWORD)).status).toBe(401);
  });

  it('counts failures sent at the same moment correctly', async () => {
    const account = await addStaff({ role: 'owner', email: 'owner@example.com' });
    await failLogin('owner@example.com', 6);
    expect((await stateOf(account.id)).failedLoginAttempts).toBe(6);
  });

  it('opens again once the 5 minutes have passed, and a new failure starts a new count', async () => {
    const account = await addStaff({ role: 'owner', email: 'owner@example.com' });
    await db.update(staff).set({ failedLoginAttempts: 10, lockedUntil: new Date(Date.now() - 1000) }).where(eq(staff.id, account.id));
    await login('owner@example.com', 'wrong-password-here');
    expect(await stateOf(account.id)).toMatchObject({ failedLoginAttempts: 1, lockedUntil: null });

    await db.update(staff).set({ failedLoginAttempts: 10, lockedUntil: new Date(Date.now() - 1000) }).where(eq(staff.id, account.id));
    expect((await login('owner@example.com', PASSWORD)).status).toBe(200);
  });

  it('limits attempts from one network, whichever emails are tried', async () => {
    const limited = createApp({ loginLimitPerWindow: 3 });
    const attempt = () => request(limited).post('/auth/login').set('Origin', ORIGIN).send({ email: `x${Math.random()}@example.com`, password: 'x' });
    for (let i = 0; i < 3; i += 1) expect((await attempt()).status).toBe(401);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('TOO_MANY_REQUESTS');
  });
});

describe('login records', () => {
  it('records successes and failures without any password', async () => {
    const account = await addStaff({ role: 'owner', email: 'owner@example.com' });
    await login('owner@example.com', 'wrong-password-here');
    await login('owner@example.com', PASSWORD);

    const rows = await db.select().from(auditLog).where(eq(auditLog.entityId, account.id));
    expect(rows.map((r) => r.action).sort()).toEqual(['auth.login', 'auth.login_failed']);
    const stored = JSON.stringify(rows);
    expect(stored).not.toContain('wrong-password-here');
    expect(stored).not.toContain(PASSWORD);
  });

  it('records the lock, and keeps nothing typed for an unknown email', async () => {
    await addStaff({ role: 'owner', email: 'owner@example.com' });
    await failLogin('owner@example.com', 10);
    expect(await db.$count(auditLog, eq(auditLog.action, 'auth.account_locked'))).toBe(1);

    await db.delete(auditLog);
    await login('typed-my-password@example.com', PASSWORD);
    expect(await db.$count(auditLog)).toBe(0);
  });
});

describe('requests from other websites', () => {
  it('blocks a login from another origin or with no origin', async () => {
    await addStaff({ role: 'owner', email: 'owner@example.com' });
    const body = { email: 'owner@example.com', password: PASSWORD };
    const other = await request(app).post('/auth/login').set('Origin', 'https://evil.example').send(body);
    expect(other.status).toBe(403);
    expect(other.body.error.code).toBe('UNTRUSTED_ORIGIN');
    expect((await request(app).post('/auth/login').send(body)).status).toBe(403);
  });

  it('allows the admin panel’s origin to read responses with cookies', async () => {
    const res = await request(app).options('/auth/login').set('Origin', ORIGIN).set('Access-Control-Request-Method', 'POST');
    expect(res.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(res.get('Access-Control-Allow-Credentials')).toBe('true');
  });
});
