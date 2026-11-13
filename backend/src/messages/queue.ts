import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { bookings, courtReservations, courts, customers, enquiries, messageSettings, messages, memberships, referralCodes, referralProgram } from '../db/schema.js';
import type { Mailer } from '../lib/email.js';
import { isTestMoney, onlinePayments } from '../payments/gateway.js';
import { instantAt, periodView, venueToday } from '../lib/time.js';
import { bookingLink, membershipLink } from './links.js';

const BATCH_SIZE = 10;
const MAX_ATTEMPTS = 5;
// How long to wait after the 1st, 2nd, 3rd and 4th failure.
const RETRY_MINUTES = [1, 5, 15, 60];
// A message stuck in "sending" means the API stopped mid-send.
const STUCK_AFTER_MINUTES = 10;
const ENQUIRY_MESSAGE_LIFETIME_DAYS = 7;
const SIGN_OFF = 'DK Badminton Academy';

type BookingEvent = 'confirmed' | 'changed' | 'cancelled';

const SUBJECTS: Record<BookingEvent, string> = {
  confirmed: 'Your court booking is confirmed',
  changed: 'Your court booking has changed',
  cancelled: 'Your court booking was cancelled',
};
const INTROS: Record<BookingEvent, string> = {
  confirmed: 'Your court is booked.',
  changed: 'Your booking has changed. Here are the new details.',
  cancelled: 'Your booking has been cancelled. Contact the academy if you have any questions.',
};

async function loadBooking(bookingId: string) {
  const [row] = await db
    .select({ booking: bookings, customer: customers, reservation: courtReservations, courtName: courts.name })
    .from(bookings)
    .innerJoin(customers, eq(bookings.customerId, customers.id))
    .innerJoin(courtReservations, eq(bookings.reservationId, courtReservations.id))
    .innerJoin(courts, eq(courtReservations.courtId, courts.id))
    .where(eq(bookings.id, bookingId));
  return row!;
}

