import { Router } from 'express';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { bookings, customers, membershipPeriods, memberships, paymentMethod, payments } from '../db/schema.js';
import { writeAudit } from '../lib/audit.js';
import { invalid, notFound } from '../lib/errors.js';
import { customerMatches, likeTerm } from '../lib/search.js';
import { instantAt, isDate } from '../lib/time.js';
import { parseBody, UUID } from '../lib/validate.js';
import { currentAuth, requirePasswordCurrent, requirePermission, requireSession } from '../middleware/auth.js';

const voidBody = z.object({ reason: z.string({ error: 'Enter why this receipt is being voided.' }).trim().min(1, 'Enter why this receipt is being voided.').max(300) });

export function paymentsRouter(): Router {
  const router = Router();
  router.use(requireSession, requirePasswordCurrent);

  router.get('/', requirePermission('payments.view'), async (req, res) => {
    const { date } = req.query;
    if (date !== undefined && !isDate(date)) throw invalid('Choose a valid date.');
    const q = String(req.query.q ?? '').trim().slice(0, 100);
    const method = paymentMethod.enumValues.find((m) => m === req.query.method);
    const rows = await db
      .select({
        payment: payments,
        bookingNo: bookings.bookingNo,
        customerId: customers.id,
        customerName: sql<string>`coalesce(${customers.name}, ${memberships.holderName})`,
        customerNo: sql<string>`coalesce(${customers.customerNo}, ${memberships.membershipNo})`,
        membershipId: memberships.id,
        membershipNo: memberships.membershipNo,
      })
      .from(payments)
      .leftJoin(bookings, eq(payments.bookingId, bookings.id))
      .leftJoin(customers, eq(bookings.customerId, customers.id))
      .leftJoin(membershipPeriods, eq(payments.periodId, membershipPeriods.id))
      .leftJoin(memberships, eq(membershipPeriods.membershipId, memberships.id))
      .where(
        and(
          date ? and(gte(payments.receivedAt, instantAt(date as string, 0)), lt(payments.receivedAt, instantAt(date as string, 1440))) : undefined,
          method ? eq(payments.method, method) : undefined,
          q ? sql`(${payments.receiptNo} ILIKE ${likeTerm(q)} OR ${bookings.bookingNo} ILIKE ${likeTerm(q)} OR ${memberships.membershipNo} ILIKE ${likeTerm(q)} OR ${memberships.holderName} ILIKE ${likeTerm(q)} OR ${customerMatches(q)})` : undefined,
        ),
      )
      .orderBy(desc(payments.receivedAt))
      .limit(500);
    res.json({ payments: rows.map(({ payment, ...rest }) => ({ ...payment, ...rest })) });
  });

  router.post('/:id/void', requirePermission('payments.void'), async (req, res) => {
    const id = String(req.params.id);
    if (!UUID.test(id)) throw notFound('That receipt');
    const { reason } = parseBody(voidBody, req.body);
    const staffId = currentAuth(req).staff.id;
    const row = await db.transaction(async (tx) => {
      const [before] = await tx.select().from(payments).where(eq(payments.id, id)).for('update');
      if (!before) throw notFound('That receipt');
      if (before.voidedAt) throw invalid('This receipt is already voided.', 'ALREADY_VOIDED');
      const [updated] = await tx.update(payments).set({ voidedAt: new Date(), voidReason: reason, voidedBy: staffId }).where(eq(payments.id, id)).returning();
      await writeAudit({ action: 'payment.voided', actorStaffId: staffId, entityType: 'payment', entityId: id, oldValues: before, newValues: updated, req }, tx);
      return updated;
    });
    res.json({ payment: row });
  });

  return router;
}
