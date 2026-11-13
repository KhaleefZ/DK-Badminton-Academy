import { Router } from 'express';
import type { Request } from 'express';
import { and, asc, desc, eq, gte, lt, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db, previousChanged, runBatch, type Statement } from '../db/client.js';
import { bookings, courtReservations, courts, customers, messages, paymentMethod, payments } from '../db/schema.js';
import { auditEntry, auditIfChanged } from '../lib/audit.js';
import { customerDetails, WALK_IN_NUMBER } from '../lib/customers.js';
import { AppError, invalid, notFound } from '../lib/errors.js';
import { customerMatches, likeTerm, ilike } from '../lib/search.js';
import { instantAt, isDate, periodView, toMinutes } from '../lib/time.js';
import { parseBody, UUID } from '../lib/validate.js';
import { hashToken } from '../auth/crypto.js';
import { currentAuth, requirePasswordCurrent, requirePermission, requireSession } from '../middleware/auth.js';
import { bookingToken, customerWhatsappUrl } from '../messages/links.js';
import { enqueueBookingMessage } from '../messages/queue.js';
import { quote, releaseExpiredHolds } from '../schedule/availability.js';
import { prepareMove, prepareReservation, requireOpen, setReservationStatus } from '../schedule/reservations.js';

const paidSql = sql<number>`coalesce((SELECT sum(p.amount_paise) FROM payments p WHERE p.booking_id = bookings.id AND p.voided_at IS NULL), 0)`;

/** A date and two times, checked and turned into minutes. Used by bookings and blocks. */
export const courtTime = z
  .object({
    courtId: z.string({ error: 'Choose a court.' }).regex(UUID, 'Choose a court.'),
    date: z.string({ error: 'Choose a date.' }).refine(isDate, 'Choose a valid date.'),
    start: z.string({ error: 'Enter a start time.' }),
    end: z.string({ error: 'Enter an end time.' }),
  })
  .transform((value, ctx) => {
    const start = toMinutes(value.start);
    const end = toMinutes(value.end);
    if (start === null || end === null) {
      ctx.addIssue({ code: 'custom', message: 'Enter times as HH:MM.' });
      return z.NEVER;
    }
    if (start >= end) {
      ctx.addIssue({ code: 'custom', message: 'The end time must be after the start time.' });
      return z.NEVER;
    }
    return { courtId: value.courtId, date: value.date, start, end, startsAt: instantAt(value.date, start), endsAt: instantAt(value.date, end) };
  });

const money = z.number({ error: 'Enter an amount.' }).int('Enter a valid amount.').min(0, 'An amount can’t be negative.').max(100_000_000, 'That amount is too high.');
const bookingExtras = z.object({
  amountPaise: money.nullish(),
  notes: z.string().trim().max(1000).nullish().transform((v) => v || null),
});
const newBooking = bookingExtras.extend({
  customerId: z.string().regex(UUID, 'Choose a customer.').nullish(),
  newCustomer: customerDetails.nullish(),
});
const paymentDetails = z.object({
  amountPaise: z.number({ error: 'Enter an amount.' }).int('Enter a valid amount.').positive('Enter an amount above ₹0.').max(100_000_000, 'That amount is too high.'),
  method: z.enum(paymentMethod.enumValues, { error: 'Choose cash or UPI.' }),
  reference: z.string().trim().max(100).nullish().transform((v) => v || null),
});
const reason = z.object({ reason: z.string().trim().max(300).nullish().transform((v) => v || null) });

const fullBooking = () =>
  db
    .select({ booking: bookings, customer: customers, reservation: courtReservations, courtName: courts.name, paidPaise: paidSql })
    .from(bookings)
    .innerJoin(customers, eq(bookings.customerId, customers.id))
    .innerJoin(courtReservations, eq(bookings.reservationId, courtReservations.id))
    .innerJoin(courts, eq(courtReservations.courtId, courts.id));

type FullBooking = Awaited<ReturnType<typeof fullBooking>>[number];

