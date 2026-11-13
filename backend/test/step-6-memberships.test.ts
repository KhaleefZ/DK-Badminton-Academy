import { eq } from 'drizzle-orm';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/client.js';
import { courtReservations, courts, memberships, messages, payments } from '../src/db/schema.js';
import { addDays, monthEnd, venueToday } from '../src/lib/time.js';
import { membershipLink } from '../src/messages/links.js';
import { processMessages } from '../src/messages/queue.js';
import { addStaff, ORIGIN, signIn, testApp } from './helpers.js';

const WEBSITE = 'http://localhost:5173';
const { app } = testApp();
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const TODAY = venueToday();
const START = addDays(TODAY, 1);
const LATE = addDays(TODAY, 120);

let owner: string;
let manager: string;
let desk: string;
let court1: string;
let court2: string;
let plan: { id: string };
let courtPlan: { id: string };

const admin = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, cookie = owner) => request(app)[method](path).set('Origin', ORIGIN).set('Cookie', cookie);
const site = (method: 'get' | 'post', path: string) => request(app)[method](`/public${path}`).set('Origin', WEBSITE);
const batchBody = (over = {}) => ({ name: 'Morning', planId: plan.id, courtId: court1, days: [1, 3, 5], start: '06:00', end: '07:00', capacity: 2, startsOn: START, endsOn: LATE, ...over });
const addBatch = async (over = {}) => (await admin('post', '/memberships/batches').send(batchBody(over)).expect(201)).body.batch;
const who = { holderName: 'Asha', phone: '98765 43210', email: 'asha@example.com' };
const join = async (batch: { id: string }, over = {}) => (await admin('post', '/memberships').send({ ...who, planId: plan.id, batchId: batch.id, startsOn: START, ...over }).expect(201)).body.membership;
const courtBody = (over = {}) => ({ ...who, planId: courtPlan.id, courtIds: [court2], days: [2, 4], start: '08:00', end: '09:00', startsOn: START, ...over });
const blocks = (where: 'batch' | 'membership', id: string) => db.select().from(courtReservations).where(where === 'batch' ? eq(courtReservations.batchId, id) : eq(courtReservations.membershipId, id));
const active = <T extends { status: string }>(rows: T[]) => rows.filter((r) => r.status === 'active');

beforeEach(async () => {
  owner = await signIn(app, (await addStaff({ role: 'owner' })).email);
  manager = await signIn(app, (await addStaff({ role: 'manager' })).email);
  desk = await signIn(app, (await addStaff({ role: 'front_desk' })).email);
  const rows = await db.select().from(courts).orderBy(courts.sortOrder);
  court1 = rows[0]!.id;
  court2 = rows[1]!.id;
  await admin('put', '/settings/hours').send({ hours: ALL_DAYS.map((weekday) => ({ weekday, opens: '06:00', closes: '22:00' })) }).expect(200);
  plan = (await admin('post', '/memberships/plans').send({ name: 'Regular', kind: 'individual', pricePaise: 200000, features: ['Locker'] }).expect(201)).body.plan;
  courtPlan = (await admin('post', '/memberships/plans').send({ name: 'Whole court', kind: 'court', pricePaise: 1000000, playersPerCourt: 2 }).expect(201)).body.plan;
});

describe('dates', () => {
  it('runs a month, less a day, and handles short months', () => {
    expect(monthEnd('2026-11-01')).toBe('2026-11-30');
    expect(monthEnd('2026-11-15')).toBe('2026-12-14');
    expect(monthEnd('2027-01-31')).toBe('2027-02-27');
    expect(monthEnd('2026-12-15')).toBe('2027-01-14');
  });
});

describe('who can do what', () => {
  it('needs a session', async () => {
    await request(app).get('/memberships').expect(401);
  });

  it('lets Front Desk view and take payment, but not change memberships', async () => {
    const batch = await addBatch();
    const m = await join(batch);
    await admin('get', '/memberships', desk).expect(200);
    await admin('post', '/memberships/plans', desk).send({ name: 'x', kind: 'individual', pricePaise: 1 }).expect(403);
    await admin('post', '/memberships/batches', desk).send(batchBody()).expect(403);
    await admin('post', '/memberships', desk).send({ ...who, planId: plan.id, batchId: batch.id, startsOn: START }).expect(403);
    await admin('post', `/memberships/${m.id}/renew`, desk).expect(403);
    await admin('post', `/memberships/${m.id}/cancel`, desk).send({}).expect(403);
    const detail = (await admin('get', `/memberships/${m.id}`, desk).expect(200)).body;
    await admin('post', `/memberships/${m.id}/payments`, desk).send({ periodId: detail.periods[0].id, amountPaise: 100, method: 'cash' }).expect(201);
    await admin('post', `/memberships/${m.id}/renew`, manager).expect(200);
  });
});