const money = (paise: number) => `Rs ${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** Queues the customer's email. Called once the change has saved. False if they have no email. */
export async function enqueueBookingMessage(bookingId: string, event: BookingEvent, createdBy?: string): Promise<boolean> {
  const { booking, customer, reservation, courtName } = await loadBooking(bookingId);
  if (!customer.email) return false;
  const when = periodView(reservation.startsAt, reservation.endsAt);
  const lines = [
    `Hi ${customer.name},`,
    '',
    INTROS[event],
    '',
    `Booking: ${booking.bookingNo}`,
    `Court: ${courtName}`,
    `Date: ${when.date}`,
    `Time: ${when.start} to ${when.end} (IST)`,
    `Amount: ${money(booking.amountPaise)}`,
    '',
    'See your booking any time: {{link}}',
    'Keep this link private. Anyone with it can see this booking.',
    ...(booking.source === 'website' && isTestMoney(await onlinePayments()) ? ['', 'Test mode: no real money was taken for this booking.'] : []),
    '',
    SIGN_OFF,
  ];
  await db.insert(messages).values({
    template: `booking_${event}`,
    recipient: customer.email,
    subject: `${SUBJECTS[event]} · ${booking.bookingNo}`,
    body: lines.join('\n'),
    bookingId,
    // News about a session that has already ended helps nobody.
    expiresAt: reservation.endsAt,
    createdBy,
  });
  return true;
}

const staffAddress = async () => {
  const [row] = await db.select().from(messageSettings).where(eq(messageSettings.id, 1));
  return row?.notifyEmail || row?.senderEmail || null;
};

export async function enqueueStaffBookingAlert(bookingId: string) {
  const to = await staffAddress();
  if (!to) return;
  const { booking, customer, reservation, courtName } = await loadBooking(bookingId);
  const when = periodView(reservation.startsAt, reservation.endsAt);
  await db.insert(messages).values({
    template: 'staff_new_booking',
    recipient: to,
    subject: `New website booking · ${booking.bookingNo}`,
    body: [`${customer.name} (${customer.customerNo}, ${customer.phone}) booked ${courtName}.`, `${when.date}, ${when.start} to ${when.end} (IST). ${money(booking.amountPaise)}.`, ...(booking.notes ? ['', `Notes: ${booking.notes}`] : [])].join('\n'),
    bookingId,
    expiresAt: reservation.endsAt,
  });
}

/** The customer's copy never repeats what they typed, so the form can't be used to send other people spam. */
export async function enqueueEnquiryMessages(enquiry: typeof enquiries.$inferSelect) {
  const expiresAt = new Date(Date.now() + ENQUIRY_MESSAGE_LIFETIME_DAYS * 86_400_000);
  await db.insert(messages).values({
    template: 'enquiry_received',
    recipient: enquiry.email,
    subject: `We received your enquiry · ${enquiry.enquiryNo}`,
    body: [`Thanks for contacting us. Your enquiry number is ${enquiry.enquiryNo}, and the academy will reply soon.`, '', 'If you didn’t send this, you can ignore this email.', '', SIGN_OFF].join('\n'),
    enquiryId: enquiry.id,
    expiresAt,
  });
  const to = await staffAddress();
  if (!to) return;
  await db.insert(messages).values({
    template: 'staff_new_enquiry',
    recipient: to,
    subject: `New enquiry · ${enquiry.enquiryNo}`,
    body: [`From: ${enquiry.name} <${enquiry.email}>${enquiry.phone ? `, ${enquiry.phone}` : ''}`, ...(enquiry.topic ? [`Topic: ${enquiry.topic}`] : []), ...(enquiry.preferred ? [`Preferred: ${enquiry.preferred}`] : []), '', enquiry.message].join('\n'),
    enquiryId: enquiry.id,
    expiresAt,
  });
}

type MembershipEvent = 'confirmed' | 'renewed' | 'cancelled' | 'reminder';

const MEMBERSHIP_SUBJECTS: Record<MembershipEvent, string> = {
  confirmed: 'Your membership is confirmed',
  renewed: 'Your membership has been renewed',
  cancelled: 'Your membership was cancelled',
  reminder: 'Your membership is ending soon',
};
const MEMBERSHIP_INTROS: Record<MembershipEvent, string> = {
  confirmed: 'Welcome. Your membership is set up.',
  renewed: 'Your membership has been renewed.',
  cancelled: 'Your membership has been cancelled. Contact the academy if you have any questions.',
  reminder: 'Your membership is ending soon. Contact the academy to renew and keep your time.',
};

/** False if the member has no email. */
export async function enqueueMembershipMessage(membershipId: string, event: MembershipEvent, createdBy?: string): Promise<boolean> {
  const [m] = await db.select().from(memberships).where(eq(memberships.id, membershipId));
  if (!m?.email) return false;
  const [program] = await db.select({ enabled: referralProgram.enabled }).from(referralProgram);
  const [code] = await db.select({ code: referralCodes.code }).from(referralCodes).where(eq(referralCodes.membershipId, membershipId));
  const shareable = program?.enabled && code && event === 'confirmed' ? ['', `Know someone who'd like to play? Your referral code is ${code.code}.`] : [];
  await db.insert(messages).values({
    template: `membership_${event}`,
    recipient: m.email,
    subject: `${MEMBERSHIP_SUBJECTS[event]} · ${m.membershipNo}`,
    body: [
      `Hi ${m.holderName},`,
      '',
      MEMBERSHIP_INTROS[event],
      '',
      `Membership: ${m.membershipNo}`,
      `Valid: ${m.startsOn} to ${m.endsOn}`,
      '',
      'See your membership any time: {{link}}',
      'Keep this link private. Anyone with it can see this membership.',
      ...shareable,
      ...(m.source === 'website' && isTestMoney(await onlinePayments()) ? ['', 'Test mode: no real money was taken for this membership.'] : []),
      '',
      SIGN_OFF,
    ].join('\n'),
    membershipId,
    createdBy,
  });
  return true;
}

