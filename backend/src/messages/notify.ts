// Who hears about what. Customers and members get WhatsApp first (or email when WhatsApp isn't
// available and they gave one); the owner gets WhatsApp. Owner decisions, 21 Nov 2026:
//
//   Customer: booking confirmed (with payment details), booking cancelled,
//             membership confirmed (with payment details), membership renewed (with amount due).
//   Owner:    new booking, new membership (website and desk), membership cancelled, refunds.
//   Nothing else: no booking-changed, receipts, refunds or reminders to customers.
//
// Built for Cloudflare's free plan: each event reads what it needs once and writes every message it
// causes (customer, owner numbers, staff email alert) in a single insert. Sending happens later, in
// the cron (queue.ts), never inside the request.
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { bookings, courtReservations, courts, customers, memberBatches, membershipCourts, membershipPeriods, membershipPlans, memberships, messageSettings, messages, payments, staff } from '../db/schema.js';
import { periodView, toTime } from '../lib/time.js';
import { isTestMoney, onlinePayments } from '../payments/gateway.js';
import { decrypt } from '../lib/secret.js';
import { DEFAULT_TEMPLATES, type WhatsappMessageKind } from './whatsapp.js';

const SIGN_OFF = 'DK Badminton Academy';

/* ---------- The 8 WhatsApp templates ---------- */

type TemplateSpec = {
  /** Values for {{1}}, {{2}}, … in order, by name in the message's template_params. */
  params: string[];
  /** A "View" button whose URL ends with the customer's private link token. */
  button?: 'booking' | 'membership';
  /** The body to submit to Meta (category Utility). Kept here so the docs and the code can't drift. */
  body: string;
};

export const WHATSAPP_TEMPLATES: Record<WhatsappMessageKind, TemplateSpec> = {
  booking_confirmed: {
    params: ['name', 'bookingNo', 'court', 'date', 'time', 'total', 'paid', 'due', 'payment'],
    button: 'booking',
    body: 'Hi {{1}}, your court booking {{2}} is confirmed: {{3}}, {{4}}, {{5}}. Total {{6}}, paid {{7}}, due {{8}}. Payment: {{9}}. Use the button below to view your booking.',
  },
  booking_cancelled: {
    params: ['name', 'bookingNo', 'date', 'time', 'paid'],
    body: 'Hi {{1}}, your court booking {{2}} on {{3}}, {{4}} has been cancelled. Amount paid on it: {{5}}. See our Cancellation & Refund Policy, or contact the academy.',
  },
  membership_confirmed: {
    params: ['name', 'plan', 'membershipNo', 'schedule', 'from', 'to', 'monthly', 'paid', 'due'],
    button: 'membership',
    body: 'Hi {{1}}, your {{2}} membership {{3}} is confirmed: {{4}}. Valid {{5}} to {{6}}. Monthly {{7}}, paid {{8}}, due {{9}}. Use the button below to view your membership.',
  },
  membership_renewed: {
    params: ['name', 'membershipNo', 'from', 'to', 'amount', 'credit', 'due', 'payBy'],
    body: 'Hi {{1}}, your membership {{2}} is renewed for {{3}} to {{4}}. Amount {{5}}, credit used {{6}}, amount due {{7}}. Please pay at the academy by {{8}}. Contact the academy if you have any questions.',
  },
  owner_new_booking: {
    params: ['bookingNo', 'source', 'customer', 'phone', 'court', 'date', 'time', 'total', 'payment'],
    body: 'New court booking {{1}}. Source: {{2}}. Customer: {{3}}, phone {{4}}. Court: {{5}}, date: {{6}}, time: {{7}}. Total: {{8}}. Payment: {{9}}. Full details are in the admin panel.',
  },
  owner_new_membership: {
    params: ['membershipNo', 'source', 'holder', 'phone', 'plan', 'schedule', 'from', 'to', 'payment'],
    body: 'New membership {{1}}. Source: {{2}}. Member: {{3}}, phone {{4}}. Plan: {{5}}, schedule: {{6}}. Valid from {{7}} to {{8}}. Payment: {{9}}. Full details are in the admin panel.',
  },
  owner_membership_cancelled: {
    params: ['membershipNo', 'holder', 'phone', 'plan', 'reason', 'by'],
    body: 'Membership {{1}} has been cancelled. Member: {{2}}, phone {{3}}. Plan: {{4}}. Reason: {{5}}. Cancelled by: {{6}}. Full details are in the admin panel.',
  },
  owner_refund: {
    params: ['amount', 'receipt', 'about', 'customer', 'reason', 'by', 'outcome'],
    body: 'Refund of {{1}} on receipt {{2}} for {{3}}. Customer: {{4}}. Reason: {{5}}. Done by: {{6}}. Result: {{7}} Full details are in the admin panel.',
  },
};

