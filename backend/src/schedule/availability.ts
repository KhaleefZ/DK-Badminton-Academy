import { and, asc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import { db, type DbOrTx } from '../db/client.js';
import { closures, courtReservations, courts, openingHours, priceRules, settings } from '../db/schema.js';
import { addDays, instantAt, toTime, venueToday, weekdayOf } from '../lib/time.js';

type Rule = { courtId: string | null; startMinute: number; endMinute: number; ratePaise: number };

/** Adds up a slot minute by minute, so one that crosses a rate change is charged fairly. Null if any minute has no rate. */
export function slotPrice(rules: Rule[], courtId: string, start: number, end: number): number | null {
  let total = 0;
  for (let minute = start; minute < end; minute += 1) {
    const covers = (r: Rule) => minute >= r.startMinute && minute < r.endMinute;
    const rule = rules.find((r) => r.courtId === courtId && covers(r)) ?? rules.find((r) => r.courtId === null && covers(r));
    if (!rule) return null;
    total += rule.ratePaise / 60;
  }
  return Math.round(total);
}

/** Website holds that ran out of time give their slot back. Checked whenever slots matter, so no background job is needed. */
export async function releaseExpiredHolds(conn: DbOrTx = db) {
  await conn.execute(sql`
    WITH expired AS (
      UPDATE bookings SET status = 'expired', updated_at = now()
      WHERE status = 'pending_payment' AND hold_expires_at <= now()
      RETURNING reservation_id
    )
    UPDATE court_reservations SET status = 'released' WHERE id IN (SELECT reservation_id FROM expired)
  `);
  await conn.execute(sql`
    WITH expired AS (
      UPDATE memberships SET status = 'expired', hold_expires_at = NULL, updated_at = now()
      WHERE status = 'pending_payment' AND hold_expires_at <= now()
      RETURNING id
    )
    UPDATE court_reservations SET status = 'released' WHERE membership_id IN (SELECT id FROM expired)
  `);
}

/** What a court and time cost at today's rates, or null if a minute has no price. */
export async function quote(courtId: string, date: string, start: number, end: number, conn: DbOrTx = db) {
  const weekday = weekdayOf(date);
  const rules = await conn.select().from(priceRules);
  return slotPrice(rules.filter((r) => r.days.includes(weekday)), courtId, start, end);
}

export async function availabilityFor(date: string, now = new Date()) {
  await releaseExpiredHolds();
  const dayStart = instantAt(date, 0);
  const dayEnd = instantAt(date, 1440);
  const weekday = weekdayOf(date);
  const inDay = <T extends typeof closures | typeof courtReservations>(t: T) => and(lt(t.startsAt, dayEnd), gt(t.endsAt, dayStart));

  const [[venue], courtRows, periods, rules, shut, held] = await Promise.all([
    db.select().from(settings).where(eq(settings.id, 1)),
    db.select().from(courts).where(eq(courts.active, true)).orderBy(asc(courts.sortOrder), asc(courts.name)),
    db.select().from(openingHours).where(eq(openingHours.weekday, weekday)).orderBy(asc(openingHours.openMinute)),
    db.select().from(priceRules),
    db.select().from(closures).where(inDay(closures)),
    db.select().from(courtReservations).where(and(eq(courtReservations.status, 'active'), inDay(courtReservations))),
  ]);
  const todaysRules = rules.filter((r) => r.days.includes(weekday));
  const { slotMinutes, advanceBookingDays, minNoticeMinutes } = venue!;
  const lastOnlineDate = addDays(venueToday(now), advanceBookingDays);
  const earliestOnline = new Date(now.getTime() + minNoticeMinutes * 60_000);

  return {
    date,
    slotMinutes,
    holdMinutes: venue!.holdMinutes,
    lastOnlineDate,
    courts: courtRows.map((court) => {
      const slots = periods.flatMap(({ openMinute, closeMinute }) => {
        const count = Math.floor((closeMinute - openMinute) / slotMinutes);
        return Array.from({ length: count }, (_, i) => {
          const start = openMinute + i * slotMinutes;
          const end = start + slotMinutes;
          const startsAt = instantAt(date, start);
          const endsAt = instantAt(date, end);
          const overlaps = (r: { startsAt: Date; endsAt: Date }) => r.startsAt < endsAt && r.endsAt > startsAt;
          const closure = shut.find((c) => (c.courtId === null || c.courtId === court.id) && overlaps(c));
          const reservation = held.find((r) => r.courtId === court.id && overlaps(r));
          const status = closure ? 'closed' : reservation ? 'reserved' : startsAt <= now ? 'past' : 'free';
          const pricePaise = slotPrice(todaysRules, court.id, start, end);
          return {
            start: toTime(start),
            end: toTime(end),
            status,
            pricePaise,
            reservationId: reservation?.id ?? null,
            reservationKind: reservation?.kind ?? null,
            closureReason: closure?.reason ?? null,
            // Staff can take any free slot; the website also has to respect these limits.
            onlineBookable: status === 'free' && pricePaise !== null && date <= lastOnlineDate && startsAt >= earliestOnline,
          };
        });
      });
      return { id: court.id, name: court.name, slots };
    }),
  };
}

/** Active reservations a new closure would clash with. They're reported to the Owner, never cancelled silently. */
export async function reservationsDuring(courtId: string | null, startsAt: Date, endsAt: Date) {
  return db
    .select({ id: courtReservations.id, courtName: courts.name, kind: courtReservations.kind, startsAt: courtReservations.startsAt, endsAt: courtReservations.endsAt })
    .from(courtReservations)
    .innerJoin(courts, eq(courtReservations.courtId, courts.id))
    .where(
      and(
        eq(courtReservations.status, 'active'),
        lt(courtReservations.startsAt, endsAt),
        gt(courtReservations.endsAt, startsAt),
        courtId ? eq(courtReservations.courtId, courtId) : undefined,
      ),
    )
    .orderBy(asc(courtReservations.startsAt));
}

export async function closureDuring(courtId: string, startsAt: Date, endsAt: Date, conn: DbOrTx = db) {
  const [row] = await conn
    .select({ id: closures.id })
    .from(closures)
    .where(and(lt(closures.startsAt, endsAt), gt(closures.endsAt, startsAt), or(isNull(closures.courtId), eq(closures.courtId, courtId))))
    .limit(1);
  return row;
}
