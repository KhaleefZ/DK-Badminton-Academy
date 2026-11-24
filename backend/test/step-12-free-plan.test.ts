// Keeps the app inside Cloudflare's free plan: at most 50 D1 queries per request or cron run, and no
// query that reads a whole table on paths that run all the time. Also checks nothing needs a card (no R2).
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isNotNull } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db, useDatabase } from '../src/db/client.js';
import { bookings, messageSettings, messages, payments } from '../src/db/schema.js';
import { addDays, venueToday } from '../src/lib/time.js';
import { EMAIL_BATCH_SIZE, processMessages, WHATSAPP_BATCH_SIZE } from '../src/messages/queue.js';
import { useTestWhatsapp } from '../src/messages/whatsapp.js';
import { encrypt } from '../src/lib/secret.js';
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

describe('WhatsApp stays inside the free plan', () => {
  it('a run sending a full WhatsApp batch and a full email batch stays within budget', async () => {
    let metaCalls = 0;
    useTestWhatsapp(async () => ((metaCalls += 1), Response.json({ messages: [{ id: `wamid.${metaCalls}` }] })));
    try {
      await db.update(messageSettings).set({ emailEnabled: true, whatsappEnabled: true, whatsappPhoneNumberId: '123', whatsappTokenEncrypted: encrypt('t'), ownerWhatsappNumbers: ['9000000001', '9000000002'] });
      // Settling paid bookings now also writes the customer's WhatsApp and the owner alerts.
      await paidOrders(4);
      await db.update(bookings).set({ gatewayOrderAt: new Date(Date.now() - 3 * 60_000) }).where(isNotNull(bookings.gatewayOrderId));
      const sweep = await cost(() => sweepGatewayOrders());
      expect(sweep.queries).toBeLessThanOrEqual(BUDGET);
      await sweepGatewayOrders();
      // Add emails as well, so both the WhatsApp and the email pass are full.
      for (let i = 0; i < EMAIL_BATCH_SIZE; i += 1) await db.insert(messages).values({ template: 'enquiry_received', recipient: `p${i}@example.com`, subject: 's', body: 'b' });
      const run = await cost(() => processMessages({ send: async () => {} }));
      expect(run.result.whatsapp.sent).toBe(WHATSAPP_BATCH_SIZE);
      expect(run.result.sent).toBe(EMAIL_BATCH_SIZE);
      expect(metaCalls).toBe(WHATSAPP_BATCH_SIZE);
      expect(run.queries).toBeLessThanOrEqual(BUDGET);
    } finally {
      useTestWhatsapp(null);
      await db.update(messageSettings).set({ whatsappEnabled: false, whatsappPhoneNumberId: null, whatsappTokenEncrypted: null, ownerWhatsappNumbers: null });
    }
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

/* ---------- Nothing that needs a card ---------- */

describe('Cloudflare setup needs no card (verified 23 Nov 2026)', () => {
  const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8').replace(/^\s*\/\/.*$/gm, '')) as Record<string, any>;

  it('uses no R2 (which needs a card): photos are in Workers KV, part of the free plan', () => {
    expect(config.r2_buckets).toBeUndefined();
    expect(config.kv_namespaces).toEqual([expect.objectContaining({ binding: 'PHOTOS' })]);
  });

  it('keeps to the free plan’s 5 scheduled jobs per account, leaving room for other projects', () => {
    expect(config.triggers.crons).toEqual(['* * * * *']);
  });

  it('backs the database up weekly in GitHub Actions, kept privately for 90 days', () => {
    const workflow = readFileSync('../.github/workflows/database-backup.yml', 'utf8');
    expect(workflow).toContain("cron: '30 21 * * 6'");
    expect(workflow).toContain(`wrangler@${JSON.parse(readFileSync('node_modules/wrangler/package.json', 'utf8')).version} d1 export ${config.d1_databases[0].database_name} --remote`);
    expect(workflow).toContain('retention-days: 90');
  });

  it('saves, serves and removes a photo through KV', async () => {
    const { savePhoto, readPhoto, deletePhotos } = await import('../src/storage.js');
    const id = crypto.randomUUID();
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
    await savePhoto(id, bytes);
    expect(new Uint8Array((await readPhoto(id))!)).toEqual(bytes);
    await deletePhotos([id]);
    expect(await readPhoto(id)).toBeNull();
  });
});

describe('searches stay inside D1’s 50-byte LIKE limit (audit 24 Nov 2026)', () => {
  it('caps every search pattern at 50 bytes, even for long, escaped or Tamil text', async () => {
    const { likeTerm, LIKE_PATTERN_MAX_BYTES } = await import('../src/lib/search.js');
    const size = (s: string) => new TextEncoder().encode(s).length;
    for (const q of ['a'.repeat(100), '%_'.repeat(50), 'சுப்ரமணியன் பேட்மிண்டன் அகாடமி கோயம்புத்தூர்', '98765 43210', '😀'.repeat(30)]) {
      const pattern = likeTerm(q);
      expect(size(pattern)).toBeLessThanOrEqual(LIKE_PATTERN_MAX_BYTES);
      expect(pattern.startsWith('%') && pattern.endsWith('%')).toBe(true);
      // Inside the outer %…%, every % and _ is escaped, so it matches only itself.
      expect(pattern.slice(1, -1).replace(/\\[\\%_]/g, '')).not.toMatch(/[%_]/);
    }
    expect(likeTerm('50%_off')).toBe('%50\\%\\_off%');
  });
});
