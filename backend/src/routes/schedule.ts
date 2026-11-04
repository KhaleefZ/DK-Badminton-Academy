import { Router } from 'express';
import { and, eq, gte, lt, ne } from 'drizzle-orm';
import { db } from '../db/client.js';
import { courtReservations, courts } from '../db/schema.js';
import { invalid } from '../lib/errors.js';
import { instantAt, isDate, periodView } from '../lib/time.js';
import { requirePasswordCurrent, requirePermission, requireSession } from '../middleware/auth.js';
import { availabilityFor } from '../schedule/availability.js';
import { bookingViews } from './bookings.js';

/** One day for the staff calendar: the slots, plus who holds each. */
export function scheduleRouter(): Router {
  const router = Router();
  router.use(requireSession, requirePasswordCurrent, requirePermission('bookings.manage'));

  router.get('/', async (req, res) => {
    const { date } = req.query;
    if (!isDate(date)) throw invalid('Choose a valid date.');
    const from = instantAt(date, 0);
    const to = instantAt(date, 1440);
    const [availability, dayBookings, blockRows] = await Promise.all([
      availabilityFor(date),
      bookingViews(and(gte(courtReservations.startsAt, from), lt(courtReservations.startsAt, to))),
      db
        .select({ reservation: courtReservations, courtName: courts.name })
        .from(courtReservations)
        .innerJoin(courts, eq(courtReservations.courtId, courts.id))
        .where(and(ne(courtReservations.kind, 'booking'), eq(courtReservations.status, 'active'), gte(courtReservations.startsAt, from), lt(courtReservations.startsAt, to))),
    ]);
    res.json({
      ...availability,
      bookings: dayBookings,
      blocks: blockRows.map(({ reservation: r, courtName }) => ({ id: r.id, kind: r.kind, note: r.note, courtId: r.courtId, courtName, ...periodView(r.startsAt, r.endsAt) })),
    });
  });

  return router;
}
