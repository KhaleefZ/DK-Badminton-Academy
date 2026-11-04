import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/client.js';
import { auditLog, courtReservations, courts } from '../src/db/schema.js';
import { addDays, instantAt, venueToday } from '../src/lib/time.js';
import { slotPrice } from '../src/schedule/availability.js';
import { createReservation } from '../src/schedule/reservations.js';
import { addStaff, ORIGIN, signIn, testApp } from './helpers.js';

const { app } = testApp();
const FUTURE = addDays(venueToday(), 3);
const WEEKDAY = new Date(`${FUTURE}T00:00:00Z`).getUTCDay();
const TOMORROW = addDays(venueToday(), 1);

let owner: string;
let court1: string;
let court2: string;

const call = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, cookie = owner) => request(app)[method](path).set('Origin', ORIGIN).set('Cookie', cookie);
const venue = { venueName: 'DK', slotMinutes: 60, advanceBookingDays: 7, minNoticeMinutes: 60 };
const openDay = (opens = '06:00', closes = '10:00') => call('put', '/settings/hours').send({ hours: [{ weekday: WEEKDAY, opens, closes }] });
const allDays = [0, 1, 2, 3, 4, 5, 6];
const setPrices = (rules: unknown[]) => call('put', '/settings/prices').send({ rules });
const slotsOn = async (date = FUTURE, id = court1) => {
  const res = await call('get', `/availability?date=${date}`).expect(200);
  return res.body.courts.find((c: { id: string }) => c.id === id).slots;
};
const hold = (courtId: string, start: number, end: number, date = FUTURE) =>
  createReservation({ courtId, kind: 'booking', startsAt: instantAt(date, start), endsAt: instantAt(date, end) });

beforeEach(async () => {
  const person = await addStaff({ role: 'owner' });
  owner = await signIn(app, person.email);
  const rows = await db.select().from(courts).orderBy(courts.sortOrder);
  court1 = rows[0]!.id;
  court2 = rows[1]!.id;
});

describe('permissions', () => {
  it('needs a session', async () => {
    await request(app).get('/settings').expect(401);
    await request(app).get(`/availability?date=${FUTURE}`).expect(401);
  });

  it('lets every role read but only the Owner change', async () => {
    for (const role of ['manager', 'front_desk'] as const) {
      const person = await addStaff({ role });
      const cookie = await signIn(app, person.email);
      await call('get', '/settings', cookie).expect(200);
      await call('get', `/availability?date=${FUTURE}`, cookie).expect(200);
      await call('patch', '/settings', cookie).send(venue).expect(403);
      await call('post', '/settings/courts', cookie).send({ name: 'Court 3' }).expect(403);
      await call('put', '/settings/hours', cookie).send({ hours: [] }).expect(403);
      await call('put', '/settings/prices', cookie).send({ rules: [] }).expect(403);
      await call('post', '/settings/closures', cookie).send({}).expect(403);
    }
  });
});

describe('venue settings', () => {
  it('starts with two courts and no hours or prices', async () => {
    const { body } = await call('get', '/settings').expect(200);
    expect(body.courts.map((c: { name: string }) => c.name)).toEqual(['Court 1', 'Court 2']);
    expect(body.hours).toEqual([]);
    expect(body.prices).toEqual([]);
    expect(body.settings.slotMinutes).toBe(60);
  });

  it('saves and records a change', async () => {
    const { body } = await call('patch', '/settings').send({ ...venue, phone: '98765', email: 'A@B.COM', slotMinutes: 30 }).expect(200);
    expect(body.settings).toMatchObject({ phone: '98765', email: 'a@b.com', slotMinutes: 30 });
    const logs = await db.select().from(auditLog).where(eq(auditLog.action, 'settings.updated'));
    expect(logs).toHaveLength(1);
  });

  it.each([
    [{ ...venue, venueName: ' ' }],
    [{ ...venue, slotMinutes: 45 }],
    [{ ...venue, advanceBookingDays: -1 }],
    [{ ...venue, minNoticeMinutes: 1.5 }],
    [{ ...venue, email: 'nope' }],
  ])('refuses %j', async (body) => {
    await call('patch', '/settings').send(body).expect(400);
  });
});

