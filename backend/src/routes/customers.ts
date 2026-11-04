import { Router } from 'express';
import type { Request } from 'express';
import { and, desc, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { bookings, courtReservations, customers, customerType } from '../db/schema.js';
import { writeAudit } from '../lib/audit.js';
import { AppError, notFound } from '../lib/errors.js';
import { customerDetails, WALK_IN_NUMBER } from '../lib/customers.js';
import { customerMatches } from '../lib/search.js';
import { parseBody, UUID } from '../lib/validate.js';
import { currentAuth, requirePasswordCurrent, requirePermission, requireSession } from '../middleware/auth.js';
import { bookingViews } from './bookings.js';

/** What's owed across a customer's active bookings. */
const dueSql = sql<number>`coalesce((
  SELECT sum(greatest(b.amount_paise - coalesce((SELECT sum(p.amount_paise) FROM payments p WHERE p.booking_id = b.id AND p.voided_at IS NULL), 0), 0))
  FROM bookings b WHERE b.customer_id = customers.id AND b.status = 'active'
), 0)::int`;
const bookingCountSql = sql<number>`(SELECT count(*) FROM bookings b WHERE b.customer_id = customers.id AND b.status = 'active')::int`;

async function findCustomer(req: Request) {
  const id = String(req.params.id);
  if (!UUID.test(id)) throw notFound('That customer');
  const [row] = await db.select().from(customers).where(eq(customers.id, id));
  if (!row) throw notFound('That customer');
  return row;
}

export function customersRouter(): Router {
  const router = Router();
  router.use(requireSession, requirePasswordCurrent, requirePermission('customers.manage'));
  const actor = (req: Request) => currentAuth(req).staff.id;

  router.get('/', async (req, res) => {
    const q = String(req.query.q ?? '').trim().slice(0, 100);
    const type = customerType.enumValues.find((t) => t === req.query.type);
    const trash = req.query.trash === 'true';
    const rows = await db
      .select({ customer: customers, duePaise: dueSql, bookingCount: bookingCountSql })
      .from(customers)
      .where(and(trash ? isNotNull(customers.deletedAt) : isNull(customers.deletedAt), type ? eq(customers.type, type) : undefined, q ? customerMatches(q) : undefined))
      .orderBy(desc(customers.createdAt))
      .limit(200);
    res.json({ customers: rows.map((r) => ({ ...r.customer, duePaise: r.duePaise, bookingCount: r.bookingCount })) });
  });

  router.post('/', async (req, res) => {
    const values = parseBody(customerDetails, req.body);
    const row = await db.transaction(async (tx) => {
      const [created] = await tx.insert(customers).values({ ...values, type: 'walk_in', customerNo: WALK_IN_NUMBER }).returning();
      await writeAudit({ action: 'customer.created', actorStaffId: actor(req), entityType: 'customer', entityId: created!.id, newValues: created, req }, tx);
      return created;
    });
    res.status(201).json({ customer: row });
  });

  router.get('/:id', async (req, res) => {
    const customer = await findCustomer(req);
    res.json({ customer, bookings: await bookingViews(eq(bookings.customerId, customer.id)) });
  });

  router.patch('/:id', async (req, res) => {
    const before = await findCustomer(req);
    if (before.deletedAt) throw notFound('That customer');
    const values = parseBody(customerDetails, req.body);
    const row = await db.transaction(async (tx) => {
      const [updated] = await tx.update(customers).set({ ...values, updatedAt: new Date() }).where(eq(customers.id, before.id)).returning();
      await writeAudit({ action: 'customer.updated', actorStaffId: actor(req), entityType: 'customer', entityId: before.id, oldValues: before, newValues: updated, req }, tx);
      return updated;
    });
    res.json({ customer: row });
  });

  // A deleted customer keeps their row, so past bookings and receipts still show who they were.
  router.delete('/:id', async (req, res) => {
    const before = await findCustomer(req);
    if (before.deletedAt) throw notFound('That customer');
    const upcoming = await db
      .select({ id: bookings.id })
      .from(bookings)
      .innerJoin(courtReservations, eq(bookings.reservationId, courtReservations.id))
      .where(and(eq(bookings.customerId, before.id), eq(bookings.status, 'active'), gt(courtReservations.endsAt, new Date())))
      .limit(1);
    if (upcoming.length) throw new AppError(409, 'CUSTOMER_HAS_BOOKINGS', 'This customer has upcoming bookings. Cancel them first.');
    await db.transaction(async (tx) => {
      await tx.update(customers).set({ deletedAt: new Date() }).where(eq(customers.id, before.id));
      await writeAudit({ action: 'customer.deleted', actorStaffId: actor(req), entityType: 'customer', entityId: before.id, oldValues: before, req }, tx);
    });
    res.status(204).end();
  });

  router.post('/:id/restore', async (req, res) => {
    const before = await findCustomer(req);
    const row = await db.transaction(async (tx) => {
      const [updated] = await tx.update(customers).set({ deletedAt: null }).where(eq(customers.id, before.id)).returning();
      await writeAudit({ action: 'customer.restored', actorStaffId: actor(req), entityType: 'customer', entityId: before.id, req }, tx);
      return updated;
    });
    res.json({ customer: row });
  });

  return router;
}