/* ---------- Wording ---------- */

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const longDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
/** '18:30' as '6:30 PM'; '24:00' is midnight. */
function clock(time: string) {
  const [h, m] = time.split(':').map(Number) as [number, number];
  const hour = h % 24;
  return `${hour % 12 || 12}:${String(m).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}
const timeRange = (start: string, end: string) => `${clock(start)} – ${clock(end)}`;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayList = (days: number[]) => [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => DAY_NAMES[d]).join(', ');
const METHODS: Record<string, string> = { cash: 'Cash', upi: 'UPI', online: 'Online payment', online_test: 'Online (test)' };

type Receipt = { receiptNo: string; method: string; kept: number };

/** "Online payment · RCP-0031", "Cash, UPI · RCP-0040", or how to pay when nothing is paid yet. */
function paymentLine(receipts: Receipt[], due: number) {
  if (!receipts.length) return due > 0 ? 'Not paid yet, pay at the academy' : 'Nothing to pay';
  const methods = [...new Set(receipts.map((r) => METHODS[r.method] ?? r.method))].join(', ');
  return `${due > 0 ? 'Part paid by ' : ''}${methods} · ${receipts.at(-1)!.receiptNo}`;
}
const ownerPaymentLine = (paid: number, due: number, methods: string) => (due <= 0 ? `Paid ${rupees(paid)}${methods ? ` (${methods})` : ''}` : paid > 0 ? `Part paid ${rupees(paid)}, ${rupees(due)} due` : `Not paid, ${rupees(due)} due`);

/* ---------- Settings, read once per event ---------- */

type Channels = { whatsapp: boolean; ownerNumbers: string[]; staffEmail: string | null };

async function channels(): Promise<Channels> {
  const [row] = await db.select().from(messageSettings).where(eq(messageSettings.id, 1));
  const whatsapp = Boolean(row?.whatsappEnabled && row.whatsappPhoneNumberId && row.whatsappTokenEncrypted && safeDecrypts(row.whatsappTokenEncrypted));
  return {
    whatsapp,
    ownerNumbers: whatsapp ? (row!.ownerWhatsappNumbers ?? []).map((n) => n.trim()).filter(Boolean) : [],
    staffEmail: row?.notifyEmail || row?.senderEmail || null,
  };
}

/** A token saved under a different APP_SECRET can't be used; treat WhatsApp as off rather than fail the booking. */
function safeDecrypts(stored: string) {
  try {
    decrypt(stored);
    return true;
  } catch {
    return false;
  }
}

type Row = typeof messages.$inferInsert;
type Notice = { subject: string; text: string[]; kind: WhatsappMessageKind; params: Record<string, string>; bookingId?: string; membershipId?: string; expiresAt?: Date | null; createdBy?: string | null };

/**
 * The customer's copy: WhatsApp when it's on and they have a phone, otherwise email if they gave one.
 * The WhatsApp row keeps the email wording in its body, so a fallback email is a straight copy.
 */
function customerRow(c: Channels, contact: { phone: string | null; email: string | null }, n: Notice): Row | null {
  const base = { template: n.kind, subject: n.subject, body: n.text.join('\n'), templateParams: n.params, bookingId: n.bookingId, membershipId: n.membershipId, expiresAt: n.expiresAt ?? null, createdBy: n.createdBy ?? null, audience: 'customer' };
  if (c.whatsapp && contact.phone) return { ...base, channel: 'whatsapp', recipient: contact.phone };
  if (contact.email) return { ...base, channel: 'email', recipient: contact.email };
  return null;
}

/** One WhatsApp row per owner number. Owner messages never fall back to email (staff email alerts stay as they are). */
function ownerRows(c: Channels, n: Notice): Row[] {
  return c.ownerNumbers.map((to) => ({ channel: 'whatsapp', audience: 'owner', template: n.kind, recipient: to, subject: n.subject, body: n.text.join('\n'), templateParams: n.params, bookingId: n.bookingId, membershipId: n.membershipId, createdBy: n.createdBy ?? null }));
}

async function save(rows: (Row | null)[]): Promise<Row[]> {
  const kept = rows.filter((r): r is Row => r !== null);
  if (kept.length) await db.insert(messages).values(kept);
  return kept;
}

/** Which channel the customer's copy went on, or null when they can't be reached. */
type Sent = 'whatsapp' | 'email' | null;
const channelOf = (row: Row | null): Sent => (row ? (row.channel as 'whatsapp' | 'email') : null);

/* ---------- Bookings ---------- */

async function loadBooking(bookingId: string) {
  const [[row], receipts] = await Promise.all([
    db
      .select({ booking: bookings, customer: customers, reservation: courtReservations, courtName: courts.name })
      .from(bookings)
      .innerJoin(customers, eq(bookings.customerId, customers.id))
      .innerJoin(courtReservations, eq(bookings.reservationId, courtReservations.id))
      .innerJoin(courts, eq(courtReservations.courtId, courts.id))
      .where(eq(bookings.id, bookingId)),
    db
      .select({ receiptNo: payments.receiptNo, method: payments.method, kept: sql<number>`${payments.amountPaise} - ${payments.refundedPaise}` })
      .from(payments)
      .where(and(eq(payments.bookingId, bookingId), isNull(payments.voidedAt)))
      .orderBy(asc(payments.receivedAt)),
  ]);
  const when = periodView(row!.reservation.startsAt, row!.reservation.endsAt);
  const paid = receipts.reduce((sum, r) => sum + r.kept, 0);
  const due = Math.max(row!.booking.amountPaise - paid, 0);
  return { ...row!, when, receipts, paid, due };
}

type LoadedBooking = Awaited<ReturnType<typeof loadBooking>>;

function bookingConfirmedNotice(b: LoadedBooking, createdBy?: string | null, testMoney = false): Notice {
  const { booking, customer, when, courtName, paid, due, receipts } = b;
  const payment = paymentLine(receipts, due);
  return {
    kind: 'booking_confirmed',
    subject: `Your court booking is confirmed · ${booking.bookingNo}`,
    text: [
      `Hi ${customer.name},`,
      '',
      'Your court is booked.',
      '',
      `Booking: ${booking.bookingNo}`,
      `Court: ${courtName}`,
      `Date: ${longDate(when.date)}`,
      `Time: ${timeRange(when.start, when.end)} (IST)`,
      `Total: ${rupees(booking.amountPaise)}`,
      `Paid: ${rupees(paid)}`,
      `Due: ${rupees(due)}`,
      `Payment: ${payment}`,
      '',
      'See your booking any time: {{link}}',
      'Keep this link private. Anyone with it can see this booking.',
      ...(testMoney ? ['', 'Test mode: no real money was taken for this booking.'] : []),
      '',
      SIGN_OFF,
    ],
    params: { name: customer.name, bookingNo: booking.bookingNo, court: courtName, date: longDate(when.date), time: timeRange(when.start, when.end), total: rupees(booking.amountPaise), paid: rupees(paid), due: rupees(due), payment },
    bookingId: booking.id,
    // News about a session that has already ended helps nobody.
    expiresAt: b.reservation.endsAt,
    createdBy,
  };
}

/**
 * A new confirmed booking: the customer's confirmation, the owner's WhatsApp alert, and (for website
 * bookings) the existing staff email alert. One settings read, one booking read, one insert.
 */
export async function notifyNewBooking(bookingId: string, createdBy?: string | null): Promise<Sent> {
  const [c, b, online] = await Promise.all([channels(), loadBooking(bookingId), onlinePayments()]);
  const website = b.booking.source === 'website';
  const customer = customerRow(c, b.customer, bookingConfirmedNotice(b, createdBy, website && isTestMoney(online)));
  const methods = [...new Set(b.receipts.map((r) => METHODS[r.method] ?? r.method))].join(', ');
  const owner: Notice = {
    kind: 'owner_new_booking',
    subject: `New booking · ${b.booking.bookingNo}`,
    text: [`New booking ${b.booking.bookingNo} (${website ? 'website' : 'desk'})`, `${b.customer.name}, ${b.customer.phone ?? 'no phone'}`, `${b.courtName}, ${longDate(b.when.date)}, ${timeRange(b.when.start, b.when.end)}`, `Total ${rupees(b.booking.amountPaise)}. ${ownerPaymentLine(b.paid, b.due, methods)}.`],
    params: { bookingNo: b.booking.bookingNo, source: website ? 'Website' : 'Desk', customer: b.customer.name, phone: b.customer.phone ?? '-', court: b.courtName, date: longDate(b.when.date), time: timeRange(b.when.start, b.when.end), total: rupees(b.booking.amountPaise), payment: ownerPaymentLine(b.paid, b.due, methods) },
    bookingId,
    createdBy,
  };
  const staffEmail: Row | null =
    website && c.staffEmail
      ? {
          template: 'staff_new_booking',
          audience: 'owner',
          recipient: c.staffEmail,
          subject: `New website booking · ${b.booking.bookingNo}`,
          body: [`${b.customer.name} (${b.customer.customerNo}, ${b.customer.phone}) booked ${b.courtName}.`, `${b.when.date}, ${b.when.start} to ${b.when.end} (IST). Rs ${(b.booking.amountPaise / 100).toLocaleString('en-IN')}.`, ...(b.booking.notes ? ['', `Notes: ${b.booking.notes}`] : [])].join('\n'),
          bookingId,
          expiresAt: b.reservation.endsAt,
        }
      : null;
  await save([customer, ...ownerRows(c, owner), staffEmail]);
  return channelOf(customer);
}

/** The customer's confirmation only: a restored booking, or "Resend" from the admin panel. */
export async function notifyBookingConfirmed(bookingId: string, createdBy?: string | null): Promise<Sent> {
  const [c, b] = await Promise.all([channels(), loadBooking(bookingId)]);
  const [row] = await save([customerRow(c, b.customer, bookingConfirmedNotice(b, createdBy))]);
  return channelOf(row ?? null);
}

export async function notifyBookingCancelled(bookingId: string, createdBy?: string | null): Promise<Sent> {
  const [c, b] = await Promise.all([channels(), loadBooking(bookingId)]);
  const notice: Notice = {
    kind: 'booking_cancelled',
    subject: `Your court booking was cancelled · ${b.booking.bookingNo}`,
    text: [
      `Hi ${b.customer.name},`,
      '',
      'Your booking has been cancelled.',
      '',
      `Booking: ${b.booking.bookingNo}`,
      `Court: ${b.courtName}`,
      `Date: ${longDate(b.when.date)}`,
      `Time: ${timeRange(b.when.start, b.when.end)} (IST)`,
      `Amount paid on it: ${rupees(b.paid)}`,
      '',
      'Refunds follow our Cancellation & Refund Policy. Contact the academy if you have any questions.',
      '',
      SIGN_OFF,
    ],
    params: { name: b.customer.name, bookingNo: b.booking.bookingNo, date: longDate(b.when.date), time: timeRange(b.when.start, b.when.end), paid: rupees(b.paid) },
    bookingId,
    expiresAt: b.reservation.endsAt,
    createdBy,
  };
  const [row] = await save([customerRow(c, b.customer, notice)]);
  return channelOf(row ?? null);
}

/* ---------- Memberships ---------- */

async function loadMembership(membershipId: string) {
  const [[row], courtRows, periods] = await Promise.all([
    db
      .select({ m: memberships, plan: membershipPlans.name, batch: memberBatches })
      .from(memberships)
      .innerJoin(membershipPlans, eq(memberships.planId, membershipPlans.id))
      .leftJoin(memberBatches, eq(memberships.batchId, memberBatches.id))
      .where(eq(memberships.id, membershipId)),
    db.select({ name: courts.name }).from(membershipCourts).innerJoin(courts, eq(membershipCourts.courtId, courts.id)).where(eq(membershipCourts.membershipId, membershipId)),
    db
      .select({
        period: membershipPeriods,
        // The outer table is named in full: a bare column here could resolve to the payment's own id.
        paid: sql<number>`coalesce((SELECT sum(p.amount_paise - p.refunded_paise) FROM payments p WHERE p.period_id = membership_periods.id AND p.voided_at IS NULL), 0)`,
        methods: sql<string | null>`(SELECT group_concat(DISTINCT p.method) FROM payments p WHERE p.period_id = membership_periods.id AND p.voided_at IS NULL)`,
      })
      .from(membershipPeriods)
      .where(eq(membershipPeriods.membershipId, membershipId))
      .orderBy(desc(membershipPeriods.startsOn)),
  ]);
  const { m, plan, batch } = row!;
  const time = batch ?? m;
  const days = time.days ?? [];
  const slot = time.startMinute !== null && time.endMinute !== null ? timeRange(toTime(time.startMinute!), toTime(time.endMinute!)) : '';
  const place = batch ? batch.name : courtRows.map((r) => r.name).join(', ');
  const schedule = [place, [dayList(days), slot].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return { m, plan, schedule, periods };
}

type LoadedMembership = Awaited<ReturnType<typeof loadMembership>>;
const methodsText = (methods: string | null) => (methods ? methods.split(',').map((x) => METHODS[x] ?? x).join(', ') : '');

/** A new confirmed membership: the member's confirmation, the owner's alert, and (website) the staff email. */
export async function notifyNewMembership(membershipId: string, createdBy?: string | null): Promise<Sent> {
  const [c, mm, online] = await Promise.all([channels(), loadMembership(membershipId), onlinePayments()]);
  const { m, plan, schedule } = mm;
  const first = mm.periods.at(-1);
  const amount = first?.period.amountPaise ?? m.pricePaise;
  const paid = first?.paid ?? 0;
  const due = Math.max(amount - paid, 0);
  const website = m.source === 'website';
  const notice: Notice = {
    kind: 'membership_confirmed',
    subject: `Your membership is confirmed · ${m.membershipNo}`,
    text: [
      `Hi ${m.holderName},`,
      '',
      'Welcome. Your membership is set up.',
      '',
      `Membership: ${m.membershipNo} (${plan})`,
      `Time: ${schedule}`,
      `Valid: ${longDate(m.startsOn)} to ${longDate(m.endsOn)}`,
      `Monthly: ${rupees(m.pricePaise)}`,
      `Paid: ${rupees(paid)}`,
      `Due: ${rupees(due)}`,
      '',
      'See your membership any time: {{link}}',
      'Keep this link private. Anyone with it can see this membership.',
      ...(website && isTestMoney(online) ? ['', 'Test mode: no real money was taken for this membership.'] : []),
      '',
      SIGN_OFF,
    ],
    params: { name: m.holderName, plan, membershipNo: m.membershipNo, schedule, from: longDate(m.startsOn), to: longDate(m.endsOn), monthly: rupees(m.pricePaise), paid: rupees(paid), due: rupees(due) },
    membershipId,
    createdBy,
  };
  const owner: Notice = {
    kind: 'owner_new_membership',
    subject: `New membership · ${m.membershipNo}`,
    text: [`New membership ${m.membershipNo} (${website ? 'website' : 'desk'})`, `${m.holderName}, ${m.phone}`, `${plan}, ${schedule}`, `Valid ${longDate(m.startsOn)} to ${longDate(m.endsOn)}. ${ownerPaymentLine(paid, due, methodsText(first?.methods ?? null))}.`],
    params: { membershipNo: m.membershipNo, source: website ? 'Website' : 'Desk', holder: m.holderName, phone: m.phone, plan, schedule, from: longDate(m.startsOn), to: longDate(m.endsOn), payment: ownerPaymentLine(paid, due, methodsText(first?.methods ?? null)) },
    membershipId,
    createdBy,
  };
  const staffEmail: Row | null =
    website && c.staffEmail
      ? { template: 'staff_new_membership', audience: 'owner', recipient: c.staffEmail, subject: `New website membership · ${m.membershipNo}`, body: `${m.holderName} (${m.phone}) joined. Valid ${m.startsOn} to ${m.endsOn}.`, membershipId }
      : null;
  const customer = customerRow(c, m, notice);
  await save([customer, ...ownerRows(c, owner), staffEmail]);
  return channelOf(customer);
}

/** After staff renew: the new month and what's due for it. */
export async function notifyMembershipRenewed(membershipId: string, createdBy?: string | null): Promise<Sent> {
  const [c, mm] = await Promise.all([channels(), loadMembership(membershipId)]);
  const { m } = mm;
  const latest = mm.periods[0]!;
  const p = latest.period;
  const due = Math.max(p.amountPaise - latest.paid, 0);
  const notice: Notice = {
    kind: 'membership_renewed',
    subject: `Your membership has been renewed · ${m.membershipNo}`,
    text: [
      `Hi ${m.holderName},`,
      '',
      'Your membership has been renewed.',
      '',
      `Membership: ${m.membershipNo}`,
      `New month: ${longDate(p.startsOn)} to ${longDate(p.endsOn)}`,
      `Amount: ${rupees(p.amountPaise + p.creditPaise)}`,
      `Credit used: ${rupees(p.creditPaise)}`,
      `Amount due: ${rupees(due)}`,
      ...(due > 0 ? [`Please pay at the academy by ${longDate(p.startsOn)}.`] : []),
      '',
      'See your membership any time: {{link}}',
      '',
      SIGN_OFF,
    ],
    params: { name: m.holderName, membershipNo: m.membershipNo, from: longDate(p.startsOn), to: longDate(p.endsOn), amount: rupees(p.amountPaise + p.creditPaise), credit: rupees(p.creditPaise), due: rupees(due), payBy: longDate(p.startsOn) },
    membershipId,
    createdBy,
  };
  const [row] = await save([customerRow(c, m, notice)]);
  return channelOf(row ?? null);
}

/** The owner hears about a cancelled membership; the member gets no message (owner decision). */
export async function notifyOwnerMembershipCancelled(membershipId: string, reason: string | null, createdBy?: string | null): Promise<void> {
  const c = await channels();
  if (!c.ownerNumbers.length) return;
  const [mm, [who]] = await Promise.all([loadMembership(membershipId), createdBy ? db.select({ name: staff.name }).from(staff).where(eq(staff.id, createdBy)) : Promise.resolve([])]);
  const { m, plan } = mm;
  const by = who?.name ?? 'staff';
  await save(
    ownerRows(c, {
      kind: 'owner_membership_cancelled',
      subject: `Membership cancelled · ${m.membershipNo}`,
      text: [`Membership ${m.membershipNo} cancelled`, `${m.holderName}, ${m.phone}, ${plan}`, `Reason: ${reason || 'not given'}. Cancelled by ${by}.`],
      params: { membershipNo: m.membershipNo, holder: m.holderName, phone: m.phone, plan, reason: reason || 'not given', by },
      membershipId,
      createdBy,
    }),
  );
}

/* ---------- Refunds (owner only) ---------- */

export type RefundNotice = {
  amountPaise: number;
  /** The receipt number, or the gateway payment id when there's no receipt (a second payment refunded). */
  receipt: string;
  bookingId?: string | null;
  membershipId?: string | null;
  /** The period a membership receipt belongs to, when the membership id isn't to hand. */
  periodId?: string | null;
  reason: string;
  /** A staff id, or null for automatic refunds. */
  by: string | null;
  failed?: boolean;
};

/** Every refund reaches the owner: by staff, automatic, and automatic ones that failed (to refund by hand). */
export async function notifyOwnerRefund(r: RefundNotice): Promise<void> {
  const c = await channels();
  if (!c.ownerNumbers.length) return;
  let membershipId = r.membershipId ?? null;
  if (!membershipId && r.periodId) [{ membershipId } = { membershipId: null }] = await db.select({ membershipId: membershipPeriods.membershipId }).from(membershipPeriods).where(eq(membershipPeriods.id, r.periodId));
  const [booking] = r.bookingId ? await db.select({ no: bookings.bookingNo, name: customers.name }).from(bookings).innerJoin(customers, eq(bookings.customerId, customers.id)).where(eq(bookings.id, r.bookingId)) : [];
  const [member] = membershipId ? await db.select({ no: memberships.membershipNo, name: memberships.holderName }).from(memberships).where(eq(memberships.id, membershipId)) : [];
  const [who] = r.by ? await db.select({ name: staff.name }).from(staff).where(inArray(staff.id, [r.by])) : [];
  const about = booking?.no ?? member?.no ?? '-';
  const name = booking?.name ?? member?.name ?? '-';
  const by = who?.name ?? 'automatic';
  const outcome = r.failed ? 'Automatic refund FAILED: refund it from the payment gateway dashboard.' : 'Refunded through the payment gateway.';
  await save(
    ownerRows(c, {
      kind: 'owner_refund',
      subject: `${r.failed ? 'Refund failed' : 'Refund'} · ${rupees(r.amountPaise)} · ${about}`,
      text: [`Refund ${rupees(r.amountPaise)} on ${r.receipt} (${about}, ${name})`, `Reason: ${r.reason}`, `By ${by}. ${outcome}`],
      params: { amount: rupees(r.amountPaise), receipt: r.receipt, about, customer: name, reason: r.reason, by, outcome },
      bookingId: r.bookingId ?? undefined,
      membershipId: membershipId ?? undefined,
    }),
  );
}

export { DEFAULT_TEMPLATES };
