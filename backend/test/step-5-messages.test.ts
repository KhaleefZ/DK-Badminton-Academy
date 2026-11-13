import { eq } from 'drizzle-orm';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { db } from '../src/db/client.js';
import { auditLog, bookings, courts, messages, messageSettings } from '../src/db/schema.js';
import type { Email, Mailer } from '../src/lib/email.js';
import { decrypt, encrypt } from '../src/lib/secret.js';
import { addDays, venueToday } from '../src/lib/time.js';
import { bookingLink, whatsappDigits } from '../src/messages/links.js';
import { friendlyMailError, processMessages } from '../src/messages/queue.js';
import { addStaff, ORIGIN, PASSWORD, signIn } from './helpers.js';

const WEBSITE = 'http://localhost:5173';
const FUTURE = addDays(venueToday(), 3);
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

let sent: Email[];
let mailer: Mailer;
let app: ReturnType<typeof createApp>;
let owner: string;
let desk: string;
let court1: string;

const admin = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, cookie = owner) => request(app)[method](path).set('Origin', ORIGIN).set('Cookie', cookie);
const site = (method: 'get' | 'post', path: string) => request(app)[method](`/public${path}`).set('Origin', WEBSITE);
const slot = (over = {}) => ({ courtId: court1, date: FUTURE, start: '06:00', end: '07:00', ...over });
const person = { name: 'Asha', phone: '98765 43210', email: 'asha@example.com' };
const book = async (over = {}) => (await admin('post', '/bookings').send({ ...slot(), newCustomer: person, ...over }).expect(201)).body.booking;
const rows = () => db.select().from(messages).orderBy(messages.createdAt);
const sender = { emailEnabled: true, senderEmail: 'desk@gmail.com', senderName: 'DK Desk', appPassword: 'abcd efgh ijkl mnop', dailyEmailLimit: 100, currentPassword: PASSWORD };

beforeEach(async () => {
  sent = [];
  mailer = { send: async (email) => void sent.push(email) };
  app = createApp({ loginLimitPerWindow: 10_000, resetLimitPerWindow: 10_000, publicWriteLimitPerWindow: 10_000, mailer });
  owner = await signIn(app, (await addStaff({ role: 'owner' })).email);
  desk = await signIn(app, (await addStaff({ role: 'front_desk' })).email);
  court1 = (await db.select().from(courts).orderBy(courts.sortOrder))[0]!.id;
  await admin('put', '/settings/hours').send({ hours: ALL_DAYS.map((weekday) => ({ weekday, opens: '06:00', closes: '10:00' })) }).expect(200);
  await admin('put', '/settings/prices').send({ rules: [{ courtId: null, days: ALL_DAYS, start: '00:00', end: '24:00', ratePaise: 50000 }] }).expect(200);
});

