import { Router } from 'express';
import type { Request } from 'express';
import { and, asc, eq, gte, lt, ne } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { courtReservations, courts } from '../db/schema.js';
import { writeAudit } from '../lib/audit.js';
import { invalid, notFound } from '../lib/errors.js';
import { addDays, instantAt, isDate, periodView } from '../lib/time.js';
import { parseBody, UUID } from '../lib/validate.js';
import { currentAuth, requirePasswordCurrent, requirePermission, requireSession } from '../middleware/auth.js';
import { createReservation, moveReservation, requireOpen, setReservationStatus } from '../schedule/reservations.js';
import { courtTime } from './bookings.js';

const blockExtras = z.object({
  kind: z.enum(['member_block', 'staff_block'], { error: 'Choose what the block is for.' }),
  note: z.string({ error: 'Enter a label for this block.' }).trim().min(1, 'Enter a label for this block.').max(200),
  repeatWeeks: z.number().int().min(1).max(26, 'A block can repeat for at most 26 weeks.').default(1),
});

export function blocksRouter(): Router {
  const router = Router();
  router.use(requireSession, requirePasswordCurrent, requirePermission('bookings.manage'));
  const actor = (req: Request) => currentAuth(req).staff.id;

  const findBlock = async (req: Request) => {
    const id = String(req.params.id);
    if (!UUID.test(id)) throw notFound('That block');
    const [row] = await db.select().from(courtReservations).where(and(eq(courtReservations.id, id), ne(courtReservations.kind, 'booking'), eq(courtReservations.status, 'active')));
    if (!row) throw notFound('That block');
    return row;
  };

  router.get('/', async (req, res) => {
    const { date } = req.query;
    if (!isDate(date)) throw invalid('Choose a valid date.');
    const rows = await db
      .select({ reservation: courtReservations, courtName: courts.name })
      .from(courtReservations)
      .innerJoin(courts, eq(courtReservations.courtId, courts.id))
      .where(and(ne(courtReservations.kind, 'booking'), eq(courtReservations.status, 'active'), gte(courtReservations.startsAt, instantAt(date, 0)), lt(courtReservations.startsAt, instantAt(date, 1440))))
      .orderBy(asc(courtReservations.startsAt));
    res.json({
      blocks: rows.map(({ reservation: r, courtName }) => ({ id: r.id, kind: r.kind, note: r.note, courtId: r.courtId, courtName, ...periodView(r.startsAt, r.endsAt) })),
    });
  });

  // A repeating block is all or nothing: one clash in any week and none are created.
  router.post('/', async (req, res) => {
    const time = parseBody(courtTime, req.body);
    const { kind, note, repeatWeeks } = parseBody(blockExtras, req.body);
    const created = await db.transaction(async (tx) => {
      const rows = [];
      for (let week = 0; week < repeatWeeks; week += 1) {
        const date = addDays(time.date, week * 7);
        await requireOpen(date, time.start, time.end, tx);
        rows.push(await createReservation({ courtId: time.courtId, kind, note, startsAt: instantAt(date, time.start), endsAt: instantAt(date, time.end), createdBy: actor(req) }, tx));
      }
      await writeAudit({ action: 'block.created', actorStaffId: actor(req), entityType: 'block', entityId: rows[0]!.id, newValues: { kind, note, repeatWeeks, ...time }, req }, tx);
      return rows;
    });
    res.status(201).json({ created: created.length });
  });

  router.patch('/:id', async (req, res) => {
    const before = await findBlock(req);
    const time = parseBody(courtTime, req.body);
    const { kind, note } = parseBody(blockExtras, req.body);
    await db.transaction(async (tx) => {
      await requireOpen(time.date, time.start, time.end, tx);
      await moveReservation(before.id, { courtId: time.courtId, startsAt: time.startsAt, endsAt: time.endsAt }, tx);
      await tx.update(courtReservations).set({ kind, note }).where(eq(courtReservations.id, before.id));
      await writeAudit({ action: 'block.updated', actorStaffId: actor(req), entityType: 'block', entityId: before.id, oldValues: before, newValues: { kind, note, ...time }, req }, tx);
    });
    res.status(200).json({ ok: true });
  });

  router.delete('/:id', async (req, res) => {
    const before = await findBlock(req);
    await db.transaction(async (tx) => {
      await setReservationStatus(before.id, 'released', tx);
      await writeAudit({ action: 'block.deleted', actorStaffId: actor(req), entityType: 'block', entityId: before.id, oldValues: before, req }, tx);
    });
    res.status(204).end();
  });

  return router;
}
