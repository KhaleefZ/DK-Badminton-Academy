import { and, eq, gt, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { db, type Work } from '../db/client.js';
import { closures, courtReservations, courts, memberBatches, memberships, membershipCourts, membershipPeriods, payments } from '../db/schema.js';
import { AppError } from '../lib/errors.js';
import { addDays, instantAt, monthEnd, toTime, venueToday, weekdayOf } from '../lib/time.js';
import { releaseExpiredHolds } from '../schedule/availability.js';
import { requireOpen } from '../schedule/reservations.js';

const CLASHES_SHOWN = 5;

export type WeeklyTime = { courtId: string; days: number[]; startMinute: number; endMinute: number };

export function datesBetween(from: string, to: string, days: number[]): string[] {
  const dates = [];
  for (let date = from; date <= to; date = addDays(date, 1)) if (days.includes(weekdayOf(date))) dates.push(date);
  return dates;
}

const overlaps = (a: { startsAt: Date; endsAt: Date }, startsAt: Date, endsAt: Date) => a.startsAt < endsAt && a.endsAt > startsAt;

/**
 * Holds a court at a weekly time across a date range. All or nothing: any clash refuses the
 * lot, and says which dates. Dates the court is closed are skipped, as nobody can play then anyway.
 * The blocks are added to `work`; a database trigger still refuses any that clash when it saves.
 */
export async function holdWeeklyTime(work: Work, time: WeeklyTime, from: string, to: string, link: { batchId?: string; membershipId?: string; note: string | SQL; createdBy?: string | null; replacingOwn?: boolean }) {
  await releaseExpiredHolds();
  const dates = datesBetween(from, to, time.days);
  if (!dates.length) throw new AppError(409, 'NO_DATES', 'Those days don’t fall inside these dates.');

  const [court] = await db.select({ name: courts.name, active: courts.active }).from(courts).where(eq(courts.id, time.courtId));
  if (!court?.active) throw new AppError(400, 'COURT_UNAVAILABLE', 'That court isn’t available.');

  // Everything that could get in the way across the whole range, read once rather than per date.
  const rangeStart = instantAt(dates[0]!, 0);
  const rangeEnd = instantAt(dates.at(-1)!, 1440);
  const [shut, held] = await db.batch([
    db
      .select({ startsAt: closures.startsAt, endsAt: closures.endsAt })
      .from(closures)
      .where(and(lt(closures.startsAt, rangeEnd), gt(closures.endsAt, rangeStart), or(isNull(closures.courtId), eq(closures.courtId, time.courtId)))),
    db
      .select({ startsAt: courtReservations.startsAt, endsAt: courtReservations.endsAt })
      .from(courtReservations)
      .where(
        and(
          eq(courtReservations.courtId, time.courtId),
          eq(courtReservations.status, 'active'),
          lt(courtReservations.startsAt, rangeEnd),
          gt(courtReservations.endsAt, rangeStart),
          // Blocks this batch or membership is giving up in the same change don't count as clashes.
          link.replacingOwn && link.batchId ? sql`${courtReservations.batchId} IS NOT ${link.batchId}` : undefined,
          link.replacingOwn && link.membershipId ? sql`${courtReservations.membershipId} IS NOT ${link.membershipId}` : undefined,
        ),
      ),
  ]);

  const seenWeekdays = new Set<number>();
  const clashes: string[] = [];
  const open: { startsAt: Date; endsAt: Date }[] = [];
  for (const date of dates) {
    const startsAt = instantAt(date, time.startMinute);
    const endsAt = instantAt(date, time.endMinute);
    if (shut.some((c) => overlaps(c, startsAt, endsAt))) continue;
    const weekday = weekdayOf(date);
    if (!seenWeekdays.has(weekday)) {
      seenWeekdays.add(weekday);
      await requireOpen(date, time.startMinute, time.endMinute);
    }
    if (held.some((r) => overlaps(r, startsAt, endsAt))) clashes.push(date);
    else open.push({ startsAt, endsAt });
  }
  if (clashes.length) {
    const more = clashes.length > CLASHES_SHOWN ? ` and ${clashes.length - CLASHES_SHOWN} more` : '';
    throw new AppError(409, 'TIME_CLASH', `${court.name} is already taken at ${toTime(time.startMinute)} on ${clashes.slice(0, CLASHES_SHOWN).join(', ')}${more}. Move or cancel those first, or choose another time.`);
  }
  // One insert per block: D1 allows 100 values per statement, and they all save in the same batch anyway.
  for (const slot of open) {
    work.add(db.insert(courtReservations).values({ courtId: time.courtId, kind: 'member_block', note: link.note, batchId: link.batchId, membershipId: link.membershipId, createdBy: link.createdBy, ...slot }));
  }
}

/** Gives back the blocks still ahead. Past ones stay as history. Returned unrun, to go in a batch. */
export const releaseFutureBlocks = (owner: { batchId: string } | { membershipId: string }, now = new Date()) =>
  db
    .update(courtReservations)
    .set({ status: 'released' })
    .where(
      and(
        'batchId' in owner ? eq(courtReservations.batchId, owner.batchId) : eq(courtReservations.membershipId, owner.membershipId),
        eq(courtReservations.status, 'active'),
        gt(courtReservations.startsAt, now),
      ),
    );

/** Members holding a seat in a batch on or after `from`. */
export async function seatsTaken(batchId: string, from: string) {
  const [row] = await db
    .select({ taken: sql<number>`count(*)` })
    .from(memberships)
    .where(and(eq(memberships.batchId, batchId), inArray(memberships.status, ['active', 'pending_payment']), isNull(memberships.deletedAt), sql`${memberships.endsOn} >= ${from}`));
  return row!.taken;
}

/**
 * Checks the batch has a seat for these dates. A database trigger makes the same check when the
 * membership saves, so two people can't take its last seat at the same moment.
 */
export async function takeBatchSeat(batchId: string, startsOn: string, endsOn: string, excluding?: string) {
  await releaseExpiredHolds();
  const [batch] = await db.select().from(memberBatches).where(eq(memberBatches.id, batchId));
  if (!batch?.active) throw new AppError(409, 'BATCH_UNAVAILABLE', 'That batch isn’t available.');
  if (startsOn < batch.startsOn || endsOn > batch.endsOn) throw new AppError(409, 'OUTSIDE_BATCH', `This batch only runs from ${batch.startsOn} to ${batch.endsOn}. Extend the batch first, or choose another.`);
  const taken = await seatsTaken(batchId, startsOn);
  // Only subtract this member if the count above actually included them.
  const own = excluding ? (await db.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.id, excluding), eq(memberships.batchId, batchId), sql`${memberships.endsOn} >= ${startsOn}`))).length : 0;
  if (taken - own >= batch.capacity) throw new AppError(409, 'BATCH_FULL', 'That batch is full.');
  return batch;
}

