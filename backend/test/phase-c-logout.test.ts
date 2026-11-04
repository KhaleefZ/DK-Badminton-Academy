import { eq } from 'drizzle-orm';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { SESSION_COOKIE } from '../src/auth/sessions.js';
import { db } from '../src/db/client.js';
import { adminSessions, auditLog, staff } from '../src/db/schema.js';
import { addStaff, PASSWORD } from './helpers.js';

const ORIGIN = 'http://localhost:5174';
const app = createApp({ loginLimitPerWindow: 10_000 });

/** Signs in and returns the Cookie header value, as a separate device would hold it. */
async function signIn(email: string) {
  const res = await request(app).post('/auth/login').set('Origin', ORIGIN).send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  const cookie = (res.get('Set-Cookie') ?? []).find((c) => c.startsWith(`${SESSION_COOKIE}=`))!;
  return cookie.split(';')[0]!;
}

const me = (cookie?: string) => {
  const req = request(app).get('/auth/me');
  return cookie ? req.set('Cookie', cookie) : req;
};
const post = (path: string, cookie?: string) => {
  const req = request(app).post(path).set('Origin', ORIGIN);
  return cookie ? req.set('Cookie', cookie) : req;
};

describe('checking the session', () => {
  it('returns the signed-in user, and is never cached', async () => {
    const account = await addStaff({ role: 'owner', email: 'owner@example.com' });
    const res = await me(await signIn('owner@example.com'));
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(account.id);
    expect(res.get('Cache-Control')).toBe('no-store');
  });

  it('refuses a missing or made-up session', async () => {
    expect((await me()).status).toBe(401);
    const made = await me(`${SESSION_COOKIE}=made-up-token`);
    expect(made.status).toBe(401);
    expect(made.body.error.code).toBe('NOT_SIGNED_IN');
    expect(made.get('Cache-Control')).toBe('no-store');
  });

  it('refuses the stored hash used as if it were the token', async () => {
    await addStaff({ role: 'owner', email: 'owner@example.com' });
    await signIn('owner@example.com');
    const [row] = await db.select().from(adminSessions);
    expect((await me(`${SESSION_COOKIE}=${row!.tokenHash}`)).status).toBe(401);
  });

  it('refuses an expired session and clears its cookie', async () => {
    await addStaff({ role: 'owner', email: 'owner@example.com' });
    const cookie = await signIn('owner@example.com');
    await db.update(adminSessions).set({ expiresAt: new Date(Date.now() - 1000) });
    const res = await me(cookie);
    expect(res.status).toBe(401);
    expect(res.get('Set-Cookie')?.join()).toMatch(new RegExp(`${SESSION_COOKIE}=;`));
  });

  it('removes expired sessions from the table at the next login', async () => {
    await addStaff({ role: 'owner', email: 'owner@example.com' });
    await signIn('owner@example.com');
    await db.update(adminSessions).set({ expiresAt: new Date(Date.now() - 1000) });
    await signIn('owner@example.com');
    expect(await db.$count(adminSessions)).toBe(1);
  });

  it('ends a session the moment its account is deactivated', async () => {
    await addStaff({ role: 'owner' });
    const account = await addStaff({ email: 'desk@example.com' });
    const cookie = await signIn('desk@example.com');
    await db.update(staff).set({ status: 'inactive' }).where(eq(staff.id, account.id));
    expect((await me(cookie)).status).toBe(401);
  });

  it('shows a role change on the very next request', async () => {
    await addStaff({ role: 'owner' });
    const account = await addStaff({ email: 'desk@example.com', role: 'front_desk' });
    const cookie = await signIn('desk@example.com');
    expect((await me(cookie)).body.user.permissions).not.toContain('reports.view');
    await db.update(staff).set({ role: 'manager' }).where(eq(staff.id, account.id));
    expect((await me(cookie)).body.user.permissions).toContain('reports.view');
  });
});

describe('signing out', () => {
  it('deletes the session on the server, so the old cookie can’t be reused', async () => {
    await addStaff({ role: 'owner', email: 'owner@example.com' });
    const cookie = await signIn('owner@example.com');

    const res = await post('/auth/logout', cookie);
    expect(res.status).toBe(204);
    expect(res.get('Set-Cookie')?.join()).toMatch(new RegExp(`${SESSION_COOKIE}=;`));
    expect(await db.$count(adminSessions)).toBe(0);
    expect((await me(cookie)).status).toBe(401);
  });

  it('ends only this device’s session', async () => {
    await addStaff({ role: 'owner', email: 'owner@example.com' });
    const phone = await signIn('owner@example.com');
    const laptop = await signIn('owner@example.com');
    await post('/auth/logout', laptop);
    expect((await me(laptop)).status).toBe(401);
    expect((await me(phone)).status).toBe(200);
  });

  it('still succeeds when already signed out', async () => {
    expect((await post('/auth/logout')).status).toBe(204);
    expect((await post('/auth/logout', `${SESSION_COOKIE}=old`)).status).toBe(204);
  });

  it('is blocked from another website, so nobody can be signed out by a trick link', async () => {
    await addStaff({ role: 'owner', email: 'owner@example.com' });
    const cookie = await signIn('owner@example.com');
    const res = await request(app).post('/auth/logout').set('Origin', 'https://evil.example').set('Cookie', cookie);
    expect(res.status).toBe(403);
    expect((await me(cookie)).status).toBe(200);
  });

  it('records the sign-out', async () => {
    const account = await addStaff({ role: 'owner', email: 'owner@example.com' });
    await post('/auth/logout', await signIn('owner@example.com'));
    expect(await db.$count(auditLog, eq(auditLog.action, 'auth.logout'))).toBe(1);
    const [row] = await db.select().from(auditLog).where(eq(auditLog.action, 'auth.logout'));
    expect(row!.actorStaffId).toBe(account.id);
  });
});

describe('signing out everywhere', () => {
  it('ends every device for this account and no other account', async () => {
    await addStaff({ role: 'owner', email: 'owner@example.com' });
    await addStaff({ email: 'desk@example.com' });
    const phone = await signIn('owner@example.com');
    const laptop = await signIn('owner@example.com');
    const desk = await signIn('desk@example.com');

    expect((await post('/auth/logout-all', laptop)).status).toBe(204);
    expect((await me(phone)).status).toBe(401);
    expect((await me(laptop)).status).toBe(401);
    expect((await me(desk)).status).toBe(200);
  });

  it('needs a signed-in session', async () => {
    expect((await post('/auth/logout-all')).status).toBe(401);
  });
});

describe('the API in general', () => {
  it('answers unknown paths and health checks', async () => {
    expect((await request(app).get('/nope')).status).toBe(404);
    expect((await request(app).get('/health')).body).toEqual({ status: 'ok' });
  });

  it('does not reveal the server software', async () => {
    const res = await request(app).get('/health');
    expect(res.get('X-Powered-By')).toBeUndefined();
  });
});
