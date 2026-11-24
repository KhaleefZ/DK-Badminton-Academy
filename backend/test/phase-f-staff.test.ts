import { eq } from 'drizzle-orm';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { can, permissionsFor } from '../src/auth/permissions.js';
import { db } from '../src/db/client.js';
import { auditLog, staff } from '../src/db/schema.js';
import { addStaff, ORIGIN, PASSWORD, signIn, testApp } from './helpers.js';

let app: ReturnType<typeof createApp>;
let owner: Awaited<ReturnType<typeof addStaff>>;
let cookie: string;

beforeEach(async () => {
  ({ app } = testApp());
  owner = await addStaff({ role: 'owner', name: 'Owner', email: 'owner@example.com' });
  cookie = await signIn(app, 'owner@example.com');
});

const NEW_STAFF = { name: 'New Person', email: 'New@Example.com', phone: '9876543210', role: 'front_desk' };

const call = (method: 'post' | 'patch' | 'delete', path: string, body: object = {}, session = cookie) =>
  request(app)[method](path).set('Origin', ORIGIN).set('Cookie', session).send({ currentPassword: PASSWORD, ...body });
const stateOf = async (id: string) => (await db.select().from(staff).where(eq(staff.id, id)))[0]!;

describe('permissions table', () => {
  it('matches the agreed roles', () => {
    // 14 since referrals were removed (24 Nov 2026): no role has referrals.view or referrals.manage.
    expect(permissionsFor('owner')).toHaveLength(14);
    expect(permissionsFor('owner').some((p) => p.startsWith('referrals.'))).toBe(false);
    expect(can('manager', 'memberships.manage')).toBe(true);
    expect(can('front_desk', 'payments.record')).toBe(true);
    expect(can('front_desk', 'payments.void')).toBe(false);
    expect(can('manager', 'payments.void')).toBe(true);
    expect(can('manager', 'payments.view')).toBe(true);
    expect(can('manager', 'refunds.manage')).toBe(false);
    expect(can('manager', 'settings.manage')).toBe(false);
    expect(can('manager', 'staff.manage')).toBe(false);
    expect(can('front_desk', 'bookings.manage')).toBe(true);
    expect(can('front_desk', 'memberships.view')).toBe(true);
    expect(can('front_desk', 'memberships.manage')).toBe(false);
    expect(can('front_desk', 'payments.view')).toBe(false);
    expect(can('front_desk', 'reports.view')).toBe(false);
    expect(can('front_desk', 'refunds.manage')).toBe(false);
  });
});