describe('sender settings', () => {
  it('starts empty, so nothing is hardcoded', async () => {
    const { body } = await admin('get', '/messages/settings').expect(200);
    expect(body.settings).toMatchObject({ senderEmail: null, hasAppPassword: false, whatsappNumber: null, emailEnabled: true });
  });

  it('is Owner-only, and never returns the password', async () => {
    await admin('get', '/messages/settings', desk).expect(403);
    await admin('put', '/messages/settings', desk).send(sender).expect(403);
    await admin('post', '/messages/settings/test', desk).expect(403);
    const { body } = await admin('put', '/messages/settings').send(sender).expect(200);
    expect(body.settings).toMatchObject({ senderEmail: 'desk@gmail.com', hasAppPassword: true });
    expect(JSON.stringify(body)).not.toMatch(/abcd|Encrypted/);
  });

  it('stores the app password encrypted, without spaces, and keeps it out of history', async () => {
    await admin('put', '/messages/settings').send(sender).expect(200);
    const [row] = await db.select().from(messageSettings);
    expect(row!.appPasswordEncrypted).not.toContain('abcd');
    expect(decrypt(row!.appPasswordEncrypted!)).toBe('abcdefghijklmnop');
    const logs = await db.select().from(auditLog).where(eq(auditLog.action, 'messages.settings_updated'));
    expect(JSON.stringify(logs)).not.toMatch(/abcd|ncrypted/);
  });

  it('needs the Owner’s password to change the sender, but not the other details', async () => {
    const { currentPassword: _c, ...noPassword } = sender;
    await admin('put', '/messages/settings').send(noPassword).expect(400);
    await admin('put', '/messages/settings').send({ ...sender, currentPassword: 'wrong' }).expect(400);
    await admin('put', '/messages/settings').send(sender).expect(200);
    const { appPassword: _a, ...keep } = noPassword;
    const { body } = await admin('put', '/messages/settings').send({ ...keep, whatsappNumber: '+91 98765 43210' }).expect(200);
    expect(body.settings).toMatchObject({ hasAppPassword: true, whatsappNumber: '+91 98765 43210' });
  });

  it('can remove the saved password', async () => {
    await admin('put', '/messages/settings').send(sender).expect(200);
    const { appPassword: _a, ...keep } = sender;
    const { body } = await admin('put', '/messages/settings').send({ ...keep, removePassword: true }).expect(200);
    expect(body.settings.hasAppPassword).toBe(false);
  });

  it.each([[{ senderEmail: 'nope' }], [{ dailyEmailLimit: 0 }], [{ whatsappNumber: 'abc' }], [{ emailEnabled: 'yes' }]])('refuses %j', async (over) => {
    await admin('put', '/messages/settings').send({ ...sender, ...over }).expect(400);
  });

  it('sends a test email, and explains a failure plainly', async () => {
    await admin('put', '/messages/settings').send({ ...sender, notifyEmail: 'owner@example.com' }).expect(200);
    const { body } = await admin('post', '/messages/settings/test').expect(200);
    expect(body.sentTo).toBe('owner@example.com');
    expect(sent[0]!.to).toBe('owner@example.com');
    mailer.send = () => Promise.reject(new Error('Failed to plain authentication: 535-5.7.8 Username and Password not accepted'));
    const res = await admin('post', '/messages/settings/test').expect(502);
    expect(res.body.error.message).toMatch(/app password/);
    expect(res.body.error.message).not.toMatch(/raw gmail/);
  });

  it('encrypts differently each time', () => {
    expect(encrypt('x')).not.toBe(encrypt('x'));
    expect(decrypt(encrypt('secret'))).toBe('secret');
  });
});

describe('what gets queued', () => {
  it('emails a customer when staff book, change, cancel and restore', async () => {
    const booking = await book();
    await admin('patch', `/bookings/${booking.id}`).send(slot({ notes: 'Note only' })).expect(200);
    expect(await rows()).toHaveLength(1);
    await admin('patch', `/bookings/${booking.id}`).send(slot({ start: '07:00', end: '08:00' })).expect(200);
    await admin('post', `/bookings/${booking.id}/cancel`).send({}).expect(200);
    await admin('post', `/bookings/${booking.id}/restore`).expect(200);
    expect((await rows()).map((m) => m.template)).toEqual(['booking_confirmed', 'booking_changed', 'booking_cancelled', 'booking_confirmed']);
  });

  it('skips customers with no email, and saves nothing if the booking fails', async () => {
    await book({ newCustomer: { name: 'No email', phone: '98765 00000' } });
    expect(await rows()).toEqual([]);
    await book({ start: '07:00', end: '08:00' });
    const before = (await rows()).length;
    await admin('post', '/bookings').send({ ...slot({ start: '07:00', end: '08:00' }), newCustomer: person }).expect(409);
    expect(await rows()).toHaveLength(before);
  });

  it('emails only after a website booking is paid, and alerts staff', async () => {
    await admin('put', '/messages/settings').send({ ...sender, notifyEmail: 'owner@example.com' }).expect(200);
    const { body } = await site('post', '/bookings').send({ courtId: court1, date: FUTURE, start: '06:00', ...person }).expect(201);
    expect(await rows()).toEqual([]);
    await site('post', `/bookings/${body.token}/pay`).send({ result: 'failure' }).expect(402);
    expect(await rows()).toEqual([]);
    await site('post', `/bookings/${body.token}/pay`).send({ result: 'success' }).expect(200);
    await site('post', `/bookings/${body.token}/pay`).send({ result: 'success' }).expect(200);
    const queued = await rows();
    expect(queued.map((m) => [m.template, m.recipient]).sort()).toEqual([['booking_confirmed', 'asha@example.com'], ['staff_new_booking', 'owner@example.com']]);
    expect(queued.find((m) => m.template === 'booking_confirmed')!.body).toContain('Test mode');
  });

  it('doesn’t tell someone a hold they never paid for was cancelled', async () => {
    const { body } = await site('post', '/bookings').send({ courtId: court1, date: FUTURE, start: '06:00', ...person }).expect(201);
    const [row] = await db.select().from(bookings);
    await admin('post', `/bookings/${row!.id}/cancel`).send({}).expect(200);
    expect(await rows()).toEqual([]);
    expect(body.token).toBeTruthy();
  });

  it('acknowledges an enquiry without repeating its text, and passes it on to staff', async () => {
    await admin('put', '/messages/settings').send({ ...sender, notifyEmail: 'owner@example.com' }).expect(200);
    await site('post', '/enquiries').send({ name: 'BuyPills.example', email: 'victim@example.com', message: 'Visit spam.example now', consent: true }).expect(201);
    const queued = await rows();
    const ack = queued.find((m) => m.template === 'enquiry_received')!;
    expect(ack.recipient).toBe('victim@example.com');
    expect(ack.body + ack.subject).not.toMatch(/spam\.example|BuyPills/);
    expect(queued.find((m) => m.template === 'staff_new_enquiry')!.body).toContain('Visit spam.example now');
  });
});

