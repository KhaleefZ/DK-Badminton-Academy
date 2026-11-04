import { eq } from 'drizzle-orm';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { db } from '../src/db/client.js';
import { bookings, courts, customers, enquiries, payments } from '../src/db/schema.js';
import { addDays, instantAt, venueToday } from '../src/lib/time.js';
import { createReservation } from '../src/schedule/reservations.js';
import { addStaff, ORIGIN, signIn, testApp } from './helpers.js';

const WEBSITE = 'http://localhost:5173';
const { app } = testApp();
const FUTURE = addDays(venueToday(), 3);
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

let owner: string;
let court1: string;
let court2: string;

const admin = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string) => request(app)[method](path).set('Origin', ORIGIN).set('Cookie', owner);
const site = (method: 'get' | 'post', path: string) => request(app)[method](`/public${path}`).set('Origin', WEBSITE);
const guest = { name: 'Asha Raman', phone: '+91 98765 43210', email: 'Asha@Example.com' };
const hold = (over = {}) => site('post', '/bookings').send({ courtId: court1, date: FUTURE, start: '06:00', ...guest, ...over });
const slots = async (date = FUTURE, id = court1) => (await site('get', `/availability?date=${date}`).expect(200)).body.courts.find((c: { id: string }) => c.id === id).slots;
const pay = (token: string, result = 'success') => site('post', `/bookings/${token}/pay`).send({ result });
const expire = () => db.update(bookings).set({ holdExpiresAt: new Date(Date.now() - 1000) }).where(eq(bookings.status, 'pending_payment'));
const enquiry = (over = {}) => ({ name: 'Bala', email: 'bala@example.com', message: 'Do you have evening slots?', consent: true, ...over });

beforeEach(async () => {
  owner = await signIn(app, (await addStaff({ role: 'owner' })).email);
  const rows = await db.select().from(courts).orderBy(courts.sortOrder);
  court1 = rows[0]!.id;
  court2 = rows[1]!.id;
  await admin('put', '/settings/hours').send({ hours: ALL_DAYS.map((weekday) => ({ weekday, opens: '06:00', closes: '10:00' })) }).expect(200);
  await admin('put', '/settings/prices').send({ rules: [{ courtId: null, days: ALL_DAYS, start: '00:00', end: '24:00', ratePaise: 50000 }] }).expect(200);
});

