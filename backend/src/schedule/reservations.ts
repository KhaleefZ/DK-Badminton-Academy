import { and, eq, gte, lte } from 'drizzle-orm';
import { db } from '../db/client.js';
import { courtReservations, courts, openingHours, reservationKind } from '../db/schema.js';
import { AppError, invalid } from '../lib/errors.js';
import { weekdayOf } from '../lib/time.js';
import { closureDuring, releaseExpiredHolds } from './availability.js';

type NewReservation = {
  courtId: string;
  kind: (typeof reservationKind.enumValues)[number];
  startsAt: Date;
  endsAt: Date;
  note?: string | null;
  createdBy?: string | null;
  batchId?: string | null;
  membershipId?: string | null;
};

/** Staff bookings and blocks must fit inside one opening period, so a typing slip can't book 3 am. */
export async function requireOpen(date: string, start: number, end: number) {
  const [period] = await db
    .select({ id: openingHours.id })
    .from(openingHours)
    .where(and(eq(openingHours.weekday, weekdayOf(date)), lte(openingHours.openMinute, start), gte(openingHours.closeMinute, end)))
    .limit(1);
  if (!period) throw new AppError(409, 'OUTSIDE_HOURS', 'The venue isn’t open for all of that time. Check the opening hours in Settings.');
}

async function requireBookable(courtId: string, startsAt: Date, endsAt: Date) {
  await releaseExpiredHolds();
  const [court] = await db.select({ active: courts.active }).from(courts).where(eq(courts.id, courtId));
  if (!court?.active) throw invalid('That court isn’t available.', 'COURT_UNAVAILABLE');
  if (await closureDuring(courtId, startsAt, endsAt)) throw new AppError(409, 'COURT_CLOSED', 'That court is closed for some of this time.');
}

/**
 * Checks a new reservation and returns its insert unrun, with its id already chosen, so the caller
 * can batch it with the rows that point at it. A clash is refused by a database trigger (SLOT_TAKEN)
 * when the batch runs, so nothing in the batch is saved.
 */
export async function prepareReservation(values: NewReservation) {
  if (values.startsAt >= values.endsAt) throw invalid('The end time must be after the start time.');
  await requireBookable(values.courtId, values.startsAt, values.endsAt);
  const id = crypto.randomUUID();
  return { id, insert: db.insert(courtReservations).values({ ...values, id }).returning() };
}

/** The one way to hold court time on its own. */
export async function createReservation(values: NewReservation) {
  const { insert } = await prepareReservation(values);
  const [row] = await insert;
  return row!;
}

/**
 * Checks a move to another court or time and returns the update unrun. A clash is refused by the database.
 * Wrapped in an object: an async function returning a query directly would run it, as promises unwrap anything with `then`.
 */
export async function prepareMove(id: string, change: { courtId: string; startsAt: Date; endsAt: Date }) {
  await requireBookable(change.courtId, change.startsAt, change.endsAt);
  return { update: db.update(courtReservations).set(change).where(eq(courtReservations.id, id)) };
}

/** Returned unrun, so it can join a batch; awaiting it runs it on its own. */
export const setReservationStatus = (id: string, status: 'active' | 'released') => db.update(courtReservations).set({ status }).where(eq(courtReservations.id, id));