function bookingView({ booking, customer, reservation, courtName, paidPaise }: FullBooking, now = new Date()) {
  const cancelled = booking.status === 'cancelled' || booking.status === 'expired';
  const held = booking.status === 'pending_payment';
  const outstandingPaise = cancelled || held ? 0 : Math.max(booking.amountPaise - paidPaise, 0);
  return {
    id: booking.id,
    bookingNo: booking.bookingNo,
    reservationId: booking.reservationId,
    status: booking.status,
    source: booking.source,
    amountPaise: booking.amountPaise,
    paidPaise,
    outstandingPaise,
    // Money kept on a cancelled booking waits for the refund rules, so staff must be able to see it.
    paidOnCancelledPaise: cancelled ? paidPaise : 0,
    paymentState: booking.status === 'expired' ? 'Expired' : cancelled ? 'Cancelled' : held ? 'Held' : outstandingPaise > 0 ? 'Due' : 'Paid',
    session: cancelled ? 'Cancelled' : reservation.endsAt <= now ? 'Completed' : 'Upcoming',
    notes: booking.notes,
    cancelReason: booking.cancelReason,
    cancelledAt: booking.cancelledAt,
    holdExpiresAt: booking.holdExpiresAt,
    createdAt: booking.createdAt,
    courtId: reservation.courtId,
    courtName,
    ...periodView(reservation.startsAt, reservation.endsAt),
    customer: { id: customer.id, customerNo: customer.customerNo, name: customer.name, phone: customer.phone, email: customer.email, type: customer.type, deleted: Boolean(customer.deletedAt) },
  };
}

export async function bookingViews(where: SQL | undefined, limit = 500) {
  const rows = await fullBooking().where(where).orderBy(asc(courtReservations.startsAt)).limit(limit);
  return rows.map((row) => bookingView(row));
}

export const bookingSearch = (q: string) => or(sql`${ilike(bookings.bookingNo, likeTerm(q))}`, sql`${ilike(bookings.notes, likeTerm(q))}`, customerMatches(q));

async function findBooking(id: string) {
  const [row] = await db.select().from(bookings).where(eq(bookings.id, id));
  if (!row) throw notFound('That booking');
  return row;
}

const paidOn = async (bookingId: string) => {
  const [row] = await db
    .select({ paid: sql<number>`coalesce(sum(${payments.amountPaise}), 0)` })
    .from(payments)
    .where(and(eq(payments.bookingId, bookingId), sql`${payments.voidedAt} IS NULL`));
  return row!.paid;
};

const requireId = (req: Request) => {
  const id = String(req.params.id);
  if (!UUID.test(id)) throw notFound('That booking');
  return id;
};

const paymentView = (p: typeof payments.$inferSelect) => ({
  id: p.id,
  receiptNo: p.receiptNo,
  amountPaise: p.amountPaise,
  method: p.method,
  reference: p.reference,
  receivedAt: p.receivedAt,
  voidedAt: p.voidedAt,
  voidReason: p.voidReason,
});

async function findOne(where: SQL) {
  const [row] = await fullBooking().where(where);
  if (!row) throw notFound('That booking');
  return bookingView(row);
}

