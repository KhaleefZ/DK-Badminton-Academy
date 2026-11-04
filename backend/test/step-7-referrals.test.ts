import { eq } from 'drizzle-orm';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/client.js';
import { courts, memberships, messages, referralCodes } from '../src/db/schema.js';
import { addDays, venueToday } from '../src/lib/time.js';
import { generateCode } from '../src/memberships/referrals.js';
import { addStaff, ORIGIN, signIn, testApp } from './helpers.js';

const WEBSITE = 'http://localhost:5173';
const { app } = testApp();
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const TODAY = venueToday();
const START = addDays(TODAY, 1);

let owner: string;
let manager: string;
let desk: string;
let court1: string;
let plan: { id: string };
let courtPlan: { id: string };
let batch: { id: string };

const admin = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, cookie = owner) => request(app)[method](path).set('Origin', ORIGIN).set('Cookie', cookie);
const site = (method: 'get' | 'post', path: string) => request(app)[method](`/public${path}`).set('Origin', WEBSITE);
const program = (over = {}) => ({ enabled: true, discountType: 'percent', discountValue: 10, rewardPaise: 30000, ...over });
const person = (n: number) => ({ holderName: `P${n}`, phone: `98765 0000${n}`, email: `p${n}@example.com` });
const join = (n: number, over = {}) => admin('post', '/memberships').send({ ...person(n), planId: plan.id, batchId: batch.id, startsOn: START, ...over });
const detail = async (id: string) => (await admin('get', `/memberships/${id}`).expect(200)).body;
const payAll = async (id: string) => {
  const { periods } = await detail(id);
  for (const p of periods) if (p.duePaise > 0) await admin('post', `/memberships/${id}/payments`).send({ periodId: p.id, amountPaise: p.duePaise, method: 'cash' }).expect(201);
};
const referrer = async () => {
  const { membership } = (await join(1).expect(201)).body;
  return { id: membership.id as string, code: (await detail(membership.id)).referralCode as string };
};

beforeEach(async () => {
  owner = await signIn(app, (await addStaff({ role: 'owner' })).email);
  manager = await signIn(app, (await addStaff({ role: 'manager' })).email);
  desk = await signIn(app, (await addStaff({ role: 'front_desk' })).email);
  court1 = (await db.select().from(courts).orderBy(courts.sortOrder))[0]!.id;
  await admin('put', '/settings/hours').send({ hours: ALL_DAYS.map((weekday) => ({ weekday, opens: '06:00', closes: '22:00' })) }).expect(200);
  plan = (await admin('post', '/memberships/plans').send({ name: 'Regular', kind: 'individual', pricePaise: 200000 }).expect(201)).body.plan;
  courtPlan = (await admin('post', '/memberships/plans').send({ name: 'Court', kind: 'court', pricePaise: 1000000 }).expect(201)).body.plan;
  batch = (await admin('post', '/memberships/batches').send({ name: 'Morning', planId: plan.id, courtId: court1, days: [1], start: '06:00', end: '07:00', capacity: 50, startsOn: START, endsOn: addDays(TODAY, 200) }).expect(201)).body.batch;
});

describe('program', () => {
  it('starts off, and only Owner and Manager can change it', async () => {
    const { body } = await admin('get', '/referrals', desk).expect(200);
    expect(body.program).toMatchObject({ enabled: false });
    await admin('put', '/referrals/program', desk).send(program()).expect(403);
    await admin('post', '/referrals/codes', desk).send({}).expect(403);
    await admin('put', '/referrals/program', manager).send(program()).expect(200);
    await request(app).get('/referrals').expect(401);
  });

  it.each([[{ discountType: 'percent', discountValue: 101 }], [{ discountValue: -1 }], [{ rewardPaise: -1 }], [{ enabled: 'yes' }], [{ discountType: 'free' }]])('refuses %j', async (over) => {
    await admin('put', '/referrals/program').send(program(over)).expect(400);
  });

  it('refuses every code while it’s off', async () => {
    const { code } = await referrer();
    const res = await join(2, { referralCode: code }).expect(400);
    expect(res.body.error.code).toBe('INVALID_REFERRAL');
  });
});

