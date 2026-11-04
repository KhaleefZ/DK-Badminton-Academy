import { Router } from 'express';
import type { Request, Response } from 'express';
import { and, asc, eq, gt, inArray, max } from 'drizzle-orm';
import { z } from 'zod';
import { db, DB_ERRORS, dbErrorCode, type DbOrTx } from '../db/client.js';
import { closures, courtReservations, courts, openingHours, priceRules, settings } from '../db/schema.js';
import { writeAudit } from '../lib/audit.js';
import { AppError, invalid, notFound } from '../lib/errors.js';
import { toMinutes, toTime } from '../lib/time.js';
import { parseBody, UUID } from '../lib/validate.js';
import { currentAuth, requirePasswordCurrent, requirePermission, requireSession } from '../middleware/auth.js';
import { reservationsDuring } from '../schedule/availability.js';

const optionalText = (limit: number) => z.string().trim().max(limit).nullish().transform((v) => v || null);
const timeOfDay = z.string().transform((value, ctx) => {
  const minutes = toMinutes(value);
  if (minutes === null) {
    ctx.addIssue({ code: 'custom', message: 'Enter times as HH:MM.' });
    return z.NEVER;
  }
  return minutes;
});
const courtRef = z.string().regex(UUID, 'Choose a court.').nullish().transform((v) => v ?? null);

const venueDetails = z.object({
  venueName: z.string().trim().min(1, 'Enter the venue name.').max(120),
  address: optionalText(300),
  phone: optionalText(20),
  email: z.union([z.literal(''), z.string().trim().toLowerCase().email('Enter a valid email.').max(254)]).nullish().transform((v) => v || null),
  slotMinutes: z.union([z.literal(30), z.literal(60)], { error: 'A slot must be 30 or 60 minutes.' }),
  advanceBookingDays: z.number({ error: 'Enter how many days ahead people can book.' }).int().min(0, 'Days ahead can’t be negative.').max(365, 'Days ahead can be at most 365.'),
  minNoticeMinutes: z.number({ error: 'Enter the booking notice in minutes.' }).int().min(0, 'Notice can’t be negative.').max(10080, 'Notice can be at most 7 days.'),
  holdMinutes: z.number({ error: 'Enter how long a slot is held for payment.' }).int().min(2, 'Hold a slot for at least 2 minutes.').max(60, 'Hold a slot for at most 60 minutes.').optional(),
});

const courtDetails = z.object({
  name: z.string().trim().min(1, 'Enter a court name.').max(60),
  sortOrder: z.number().int().min(0).max(999).optional(),
});

const period = z.object({ weekday: z.number().int().min(0).max(6), opens: timeOfDay, closes: timeOfDay }).refine((p) => p.opens < p.closes, 'Closing time must be after opening time.');
const hoursBody = z.object({ hours: z.array(period).max(50) });

const rule = z
  .object({
    courtId: courtRef,
    days: z.array(z.number().int().min(0).max(6)).min(1, 'Choose at least one day for each price.').max(7),
    start: timeOfDay,
    end: timeOfDay,
    ratePaise: z.number({ error: 'Enter a price for each row.' }).int('Enter a price in rupees and paise.').min(0, 'A price can’t be negative.').max(10_000_000, 'That price is too high.'),
  })
  .refine((r) => r.start < r.end, 'A price’s end time must be after its start time.');
const pricesBody = z.object({ rules: z.array(rule).max(100) });

const closureDetails = z
  .object({
    courtId: courtRef,
    startsAt: z.iso.datetime({ offset: true, error: 'Enter a start date and time.' }).transform((v) => new Date(v)),
    endsAt: z.iso.datetime({ offset: true, error: 'Enter an end date and time.' }).transform((v) => new Date(v)),
    reason: optionalText(200),
  })
  .refine((c) => c.startsAt < c.endsAt, 'The end must be after the start.');

const hourView = (h: typeof openingHours.$inferSelect) => ({ weekday: h.weekday, opens: toTime(h.openMinute), closes: toTime(h.closeMinute) });
const priceView = (r: typeof priceRules.$inferSelect) => ({ courtId: r.courtId, days: r.days, start: toTime(r.startMinute), end: toTime(r.endMinute), ratePaise: r.ratePaise });

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

async function requireKnownCourts(ids: (string | null)[]) {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
  if (!wanted.length) return;
  const found = await db.select({ id: courts.id }).from(courts).where(inArray(courts.id, wanted));
  if (found.length !== wanted.length) throw invalid('Choose a court.');
}