describe('plans', () => {
  it('adds, edits, refuses duplicates and a changed type, and keeps a used plan', async () => {
    await admin('post', '/memberships/plans').send({ name: 'regular', kind: 'court', pricePaise: 1 }).expect(409);
    await admin('patch', `/memberships/plans/${plan.id}`).send({ name: 'Regular', kind: 'court', pricePaise: 1 }).expect(400);
    const { body } = await admin('patch', `/memberships/plans/${plan.id}`).send({ name: 'Regular+', kind: 'individual', pricePaise: 250000, features: ['Locker', 'Towel'], active: false }).expect(200);
    expect(body.plan).toMatchObject({ name: 'Regular+', features: ['Locker', 'Towel'], active: false });
    await admin('post', '/memberships/plans').send({ name: 'Big', kind: 'court', pricePaise: 1, playersPerCourt: 11 }).expect(400);
    await addBatch();
    expect((await admin('delete', `/memberships/plans/${plan.id}`).expect(409)).body.error.code).toBe('PLAN_IN_USE');
    await admin('delete', `/memberships/plans/${courtPlan.id}`).expect(204);
  });
});

describe('batches', () => {
  it('blocks the court at the fixed time, which stops bookings and shows on the schedule', async () => {
    const batch = await addBatch({ days: ALL_DAYS, endsOn: addDays(START, 6) });
    expect(batch).toMatchObject({ start: '06:00', seatsLeft: 2, taken: 0, courtName: 'Court 1', planName: 'Regular' });
    expect(active(await blocks('batch', batch.id))).toHaveLength(7);
    const customer = (await admin('post', '/customers').send({ name: 'x', phone: '98765 00000' }).expect(201)).body.customer;
    const res = await admin('post', '/bookings').send({ courtId: court1, date: START, start: '06:00', end: '07:00', customerId: customer.id, amountPaise: 100 }).expect(409);
    expect(res.body.error.code).toBe('SLOT_TAKEN');
    const day = (await admin('get', `/schedule?date=${START}`).expect(200)).body;
    expect(day.blocks[0]).toMatchObject({ kind: 'member_block', note: 'Batch: Morning' });
  });

  it('refuses a clash, says when, and creates nothing', async () => {
    const customer = (await admin('post', '/customers').send({ name: 'x', phone: '98765 00000' }).expect(201)).body.customer;
    await admin('post', '/bookings').send({ courtId: court1, date: addDays(START, 2), start: '06:00', end: '07:00', customerId: customer.id, amountPaise: 100 }).expect(201);
    const res = await admin('post', '/memberships/batches').send(batchBody({ days: ALL_DAYS, endsOn: addDays(START, 6) })).expect(409);
    expect(res.body.error.code).toBe('TIME_CLASH');
    expect(res.body.error.message).toContain(addDays(START, 2));
    expect((await admin('get', '/memberships/batches')).body.batches).toEqual([]);
    expect(await db.select().from(courtReservations).where(eq(courtReservations.kind, 'member_block'))).toEqual([]);
  });

  it('refuses times outside opening hours, and skips closed days', async () => {
    expect((await admin('post', '/memberships/batches').send(batchBody({ start: '05:00', end: '06:30' })).expect(409)).body.error.code).toBe('OUTSIDE_HOURS');
    const until = addDays(START, 2);
    await admin('post', '/settings/closures').send({ courtId: court1, startsAt: `${START}T00:00:00+05:30`, endsAt: `${addDays(START, 1)}T00:00:00+05:30` }).expect(201);
    const batch = await addBatch({ days: ALL_DAYS, endsOn: until });
    expect(active(await blocks('batch', batch.id))).toHaveLength(2);
  });

  it.each([[{ name: ' ' }], [{ days: [] }], [{ capacity: 0 }], [{ start: '09:00', end: '08:00' }], [{ startsOn: 'nope' }]])('refuses %j', async (over) => {
    await admin('post', '/memberships/batches').send(batchBody(over)).expect(400);
  });

  it('needs an individual plan', async () => {
    expect((await admin('post', '/memberships/batches').send(batchBody({ planId: courtPlan.id })).expect(400)).body.error.code).toBe('WRONG_PLAN');
  });

  it('moves its future blocks when the time changes, and refuses a clash without moving anything', async () => {
    const batch = await addBatch({ days: ALL_DAYS, endsOn: addDays(START, 3) });
    await admin('patch', `/memberships/batches/${batch.id}`).send(batchBody({ days: ALL_DAYS, start: '10:00', end: '11:00', endsOn: addDays(START, 3) })).expect(200);
    const after = active(await blocks('batch', batch.id));
    expect(after).toHaveLength(4);
    const other = await addBatch({ name: 'Other', start: '12:00', end: '13:00', days: ALL_DAYS, endsOn: addDays(START, 3) });
    await admin('patch', `/memberships/batches/${batch.id}`).send(batchBody({ days: ALL_DAYS, start: '12:00', end: '13:00', endsOn: addDays(START, 3) })).expect(409);
    expect(active(await blocks('batch', batch.id))).toHaveLength(4);
    expect(other.id).toBeTruthy();
  });

  it('won’t shrink below its members or end before them, and closes only when empty', async () => {
    const batch = await addBatch();
    const m = await join(batch);
    await join(batch, { holderName: 'B' });
    expect((await admin('patch', `/memberships/batches/${batch.id}`).send(batchBody({ capacity: 1 })).expect(409)).body.error.code).toBe('BELOW_MEMBERS');
    expect((await admin('patch', `/memberships/batches/${batch.id}`).send(batchBody({ endsOn: addDays(START, 5) })).expect(409)).body.error.code).toBe('MEMBERS_BEYOND_END');
    expect((await admin('post', `/memberships/batches/${batch.id}/close`).expect(409)).body.error.code).toBe('BATCH_HAS_MEMBERS');
    await admin('post', `/memberships/${m.id}/cancel`).send({}).expect(200);
    const rows = (await admin('get', '/memberships')).body.memberships;
    await admin('post', `/memberships/${rows.find((r: { state: string }) => r.state !== 'Cancelled').id}/cancel`).send({}).expect(200);
    await admin('post', `/memberships/batches/${batch.id}/close`).expect(200);
    expect(active(await blocks('batch', batch.id))).toEqual([]);
  });
});