describe('member codes', () => {
  it('makes codes that are easy to read aloud', () => {
    expect(generateCode()).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
  });

  it('gives each confirmed member one code', async () => {
    const { id, code } = await referrer();
    expect(code).toMatch(/^[A-Z0-9]{8}$/);
    expect(await db.select().from(referralCodes).where(eq(referralCodes.membershipId, id))).toHaveLength(1);
    await admin('put', '/referrals/program').send(program()).expect(200);
    const rows = (await admin('get', '/referrals', desk).expect(200)).body.codes;
    expect(rows[0]).toMatchObject({ code, memberName: 'P1', uses: 0 });
  });
});

describe('using a code', () => {
  beforeEach(async () => {
    await admin('put', '/referrals/program').send(program()).expect(200);
  });

  it('takes the discount off the first month only, in any capitals', async () => {
    const { code } = await referrer();
    const { membership } = (await join(2, { referralCode: code.toLowerCase() }).expect(201)).body;
    expect(membership.duePaise).toBe(180000);
    const first = await detail(membership.id);
    expect(first.periods[0]).toMatchObject({ amountPaise: 180000, discountPaise: 20000 });
    await admin('post', `/memberships/${membership.id}/renew`).expect(200);
    const after = await detail(membership.id);
    expect(after.periods[0]).toMatchObject({ amountPaise: 200000, discountPaise: 0 });
  });

  it('handles a fixed discount, never below zero, and staff prices', async () => {
    const { code } = await referrer();
    await admin('put', '/referrals/program').send(program({ discountType: 'fixed', discountValue: 50000 })).expect(200);
    expect((await join(2, { referralCode: code }).expect(201)).body.membership.duePaise).toBe(150000);
    await admin('put', '/referrals/program').send(program({ discountType: 'fixed', discountValue: 99900000 })).expect(200);
    expect((await join(3, { referralCode: code }).expect(201)).body.membership.duePaise).toBe(0);
    await admin('put', '/referrals/program').send(program()).expect(200);
    expect((await join(4, { referralCode: code, pricePaise: 100000 }).expect(201)).body.membership.duePaise).toBe(90000);
  });

  it('works on a court membership', async () => {
    const { code } = await referrer();
    const { body } = await admin('post', '/memberships').send({ ...person(2), planId: courtPlan.id, courtIds: [court1], days: [2], start: '08:00', end: '09:00', startsOn: START, referralCode: code }).expect(201);
    expect(body.membership.duePaise).toBe(900000);
  });

  it('refuses your own code and anyone who has been a member', async () => {
    const { code } = await referrer();
    const own = await join(9, { ...person(1), referralCode: code }).expect(409);
    expect(own.body.error.code).toBe('NOT_NEW_MEMBER');
    await join(9, { phone: '98765 99999', email: 'p1@example.com', referralCode: code }).expect(409);
    await join(9, { phone: '+91 98765 00001', email: 'x@example.com', referralCode: code }).expect(409);
    expect((await admin('get', '/memberships')).body.memberships).toHaveLength(1);
  });

  it('refuses a code that is unknown, off, expired, used up, or whose member has left', async () => {
    const { id, code } = await referrer();
    await join(2, { referralCode: 'NOPE1234' }).expect(400);
    const row = (await admin('get', '/referrals')).body.codes[0];
    await admin('patch', `/referrals/codes/${row.id}`).send({ active: false }).expect(200);
    await join(2, { referralCode: code }).expect(400);
    await admin('patch', `/referrals/codes/${row.id}`).send({ expiresOn: addDays(TODAY, -1) }).expect(200);
    await join(2, { referralCode: code }).expect(400);
    await admin('patch', `/referrals/codes/${row.id}`).send({ maxUses: 1 }).expect(200);
    await join(2, { referralCode: code }).expect(201);
    await join(3, { referralCode: code }).expect(400);
    await admin('patch', `/referrals/codes/${row.id}`).send({ maxUses: 5 }).expect(200);
    await join(3, { referralCode: code }).expect(201);
    await admin('post', `/memberships/${id}/cancel`).send({}).expect(200);
    await join(4, { referralCode: code }).expect(400);
  });

  it('lets only one person take a code’s last use', async () => {
    const created = (await admin('post', '/referrals/codes').send({ code: 'LAST-ONE', maxUses: 1 }).expect(201)).body.code;
    const results = await Promise.all([2, 3, 4, 5].map((n) => join(n, { referralCode: created.code })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
  });
});

describe('referrer credit', () => {
  beforeEach(async () => {
    await admin('put', '/referrals/program').send(program()).expect(200);
  });

  it('is earned once, only after the new member’s first month is fully paid', async () => {
    const { id, code } = await referrer();
    const { membership } = (await join(2, { referralCode: code }).expect(201)).body;
    expect((await detail(id)).creditBalancePaise).toBe(0);
    const period = (await detail(membership.id)).periods[0];
    await admin('post', `/memberships/${membership.id}/payments`).send({ periodId: period.id, amountPaise: 100000, method: 'cash' }).expect(201);
    expect((await detail(id)).creditBalancePaise).toBe(0);
    await admin('post', `/memberships/${membership.id}/payments`).send({ periodId: period.id, amountPaise: 80000, method: 'upi' }).expect(201);
    const after = await detail(id);
    expect(after.creditBalancePaise).toBe(30000);
    expect(after.credits[0].reason).toContain(membership.membershipNo);
    await admin('post', `/memberships/${membership.id}/renew`).expect(200);
    await payAll(membership.id);
    expect((await detail(id)).creditBalancePaise).toBe(30000);
  });

  it('comes off the next renewal, and carries over what’s left', async () => {
    const { id, code } = await referrer();
    await admin('put', '/referrals/program').send(program({ rewardPaise: 250000 })).expect(200);
    const { membership } = (await join(2, { referralCode: code }).expect(201)).body;
    await payAll(membership.id);
    await admin('post', `/memberships/${id}/renew`).expect(200);
    let d = await detail(id);
    expect(d.periods[0]).toMatchObject({ amountPaise: 0, creditPaise: 200000 });
    expect(d.creditBalancePaise).toBe(50000);
    await admin('post', `/memberships/${id}/renew`).expect(200);
    d = await detail(id);
    expect(d.periods[0]).toMatchObject({ amountPaise: 150000, creditPaise: 50000 });
    expect(d.creditBalancePaise).toBe(0);
  });

  it('gives no credit for a promotion code, or when the reward is nil', async () => {
    await admin('post', '/referrals/codes').send({ code: 'PROMO', label: 'Launch' }).expect(201);
    const { membership } = (await join(2, { referralCode: 'promo' }).expect(201)).body;
    expect(membership.duePaise).toBe(180000);
    await payAll(membership.id);
    const { id, code } = await referrer();
    await admin('put', '/referrals/program').send(program({ rewardPaise: 0 })).expect(200);
    const second = (await join(3, { referralCode: code }).expect(201)).body.membership;
    await payAll(second.id);
    expect((await detail(id)).creditBalancePaise).toBe(0);
  });

  it('can be adjusted by hand, never below nothing, by managers only', async () => {
    const { id } = await referrer();
    await admin('post', `/memberships/${id}/credits`, desk).send({ amountPaise: 100, reason: 'x' }).expect(403);
    await admin('post', `/memberships/${id}/credits`).send({ amountPaise: 10000 }).expect(400);
    await admin('post', `/memberships/${id}/credits`).send({ amountPaise: 10000, reason: 'Goodwill' }).expect(201);
    expect((await admin('post', `/memberships/${id}/credits`).send({ amountPaise: -20000, reason: 'Fix' }).expect(409)).body.error.code).toBe('CREDIT_TOO_LOW');
    await admin('post', `/memberships/${id}/credits`, manager).send({ amountPaise: -10000, reason: 'Fix' }).expect(201);
    expect((await detail(id)).creditBalancePaise).toBe(0);
  });
});

describe('managing codes', () => {
  it('creates, edits and deletes promotion codes, keeping used and member codes', async () => {
    await admin('put', '/referrals/program').send(program()).expect(200);
    const auto = (await admin('post', '/referrals/codes').send({ label: 'Auto' }).expect(201)).body.code;
    expect(auto.code).toMatch(/^[A-Z0-9]{8}$/);
    const made = (await admin('post', '/referrals/codes').send({ code: 'diwali-26', label: 'Diwali', maxUses: 10, expiresOn: addDays(TODAY, 30) }).expect(201)).body.code;
    expect(made.code).toBe('DIWALI-26');
    expect((await admin('post', '/referrals/codes').send({ code: 'DIWALI-26' }).expect(409)).body.error.code).toBe('DUPLICATE_CODE');
    await admin('post', '/referrals/codes').send({ code: 'bad code!' }).expect(400);
    await admin('patch', `/referrals/codes/${made.id}`).send({ code: 'DIWALI', label: 'Festival', maxUses: 20 }).expect(200);
    await admin('delete', `/referrals/codes/${auto.id}`).expect(204);
    await join(2, { referralCode: 'diwali' }).expect(201);
    expect((await admin('delete', `/referrals/codes/${made.id}`).expect(409)).body.error.code).toBe('CODE_USED');
    const { body } = await admin('get', '/referrals').expect(200);
    expect(body.redemptions[0]).toMatchObject({ code: 'DIWALI', memberName: 'P2', discountPaise: 20000 });
    expect(body.codes.find((c: { code: string }) => c.code === 'DIWALI').uses).toBe(1);
    const own = (await referrer()).id;
    const mine = (await db.select().from(referralCodes).where(eq(referralCodes.membershipId, own)))[0]!;
    expect((await admin('delete', `/referrals/codes/${mine.id}`).expect(400)).body.error.code).toBe('MEMBER_CODE');
  });
});

describe('on the website', () => {
  const guest = { name: 'Web', phone: '9876512345', email: 'web@example.com' };
  const joinOnline = (over = {}) => site('post', '/memberships').send({ ...guest, planId: plan.id, batchId: batch.id, startsOn: START, ...over });

  it('hides referrals while off', async () => {
    expect((await site('get', '/memberships/options')).body.referralsEnabled).toBe(false);
    await site('post', '/referrals/check').send({ code: 'ANY', pricePaise: 100 }).expect(400);
  });

  it('checks a code without saying whose it is', async () => {
    await admin('put', '/referrals/program').send(program()).expect(200);
    const { code } = await referrer();
    const { body } = await site('post', '/referrals/check').send({ code, pricePaise: 200000 }).expect(200);
    expect(body).toEqual({ discountPaise: 20000, offer: '10% off the first month' });
    const bad = await site('post', '/referrals/check').send({ code: 'NOPE', pricePaise: 200000 }).expect(400);
    expect(bad.body.error.message).toBe('That referral code isn’t valid.');
  });

  it('charges the server’s discount, and credits the referrer on payment', async () => {
    await admin('put', '/referrals/program').send(program()).expect(200);
    const { id, code } = await referrer();
    const { body } = await joinOnline({ referralCode: code, discountPaise: 199999, amountPaise: 1 }).expect(201);
    expect(body.membership).toMatchObject({ amountPaise: 180000, discountPaise: 20000, monthlyPaise: 200000, referralCode: null });
    await site('post', `/memberships/${body.token}/pay`).send({ result: 'success' }).expect(200);
    const page = (await site('get', `/memberships/${body.token}`).expect(200)).body.membership;
    expect(page.referralCode).toMatch(/^[A-Z0-9]{8}$/);
    expect((await detail(id)).creditBalancePaise).toBe(30000);
    expect((await db.select().from(messages).where(eq(messages.recipient, 'web@example.com')))[0]!.body).toContain(page.referralCode);
  });

  it('gives a use back when a hold runs out', async () => {
    await admin('put', '/referrals/program').send(program()).expect(200);
    await admin('post', '/referrals/codes').send({ code: 'ONE', maxUses: 1 }).expect(201);
    await joinOnline({ referralCode: 'ONE' }).expect(201);
    await joinOnline({ referralCode: 'ONE', phone: '9876512346', email: 'b@example.com' }).expect(400);
    await db.update(memberships).set({ holdExpiresAt: new Date(Date.now() - 1000) }).where(eq(memberships.email, 'web@example.com'));
    // The earlier failed hold doesn't count against this person, either.
    await joinOnline({ referralCode: 'ONE' }).expect(201);
  });
});