export function bookingsRouter(): Router {
  const router = Router();
  router.use(requireSession, requirePasswordCurrent, requirePermission('bookings.manage'));
  const actor = (req: Request) => currentAuth(req).staff.id;
  const audit = (req: Request, action: string, entityId: string, oldValues?: unknown, newValues?: unknown) =>
    auditEntry({ action, actorStaffId: actor(req), entityType: 'booking', entityId, oldValues, newValues, req });
  const auditIfDone = (req: Request, action: string, entityId: string, oldValues?: unknown, newValues?: unknown) =>
    auditIfChanged({ action, actorStaffId: actor(req), entityType: 'booking', entityId, oldValues, newValues, req });

  router.get('/', async (req, res) => {
    const { date, q, payment, session } = req.query;
    if (date !== undefined && !isDate(date)) throw invalid('Choose a valid date.');
    const term = String(q ?? '').trim().slice(0, 100);
    await releaseExpiredHolds();
    const rows = await bookingViews(
      and(
        date ? and(gte(courtReservations.startsAt, instantAt(date as string, 0)), lt(courtReservations.startsAt, instantAt(date as string, 1440))) : undefined,
        term ? bookingSearch(term) : undefined,
        // In the query, not after it, so a long history can't push a due out of the limit.
        payment === 'Due' ? and(eq(bookings.status, 'active'), sql`${bookings.amountPaise} > ${paidSql}`) : undefined,
      ),
    );
    res.json({ bookings: rows.filter((b) => (!payment || b.paymentState === payment) && (!session || b.session === session)) });
  });

  /** The usual price, for filling in the booking form. */
  router.get('/quote', async (req, res) => {
    const time = parseBody(courtTime, req.query);
    res.json({ pricePaise: await quote(time.courtId, time.date, time.start, time.end) });
  });

  router.post('/', async (req, res) => {
    const time = parseBody(courtTime, req.body);
    const details = parseBody(newBooking, req.body);
    if (!details.customerId && !details.newCustomer) throw invalid('Choose a customer.');

    await requireOpen(time.date, time.start, time.end);
    const amountPaise = details.amountPaise ?? (await quote(time.courtId, time.date, time.start, time.end));
    if (amountPaise === null) throw invalid('No price is set for this time, so enter an amount.', 'NO_PRICE');

    const steps: Statement[] = [];
    let customerId = details.customerId;
    if (customerId) {
      const [found] = await db.select().from(customers).where(eq(customers.id, customerId));
      if (!found || found.deletedAt) throw invalid('Choose a customer.');
    } else {
      customerId = crypto.randomUUID();
      steps.push(
        db.insert(customers).values({ ...details.newCustomer!, id: customerId, type: 'walk_in', customerNo: WALK_IN_NUMBER() }),
        auditEntry({ action: 'customer.created', actorStaffId: actor(req), entityType: 'customer', entityId: customerId, newValues: { ...details.newCustomer, id: customerId, type: 'walk_in' }, req }),
      );
    }
    const reservation = await prepareReservation({ courtId: time.courtId, kind: 'booking', startsAt: time.startsAt, endsAt: time.endsAt, createdBy: actor(req) });
    const id = crypto.randomUUID();
    const booking = { id, customerId, reservationId: reservation.id, amountPaise, notes: details.notes, createdBy: actor(req) };
    // All or nothing: if the court was taken meanwhile, the database refuses the lot and no customer is left behind.
    await runBatch([
      ...steps,
      reservation.insert,
      db.insert(bookings).values({ ...booking, accessTokenHash: hashToken(bookingToken(id)) }),
      audit(req, 'booking.created', id, undefined, { ...booking, ...time }),
    ]);
    await enqueueBookingMessage(id, 'confirmed', actor(req));
    const created = { id };
    res.status(201).json({ booking: await findOne(eq(bookings.id, created.id)) });
  });

  // Search links use the booking number, so accept either it or the internal id.
  router.get('/:id', async (req, res) => {
    const id = String(req.params.id);
    const booking = await findOne(UUID.test(id) ? eq(bookings.id, id) : eq(bookings.bookingNo, id.toUpperCase()));
    const receipts = await db.select().from(payments).where(eq(payments.bookingId, booking.id)).orderBy(desc(payments.receivedAt));
    const sent = await db
      .select({ id: messages.id, channel: messages.channel, template: messages.template, status: messages.status, sentAt: messages.sentAt, createdAt: messages.createdAt, lastError: messages.lastError })
      .from(messages)
      .where(eq(messages.bookingId, booking.id))
      .orderBy(desc(messages.createdAt))
      .limit(20);
    res.json({ booking, payments: receipts.map(paymentView), messages: sent, whatsappUrl: customerWhatsappUrl(booking) });
  });

  router.patch('/:id', async (req, res) => {
    const id = requireId(req);
    const time = parseBody(courtTime, req.body);
    const details = parseBody(bookingExtras, req.body);
    const before = await findBooking(id);
    if (before.status !== 'active') throw invalid('Only a confirmed booking can be edited.', 'BOOKING_CANCELLED');
    const [reservation] = await db.select().from(courtReservations).where(eq(courtReservations.id, before.reservationId));
    const moved = reservation!.courtId !== time.courtId || reservation!.startsAt.getTime() !== time.startsAt.getTime() || reservation!.endsAt.getTime() !== time.endsAt.getTime();
    const steps: Statement[] = [];
    if (moved) {
      await requireOpen(time.date, time.start, time.end);
      steps.push((await prepareMove(before.reservationId, { courtId: time.courtId, startsAt: time.startsAt, endsAt: time.endsAt })).update);
    }
    const amountPaise = details.amountPaise ?? before.amountPaise;
    if (amountPaise < (await paidOn(id))) throw invalid('The amount can’t be less than what’s already been paid. Void a payment first.', 'BELOW_PAID');
    const change = { amountPaise, notes: details.notes, updatedAt: new Date() };
    await runBatch([
      ...steps,
      db.update(bookings).set(change).where(eq(bookings.id, id)),
      audit(req, 'booking.updated', id, { ...before, accessTokenHash: undefined, startsAt: reservation!.startsAt, endsAt: reservation!.endsAt, courtId: reservation!.courtId }, { ...before, ...change, accessTokenHash: undefined, ...time }),
    ]);
    if (moved) await enqueueBookingMessage(id, 'changed', actor(req));
    res.json({ booking: await findOne(eq(bookings.id, id)) });
  });

  router.post('/:id/cancel', async (req, res) => {
    const id = requireId(req);
    const { reason: cancelReason } = parseBody(reason, req.body ?? {});
    const before = await findBooking(id);
    if (before.status === 'cancelled' || before.status === 'expired') throw invalid('This booking is already cancelled.', 'BOOKING_CANCELLED');
    // The booking changes only if it's still in the state just read; the slot and record follow only if it did.
    const [cancelled] = await db.batch([
      db
        .update(bookings)
        .set({ status: 'cancelled', cancelReason, cancelledAt: new Date(), updatedAt: new Date() })
        .where(and(eq(bookings.id, id), eq(bookings.status, before.status)))
        .returning({ id: bookings.id }),
      db.update(courtReservations).set({ status: 'released' }).where(and(eq(courtReservations.id, before.reservationId), previousChanged)),
      auditIfDone(req, 'booking.cancelled', id, undefined, { cancelReason }),
    ]);
    if (!cancelled.length) throw invalid('This booking is already cancelled.', 'BOOKING_CANCELLED');
    // Someone who never finished paying was never told they had a booking.
    if (before.status === 'active') await enqueueBookingMessage(id, 'cancelled', actor(req));
    res.json({ booking: await findOne(eq(bookings.id, id)) });
  });

  router.post('/:id/restore', async (req, res) => {
    const id = requireId(req);
    const before = await findBooking(id);
    if (before.status !== 'cancelled') throw invalid('Only a cancelled booking can be restored.', 'BOOKING_ACTIVE');
    // If someone else has taken the time since, the database refuses this with SLOT_TAKEN and nothing changes.
    const [restored] = await db.batch([
      db
        .update(bookings)
        .set({ status: 'active', cancelReason: null, cancelledAt: null, updatedAt: new Date() })
        .where(and(eq(bookings.id, id), eq(bookings.status, 'cancelled')))
        .returning({ id: bookings.id }),
      db.update(courtReservations).set({ status: 'active' }).where(and(eq(courtReservations.id, before.reservationId), previousChanged)),
      auditIfDone(req, 'booking.restored', id),
    ]);
    if (!restored.length) throw invalid('Only a cancelled booking can be restored.', 'BOOKING_ACTIVE');
    await enqueueBookingMessage(id, 'confirmed', actor(req));
    res.json({ booking: await findOne(eq(bookings.id, id)) });
  });

  router.post('/:id/resend-email', requirePermission('messages.manage'), async (req, res) => {
    const id = requireId(req);
    const booking = await findBooking(id);
    if (booking.status !== 'active') throw invalid('Only a confirmed booking can be resent.', 'BOOKING_CANCELLED');
    const queued = await enqueueBookingMessage(id, 'confirmed', actor(req));
    if (!queued) throw invalid('This customer has no email address.', 'NO_EMAIL');
    res.status(202).json({ queued: true });
  });

  // WhatsApp opens on the staff member's own phone or computer, so this only records that they tapped it.
  router.post('/:id/whatsapp-opened', requirePermission('messages.manage'), async (req, res) => {
    const id = requireId(req);
    const booking = await findOne(eq(bookings.id, id));
    await db.insert(messages).values({
      channel: 'whatsapp',
      template: 'booking_whatsapp',
      recipient: booking.customer.phone ?? '',
      subject: `WhatsApp about ${booking.bookingNo}`,
      body: 'Opened in WhatsApp by staff.',
      status: 'sent',
      sentAt: new Date(),
      bookingId: id,
      createdBy: actor(req),
    });
    res.status(204).end();
  });

  router.post('/:id/payments', requirePermission('payments.record'), async (req, res) => {
    const id = requireId(req);
    const values = parseBody(paymentDetails, req.body);
    const booking = await findBooking(id);
    if (booking.status !== 'active') throw invalid('Only a confirmed booking can take a payment.', 'BOOKING_CANCELLED');
    const left = booking.amountPaise - (await paidOn(id));
    if (values.amountPaise > left) throw new AppError(409, 'OVERPAYMENT', 'That’s more than this booking still owes. Refresh and check the balance.');
    // A database trigger repeats the "still owed" check, so two receipts entered at once can't overpay.
    const payment = { id: crypto.randomUUID(), ...values, bookingId: id, recordedBy: actor(req) };
    const [[receipt]] = await db.batch([
      db.insert(payments).values(payment).returning(),
      auditEntry({ action: 'payment.recorded', actorStaffId: actor(req), entityType: 'payment', entityId: payment.id, newValues: payment, req }),
    ]);
    res.status(201).json({ payment: paymentView(receipt!), booking: await findOne(eq(bookings.id, id)) });
  });

  return router;
}

