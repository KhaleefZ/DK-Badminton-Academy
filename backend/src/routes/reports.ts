import { Router } from 'express';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { bookings, courtReservations, courts, openingHours, payments } from '../db/schema.js';
import { invalid } from '../lib/errors.js';
import { addDays, instantAt, isDate, onVenueClock, weekdayOf } from '../lib/time.js';
import { UUID } from '../lib/validate.js';
import { requirePasswordCurrent, requirePermission, requireSession } from '../middleware/auth.js';

const MAX_DAYS = 370;
const DAYS_PER_PERIOD = 7;

/** Totals by week, from `from` to `to` inclusive. Occupancy compares booked time with opening hours on active courts. */
export function reportsRouter(): Router {
  const router = Router();
  router.use(requireSession, requirePasswordCurrent, requirePermission('reports.view'));

  router.get('/', async (req, res) => {
    const { from, to, courtId } = req.query;
    if (!isDate(from) || !isDate(to) || from > to) throw invalid('Choose a valid date range.');
    if (addDays(from, MAX_DAYS) < to) throw invalid('Choose a range of at most a year.');
    const court = courtId && UUID.test(String(courtId)) ? String(courtId) : null;
    const start = instantAt(from, 0);
    const end = instantAt(to, 1440);

    const [bookingRows, receipts, hours, activeCourts] = await Promise.all([
      db
        .select({ amountPaise: bookings.amountPaise, startsAt: courtReservations.startsAt, endsAt: courtReservations.endsAt })
        .from(bookings)
        .innerJoin(courtReservations, eq(bookings.reservationId, courtReservations.id))
        .where(and(eq(bookings.status, 'active'), gte(courtReservations.startsAt, start), lt(courtReservations.startsAt, end), court ? eq(courtReservations.courtId, court) : undefined)),
      db
        .select({ amountPaise: sql<number>`${payments.amountPaise} - ${payments.refundedPaise}`, receivedAt: payments.receivedAt, periodId: payments.periodId })
        .from(payments)
        .leftJoin(bookings, eq(payments.bookingId, bookings.id))
        .leftJoin(courtReservations, eq(bookings.reservationId, courtReservations.id))
        // Membership money isn't tied to one court, so a one-court report leaves it out.
        .where(and(sql`${payments.voidedAt} IS NULL`, gte(payments.receivedAt, start), lt(payments.receivedAt, end), court ? eq(courtReservations.courtId, court) : undefined)),
      db.select().from(openingHours),
      db.select({ id: courts.id }).from(courts).where(eq(courts.active, true)),
    ]);
    const courtCount = court ? 1 : activeCourts.length;

    const periods = [];
    for (let first = from; first <= to; first = addDays(first, DAYS_PER_PERIOD)) {
      const candidate = addDays(first, DAYS_PER_PERIOD - 1);
      const last = candidate > to ? to : candidate;
      const inPeriod = (date: string) => date >= first && date <= last;
      const booked = bookingRows.filter((b) => inPeriod(onVenueClock(b.startsAt).date));
      let openMinutes = 0;
      for (let day = first; day <= last; day = addDays(day, 1)) {
        const weekday = weekdayOf(day);
        openMinutes += hours.filter((h) => h.weekday === weekday).reduce((sum, h) => sum + h.closeMinute - h.openMinute, 0) * courtCount;
      }
      periods.push({
        from: first,
        to: last,
        bookings: booked.length,
        billedPaise: booked.reduce((sum, b) => sum + b.amountPaise, 0),
        receivedPaise: receipts.filter((p) => !p.periodId && inPeriod(onVenueClock(p.receivedAt).date)).reduce((sum, p) => sum + p.amountPaise, 0),
        membershipReceivedPaise: receipts.filter((p) => p.periodId && inPeriod(onVenueClock(p.receivedAt).date)).reduce((sum, p) => sum + p.amountPaise, 0),
        bookedMinutes: booked.reduce((sum, b) => sum + (b.endsAt.getTime() - b.startsAt.getTime()) / 60_000, 0),
        openMinutes,
      });
    }
    res.json({ periods });
  });

  return router;
}