describe('courts', () => {
  it('adds, renames and refuses duplicate names', async () => {
    const { body } = await call('post', '/settings/courts').send({ name: 'Court 3' }).expect(201);
    expect(body.court.sortOrder).toBe(3);
    await call('patch', `/settings/courts/${body.court.id}`).send({ name: 'Show court' }).expect(200);
    const dup = await call('post', '/settings/courts').send({ name: 'court 1' }).expect(409);
    expect(dup.body.error.code).toBe('DUPLICATE_COURT');
  });

  it('hides an inactive court from availability and refuses reservations on it', async () => {
    await openDay();
    await call('post', `/settings/courts/${court2}/deactivate`).expect(200);
    const { body } = await call('get', `/availability?date=${FUTURE}`).expect(200);
    expect(body.courts).toHaveLength(1);
    await expect(hold(court2, 360, 420)).rejects.toMatchObject({ code: 'COURT_UNAVAILABLE' });
    await call('post', `/settings/courts/${court2}/activate`).expect(200);
    await hold(court2, 360, 420);
  });

  it('won’t deactivate a court with upcoming reservations', async () => {
    await hold(court1, 360, 420);
    const res = await call('post', `/settings/courts/${court1}/deactivate`).expect(409);
    expect(res.body.error.code).toBe('COURT_HAS_RESERVATIONS');
  });

  it('deletes an unused court but keeps one with history', async () => {
    await call('delete', `/settings/courts/${court2}`).expect(204);
    await hold(court1, 360, 420);
    const res = await call('delete', `/settings/courts/${court1}`).expect(409);
    expect(res.body.error.code).toBe('COURT_IN_USE');
    await call('delete', `/settings/courts/${court2}`).expect(404);
    await call('patch', '/settings/courts/not-a-uuid').send({ name: 'x' }).expect(404);
  });
});

describe('opening hours', () => {
  it('replaces the week and supports two periods and midnight', async () => {
    const hours = [
      { weekday: 1, opens: '17:00', closes: '24:00' },
      { weekday: 1, opens: '06:00', closes: '10:00' },
    ];
    const { body } = await call('put', '/settings/hours').send({ hours }).expect(200);
    expect(body.hours.map((h: { opens: string }) => h.opens)).toEqual(['06:00', '17:00']);
    expect(body.hours[1].closes).toBe('24:00');
    await call('put', '/settings/hours').send({ hours: [] }).expect(200);
    expect((await call('get', '/settings')).body.hours).toEqual([]);
  });

  it.each([
    [[{ weekday: 1, opens: '10:00', closes: '09:00' }]],
    [[{ weekday: 1, opens: '25:00', closes: '26:00' }]],
    [[{ weekday: 7, opens: '06:00', closes: '09:00' }]],
    [[{ weekday: 1, opens: '06:00', closes: '10:00' }, { weekday: 1, opens: '09:00', closes: '11:00' }]],
  ])('refuses %j and keeps what was there', async (hours) => {
    await openDay();
    await call('put', '/settings/hours').send({ hours }).expect(400);
    expect((await call('get', '/settings')).body.hours).toHaveLength(1);
  });
});