describe('individual members', () => {
  it('joins a batch with a MEM number, a month’s validity and a due amount', async () => {
    const batch = await addBatch();
    const m = await join(batch);
    expect(m.membershipNo).toMatch(/^MEM-\d{4}$/);
    expect(m).toMatchObject({ state: 'Active', startsOn: START, endsOn: monthEnd(START), duePaise: 200000, batchName: 'Morning', pricePaise: 200000 });
    expect(m.schedule).toEqual({ days: [1, 3, 5], start: '06:00', end: '07:00' });
  });

  it('never overfills a batch, even when people join at once', async () => {
    const batch = await addBatch({ capacity: 3 });
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => admin('post', '/memberships').send({ ...who, holderName: `P${i}`, planId: plan.id, batchId: batch.id, startsOn: START })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.filter((r) => r.status === 409)[0]!.body.error.code).toBe('BATCH_FULL');
    expect((await admin('get', '/memberships/batches')).body.batches[0]).toMatchObject({ taken: 3, seatsLeft: 0 });
  });

  it('frees a place on cancel, and refuses dates outside the batch or the wrong plan', async () => {
    const batch = await addBatch({ capacity: 1 });
    const first = await join(batch);
    await admin('post', '/memberships').send({ ...who, planId: plan.id, batchId: batch.id, startsOn: START }).expect(409);
    await admin('post', `/memberships/${first.id}/cancel`).send({ reason: 'Moved away' }).expect(200);
    await join(batch);
    const short = await addBatch({ name: 'Short', start: '09:00', end: '10:00', endsOn: addDays(START, 10) });
    expect((await admin('post', '/memberships').send({ ...who, planId: plan.id, batchId: short.id, startsOn: START }).expect(409)).body.error.code).toBe('OUTSIDE_BATCH');
    const other = (await admin('post', '/memberships/plans').send({ name: 'Other', kind: 'individual', pricePaise: 1 }).expect(201)).body.plan;
    const open = await addBatch({ name: 'Open', start: '11:00', end: '12:00' });
    await admin('post', '/memberships').send({ ...who, planId: other.id, batchId: open.id, startsOn: START }).expect(400);
  });

  it('renews from the day after it ends, adds a due month, and can use a new price', async () => {
    const batch = await addBatch();
    const m = await join(batch);
    await admin('patch', `/memberships/${m.id}`).send({ ...who, pricePaise: 180000 }).expect(200);
    const { body } = await admin('post', `/memberships/${m.id}/renew`).expect(200);
    expect(body.membership.endsOn).toBe(monthEnd(addDays(monthEnd(START), 1)));
    expect(body.membership.duePaise).toBe(380000);
    const detail = (await admin('get', `/memberships/${m.id}`)).body;
    expect(detail.periods.map((p: { amountPaise: number }) => p.amountPaise)).toEqual([180000, 200000]);
  });

  it('a renewing member doesn’t count against their own seat', async () => {
    const batch = await addBatch({ capacity: 1 });
    const m = await join(batch);
    await admin('post', `/memberships/${m.id}/renew`).expect(200);
  });

  it('moves to a batch with room', async () => {
    const a = await addBatch();
    const full = await addBatch({ name: 'Full', start: '08:00', end: '09:00', capacity: 1 });
    await join(full);
    const b = await addBatch({ name: 'B', start: '10:00', end: '11:00' });
    const m = await join(a);
    await admin('post', `/memberships/${m.id}/move`).send({ batchId: full.id }).expect(409);
    const { body } = await admin('post', `/memberships/${m.id}/move`).send({ batchId: b.id }).expect(200);
    expect(body.membership.batchName).toBe('B');
  });
});

