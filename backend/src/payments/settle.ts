import { and, asc, eq, gt, inArray, isNotNull, isNull, lt, notExists, or, sql } from 'drizzle-orm';
import { db, dbErrorCode, DB_ERRORS, previousChanged } from '../db/client.js';
import { bookings, courtReservations, customers, membershipPeriods, memberships, paymentIssues, payments } from '../db/schema.js';
import { auditEntry, auditIfChanged } from '../lib/audit.js';
import { ensureMemberCode, settleReferral } from '../memberships/referrals.js';
import { enqueueBookingMessage, enqueueMembershipMessage, enqueueStaffBookingAlert, enqueueStaffMembershipAlert } from '../messages/queue.js';
import type { Gateway, NewOrder } from './gateway.js';
import { GatewayError, onlinePayments } from './gateway.js';

// How long after an order the cron keeps asking the gateway about it, and how often.
const SWEEP_AFTER_MS = 2 * 60_000;
const SWEEP_FOR_MS = 45 * 60_000;
const SWEEP_BATCH = 5;

const LABELS = { cashfree: 'Cashfree', razorpay: 'Razorpay' } as const;

/** A fresh reference per attempt: gateways refuse a reused order id. Short enough for both (Razorpay allows 40). */
export const orderReference = (kind: 'bkg' | 'mem', id: string) => `${kind}-${id.replace(/-/g, '').slice(0, 20)}-${Date.now().toString(36)}`;

type Booking = typeof bookings.$inferSelect;
type Membership = typeof memberships.$inferSelect;

async function flag(issue: typeof paymentIssues.$inferInsert) {
  await db.insert(paymentIssues).values(issue);
}

/* ---------- Starting a payment ---------- */

/** Creates the gateway order for a held booking and remembers it, so its payment can be matched later. */
export async function startBookingCheckout(gateway: Gateway, booking: Booking, notifyUrl: string | undefined) {
  const [customer] = await db.select().from(customers).where(eq(customers.id, booking.customerId));
  return startCheckout(gateway, notifyUrl, {
    reference: orderReference('bkg', booking.id),
    amountPaise: booking.amountPaise,
    description: `Court booking ${booking.bookingNo}`,
    customer: { id: customer!.id, name: customer!.name, phone: customer!.phone ?? '', email: customer!.email },
    save: (orderId) => db.update(bookings).set({ gatewayOrderId: orderId, gatewayOrderAt: new Date(), gatewayCheckedAt: null }).where(eq(bookings.id, booking.id)),
  });
}

export async function startMembershipCheckout(gateway: Gateway, membership: Membership, amountPaise: number, notifyUrl: string | undefined) {
  return startCheckout(gateway, notifyUrl, {
    reference: orderReference('mem', membership.id),
    amountPaise,
    description: `Membership ${membership.membershipNo}`,
    customer: { id: membership.id, name: membership.holderName, phone: membership.phone, email: membership.email },
    save: (orderId) => db.update(memberships).set({ gatewayOrderId: orderId, gatewayOrderAt: new Date(), gatewayCheckedAt: null }).where(eq(memberships.id, membership.id)),
  });
}

async function startCheckout(gateway: Gateway, notifyUrl: string | undefined, order: Omit<NewOrder, 'notifyUrl'> & { save: (orderId: string) => PromiseLike<unknown> }) {
  const { save, ...details } = order;
  const created = await gateway.createOrder({ ...details, notifyUrl });
  await save(created.orderId);
  return created.checkout;
}

/* ---------- Settling a paid order ---------- */

export type Paid = { orderId: string; paymentId: string; amountPaise: number };
export type Settled = 'confirmed' | 'already' | 'refunded' | 'needs_attention' | 'unknown';

/**
 * The one place an online payment becomes a receipt. Called by the webhook, by the website's
 * "check my payment" request and by the cron sweep, in any order and any number of times:
 * the gateway's payment id is unique on receipts, so only the first call does anything.
 */