describe('sending', () => {
  it('fills in the private link when sending, and never stores it', async () => {
    const booking = await book();
    const [waiting] = await rows();
    expect(waiting!.body).toContain('{{link}}');
    expect(waiting!.body).not.toContain('/booking/status/');
    expect(await processMessages(mailer)).toEqual({ sent: 1, failed: 0 });
    const link = bookingLink(booking.id);
    expect(sent[0]!.text).toContain(link);
    expect(sent[0]!.text).toContain(booking.bookingNo);
    const [done] = await rows();
    expect(done).toMatchObject({ status: 'sent', attempts: 1 });
    expect(done!.body).not.toContain('/booking/status/');
    // And the link works, including for a booking staff made.
    const token = link.split('/').pop()!;
    const page = await site('get', `/bookings/${token}`).expect(200);
    expect(page.body.booking.bookingNo).toBe(booking.bookingNo);
  });

  it('sends each message once, even if runs overlap', async () => {
    await book();
    await Promise.all([processMessages(mailer), processMessages(mailer), processMessages(mailer)]);
    expect(sent).toHaveLength(1);
  });

  it('waits while no sender is ready, then sends', async () => {
    await book();
    const notReady: Mailer = { ...mailer, ready: async () => false };
    expect(await processMessages(notReady)).toEqual({ sent: 0, failed: 0 });
    expect((await rows())[0]).toMatchObject({ status: 'queued', attempts: 0 });
    expect(await processMessages(mailer)).toEqual({ sent: 1, failed: 0 });
  });

  it('holds email while it’s switched off', async () => {
    await book();
    await admin('put', '/messages/settings').send({ emailEnabled: false, dailyEmailLimit: 100 }).expect(200);
    await processMessages(mailer);
    expect(sent).toEqual([]);
    expect((await rows())[0]!.status).toBe('queued');
  });

  it('retries with growing gaps, then gives up and can be retried by hand', async () => {
    await book();
    const broken: Mailer = { send: () => Promise.reject(new Error('Failed to plain authentication: 535 5.7.8')) };
    let at = Date.now();
    const gaps = [1, 5, 15, 60];
    for (let i = 0; i < 5; i += 1) {
      await processMessages(broken, new Date(at));
      at += (gaps[i] ?? 60) * 60_000 + 1000;
    }
    const [dead] = await rows();
    expect(dead).toMatchObject({ status: 'failed', attempts: 5 });
    expect(dead!.lastError).toMatch(/app password/);
    await processMessages(mailer, new Date(at + 86_400_000));
    expect(sent).toEqual([]);

    await admin('post', `/messages/${dead!.id}/retry`, desk).expect(200);
    await processMessages(mailer);
    expect(sent).toHaveLength(1);
    await admin('post', `/messages/${dead!.id}/retry`).expect(400);
  });

  it('doesn’t retry before the wait is over', async () => {
    await book();
    const broken: Mailer = { send: () => Promise.reject(new Error('x')) };
    await processMessages(broken);
    await processMessages(mailer);
    expect(sent).toEqual([]);
    expect((await rows())[0]).toMatchObject({ status: 'queued', attempts: 1 });
  });

  it('respects the daily limit, and carries on the next day', async () => {
    await admin('put', '/messages/settings').send({ emailEnabled: true, dailyEmailLimit: 1 }).expect(200);
    await book();
    await book({ start: '07:00', end: '08:00' });
    await processMessages(mailer);
    expect(sent).toHaveLength(1);
    await processMessages(mailer);
    expect(sent).toHaveLength(1);
    await processMessages(mailer, new Date(Date.now() + 86_400_000));
    expect(sent).toHaveLength(2);
  });

  it('drops news about a session that has ended', async () => {
    await book({ date: addDays(venueToday(), -3) });
    await processMessages(mailer);
    expect(sent).toEqual([]);
    expect((await rows())[0]!.status).toBe('expired');
  });

  it('frees a message stuck by a crash', async () => {
    await book();
    const [m] = await rows();
    await db.update(messages).set({ status: 'sending', nextAttemptAt: new Date(Date.now() - 3_600_000) }).where(eq(messages.id, m!.id));
    await processMessages(mailer);
    expect(sent).toHaveLength(1);
  });

  it('turns mail errors into plain advice', () => {
    expect(friendlyMailError(new Error('Failed to plain authentication: 535-5.7.8 Username and Password not accepted'))).toMatch(/app password/);
    expect(friendlyMailError(new Error('Timeout while waiting for smtp server response'))).toMatch(/try again/);
    expect(friendlyMailError(new Error('Invalid RCPT TO: <x@y> 550 5.1.1 No such user'))).toMatch(/refused/);
  });
});