describe('court memberships', () => {
  it('holds whole courts with a CRT number, priced per court', async () => {
    const { body } = await admin('post', '/memberships').send(courtBody({ courtIds: [court1, court2] })).expect(201);
    expect(body.membership.membershipNo).toMatch(/^CRT-\d{4}$/);
    expect(body.membership.duePaise).toBe(2000000);
    expect(body.membership.courts).toHaveLength(2);
    const held = active(await blocks('membership', body.membership.id));
    expect(new Set(held.map((b) => b.courtId))).toEqual(new Set([court1, court2]));
  });

  it('refuses a clash and creates nothing, and needs a court, days and time', async () => {
    await addBatch({ courtId: court2, days: [2, 4], start: '08:00', end: '09:00' });
    const res = await admin('post', '/memberships').send(courtBody()).expect(409);
    expect(res.body.error.code).toBe('TIME_CLASH');
    expect(await db.select().from(memberships)).toEqual([]);
    await admin('post', '/memberships').send(courtBody({ courtIds: [] })).expect(400);
    await admin('post', '/memberships').send(courtBody({ days: [] })).expect(400);
    await admin('post', '/memberships').send(courtBody({ courtIds: [court1, court2, crypto.randomUUID()] })).expect(400);
  });

  it('renews by blocking the next month, and refuses if someone took it', async () => {
    const { body } = await admin('post', '/memberships').send(courtBody({ days: ALL_DAYS })).expect(201);
    const m = body.membership;
    const before = active(await blocks('membership', m.id)).length;
    const nextDay = addDays(m.endsOn, 2);
    const customer = (await admin('post', '/customers').send({ name: 'x', phone: '98765 00000' }).expect(201)).body.customer;
    const taken = (await admin('post', '/bookings').send({ courtId: court2, date: nextDay, start: '08:00', end: '09:00', customerId: customer.id, amountPaise: 100 }).expect(201)).body.booking;
    expect((await admin('post', `/memberships/${m.id}/renew`).expect(409)).body.error.code).toBe('TIME_CLASH');
    expect(active(await blocks('membership', m.id))).toHaveLength(before);
    expect((await admin('get', `/memberships/${m.id}`)).body.membership.endsOn).toBe(m.endsOn);
    await admin('post', `/bookings/${taken.id}/cancel`).send({}).expect(200);
    await admin('post', `/memberships/${m.id}/renew`).expect(200);
    expect(active(await blocks('membership', m.id)).length).toBeGreaterThan(before);
  });

  it('moves to another time all or nothing, and frees the old one', async () => {
    const m = (await admin('post', '/memberships').send(courtBody()).expect(201)).body.membership;
    await addBatch({ courtId: court1, days: [2, 4], start: '12:00', end: '13:00' });
    const move = { courtIds: [court1], days: [2, 4], start: '12:00', end: '13:00' };
    await admin('post', `/memberships/${m.id}/move`).send(move).expect(409);
    expect((await admin('get', `/memberships/${m.id}`)).body.membership.schedule.start).toBe('08:00');
    const { body } = await admin('post', `/memberships/${m.id}/move`).send({ ...move, courtIds: [court2], start: '14:00', end: '15:00' }).expect(200);
    expect(body.membership.schedule.start).toBe('14:00');
    const held = active(await blocks('membership', m.id));
    expect(held.length).toBeGreaterThan(0);
  });

  it('limits players to the plan’s number per court', async () => {
    const m = (await admin('post', '/memberships').send(courtBody()).expect(201)).body.membership;
    const a = (await admin('post', `/memberships/${m.id}/players`).send({ name: 'P1' }).expect(201)).body.player;
    await admin('post', `/memberships/${m.id}/players`).send({ name: 'P2', phone: '9' }).expect(201);
    expect((await admin('post', `/memberships/${m.id}/players`).send({ name: 'P3' }).expect(409)).body.error.code).toBe('PLAYER_LIMIT');
    const detail = (await admin('get', `/memberships/${m.id}`)).body;
    expect(detail.playerLimit).toBe(2);
    expect(detail.players).toHaveLength(2);
    expect((await admin('get', '/memberships?q=P1')).body.memberships).toHaveLength(1);
    await admin('delete', `/memberships/${m.id}/players/${a.id}`).expect(204);
    await admin('post', `/memberships/${m.id}/players`).send({ name: 'P3' }).expect(201);
    const batch = await addBatch();
    const single = await join(batch);
    await admin('post', `/memberships/${single.id}/players`).send({ name: 'x' }).expect(400);
  });

  it('frees future courts on cancel', async () => {
    const m = (await admin('post', '/memberships').send(courtBody()).expect(201)).body.membership;
    await admin('post', `/memberships/${m.id}/cancel`).send({}).expect(200);
    expect(active(await blocks('membership', m.id))).toEqual([]);
    await admin('post', `/memberships/${m.id}/cancel`).send({}).expect(400);
    await admin('post', `/memberships/${m.id}/renew`).expect(400);
    await admin('delete', `/memberships/${m.id}`).expect(204);
    await admin('get', `/memberships/${m.id}`).expect(404);
  });

  it('won’t delete a live membership', async () => {
    const m = (await admin('post', '/memberships').send(courtBody()).expect(201)).body.membership;
    expect((await admin('delete', `/memberships/${m.id}`).expect(409)).body.error.code).toBe('STILL_ACTIVE');
  });
});