export async function settlePaidOrder(gateway: Gateway, paid: Paid): Promise<Settled> {
  const [seen] = await db.select({ id: payments.id }).from(payments).where(eq(payments.gatewayPaymentId, paid.paymentId));
  if (seen) return 'already';
  const [booking] = await db.select().from(bookings).where(eq(bookings.gatewayOrderId, paid.orderId));
  if (booking) return settleBooking(gateway, booking, paid);
  const [membership] = await db.select().from(memberships).where(eq(memberships.gatewayOrderId, paid.orderId));
  if (membership) return settleMembership(gateway, membership, paid);
  console.warn(`Payment ${paid.paymentId} for unknown order ${paid.orderId}`);
  return 'unknown';
}

/** Records the money. Returns null if it was already recorded, or if it's more than is owed (handled by the caller). */
async function recordReceipt(gateway: Gateway, paid: Paid, target: { bookingId: string } | { periodId: string }) {
  const id = crypto.randomUUID();
  try {
    await db.batch([
      db.insert(payments).values({
        id,
        ...target,
        amountPaise: paid.amountPaise,
        method: 'online',
        reference: `${LABELS[gateway.name]} ${paid.paymentId}`,
        gateway: gateway.name,
        gatewayOrderId: paid.orderId,
        gatewayPaymentId: paid.paymentId,
      }),
      auditEntry({ action: 'payment.received_online', entityType: 'payment', entityId: id, newValues: { ...target, amountPaise: paid.amountPaise, gateway: gateway.name, gatewayPaymentId: paid.paymentId } }),
    ]);
    return { ok: true as const, id };
  } catch (err) {
    const code = dbErrorCode(err);
    if (code === DB_ERRORS.uniqueViolation) return { ok: false as const, reason: 'already' as const };
    if (code === DB_ERRORS.overpayment) return { ok: false as const, reason: 'overpaid' as const };
    throw err;
  }
}

async function settleBooking(gateway: Gateway, booking: Booking, paid: Paid): Promise<Settled> {
  if (paid.amountPaise !== booking.amountPaise) {
    await flag({ bookingId: booking.id, amountPaise: paid.amountPaise, message: `Paid ₹${paid.amountPaise / 100} online but booking ${booking.bookingNo} is ₹${booking.amountPaise / 100}. Check the payment in the gateway dashboard.` });
    return 'needs_attention';
  }
  const receipt = await recordReceipt(gateway, paid, { bookingId: booking.id });
  if (!receipt.ok) {
    if (receipt.reason === 'already') return 'already';
    return refundWithoutReceipt(gateway, paid, { bookingId: booking.id }, `Booking ${booking.bookingNo} was already paid, so a second payment was refunded.`);
  }

  // Confirmed if it's still held, or if its hold ran out but nobody has taken the slot since.
  try {
    const [confirmed] = await db.batch([
      db
        .update(bookings)
        .set({ status: 'active', holdExpiresAt: null, updatedAt: new Date() })
        .where(and(eq(bookings.id, booking.id), inArray(bookings.status, ['pending_payment', 'expired'])))
        .returning({ id: bookings.id }),
      db.update(courtReservations).set({ status: 'active' }).where(and(eq(courtReservations.id, booking.reservationId), previousChanged)),
      auditIfChanged({ action: 'booking.confirmed_online', entityType: 'booking', entityId: booking.id }),
    ]);
    if (confirmed.length) {
      await enqueueBookingMessage(booking.id, 'confirmed');
      await enqueueStaffBookingAlert(booking.id);
      return 'confirmed';
    }
    const [now] = await db.select({ status: bookings.status }).from(bookings).where(eq(bookings.id, booking.id));
    if (now?.status === 'active') return 'already';
    return refundReceipt(gateway, receipt.id, `Booking ${booking.bookingNo} was cancelled before the payment arrived, so it was refunded.`, { bookingId: booking.id });
  } catch (err) {
    if (dbErrorCode(err) !== DB_ERRORS.exclusionViolation) throw err;
    return refundReceipt(gateway, receipt.id, `Booking ${booking.bookingNo} was paid after its hold ended and someone else had taken the slot, so it was refunded.`, { bookingId: booking.id });
  }
}

