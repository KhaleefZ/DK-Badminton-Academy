import request from 'supertest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/crypto.js';
import { SESSION_COOKIE } from '../src/auth/sessions.js';
import { db } from '../src/db/client.js';
import { staff, type StaffRole } from '../src/db/schema.js';
import type { Email } from '../src/lib/email.js';

export const PASSWORD = 'correct-horse-battery';

// Hash once: Argon2 is deliberately slow and most tests never check a different password.
const sharedHash = hashPassword(PASSWORD);

export async function addStaff(overrides: Partial<typeof staff.$inferInsert> & { role?: StaffRole } = {}) {
  const [row] = await db
    .insert(staff)
    .values({
      name: 'Test User',
      email: `user-${crypto.randomUUID()}@example.com`,
      role: 'front_desk',
      passwordHash: await sharedHash,
      ...overrides,
    })
    .returning();
  return row!;
}

export const ORIGIN = 'http://localhost:5174';

/** An app with generous limits and a mailbox the test can read. */
export function testApp() {
  const sent: Email[] = [];
  const app = createApp({
    loginLimitPerWindow: 10_000,
    resetLimitPerWindow: 10_000,
    publicWriteLimitPerWindow: 10_000,
    mailer: { send: async (email) => void sent.push(email) },
  });
  return { app, sent };
}

export async function signIn(app: ReturnType<typeof createApp>, email: string, password = PASSWORD) {
  const res = await request(app).post('/auth/login').set('Origin', ORIGIN).send({ email, password });
  if (res.status !== 200) throw new Error(`Sign-in failed: ${res.status} ${JSON.stringify(res.body)}`);
  return (res.get('Set-Cookie') ?? []).find((c) => c.startsWith(`${SESSION_COOKIE}=`))!.split(';')[0]!;
}
