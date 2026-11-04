import type { RequestHandler, Router } from 'express';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { hashToken } from '../auth/crypto.js';
import { paymentTestMode } from '../config.js';
import { db, type DbOrTx } from '../db/client.js';
import { memberBatches, membershipCourts, membershipPeriods, membershipPlans, memberships, payments, referralCodes, referralProgram, settings, courts } from '../db/schema.js';
import { writeAudit } from '../lib/audit.js';
import { AppError, invalid, notFound } from '../lib/errors.js';
import { addDays, isDate, monthEnd, toMinutes, venueToday } from '../lib/time.js';
import { parseBody, UUID } from '../lib/validate.js';
import { claimReferral, describeOffer, discountFor, ensureMemberCode, loadProgram, recordRedemption, settleReferral, validateCode } from '../memberships/referrals.js';
import { addPeriod, releaseFutureBlocks, startCourtBlocks, takeBatchSeat } from '../memberships/service.js';
import { membershipToken } from '../messages/links.js';
import { enqueueMembershipMessage, enqueueStaffMembershipAlert } from '../messages/queue.js';
import { releaseExpiredHolds } from '../schedule/availability.js';
import { batchViews } from './memberships.js';

const MAX_LIVE_HOLDS = 2;
const LATEST_START_DAYS = 30;

const joinRequest = z.object({
  planId: z.string({ error: 'Choose a plan.' }).regex(UUID, 'Choose a plan.'),
  startsOn: z.string({ error: 'Choose a start date.' }).refine(isDate, 'Choose a start date.'),
  batchId: z.string().regex(UUID, 'Choose a batch.').nullish(),
  courtIds: z.array(z.string().regex(UUID, 'Choose a court.')).max(2, 'Choose at most 2 courts.').nullish(),
  days: z.array(z.number().int().min(0).max(6)).max(7).nullish(),
  start: z.string().nullish(),
  name: z.string({ error: 'Enter your name.' }).trim().min(1, 'Enter your name.').max(120),
  phone: z
    .string({ error: 'Enter a phone number.' })
    .transform((v) => v.replace(/[\s-]/g, '').replace(/^(\+91|0091|0)/, ''))
    .refine((v) => /^[6-9]\d{9}$/.test(v), 'Enter a valid 10-digit mobile number.'),
  email: z.string({ error: 'Enter an email address.' }).trim().toLowerCase().email('Enter a valid email address.').max(254),
  referralCode: z.string().trim().max(30).nullish().transform((v) => v || null),
  website: z.string().max(0, 'This request was blocked.').optional(),
});

const referralCheck = z.object({
  code: z.string({ error: 'Enter a code.' }).trim().min(1, 'Enter a code.').max(30),
  pricePaise: z.number().int().min(0).max(100_000_000),
});

const onlineOff = () => new AppError(503, 'ONLINE_BOOKING_OFF', 'Online joining isn’t available yet. Please contact the academy.');
const holdGone = () => new AppError(410, 'HOLD_EXPIRED', 'Your time to pay ran out, so your place was released. Please start again.');

async function byToken(token: string, conn: DbOrTx = db) {
  const [row] = await conn
    .select({ membership: memberships, planName: membershipPlans.name })
    .from(memberships)
    .innerJoin(membershipPlans, eq(memberships.planId, membershipPlans.id))
    .where(eq(memberships.accessTokenHash, hashToken(token)));
  if (!row) throw notFound('That membership');
  const [first] = await conn.select().from(membershipPeriods).where(eq(membershipPeriods.membershipId, row.membership.id)).orderBy(asc(membershipPeriods.startsOn)).limit(1);
  const [code] = await conn.select({ code: referralCodes.code }).from(referralCodes).where(eq(referralCodes.membershipId, row.membership.id));
  const [program] = await conn.select({ enabled: referralProgram.enabled }).from(referralProgram);
  return { ...row, first: first!, referralCode: program?.enabled ? (code?.code ?? null) : null };
}

/** Only what the holder of the private link needs. */
function publicView({ membership: m, planName, first, referralCode }: Awaited<ReturnType<typeof byToken>>) {
  const live = m.status === 'pending_payment' && m.holdExpiresAt! > new Date();
  return {
    membershipNo: m.membershipNo,
    kind: m.kind,
    planName,
    name: m.holderName,
    status: m.status === 'pending_payment' && !live ? 'expired' : m.status,
    holdExpiresAt: live ? m.holdExpiresAt : null,
    startsOn: m.startsOn,
    endsOn: m.endsOn,
    amountPaise: first.amountPaise,
    discountPaise: first.discountPaise,
    monthlyPaise: m.pricePaise,
    referralCode: m.status === 'active' ? referralCode : null,
  };
}