describe('payments', () => {
  it('takes part payments per month, refuses overpayment, voids, and shows on Payments and Reports', async () => {
    const batch = await addBatch();
    const m = await join(batch);
    const period = (await admin('get', `/memberships/${m.id}`)).body.periods[0];
    const pay = (b: object) => admin('post', `/memberships/${m.id}/payments`).send({ periodId: period.id, ...b });
    await pay({ amountPaise: 200001, method: 'cash' }).expect(409);
    await pay({ amountPaise: 100, method: 'online_test' }).expect(400);
    const first = (await pay({ amountPaise: 150000, method: 'cash' }).expect(201)).body.payment;
    expect(first.receiptNo).toMatch(/^RCP-/);
    await pay({ amountPaise: 50000, method: 'upi', reference: 'UTR' }).expect(201);
    expect((await admin('get', `/memberships/${m.id}`)).body.membership.duePaise).toBe(0);

    const list = (await admin('get', `/payments?date=${TODAY}`).expect(200)).body.payments;
    expect(list[0]).toMatchObject({ customerName: 'Asha', membershipNo: m.membershipNo, bookingNo: null });
    expect((await admin('get', `/payments?q=${m.membershipNo}`)).body.payments).toHaveLength(2);
    const report = (await admin('get', `/reports?from=${TODAY}&to=${TODAY}`).expect(200)).body.periods[0];
    expect(report).toMatchObject({ receivedPaise: 0, membershipReceivedPaise: 200000 });

    await admin('post', `/payments/${first.id}/void`).send({ reason: 'Mistake' }).expect(200);
    expect((await admin('get', `/memberships/${m.id}`)).body.membership.duePaise).toBe(150000);
    expect((await admin('get', '/search?q=asha').expect(200)).body.memberships[0].membershipNo).toBe(m.membershipNo);
  });

  it('refuses a month from another membership', async () => {
    const batch = await addBatch();
    const a = await join(batch);
    const b = await join(batch, { holderName: 'B' });
    const period = (await admin('get', `/memberships/${a.id}`)).body.periods[0];
    await admin('post', `/memberships/${b.id}/payments`).send({ periodId: period.id, amountPaise: 100, method: 'cash' }).expect(400);
  });
});