async function settleMembership(gateway: Gateway, membership: Membership, paid: Paid): Promise<Settled> {
  const [period] = await db.select().from(membershipPeriods).where(eq(membershipPeriods.membershipId, membership.id)).orderBy(asc(membershipPeriods.startsOn)).limit(1);
  if (!period || paid.amountPaise !== period.amountPaise) {
    await flag({ membershipId: membership.id, amountPaise: paid.amountPaise, message: `Paid ₹${paid.amountPaise / 100} online for membership ${membership.membershipNo}, which doesn't match what's owed. Check the payment in the gateway dashboard.` });
    return 'needs_attention';
  }
  const receipt = await recordReceipt(gateway, paid, { periodId: period.id });
  if (!receipt.ok) {
    if (receipt.reason === 'already') return 'already';
    return refundWithoutReceipt(gateway, paid, { membershipId: membership.id }, `Membership ${membership.membershipNo} was already paid, so a second payment was refunded.`);
  }

  // A hold that ran out gave back its courts; they're taken again here, and the database refuses
  // that (and a full batch) if someone else got there first.
  try {
    const [confirmed] = await db.batch([
      db
        .update(memberships)
        .set({ status: 'active', holdExpiresAt: null, updatedAt: new Date() })
        .where(and(eq(memberships.id, membership.id), inArray(memberships.status, ['pending_payment', 'expired'])))
        .returning({ id: memberships.id }),
      db.update(courtReservations).set({ status: 'active' }).where(and(eq(courtReservations.membershipId, membership.id), eq(courtReservations.status, 'released'), gt(courtReservations.endsAt, new Date()), previousChanged)),
      auditIfChanged({ action: 'membership.confirmed_online', entityType: 'membership', entityId: membership.id }),
    ]);
    if (confirmed.length) {
      await ensureMemberCode(membership.id);
      await settleReferral(membership.id);
      await enqueueMembershipMessage(membership.id, 'confirmed');
      await enqueueStaffMembershipAlert(membership.id);
      return 'confirmed';
    }
    const [now] = await db.select({ status: memberships.status }).from(memberships).where(eq(memberships.id, membership.id));
    if (now?.status === 'active') return 'already';
    return refundReceipt(gateway, receipt.id, `Membership ${membership.membershipNo} was cancelled before the payment arrived, so it was refunded.`, { membershipId: membership.id });
  } catch (err) {
    const code = dbErrorCode(err);
    if (code !== DB_ERRORS.exclusionViolation && code !== DB_ERRORS.batchFull) throw err;
    return refundReceipt(gateway, receipt.id, `Membership ${membership.membershipNo} was paid after its hold ended and its time or batch seat had been taken, so it was refunded.`, { membershipId: membership.id });
  }
}

/* ---------- Refunds ---------- */

/**
 * Refunds a receipt through the gateway and marks it refunded (and voided, so totals leave it out).
 * If the gateway refuses, the receipt stays as it is and staff are told to refund from the dashboard.
 */
async function refundReceipt(gateway: Gateway, receiptId: string, why: string, about: { bookingId?: string; membershipId?: string }): Promise<Settled> {
  const [receipt] = await db.select().from(payments).where(eq(payments.id, receiptId));
  try {
    await refundPayment(gateway, receipt!, why.split(',')[0]!, null);
    await flag({ ...about, paymentId: receiptId, amountPaise: receipt!.amountPaise, message: why });
    return 'refunded';
  } catch (err) {
    if (!(err instanceof GatewayError)) throw err;
    await flag({ ...about, paymentId: receiptId, amountPaise: receipt!.amountPaise, message: `${why.replace(/, so it was refunded\.$/, '.')} The automatic refund failed (${err.message}). Refund it from the gateway dashboard, then mark this done.` });
    return 'needs_attention';
  }
}

/** A second payment for something already paid has no receipt of its own (it would be more than owed), so only the refund is recorded. */
async function refundWithoutReceipt(gateway: Gateway, paid: Paid, about: { bookingId?: string; membershipId?: string }, why: string): Promise<Settled> {
  try {
    await gateway.refund({ orderId: paid.orderId, paymentId: paid.paymentId, amountPaise: paid.amountPaise, reason: 'Paid twice', reference: `rf-${paid.paymentId}`.slice(0, 40) });
    await flag({ ...about, amountPaise: paid.amountPaise, message: why });
    return 'refunded';
  } catch (err) {
    if (!(err instanceof GatewayError)) throw err;
    await flag({ ...about, amountPaise: paid.amountPaise, message: `${why.replace(/, so a second payment was refunded\.$/, '.')} A second payment (${paid.paymentId}) arrived and the automatic refund failed (${err.message}). Refund it from the gateway dashboard.` });
    return 'needs_attention';
  }
}

