import { eq } from 'drizzle-orm';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/client.js';
import { auditLog, courtReservations, courts, customers } from '../src/db/schema.js';
import { addDays, instantAt, venueToday } from '../src/lib/time.js';
import { addStaff, ORIGIN, signIn, testApp } from './helpers.js';

const { app } = testApp();
const FUTURE = addDays(venueToday(), 3);
const PAST = addDays(venueToday(), -3);
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

let owner: string;
let desk: string;
let manager: string;
let court1: string;
let court2: string;

const call = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, cookie = owner) => request(app)[method](path).set('Origin', ORIGIN).set('Cookie', cookie);
const person = { name: 'Asha Raman', phone: '98765 43210', email: 'Asha@Example.com' };
const addCustomer = async (over = {}) => (await call('post', '/customers').send({ ...person, ...over }).expect(201)).body.customer;
const slot = (over = {}) => ({ courtId: court1, date: FUTURE, start: '06:00', end: '07:00', ...over });
const book = async (over = {}) => {
  const customer = await addCustomer();
  return (await call('post', '/bookings').send({ ...slot(), customerId: customer.id, ...over }).expect(201)).body.booking;
};

beforeEach(async () => {
  owner = await signIn(app, (await addStaff({ role: 'owner' })).email);
  desk = await signIn(app, (await addStaff({ role: 'front_desk' })).email);
  manager = await signIn(app, (await addStaff({ role: 'manager' })).email);
  const rows = await db.select().from(courts).orderBy(courts.sortOrder);
  court1 = rows[0]!.id;
  court2 = rows[1]!.id;
  await call('put', '/settings/hours').send({ hours: ALL_DAYS.map((weekday) => ({ weekday, opens: '06:00', closes: '22:00' })) }).expect(200);
  await call('put', '/settings/prices').send({ rules: [{ courtId: null, days: ALL_DAYS, start: '00:00', end: '24:00', ratePaise: 50000 }] }).expect(200);
});

describe('access', () => {
  it('needs a session everywhere', async () => {
    for (const path of ['/customers', '/bookings', '/payments', `/blocks?date=${FUTURE}`, `/schedule?date=${FUTURE}`, '/search?q=a', `/reports?from=${FUTURE}&to=${FUTURE}`]) {
      await request(app).get(path).expect(401);
    }
  });

  it('keeps money totals and voids from the front desk, but lets them record payments', async () => {
    await call('get', '/payments', desk).expect(403);
    await call('get', `/reports?from=${FUTURE}&to=${FUTURE}`, desk).expect(403);
    const booking = await book();
    const { body } = await call('post', `/bookings/${booking.id}/payments`, desk).send({ amountPaise: 50000, method: 'cash' }).expect(201);
    await call('post', `/payments/${body.payment.id}/void`, desk).send({ reason: 'x' }).expect(403);
    await call('post', `/payments/${body.payment.id}/void`, manager).send({ reason: 'Typed wrong' }).expect(200);
  });
});

