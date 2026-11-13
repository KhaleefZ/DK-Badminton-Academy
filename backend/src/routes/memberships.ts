import { Router } from 'express';
import type { Request } from 'express';
import { and, asc, desc, eq, inArray, isNull, max, sql } from 'drizzle-orm';
import { z } from 'zod';
import { hashToken } from '../auth/crypto.js';
import { db, DB_ERRORS, dbErrorCode, Work } from '../db/client.js';
import { referralCodes, courts, memberBatches, memberCredits, memberships, membershipCourts, membershipKind, membershipPeriods, membershipPlans, membershipPlayers, nextNumber, paymentMethod, payments } from '../db/schema.js';
import { auditEntry } from '../lib/audit.js';
import { AppError, invalid, notFound } from '../lib/errors.js';
import { likeTerm, ilike } from '../lib/search.js';
import { addDays, isDate, monthEnd, toMinutes, toTime, venueToday } from '../lib/time.js';
import { parseBody, UUID } from '../lib/validate.js';
import { applyCredit, claimReferral, creditBalance, ensureMemberCode, recordRedemption, settleReferral } from '../memberships/referrals.js';
import { addPeriod, courtIdsOf, holdWeeklyTime, nextPeriod, periodPaid, releaseFutureBlocks, seatsTaken, startCourtBlocks, takeBatchSeat } from '../memberships/service.js';
import { membershipToken } from '../messages/links.js';
import { enqueueMembershipMessage } from '../messages/queue.js';
import { currentAuth, requirePasswordCurrent, requirePermission, requireSession } from '../middleware/auth.js';
import { releaseExpiredHolds } from '../schedule/availability.js';

const EXPIRING_DAYS = 7;
const dateField = (message: string) => z.string({ error: message }).refine(isDate, message);
const days = z.array(z.number().int().min(0).max(6), { error: 'Choose at least one day.' }).min(1, 'Choose at least one day.').max(7).transform((d) => [...new Set(d)].sort());
const uuidField = (message: string) => z.string({ error: message }).regex(UUID, message);
const optionalText = (limit: number) => z.string().trim().max(limit).nullish().transform((v) => v || null);
const money = z.number({ error: 'Enter a price.' }).int('Enter a valid price.').min(0, 'A price can’t be negative.').max(100_000_000, 'That price is too high.');

const clock = z
  .object({ start: z.string({ error: 'Enter a start time.' }), end: z.string({ error: 'Enter an end time.' }) })
  .transform((v, ctx) => {
    const startMinute = toMinutes(v.start);
    const endMinute = toMinutes(v.end);
    if (startMinute === null || endMinute === null || startMinute >= endMinute) {
      ctx.addIssue({ code: 'custom', message: 'The end time must be after the start time.' });
      return z.NEVER;
    }
    return { startMinute, endMinute };
  });

const planBody = z.object({
  name: z.string({ error: 'Enter a plan name.' }).trim().min(1, 'Enter a plan name.').max(80),
  kind: z.enum(membershipKind.enumValues, { error: 'Choose a plan type.' }),
  description: optionalText(500),
  features: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  pricePaise: money,
  playersPerCourt: z.number().int().min(1, 'Allow at least 1 player per court.').max(10, 'A court can have at most 10 players.').default(10),
  active: z.boolean().default(true),
});

const batchBody = z.object({
  name: z.string({ error: 'Enter a batch name.' }).trim().min(1, 'Enter a batch name.').max(80),
  planId: uuidField('Choose a plan.'),
  courtId: uuidField('Choose a court.'),
  days,
  capacity: z.number({ error: 'Enter how many members it holds.' }).int().min(1, 'A batch needs at least 1 place.').max(100, 'A batch can hold at most 100.'),
  startsOn: dateField('Choose a first date.'),
  endsOn: dateField('Choose a last date.'),
});