export async function enqueueStaffMembershipAlert(membershipId: string) {
  const to = await staffAddress();
  if (!to) return;
  const [m] = await db.select().from(memberships).where(eq(memberships.id, membershipId));
  await db.insert(messages).values({
    template: 'staff_new_membership',
    recipient: to,
    subject: `New website membership · ${m!.membershipNo}`,
    body: `${m!.holderName} (${m!.phone}) joined. Valid ${m!.startsOn} to ${m!.endsOn}.`,
    membershipId,
  });
}

/** Gmail's own errors are technical, and staff need to know what to do. They arrive as SMTP reply text. */
export function friendlyMailError(err: unknown): string {
  const e = err as { message?: unknown };
  const text = String(e?.message ?? '');
  if (/authentication|\b535\b|\b534\b/i.test(text)) return 'Gmail refused the sender address or app password. Check them in Settings.';
  if (/timeout|connection closed|failed to connect|socket/i.test(text)) return 'Couldn’t reach Gmail. It will try again.';
  if (/RCPT TO[^]*\b(550|553)\b/i.test(text)) return 'The email address was refused.';
  return String(e?.message ?? 'The email could not be sent.').slice(0, 300);
}

/** One pass over the queue. Safe to run from several places: each message is claimed by one run. */
export async function processMessages(mailer: Mailer, now = new Date()): Promise<{ sent: number; failed: number }> {
  await db
    .update(messages)
    .set({ status: 'queued' })
    .where(and(eq(messages.status, 'sending'), lte(messages.nextAttemptAt, new Date(now.getTime() - STUCK_AFTER_MINUTES * 60_000))));
  await db
    .update(messages)
    .set({ status: 'expired' })
    .where(and(eq(messages.status, 'queued'), lte(messages.expiresAt, now)));

  const [settings] = await db.select().from(messageSettings).where(eq(messageSettings.id, 1));
  if (!settings?.emailEnabled || (mailer.ready && !(await mailer.ready()))) return { sent: 0, failed: 0 };

  const [{ today }] = (await db
    .select({ today: sql<number>`count(*)` })
    .from(messages)
    .where(and(eq(messages.channel, 'email'), eq(messages.status, 'sent'), gte(messages.sentAt, instantAt(venueToday(now), 0))))) as [{ today: number }];
  const room = Math.min(BATCH_SIZE, settings.dailyEmailLimit - today);
  if (room <= 0) return { sent: 0, failed: 0 };

  // Claimed in one statement, so two runs at once can't both take the same message.
  const due = db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.status, 'queued'), eq(messages.channel, 'email'), lte(messages.nextAttemptAt, now)))
    .orderBy(messages.createdAt)
    .limit(room);
  const claimed = await db
    .update(messages)
    .set({ status: 'sending', attempts: sql`${messages.attempts} + 1`, nextAttemptAt: now })
    .where(and(inArray(messages.id, due), eq(messages.status, 'queued')))
    .returning();

  let sent = 0;
  let failed = 0;
  for (const message of claimed) {
    try {
      const link = message.bookingId ? bookingLink(message.bookingId) : message.membershipId ? membershipLink(message.membershipId) : null;
      const text = link ? message.body.replaceAll('{{link}}', link) : message.body;
      await mailer.send({ to: message.recipient, subject: message.subject, text });
      await db.update(messages).set({ status: 'sent', sentAt: new Date(), lastError: null }).where(eq(messages.id, message.id));
      sent += 1;
    } catch (err) {
      // Already counted when it was claimed.
      const attempts = message.attempts;
      const giveUp = attempts >= MAX_ATTEMPTS;
      await db
        .update(messages)
        .set({
          status: giveUp ? 'failed' : 'queued',
          lastError: friendlyMailError(err),
          nextAttemptAt: new Date(now.getTime() + (RETRY_MINUTES[attempts - 1] ?? 60) * 60_000),
        })
        .where(eq(messages.id, message.id));
      failed += 1;
    }
  }
  return { sent, failed };
}