describe('prices', () => {
  it('refuses overlaps in the same scope, allows them across scopes', async () => {
    const all = { courtId: null, days: [1, 2], start: '06:00', end: '12:00', ratePaise: 50000 };
    await setPrices([all, { ...all, days: [2], start: '11:00', end: '13:00' }]).expect(400);
    await setPrices([all, { ...all, days: [3] }, { ...all, courtId: court1 }]).expect(200);
    await setPrices([{ ...all, courtId: crypto.randomUUID() }]).expect(400);
    await setPrices([{ ...all, ratePaise: -1 }]).expect(400);
    await setPrices([{ ...all, days: [] }]).expect(400);
  });

  it('prices by the minute, prefers the court’s own rule, and rounds', () => {
    const rules = [
      { courtId: null, startMinute: 0, endMinute: 600, ratePaise: 40000 },
      { courtId: null, startMinute: 600, endMinute: 1440, ratePaise: 50000 },
      { courtId: 'a', startMinute: 0, endMinute: 1440, ratePaise: 70000 },
      { courtId: 'z', startMinute: 0, endMinute: 10, ratePaise: 10001 },
    ];
    expect(slotPrice(rules, 'b', 0, 60)).toBe(40000);
    expect(slotPrice(rules, 'b', 570, 630)).toBe(45000);
    expect(slotPrice(rules, 'a', 570, 630)).toBe(70000);
    expect(slotPrice(rules.slice(0, 1), 'b', 570, 630)).toBeNull();
    expect(slotPrice([rules[3]!], 'z', 0, 7)).toBe(1167);
  });
});

describe('availability', () => {
  it('rejects bad dates', async () => {
    for (const date of ['', 'nope', '2026-13-01', '2026-02-30']) await call('get', `/availability?date=${date}`).expect(400);
  });

  it('has no slots until hours are set, and on a closed weekday', async () => {
    expect(await slotsOn()).toEqual([]);
    await openDay();
    expect(await slotsOn(addDays(FUTURE, 1))).toEqual([]);
  });

  it('builds slots from each period, dropping a part slot at the end', async () => {
    await call('put', '/settings/hours').send({ hours: [{ weekday: WEEKDAY, opens: '06:00', closes: '08:30' }, { weekday: WEEKDAY, opens: '17:00', closes: '18:00' }] }).expect(200);
    const slots = await slotsOn();
    expect(slots.map((s: { start: string }) => s.start)).toEqual(['06:00', '07:00', '17:00']);
    expect(slots[0].end).toBe('07:00');
    await call('patch', '/settings').send({ ...venue, slotMinutes: 30 }).expect(200);
    expect(await slotsOn()).toHaveLength(7);
  });

  it('a slot with no price exists but can’t be booked online', async () => {
    await openDay();
    const [slot] = await slotsOn();
    expect(slot).toMatchObject({ status: 'free', pricePaise: null, onlineBookable: false });
    await setPrices([{ courtId: null, days: allDays, start: '00:00', end: '24:00', ratePaise: 50000 }]).expect(200);
    expect((await slotsOn())[0]).toMatchObject({ pricePaise: 50000, onlineBookable: true });
  });

  it('applies the advance limit to the website only', async () => {
    await call('patch', '/settings').send({ ...venue, advanceBookingDays: 1 }).expect(200);
    await openDay();
    await setPrices([{ courtId: null, days: allDays, start: '00:00', end: '24:00', ratePaise: 50000 }]).expect(200);
    expect((await slotsOn())[0]).toMatchObject({ status: 'free', onlineBookable: false });
  });

  it('marks past slots on an earlier date', async () => {
    const earlier = addDays(venueToday(), -7);
    await call('put', '/settings/hours').send({ hours: [{ weekday: new Date(`${earlier}T00:00:00Z`).getUTCDay(), opens: '06:00', closes: '07:00' }] }).expect(200);
    expect((await slotsOn(earlier))[0].status).toBe('past');
  });

  it('shows a reservation only on its own court', async () => {
    await openDay();
    await hold(court1, 360, 420);
    expect((await slotsOn())[0]).toMatchObject({ status: 'reserved', reservationKind: 'booking', onlineBookable: false });
    expect((await slotsOn(FUTURE, court2))[0].status).toBe('free');
  });

  it('uses the venue’s day, not the server’s', async () => {
    await call('put', '/settings/hours').send({ hours: allDays.map((weekday) => ({ weekday, opens: '00:00', closes: '01:00' })) }).expect(200);
    await hold(court1, 0, 60, TOMORROW);
    expect((await slotsOn(TOMORROW))[0].status).toBe('reserved');
    expect((await slotsOn(addDays(TOMORROW, -1)))[0].status).not.toBe('reserved');
  });
});

