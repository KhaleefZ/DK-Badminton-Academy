import { Router } from 'express';
import { and, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { bookings, customers, membershipPeriods, memberships, paymentIssues, paymentMethod, payments } from '../db/schema.js';
import { auditEntry, auditIfChanged } from '../lib/audit.js';
import { AppError, invalid, notFound } from '../lib/errors.js';
import { customerMatches, likeTerm, ilike } from '../lib/search.js';
import { instantAt, isDate } from '../lib/time.js';
import { parseBody, UUID } from '../lib/validate.js';
import { currentAuth, requirePasswordCurrent, requirePermission, requireSession } from '../middleware/auth.js';
import { buildGateway, GatewayError, savedGatewayKeys } from '../payments/gateway.js';
import { refundPayment } from '../payments/settle.js';

const voidBody = z.object({ reason: z.string({ error: 'Enter why this receipt is being voided.' }).trim().min(1, 'Enter why this receipt is being voided.').max(300) });
const refundBody = z.object({
  reason: z.string({ error: 'Enter why this payment is being refunded.' }).trim().min(1, 'Enter why this payment is being refunded.').max(300),
  // Leave out for a full refund (or whatever is left of it).
  amountPaise: z.number({ error: 'Enter the amount to refund.' }).int('Enter a valid amount.').positive('Enter an amount above ₹0.').optional(),
});

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
          q ? sql`(${ilike(payments.receiptNo, likeTerm(q))} OR ${ilike(bookings.bookingNo, likeTerm(q))} OR ${ilike(memberships.membershipNo, likeTerm(q))} OR ${ilike(memberships.holderName, likeTerm(q))} OR ${customerMatches(q)})` : undefined,
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
    const [before] = await db.select().from(payments).where(eq(payments.id, id));
    if (!before) throw notFound('That receipt');
    if (before.voidedAt) throw invalid('This receipt is already voided.', 'ALREADY_VOIDED');
    // Voiding an online payment would hide money the customer really paid; it must be refunded instead.
    if (before.method === 'online') throw invalid('An online payment is refunded, not voided. Use Refund.', 'USE_REFUND');
    const change = { voidedAt: new Date(), voidReason: reason, voidedBy: staffId };
    // "Not yet voided" is part of the update, so two people voiding at once can't both succeed.
    const [[row]] = await db.batch([
      db.update(payments).set(change).where(and(eq(payments.id, id), isNull(payments.voidedAt))).returning(),
      auditIfChanged({ action: 'payment.voided', actorStaffId: staffId, entityType: 'payment', entityId: id, oldValues: before, newValues: { ...before, ...change }, req }),
    ]);
    if (!row) throw invalid('This receipt is already voided.', 'ALREADY_VOIDED');
    res.json({ payment: row });
  });

  /** Sends an online payment back through the gateway it came in on. The receipt is marked refunded and voided. */
  router.post('/:id/refund', requirePermission('payments.void'), async (req, res) => {
    const id = String(req.params.id);
    if (!UUID.test(id)) throw notFound('That receipt');
    const { reason, amountPaise } = parseBody(refundBody, req.body);
    const [receipt] = await db.select().from(payments).where(eq(payments.id, id));
    if (!receipt) throw notFound('That receipt');
    const keys = await savedGatewayKeys();
    if (!keys) throw invalid('No payment gateway is set up, so this can’t be refunded here. Refund it from the gateway dashboard.', 'NO_GATEWAY');
    try {
      res.json({ payment: await refundPayment(buildGateway(keys), receipt, reason, currentAuth(req).staff.id, amountPaise) });
    } catch (err) {
      if (err instanceof GatewayError) throw new AppError(409, 'REFUND_FAILED', err.message);
      throw err;
    }
  });

  /** Online payments staff need to look at: refunds made automatically, and anything that didn't add up. */
  router.get('/issues', requirePermission('payments.view'), async (_req, res) => {
    const rows = await db
      .select({ issue: paymentIssues, bookingNo: bookings.bookingNo, membershipNo: memberships.membershipNo })
      .from(paymentIssues)
      .leftJoin(bookings, eq(paymentIssues.bookingId, bookings.id))
      .leftJoin(memberships, eq(paymentIssues.membershipId, memberships.id))
      .where(isNull(paymentIssues.resolvedAt))
      .orderBy(desc(paymentIssues.createdAt))
      .limit(100);
    res.json({ issues: rows.map(({ issue, ...rest }) => ({ ...issue, ...rest })) });
  });

  router.post('/issues/:id/resolve', requirePermission('payments.void'), async (req, res) => {
    const id = String(req.params.id);
    if (!UUID.test(id)) throw notFound('That item');
    const staffId = currentAuth(req).staff.id;
    const [[done]] = await db.batch([
      db.update(paymentIssues).set({ resolvedAt: new Date(), resolvedBy: staffId }).where(and(eq(paymentIssues.id, id), isNull(paymentIssues.resolvedAt))).returning(),
      auditIfChanged({ action: 'payment_issue.resolved', actorStaffId: staffId, entityType: 'payment_issue', entityId: id, req }),
    ]);
    if (!done) throw notFound('That item');
    res.json({ issue: done });
  });

  return router;
}