/** Refunds one online receipt in full. Used automatically above and by staff from the admin panel. */
export async function refundPayment(gateway: Gateway, receipt: typeof payments.$inferSelect, reason: string, staffId: string | null) {
  if (receipt.method !== 'online' || !receipt.gatewayPaymentId || !receipt.gatewayOrderId) throw new GatewayError('Only an online payment can be refunded here. Give cash or UPI back in person and void the receipt.');
  if (receipt.refundedAt) throw new GatewayError('This payment has already been refunded.');
  if (receipt.gateway !== gateway.name) throw new GatewayError(`This payment went through ${LABELS[receipt.gateway!]}, which isn’t the gateway set up now. Refund it from that dashboard.`);
  const { refundId } = await gateway.refund({ orderId: receipt.gatewayOrderId, paymentId: receipt.gatewayPaymentId, amountPaise: receipt.amountPaise, reason, reference: `rf-${receipt.receiptNo}` });
  const now = new Date();
  const change = { refundedAt: now, gatewayRefundId: refundId, voidedAt: receipt.voidedAt ?? now, voidReason: receipt.voidReason ?? `Refunded: ${reason}`, voidedBy: receipt.voidedBy ?? staffId };
  await db.batch([
    db.update(payments).set(change).where(eq(payments.id, receipt.id)),
    auditEntry({ action: 'payment.refunded', actorStaffId: staffId, entityType: 'payment', entityId: receipt.id, newValues: { refundId, reason } }),
  ]);
  return { ...receipt, ...change };
}

/* ---------- Asking the gateway ---------- */

/** Asks the gateway about one order and settles it if it's paid. Used by "check my payment" and the cron. */
export async function syncOrder(gateway: Gateway, orderId: string): Promise<Settled | 'pending'> {
  const state = await gateway.fetchOrder(orderId);
  if (state.status !== 'paid') return 'pending';
  return settlePaidOrder(gateway, { orderId, paymentId: state.paymentId, amountPaise: state.amountPaise });
}

/**
 * The safety net for a webhook that never arrives: every minute, asks the gateway about a few
 * orders that are still unconfirmed a couple of minutes after checkout began, for up to 45 minutes.
 */
export async function sweepGatewayOrders(now = new Date()): Promise<number> {
  const online = await onlinePayments();
  if (online.kind !== 'gateway') return 0;
  const recent = (t: typeof bookings | typeof memberships) =>
    and(
      isNotNull(t.gatewayOrderId),
      inArray(t.status, ['pending_payment', 'expired']),
      lt(t.gatewayOrderAt, new Date(now.getTime() - SWEEP_AFTER_MS)),
      gt(t.gatewayOrderAt, new Date(now.getTime() - SWEEP_FOR_MS)),
      or(isNull(t.gatewayCheckedAt), lt(t.gatewayCheckedAt, new Date(now.getTime() - SWEEP_AFTER_MS))),
      notExists(db.select({ id: payments.id }).from(payments).where(sql`${payments.gatewayOrderId} = ${t.gatewayOrderId}`)),
    );
  const due = [
    ...(await db.select({ id: bookings.id, orderId: bookings.gatewayOrderId }).from(bookings).where(recent(bookings)).limit(SWEEP_BATCH)).map((r) => ({ ...r, table: bookings })),
    ...(await db.select({ id: memberships.id, orderId: memberships.gatewayOrderId }).from(memberships).where(recent(memberships)).limit(SWEEP_BATCH)).map((r) => ({ ...r, table: memberships })),
  ];
  for (const row of due) {
    await db.update(row.table).set({ gatewayCheckedAt: now }).where(eq(row.table.id, row.id));
    try {
      await syncOrder(online.gateway, row.orderId!);
    } catch (err) {
      console.error('Payment check:', err instanceof Error ? err.message : err);
    }
  }
  return due.length;
}