const person = z.object({
  holderName: z.string({ error: 'Enter the member’s name.' }).trim().min(1, 'Enter the member’s name.').max(120),
  phone: z.string({ error: 'Enter a phone number.' }).trim().regex(/^[+\d][\d\s-]{6,19}$/, 'Enter a valid phone number.'),
  email: z.union([z.literal(''), z.string().trim().toLowerCase().email('Enter a valid email.').max(254)]).nullish().transform((v) => v || null),
  notes: optionalText(1000),
  pricePaise: money.nullish(),
});

const newMembership = person.extend({
  planId: uuidField('Choose a plan.'),
  startsOn: dateField('Choose a start date.'),
  batchId: uuidField('Choose a batch.').nullish(),
  courtIds: z.array(z.string().regex(UUID)).max(2, 'A court membership can hold at most 2 courts.').nullish(),
  days: days.nullish(),
  referralCode: z.string().trim().max(30).nullish().transform((v) => v || null),
});

const courtTime = z.object({ courtIds: z.array(uuidField('Choose a court.')).min(1, 'Choose at least one court.').max(2, 'A court membership can hold at most 2 courts.'), days });
const playerBody = z.object({ name: z.string({ error: 'Enter the player’s name.' }).trim().min(1, 'Enter the player’s name.').max(120), phone: optionalText(20) });
const paymentBody = z.object({
  periodId: uuidField('Choose a month.'),
  amountPaise: z.number({ error: 'Enter an amount.' }).int('Enter a valid amount.').positive('Enter an amount above ₹0.').max(100_000_000),
  method: z.enum(paymentMethod.enumValues.filter((m) => m !== 'online_test') as ['cash', 'upi'], { error: 'Choose cash or UPI.' }),
  reference: optionalText(100),
});
const creditBody = z.object({
  amountPaise: z.number({ error: 'Enter an amount.' }).int('Enter a valid amount.').refine((v) => v !== 0, 'Enter an amount.').refine((v) => Math.abs(v) <= 100_000_000, 'That amount is too high.'),
  reason: z.string({ error: 'Enter a reason.' }).trim().min(1, 'Enter a reason.').max(200),
});
const reason = z.object({ reason: optionalText(300) });

const planView = (p: typeof membershipPlans.$inferSelect) => p;
const batchTime = (b: { startMinute: number; endMinute: number }) => ({ start: toTime(b.startMinute), end: toTime(b.endMinute) });

export async function batchViews(where?: ReturnType<typeof eq>) {
  const today = venueToday();
  const rows = await db
    .select({ batch: memberBatches, planName: membershipPlans.name, courtName: courts.name })
    .from(memberBatches)
    .innerJoin(membershipPlans, eq(memberBatches.planId, membershipPlans.id))
    .innerJoin(courts, eq(memberBatches.courtId, courts.id))
    .where(where)
    .orderBy(asc(memberBatches.startMinute));
  return Promise.all(
    rows.map(async ({ batch, planName, courtName }) => {
      const taken = await seatsTaken(batch.id, today);
      return { ...batch, ...batchTime(batch), planName, courtName, taken, seatsLeft: Math.max(batch.capacity - taken, 0) };
    }),
  );
}

const dueSql = sql<number>`coalesce((
  SELECT sum(max(pe.amount_paise - coalesce((SELECT sum(pa.amount_paise) FROM payments pa WHERE pa.period_id = pe.id AND pa.voided_at IS NULL), 0), 0))
  FROM membership_periods pe WHERE pe.membership_id = memberships.id
), 0)`;

/** The word staff see. Paying and validity are separate: a member can be current and still owe money. */
function stateOf(m: { status: string; endsOn: string }, today: string) {
  if (m.status === 'cancelled') return 'Cancelled';
  if (m.status === 'expired') return 'Lapsed';
  if (m.status === 'pending_payment') return 'Held';
  if (m.endsOn < today) return 'Expired';
  return m.endsOn <= addDays(today, EXPIRING_DAYS) ? 'Expiring' : 'Active';
}