export const courtIdsOf = async (membershipId: string) =>
  (await db.select({ courtId: membershipCourts.courtId }).from(membershipCourts).where(eq(membershipCourts.membershipId, membershipId))).map((r) => r.courtId);

/**
 * Court memberships take their courts here. The note names the membership by number, read from the
 * database, because a new membership's number is only given out when the batch saves.
 */
export async function startCourtBlocks(work: Work, membershipId: string, courtIds: string[], time: Omit<WeeklyTime, 'courtId'>, from: string, to: string, createdBy?: string | null, replacingOwn = false) {
  const note = sql`'Court membership ' || (SELECT ${memberships.membershipNo} FROM ${memberships} WHERE ${memberships.id} = ${membershipId})`;
  for (const courtId of courtIds) await holdWeeklyTime(work, { ...time, courtId }, from, to, { membershipId, note, createdBy, replacingOwn });
}

export const nextPeriod = (endsOn: string, today = venueToday()) => {
  const startsOn = endsOn < today ? today : addDays(endsOn, 1);
  return { startsOn, endsOn: monthEnd(startsOn) };
};

export const periodPaid = async (periodId: string) => {
  const [row] = await db
    .select({ paid: sql<number>`coalesce(sum(${payments.amountPaise} - ${payments.refundedPaise}), 0)` })
    .from(payments)
    .where(and(eq(payments.periodId, periodId), isNull(payments.voidedAt)));
  return row!.paid;
};

/** Adds a month to `work` and returns the row it will save, id included, so a payment can point at it. */
export const addPeriod = (work: Work, membershipId: string, startsOn: string, endsOn: string, amountPaise: number, adjustments: { discountPaise?: number; creditPaise?: number } = {}) => {
  const row = { id: crypto.randomUUID(), membershipId, startsOn, endsOn, amountPaise, discountPaise: adjustments.discountPaise ?? 0, creditPaise: adjustments.creditPaise ?? 0 };
  work.add(db.insert(membershipPeriods).values(row));
  return row;
};
