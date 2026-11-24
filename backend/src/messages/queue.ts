import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { bookings, customers, enquiries, messageSettings, messages, memberships } from '../db/schema.js';
import type { Mailer } from '../lib/email.js';
import { instantAt, venueToday } from '../lib/time.js';
import { bookingLink, bookingToken, membershipLink, membershipToken } from './links.js';
import { WHATSAPP_TEMPLATES } from './notify.js';
import { sendTemplate, whatsappSetup, WhatsappError, type WhatsappMessageKind } from './whatsapp.js';

// Emails sent per run. Each one opens its own encrypted connection to Gmail, which costs CPU, and
// Cloudflare's free plan allows about 10 ms of CPU per run. Runs alternate with payment checks, so this
// is 3 emails every 2 minutes: over 2,000 a day, more than Gmail itself allows.
export const EMAIL_BATCH_SIZE = 3;
// WhatsApp messages sent per run: one plain request to Meta each, so they're cheap. With the emails
// this keeps a run well inside the free plan's 50 queries (tested in step-12-free-plan.test.ts).
export const WHATSAPP_BATCH_SIZE = 5;
const MAX_ATTEMPTS = 5;
// How long to wait after the 1st, 2nd, 3rd and 4th failure.
const RETRY_MINUTES = [1, 5, 15, 60];
// A message stuck in "sending" means the API stopped mid-send.
const STUCK_AFTER_MINUTES = 10;
const ENQUIRY_MESSAGE_LIFETIME_DAYS = 7;
const SIGN_OFF = 'DK Badminton Academy';

// Booking and membership messages are built in notify.ts (WhatsApp first, email as fallback).
// Enquiries stay on email.

const staffAddress = async () => {
  const [row] = await db.select().from(messageSettings).where(eq(messageSettings.id, 1));
  return row?.notifyEmail || row?.senderEmail || null;
};

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
    audience: 'owner',
    recipient: to,
    subject: `New enquiry · ${enquiry.enquiryNo}`,
    body: [`From: ${enquiry.name} <${enquiry.email}>${enquiry.phone ? `, ${enquiry.phone}` : ''}`, ...(enquiry.topic ? [`Topic: ${enquiry.topic}`] : []), ...(enquiry.preferred ? [`Preferred: ${enquiry.preferred}`] : []), '', enquiry.message].join('\n'),
    enquiryId: enquiry.id,
    expiresAt,
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

/** One pass over the queue: WhatsApp first, then email. Safe to run from several places: each message is claimed by one run. */
export async function processMessages(mailer: Mailer, now = new Date()): Promise<{ sent: number; failed: number; whatsapp: { sent: number; failed: number } }> {
  await db
    .update(messages)
    .set({ status: 'queued' })
    .where(and(eq(messages.status, 'sending'), lte(messages.nextAttemptAt, new Date(now.getTime() - STUCK_AFTER_MINUTES * 60_000))));
  await db
    .update(messages)
    .set({ status: 'expired' })
    .where(and(eq(messages.status, 'queued'), lte(messages.expiresAt, now)));

  // WhatsApp first: a customer message that can't go creates its fallback email, which the email pass
  // below can then send in the same run.
  const whatsapp = await sendWhatsapp(now);
  const email = await sendEmails(mailer, now);
  return { ...email, whatsapp };
}

const startOfToday = (now: Date) => instantAt(venueToday(now), 0);

/** Takes up to `limit` queued messages on a channel, in one statement, so two runs can't take the same one. */
async function claim(channel: 'email' | 'whatsapp', limit: number, now: Date) {
  const due = db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.status, 'queued'), eq(messages.channel, channel), lte(messages.nextAttemptAt, now)))
    .orderBy(messages.createdAt)
    .limit(limit);
  return db
    .update(messages)
    .set({ status: 'sending', attempts: sql`${messages.attempts} + 1`, nextAttemptAt: now })
    .where(and(inArray(messages.id, due), eq(messages.status, 'queued')))
    .returning();
}

const sentToday = async (channel: 'email' | 'whatsapp', now: Date) => {
  const [{ today }] = (await db
    .select({ today: sql<number>`count(*)` })
    .from(messages)
    .where(and(eq(messages.channel, channel), eq(messages.status, 'sent'), gte(messages.sentAt, startOfToday(now))))) as [{ today: number }];
  return today;
};

type Message = typeof messages.$inferSelect;

/**
 * A WhatsApp message that won't go. It's marked failed with the reason, and a customer's copy is sent
 * by email instead when they gave an email. Owner messages have no fallback (staff email alerts stay as before).
 */