async function membershipViews(where: ReturnType<typeof and>) {
  const today = venueToday();
  const rows = await db
    .select({ membership: memberships, planName: membershipPlans.name, batch: memberBatches, duePaise: dueSql })
    .from(memberships)
    .innerJoin(membershipPlans, eq(memberships.planId, membershipPlans.id))
    .leftJoin(memberBatches, eq(memberships.batchId, memberBatches.id))
    .where(where)
    .orderBy(desc(memberships.createdAt))
    .limit(500);
  const ids = rows.map((r) => r.membership.id);
  const courtRows = ids.length
    ? await db.select({ membershipId: membershipCourts.membershipId, id: courts.id, name: courts.name }).from(membershipCourts).innerJoin(courts, eq(membershipCourts.courtId, courts.id)).where(inArray(membershipCourts.membershipId, ids))
    : [];
  return rows.map(({ membership: { accessTokenHash: _hash, ...m }, planName, batch, duePaise }) => {
    const time = batch ?? m;
    return {
      ...m,
      planName,
      batchName: batch?.name ?? null,
      duePaise,
      state: stateOf(m, today),
      daysLeft: Math.round((Date.parse(m.endsOn) - Date.parse(today)) / 86_400_000),
      schedule: { days: time.days ?? [], ...batchTime({ startMinute: time.startMinute ?? 0, endMinute: time.endMinute ?? 0 }) },
      courts: batch ? [] : courtRows.filter((c) => c.membershipId === m.id).map(({ id, name }) => ({ id, name })),
    };
  });
}

const paramId = (req: Request, what: string) => {
  const id = String(req.params.id);
  if (!UUID.test(id)) throw notFound(what);
  return id;
};

async function findMembership(id: string) {
  const [row] = await db.select().from(memberships).where(and(eq(memberships.id, id), isNull(memberships.deletedAt)));
  if (!row) throw notFound('That membership');
  return row;
}

const newNumber = (kind: 'individual' | 'court') => (kind === 'court' ? nextNumber('CRT-', 4) : nextNumber('MEM-', 4));

