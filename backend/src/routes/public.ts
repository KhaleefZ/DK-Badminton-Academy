import { Router } from 'express';
import type { Request, RequestHandler } from 'express';
import { and, eq, gt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { hashToken } from '../auth/crypto.js';
import { db, previousChanged, runBatch, type Statement } from '../db/client.js';
import { bookings, courtReservations, courts, customers, enquiries, messageSettings, payments, settings, siteImages } from '../db/schema.js';
import { auditEntry, auditIfChanged } from '../lib/audit.js';
import { AppError, invalid, notFound } from '../lib/errors.js';
import { instantAt, isDate, periodView, toMinutes } from '../lib/time.js';
import { parseBody, UUID } from '../lib/validate.js';
import { bookingToken } from '../messages/links.js';
import { enqueueBookingMessage, enqueueEnquiryMessages, enqueueStaffBookingAlert } from '../messages/queue.js';
import { publicMembershipRoutes } from './publicMemberships.js';
import { publicSite } from '../site/content.js';
import { availabilityFor, releaseExpiredHolds } from '../schedule/availability.js';
import { prepareReservation } from '../schedule/reservations.js';
import { WEBSITE_NUMBER } from '../lib/customers.js';
import { photoKey, photos } from '../storage.js';
import { onlinePayments, paymentInfo, webhookUrl } from '../payments/gateway.js';
import { startBookingCheckout, syncOrder } from '../payments/settle.js';

const MAX_LIVE_HOLDS = 2;

// A hidden field people never see. Bots that fill in every box give themselves away.
const trap = z.string().max(0, 'This request was blocked.').optional();

const indianMobile = z
  .string({ error: 'Enter a phone number.' })
  .transform((v) => v.replace(/[\s-]/g, '').replace(/^(\+91|0091|0)/, ''))
  .refine((v) => /^[6-9]\d{9}$/.test(v), 'Enter a valid 10-digit mobile number.');
const email = z.string({ error: 'Enter an email address.' }).trim().toLowerCase().email('Enter a valid email address.').max(254);
const name = z.string({ error: 'Enter your name.' }).trim().min(1, 'Enter your name.').max(120);

const bookingRequest = z.object({
  courtId: z.string({ error: 'Choose a court.' }).regex(UUID, 'Choose a court.'),
  date: z.string({ error: 'Choose a date.' }).refine(isDate, 'Choose a valid date.'),
  start: z.string({ error: 'Choose a time.' }),
  name,
  phone: indianMobile,
  email,
  notes: z.string().trim().max(1000).nullish().transform((v) => v || null),
  website: trap,
});

const enquiryRequest = z.object({
  name,
  email,
  phone: z.union([z.literal(''), indianMobile]).nullish().transform((v) => v || null),
  topic: z.string().trim().max(60).nullish().transform((v) => v || null),
  preferred: z.string().trim().max(200).nullish().transform((v) => v || null),
  message: z.string({ error: 'Enter your message.' }).trim().min(1, 'Enter your message.').max(2000),
  consent: z.literal(true, { error: 'Please agree to be contacted about this enquiry.' }),
  website: trap,
});

const payRequest = z.object({ result: z.enum(['success', 'failure'], { error: 'Choose a test result.' }) });

const onlineOff = () => new AppError(503, 'ONLINE_BOOKING_OFF', 'Online booking isn’t available yet. Please contact the academy.');
const holdGone = () => new AppError(410, 'HOLD_EXPIRED', 'Your time to pay ran out, so the slot was released. Please choose a slot again.');

async function fullByToken(token: string) {
  const [row] = await db
    .select({ booking: bookings, customer: customers, reservation: courtReservations, courtName: courts.name })
    .from(bookings)
    .innerJoin(customers, eq(bookings.customerId, customers.id))
    .innerJoin(courtReservations, eq(bookings.reservationId, courtReservations.id))
    .innerJoin(courts, eq(courtReservations.courtId, courts.id))
    .where(eq(bookings.accessTokenHash, hashToken(token)));
  if (!row) throw notFound('That booking');
  return row;
}

/** Only what the person holding the private link needs. Never their contact details, or anyone else's. */
function publicView({ booking, customer, reservation, courtName }: Awaited<ReturnType<typeof fullByToken>>) {
  const live = booking.status === 'pending_payment' && booking.holdExpiresAt! > new Date();
  return {
    bookingNo: booking.bookingNo,
    status: booking.status === 'pending_payment' && !live ? 'expired' : booking.status,
    holdExpiresAt: live ? booking.holdExpiresAt : null,
    amountPaise: booking.amountPaise,
    name: customer.name,
    courtName,
    ...periodView(reservation.startsAt, reservation.endsAt),
  };
}

/**
 * Confirms a booking that is still held and in time, in one statement, so two clicks can't both
 * confirm. Used by the simulator (with a pretend receipt) and for a free slot (no receipt).
 */
async function confirmHeldBooking(bookingId: string, req: Request, method: 'online_test' | null) {
  const [confirmed] = await db
    .update(bookings)
    .set({ status: 'active', holdExpiresAt: null, updatedAt: new Date() })
    .where(and(eq(bookings.id, bookingId), eq(bookings.status, 'pending_payment'), gt(bookings.holdExpiresAt, new Date())))
    .returning();
  if (!confirmed) {
    const [now] = await db.select({ status: bookings.status }).from(bookings).where(eq(bookings.id, bookingId));
    if (now?.status !== 'active') throw holdGone();
    return;
  }
  await runBatch([
    ...(method && confirmed.amountPaise > 0 ? [db.insert(payments).values({ bookingId: confirmed.id, amountPaise: confirmed.amountPaise, method, reference: 'Test mode' })] : []),
    auditEntry({ action: 'booking.confirmed_online', entityType: 'booking', entityId: confirmed.id, req }),
  ]);
  await enqueueBookingMessage(confirmed.id, 'confirmed');
  await enqueueStaffBookingAlert(confirmed.id);
}

export function publicRouter({ writeLimiter }: { writeLimiter: RequestHandler }): Router {
  const router = Router();

  /** Contact details the Owner has saved. Anything not set yet is null, and the website hides it. */
  router.get('/venue', async (_req, res) => {
    const [[venue], [messaging]] = await Promise.all([db.select().from(settings).where(eq(settings.id, 1)), db.select().from(messageSettings).where(eq(messageSettings.id, 1))]);
    res.json({ name: venue!.venueName, address: venue!.address, phone: venue!.phone, email: venue!.email, whatsappNumber: messaging!.whatsappNumber });
  });

  /** How the website takes money right now: a gateway, the local simulator, or not at all. */
  router.get('/payments', async (_req, res) => {
    res.json(paymentInfo(await onlinePayments()));
  });

  router.get('/site', async (_req, res) => {
    res.json(await publicSite());
  });

  router.get('/images/:id', async (req, res) => {
    if (!UUID.test(req.params.id)) throw notFound('Photo');
    const [image] = await db.select().from(siteImages).where(eq(siteImages.id, req.params.id));
    const file = image ? await photos().get(photoKey(image.id)) : null;
    if (!image || !file) throw notFound('Photo');
    // A new upload gets a new id, so a photo can be kept for good. Without the policy header browsers block it on the website.
    res.set({ 'Cache-Control': 'public, max-age=31536000, immutable', 'Cross-Origin-Resource-Policy': 'cross-origin', 'Content-Type': image.contentType });
    res.send(Buffer.from(await file.arrayBuffer()));
  });

  router.get('/availability', async (req, res) => {
    const { date } = req.query;
    if (!isDate(date)) throw invalid('Choose a valid date.');
    const day = await availabilityFor(date);
    const payment = paymentInfo(await onlinePayments());
    res.json({
      date: day.date,
      slotMinutes: day.slotMinutes,
      holdMinutes: day.holdMinutes,
      lastOnlineDate: day.lastOnlineDate,
      onlineBooking: payment.online,
      testMode: payment.testMode,
      // Say nothing about why a slot is taken, or by whom.
      courts: day.courts.map((court) => ({
        id: court.id,
        name: court.name,
        slots: court.slots.map((s) => ({ start: s.start, end: s.end, pricePaise: s.pricePaise, available: payment.online && s.onlineBookable })),
      })),
    });
  });

  router.post('/bookings', writeLimiter, async (req, res) => {
    if ((await onlinePayments()).kind === 'off') throw onlineOff();
    const values = parseBody(bookingRequest, req.body);

    // The price and limits come from the server's own slot, never from what the browser sent.
    const day = await availabilityFor(values.date);
    const slot = day.courts.find((c) => c.id === values.courtId)?.slots.find((s) => s.start === values.start);
    if (!slot?.onlineBookable) throw new AppError(409, 'SLOT_TAKEN', 'That slot was just taken or is no longer available. Please choose another.');
    const start = toMinutes(slot.start)!;
    const end = toMinutes(slot.end)!;

    const id = crypto.randomUUID();
    const token = bookingToken(id);
    const [venue] = await db.select({ holdMinutes: settings.holdMinutes }).from(settings).where(eq(settings.id, 1));
    const reservation = await prepareReservation({ courtId: values.courtId, kind: 'booking', startsAt: instantAt(values.date, start), endsAt: instantAt(values.date, end) });

    const steps: Statement[] = [];
    const [existing] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.type, 'website'), eq(customers.email, values.email), eq(customers.phone, values.phone), sql`${customers.deletedAt} IS NULL`))
      .limit(1);
    const customerId = existing?.id ?? crypto.randomUUID();
    if (!existing) steps.push(db.insert(customers).values({ id: customerId, customerNo: WEBSITE_NUMBER(), type: 'website', name: values.name, phone: values.phone, email: values.email }));

    // Otherwise one person could keep the whole evening off the market by never paying.
    if (existing) {
      const [{ live }] = (await db
        .select({ live: sql<number>`count(*)` })
        .from(bookings)
        .where(and(eq(bookings.customerId, customerId), eq(bookings.status, 'pending_payment'), gt(bookings.holdExpiresAt, new Date())))) as [{ live: number }];
      if (live >= MAX_LIVE_HOLDS) throw new AppError(409, 'TOO_MANY_HOLDS', 'You already have slots waiting for payment. Finish or release those first.');
    }

    // All or nothing: if someone took the slot a moment ago, the database refuses the lot.
    await runBatch([
      ...steps,
      reservation.insert,
      db.insert(bookings).values({
        id,
        customerId,
        reservationId: reservation.id,
        amountPaise: slot.pricePaise!,
        source: 'website',
        status: 'pending_payment',
        notes: values.notes,
        accessTokenHash: hashToken(token),
        holdExpiresAt: new Date(Date.now() + venue!.holdMinutes * 60_000),
      }),
      auditEntry({ action: 'booking.held_online', entityType: 'booking', entityId: id, newValues: { amountPaise: slot.pricePaise }, req }),
    ]);
    res.status(201).json({ token, booking: publicView(await fullByToken(token)) });
  });

  router.get('/bookings/:token', async (req, res) => {
    await releaseExpiredHolds();
    res.json({ booking: publicView(await fullByToken(String(req.params.token))) });
  });

  /** Starts paying a held booking through the gateway. The amount comes from the booking, never the browser. */
  router.post('/bookings/:token/checkout', writeLimiter, async (req, res) => {
    const online = await onlinePayments();
    if (online.kind === 'off') throw onlineOff();
    if (online.kind !== 'gateway') throw new AppError(409, 'NO_GATEWAY', 'Online payment isn’t set up yet.');
    const { booking } = await fullByToken(String(req.params.token));
    if (booking.status === 'active') throw new AppError(409, 'ALREADY_PAID', 'This booking is already confirmed.');
    if (booking.status !== 'pending_payment' || booking.holdExpiresAt! <= new Date()) throw holdGone();
    if (booking.amountPaise === 0) {
      await confirmHeldBooking(booking.id, req, null);
      return void res.json({ checkout: null, booking: publicView(await fullByToken(String(req.params.token))) });
    }
    res.json({ checkout: await startBookingCheckout(online.gateway, booking, webhookUrl(req.get('host'))) });
  });

  /** Asks the gateway straight away once its checkout closes, rather than waiting for its webhook. */
  router.post('/bookings/:token/check', writeLimiter, async (req, res) => {
    const token = String(req.params.token);
    const online = await onlinePayments();
    const { booking } = await fullByToken(token);
    if (online.kind === 'gateway' && booking.gatewayOrderId && (booking.status === 'pending_payment' || booking.status === 'expired')) {
      await syncOrder(online.gateway, booking.gatewayOrderId);
    }
    await releaseExpiredHolds();
    res.json({ booking: publicView(await fullByToken(token)) });
  });

  // Local development only: stands in for a gateway and never moves real money.
  router.post('/bookings/:token/pay', writeLimiter, async (req, res) => {
    const online = await onlinePayments();
    if (online.kind === 'off') throw onlineOff();
    if (online.kind !== 'simulator') throw new AppError(409, 'USE_GATEWAY', 'Pay through the payment page.');
    const token = String(req.params.token);
    const { result } = parseBody(payRequest, req.body);
    const { booking } = await fullByToken(token);
    if (booking.status === 'active') return void res.json({ booking: publicView(await fullByToken(token)) }); // A double click must not charge twice.
    if (booking.status !== 'pending_payment' || booking.holdExpiresAt! <= new Date()) throw holdGone();
    if (result === 'failure') throw new AppError(402, 'PAYMENT_FAILED', 'The payment didn’t go through. Your slot is still held, so you can try again.');
    await confirmHeldBooking(booking.id, req, 'online_test');
    res.json({ booking: publicView(await fullByToken(token)) });
  });

  router.post('/bookings/:token/release', async (req, res) => {
    const token = String(req.params.token);
    const { booking } = await fullByToken(token);
    const [released] = await db.batch([
      db
        .update(bookings)
        .set({ status: 'expired', holdExpiresAt: null, updatedAt: new Date() })
        .where(and(eq(bookings.id, booking.id), eq(bookings.status, 'pending_payment')))
        .returning({ id: bookings.id }),
      db.update(courtReservations).set({ status: 'released' }).where(and(eq(courtReservations.id, booking.reservationId), previousChanged)),
    ]);
    if (!released.length) throw new AppError(409, 'NOT_HELD', 'This booking isn’t waiting for payment.');
    res.json({ booking: publicView(await fullByToken(token)) });
  });

  router.post('/enquiries', writeLimiter, async (req, res) => {
    const { consent: _consent, website: _website, ...values } = parseBody(enquiryRequest, req.body);
    const [row] = await db.insert(enquiries).values(values).returning();
    await enqueueEnquiryMessages(row!);
    res.status(201).json({ enquiryNo: row!.enquiryNo });
  });

  publicMembershipRoutes(router, writeLimiter);

  router.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
  });

  return router;
}