export function publicMembershipRoutes(router: Router, writeLimiter: RequestHandler) {
  router.get('/memberships/options', async (_req, res) => {
    await releaseExpiredHolds();
    const today = venueToday();
    const [plans, allBatches, courtRows, [venue]] = await Promise.all([
      db.select().from(membershipPlans).where(eq(membershipPlans.active, true)).orderBy(asc(membershipPlans.sortOrder)),
      batchViews(eq(memberBatches.active, true)),
      db.select({ id: courts.id, name: courts.name }).from(courts).where(eq(courts.active, true)).orderBy(asc(courts.sortOrder)),
      db.select().from(settings).where(eq(settings.id, 1)),
    ]);
    const program = await loadProgram(db);
    res.json({
      referralsEnabled: program.enabled,
      onlineJoining: paymentTestMode,
      testMode: paymentTestMode,
      today,
      latestStart: addDays(today, LATEST_START_DAYS),
      slotMinutes: venue!.slotMinutes,
      holdMinutes: venue!.holdMinutes,
      plans: plans.map((p) => ({ id: p.id, name: p.name, kind: p.kind, description: p.description, features: p.features, pricePaise: p.pricePaise, playersPerCourt: p.playersPerCourt })),
      // Who is in a batch stays private: only whether there's room.
      batches: allBatches
        .filter((b) => b.endsOn >= today)
        .map((b) => ({ id: b.id, name: b.name, planId: b.planId, courtName: b.courtName, days: b.days, start: b.start, end: b.end, startsOn: b.startsOn, endsOn: b.endsOn, seatsLeft: b.seatsLeft })),
      courts: courtRows,
    });
  });

  // Rate limited with the other writes, so codes can't be guessed by trying thousands.
  router.post('/referrals/check', writeLimiter, async (req, res) => {
    const { code, pricePaise } = parseBody(referralCheck, req.body);
    const program = await loadProgram(db);
    await validateCode(db, code, program);
    res.json({ discountPaise: discountFor(program, pricePaise), offer: describeOffer(program) });
  });

  router.post('/memberships', writeLimiter, async (req, res) => {
    if (!paymentTestMode) throw onlineOff();
    const v = parseBody(joinRequest, req.body);
    const today = venueToday();
    if (v.startsOn < today || v.startsOn > addDays(today, LATEST_START_DAYS)) throw invalid(`Choose a start date within the next ${LATEST_START_DAYS} days.`);

    const id = crypto.randomUUID();
    const token = membershipToken(id);
    await db.transaction(async (tx) => {
      await releaseExpiredHolds(tx);
      const [plan] = await tx.select().from(membershipPlans).where(and(eq(membershipPlans.id, v.planId), eq(membershipPlans.active, true)));
      if (!plan) throw invalid('Choose a plan.');
      const [venue] = await tx.select().from(settings).where(eq(settings.id, 1));
      const [{ live }] = (await tx
        .select({ live: sql<number>`count(*)::int` })
        .from(memberships)
        .where(and(eq(memberships.email, v.email), eq(memberships.status, 'pending_payment'), gt(memberships.holdExpiresAt, new Date())))) as [{ live: number }];
      if (live >= MAX_LIVE_HOLDS) throw new AppError(409, 'TOO_MANY_HOLDS', 'You already have memberships waiting for payment. Finish or release those first.');

      const endsOn = monthEnd(v.startsOn);
      const base = {
        id,
        kind: plan.kind,
        planId: plan.id,
        holderName: v.name,
        phone: v.phone,
        email: v.email,
        startsOn: v.startsOn,
        endsOn,
        source: 'website' as const,
        status: 'pending_payment' as const,
        accessTokenHash: hashToken(token),
        holdExpiresAt: new Date(Date.now() + venue!.holdMinutes * 60_000),
      };

      if (plan.kind === 'individual') {
        if (!v.batchId) throw invalid('Choose a batch.');
        const batch = await takeBatchSeat(tx, v.batchId, v.startsOn, endsOn);
        if (batch.planId !== plan.id) throw invalid('That batch belongs to another plan.', 'WRONG_PLAN');
        const referral = await claimReferral(tx, v.referralCode, { phone: v.phone, email: v.email, pricePaise: plan.pricePaise });
        await tx.insert(memberships).values({ ...base, batchId: batch.id, pricePaise: plan.pricePaise, membershipNo: sql`dk_number('MEM-', nextval('individual_member_number_seq'), 4)` });
        await addPeriod(tx, id, v.startsOn, endsOn, plan.pricePaise - (referral?.discountPaise ?? 0), { discountPaise: referral?.discountPaise ?? 0 });
        await recordRedemption(tx, id, referral);
      } else {
        const courtIds = [...new Set(v.courtIds ?? [])];
        const days = [...new Set(v.days ?? [])].sort();
        const startMinute = toMinutes(v.start ?? '');
        if (!courtIds.length) throw invalid('Choose at least one court.');
        if (!days.length) throw invalid('Choose at least one day.');
        if (startMinute === null) throw invalid('Choose a time.');
        const time = { days, startMinute, endMinute: startMinute + venue!.slotMinutes };
        const pricePaise = plan.pricePaise * courtIds.length;
        const referral = await claimReferral(tx, v.referralCode, { phone: v.phone, email: v.email, pricePaise });
        const [row] = await tx.insert(memberships).values({ ...base, ...time, pricePaise, membershipNo: sql`dk_number('CRT-', nextval('court_member_number_seq'), 4)` }).returning();
        await tx.insert(membershipCourts).values(courtIds.map((courtId) => ({ membershipId: id, courtId })));
        await startCourtBlocks(tx, id, row!.membershipNo, courtIds, time, v.startsOn, endsOn);
        await addPeriod(tx, id, v.startsOn, endsOn, pricePaise - (referral?.discountPaise ?? 0), { discountPaise: referral?.discountPaise ?? 0 });
        await recordRedemption(tx, id, referral);
      }
      await writeAudit({ action: 'membership.held_online', entityType: 'membership', entityId: id, req }, tx);
    });
    res.status(201).json({ token, membership: publicView(await byToken(token)) });
  });

  router.get('/memberships/:token', async (req, res) => {
    await releaseExpiredHolds();
    res.json({ membership: publicView(await byToken(String(req.params.token))) });
  });

  // Test mode only, like bookings: stands in for the gateway and never moves real money.
  router.post('/memberships/:token/pay', writeLimiter, async (req, res) => {
    if (!paymentTestMode) throw onlineOff();
    const token = String(req.params.token);
    const { result } = parseBody(z.object({ result: z.enum(['success', 'failure'], { error: 'Choose a test result.' }) }), req.body);
    const failed = await db.transaction(async (tx) => {
      const { membership } = await byToken(token, tx);
      const [locked] = await tx.select().from(memberships).where(eq(memberships.id, membership.id)).for('update');
      if (locked!.status === 'active') return false;
      if (locked!.status !== 'pending_payment' || locked!.holdExpiresAt! <= new Date()) throw holdGone();
      if (result === 'failure') return true;
      await tx.update(memberships).set({ status: 'active', holdExpiresAt: null, updatedAt: new Date() }).where(eq(memberships.id, locked!.id));
      const [period] = await tx.select().from(membershipPeriods).where(eq(membershipPeriods.membershipId, locked!.id));
      if (period!.amountPaise > 0) await tx.insert(payments).values({ periodId: period!.id, amountPaise: period!.amountPaise, method: 'online_test', reference: 'Test mode' });
      await writeAudit({ action: 'membership.confirmed_online', entityType: 'membership', entityId: locked!.id, req }, tx);
      await ensureMemberCode(tx, locked!.id);
      await settleReferral(tx, locked!.id);
      await enqueueMembershipMessage(tx, locked!.id, 'confirmed');
      await enqueueStaffMembershipAlert(tx, locked!.id);
      return false;
    });
    if (failed) throw new AppError(402, 'PAYMENT_FAILED', 'The payment didn’t go through. Your place is still held, so you can try again.');
    res.json({ membership: publicView(await byToken(token)) });
  });

  router.post('/memberships/:token/release', async (req, res) => {
    const token = String(req.params.token);
    await db.transaction(async (tx) => {
      const { membership } = await byToken(token, tx);
      const [locked] = await tx.select().from(memberships).where(eq(memberships.id, membership.id)).for('update');
      if (locked!.status !== 'pending_payment') throw new AppError(409, 'NOT_HELD', 'This membership isn’t waiting for payment.');
      await releaseFutureBlocks(tx, { membershipId: locked!.id }, new Date(0));
      await tx.update(memberships).set({ status: 'expired', holdExpiresAt: null, updatedAt: new Date() }).where(eq(memberships.id, locked!.id));
    });
    res.json({ membership: publicView(await byToken(token)) });
  });
}

