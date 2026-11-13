import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/client.js';
import { bookings, memberships, messages, paymentIssues, payments } from '../src/db/schema.js';
import { addDays, venueToday } from '../src/lib/time.js';
import { cashfreeGateway, cashfreeSignature } from '../src/payments/cashfree.js';
import type { Gateway, GatewayKeys } from '../src/payments/gateway.js';
import { GatewayError, useTestGateway } from '../src/payments/gateway.js';
import { razorpayGateway, razorpaySignature } from '../src/payments/razorpay.js';
import { sweepGatewayOrders } from '../src/payments/settle.js';
import { releaseExpiredHolds } from '../src/schedule/availability.js';
import { addStaff, ORIGIN, PASSWORD, signIn, testApp } from './helpers.js';

const WEBSITE = 'http://localhost:5173';
const { app } = testApp();
const FUTURE = addDays(venueToday(), 3);
const START = addDays(venueToday(), 1);
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const FAKE_SECRET = 'fake-webhook-secret';

/** Behaves like a real gateway: orders, payments made "at the gateway", signed webhooks, refunds that can fail. */
function fakeGateway() {
  const orders = new Map<string, { amountPaise: number; paid?: { paymentId: string; amountPaise: number } }>();
  const state = { keysWork: true, refundsWork: true, refunds: [] as { paymentId: string; amountPaise: number }[], made: 0 };
  const factory = (keys: GatewayKeys): Gateway => ({
    name: keys.gateway,
    live: keys.live,
    async createOrder(order) {
      const orderId = `order_${(state.made += 1)}`;
      orders.set(orderId, { amountPaise: order.amountPaise });
      return { orderId, checkout: { gateway: 'razorpay', keyId: keys.keyId, orderId, amountPaise: order.amountPaise, currency: 'INR', description: order.description, prefill: { name: order.customer.name, contact: order.customer.phone } } };
    },
    async fetchOrder(orderId) {
      const paid = orders.get(orderId)?.paid;
      return paid ? { status: 'paid', ...paid } : { status: 'pending' };
    },
    verifyWebhook(header, raw) {
      if (header('x-fake-signature') !== createHmac('sha256', FAKE_SECRET).update(raw).digest('hex')) return null;
      return JSON.parse(raw);
    },
    async refund({ paymentId, amountPaise }) {
      if (!state.refundsWork) throw new GatewayError('the gateway is down');
      state.refunds.push({ paymentId, amountPaise });
      return { refundId: `rfnd_${state.refunds.length}` };
    },
    async checkCredentials() {
      if (!state.keysWork) throw new GatewayError('Razorpay refused these keys.');
    },
  });
  /** The customer pays at the gateway. Nothing reaches the app until a webhook or a check. */
  const payAt = (orderId: string, amountPaise = orders.get(orderId)!.amountPaise) => {
    const paid = { paymentId: `pay_${orderId}`, amountPaise };
    orders.get(orderId)!.paid = paid;
    return { kind: 'paid', orderId, ...paid };
  };
  return { factory, state, payAt };
}

let fake: ReturnType<typeof fakeGateway>;
let owner: string;
let desk: string;
let court1: string;

const admin = (method: 'get' | 'post' | 'put', path: string, cookie = owner) => request(app)[method](path).set('Origin', ORIGIN).set('Cookie', cookie);
const site = (method: 'get' | 'post', path: string) => request(app)[method](`/public${path}`).set('Origin', WEBSITE);
const guest = { name: 'Asha Raman', phone: '+91 98765 43210', email: 'asha@example.com' };
const hold = async (start = '06:00') => (await site('post', '/bookings').send({ courtId: court1, date: FUTURE, start, ...guest }).expect(201)).body;
const settings = (over = {}) => admin('put', '/settings/payments').send({ enabled: true, gateway: 'razorpay', mode: 'test', keyId: 'rzp_test_abc', keySecret: 'secret', webhookSecret: 'whsec', currentPassword: PASSWORD, ...over });
const webhook = (event: object, signature?: string) => {
  const raw = JSON.stringify(event);
  return request(app).post('/webhooks/payments').set('Content-Type', 'application/json').set('x-fake-signature', signature ?? createHmac('sha256', FAKE_SECRET).update(raw).digest('hex')).send(raw);
};
const bookingRow = async (token: string) => (await site('get', `/bookings/${token}`).expect(200)).body.booking;
const checkout = async (token: string) => (await site('post', `/bookings/${token}/checkout`).expect(200)).body.checkout;