describe('customers', () => {
  it('numbers walk-ins in order and never reuses a number', async () => {
    const first = await addCustomer();
    const second = await addCustomer({ name: 'Second' });
    const n = Number(first.customerNo.slice(4));
    expect(first.customerNo).toMatch(/^WLK-\d{4}$/);
    expect(second.customerNo).toBe(`WLK-${String(n + 1).padStart(4, '0')}`);
    expect(first.email).toBe('asha@example.com');
    await call('delete', `/customers/${second.id}`).expect(204);
    expect((await addCustomer()).customerNo).toBe(`WLK-${String(n + 2).padStart(4, '0')}`);
  });

  it('keeps numbers unique past their usual width', async () => {
    const { rows } = await pool.query(`SELECT dk_number('WLK-', 7, 4) AS small, dk_number('WLK-', 12345, 4) AS large`);
    expect(rows[0]).toEqual({ small: 'WLK-0007', large: 'WLK-12345' });
  });

  it.each([[{ name: ' ' }], [{ phone: 'abc' }], [{ phone: '' }], [{ email: 'nope' }]])('refuses %j', async (over) => {
    await call('post', '/customers').send({ ...person, ...over }).expect(400);
  });

  it('finds by name, number, email, notes and phone however it’s spaced', async () => {
    const asha = await addCustomer({ notes: 'Prefers court near door' });
    await addCustomer({ name: 'Other', phone: '91111 22222', email: '' });
    const find = async (q: string) => (await call('get', `/customers?q=${encodeURIComponent(q)}`).expect(200)).body.customers.map((c: { id: string }) => c.id);
    for (const q of ['asha', asha.customerNo, 'example.com', 'near door', '9876543210', '43210']) expect(await find(q)).toEqual([asha.id]);
    expect(await find('100%')).toEqual([]);
    expect(await find('_')).toEqual([]);
  });

  it('filters website and walk-in customers separately', async () => {
    await addCustomer();
    await db.insert(customers).values({ customerNo: 'WEB-0001', type: 'website', name: 'Online person', phone: '90000 00000' });
    const list = (type: string) => call('get', `/customers?type=${type}`).expect(200);
    expect((await list('website')).body.customers.map((c: { customerNo: string }) => c.customerNo)).toEqual(['WEB-0001']);
    expect((await list('walk_in')).body.customers).toHaveLength(1);
  });

  it('edits, and shows dues and bookings on a customer', async () => {
    const booking = await book();
    const id = booking.customer.id;
    await call('patch', `/customers/${id}`).send({ ...person, name: 'Asha R' }).expect(200);
    const { body } = await call('get', `/customers/${id}`).expect(200);
    expect(body.customer.name).toBe('Asha R');
    expect(body.bookings).toHaveLength(1);
    const list = (await call('get', '/customers').expect(200)).body.customers.find((c: { id: string }) => c.id === id);
    expect(list).toMatchObject({ duePaise: 50000, bookingCount: 1 });
  });

  it('won’t delete a customer with an upcoming booking; trash and restore otherwise', async () => {
    const booking = await book();
    const id = booking.customer.id;
    const blocked = await call('delete', `/customers/${id}`).expect(409);
    expect(blocked.body.error.code).toBe('CUSTOMER_HAS_BOOKINGS');
    await call('post', `/bookings/${booking.id}/cancel`).send({}).expect(200);
    await call('delete', `/customers/${id}`).expect(204);
    expect((await call('get', '/customers')).body.customers).toEqual([]);
    expect((await call('get', '/customers?trash=true')).body.customers).toHaveLength(1);
    await call('post', '/bookings').send({ ...slot(), customerId: id }).expect(400);
    await call('post', `/customers/${id}/restore`).expect(200);
    expect((await call('get', '/customers')).body.customers).toHaveLength(1);
  });
});

