// Keeps the app inside Cloudflare's free plan: at most 50 D1 queries per request or cron run, and no
// query that reads a whole table on paths that run all the time. Also covers the weekly R2 backup.
import { createHmac } from 'node:crypto';
import { isNotNull } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BACKUPS_KEPT, backUpDatabase, backupKey } from '../src/backup.js';
import { db, useDatabase } from '../src/db/client.js';
import { bookings, messageSettings, messages, payments } from '../src/db/schema.js';
import { addDays, venueToday } from '../src/lib/time.js';
import { EMAIL_BATCH_SIZE, processMessages } from '../src/messages/queue.js';
import { useTestGateway, type Gateway, type GatewayKeys } from '../src/payments/gateway.js';
import { SWEEP_BATCH, sweepGatewayOrders } from '../src/payments/settle.js';
import { addStaff, ORIGIN, PASSWORD, signIn, testApp } from './helpers.js';

const { app } = testApp();
const WEBSITE = 'http://localhost:5173';
const FUTURE = addDays(venueToday(), 3);
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
/** Cloudflare's free limit is 50; this keeps a margin for code that grows a little. */
const BUDGET = 45;

/* ---------- Counting queries ---------- */

let queries = 0;
let original: unknown;

/** Wraps the D1 binding so every statement run, and every batch, counts as one query (as Cloudflare counts them). */
function counting(binding: any): any {
  const statement = (stmt: any): any =>
    new Proxy(stmt, {
      get(target, prop) {
        const value = target[prop];
        if (prop === 'bind') return (...args: unknown[]) => statement(value.apply(target, args));
        if (['all', 'run', 'raw', 'first'].includes(prop as string)) return (...args: unknown[]) => ((queries += 1), value.apply(target, args));
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  return new Proxy(binding, {
    get(target, prop) {
      const value = target[prop];
      if (prop === 'prepare') return (sql: string) => statement(value.call(target, sql));
      if (prop === 'batch') return (stmts: unknown[]) => ((queries += 1), value.call(target, stmts));
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

async function cost<T>(work: () => Promise<T>): Promise<{ queries: number; result: T }> {
  queries = 0;
  const result = await work();
  return { queries, result };
}

/* ---------- A gateway that pays whatever it's asked about ---------- */

const orders = new Map<string, { amountPaise: number; paid?: { paymentId: string; amountPaise: number } }>();
let made = 0;
const fakeGateway = (keys: GatewayKeys): Gateway => ({
  name: keys.gateway,
  live: keys.live,
  async createOrder(order) {
    const orderId = `order_${(made += 1)}`;
    orders.set(orderId, { amountPaise: order.amountPaise });
    return { orderId, checkout: { gateway: 'razorpay', keyId: keys.keyId, orderId, amountPaise: order.amountPaise, currency: 'INR', description: order.description, prefill: { name: order.customer.name, contact: order.customer.phone } } };
  },
  async fetchOrder(orderId) {
    const paid = orders.get(orderId)?.paid;
    return paid ? { status: 'paid', ...paid } : { status: 'pending' };
  },
  verifyWebhook(header, raw) {
    return header('x-fake-signature') === createHmac('sha256', 'k').update(raw).digest('hex') ? JSON.parse(raw) : null;
  },
  async refund() {
    return { refundId: 'rfnd_1' };
  },
  async checkCredentials() {},
});

let owner: string;
let court: string;
const admin = (method: 'get' | 'put', path: string) => request(app)[method](path).set('Origin', ORIGIN).set('Cookie', owner);
const site = (method: 'get' | 'post', path: string) => request(app)[method](`/public${path}`).set('Origin', WEBSITE);
const hold = (i: number) =>
  site('post', '/bookings').send({ courtId: court, date: FUTURE, start: `${String(6 + i).padStart(2, '0')}:00`, name: 'Asha Raman', phone: `98765432${10 + i}`, email: `asha${i}@example.com` });

/** Holds `n` bookings and starts checkout for each, then marks every order paid at the gateway. */
async function paidOrders(n: number) {
  const tokens: string[] = [];
  for (let i = 0; i < n; i += 1) tokens.push((await hold(i).expect(201)).body.token);
  for (const token of tokens) await site('post', `/bookings/${token}/checkout`).expect(200);
  for (const [orderId, order] of orders) order.paid = { paymentId: `pay_${orderId}`, amountPaise: order.amountPaise };
  return tokens;
}

beforeAll(() => {
  original = (db as any).$client;
  useDatabase(counting(original));
  useTestGateway(fakeGateway);
});

afterAll(() => {
  useDatabase(original as never);
  useTestGateway(null);
});

beforeEach(async () => {
  orders.clear();
  owner = await signIn(app, (await addStaff({ role: 'owner' })).email);
  court = (await admin('get', '/settings').expect(200)).body.courts[0].id;
  await admin('put', '/settings/hours').send({ hours: ALL_DAYS.map((weekday) => ({ weekday, opens: '06:00', closes: '22:00' })) }).expect(200);
  await admin('put', '/settings/prices').send({ rules: [{ courtId: null, days: ALL_DAYS, start: '00:00', end: '24:00', ratePaise: 50000 }] }).expect(200);
  await admin('put', '/settings/payments').send({ enabled: true, gateway: 'razorpay', mode: 'test', keyId: 'rzp_test_abc', keySecret: 'secret', webhookSecret: 'whsec', currentPassword: PASSWORD }).expect(200);
});

describe('D1 queries per request stay inside the free plan', () => {
  it('for the website booking flow', async () => {
    expect((await cost(() => site('get', `/availability?date=${FUTURE}`).expect(200))).queries).toBeLessThanOrEqual(BUDGET);
    const held = await cost(() => hold(0).expect(201));
    expect(held.queries).toBeLessThanOrEqual(BUDGET);
    const token = held.result.body.token;
    expect((await cost(() => site('post', `/bookings/${token}/checkout`).expect(200))).queries).toBeLessThanOrEqual(BUDGET);
    for (const order of orders.values()) order.paid = { paymentId: 'pay_1', amountPaise: order.amountPaise };
    const settled = await cost(() => site('post', `/bookings/${token}/check`).expect(200));
    expect(settled.result.body.booking.status).toBe('active');
    expect(settled.queries).toBeLessThanOrEqual(BUDGET);
  });

  it('for the busiest admin pages', async () => {
    await paidOrders(3);
    for (const path of [`/bookings?date=${FUTURE}`, `/schedule?date=${FUTURE}`, `/reports?from=${addDays(venueToday(), -55)}&to=${venueToday()}`, '/customers', '/payments', '/memberships']) {
      const { queries: used } = await cost(() => admin('get', path).expect(200));
      expect(used, path).toBeLessThanOrEqual(BUDGET);
    }
  });
});

describe('each cron run stays inside the free plan', () => {
  it('settles at most SWEEP_BATCH orders per payment check, within budget', async () => {
    await paidOrders(6);
    // Old enough for the sweep (it waits 2 minutes, leaving early ones to the webhook and the website).
    await db.update(bookings).set({ gatewayOrderAt: new Date(Date.now() - 3 * 60_000) }).where(isNotNull(bookings.gatewayOrderId));
    const run = await cost(() => sweepGatewayOrders());
    expect(run.result).toBe(SWEEP_BATCH);
    expect(run.queries).toBeLessThanOrEqual(BUDGET);
    expect(await db.$count(payments)).toBe(SWEEP_BATCH);
  });

  it('sends at most EMAIL_BATCH_SIZE emails per run, within budget', async () => {
    await paidOrders(4);
    await db.update(bookings).set({ gatewayOrderAt: new Date(Date.now() - 3 * 60_000) }).where(isNotNull(bookings.gatewayOrderId));
    await sweepGatewayOrders();
    await sweepGatewayOrders();
    await db.update(messageSettings).set({ emailEnabled: true });
    expect(await db.$count(messages)).toBeGreaterThan(EMAIL_BATCH_SIZE);
    const run = await cost(() => processMessages({ send: async () => {} }));
    expect(run.result.sent).toBe(EMAIL_BATCH_SIZE);
    expect(run.queries).toBeLessThanOrEqual(BUDGET);
  });
});

describe('queries that run all the time use an index, not a whole-table read', () => {
  const plan = async (sql: string) => {
    const { results } = await (db as any).$client.prepare(`EXPLAIN QUERY PLAN ${sql}`).all();
    return (results as { detail: string }[]).map((r) => r.detail).join(' | ');
  };

  it.each([
    ['releasing expired booking holds', "UPDATE bookings SET status = 'expired' WHERE status = 'pending_payment' AND hold_expires_at <= 0"],
    ['releasing expired membership holds', "UPDATE memberships SET status = 'expired' WHERE status = 'pending_payment' AND hold_expires_at <= 0"],
    ['counting today’s sent emails', "SELECT count(*) FROM messages WHERE channel = 'email' AND status = 'sent' AND sent_at >= 0"],
  ])('%s', async (_name, sql) => {
    const detail = await plan(sql);
    expect(detail).toMatch(/USING (COVERING )?INDEX/);
    expect(detail).not.toMatch(/\bSCAN\b/);
  });
});

/* ---------- Weekly backup ---------- */

function fakeBucket(keys: string[] = []) {
  const stored = new Map<string, unknown>(keys.map((k) => [k, 'old']));
  return {
    stored,
    async put(key: string, body: unknown) {
      stored.set(key, body);
    },
    async list({ prefix }: { prefix: string }) {
      return { objects: [...stored.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) };
    },
    async delete(remove: string[]) {
      for (const key of remove) stored.delete(key);
    },
  };
}

/** Answers like the D1 export API: started, still running once, then ready with a download link. */
function fakeCloudflare(steps: object[] = [{ at_bookmark: 'bm1', status: 'active' }, { status: 'active' }, { status: 'complete', signed_url: 'https://download.example/dump.sql', filename: 'dump.sql' }]) {
  const calls: { url: string; body?: unknown; auth?: string | null }[] = [];
  let step = 0;
  const fetcher = async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: new Headers(init?.headers).get('authorization') });
    if (url.startsWith('https://download.example/')) return new Response('CREATE TABLE x (id);', { headers: { 'content-length': '20' } });
    return Response.json({ success: true, result: steps[step++] });
  };
  return { calls, fetcher };
}

const backupEnv = (bucket: ReturnType<typeof fakeBucket>) => ({ BACKUPS: bucket as never, BACKUP_ACCOUNT_ID: 'acc1', BACKUP_DATABASE_ID: 'db1', BACKUP_API_TOKEN: 'token1' });
const noPause = async () => {};

describe('weekly backup to R2', () => {
  it('exports the database through the API and stores the file under the date', async () => {
    const bucket = fakeBucket();
    const cf = fakeCloudflare();
    const at = new Date('2026-11-21T21:30:00Z');
    const key = await backUpDatabase(backupEnv(bucket), at, { fetcher: cf.fetcher, pause: noPause });
    expect(key).toBe('database/dk-badminton-2026-11-21.sql');
    expect(bucket.stored.has(key!)).toBe(true);
    expect(cf.calls[0]).toMatchObject({ url: 'https://api.cloudflare.com/client/v4/accounts/acc1/d1/database/db1/export', body: { output_format: 'polling' }, auth: 'Bearer token1' });
    expect(cf.calls[1]!.body).toEqual({ output_format: 'polling', current_bookmark: 'bm1' });
  });

  it('keeps only the newest copies', async () => {
    const old = Array.from({ length: BACKUPS_KEPT + 3 }, (_, i) => backupKey(new Date(Date.UTC(2026, 0, 1 + i * 7))));
    const bucket = fakeBucket(old);
    await backUpDatabase(backupEnv(bucket), new Date('2026-11-21T21:30:00Z'), { fetcher: fakeCloudflare().fetcher, pause: noPause });
    const left = [...bucket.stored.keys()].sort();
    expect(left).toHaveLength(BACKUPS_KEPT);
    expect(left.at(-1)).toBe('database/dk-badminton-2026-11-21.sql');
    expect(left).not.toContain(old[0]);
  });

  it('does nothing until it is set up', async () => {
    const bucket = fakeBucket();
    expect(await backUpDatabase({ BACKUPS: bucket as never }, new Date(), { fetcher: fakeCloudflare().fetcher, pause: noPause })).toBeNull();
    expect(bucket.stored.size).toBe(0);
  });

  it('fails loudly, storing nothing, when the export or the token is refused', async () => {
    const bucket = fakeBucket();
    const refused = async () => Response.json({ success: false, errors: [{ message: 'Authentication error' }] }, { status: 403 });
    await expect(backUpDatabase(backupEnv(bucket), new Date(), { fetcher: refused, pause: noPause })).rejects.toThrow(/Authentication error/);
    const failing = fakeCloudflare([{ at_bookmark: 'bm1', status: 'active' }, { status: 'error', error: 'disk full' }]);
    await expect(backUpDatabase(backupEnv(bucket), new Date(), { fetcher: failing.fetcher, pause: noPause })).rejects.toThrow(/disk full/);
    expect(bucket.stored.size).toBe(0);
  });
});