describe('messages page', () => {
  it('needs a session, lists and filters, and cancels only what’s waiting', async () => {
    await request(app).get('/messages').expect(401);
    await book();
    const [m] = (await admin('get', '/messages?status=queued', desk).expect(200)).body.messages;
    expect(m.recipient).toBe('asha@example.com');
    expect((await admin('get', '/messages?status=sent')).body.messages).toEqual([]);
    expect((await admin('get', '/messages?q=asha')).body.messages).toHaveLength(1);
    await admin('post', `/messages/${m.id}/cancel`, desk).expect(200);
    await admin('post', `/messages/${m.id}/cancel`).expect(400);
    await processMessages(mailer);
    expect(sent).toEqual([]);
    await admin('post', '/messages/not-a-uuid/retry').expect(404);
  });
});

describe('from a booking', () => {
  it('resends the confirmation, only for a confirmed booking with an email', async () => {
    const booking = await book();
    await admin('post', `/bookings/${booking.id}/resend-email`, desk).expect(202);
    expect(await rows()).toHaveLength(2);
    await admin('post', `/bookings/${booking.id}/cancel`).send({}).expect(200);
    await admin('post', `/bookings/${booking.id}/resend-email`).expect(400);
    const silent = await book({ start: '08:00', end: '09:00', newCustomer: { name: 'None', phone: '98765 00000' } });
    expect((await admin('post', `/bookings/${silent.id}/resend-email`).expect(400)).body.error.code).toBe('NO_EMAIL');
  });

  it('builds a prefilled WhatsApp chat to the customer and logs the tap', async () => {
    const booking = await book();
    const { body } = await admin('get', `/bookings/${booking.id}`).expect(200);
    expect(body.whatsappUrl).toMatch(/^https:\/\/wa\.me\/919876543210\?text=/);
    expect(decodeURIComponent(body.whatsappUrl)).toContain(bookingLink(booking.id));
    await admin('post', `/bookings/${booking.id}/whatsapp-opened`).expect(204);
    const after = (await admin('get', `/bookings/${booking.id}`)).body;
    expect(after.messages.find((m: { channel: string }) => m.channel === 'whatsapp')).toMatchObject({ status: 'sent' });
    await processMessages(mailer);
    expect(sent).toHaveLength(1);
  });

  it('normalises numbers for WhatsApp', () => {
    expect(whatsappDigits('98765 43210')).toBe('919876543210');
    expect(whatsappDigits('+91 98765-43210')).toBe('919876543210');
    expect(whatsappDigits('0091 9876543210')).toBe('919876543210');
  });
});

describe('public venue', () => {
  it('shows saved contact details, and never sender details', async () => {
    await admin('put', '/messages/settings').send({ ...sender, whatsappNumber: '+91 98765 43210' }).expect(200);
    const { body } = await site('get', '/venue').expect(200);
    expect(body.whatsappNumber).toBe('+91 98765 43210');
    expect(JSON.stringify(body)).not.toMatch(/desk@gmail|ncrypted|abcd/);
  });
});