describe('bookings', () => {
  it('books with an existing customer at the set price, recording who did it', async () => {
    const booking = await book();
    expect(booking).toMatchObject({ status: 'active', amountPaise: 50000, paidPaise: 0, outstandingPaise: 50000, paymentState: 'Due', session: 'Upcoming', courtName: 'Court 1', date: FUTURE, start: '06:00', end: '07:00' });
    expect(booking.bookingNo).toMatch(/^BKG-\d{5}$/);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, 'booking.created'))).toHaveLength(1);
  });

  it('creates a new customer in the same step, and leaves none behind if the slot is taken', async () => {
    const { body } = await call('post', '/bookings').send({ ...slot(), newCustomer: person }).expect(201);
    expect(body.booking.customer.customerNo).toMatch(/^WLK-/);
    const clash = await call('post', '/bookings').send({ ...slot(), newCustomer: { ...person, name: 'Ghost' } }).expect(409);
    expect(clash.body.error.code).toBe('SLOT_TAKEN');
    const all = await db.select().from(customers);
    expect(all.map((c) => c.name)).toEqual(['Asha Raman']);
  });

  it('allows a staff price, including free, and quotes the usual one', async () => {
    expect((await book({ amountPaise: 0 })).paymentState).toBe('Paid');
    const q = await call('get', `/bookings/quote?courtId=${court2}&date=${FUTURE}&start=06:00&end=07:30`).expect(200);
    expect(q.body.pricePaise).toBe(75000);
  });

  it('needs an amount when no price is set', async () => {
    await call('put', '/settings/prices').send({ rules: [] }).expect(200);
    const customer = await addCustomer();
    const res = await call('post', '/bookings').send({ ...slot(), customerId: customer.id }).expect(400);
    expect(res.body.error.code).toBe('NO_PRICE');
    await call('post', '/bookings').send({ ...slot(), customerId: customer.id, amountPaise: 30000 }).expect(201);
  });

  it('refuses times outside hours, on a closure, or with bad input', async () => {
    const customer = await addCustomer();
    const post = (over: object) => call('post', '/bookings').send({ ...slot(), customerId: customer.id, ...over });
    expect((await post({ start: '05:00', end: '06:30' }).expect(409)).body.error.code).toBe('OUTSIDE_HOURS');
    await post({ start: '21:00', end: '23:00' }).expect(409);
    await post({ start: '07:00', end: '07:00' }).expect(400);
    await post({ date: '2026-02-30' }).expect(400);
    await post({ courtId: 'nope' }).expect(400);
    await post({ customerId: undefined }).expect(400);
    await post({ amountPaise: -1 }).expect(400);
    await call('post', '/settings/closures').send({ courtId: court1, startsAt: instantAt(FUTURE, 360).toISOString(), endsAt: instantAt(FUTURE, 420).toISOString() }).expect(201);
    expect((await post({}).expect(409)).body.error.code).toBe('COURT_CLOSED');
    await post({ courtId: court2 }).expect(201);
  });

  it('records a walk-in that already happened', async () => {
    expect((await book({ date: PAST })).session).toBe('Completed');
  });

  it('lets exactly one of many simultaneous bookings win', async () => {
    const customer = await addCustomer();
    const results = await Promise.all(Array.from({ length: 8 }, () => call('post', '/bookings').send({ ...slot(), customerId: customer.id })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(7);
  });

  it('moves court and time, refusing clashes and leaving the booking unchanged', async () => {
    const booking = await book();
    await book({ start: '08:00', end: '09:00' });
    const moved = await call('patch', `/bookings/${booking.id}`).send({ ...slot(), courtId: court2, start: '10:00', end: '11:00', amountPaise: 45000, notes: 'Moved' }).expect(200);
    expect(moved.body.booking).toMatchObject({ courtName: 'Court 2', start: '10:00', amountPaise: 45000, notes: 'Moved' });

    const refused = await call('patch', `/bookings/${booking.id}`).send({ ...slot(), start: '08:00', end: '09:00', notes: 'Never saved' }).expect(409);
    expect(refused.body.error.code).toBe('SLOT_TAKEN');
    const { body } = await call('get', `/bookings/${booking.bookingNo}`).expect(200);
    expect(body.booking).toMatchObject({ courtName: 'Court 2', start: '10:00', notes: 'Moved' });

    // The old time was freed.
    await book();
  });

  it('keeps a booking editable after the hours change, as long as its time doesn’t', async () => {
    const booking = await book();
    await call('put', '/settings/hours').send({ hours: [] }).expect(200);
    await call('patch', `/bookings/${booking.id}`).send({ ...slot(), notes: 'Just a note' }).expect(200);
    await call('patch', `/bookings/${booking.id}`).send({ ...slot(), start: '07:00', end: '08:00' }).expect(409);
  });

  it('cancels, frees the slot, and restores only if it’s still free', async () => {
    const booking = await book();
    const cancelled = await call('post', `/bookings/${booking.id}/cancel`).send({ reason: 'Rain' }).expect(200);
    expect(cancelled.body.booking).toMatchObject({ status: 'cancelled', cancelReason: 'Rain', outstandingPaise: 0, paymentState: 'Cancelled', session: 'Cancelled' });
    await call('post', `/bookings/${booking.id}/cancel`).send({}).expect(400);
    await call('patch', `/bookings/${booking.id}`).send(slot()).expect(400);

    const taker = await book();
    const refused = await call('post', `/bookings/${booking.id}/restore`).expect(409);
    expect(refused.body.error.code).toBe('SLOT_TAKEN');
    await call('post', `/bookings/${taker.id}/cancel`).send({}).expect(200);
    const back = await call('post', `/bookings/${booking.id}/restore`).expect(200);
    expect(back.body.booking).toMatchObject({ status: 'active', cancelReason: null, outstandingPaise: 50000 });
  });

  it('lists by date on the venue’s clock, by search, and by dues', async () => {
    const early = await book({ start: '06:00', end: '07:00', date: FUTURE });
    await call('put', '/settings/hours').send({ hours: ALL_DAYS.map((weekday) => ({ weekday, opens: '00:00', closes: '24:00' })) }).expect(200);
    const midnight = await book({ start: '00:00', end: '01:00', date: addDays(FUTURE, 1) });
    const dayEnd = await book({ start: '23:00', end: '24:00', date: FUTURE });
    expect(dayEnd.end).toBe('24:00');
    const onDay = (await call('get', `/bookings?date=${FUTURE}`).expect(200)).body.bookings.map((b: { id: string }) => b.id);
    expect(onDay).toEqual([early.id, dayEnd.id]);
    expect((await call('get', `/bookings?q=${early.bookingNo}`)).body.bookings).toHaveLength(1);

    await call('post', `/bookings/${midnight.id}/payments`).send({ amountPaise: midnight.amountPaise, method: 'upi' }).expect(201);
    const dues = (await call('get', '/bookings?payment=Due')).body.bookings.map((b: { id: string }) => b.id);
    expect(dues).toEqual([early.id, dayEnd.id]);
    await call('get', '/bookings?date=nope').expect(400);
    await call('get', '/bookings/BKG-99999').expect(404);
  });
});