beforeEach(async () => {
  fake = fakeGateway();
  useTestGateway(fake.factory);
  owner = await signIn(app, (await addStaff({ role: 'owner' })).email);
  desk = await signIn(app, (await addStaff({ role: 'front_desk' })).email);
  court1 = (await admin('get', '/settings').expect(200)).body.courts[0].id;
  await admin('put', '/settings/hours').send({ hours: ALL_DAYS.map((weekday) => ({ weekday, opens: '06:00', closes: '22:00' })) }).expect(200);
  await admin('put', '/settings/prices').send({ rules: [{ courtId: null, days: ALL_DAYS, start: '00:00', end: '24:00', ratePaise: 50000 }] }).expect(200);
});

afterEach(() => useTestGateway(null));

describe('payment settings', () => {
  it('belong to the Owner alone, need their password, and never show the secrets', async () => {
    await admin('get', '/settings/payments', desk).expect(403);
    await settings({ currentPassword: 'wrong-password-123' }).expect(400);
    const { body } = await settings().expect(200);
    expect(body.settings).toMatchObject({ enabled: true, gateway: 'razorpay', mode: 'test', keyId: 'rzp_test_abc', hasKeySecret: true, hasWebhookSecret: true });
    expect(JSON.stringify((await admin('get', '/settings/payments').expect(200)).body)).not.toMatch(/whsec|"secret"/);
  });

  it('won’t switch on with keys the gateway refuses, or without them', async () => {
    fake.state.keysWork = false;
    expect((await settings().expect(400)).body.error.code).toBe('KEYS_REFUSED');
    expect((await settings({ keySecret: '', keyId: '' }).expect(400)).body.error.code).toBe('KEYS_MISSING');
    expect((await admin('get', '/public/payments')).body).toMatchObject({ via: 'simulator' });
  });

  it('keeps saved secrets when left blank, but drops them when the gateway changes', async () => {
    await settings().expect(200);
    await settings({ keySecret: '', webhookSecret: '' }).expect(200);
    expect((await settings({ gateway: 'cashfree', keyId: 'app', keySecret: '' }).expect(400)).body.error.code).toBe('KEYS_MISSING');
  });

  it('tells the website which gateway to load, and that no real money moves in test mode', async () => {
    expect((await site('get', '/payments').expect(200)).body).toEqual({ online: true, via: 'simulator', testMode: true });
    await settings().expect(200);
    expect((await site('get', '/payments').expect(200)).body).toEqual({ online: true, via: 'razorpay', testMode: true });
  });
});

