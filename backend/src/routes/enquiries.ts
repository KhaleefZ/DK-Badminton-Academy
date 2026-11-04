import { Router } from 'express';
import type { Request } from 'express';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { enquiries, enquiryStatus } from '../db/schema.js';
import { writeAudit } from '../lib/audit.js';
import { notFound } from '../lib/errors.js';
import { likeTerm } from '../lib/search.js';
import { parseBody, UUID } from '../lib/validate.js';
import { currentAuth, requirePasswordCurrent, requirePermission, requireSession } from '../middleware/auth.js';

const update = z.object({
  status: z.enum(enquiryStatus.enumValues, { error: 'Choose a status.' }),
  notes: z.string().trim().max(2000).nullish().transform((v) => v || null),
});

async function findEnquiry(req: Request) {
  const id = String(req.params.id);
  if (!UUID.test(id)) throw notFound('That enquiry');
  const [row] = await db.select().from(enquiries).where(eq(enquiries.id, id));
  if (!row) throw notFound('That enquiry');
  return row;
}

export function enquiriesRouter(): Router {
  const router = Router();
  router.use(requireSession, requirePasswordCurrent, requirePermission('enquiries.manage'));
  const actor = (req: Request) => currentAuth(req).staff.id;

  router.get('/', async (req, res) => {
    const status = enquiryStatus.enumValues.find((s) => s === req.query.status);
    const q = String(req.query.q ?? '').trim().slice(0, 100);
    const term = likeTerm(q);
    const rows = await db
      .select()
      .from(enquiries)
      .where(
        and(
          status ? eq(enquiries.status, status) : undefined,
          q ? sql`(${enquiries.enquiryNo} ILIKE ${term} OR ${enquiries.name} ILIKE ${term} OR ${enquiries.email} ILIKE ${term} OR ${enquiries.phone} ILIKE ${term} OR ${enquiries.message} ILIKE ${term})` : undefined,
        ),
      )
      .orderBy(desc(enquiries.createdAt))
      .limit(200);
    res.json({ enquiries: rows });
  });

  router.patch('/:id', async (req, res) => {
    const before = await findEnquiry(req);
    const values = parseBody(update, req.body);
    const row = await db.transaction(async (tx) => {
      const [updated] = await tx.update(enquiries).set({ ...values, updatedAt: new Date() }).where(eq(enquiries.id, before.id)).returning();
      await writeAudit({ action: 'enquiry.updated', actorStaffId: actor(req), entityType: 'enquiry', entityId: before.id, oldValues: { status: before.status }, newValues: { status: values.status }, req }, tx);
      return updated;
    });
    res.json({ enquiry: row });
  });

  router.delete('/:id', async (req, res) => {
    const before = await findEnquiry(req);
    await db.transaction(async (tx) => {
      await tx.delete(enquiries).where(eq(enquiries.id, before.id));
      await writeAudit({ action: 'enquiry.deleted', actorStaffId: actor(req), entityType: 'enquiry', entityId: before.id, oldValues: { enquiryNo: before.enquiryNo, name: before.name }, req }, tx);
    });
    res.status(204).end();
  });

  return router;
}