describe('who can call what', () => {
  it('needs no login but only accepts writes from the website', async () => {
    await request(app).get(`/public/availability?date=${FUTURE}`).expect(200);
    await request(app).post('/public/enquiries').set('Origin', 'https://evil.example').send(enquiry()).expect(403);
    await request(app).post('/public/enquiries').send(enquiry()).expect(403);
  });

  it('keeps the website origin off every staff route', async () => {
    const res = await request(app).post('/customers').set('Origin', WEBSITE).set('Cookie', owner).send({ name: 'x', phone: '9876543210' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('UNTRUSTED_ORIGIN');
    const read = await request(app).get('/customers').set('Origin', WEBSITE);
    expect(read.get('Access-Control-Allow-Origin')).not.toBe(WEBSITE);
  });

  it('allows the website origin, without credentials, on public routes only', async () => {
    const res = await site('get', `/availability?date=${FUTURE}`);
    expect(res.get('Access-Control-Allow-Origin')).toBe(WEBSITE);
    expect(res.get('Access-Control-Allow-Credentials')).toBeUndefined();
    await site('get', '/nothing').expect(404);
  });

  it('limits how many requests a network can send', async () => {
    const limited = createApp({ publicWriteLimitPerWindow: 2, mailer: { send: async () => {} } });
    const post = () => request(limited).post('/public/enquiries').set('Origin', WEBSITE).send(enquiry());
    await post().expect(201);
    await post().expect(201);
    await post().expect(429);
  });
});

describe('public availability', () => {
  it('shows free slots with a price', async () => {
    const [slot] = await slots();
    expect(slot).toEqual({ start: '06:00', end: '07:00', pricePaise: 50000, available: true });
  });

  it('never says why a slot is taken', async () => {
    await createReservation({ courtId: court1, kind: 'member_block', note: 'Secret batch', startsAt: instantAt(FUTURE, 360), endsAt: instantAt(FUTURE, 420) });
    const res = await site('get', `/availability?date=${FUTURE}`).expect(200);
    expect(JSON.stringify(res.body)).not.toMatch(/Secret|member_block|reservation/);
    expect(res.body.courts[0].slots[0].available).toBe(false);
  });

  it('marks slots outside the booking window, or without a price, unavailable', async () => {
    expect((await slots(addDays(venueToday(), 30)))[0].available).toBe(false);
    await admin('put', '/settings/prices').send({ rules: [] }).expect(200);
    expect((await slots())[0].available).toBe(false);
  });

  it('rejects a bad date', async () => {
    await site('get', '/availability?date=nope').expect(400);
  });
});

describe('holding a slot', () => {
  it('holds the slot, gives a private link and creates a WEB customer', async () => {
    const res = await hold().expect(201);
    expect(res.body.token.length).toBeGreaterThan(30);
    expect(res.body.booking).toMatchObject({ status: 'pending_payment', amountPaise: 50000, courtName: 'Court 1', start: '06:00', end: '07:00', name: 'Asha Raman' });
    expect((await slots())[0].available).toBe(false);
    const [customer] = await db.select().from(customers);
    expect(customer).toMatchObject({ type: 'website', phone: '9876543210', email: 'asha@example.com' });
    expect(customer!.customerNo).toMatch(/^WEB-\d{4}$/);
    const [row] = await db.select().from(bookings);
    expect(row!.accessTokenHash).not.toBe(res.body.token);
  });

  it('ignores any price the browser sends', async () => {
    const res = await hold({ amountPaise: 1, pricePaise: 1 }).expect(201);
    expect(res.body.booking.amountPaise).toBe(50000);
  });

  it('reuses a returning customer, and adds a new one for different details', async () => {
    await hold().expect(201);
    await hold({ start: '07:00', phone: '98765-43210', email: 'asha@example.com' }).expect(201);
    expect(await db.select().from(customers)).toHaveLength(1);
    await hold({ start: '08:00', email: 'other@example.com' }).expect(201);
    expect(await db.select().from(customers)).toHaveLength(2);
  });

  it('lets exactly one of many simultaneous requests win', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => hold({ email: `g${i}@example.com` })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(7);
  });

  it('stops one person holding too many slots', async () => {
    await hold({ start: '06:00' }).expect(201);
    await hold({ start: '07:00' }).expect(201);
    const res = await hold({ start: '08:00' }).expect(409);
    expect(res.body.error.code).toBe('TOO_MANY_HOLDS');
    expect((await slots())[2].available).toBe(true);
  });

  it.each([[{ name: ' ' }], [{ phone: '12345' }], [{ email: 'nope' }], [{ date: '2026-02-30' }], [{ courtId: 'x' }], [{ website: 'http://spam' }]])('refuses %j', async (over) => {
    await hold(over).expect(400);
  });

  it('refuses a slot that doesn’t exist or can’t be booked online', async () => {
    await hold({ start: '06:30' }).expect(409);
    await hold({ start: '05:00' }).expect(409);
    await hold({ date: addDays(venueToday(), 30) }).expect(409);
    await hold({ courtId: crypto.randomUUID() }).expect(409);
    await admin('post', `/settings/closures`).send({ courtId: court2, startsAt: instantAt(FUTURE, 360).toISOString(), endsAt: instantAt(FUTURE, 420).toISOString() }).expect(201);
    await hold({ courtId: court2 }).expect(409);
  });
});

describe('private link', () => {
  it('shows the booking without contact details, and nothing for a wrong link', async () => {
    const { body } = await hold().expect(201);
    const res = await site('get', `/bookings/${body.token}`).expect(200);
    expect(res.body.booking.bookingNo).toBe(body.booking.bookingNo);
    expect(JSON.stringify(res.body)).not.toMatch(/9876543210|asha@example|accessToken/);
    await site('get', '/bookings/wrong-token').expect(404);
    await pay('wrong-token').expect(404);
  });
});

describe('test payment', () => {
  it('confirms the booking and records a clearly marked receipt', async () => {
    const { body } = await hold().expect(201);
    const res = await pay(body.token).expect(200);
    expect(res.body.booking).toMatchObject({ status: 'active', holdExpiresAt: null });
    const [receipt] = await db.select().from(payments);
    expect(receipt).toMatchObject({ method: 'online_test', amountPaise: 50000, reference: 'Test mode' });
  });

  it('counts a double click once', async () => {
    const { body } = await hold().expect(201);
    await Promise.all([pay(body.token), pay(body.token), pay(body.token)]);
    await pay(body.token).expect(200);
    expect(await db.select().from(payments)).toHaveLength(1);
  });

  it('keeps the hold after a failure, so the customer can retry', async () => {
    const { body } = await hold().expect(201);
    const res = await pay(body.token, 'failure').expect(402);
    expect(res.body.error.code).toBe('PAYMENT_FAILED');
    expect(await db.select().from(payments)).toHaveLength(0);
    await pay(body.token).expect(200);
  });

  it('refuses payment after the hold runs out, and frees the slot', async () => {
    const { body } = await hold().expect(201);
    await expire();
    const res = await pay(body.token).expect(410);
    expect(res.body.error.code).toBe('HOLD_EXPIRED');
    expect((await site('get', `/bookings/${body.token}`).expect(200)).body.booking.status).toBe('expired');
    expect((await slots())[0].available).toBe(true);
    await hold({ email: 'next@example.com' }).expect(201);
    await pay(body.token).expect(410);
    expect(await db.select().from(payments)).toHaveLength(0);
  });

  it('lets the customer release their hold', async () => {
    const { body } = await hold().expect(201);
    await site('post', `/bookings/${body.token}/release`).expect(200);
    expect((await slots())[0].available).toBe(true);
    await site('post', `/bookings/${body.token}/release`).expect(409);
    await pay(body.token).expect(410);
  });

  it('confirms a free slot without a receipt', async () => {
    await admin('put', '/settings/prices').send({ rules: [{ courtId: null, days: ALL_DAYS, start: '00:00', end: '24:00', ratePaise: 0 }] }).expect(200);
    const { body } = await hold().expect(201);
    await pay(body.token).expect(200);
    expect(await db.select().from(payments)).toHaveLength(0);
  });
});

describe('in the admin panel', () => {
  it('shows a hold on the schedule and table, then the paid booking', async () => {
    const { body } = await hold().expect(201);
    const day = (await admin('get', `/schedule?date=${FUTURE}`).expect(200)).body;
    expect(day.courts[0].slots[0].status).toBe('reserved');
    expect(day.bookings[0]).toMatchObject({ status: 'pending_payment', paymentState: 'Held', outstandingPaise: 0, source: 'website' });
    expect((await admin('get', '/bookings?payment=Due')).body.bookings).toEqual([]);

    await pay(body.token).expect(200);
    const [paid] = (await admin('get', `/bookings?date=${FUTURE}`)).body.bookings;
    expect(paid).toMatchObject({ status: 'active', paymentState: 'Paid', paidPaise: 50000 });
    expect(paid.customer.customerNo).toMatch(/^WEB-/);
    expect((await admin('get', '/payments?method=online_test')).body.payments).toHaveLength(1);
  });

  it('won’t let staff edit, pay against or restore a hold or expired booking', async () => {
    await hold().expect(201);
    const [held] = (await admin('get', `/bookings?date=${FUTURE}`)).body.bookings;
    const slot = { courtId: court1, date: FUTURE, start: '06:00', end: '07:00' };
    await admin('patch', `/bookings/${held.id}`).send(slot).expect(400);
    await admin('post', `/bookings/${held.id}/payments`).send({ amountPaise: 100, method: 'cash' }).expect(400);
    await admin('post', `/bookings/${held.id}/restore`).expect(400);
    await expire();
    const [gone] = (await admin('get', `/bookings?date=${FUTURE}`)).body.bookings;
    expect(gone).toMatchObject({ status: 'expired', paymentState: 'Expired', session: 'Cancelled', outstandingPaise: 0 });
    await admin('post', `/bookings/${held.id}/restore`).expect(400);
    await admin('post', `/bookings/${held.id}/cancel`).send({}).expect(400);
  });

  it('lets staff cancel a hold, which frees the slot and stops payment', async () => {
    const { body } = await hold().expect(201);
    const [held] = (await admin('get', `/bookings?date=${FUTURE}`)).body.bookings;
    await admin('post', `/bookings/${held.id}/cancel`).send({ reason: 'Phone request' }).expect(200);
    expect((await slots())[0].available).toBe(true);
    await pay(body.token).expect(410);
  });

  it('lets a staff booking take the slot of an expired hold', async () => {
    await hold().expect(201);
    await expire();
    const customer = (await admin('post', '/customers').send({ name: 'Desk', phone: '98765 00000' }).expect(201)).body.customer;
    await admin('post', '/bookings').send({ courtId: court1, date: FUTURE, start: '06:00', end: '07:00', customerId: customer.id }).expect(201);
  });

  it('saves the hold length, and uses it', async () => {
    await admin('patch', '/settings').send({ venueName: 'DK', slotMinutes: 60, advanceBookingDays: 7, minNoticeMinutes: 60, holdMinutes: 15 }).expect(200);
    await admin('patch', '/settings').send({ venueName: 'DK', slotMinutes: 60, advanceBookingDays: 7, minNoticeMinutes: 60, holdMinutes: 1 }).expect(400);
    const { body } = await hold().expect(201);
    const minutes = (new Date(body.booking.holdExpiresAt).getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThanOrEqual(15);
  });
});

describe('enquiries', () => {
  it('stores an enquiry, numbered, for staff to find and handle', async () => {
    const res = await site('post', '/enquiries').send(enquiry({ phone: '98765 43210', topic: 'regular-play', preferred: 'Evenings' })).expect(201);
    expect(res.body.enquiryNo).toMatch(/^ENQ-\d{5}$/);
    const [row] = await db.select().from(enquiries);
    expect(row).toMatchObject({ phone: '9876543210', topic: 'regular-play', preferred: 'Evenings', status: 'new' });

    const list = (await admin('get', '/enquiries?status=new').expect(200)).body.enquiries;
    expect(list).toHaveLength(1);
    expect((await admin('get', '/enquiries?q=evening').expect(200)).body.enquiries).toHaveLength(1);
    expect((await admin('get', '/search?q=bala').expect(200)).body.enquiries[0].enquiryNo).toBe(res.body.enquiryNo);

    await admin('patch', `/enquiries/${row!.id}`).send({ status: 'handled', notes: 'Called back' }).expect(200);
    expect((await admin('get', '/enquiries?status=new')).body.enquiries).toEqual([]);
    await admin('delete', `/enquiries/${row!.id}`).expect(204);
    await admin('delete', `/enquiries/${row!.id}`).expect(404);
  });

  it.each([[{ name: '' }], [{ email: 'x' }], [{ phone: '123' }], [{ message: ' ' }], [{ consent: false }], [{ website: 'spam' }]])('refuses %j', async (over) => {
    await site('post', '/enquiries').send(enquiry(over)).expect(400);
    expect(await db.select().from(enquiries)).toEqual([]);
  });

  it('is staff-only to read', async () => {
    await request(app).get('/enquiries').expect(401);
  });
});

describe('production safety', () => {
  it('won’t start in production with test payments on', async () => {
    const original = { NODE_ENV: process.env.NODE_ENV };
    process.env.NODE_ENV = 'production';
        process.env.PAYMENT_TEST_MODE = 'true';
    try {
      vi.resetModules();
      await expect(import('../src/config.js')).rejects.toThrow(/PAYMENT_TEST_MODE/);
    } finally {
      Object.assign(process.env, original);
    }
  });
});