describe('paying for a booking', () => {
  beforeEach(async () => {
    await settings().expect(200);
  });

  it('charges the booking’s own amount and refuses the simulator', async () => {
    const { token } = await hold();
    const info = await checkout(token);
    expect(info).toMatchObject({ gateway: 'razorpay', keyId: 'rzp_test_abc', amountPaise: 50000, currency: 'INR' });
    expect((await site('post', `/bookings/${token}/pay`).send({ result: 'success' }).expect(409)).body.error.code).toBe('USE_GATEWAY');
  });

  it('confirms on the gateway’s webhook, records one receipt however many times it’s told, and queues the confirmation', async () => {
    const { token } = await hold();
    const { orderId } = await checkout(token);
    const event = fake.payAt(orderId);
    await Promise.all([webhook(event), webhook(event), webhook(event)].map((r) => r.expect(200)));
    expect((await bookingRow(token)).status).toBe('active');
    const receipts = await db.select().from(payments);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ method: 'online', amountPaise: 50000, gateway: 'razorpay', gatewayOrderId: orderId, gatewayPaymentId: `pay_${orderId}` });
    expect((await db.select().from(messages)).map((m) => m.template)).toContain('booking_confirmed');
  });

  it('ignores a webhook with a wrong signature', async () => {
    const { token } = await hold();
    const { orderId } = await checkout(token);
    await webhook(fake.payAt(orderId), 'forged').expect(401);
    expect((await bookingRow(token)).status).toBe('pending_payment');
    expect(await db.$count(payments)).toBe(0);
  });

  it('confirms straight away when the website asks after checkout, without waiting for the webhook', async () => {
    const { token } = await hold();
    const { orderId } = await checkout(token);
    expect((await site('post', `/bookings/${token}/check`).expect(200)).body.booking.status).toBe('pending_payment');
    fake.payAt(orderId);
    expect((await site('post', `/bookings/${token}/check`).expect(200)).body.booking.status).toBe('active');
  });

  it('flags a payment that doesn’t match the booking, and doesn’t confirm it', async () => {
    const { token } = await hold();
    const { orderId } = await checkout(token);
    await webhook(fake.payAt(orderId, 100)).expect(200);
    expect((await bookingRow(token)).status).toBe('pending_payment');
    const [issue] = await db.select().from(paymentIssues);
    expect(issue!.message).toMatch(/doesn’t match|is ₹500/);
  });

  it('still confirms a payment that arrives after the hold ended, if nobody took the slot', async () => {
    const { token } = await hold();
    const { orderId } = await checkout(token);
    await db.update(bookings).set({ holdExpiresAt: new Date(Date.now() - 1000) });
    await releaseExpiredHolds();
    await webhook(fake.payAt(orderId)).expect(200);
    expect((await bookingRow(token)).status).toBe('active');
  });

  it('refunds a late payment automatically when someone else took the slot, and tells staff', async () => {
    const first = await hold();
    const { orderId } = await checkout(first.token);
    await db.update(bookings).set({ holdExpiresAt: new Date(Date.now() - 1000) });
    await releaseExpiredHolds();
    await hold();
    await webhook(fake.payAt(orderId)).expect(200);
    expect(fake.state.refunds).toEqual([{ paymentId: `pay_${orderId}`, amountPaise: 50000 }]);
    const [receipt] = await db.select().from(payments);
    expect(receipt!.refundedAt).toBeInstanceOf(Date);
    expect(receipt!.voidedAt).toBeInstanceOf(Date);
    const { issues } = (await admin('get', '/payments/issues').expect(200)).body;
    expect(issues[0].message).toMatch(/someone else had taken the slot/);
    await admin('post', `/payments/issues/${issues[0].id}/resolve`).expect(200);
    expect((await admin('get', '/payments/issues').expect(200)).body.issues).toEqual([]);
  });

  it('asks staff to refund by hand when the automatic refund fails', async () => {
    const first = await hold();
    const { orderId } = await checkout(first.token);
    await db.update(bookings).set({ holdExpiresAt: new Date(Date.now() - 1000) });
    await releaseExpiredHolds();
    await hold();
    fake.state.refundsWork = false;
    await webhook(fake.payAt(orderId)).expect(200);
    const [receipt] = await db.select().from(payments);
    expect(receipt!.refundedAt).toBeNull();
    expect((await db.select().from(paymentIssues))[0]!.message).toMatch(/Refund it from the gateway dashboard/);
  });

  it('catches up on a payment whose webhook never came, from the cron', async () => {
    const { token } = await hold();
    const { orderId } = await checkout(token);
    fake.payAt(orderId);
    expect(await sweepGatewayOrders()).toBe(0); // Too soon: the checkout has only just started.
    await db.update(bookings).set({ gatewayOrderAt: new Date(Date.now() - 3 * 60_000) });
    expect(await sweepGatewayOrders()).toBe(1);
    expect((await bookingRow(token)).status).toBe('active');
    expect(await sweepGatewayOrders()).toBe(0);
  });
});

describe('refunds by staff', () => {
  beforeEach(async () => {
    await settings().expect(200);
  });

  const paidReceipt = async () => {
    const { token } = await hold();
    const { orderId } = await checkout(token);
    await webhook(fake.payAt(orderId)).expect(200);
    return (await db.select().from(payments))[0]!;
  };

  it('refunds an online payment through the gateway; the front desk can’t, and it can’t be voided instead', async () => {
    const receipt = await paidReceipt();
    await admin('post', `/payments/${receipt.id}/refund`, desk).send({ reason: 'Rain' }).expect(403);
    expect((await admin('post', `/payments/${receipt.id}/void`).send({ reason: 'x' }).expect(400)).body.error.code).toBe('USE_REFUND');
    const { body } = await admin('post', `/payments/${receipt.id}/refund`).send({ reason: 'Rain' }).expect(200);
    expect(body.payment).toMatchObject({ gatewayRefundId: 'rfnd_1', voidReason: 'Refunded: Rain' });
    expect((await admin('post', `/payments/${receipt.id}/refund`).send({ reason: 'Again' }).expect(409)).body.error.code).toBe('REFUND_FAILED');
  });

  it('refuses to refund cash or UPI taken at the desk', async () => {
    const { token } = await hold();
    await site('post', `/bookings/${token}/checkout`).expect(200);
    const id = (await db.select().from(bookings))[0]!.id;
    await db.update(bookings).set({ status: 'active' }).where(eq(bookings.id, id));
    const cash = (await admin('post', `/bookings/${id}/payments`).send({ amountPaise: 1000, method: 'cash' }).expect(201)).body.payment;
    expect((await admin('post', `/payments/${cash.id}/refund`).send({ reason: 'x' }).expect(409)).body.error.message).toMatch(/Only an online payment/);
  });
});