export function membershipsRouter(): Router {
  const router = Router();
  router.use(requireSession, requirePasswordCurrent);
  const view = requirePermission('memberships.view');
  const manage = requirePermission('memberships.manage');
  const actor = (req: Request) => currentAuth(req).staff.id;
  const audit = (req: Request, action: string, entityType: string, entityId: string, newValues?: unknown, oldValues?: unknown) =>
    auditEntry({ action, actorStaffId: actor(req), entityType, entityId, newValues, oldValues, req });

  /* ---------- Plans ---------- */
  router.get('/plans', view, async (_req, res) => {
    res.json({ plans: (await db.select().from(membershipPlans).orderBy(asc(membershipPlans.sortOrder), asc(membershipPlans.name))).map(planView) });
  });

  const uniquePlanName = async <T,>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (err) {
      if (dbErrorCode(err) === DB_ERRORS.uniqueViolation) throw new AppError(409, 'DUPLICATE_PLAN', 'Another plan already has that name.');
      throw err;
    }
  };

  router.post('/plans', manage, async (req, res) => {
    const values = parseBody(planBody, req.body);
    const [{ last } = { last: 0 }] = await db.select({ last: max(membershipPlans.sortOrder) }).from(membershipPlans);
    const plan = { id: crypto.randomUUID(), ...values, sortOrder: (last ?? 0) + 1 };
    const [[row]] = await uniquePlanName(() => db.batch([db.insert(membershipPlans).values(plan).returning(), audit(req, 'plan.created', 'plan', plan.id, plan)]));
    res.status(201).json({ plan: row });
  });

  router.patch('/plans/:id', manage, async (req, res) => {
    const id = paramId(req, 'That plan');
    const { kind, ...values } = parseBody(planBody, req.body);
    const [before] = await db.select().from(membershipPlans).where(eq(membershipPlans.id, id));
    if (!before) throw notFound('That plan');
    if (kind !== before.kind) throw invalid('A plan’s type can’t change. Add a new plan instead.', 'PLAN_KIND_FIXED');
    const change = { ...values, updatedAt: new Date() };
    const [[row]] = await uniquePlanName(() =>
      db.batch([db.update(membershipPlans).set(change).where(eq(membershipPlans.id, id)).returning(), audit(req, 'plan.updated', 'plan', id, { ...before, ...change }, before)]),
    );
    res.json({ plan: row });
  });

  router.delete('/plans/:id', manage, async (req, res) => {
    const id = paramId(req, 'That plan');
    const [before] = await db.select().from(membershipPlans).where(eq(membershipPlans.id, id));
    if (!before) throw notFound('That plan');
    try {
      await db.batch([db.delete(membershipPlans).where(eq(membershipPlans.id, id)), audit(req, 'plan.deleted', 'plan', id, undefined, before)]);
    } catch (err) {
      if (dbErrorCode(err) === DB_ERRORS.foreignKeyViolation) throw new AppError(409, 'PLAN_IN_USE', 'This plan has batches or members, so it can’t be deleted. Switch it off instead.');
      throw err;
    }
    res.status(204).end();
  });

  /* ---------- Batches ---------- */
  router.get('/batches', view, async (_req, res) => {
    res.json({ batches: await batchViews() });
  });

  const requireIndividualPlan = async (planId: string) => {
    const [plan] = await db.select().from(membershipPlans).where(eq(membershipPlans.id, planId));
    if (plan?.kind !== 'individual') throw invalid('A batch needs an individual plan.', 'WRONG_PLAN');
  };

  router.post('/batches', manage, async (req, res) => {
    const values = parseBody(batchBody, req.body);
    const time = parseBody(clock, req.body);
    if (values.startsOn > values.endsOn) throw invalid('The last date must be after the first date.');
    await requireIndividualPlan(values.planId);
    const batch = { id: crypto.randomUUID(), ...values, ...time };
    const work = new Work().add(db.insert(memberBatches).values(batch));
    await holdWeeklyTime(work, { courtId: values.courtId, days: values.days, ...time }, values.startsOn, values.endsOn, { batchId: batch.id, note: `Batch: ${values.name}`, createdBy: actor(req) });
    await work.add(audit(req, 'batch.created', 'batch', batch.id, batch)).commit();
    const id = batch.id;
    res.status(201).json({ batch: (await batchViews(eq(memberBatches.id, id)))[0] });
  });

  // Changing the time, court or dates moves every block still ahead, all or nothing.
  router.patch('/batches/:id', manage, async (req, res) => {
    const id = paramId(req, 'That batch');
    const values = parseBody(batchBody, req.body);
    const time = parseBody(clock, req.body);
    if (values.startsOn > values.endsOn) throw invalid('The last date must be after the first date.');
    const [before] = await db.select().from(memberBatches).where(eq(memberBatches.id, id));
    if (!before) throw notFound('That batch');
    await requireIndividualPlan(values.planId);
    const today = venueToday();
    const taken = await seatsTaken(id, today);
    if (values.capacity < taken) throw new AppError(409, 'BELOW_MEMBERS', `${taken} members are in this batch, so it can’t hold fewer than that.`);
    const [lastMember] = await db.select({ last: max(memberships.endsOn) }).from(memberships).where(and(eq(memberships.batchId, id), inArray(memberships.status, ['active', 'pending_payment'])));
    if (lastMember?.last && lastMember.last > values.endsOn) throw new AppError(409, 'MEMBERS_BEYOND_END', `A member is paid up to ${lastMember.last}, so the batch can’t end before that.`);
    // The old blocks are given up and the new ones taken in one batch, so a clash leaves the batch as it was.
    const work = new Work().add(releaseFutureBlocks({ batchId: id }), db.update(memberBatches).set({ ...values, ...time, updatedAt: new Date() }).where(eq(memberBatches.id, id)));
    if (before.active) {
      const from = values.startsOn > today ? values.startsOn : addDays(today, 1);
      if (from <= values.endsOn) await holdWeeklyTime(work, { courtId: values.courtId, days: values.days, ...time }, from, values.endsOn, { batchId: id, note: `Batch: ${values.name}`, createdBy: actor(req), replacingOwn: true });
    }
    await work.add(audit(req, 'batch.updated', 'batch', id, { ...values, ...time }, before)).commit();
    res.json({ batch: (await batchViews(eq(memberBatches.id, id)))[0] });
  });

  router.post('/batches/:id/close', manage, async (req, res) => {
    const id = paramId(req, 'That batch');
    const [before] = await db.select().from(memberBatches).where(eq(memberBatches.id, id));
    if (!before) throw notFound('That batch');
    const taken = await seatsTaken(id, venueToday());
    if (taken) throw new AppError(409, 'BATCH_HAS_MEMBERS', `${taken} members are still in this batch. Move or cancel them first.`);
    await db.batch([releaseFutureBlocks({ batchId: id }), db.update(memberBatches).set({ active: false, updatedAt: new Date() }).where(eq(memberBatches.id, id)), audit(req, 'batch.closed', 'batch', id)]);
    res.json({ batch: (await batchViews(eq(memberBatches.id, id)))[0] });
  });

  /* ---------- Memberships ---------- */
  router.get('/', view, async (req, res) => {
    await releaseExpiredHolds();
    const q = String(req.query.q ?? '').trim().slice(0, 100);
    const kind = membershipKind.enumValues.find((k) => k === req.query.kind);
    const term = likeTerm(q);
    const digits = q.replace(/\D/g, '');
    const rows = await membershipViews(
      and(
        isNull(memberships.deletedAt),
        kind ? eq(memberships.kind, kind) : undefined,
        q ? sql`(${ilike(memberships.membershipNo, term)} OR ${ilike(memberships.holderName, term)} OR ${ilike(memberships.email, term)} OR ${ilike(memberships.notes, term)}${digits.length >= 3 ? sql` OR ${ilike(memberships.phoneDigits, likeTerm(digits))}` : sql``} OR EXISTS (SELECT 1 FROM membership_players mp WHERE mp.membership_id = ${memberships.id} AND ${ilike(sql`mp.name`, term)}))` : undefined,
      ),
    );
    const state = String(req.query.state ?? '');
    res.json({ memberships: state ? rows.filter((m) => m.state === state) : rows });
  });

  router.post('/', manage, async (req, res) => {
    const values = parseBody(newMembership, req.body);
    const [plan] = await db.select().from(membershipPlans).where(eq(membershipPlans.id, values.planId));
    if (!plan) throw invalid('Choose a plan.');
    const endsOn = monthEnd(values.startsOn);
    const id = crypto.randomUUID();
    const base = { id, kind: plan.kind, planId: plan.id, holderName: values.holderName, phone: values.phone, email: values.email, notes: values.notes, startsOn: values.startsOn, endsOn, createdBy: actor(req), accessTokenHash: hashToken(membershipToken(id)) };
    const work = new Work();

    if (plan.kind === 'individual') {
      if (!values.batchId) throw invalid('Choose a batch.');
      const batch = await takeBatchSeat(values.batchId, values.startsOn, endsOn);
      if (batch.planId !== plan.id) throw invalid('That batch belongs to another plan.', 'WRONG_PLAN');
      const pricePaise = values.pricePaise ?? plan.pricePaise;
      const referral = await claimReferral(values.referralCode, { phone: values.phone, email: values.email, pricePaise });
      work.add(db.insert(memberships).values({ ...base, batchId: batch.id, pricePaise, membershipNo: newNumber('individual') }));
      addPeriod(work, id, values.startsOn, endsOn, pricePaise - (referral?.discountPaise ?? 0), { discountPaise: referral?.discountPaise ?? 0 });
      recordRedemption(work, id, referral);
    } else {
      const { courtIds, days: chosenDays } = parseBody(courtTime, req.body);
      const time = parseBody(clock, req.body);
      const pricePaise = values.pricePaise ?? plan.pricePaise * courtIds.length;
      const referral = await claimReferral(values.referralCode, { phone: values.phone, email: values.email, pricePaise });
      work.add(db.insert(memberships).values({ ...base, days: chosenDays, ...time, pricePaise, membershipNo: newNumber('court') }));
      work.add(db.insert(membershipCourts).values(courtIds.map((courtId) => ({ membershipId: id, courtId }))));
      await startCourtBlocks(work, id, courtIds, { days: chosenDays, ...time }, values.startsOn, endsOn, actor(req));
      addPeriod(work, id, values.startsOn, endsOn, pricePaise - (referral?.discountPaise ?? 0), { discountPaise: referral?.discountPaise ?? 0 });
      recordRedemption(work, id, referral);
    }
    work.add(ensureMemberCode(id), audit(req, 'membership.created', 'membership', id, { planId: plan.id, startsOn: values.startsOn, endsOn }));
    work.after(() => settleReferral(id)).after(() => enqueueMembershipMessage(id, 'confirmed', actor(req)));
    await work.commit();
    res.status(201).json({ membership: (await membershipViews(eq(memberships.id, id)))[0] });
  });

  router.get('/:id', view, async (req, res) => {
    const id = paramId(req, 'That membership');
    const [membership] = await membershipViews(and(eq(memberships.id, id), isNull(memberships.deletedAt)));
    if (!membership) throw notFound('That membership');
    const [periods, players, receipts, referral, credits] = await Promise.all([
      db.select().from(membershipPeriods).where(eq(membershipPeriods.membershipId, id)).orderBy(desc(membershipPeriods.startsOn)),
      db.select().from(membershipPlayers).where(eq(membershipPlayers.membershipId, id)).orderBy(asc(membershipPlayers.createdAt)),
      db.select({ payment: payments }).from(payments).innerJoin(membershipPeriods, eq(payments.periodId, membershipPeriods.id)).where(eq(membershipPeriods.membershipId, id)).orderBy(desc(payments.receivedAt)),
      db.select().from(referralCodes).where(eq(referralCodes.membershipId, id)),
      db.select().from(memberCredits).where(eq(memberCredits.membershipId, id)).orderBy(desc(memberCredits.createdAt)),
    ]);
    const [plan] = await db.select({ playersPerCourt: membershipPlans.playersPerCourt }).from(membershipPlans).where(eq(membershipPlans.id, membership.planId));
    const withDue = await Promise.all(periods.map(async (p) => ({ ...p, paidPaise: await periodPaid(p.id) })));
    res.json({
      membership,
      periods: withDue.map((p) => ({ ...p, duePaise: Math.max(p.amountPaise - p.paidPaise, 0) })),
      players,
      playerLimit: membership.kind === 'court' ? plan!.playersPerCourt * membership.courts.length : null,
      payments: receipts.map((r) => r.payment),
      referralCode: referral[0]?.code ?? null,
      credits,
      creditBalancePaise: credits.reduce((sum, c) => sum + c.amountPaise, 0),
    });
  });

  router.patch('/:id', manage, async (req, res) => {
    const id = paramId(req, 'That membership');
    const values = parseBody(person, req.body);
    const before = await findMembership(id);
    const { pricePaise, ...details } = values;
    await db.batch([
      db.update(memberships).set({ ...details, ...(pricePaise === null || pricePaise === undefined ? {} : { pricePaise }), updatedAt: new Date() }).where(eq(memberships.id, id)),
      audit(req, 'membership.updated', 'membership', id, values, { holderName: before.holderName, phone: before.phone, email: before.email, pricePaise: before.pricePaise }),
    ]);
    res.json({ membership: (await membershipViews(eq(memberships.id, id)))[0] });
  });

  // Moves an individual member to another batch, or a court membership to another fixed time.
  router.post('/:id/move', manage, async (req, res) => {
    const id = paramId(req, 'That membership');
    const before = await findMembership(id);
    if (before.status !== 'active') throw invalid('Only a confirmed membership can be moved.', 'NOT_ACTIVE');
    const today = venueToday();
    const work = new Work();
    if (before.kind === 'individual') {
      const { batchId } = parseBody(z.object({ batchId: uuidField('Choose a batch.') }), req.body);
      const from = before.startsOn > today ? before.startsOn : today;
      const batch = await takeBatchSeat(batchId, from, before.endsOn, id);
      if (batch.planId !== before.planId) throw invalid('That batch belongs to another plan.', 'WRONG_PLAN');
      work.add(db.update(memberships).set({ batchId, updatedAt: new Date() }).where(eq(memberships.id, id)));
    } else {
      const { courtIds, days: chosenDays } = parseBody(courtTime, req.body);
      const time = parseBody(clock, req.body);
      // The old blocks are given up and the new ones taken in one batch, so a clash leaves everything as it was.
      work.add(releaseFutureBlocks({ membershipId: id }));
      const from = before.startsOn > today ? before.startsOn : addDays(today, 1);
      if (from <= before.endsOn) await startCourtBlocks(work, id, courtIds, { days: chosenDays, ...time }, from, before.endsOn, actor(req), true);
      work.add(
        db.delete(membershipCourts).where(eq(membershipCourts.membershipId, id)),
        db.insert(membershipCourts).values(courtIds.map((courtId) => ({ membershipId: id, courtId }))),
        db.update(memberships).set({ days: chosenDays, ...time, updatedAt: new Date() }).where(eq(memberships.id, id)),
      );
    }
    await work.add(audit(req, 'membership.moved', 'membership', id, req.body)).commit();
    res.json({ membership: (await membershipViews(eq(memberships.id, id)))[0] });
  });

  router.post('/:id/renew', manage, async (req, res) => {
    const id = paramId(req, 'That membership');
    const before = await findMembership(id);
    if (before.status !== 'active') throw invalid('Only a confirmed membership can be renewed.', 'NOT_ACTIVE');
    const period = nextPeriod(before.endsOn);
    const work = new Work();
    if (before.kind === 'individual') {
      // A member renewing on time already holds their seat; one who lapsed has to find room again.
      await takeBatchSeat(before.batchId!, period.startsOn, period.endsOn, id);
    } else {
      const courtIds = await courtIdsOf(id);
      await startCourtBlocks(work, id, courtIds, { days: before.days!, startMinute: before.startMinute!, endMinute: before.endMinute! }, period.startsOn, period.endsOn, actor(req));
    }
    const creditPaise = await applyCredit(work, id, before.pricePaise, `Used on renewal from ${period.startsOn}`, actor(req));
    addPeriod(work, id, period.startsOn, period.endsOn, before.pricePaise - creditPaise, { creditPaise });
    // Only extends from the end date just read, so two renewals clicked at once can't both add a month.
    work.add(
      db.update(memberships).set({ endsOn: period.endsOn, updatedAt: new Date() }).where(and(eq(memberships.id, id), eq(memberships.endsOn, before.endsOn))),
      audit(req, 'membership.renewed', 'membership', id, period),
    );
    await work.after(() => enqueueMembershipMessage(id, 'renewed', actor(req))).commit();
    res.json({ membership: (await membershipViews(eq(memberships.id, id)))[0] });
  });

  router.post('/:id/cancel', manage, async (req, res) => {
    const id = paramId(req, 'That membership');
    const { reason: cancelReason } = parseBody(reason, req.body ?? {});
    const before = await findMembership(id);
    if (before.status === 'cancelled' || before.status === 'expired') throw invalid('This membership is already cancelled.', 'NOT_ACTIVE');
    await db.batch([
      releaseFutureBlocks({ membershipId: id }),
      db.update(memberships).set({ status: 'cancelled', cancelReason, cancelledAt: new Date(), holdExpiresAt: null, updatedAt: new Date() }).where(eq(memberships.id, id)),
      audit(req, 'membership.cancelled', 'membership', id, { cancelReason }),
    ]);
    if (before.status === 'active') await enqueueMembershipMessage(id, 'cancelled', actor(req));
    res.json({ membership: (await membershipViews(eq(memberships.id, id)))[0] });
  });

  // Keeps the row and its receipts, so past money still adds up.
  router.delete('/:id', manage, async (req, res) => {
    const id = paramId(req, 'That membership');
    const before = await findMembership(id);
    if (before.status === 'active' || before.status === 'pending_payment') throw new AppError(409, 'STILL_ACTIVE', 'Cancel this membership before deleting it.');
    await db.batch([db.update(memberships).set({ deletedAt: new Date() }).where(eq(memberships.id, id)), audit(req, 'membership.deleted', 'membership', id)]);
    res.status(204).end();
  });

  // For goodwill or to correct a mistake. A minus amount takes credit away, never below nothing.
  router.post('/:id/credits', manage, async (req, res) => {
    const id = paramId(req, 'That membership');
    const values = parseBody(creditBody, req.body);
    await findMembership(id);
    if ((await creditBalance(id)) + values.amountPaise < 0) throw new AppError(409, 'CREDIT_TOO_LOW', 'That’s more than this member’s credit.');
    const [[credit]] = await db.batch([
      db.insert(memberCredits).values({ ...values, membershipId: id, createdBy: actor(req) }).returning(),
      audit(req, 'membership.credit_adjusted', 'membership', id, values),
    ]);
    res.status(201).json({ credit });
  });

  router.post('/:id/remind', requirePermission('messages.manage'), async (req, res) => {
    const id = paramId(req, 'That membership');
    const before = await findMembership(id);
    if (before.status !== 'active') throw invalid('Only a confirmed membership can be reminded.', 'NOT_ACTIVE');
    const queued = await enqueueMembershipMessage(id, 'reminder', actor(req));
    if (!queued) throw invalid('This member has no email address.', 'NO_EMAIL');
    res.status(202).json({ queued: true });
  });

  router.post('/:id/payments', requirePermission('payments.record'), async (req, res) => {
    const id = paramId(req, 'That membership');
    const values = parseBody(paymentBody, req.body);
    const before = await findMembership(id);
    if (before.status !== 'active') throw invalid('Only a confirmed membership can take a payment.', 'NOT_ACTIVE');
    const [period] = await db.select().from(membershipPeriods).where(and(eq(membershipPeriods.id, values.periodId), eq(membershipPeriods.membershipId, id)));
    if (!period) throw invalid('Choose a month.');
    if (values.amountPaise > period.amountPaise - (await periodPaid(period.id))) throw new AppError(409, 'OVERPAYMENT', 'That’s more than this month still owes.');
    // A database trigger repeats the "still owed" check, so two receipts entered at once can't overpay.
    const payment = { id: crypto.randomUUID(), ...values, recordedBy: actor(req) };
    const [[receipt]] = await db.batch([
      db.insert(payments).values(payment).returning(),
      auditEntry({ action: 'payment.recorded', actorStaffId: actor(req), entityType: 'payment', entityId: payment.id, newValues: payment, req }),
    ]);
    await settleReferral(id);
    res.status(201).json({ payment: receipt });
  });

  /* ---------- Players on a court membership ---------- */
  router.post('/:id/players', manage, async (req, res) => {
    const id = paramId(req, 'That membership');
    const values = parseBody(playerBody, req.body);
    const before = await findMembership(id);
    if (before.kind !== 'court') throw invalid('Only a court membership has a player list.', 'WRONG_KIND');
    const [plan] = await db.select().from(membershipPlans).where(eq(membershipPlans.id, before.planId));
    const limit = plan!.playersPerCourt * (await courtIdsOf(id)).length;
    const [{ count }] = (await db.select({ count: sql<number>`count(*)` }).from(membershipPlayers).where(eq(membershipPlayers.membershipId, id))) as [{ count: number }];
    if (count >= limit) throw new AppError(409, 'PLAYER_LIMIT', `This membership can have at most ${limit} players.`);
    const [[player]] = await db.batch([
      db.insert(membershipPlayers).values({ ...values, membershipId: id }).returning(),
      audit(req, 'membership.player_added', 'membership', id, { name: values.name }),
    ]);
    res.status(201).json({ player });
  });

  router.delete('/:id/players/:playerId', manage, async (req, res) => {
    const id = paramId(req, 'That membership');
    const playerId = String(req.params.playerId);
    if (!UUID.test(playerId)) throw notFound('That player');
    const removed = await db.delete(membershipPlayers).where(and(eq(membershipPlayers.id, playerId), eq(membershipPlayers.membershipId, id))).returning();
    if (!removed.length) throw notFound('That player');
    await audit(req, 'membership.player_removed', 'membership', id, { name: removed[0]!.name });
    res.status(204).end();
  });

  return router;
}
