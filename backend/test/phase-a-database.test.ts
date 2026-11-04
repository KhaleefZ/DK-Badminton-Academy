import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { hashPassword, hashToken, generateToken, verifyPassword } from '../src/auth/crypto.js';
import { passwordProblem } from '../src/auth/policy.js';
import { db, dbErrorCode, DB_ERRORS } from '../src/db/client.js';
import { staff } from '../src/db/schema.js';
import { addStaff } from './helpers.js';

const run = promisify(execFile);

async function errorCode(work: Promise<unknown>) {
  try {
    await work;
    return null;
  } catch (err) {
    return dbErrorCode(err);
  }
}

describe('staff accounts in the database', () => {
  it('refuses a sixth active account, whatever code tries it', async () => {
    await addStaff({ role: 'owner' });
    for (let i = 0; i < 4; i += 1) await addStaff();
    expect(await errorCode(addStaff())).toBe(DB_ERRORS.staffLimit);
    expect(await db.$count(staff)).toBe(5);
  });

  it('holds the limit when several accounts are added at the same moment', async () => {
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => addStaff()));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
  });

  it('does not count inactive or deleted accounts, and blocks reactivating past the limit', async () => {
    await addStaff({ role: 'owner' });
    for (let i = 0; i < 3; i += 1) await addStaff();
    const spare = await addStaff();
    await db.update(staff).set({ status: 'inactive' }).where(eq(staff.id, spare.id));
    await addStaff();
    expect(await errorCode(db.update(staff).set({ status: 'active' }).where(eq(staff.id, spare.id)))).toBe(DB_ERRORS.staffLimit);
  });

  it('protects the last active Owner from every way of removing it', async () => {
    const owner = await addStaff({ role: 'owner' });
    const where = eq(staff.id, owner.id);
    expect(await errorCode(db.update(staff).set({ status: 'inactive' }).where(where))).toBe(DB_ERRORS.lastOwner);
    expect(await errorCode(db.update(staff).set({ role: 'manager' }).where(where))).toBe(DB_ERRORS.lastOwner);
    expect(await errorCode(db.update(staff).set({ deletedAt: new Date() }).where(where))).toBe(DB_ERRORS.lastOwner);
    expect(await errorCode(db.delete(staff).where(where))).toBe(DB_ERRORS.lastOwner);
  });

  it('allows removing an Owner when another active Owner exists', async () => {
    const owner = await addStaff({ role: 'owner' });
    await addStaff({ role: 'owner' });
    await db.update(staff).set({ status: 'inactive' }).where(eq(staff.id, owner.id));
  });

  it('never reuses a staff number, even after a delete', async () => {
    await addStaff({ role: 'owner' });
    const second = await addStaff();
    await db.delete(staff).where(eq(staff.id, second.id));
    const third = await addStaff();
    expect(third.staffNo).not.toBe(second.staffNo);
    expect(third.staffNo).toMatch(/^STF-\d{3,}$/);
  });

  it('treats emails as the same regardless of capitals, and frees a deleted account’s email', async () => {
    const first = await addStaff({ role: 'manager', email: 'Same@Example.com' });
    await addStaff({ role: 'owner' });
    expect(await errorCode(addStaff({ email: 'same@example.com' }))).toBe(DB_ERRORS.uniqueViolation);
    await db.update(staff).set({ deletedAt: new Date() }).where(eq(staff.id, first.id));
    await addStaff({ email: 'same@example.com' });
  });
});

describe('password and token handling', () => {
  it('stores an Argon2id hash that verifies only the right password', async () => {
    const stored = await hashPassword('correct-horse-battery');
    expect(stored).toMatch(/^\$argon2id\$/);
    expect(stored).not.toContain('correct-horse-battery');
    expect(await verifyPassword(stored, 'correct-horse-battery')).toBe(true);
    expect(await verifyPassword(stored, 'wrong-horse-battery')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false);
  });

  it('applies the password rules', () => {
    const email = 'kumar@example.com';
    expect(passwordProblem('short', email)).toMatch(/at least 10/);
    expect(passwordProblem('password123', email)).toMatch(/common/);
    expect(passwordProblem('PASSWORD123', email)).toMatch(/common/);
    expect(passwordProblem('aaaaaaaaaaaa', email)).toMatch(/common/);
    expect(passwordProblem('kumar-rally-2030', email)).toMatch(/email/);
    expect(passwordProblem('a'.repeat(100) + 'b'.repeat(29), email)).toMatch(/at most 128/);
    expect(passwordProblem('correct-horse-battery', email)).toBeNull();
  });

  it('creates unique tokens and stores only a hash', () => {
    const token = generateToken();
    expect(token).not.toBe(generateToken());
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).not.toContain(token);
  });
});

describe('create-owner script', () => {
  const env = {
    ...process.env,
    OWNER_NAME: 'Academy Owner',
    OWNER_EMAIL: 'Owner@Example.com',
    OWNER_PASSWORD: 'correct-horse-battery',
  };
  const script = () => run('npx', ['tsx', 'src/scripts/create-owner.ts'], { env });

  it('creates one Owner with a hashed password, then refuses a second run', async () => {
    const { stdout } = await script();
    expect(stdout).toMatch(/Owner created: STF-\d+ \(owner@example\.com\)/);
    expect(stdout).not.toContain(env.OWNER_PASSWORD);

    const [owner] = await db.select().from(staff);
    expect(owner).toMatchObject({ email: 'owner@example.com', role: 'owner', status: 'active' });
    expect(await verifyPassword(owner!.passwordHash, env.OWNER_PASSWORD)).toBe(true);

    await expect(script()).rejects.toThrow(/already exists/);
    expect(await db.$count(staff)).toBe(1);
  });

  it('refuses a weak password', async () => {
    await expect(run('npx', ['tsx', 'src/scripts/create-owner.ts'], { env: { ...env, OWNER_PASSWORD: 'password123' } })).rejects.toThrow(/too common/);
    expect(await db.$count(staff)).toBe(0);
  });
});