describe('paying for a membership', () => {
  let plan: { id: string };
  let batch: { id: string };

  beforeEach(async () => {
    await settings().expect(200);
    plan = (await admin('post', '/memberships/plans').send({ name: 'Regular', kind: 'individual', pricePaise: 200000 }).expect(201)).body.plan;
    batch = (await admin('post', '/memberships/batches').send({ name: 'Morning', planId: plan.id, courtId: court1, days: [1, 3, 5], start: '06:00', end: '07:00', capacity: 1, startsOn: START, endsOn: addDays(START, 120) }).expect(201)).body.batch;
  });

  const joinOnline = async (over = {}) => (await site('post', '/memberships').send({ ...guest, planId: plan.id, batchId: batch.id, startsOn: START, ...over }).expect(201)).body;

  it('confirms on the webhook and records the receipt against the first month', async () => {
    const { token } = await joinOnline();
    const { checkout: info } = (await site('post', `/memberships/${token}/checkout`).expect(200)).body;
    expect(info.amountPaise).toBe(200000);
    await webhook(fake.payAt(info.orderId)).expect(200);
    expect((await site('get', `/memberships/${token}`).expect(200)).body.membership.status).toBe('active');
    const [receipt] = await db.select().from(payments);
    expect(receipt).toMatchObject({ method: 'online', amountPaise: 200000, bookingId: null });
    expect(receipt!.periodId).toBeTruthy();
  });

  it('refunds a late payment when the batch filled up in the meantime', async () => {
    const { token } = await joinOnline();
    const { checkout: info } = (await site('post', `/memberships/${token}/checkout`).expect(200)).body;
    await db.update(memberships).set({ holdExpiresAt: new Date(Date.now() - 1000) });
    await releaseExpiredHolds();
    await admin('post', '/memberships').send({ holderName: 'Desk member', phone: '91234 56789', planId: plan.id, batchId: batch.id, startsOn: START }).expect(201);
    await webhook(fake.payAt(info.orderId)).expect(200);
    expect(fake.state.refunds).toHaveLength(1);
    expect((await db.select().from(paymentIssues))[0]!.message).toMatch(/batch seat had been taken/);
  });
});

describe('the real gateways’ signature checks', () => {
  const keys = (gateway: 'cashfree' | 'razorpay'): GatewayKeys => ({ gateway, live: false, keyId: 'id', keySecret: 'cf-secret', webhookSecret: 'rzp-webhook-secret' });

  it('Cashfree: accepts its own signature over timestamp + body, refuses anything altered', () => {
    const body = JSON.stringify({ type: 'PAYMENT_SUCCESS_WEBHOOK', data: { order: { order_id: 'bkg-1', order_amount: 500 }, payment: { cf_payment_id: 5114915, payment_status: 'SUCCESS', payment_amount: 500 } } });
    const timestamp = '1731489000000';
    const headers = (signature: string) => (name: string) => ({ 'x-webhook-signature': signature, 'x-webhook-timestamp': timestamp })[name];
    const gateway = cashfreeGateway(keys('cashfree'));
    expect(gateway.verifyWebhook(headers(cashfreeSignature('cf-secret', timestamp, body)), body)).toEqual({ kind: 'paid', orderId: 'bkg-1', paymentId: '5114915', amountPaise: 50000 });
    expect(gateway.verifyWebhook(headers(cashfreeSignature('cf-secret', timestamp, body)), body.replace('500', '5'))).toBeNull();
    expect(gateway.verifyWebhook(headers(cashfreeSignature('other', timestamp, body)), body)).toBeNull();
  });

  it('Razorpay: accepts its own signature over the body, refuses anything altered', () => {
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_29QQoUBi66xm2f', order_id: 'order_9A33XWu170gUtm', amount: 50000, status: 'captured' } } } });
    const headers = (signature: string) => (name: string) => ({ 'x-razorpay-signature': signature })[name];
    const gateway = razorpayGateway(keys('razorpay'));
    expect(gateway.verifyWebhook(headers(razorpaySignature('rzp-webhook-secret', body)), body)).toEqual({ kind: 'paid', orderId: 'order_9A33XWu170gUtm', paymentId: 'pay_29QQoUBi66xm2f', amountPaise: 50000 });
    expect(gateway.verifyWebhook(headers(razorpaySignature('rzp-webhook-secret', body)), body.replace('50000', '5'))).toBeNull();
  });

  it('Razorpay: refuses test keys in Live mode before calling anyone', async () => {
    await expect(razorpayGateway({ ...keys('razorpay'), keyId: 'rzp_test_x', live: true }).checkCredentials()).rejects.toThrow(/test keys/);
  });
});