describe('closures', () => {
  const closure = (over = {}) => ({ courtId: null, startsAt: instantAt(FUTURE, 360).toISOString(), endsAt: instantAt(FUTURE, 420).toISOString(), reason: 'Floor repair', ...over });

  it('closes the whole venue, or one court, and can be edited and removed', async () => {
    await openDay();
    const { body } = await call('post', '/settings/closures').send(closure()).expect(201);
    expect(body.conflicts).toEqual([]);
    expect((await slotsOn())[0]).toMatchObject({ status: 'closed', closureReason: 'Floor repair' });
    expect((await slotsOn(FUTURE, court2))[0].status).toBe('closed');
    expect((await slotsOn())[1].status).toBe('free');

    await call('patch', `/settings/closures/${body.closure.id}`).send(closure({ courtId: court1 })).expect(200);
    expect((await slotsOn(FUTURE, court2))[0].status).toBe('free');
    expect((await call('get', '/settings')).body.closures).toHaveLength(1);

    await call('delete', `/settings/closures/${body.closure.id}`).expect(204);
    expect((await slotsOn())[0].status).toBe('free');
  });

  it('warns about reservations it clashes with, without cancelling them', async () => {
    await hold(court1, 360, 420);
    const { body } = await call('post', '/settings/closures').send(closure()).expect(201);
    expect(body.conflicts).toHaveLength(1);
    expect(body.conflicts[0].courtName).toBe('Court 1');
    expect((await db.select().from(courtReservations))[0]!.status).toBe('active');
    const other = await call('post', '/settings/closures').send(closure({ courtId: court2 })).expect(201);
    expect(other.body.conflicts).toEqual([]);
  });

  it('refuses reservations during it and bad periods', async () => {
    await call('post', '/settings/closures').send(closure()).expect(201);
    await expect(hold(court1, 390, 450)).rejects.toMatchObject({ code: 'COURT_CLOSED' });
    await hold(court1, 420, 480);
    const start = instantAt(FUTURE, 420).toISOString();
    await call('post', '/settings/closures').send(closure({ startsAt: start, endsAt: start })).expect(400);
    await call('post', '/settings/closures').send(closure({ startsAt: 'tomorrow' })).expect(400);
    await call('post', '/settings/closures').send(closure({ courtId: crypto.randomUUID() })).expect(400);
  });
});

describe('overlap protection', () => {
  it('refuses overlaps on one court, allows neighbours and the other court', async () => {
    await hold(court1, 360, 420);
    await expect(hold(court1, 390, 450)).rejects.toThrow();
    await expect(hold(court1, 300, 361)).rejects.toThrow();
    await hold(court1, 420, 480);
    await hold(court1, 300, 360);
    await hold(court2, 360, 420);
  });

  it('lets only one of many simultaneous requests win', async () => {
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => hold(court1, 600, 660)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rows = await db.select().from(courtReservations);
    expect(rows).toHaveLength(1);
  });

  it('frees the time once a reservation is released', async () => {
    const first = await hold(court1, 360, 420);
    await db.update(courtReservations).set({ status: 'released' }).where(eq(courtReservations.id, first.id));
    await hold(court1, 360, 420);
    await expect(db.update(courtReservations).set({ status: 'active' }).where(eq(courtReservations.id, first.id))).rejects.toThrow();
  });

  it('holds even for a direct database write', async () => {
    await hold(court1, 360, 420);
    await expect(
      pool.query(`INSERT INTO court_reservations (court_id, kind, starts_at, ends_at) VALUES ($1, 'staff_block', $2, $3)`, [court1, instantAt(FUTURE, 360), instantAt(FUTURE, 420)]),
    ).rejects.toMatchObject({ code: '23P01' });
    const [{ count }] = (await db.execute(sql`SELECT count(*)::int AS count FROM court_reservations`)).rows as [{ count: number }];
    expect(count).toBe(1);
  });
});