describe('payments', () => {
  it('takes part payments until settled, with separate receipts', async () => {
    const booking = await book();
    const first = await call('post', `/bookings/${booking.id}/payments`).send({ amountPaise: 20000, method: 'cash' }).expect(201);
    expect(first.body.payment.receiptNo).toMatch(/^RCP-\d{5}$/);
    expect(first.body.booking).toMatchObject({ paidPaise: 20000, outstandingPaise: 30000, paymentState: 'Due' });
    const second = await call('post', `/bookings/${booking.id}/payments`).send({ amountPaise: 30000, method: 'upi', reference: 'UTR123' }).expect(201);
    expect(second.body.booking.paymentState).toBe('Paid');
    const { body } = await call('get', `/bookings/${booking.id}`).expect(200);
    expect(body.payments).toHaveLength(2);
  });

  it('refuses overpayment, bad amounts and methods, and cancelled bookings', async () => {
    const booking = await book();
    const pay = (b: object) => call('post', `/bookings/${booking.id}/payments`).send(b);
    expect((await pay({ amountPaise: 50001, method: 'cash' }).expect(409)).body.error.code).toBe('OVERPAYMENT');
    await pay({ amountPaise: 0, method: 'cash' }).expect(400);
    await pay({ amountPaise: 1.5, method: 'cash' }).expect(400);
    await pay({ amountPaise: 100, method: 'card' }).expect(400);
    await call('post', `/bookings/${booking.id}/cancel`).send({}).expect(200);
    await pay({ amountPaise: 100, method: 'cash' }).expect(400);
  });

  it('never over-collects when two people record at once', async () => {
    const booking = await book();
    const results = await Promise.all(Array.from({ length: 6 }, () => call('post', `/bookings/${booking.id}/payments`).send({ amountPaise: 50000, method: 'cash' })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
  });

  it('voids with a reason, reopening the balance, once only', async () => {
    const booking = await book();
    const { body } = await call('post', `/bookings/${booking.id}/payments`).send({ amountPaise: 50000, method: 'cash' }).expect(201);
    await call('post', `/payments/${body.payment.id}/void`).send({ reason: ' ' }).expect(400);
    await call('post', `/payments/${body.payment.id}/void`).send({ reason: 'Wrong booking' }).expect(200);
    await call('post', `/payments/${body.payment.id}/void`).send({ reason: 'Again' }).expect(400);
    const after = await call('get', `/bookings/${booking.id}`).expect(200);
    expect(after.body.booking).toMatchObject({ paidPaise: 0, outstandingPaise: 50000 });
    expect(after.body.payments[0].voidReason).toBe('Wrong booking');
  });

  it('won’t lower a booking below what’s been paid', async () => {
    const booking = await book();
    await call('post', `/bookings/${booking.id}/payments`).send({ amountPaise: 40000, method: 'cash' }).expect(201);
    const res = await call('patch', `/bookings/${booking.id}`).send({ ...slot(), amountPaise: 30000 }).expect(400);
    expect(res.body.error.code).toBe('BELOW_PAID');
    await call('patch', `/bookings/${booking.id}`).send({ ...slot(), amountPaise: 40000 }).expect(200);
  });

  it('keeps money visible on a cancelled booking, since refund rules aren’t set', async () => {
    const booking = await book();
    await call('post', `/bookings/${booking.id}/payments`).send({ amountPaise: 50000, method: 'upi' }).expect(201);
    const { body } = await call('post', `/bookings/${booking.id}/cancel`).send({}).expect(200);
    expect(body.booking).toMatchObject({ paidOnCancelledPaise: 50000, outstandingPaise: 0 });
  });

  it('lists by date, method and search', async () => {
    const booking = await book();
    const { body } = await call('post', `/bookings/${booking.id}/payments`).send({ amountPaise: 1000, method: 'upi' }).expect(201);
    const list = async (q: string) => (await call('get', `/payments?${q}`).expect(200)).body.payments;
    const today = venueToday();
    expect(await list(`date=${today}`)).toHaveLength(1);
    expect(await list(`date=${addDays(today, 1)}`)).toHaveLength(0);
    expect(await list('method=cash')).toHaveLength(0);
    expect((await list('q=asha'))[0]).toMatchObject({ receiptNo: body.payment.receiptNo, customerName: 'Asha Raman', bookingNo: booking.bookingNo });
  });
});

describe('blocks', () => {
  const block = (over = {}) => ({ ...slot(), kind: 'member_block', note: 'Morning batch', ...over });

  it('blocks a court, shows on the schedule, and can be edited and removed', async () => {
    const { body } = await call('post', '/blocks').send(block()).expect(201);
    expect(body.created).toBe(1);
    const day = (await call('get', `/schedule?date=${FUTURE}`).expect(200)).body;
    const slots = day.courts.find((c: { id: string }) => c.id === court1).slots;
    expect(slots[0]).toMatchObject({ status: 'reserved', reservationKind: 'member_block', onlineBookable: false });
    const [held] = day.blocks;
    expect(held).toMatchObject({ note: 'Morning batch', courtName: 'Court 1', start: '06:00', end: '07:00' });
    expect(slots[0].reservationId).toBe(held.id);

    await call('patch', `/blocks/${held.id}`).send(block({ start: '07:00', end: '08:00', note: 'Moved', kind: 'staff_block' })).expect(200);
    const [moved] = (await call('get', `/blocks?date=${FUTURE}`).expect(200)).body.blocks;
    expect(moved).toMatchObject({ start: '07:00', kind: 'staff_block', note: 'Moved' });

    await call('delete', `/blocks/${held.id}`).expect(204);
    await call('delete', `/blocks/${held.id}`).expect(404);
    expect((await call('get', `/blocks?date=${FUTURE}`)).body.blocks).toEqual([]);
    await book();
  });

  it('stops bookings, and is stopped by them', async () => {
    await call('post', '/blocks').send(block()).expect(201);
    const customer = await addCustomer();
    expect((await call('post', '/bookings').send({ ...slot(), customerId: customer.id }).expect(409)).body.error.code).toBe('SLOT_TAKEN');
    await book({ start: '08:00', end: '09:00' });
    await call('post', '/blocks').send(block({ start: '08:00', end: '09:00' })).expect(409);
  });

  it('repeats weekly, all or nothing', async () => {
    await book({ date: addDays(FUTURE, 14) });
    await call('post', '/blocks').send(block({ repeatWeeks: 3 })).expect(409);
    expect(await db.select().from(courtReservations).where(eq(courtReservations.kind, 'member_block'))).toHaveLength(0);
    const { body } = await call('post', '/blocks').send(block({ repeatWeeks: 3, start: '07:00', end: '08:00' })).expect(201);
    expect(body.created).toBe(3);
    expect((await call('get', `/blocks?date=${addDays(FUTURE, 14)}`)).body.blocks).toHaveLength(1);
    await call('post', '/blocks').send(block({ repeatWeeks: 27, start: '09:00', end: '10:00' })).expect(400);
  });

  it('needs a label and a known purpose, and can’t touch a booking', async () => {
    await call('post', '/blocks').send(block({ note: ' ' })).expect(400);
    await call('post', '/blocks').send(block({ kind: 'booking' })).expect(400);
    const booking = await book();
    await call('delete', `/blocks/${booking.reservationId}`).expect(404);
  });
});

describe('search and schedule', () => {
  it('finds customers, bookings and (for those allowed) receipts', async () => {
    const booking = await book();
    const { body: pay } = await call('post', `/bookings/${booking.id}/payments`).send({ amountPaise: 100, method: 'cash' }).expect(201);
    const byName = (await call('get', '/search?q=asha').expect(200)).body;
    expect(byName.customers).toHaveLength(1);
    expect(byName.bookings[0].bookingNo).toBe(booking.bookingNo);
    const receipt = (await call('get', `/search?q=${pay.payment.receiptNo}`).expect(200)).body;
    expect(receipt.receipts[0].bookingNo).toBe(booking.bookingNo);
    expect((await call('get', `/search?q=${pay.payment.receiptNo}`, desk).expect(200)).body.receipts).toEqual([]);
    expect((await call('get', '/search?q=').expect(200)).body.customers).toEqual([]);
  });

  it('links a booked slot to its booking, and hides cancelled ones from slots', async () => {
    const booking = await book();
    const day = async () => (await call('get', `/schedule?date=${FUTURE}`).expect(200)).body;
    const first = await day();
    expect(first.courts[0].slots[0].reservationId).toBe(booking.reservationId);
    expect(first.bookings[0].id).toBe(booking.id);
    await call('post', `/bookings/${booking.id}/cancel`).send({}).expect(200);
    const second = await day();
    expect(second.courts[0].slots[0].status).toBe('free');
    expect(second.bookings[0].status).toBe('cancelled');
  });
});

describe('reports', () => {
  it('totals by week, counting real money and open hours', async () => {
    const paid = await book();
    await book({ start: '07:00', end: '09:00', amountPaise: 90000 });
    const cancelled = await book({ start: '10:00', end: '11:00' });
    await call('post', `/bookings/${cancelled.id}/cancel`).send({}).expect(200);
    await call('post', `/bookings/${paid.id}/payments`).send({ amountPaise: 50000, method: 'cash' }).expect(201);
    const today = venueToday();
    const { body } = await call('get', `/reports?from=${today}&to=${addDays(today, 6)}`).expect(200);
    expect(body.periods).toHaveLength(1);
    expect(body.periods[0]).toMatchObject({ bookings: 2, billedPaise: 140000, receivedPaise: 50000, bookedMinutes: 180, openMinutes: 7 * 16 * 60 * 2 });
    const one = (await call('get', `/reports?from=${today}&to=${addDays(today, 6)}&courtId=${court2}`).expect(200)).body.periods[0];
    expect(one).toMatchObject({ bookings: 0, openMinutes: 7 * 16 * 60 });
    expect((await call('get', `/reports?from=${today}&to=${addDays(today, 7)}`)).body.periods).toHaveLength(2);
    await call('get', `/reports?from=${today}&to=${addDays(today, -1)}`).expect(400);
    await call('get', `/reports?from=${today}&to=${addDays(today, 400)}`).expect(400);
  });
});