async function findCourt(req: Request) {
  const id = String(req.params.id);
  if (!UUID.test(id)) throw notFound('That court');
  const [row] = await db.select().from(courts).where(eq(courts.id, id));
  if (!row) throw notFound('That court');
  return row;
}

async function findClosure(req: Request) {
  const id = String(req.params.id);
  if (!UUID.test(id)) throw notFound('That closure');
  const [row] = await db.select().from(closures).where(eq(closures.id, id));
  if (!row) throw notFound('That closure');
  return row;
}

/** Courts share a generic unique-violation code with staff email, so the message is set here. */
async function withCourtName<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (dbErrorCode(err) === DB_ERRORS.uniqueViolation) throw new AppError(409, 'DUPLICATE_COURT', 'Another court already has that name.');
    throw err;
  }
}

export function settingsRouter(): Router {
  const router = Router();
  router.use(requireSession, requirePasswordCurrent);
  const owner = requirePermission('settings.manage');
  const audit = (conn: DbOrTx, req: Request, action: string, entityType: string, entityId: string, oldValues?: unknown, newValues?: unknown) =>
    writeAudit({ action, actorStaffId: currentAuth(req).staff.id, entityType, entityId, oldValues, newValues, req }, conn);

  // Every role reads this, because the schedule depends on it. Nothing in it is private.
  router.get('/', async (_req, res) => {
    const [[venue], courtRows, hours, rules, upcoming] = await Promise.all([
      db.select().from(settings).where(eq(settings.id, 1)),
      db.select().from(courts).orderBy(asc(courts.sortOrder), asc(courts.name)),
      db.select().from(openingHours).orderBy(asc(openingHours.weekday), asc(openingHours.openMinute)),
      db.select().from(priceRules).orderBy(asc(priceRules.startMinute)),
      db.select().from(closures).where(gt(closures.endsAt, new Date())).orderBy(asc(closures.startsAt)),
    ]);
    res.json({ settings: venue, courts: courtRows, hours: hours.map(hourView), prices: rules.map(priceView), closures: upcoming });
  });

  router.patch('/', owner, async (req, res) => {
    const values = parseBody(venueDetails, req.body);
    const [before] = await db.select().from(settings).where(eq(settings.id, 1));
    const row = await db.transaction(async (tx) => {
      const [updated] = await tx.update(settings).set({ ...values, updatedAt: new Date() }).where(eq(settings.id, 1)).returning();
      await audit(tx, req, 'settings.updated', 'settings', '1', before, updated);
      return updated;
    });
    res.json({ settings: row });
  });

  router.post('/courts', owner, async (req, res) => {
    const values = parseBody(courtDetails, req.body);
    const [{ last } = { last: 0 }] = await db.select({ last: max(courts.sortOrder) }).from(courts);
    const row = await withCourtName(() =>
      db.transaction(async (tx) => {
        const [created] = await tx.insert(courts).values({ sortOrder: (last ?? 0) + 1, ...values }).returning();
        await audit(tx, req, 'court.created', 'court', created!.id, undefined, created);
        return created;
      }),
    );
    res.status(201).json({ court: row });
  });

  router.patch('/courts/:id', owner, async (req, res) => {
    const before = await findCourt(req);
    const values = parseBody(courtDetails, req.body);
    const row = await withCourtName(() =>
      db.transaction(async (tx) => {
        const [updated] = await tx.update(courts).set({ ...values, updatedAt: new Date() }).where(eq(courts.id, before.id)).returning();
        await audit(tx, req, 'court.updated', 'court', before.id, before, updated);
        return updated;
      }),
    );
    res.json({ court: row });
  });

  const setActive = (active: boolean) => async (req: Request, res: Response) => {
    const before = await findCourt(req);
    if (!active) {
      const future = await db
        .select({ id: courtReservations.id })
        .from(courtReservations)
        .where(and(eq(courtReservations.courtId, before.id), eq(courtReservations.status, 'active'), gt(courtReservations.endsAt, new Date())))
        .limit(1);
      if (future.length) throw new AppError(409, 'COURT_HAS_RESERVATIONS', 'This court has upcoming reservations. Move or cancel them first.');
    }
    const row = await db.transaction(async (tx) => {
      const [updated] = await tx.update(courts).set({ active, updatedAt: new Date() }).where(eq(courts.id, before.id)).returning();
      await audit(tx, req, active ? 'court.activated' : 'court.deactivated', 'court', before.id, before, updated);
      return updated;
    });
    res.json({ court: row });
  };
  router.post('/courts/:id/deactivate', owner, setActive(false));
  router.post('/courts/:id/activate', owner, setActive(true));

  router.delete('/courts/:id', owner, async (req, res) => {
    const before = await findCourt(req);
    try {
      await db.transaction(async (tx) => {
        await tx.delete(courts).where(eq(courts.id, before.id));
        await audit(tx, req, 'court.deleted', 'court', before.id, before);
      });
    } catch (err) {
      if (dbErrorCode(err) === DB_ERRORS.foreignKeyViolation) {
        throw new AppError(409, 'COURT_IN_USE', 'This court has reservation history, so it can’t be deleted. Deactivate it instead.');
      }
      throw err;
    }
    res.status(204).end();
  });

  // Hours and prices are edited as a whole table and saved together, so a half-saved week can't exist.
  router.put('/hours', owner, async (req, res) => {
    const { hours } = parseBody(hoursBody, req.body);
    const sorted = [...hours].sort((a, b) => a.weekday - b.weekday || a.opens - b.opens);
    sorted.forEach((p, i) => {
      const next = sorted[i + 1];
      if (next && next.weekday === p.weekday && next.opens < p.closes) throw invalid(`${WEEKDAYS[p.weekday]} has opening periods that overlap.`);
    });
    const before = await db.select().from(openingHours);
    const rows = await db.transaction(async (tx) => {
      await tx.delete(openingHours);
      const saved = sorted.length
        ? await tx.insert(openingHours).values(sorted.map((p) => ({ weekday: p.weekday, openMinute: p.opens, closeMinute: p.closes }))).returning()
        : [];
      await audit(tx, req, 'settings.hours_updated', 'settings', '1', before.map(hourView), saved.map(hourView));
      return saved;
    });
    res.json({ hours: rows.map(hourView) });
  });

  router.put('/prices', owner, async (req, res) => {
    const { rules } = parseBody(pricesBody, req.body);
    rules.forEach((a, i) => {
      for (const b of rules.slice(i + 1)) {
        const sameDay = a.days.find((d) => b.days.includes(d));
        if (a.courtId === b.courtId && sameDay !== undefined && a.start < b.end && b.start < a.end) {
          throw invalid(`Two prices overlap on ${WEEKDAYS[sameDay]}. Each time can have only one price.`);
        }
      }
    });
    await requireKnownCourts(rules.map((r) => r.courtId));
    const before = await db.select().from(priceRules);
    const rows = await db.transaction(async (tx) => {
      await tx.delete(priceRules);
      const saved = rules.length
        ? await tx.insert(priceRules).values(rules.map((r) => ({ courtId: r.courtId, days: [...new Set(r.days)].sort(), startMinute: r.start, endMinute: r.end, ratePaise: r.ratePaise }))).returning()
        : [];
      await audit(tx, req, 'settings.prices_updated', 'settings', '1', before.map(priceView), saved.map(priceView));
      return saved;
    });
    res.json({ prices: rows.map(priceView) });
  });

  router.post('/closures', owner, async (req, res) => {
    const values = parseBody(closureDetails, req.body);
    await requireKnownCourts([values.courtId]);
    const row = await db.transaction(async (tx) => {
      const [created] = await tx.insert(closures).values(values).returning();
      await audit(tx, req, 'closure.created', 'closure', created!.id, undefined, created);
      return created;
    });
    res.status(201).json({ closure: row, conflicts: await reservationsDuring(values.courtId, values.startsAt, values.endsAt) });
  });

  router.patch('/closures/:id', owner, async (req, res) => {
    const before = await findClosure(req);
    const values = parseBody(closureDetails, req.body);
    await requireKnownCourts([values.courtId]);
    const row = await db.transaction(async (tx) => {
      const [updated] = await tx.update(closures).set(values).where(eq(closures.id, before.id)).returning();
      await audit(tx, req, 'closure.updated', 'closure', before.id, before, updated);
      return updated;
    });
    res.json({ closure: row, conflicts: await reservationsDuring(values.courtId, values.startsAt, values.endsAt) });
  });

  router.delete('/closures/:id', owner, async (req, res) => {
    const before = await findClosure(req);
    await db.transaction(async (tx) => {
      await tx.delete(closures).where(eq(closures.id, before.id));
      await audit(tx, req, 'closure.deleted', 'closure', before.id, before);
    });
    res.status(204).end();
  });

  return router;
}