describe('states and search', () => {
  it('shows Expiring and Expired, and filters by them', async () => {
    const batch = await addBatch({ startsOn: addDays(TODAY, -60) });
    const m = await join(batch, { startsOn: addDays(TODAY, -40) });
    expect(m.state).toBe('Expired');
    const soon = await join(batch, { holderName: 'Soon', startsOn: addDays(TODAY, -25) });
    expect(soon.state).toBe('Expiring');
    const list = async (q: string) => (await admin('get', `/memberships?${q}`).expect(200)).body.memberships;
    expect(await list('state=Expired')).toHaveLength(1);
    expect(await list('q=9876543210')).toHaveLength(2);
    expect(await list('kind=court')).toEqual([]);
  });

  it('renews a lapsed member from today', async () => {
    const batch = await addBatch({ startsOn: addDays(TODAY, -60) });
    const m = await join(batch, { startsOn: addDays(TODAY, -40) });
    const { body } = await admin('post', `/memberships/${m.id}/renew`).expect(200);
    expect(body.membership.endsOn).toBe(monthEnd(TODAY));
  });
});

describe('emails', () => {
  it('queues confirmed, renewed, reminder and cancelled, and fills in a working private link', async () => {
    const batch = await addBatch();
    const m = await join(batch);
    await admin('post', `/memberships/${m.id}/renew`).expect(200);
    await admin('post', `/memberships/${m.id}/remind`, desk).expect(202);
    await admin('post', `/memberships/${m.id}/cancel`).send({}).expect(200);
    const rows = await db.select().from(messages).orderBy(messages.createdAt);
    expect(rows.map((r) => r.template)).toEqual(['membership_confirmed', 'membership_renewed', 'membership_reminder', 'membership_cancelled']);
    expect(rows[0]!.body).toContain('{{link}}');
    const sent: { text: string }[] = [];
    await processMessages({ send: async (e) => void sent.push(e) });
    const link = membershipLink(m.id);
    expect(sent[0]!.text).toContain(link);
    const page = await site('get', `/memberships/${link.split('/').pop()}`).expect(200);
    expect(page.body.membership.membershipNo).toBe(m.membershipNo);
  });

  it('sends nothing without an email', async () => {
    const batch = await addBatch();
    const m = await join(batch, { email: '' });
    expect(await db.select().from(messages)).toEqual([]);
    expect((await admin('post', `/memberships/${m.id}/remind`).expect(400)).body.error.code).toBe('NO_EMAIL');
  });
});