async function giveUp(message: Message, reason: string, now: Date) {
  await db.update(messages).set({ status: 'failed', lastError: reason }).where(eq(messages.id, message.id));
  if (message.audience !== 'customer') return;
  const [contact] = message.bookingId
    ? await db.select({ email: customers.email }).from(bookings).innerJoin(customers, eq(bookings.customerId, customers.id)).where(eq(bookings.id, message.bookingId))
    : message.membershipId
      ? await db.select({ email: memberships.email }).from(memberships).where(eq(memberships.id, message.membershipId))
      : [];
  if (!contact?.email) return;
  await db.insert(messages).values({
    channel: 'email',
    audience: 'customer',
    template: message.template,
    recipient: contact.email,
    subject: message.subject,
    body: message.body,
    templateParams: message.templateParams,
    bookingId: message.bookingId,
    membershipId: message.membershipId,
    expiresAt: message.expiresAt,
    createdBy: message.createdBy,
    fallbackOf: message.id,
    // Due at this run's time, so the email pass in the same run sends it straight away.
    nextAttemptAt: now,
  });
}

async function sendWhatsapp(now: Date): Promise<{ sent: number; failed: number }> {
  const setup = await whatsappSetup();
  const today = setup ? await sentToday('whatsapp', now) : 0;
  const room = setup ? Math.min(WHATSAPP_BATCH_SIZE, setup.dailyLimit - today) : 0;

  // Switched off (or past today's limit) after these were queued: customers get the email instead.
  if (!setup || room <= 0) {
    const stranded = await claim('whatsapp', WHATSAPP_BATCH_SIZE, now);
    const why = setup ? `Today’s WhatsApp limit (${setup.dailyLimit}) was reached. Raise it in Settings if needed.` : 'WhatsApp is switched off in Settings.';
    for (const message of stranded) await giveUp(message, why, now);
    return { sent: 0, failed: stranded.length };
  }

  let sent = 0;
  let failed = 0;
  for (const message of await claim('whatsapp', room, now)) {
    const kind = message.template as WhatsappMessageKind;
    const spec = WHATSAPP_TEMPLATES[kind];
    if (!spec) {
      await giveUp(message, `There’s no WhatsApp template for “${message.template}”.`, now);
      failed += 1;
      continue;
    }
    try {
      const params = message.templateParams ?? {};
      const buttonSuffix = spec.button === 'booking' && message.bookingId ? bookingToken(message.bookingId) : spec.button === 'membership' && message.membershipId ? membershipToken(message.membershipId) : undefined;
      await sendTemplate(setup.keys, { to: message.recipient, template: setup.templates[kind], language: setup.language, bodyParams: spec.params.map((key) => params[key] ?? ''), buttonSuffix });
      await db.update(messages).set({ status: 'sent', sentAt: new Date(), lastError: null }).where(eq(messages.id, message.id));
      sent += 1;
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'WhatsApp couldn’t send this message.';
      // Anything that isn't a clear refusal from Meta is treated as worth another try.
      const temporary = !(err instanceof WhatsappError) || err.temporary;
      if (temporary && message.attempts < MAX_ATTEMPTS) {
        await db
          .update(messages)
          .set({ status: 'queued', lastError: reason, nextAttemptAt: new Date(now.getTime() + (RETRY_MINUTES[message.attempts - 1] ?? 60) * 60_000) })
          .where(eq(messages.id, message.id));
      } else {
        await giveUp(message, reason, now);
      }
      failed += 1;
    }
  }
  return { sent, failed };
}

async function sendEmails(mailer: Mailer, now: Date): Promise<{ sent: number; failed: number }> {
  const [settings] = await db.select().from(messageSettings).where(eq(messageSettings.id, 1));
  if (!settings?.emailEnabled || (mailer.ready && !(await mailer.ready()))) return { sent: 0, failed: 0 };

  const room = Math.min(EMAIL_BATCH_SIZE, settings.dailyEmailLimit - (await sentToday('email', now)));
  if (room <= 0) return { sent: 0, failed: 0 };
  const claimed = await claim('email', room, now);

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
      const giveUpNow = attempts >= MAX_ATTEMPTS;
      await db
        .update(messages)
        .set({
          status: giveUpNow ? 'failed' : 'queued',
          lastError: friendlyMailError(err),
          nextAttemptAt: new Date(now.getTime() + (RETRY_MINUTES[attempts - 1] ?? 60) * 60_000),
        })
        .where(eq(messages.id, message.id));
      failed += 1;
    }
  }
  return { sent, failed };
}