describe('who can use the staff API', () => {
  const routes = (id: string) =>
    [
      ['get', '/staff'],
      ['post', '/staff'],
      ['patch', `/staff/${id}`],
      ['post', `/staff/${id}/deactivate`],
      ['post', `/staff/${id}/reactivate`],
      ['post', `/staff/${id}/reset-password`],
      ['post', `/staff/${id}/restore`],
      ['delete', `/staff/${id}`],
      ['get', `/staff/${id}/history`],
    ] as const;

  it.each(['manager', 'front_desk'] as const)('refuses a %s on every route, by direct API call', async (role) => {
    await addStaff({ role, email: 'other@example.com' });
    const session = await signIn(app, 'other@example.com');
    for (const [method, path] of routes(owner.id)) {
      const res = await request(app)[method](path).set('Origin', ORIGIN).set('Cookie', session).send({ currentPassword: PASSWORD });
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });

  it('refuses without a session', async () => {
    for (const [method, path] of routes(owner.id)) {
      expect((await request(app)[method](path).set('Origin', ORIGIN)).status).toBe(401);
    }
  });

  it('blocks a temporary password from doing anything but changing it', async () => {
    const { body } = await call('post', '/staff', NEW_STAFF);
    const session = await signIn(app, 'new@example.com', body.temporaryPassword);

    const me = await request(app).get('/auth/me').set('Cookie', session);
    expect(me.body.user.mustChangePassword).toBe(true);
    const blocked = await request(app).get('/staff').set('Cookie', session);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const changed = await request(app)
      .post('/auth/change-password')
      .set('Origin', ORIGIN)
      .set('Cookie', session)
      .send({ currentPassword: body.temporaryPassword, newPassword: 'fresh-shuttle-password' });
    expect(changed.status).toBe(200);
    expect(changed.body.user.mustChangePassword).toBe(false);
  });
});

describe('confirming the password for sensitive actions', () => {
  it('refuses a missing or wrong password, and changes nothing', async () => {
    const res = await request(app).post('/staff').set('Origin', ORIGIN).set('Cookie', cookie).send(NEW_STAFF);
    expect(res.body.error.code).toBe('PASSWORD_REQUIRED');
    expect((await call('post', '/staff', { ...NEW_STAFF, currentPassword: 'wrong-password-here' })).body.error.code).toBe('WRONG_PASSWORD');
    expect(await db.$count(staff)).toBe(1);
  });
});

describe('adding staff', () => {
  it('creates an account with a temporary password shown once', async () => {
    const res = await call('post', '/staff', NEW_STAFF);
    expect(res.status).toBe(201);
    expect(res.body.staff).toMatchObject({ email: 'new@example.com', role: 'front_desk', status: 'active', mustChangePassword: true });
    expect(res.body.staff.staffNo).toMatch(/^STF-/);
    expect(res.body.temporaryPassword).toHaveLength(14);
    expect(JSON.stringify(res.body.staff)).not.toMatch(/passwordHash|temporaryPassword/);

    const list = await request(app).get('/staff').set('Cookie', cookie);
    expect(JSON.stringify(list.body)).not.toContain(res.body.temporaryPassword);
    expect(JSON.stringify(list.body)).not.toMatch(/passwordHash|argon2/);
  });

  it('refuses a sixth active account with a clear message', async () => {
    for (let i = 0; i < 4; i += 1) expect((await call('post', '/staff', { ...NEW_STAFF, email: `s${i}@example.com` })).status).toBe(201);
    const res = await call('post', '/staff', { ...NEW_STAFF, email: 'sixth@example.com' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STAFF_LIMIT');
    expect(res.body.error.message).toMatch(/5 active/);
  });

  it('refuses a duplicate email and invalid details', async () => {
    await call('post', '/staff', NEW_STAFF);
    const duplicate = await call('post', '/staff', NEW_STAFF);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('DUPLICATE');
    expect((await call('post', '/staff', { ...NEW_STAFF, email: 'not-an-email' })).status).toBe(400);
    expect((await call('post', '/staff', { ...NEW_STAFF, name: ' ' })).status).toBe(400);
    expect((await call('post', '/staff', { ...NEW_STAFF, role: 'king', email: 'x@example.com' })).status).toBe(400);
  });
});

describe('editing staff', () => {
  it('updates details and records old and new values', async () => {
    const person = await addStaff({ name: 'Old Name', email: 'old@example.com' });
    const res = await call('patch', `/staff/${person.id}`, { ...NEW_STAFF, name: 'Better Name', role: 'manager' });
    expect(res.status).toBe(200);
    expect(res.body.staff).toMatchObject({ name: 'Better Name', role: 'manager' });

    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, 'staff.updated'));
    expect(entry).toMatchObject({ actorStaffId: owner.id, entityId: person.id });
    expect(entry!.oldValues).toMatchObject({ name: 'Old Name', role: 'front_desk' });
    expect(entry!.newValues).toMatchObject({ name: 'Better Name', role: 'manager' });
  });

  it('won’t change the last Owner’s role', async () => {
    const res = await call('patch', `/staff/${owner.id}`, { name: 'Owner', email: 'owner@example.com', role: 'manager' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LAST_OWNER');
  });

  it('answers 404 for an unknown or malformed ID', async () => {
    expect((await call('patch', '/staff/not-a-uuid', NEW_STAFF)).status).toBe(404);
    expect((await call('patch', '/staff/00000000-0000-4000-8000-000000000000', NEW_STAFF)).status).toBe(404);
  });
});

describe('deactivating and reactivating', () => {
  it('ends the person’s sessions at once, and blocks signing in', async () => {
    const person = await addStaff({ email: 'desk@example.com' });
    const session = await signIn(app, 'desk@example.com');
    expect((await call('post', `/staff/${person.id}/deactivate`)).status).toBe(200);
    expect((await request(app).get('/auth/me').set('Cookie', session)).status).toBe(401);
    await expect(signIn(app, 'desk@example.com')).rejects.toThrow();

    expect((await call('post', `/staff/${person.id}/reactivate`)).status).toBe(200);
    await signIn(app, 'desk@example.com');
  });

  it('won’t let an Owner deactivate or delete their own account', async () => {
    await addStaff({ role: 'owner', email: 'second@example.com' });
    expect((await call('post', `/staff/${owner.id}/deactivate`)).body.error.code).toBe('NOT_ON_YOURSELF');
    expect((await call('delete', `/staff/${owner.id}`)).body.error.code).toBe('NOT_ON_YOURSELF');
    expect((await stateOf(owner.id)).status).toBe('active');
  });

  it('lets a second Owner deactivate the first', async () => {
    const second = await addStaff({ role: 'owner', status: 'inactive', email: 'second@example.com' });
    await call('post', `/staff/${second.id}/reactivate`);
    const secondSession = await signIn(app, 'second@example.com');
    expect((await call('post', `/staff/${owner.id}/deactivate`, {}, secondSession)).status).toBe(200);
  });

  it('refuses reactivating past the limit of 5', async () => {
    const spare = await addStaff({ status: 'inactive', email: 'spare@example.com' });
    for (let i = 0; i < 4; i += 1) await addStaff();
    const res = await call('post', `/staff/${spare.id}/reactivate`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STAFF_LIMIT');
  });
});

describe('owner password reset', () => {
  it('issues a temporary password, ends sessions and clears any lock', async () => {
    const person = await addStaff({ email: 'desk@example.com', failedLoginAttempts: 10, lockedUntil: new Date(Date.now() + 60_000) });
    const res = await call('post', `/staff/${person.id}/reset-password`);
    expect(res.status).toBe(200);

    const session = await signIn(app, 'desk@example.com', res.body.temporaryPassword);
    expect((await request(app).get('/auth/me').set('Cookie', session)).body.user.mustChangePassword).toBe(true);
    await expect(signIn(app, 'desk@example.com')).rejects.toThrow();
  });

  it('won’t reset the Owner’s own password this way', async () => {
    expect((await call('post', `/staff/${owner.id}/reset-password`)).body.error.code).toBe('NOT_ON_YOURSELF');
  });

  it('never stores the temporary password in history', async () => {
    const person = await addStaff();
    const { body } = await call('post', `/staff/${person.id}/reset-password`);
    expect(JSON.stringify(await db.select().from(auditLog))).not.toContain(body.temporaryPassword);
  });
});

describe('trash and restore', () => {
  it('keeps the row and its history, ends sessions and frees the slot', async () => {
    const person = await addStaff({ email: 'desk@example.com' });
    const session = await signIn(app, 'desk@example.com');
    expect((await call('delete', `/staff/${person.id}`)).status).toBe(204);

    expect((await stateOf(person.id)).deletedAt).not.toBeNull();
    expect((await request(app).get('/auth/me').set('Cookie', session)).status).toBe(401);
    await expect(signIn(app, 'desk@example.com')).rejects.toThrow();
    const history = await request(app).get(`/staff/${person.id}/history`).set('Cookie', cookie);
    expect(history.body.history.map((h: { action: string }) => h.action)).toContain('staff.deleted');

    for (let i = 0; i < 4; i += 1) await addStaff();
  });

  it('restores as inactive, so it can’t break the limit', async () => {
    const person = await addStaff({ email: 'desk@example.com' });
    await call('delete', `/staff/${person.id}`);
    for (let i = 0; i < 4; i += 1) await addStaff();

    const res = await call('post', `/staff/${person.id}/restore`);
    expect(res.status).toBe(200);
    expect(res.body.staff).toMatchObject({ status: 'inactive', deletedAt: null });
  });

  it('refuses a restore when the email has been reused', async () => {
    const person = await addStaff({ email: 'desk@example.com' });
    await call('delete', `/staff/${person.id}`);
    await addStaff({ email: 'desk@example.com' });
    const res = await call('post', `/staff/${person.id}/restore`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE');
  });

  it('won’t edit or re-delete an account already in the trash', async () => {
    const person = await addStaff({ email: 'desk@example.com' });
    await call('delete', `/staff/${person.id}`);
    expect((await call('patch', `/staff/${person.id}`, NEW_STAFF)).status).toBe(404);
    expect((await call('delete', `/staff/${person.id}`)).status).toBe(404);
  });
});

describe('login history', () => {
  it('shows sign-ins and failures, newest first, with no secrets', async () => {
    const person = await addStaff({ email: 'desk@example.com' });
    await request(app).post('/auth/login').set('Origin', ORIGIN).send({ email: 'desk@example.com', password: 'wrong-password-here' });
    await signIn(app, 'desk@example.com');
    const res = await request(app).get(`/staff/${person.id}/history`).set('Cookie', cookie);
    expect(res.body.history.map((h: { action: string }) => h.action)).toEqual(['auth.login', 'auth.login_failed']);
    expect(JSON.stringify(res.body)).not.toContain('wrong-password-here');
  });
});