describe('joining on the website', () => {
  const guest = { name: 'Web Person', phone: '+91 98765 43210', email: 'web@example.com' };
  const joinBatch = (batch: { id: string }, over = {}) => site('post', '/memberships').send({ ...guest, planId: plan.id, batchId: batch.id, startsOn: START, ...over });
  const joinCourt = (over = {}) => site('post', '/memberships').send({ ...guest, planId: courtPlan.id, courtIds: [court1], days: [2], start: '18:00', startsOn: START, ...over });

  it('lists active plans and places left, without saying who is in a batch', async () => {
    const batch = await addBatch();
    await join(batch);
    await admin('post', '/memberships/plans').send({ name: 'Hidden', kind: 'individual', pricePaise: 1, active: false }).expect(201);
    const { body } = await site('get', '/memberships/options').expect(200);
    expect(body.plans.map((p: { name: string }) => p.name)).toEqual(['Regular', 'Whole court']);
    expect(body.batches[0]).toMatchObject({ seatsLeft: 1, name: 'Morning', start: '06:00' });
    expect(JSON.stringify(body)).not.toMatch(/Asha|98765|taken/);
  });

  it('holds a place, confirms on test payment, and records a receipt', async () => {
    const batch = await addBatch({ capacity: 1 });
    const { body } = await joinBatch(batch, { pricePaise: 1 }).expect(201);
    expect(body.membership).toMatchObject({ status: 'pending_payment', amountPaise: 200000 });
    expect((await joinBatch(batch, { email: 'other@example.com' }).expect(409)).body.error.code).toBe('BATCH_FULL');
    expect(await db.select().from(messages)).toEqual([]);
    await site('post', `/memberships/${body.token}/pay`).send({ result: 'failure' }).expect(402);
    await Promise.all([site('post', `/memberships/${body.token}/pay`).send({ result: 'success' }), site('post', `/memberships/${body.token}/pay`).send({ result: 'success' })]);
    expect((await db.select().from(payments)).map((p) => p.method)).toEqual(['online_test']);
    const page = (await site('get', `/memberships/${body.token}`).expect(200)).body.membership;
    expect(page.status).toBe('active');
    expect(JSON.stringify(page)).not.toMatch(/98765|web@example/);
    expect((await db.select().from(messages)).map((m) => m.template)).toContain('membership_confirmed');
    const [row] = (await admin('get', '/memberships')).body.memberships;
    expect(row).toMatchObject({ state: 'Active', duePaise: 0, phone: '9876543210', source: 'website' });
  });

  it('gives the place back when the hold runs out', async () => {
    const batch = await addBatch({ capacity: 1 });
    const { body } = await joinBatch(batch).expect(201);
    await db.update(memberships).set({ holdExpiresAt: new Date(Date.now() - 1000) });
    expect((await site('post', `/memberships/${body.token}/pay`).send({ result: 'success' }).expect(410)).body.error.code).toBe('HOLD_EXPIRED');
    await joinBatch(batch, { email: 'next@example.com' }).expect(201);
    expect((await site('get', `/memberships/${body.token}`)).body.membership.status).toBe('expired');
  });

  it('blocks courts for a court membership, and frees them on release or expiry', async () => {
    const first = await joinCourt().expect(201);
    expect(first.body.membership.amountPaise).toBe(1000000);
    expect((await joinCourt({ email: 'b@example.com' }).expect(409)).body.error.code).toBe('TIME_CLASH');
    await site('post', `/memberships/${first.body.token}/release`).expect(200);
    const second = await joinCourt({ email: 'b@example.com' }).expect(201);
    await db.update(memberships).set({ holdExpiresAt: new Date(Date.now() - 1000) }).where(eq(memberships.email, 'b@example.com'));
    await joinCourt({ email: 'c@example.com' }).expect(201);
    expect(second.body.token).toBeTruthy();
  });

  it('refuses bad requests and too many holds', async () => {
    const batch = await addBatch({ capacity: 10 });
    await joinBatch(batch, { phone: '123' }).expect(400);
    await joinBatch(batch, { website: 'spam' }).expect(400);
    await joinBatch(batch, { startsOn: addDays(TODAY, -1) }).expect(400);
    await joinBatch(batch, { startsOn: addDays(TODAY, 31) }).expect(400);
    await joinCourt({ courtIds: [] }).expect(400);
    await joinCourt({ days: [] }).expect(400);
    await joinCourt({ start: 'x' }).expect(400);
    await joinBatch(batch).expect(201);
    await joinBatch(batch).expect(201);
    expect((await joinBatch(batch).expect(409)).body.error.code).toBe('TOO_MANY_HOLDS');
    await site('get', '/memberships/wrong').expect(404);
  });
});

describe('requests arriving together', () => {
  it('gives the last seat in a batch to only one of several people', async () => {
    const batch = await addBatch({ capacity: 1 });
    const attempts = await Promise.all(
      ['91111 11111', '92222 22222', '93333 33333', '94444 44444'].map((phone, i) =>
        admin('post', '/memberships').send({ ...who, phone, email: `p${i}@example.com`, planId: plan.id, batchId: batch.id, startsOn: START }),
      ),
    );
    expect(attempts.filter((r) => r.status === 201)).toHaveLength(1);
    for (const r of attempts.filter((a) => a.status !== 201)) expect(r.body.error.code).toBe('BATCH_FULL');
  });
});
