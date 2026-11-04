import { and, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client.js';
import { courtReservations, courts, memberBatches, memberships, membershipCourts, membershipPeriods, payments } from '../db/schema.js';
import { AppError } from '../lib/errors.js';
import { addDays, instantAt, monthEnd, toTime, venueToday, weekdayOf } from '../lib/time.js';
import { closureDuring, releaseExpiredHolds } from '../schedule/availability.js';
import { createReservation, requireOpen } from '../schedule/reservations.js';

const CLASHES_SHOWN = 5;

export type WeeklyTime = { courtId: string; days: number[]; startMinute: number; endMinute: number };

export function datesBetween(from: string, to: string, days: number[]): string[] {
  const dates = [];
  for (let date = from; date <= to; date = addDays(date, 1)) if (days.includes(weekdayOf(date))) dates.push(date);
  return dates;
}

/**
 * Holds a court at a weekly time across a date range. All or nothing: any clash refuses the
 * lot, and says which dates. Dates the court is closed are skipped, as nobody can play then anyway.
 */
export async function holdWeeklyTime(conn: DbOrTx, time: WeeklyTime, from: string, to: string, link: { batchId?: string; membershipId?: string; note: string; createdBy?: string | null }) {
  await releaseExpiredHolds(conn);
  const dates = datesBetween(from, to, time.days);
  if (!dates.length) throw new AppError(409, 'NO_DATES', 'Those days don’t fall inside these dates.');

  const seenWeekdays = new Set<number>();
  const clashes: string[] = [];
  const open: string[] = [];
  for (const date of dates) {
    const startsAt = instantAt(date, time.startMinute);
    const endsAt = instantAt(date, time.endMinute);
    if (await closureDuring(time.courtId, startsAt, endsAt, conn)) continue;
    const weekday = weekdayOf(date);
    if (!seenWeekdays.has(weekday)) {
      seenWeekdays.add(weekday);
      await requireOpen(date, time.startMinute, time.endMinute, conn);
    }
    const [held] = await conn
      .select({ id: courtReservations.id })
      .from(courtReservations)
      .where(and(eq(courtReservations.courtId, time.courtId), eq(courtReservations.status, 'active'), lt(courtReservations.startsAt, endsAt), gt(courtReservations.endsAt, startsAt)))
      .limit(1);
    if (held) clashes.push(date);
    else open.push(date);
  }
  if (clashes.length) {
    const [court] = await conn.select({ name: courts.name }).from(courts).where(eq(courts.id, time.courtId));
    const more = clashes.length > CLASHES_SHOWN ? ` and ${clashes.length - CLASHES_SHOWN} more` : '';
    throw new AppError(409, 'TIME_CLASH', `${court?.name ?? 'That court'} is already taken at ${toTime(time.startMinute)} on ${clashes.slice(0, CLASHES_SHOWN).join(', ')}${more}. Move or cancel those first, or choose another time.`);
  }
  for (const date of open) {
    // The database still has the last word if someone books between the check and here.
    await createReservation(
      { courtId: time.courtId, kind: 'member_block', note: link.note, batchId: link.batchId, membershipId: link.membershipId, createdBy: link.createdBy, startsAt: instantAt(date, time.startMinute), endsAt: instantAt(date, time.endMinute) },
      conn,
    );
  }
}

/** Gives back the blocks still ahead. Past ones stay as history. */
export async function releaseFutureBlocks(conn: DbOrTx, owner: { batchId: string } | { membershipId: string }, now = new Date()) {
  await conn
    .update(courtReservations)
    .set({ status: 'released' })
    .where(
      and(
        'batchId' in owner ? eq(courtReservations.batchId, owner.batchId) : eq(courtReservations.membershipId, owner.membershipId),
        eq(courtReservations.status, 'active'),
        gt(courtReservations.startsAt, now),
      ),
    );
}

/** Members holding a seat in a batch on or after `from`. */
export async function seatsTaken(conn: DbOrTx, batchId: string, from: string) {
  const [row] = await conn
    .select({ taken: sql<number>`count(*)::int` })
    .from(memberships)
    .where(and(eq(memberships.batchId, batchId), inArray(memberships.status, ['active', 'pending_payment']), isNull(memberships.deletedAt), sql`${memberships.endsOn} >= ${from}`));
  return row!.taken;
}

/** Locks the batch, so two people can't take its last seat at the same moment. */
export async function takeBatchSeat(conn: DbOrTx, batchId: string, startsOn: string, endsOn: string, excluding?: string) {
  await releaseExpiredHolds(conn);
  const [batch] = await conn.select().from(memberBatches).where(eq(memberBatches.id, batchId)).for('update');
  if (!batch?.active) throw new AppError(409, 'BATCH_UNAVAILABLE', 'That batch isn’t available.');
  if (startsOn < batch.startsOn || endsOn > batch.endsOn) throw new AppError(409, 'OUTSIDE_BATCH', `This batch only runs from ${batch.startsOn} to ${batch.endsOn}. Extend the batch first, or choose another.`);
  const taken = await seatsTaken(conn, batchId, startsOn);
  // Only subtract this member if the count above actually included them.
  const own = excluding ? (await conn.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.id, excluding), eq(memberships.batchId, batchId), sql`${memberships.endsOn} >= ${startsOn}`))).length : 0;
  if (taken - own >= batch.capacity) throw new AppError(409, 'BATCH_FULL', 'That batch is full.');
  return batch;
}

export const courtIdsOf = async (conn: DbOrTx, membershipId: string) =>
  (await conn.select({ courtId: membershipCourts.courtId }).from(membershipCourts).where(eq(membershipCourts.membershipId, membershipId))).map((r) => r.courtId);

/** Starts a membership's first month. Court memberships also take their courts here. */
export async function startCourtBlocks(conn: DbOrTx, membershipId: string, membershipNo: string, courtIds: string[], time: Omit<WeeklyTime, 'courtId'>, from: string, to: string, createdBy?: string | null) {
  for (const courtId of courtIds) await holdWeeklyTime(conn, { ...time, courtId }, from, to, { membershipId, note: `Court membership ${membershipNo}`, createdBy });
}

export const nextPeriod = (endsOn: string, today = venueToday()) => {
  const startsOn = endsOn < today ? today : addDays(endsOn, 1);
  return { startsOn, endsOn: monthEnd(startsOn) };
};

export const periodPaid = async (conn: DbOrTx, periodId: string) => {
  const [row] = await conn
    .select({ paid: sql<number>`coalesce(sum(${payments.amountPaise}), 0)::int` })
    .from(payments)
    .where(and(eq(payments.periodId, periodId), isNull(payments.voidedAt)));
  return row!.paid;
};

export const addPeriod = async (conn: DbOrTx, membershipId: string, startsOn: string, endsOn: string, amountPaise: number, adjustments: { discountPaise?: number; creditPaise?: number } = {}) => {
  const [row] = await conn.insert(membershipPeriods).values({ membershipId, startsOn, endsOn, amountPaise, ...adjustments }).returning();
  return row!;
};
