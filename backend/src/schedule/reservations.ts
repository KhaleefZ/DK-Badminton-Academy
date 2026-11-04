import { and, eq, gte, lte } from 'drizzle-orm';
import { db, type DbOrTx } from '../db/client.js';
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
export async function requireOpen(date: string, start: number, end: number, conn: DbOrTx = db) {
  const [period] = await conn
    .select({ id: openingHours.id })
    .from(openingHours)
    .where(and(eq(openingHours.weekday, weekdayOf(date)), lte(openingHours.openMinute, start), gte(openingHours.closeMinute, end)))
    .limit(1);
  if (!period) throw new AppError(409, 'OUTSIDE_HOURS', 'The venue isn’t open for all of that time. Check the opening hours in Settings.');
}

async function requireBookable(courtId: string, startsAt: Date, endsAt: Date, conn: DbOrTx) {
  await releaseExpiredHolds(conn);
  const [court] = await conn.select({ active: courts.active }).from(courts).where(eq(courts.id, courtId));
  if (!court?.active) throw invalid('That court isn’t available.', 'COURT_UNAVAILABLE');
  if (await closureDuring(courtId, startsAt, endsAt, conn)) throw new AppError(409, 'COURT_CLOSED', 'That court is closed for some of this time.');
}

/** Changes a reservation's court or time. A clash is refused by the database, so nothing moves. */
export async function moveReservation(id: string, change: { courtId: string; startsAt: Date; endsAt: Date }, conn: DbOrTx = db) {
  await requireBookable(change.courtId, change.startsAt, change.endsAt, conn);
  const [row] = await conn.update(courtReservations).set(change).where(eq(courtReservations.id, id)).returning();
  return row!;
}

export async function setReservationStatus(id: string, status: 'active' | 'released', conn: DbOrTx = db) {
  await conn.update(courtReservations).set({ status }).where(eq(courtReservations.id, id));
}

/** The one way to hold court time. If it clashes, the database refuses it and the caller gets SLOT_TAKEN. */
export async function createReservation(values: NewReservation, conn: DbOrTx = db) {
  if (values.startsAt >= values.endsAt) throw invalid('The end time must be after the start time.');
  await requireBookable(values.courtId, values.startsAt, values.endsAt, conn);
  const [row] = await conn.insert(courtReservations).values(values).returning();
  return row!;
}
