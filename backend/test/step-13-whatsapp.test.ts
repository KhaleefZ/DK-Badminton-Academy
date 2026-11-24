// Automatic WhatsApp through Meta's WhatsApp Cloud API.
// Step 1: the stored settings and message fields. Step 2: the sender, against a fake Meta.
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/client.js';
import { bookings, courts, messageSettings, messages } from '../src/db/schema.js';
import { encrypt } from '../src/lib/secret.js';
import { addDays, venueToday } from '../src/lib/time.js';
import { bookingToken, membershipToken } from '../src/messages/links.js';
import { notifyOwnerRefund, WHATSAPP_TEMPLATES } from '../src/messages/notify.js';
import { processMessages, WHATSAPP_BATCH_SIZE } from '../src/messages/queue.js';
import { checkConnection, DEFAULT_TEMPLATES, GRAPH_VERSION, sendTemplate, templateValue, useTestWhatsapp, whatsappSetup, whatsappTo, WhatsappError } from '../src/messages/whatsapp.js';
import { addStaff, ORIGIN, PASSWORD, signIn, testApp } from './helpers.js';

const { app } = testApp();
const WEBSITE = 'http://localhost:5173';

describe('WhatsApp settings (step 1)', () => {
  it('start switched off, with safe defaults, so nothing changes until the Owner adds keys', async () => {
    const [row] = await db.select().from(messageSettings).where(eq(messageSettings.id, 1));
    expect(row).toMatchObject({
      whatsappEnabled: false,
      whatsappPhoneNumberId: null,
      whatsappTokenEncrypted: null,
      whatsappBusinessAccountId: null,
      whatsappTemplateLanguage: 'en',
      whatsappTemplates: null,
      ownerWhatsappNumbers: null,
      dailyWhatsappLimit: 200,
    });
  });

  it('keep owner numbers and template names as lists and maps', async () => {
    await db.update(messageSettings).set({ ownerWhatsappNumbers: ['9876543210', '+91 98765 00000'], whatsappTemplates: { booking_confirmed: 'dk_booking_confirmed' } });
    const [row] = await db.select().from(messageSettings);
    expect(row!.ownerWhatsappNumbers).toEqual(['9876543210', '+91 98765 00000']);
    expect(row!.whatsappTemplates).toEqual({ booking_confirmed: 'dk_booking_confirmed' });
  });
});

describe('message fields for WhatsApp (step 1)', () => {
  it('store template values for retries and the fallback email, and default to a customer message', async () => {
    const params = { name: 'Asha', bookingNo: 'BKG-0001', totalPaise: 90000, duePaise: 0, receiptNo: null };
    const [row] = await db
      .insert(messages)
      .values({ channel: 'whatsapp', template: 'booking_confirmed', recipient: '9876543210', subject: 'Booking confirmed · BKG-0001', body: 'Preview', templateParams: params })
      .returning();
    expect(row).toMatchObject({ audience: 'customer', fallbackOf: null, templateParams: params });

    const [fallback] = await db
      .insert(messages)
      .values({ template: 'booking_confirmed', recipient: 'asha@example.com', subject: 's', body: 'b', templateParams: params, fallbackOf: row!.id })
      .returning();
    expect(fallback).toMatchObject({ channel: 'email', fallbackOf: row!.id });
  });

  it('marks staff alerts as owner messages, so they never fall back to a customer email', async () => {
    await db.update(messageSettings).set({ notifyEmail: 'owner@example.com' });
    await request(app).post('/public/enquiries').set('Origin', WEBSITE).send({ name: 'Bala', email: 'bala@example.com', message: 'Evening slots?', consent: true }).expect(201);
    const rows = await db.select({ template: messages.template, audience: messages.audience }).from(messages);
    expect(rows).toEqual(expect.arrayContaining([{ template: 'enquiry_received', audience: 'customer' }, { template: 'staff_new_enquiry', audience: 'owner' }]));
  });
});

describe('the migration only added columns', () => {
  it('kept every database rule (triggers are lost if a table is rebuilt)', async () => {
    const { results } = await (db as any).$client.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all();
    const names = (results as { name: string }[]).map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(['payments_no_overpayment', 'payments_number', 'court_reservations_no_overlap_insert', 'staff_limit_insert']));
    expect(names).toHaveLength(16);
  });
});

/* ---------- Step 2: the sender ---------- */

type Call = { url: string; method: string; auth: string | null; body: any };

/** Behaves like Meta's Graph API: records each request and answers with whatever the test sets. */
function fakeMeta(answer: (call: Call) => Response | Promise<Response> = () => Response.json({ messaging_product: 'whatsapp', contacts: [{ wa_id: '919876543210' }], messages: [{ id: 'wamid.TEST1' }] })) {
  const calls: Call[] = [];
  useTestWhatsapp(async (url, init) => {
    const call = { url, method: init?.method ?? 'GET', auth: new Headers(init?.headers).get('authorization'), body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    return answer(call);
  });
  return calls;
}
const metaError = (status: number, code: number, extra: object = {}) => Response.json({ error: { message: `(#${code}) Something`, type: 'OAuthException', code, error_data: { details: 'Detail from Meta' }, fbtrace_id: 'x', ...extra } }, { status });

const keys = { phoneNumberId: '1234567890', token: 'EAAG-test-token' };
const message = { to: '98765 43210', template: 'dk_booking_confirmed', language: 'en', bodyParams: ['Asha', 'BKG-0012', 'Court 1', 'Sat 22 Nov', '6:00 PM – 7:30 PM', '₹900', '₹900', 'Online · RCP-0031', '₹0'], buttonSuffix: 'abc_DEF-123' };

afterEach(() => useTestWhatsapp(null));

describe('sending a template (step 2)', () => {
  it('makes exactly one request to Meta, in the documented shape', async () => {
    const calls = fakeMeta();
    expect(await sendTemplate(keys, message)).toEqual({ messageId: 'wamid.TEST1' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: `https://graph.facebook.com/${GRAPH_VERSION}/1234567890/messages`, method: 'POST', auth: 'Bearer EAAG-test-token' });
    expect(calls[0]!.body).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '+919876543210',
      type: 'template',
      template: {
        name: 'dk_booking_confirmed',
        language: { code: 'en' },
        components: [
          { type: 'body', parameters: message.bodyParams.map((text) => ({ type: 'text', text })) },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'abc_DEF-123' }] },
        ],
      },
    });
  });

  it('leaves the button out when there is none, and tidies values Meta would refuse', async () => {
    const calls = fakeMeta();
    await sendTemplate(keys, { ...message, buttonSuffix: undefined, bodyParams: ['Line one\nline two', '  spaced     out  ', '', null as never, 900] });
    const { components } = calls[0]!.body.template;
    expect(components).toHaveLength(1);
    expect(components[0].parameters.map((p: { text: string }) => p.text)).toEqual(['Line one line two', 'spaced out', '-', '-', '900']);
  });

  it('writes numbers the way Meta wants them', () => {
    expect(whatsappTo('98765 43210')).toBe('+919876543210');
    expect(whatsappTo('+91 98765-43210')).toBe('+919876543210');
    expect(whatsappTo('09876543210')).toBe('+919876543210');
    expect(whatsappTo('+44 7700 900123')).toBe('+447700900123');
    expect(templateValue('a\tb')).toBe('a b');
  });
});

describe('when Meta says no (step 2)', () => {
  it.each([
    [190, false, /expired/],
    [131026, false, /isn’t on WhatsApp/],
    [132001, false, /isn’t approved/],
    [131042, false, /payment method/],
    [130429, true, /tried again shortly/],
    [131056, true, /short time/],
    [80007, true, /rate limit/],
  ])('code %i: temporary=%s, in plain words', async (code, temporary, words) => {
    fakeMeta(() => metaError(400, code));
    const err = await sendTemplate(keys, message).catch((e) => e);
    expect(err).toBeInstanceOf(WhatsappError);
    expect(err).toMatchObject({ code, temporary });
    expect(err.message).toMatch(words);
    expect(err.message).toContain(`Meta code ${code}`);
  });

  it('retries anything Meta marks transient or answers with a server error, and an unknown code is permanent', async () => {
    fakeMeta(() => metaError(400, 999, { is_transient: true }));
    expect(await sendTemplate(keys, message).catch((e) => e)).toMatchObject({ temporary: true });
    fakeMeta(() => new Response('Bad gateway', { status: 502 }));
    expect(await sendTemplate(keys, message).catch((e) => e)).toMatchObject({ temporary: true, code: null });
    fakeMeta(() => metaError(400, 12345));
    const unknown = await sendTemplate(keys, message).catch((e) => e);
    expect(unknown).toMatchObject({ temporary: false, code: 12345 });
    expect(unknown.message).toContain('Detail from Meta');
  });

  it('treats no answer as temporary', async () => {
    useTestWhatsapp(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await sendTemplate(keys, message).catch((e) => e)).toMatchObject({ temporary: true, message: expect.stringMatching(/Couldn’t reach WhatsApp/) });
  });

  it('treats an answer without a message id as temporary', async () => {
    fakeMeta(() => Response.json({ messaging_product: 'whatsapp', messages: [] }));
    expect(await sendTemplate(keys, message).catch((e) => e)).toMatchObject({ temporary: true });
  });
});

describe('checking the keys (step 2)', () => {
  it('reads the number from Meta and sends nothing', async () => {
    const calls = fakeMeta(() => Response.json({ id: '1234567890', display_phone_number: '+91 98765 00000', verified_name: 'DK Badminton Academy', quality_rating: 'GREEN', code_verification_status: 'VERIFIED' }));
    expect(await checkConnection(keys)).toEqual({ displayPhoneNumber: '+91 98765 00000', verifiedName: 'DK Badminton Academy', qualityRating: 'GREEN', verification: 'VERIFIED' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'GET', auth: 'Bearer EAAG-test-token' });
    expect(calls[0]!.url).toBe(`https://graph.facebook.com/${GRAPH_VERSION}/1234567890?fields=display_phone_number,verified_name,quality_rating,code_verification_status`);
  });

  it('explains a refused token', async () => {
    fakeMeta(() => metaError(401, 190));
    await expect(checkConnection(keys)).rejects.toThrow(/expired/);
  });
});

describe('the saved setup (step 2)', () => {
  it('is off until switched on with a phone number id and token', async () => {
    expect(await whatsappSetup()).toBeNull();
    await db.update(messageSettings).set({ whatsappEnabled: true, whatsappPhoneNumberId: '1234567890' });
    expect(await whatsappSetup()).toBeNull();
  });

  it('decrypts the token and fills in template names, keeping the built-in one where a name is blank', async () => {
    await db.update(messageSettings).set({
      whatsappEnabled: true,
      whatsappPhoneNumberId: '1234567890',
      whatsappTokenEncrypted: encrypt('EAAG-secret'),
      whatsappTemplates: { booking_confirmed: 'dk_booking_ok_v2', booking_cancelled: '  ' },
      ownerWhatsappNumbers: ['9876500000', ' '],
    });
    const setup = await whatsappSetup();
    expect(setup).toMatchObject({ keys: { phoneNumberId: '1234567890', token: 'EAAG-secret' }, language: 'en', ownerNumbers: ['9876500000'], dailyLimit: 200 });
    expect(setup!.templates).toEqual({ ...DEFAULT_TEMPLATES, booking_confirmed: 'dk_booking_ok_v2' });
  });
});

/* ---------- Steps 3 and 4: what gets queued, and the sending job ---------- */

const FUTURE = addDays(venueToday(), 3);
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const OWNERS = ['9000000001', '9000000002'];
let owner: string;
let court1: string;
let plan: { id: string };

const admin = (method: 'get' | 'post' | 'put' | 'patch', path: string) => request(app)[method](path).set('Origin', ORIGIN).set('Cookie', owner);
const site = (method: 'get' | 'post', path: string) => request(app)[method](`/public${path}`).set('Origin', WEBSITE);
const turnOn = (over = {}) => db.update(messageSettings).set({ whatsappEnabled: true, whatsappPhoneNumberId: '1234567890', whatsappTokenEncrypted: encrypt('EAAG-token'), ownerWhatsappNumbers: OWNERS, emailEnabled: true, ...over });
const all = () => db.select().from(messages).orderBy(messages.createdAt);
const customerOnes = async () => (await all()).filter((m) => m.audience === 'customer');
const ownerOnes = async () => (await all()).filter((m) => m.audience === 'owner' && m.channel === 'whatsapp');
const mailer = () => {
  const sent: { to: string; subject: string; text: string }[] = [];
  return { sent, send: async (e: { to: string; subject: string; text: string }) => void sent.push(e) };
};
const deskBooking = async (over = {}) =>
  (await admin('post', '/bookings').send({ courtId: court1, date: FUTURE, start: '18:00', end: '19:30', newCustomer: { name: 'Asha Raman', phone: '98765 43210', email: 'asha@example.com' }, ...over }).expect(201)).body.booking;

beforeEach(async () => {
  // The settings row isn't emptied between tests, so start every test from WhatsApp's defaults.
  await db.update(messageSettings).set({ whatsappEnabled: false, whatsappPhoneNumberId: null, whatsappTokenEncrypted: null, whatsappBusinessAccountId: null, whatsappTemplateLanguage: 'en', whatsappTemplates: null, ownerWhatsappNumbers: null, dailyWhatsappLimit: 200, notifyEmail: null });
  owner = await signIn(app, (await addStaff({ role: 'owner', name: 'Kavya Owner' })).email);
  court1 = (await db.select().from(courts).orderBy(courts.sortOrder))[0]!.id;
  await admin('put', '/settings/hours').send({ hours: ALL_DAYS.map((weekday) => ({ weekday, opens: '06:00', closes: '22:00' })) }).expect(200);
  await admin('put', '/settings/prices').send({ rules: [{ courtId: null, days: ALL_DAYS, start: '00:00', end: '24:00', ratePaise: 60000 }] }).expect(200);
  plan = (await admin('post', '/memberships/plans').send({ name: 'Regular', kind: 'individual', pricePaise: 200000 }).expect(201)).body.plan;
});

describe('bookings on WhatsApp (steps 3–4)', () => {
  it('a desk booking: the customer gets the confirmation with payment details, every owner number gets an alert', async () => {
    await turnOn();
    const b = await deskBooking();
    const [customer] = await customerOnes();
    expect(customer).toMatchObject({ channel: 'whatsapp', template: 'booking_confirmed', recipient: '98765 43210', bookingId: b.id });
    expect(customer!.templateParams).toEqual({
      name: 'Asha Raman',
      bookingNo: b.bookingNo,
      court: expect.any(String),
      date: expect.stringMatching(/\d{4}$/),
      time: '6:00 PM – 7:30 PM',
      total: '₹900',
      paid: '₹0',
      due: '₹900',
      payment: 'Not paid yet, pay at the academy',
    });
    const owners = await ownerOnes();
    expect(owners.map((m) => m.recipient)).toEqual(OWNERS);
    expect(owners[0]!.templateParams).toMatchObject({ bookingNo: b.bookingNo, source: 'Desk', customer: 'Asha Raman', phone: '98765 43210', total: '₹900', payment: 'Not paid, ₹900 due' });
    // Staff already know about desk bookings, so no staff email.
    expect((await all()).some((m) => m.template === 'staff_new_booking')).toBe(false);
  });

  it('a paid website booking: paid, how, receipt number, and the owner alert says website', async () => {
    await turnOn({ notifyEmail: 'owner@example.com' });
    const { body } = await site('post', '/bookings').send({ courtId: court1, date: FUTURE, start: '18:00', durationMinutes: 90, name: 'Web Player', phone: '98765 11111', email: '' }).expect(201);
    expect(await all()).toEqual([]);
    await site('post', `/bookings/${body.token}/pay`).send({ result: 'success' }).expect(200);
    const [customer] = await customerOnes();
    expect(customer!.templateParams).toMatchObject({ total: '₹900', paid: '₹900', due: '₹0', payment: expect.stringMatching(/^Online \(test\) · RCP-\d+$/) });
    expect((await ownerOnes())[0]!.templateParams).toMatchObject({ source: 'Website', payment: 'Paid ₹900 (Online (test))' });
    // The staff email alert for website bookings carries on as before.
    expect((await all()).filter((m) => m.template === 'staff_new_booking')).toHaveLength(1);
  });

  it('cancelling messages the customer only; moving a booking messages nobody', async () => {
    await turnOn();
    const b = await deskBooking();
    const before = (await all()).length;
    await admin('patch', `/bookings/${b.id}`).send({ courtId: court1, date: FUTURE, start: '19:30', end: '21:00' }).expect(200);
    expect(await all()).toHaveLength(before);
    await admin('post', `/bookings/${b.id}/cancel`).send({}).expect(200);
    const added = (await all()).slice(before);
    expect(added.map((m) => [m.audience, m.channel, m.template])).toEqual([['customer', 'whatsapp', 'booking_cancelled']]);
    expect(added[0]!.templateParams).toMatchObject({ bookingNo: b.bookingNo, time: '7:30 PM – 9:00 PM', paid: '₹0' });
  });

  it('sends each template to Meta with its values in order and the private link as the button', async () => {
    await turnOn();
    const calls = fakeMeta();
    const b = await deskBooking();
    const result = await processMessages(mailer());
    expect(result.whatsapp).toEqual({ sent: 3, failed: 0 });
    const toCustomer = calls.find((c) => c.body.to === '+919876543210')!;
    const params = (await customerOnes())[0]!.templateParams!;
    expect(toCustomer.body.template.name).toBe('dk_booking_confirmed');
    expect(toCustomer.body.template.components).toEqual([
      { type: 'body', parameters: WHATSAPP_TEMPLATES.booking_confirmed.params.map((key) => ({ type: 'text', text: String(params[key]) })) },
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: bookingToken(b.id) }] },
    ]);
    expect(calls.filter((c) => c.body.template.name === 'dk_owner_new_booking').map((c) => c.body.to)).toEqual(['+919000000001', '+919000000002']);
    expect((await all()).every((m) => m.status === 'sent')).toBe(true);
  });

  it('with WhatsApp off, the customer gets the email (if they gave one) and owners get nothing', async () => {
    await deskBooking();
    expect((await all()).map((m) => [m.channel, m.template, m.recipient])).toEqual([['email', 'booking_confirmed', 'asha@example.com']]);
    await deskBooking({ start: '20:00', end: '21:00', newCustomer: { name: 'No Email', phone: '98765 22222' } });
    expect(await all()).toHaveLength(1);
  });
});

describe('memberships on WhatsApp (steps 3–4)', () => {
  const addBatch = async () => (await admin('post', '/memberships/batches').send({ name: 'Morning', planId: plan.id, courtId: court1, days: [1, 3, 5], start: '06:00', end: '07:00', capacity: 4, startsOn: addDays(venueToday(), 1), endsOn: addDays(venueToday(), 120) }).expect(201)).body.batch;
  const join = async (batch: { id: string }, over = {}) => (await admin('post', '/memberships').send({ holderName: 'Meena S', phone: '98765 33333', email: '', planId: plan.id, batchId: batch.id, startsOn: addDays(venueToday(), 1), ...over }).expect(201)).body.membership;

  it('confirmed (with payment details) and renewed (with amount due) go to the member; owners hear about new and cancelled', async () => {
    await turnOn();
    const m = await join(await addBatch());
    const [confirmed] = await customerOnes();
    expect(confirmed).toMatchObject({ channel: 'whatsapp', template: 'membership_confirmed', recipient: '98765 33333' });
    expect(confirmed!.templateParams).toMatchObject({ name: 'Meena S', plan: 'Regular', membershipNo: m.membershipNo, schedule: 'Morning, Mon, Wed, Fri 6:00 AM – 7:00 AM', monthly: '₹2,000', paid: '₹0', due: '₹2,000' });
    expect((await ownerOnes()).map((o) => o.template)).toEqual(['owner_new_membership', 'owner_new_membership']);

    await admin('post', `/memberships/${m.id}/renew`).expect(200);
    const renewed = (await customerOnes()).at(-1)!;
    expect(renewed.template).toBe('membership_renewed');
    expect(renewed.templateParams).toMatchObject({ membershipNo: m.membershipNo, amount: '₹2,000', credit: '₹0', due: '₹2,000' });

    const before = (await customerOnes()).length;
    await admin('post', `/memberships/${m.id}/cancel`).send({ reason: 'Moving city' }).expect(200);
    expect(await customerOnes()).toHaveLength(before);
    const cancelled = (await ownerOnes()).filter((o) => o.template === 'owner_membership_cancelled');
    expect(cancelled).toHaveLength(2);
    expect(cancelled[0]!.templateParams).toMatchObject({ membershipNo: m.membershipNo, holder: 'Meena S', reason: 'Moving city', by: 'Kavya Owner' });
  });

  it('the membership button opens the member’s private page', async () => {
    await turnOn();
    const calls = fakeMeta();
    const m = await join(await addBatch());
    await processMessages(mailer());
    const toMember = calls.find((c) => c.body.to === '+919876533333')!;
    expect(toMember.body.template.components[1].parameters[0].text).toBe(membershipToken(m.id));
  });
});

describe('refunds reach the owner (steps 3–4)', () => {
  it('by staff, automatic, and failed, with amount, receipt and who did it', async () => {
    await turnOn();
    const b = await deskBooking();
    await db.delete(messages);
    const staffId = (await db.select().from(bookings))[0]!.createdBy;
    await notifyOwnerRefund({ amountPaise: 45000, receipt: 'RCP-0031', bookingId: b.id, reason: 'Cancelled 10 hours before', by: staffId });
    await notifyOwnerRefund({ amountPaise: 90000, receipt: 'pay_X', bookingId: b.id, reason: 'Paid twice', by: null, failed: true });
    const rows = await ownerOnes();
    expect(rows).toHaveLength(4);
    expect(rows[0]!.templateParams).toEqual({ amount: '₹450', receipt: 'RCP-0031', about: b.bookingNo, customer: 'Asha Raman', reason: 'Cancelled 10 hours before', by: 'Kavya Owner', outcome: 'Refunded through the payment gateway.' });
    expect(rows[2]!.templateParams).toMatchObject({ by: 'automatic', outcome: expect.stringMatching(/FAILED/) });
    expect(await customerOnes()).toEqual([]);
  });
});

describe('when WhatsApp can’t deliver (step 3)', () => {
  it('a refused customer message falls back to email once; an owner message just fails', async () => {
    await turnOn();
    fakeMeta(() => metaError(400, 131026));
    await deskBooking();
    const m = mailer();
    const result = await processMessages(m);
    expect(result.whatsapp).toEqual({ sent: 0, failed: 3 });
    const rows = await all();
    const failedCustomer = rows.find((r) => r.channel === 'whatsapp' && r.audience === 'customer')!;
    expect(failedCustomer).toMatchObject({ status: 'failed', lastError: expect.stringMatching(/isn’t on WhatsApp/) });
    const fallback = rows.find((r) => r.fallbackOf === failedCustomer.id)!;
    expect(fallback).toMatchObject({ channel: 'email', recipient: 'asha@example.com', template: 'booking_confirmed', status: 'sent' });
    expect(m.sent).toHaveLength(1);
    expect(m.sent[0]!.text).toContain('Payment: Not paid yet, pay at the academy');
    expect(rows.filter((r) => r.audience === 'owner').every((r) => r.status === 'failed')).toBe(true);
  });

  it('a temporary problem is retried, and only after the last try does the email go', async () => {
    await turnOn({ ownerWhatsappNumbers: [] });
    fakeMeta(() => metaError(429, 130429));
    await deskBooking();
    let now = new Date();
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await processMessages(mailer(), now);
      const [row] = await customerOnes();
      expect(row).toMatchObject({ status: 'queued', attempts: attempt });
      now = new Date(row!.nextAttemptAt.getTime() + 1000);
    }
    await processMessages(mailer(), now);
    const rows = await customerOnes();
    expect(rows.map((r) => [r.channel, r.status])).toEqual([['whatsapp', 'failed'], ['email', 'sent']]);
  });

  it('switched off after queueing: customers get the email, owners’ messages fail with the reason', async () => {
    await turnOn();
    await deskBooking();
    await db.update(messageSettings).set({ whatsappEnabled: false });
    await processMessages(mailer());
    const rows = await all();
    expect(rows.filter((r) => r.channel === 'whatsapp').every((r) => r.status === 'failed' && /switched off/.test(r.lastError ?? ''))).toBe(true);
    expect(rows.filter((r) => r.channel === 'email').map((r) => r.recipient)).toEqual(['asha@example.com']);
  });

  it('past the daily limit, nothing more goes to Meta that day; customers get the email', async () => {
    await turnOn({ dailyWhatsappLimit: 1, ownerWhatsappNumbers: [] });
    const calls = fakeMeta();
    await deskBooking();
    await deskBooking({ start: '20:00', end: '21:00', newCustomer: { name: 'Second', phone: '98765 44444', email: 'second@example.com' } });
    await processMessages(mailer());
    // The next run finds today's limit used up, so the one still waiting goes by email instead.
    await processMessages(mailer());
    expect(calls).toHaveLength(1);
    const rows = await customerOnes();
    expect(rows.filter((r) => r.channel === 'whatsapp').map((r) => r.status).sort()).toEqual(['failed', 'sent']);
    expect(rows.find((r) => r.channel === 'whatsapp' && r.status === 'failed')!.lastError).toMatch(/limit \(1\)/);
    expect(rows.find((r) => r.channel === 'email')!.recipient).toBe('second@example.com');
  });

  it('no email to fall back on: the failure stays on the Messages page for staff', async () => {
    await turnOn({ ownerWhatsappNumbers: [] });
    fakeMeta(() => metaError(400, 131026));
    await deskBooking({ newCustomer: { name: 'No Email', phone: '98765 22222' } });
    await processMessages(mailer());
    expect((await all()).map((r) => [r.channel, r.status])).toEqual([['whatsapp', 'failed']]);
  });

  it('sends at most WHATSAPP_BATCH_SIZE a run', async () => {
    await turnOn();
    const calls = fakeMeta();
    for (const [i, start] of ['06:00', '08:00', '10:00'].entries()) await deskBooking({ start, end: `${String(Number(start.slice(0, 2)) + 1).padStart(2, '0')}:00`, newCustomer: { name: `P${i}`, phone: `9876555${100 + i}`, email: '' } });
    await processMessages(mailer());
    expect(calls).toHaveLength(WHATSAPP_BATCH_SIZE);
  });
});

/* ---------- Step 6: the Owner's WhatsApp settings ---------- */

describe('WhatsApp settings API (step 6)', () => {
  const body = (over = {}) => ({ enabled: false, phoneNumberId: '1234567890', token: 'EAAG-secret-token', businessAccountId: '987654321', templateLanguage: 'en', templates: {}, ownerNumbers: ['98765 00001'], dailyLimit: 150, currentPassword: PASSWORD, ...over });
  const save = (over = {}) => admin('put', '/messages/whatsapp').send(body(over));
  const okNumber = () => fakeMeta(() => Response.json({ id: '1234567890', display_phone_number: '+91 98765 00000', verified_name: 'DK Badminton Academy', quality_rating: 'GREEN', code_verification_status: 'VERIFIED' }));

  it('is the Owner’s alone, needs the password, and never sends the token back', async () => {
    const desk = await signIn(app, (await addStaff({ role: 'front_desk' })).email);
    await request(app).put('/messages/whatsapp').set('Origin', ORIGIN).set('Cookie', desk).send(body()).expect(403);
    await save({ currentPassword: 'wrong-password-123' }).expect(400);
    const { body: saved } = await save().expect(200);
    expect(saved.settings.whatsapp).toEqual({ enabled: false, phoneNumberId: '1234567890', hasToken: true, businessAccountId: '987654321', templateLanguage: 'en', templates: {}, ownerNumbers: ['98765 00001'], dailyLimit: 150 });
    const { body: read } = await admin('get', '/messages/settings').expect(200);
    expect(JSON.stringify(read)).not.toContain('EAAG-secret-token');
    const [row] = await db.select().from(messageSettings);
    expect(row!.whatsappTokenEncrypted).not.toContain('EAAG');
  });

  it('lists the 8 templates to create in Meta, with the names in use', async () => {
    await save({ templates: { booking_confirmed: 'dk_booking_ok_v2', owner_refund: '' } }).expect(200);
    const { body: read } = await admin('get', '/messages/settings').expect(200);
    expect(read.whatsappTemplates).toHaveLength(8);
    expect(read.whatsappTemplates[0]).toMatchObject({ kind: 'booking_confirmed', defaultName: 'dk_booking_confirmed', name: 'dk_booking_ok_v2', button: 'booking', audience: 'customer' });
    expect(read.whatsappTemplates.find((t: { kind: string }) => t.kind === 'owner_refund')).toMatchObject({ name: 'dk_owner_refund', audience: 'owner', button: null });
    expect(read.settings.whatsapp.templates).toEqual({ booking_confirmed: 'dk_booking_ok_v2' });
  });

  it('keeps the saved token when left blank, and removes it when asked', async () => {
    await save().expect(200);
    await save({ token: '' }).expect(200);
    expect((await whatsappSetupKeys())).toBe('EAAG-secret-token');
    const { body: removed } = await save({ token: '', removeToken: true }).expect(200);
    expect(removed.settings.whatsapp.hasToken).toBe(false);
  });

  it.each([
    [{ phoneNumberId: 'abc' }, /digits only/],
    [{ templateLanguage: 'English' }, /language code/],
    [{ templates: { booking_confirmed: 'Has Spaces' } }, /small letters/],
    [{ templates: { not_a_message: 'x' } }, /Unknown message/],
    [{ ownerNumbers: ['1', '2', '3', '4', '5', '6'] }, /at most 5/],
    [{ ownerNumbers: ['abc'] }, /owner number/],
    [{ dailyLimit: 0 }, /at least 1/],
  ])('refuses %j', async (over, message) => {
    expect((await save(over).expect(400)).body.error.message).toMatch(message);
  });

  it('switches on only with keys Meta accepts', async () => {
    expect((await save({ enabled: true, token: '', phoneNumberId: '' }).expect(400)).body.error.code).toBe('WHATSAPP_KEYS_MISSING');
    fakeMeta(() => metaError(401, 190));
    const refused = await save({ enabled: true }).expect(400);
    expect(refused.body.error).toMatchObject({ code: 'WHATSAPP_REFUSED', message: expect.stringMatching(/expired/) });
    expect((await db.select().from(messageSettings))[0]!.whatsappEnabled).toBe(false);
    const calls = okNumber();
    const { body: on } = await save({ enabled: true }).expect(200);
    expect(on.settings.whatsapp.enabled).toBe(true);
    expect(calls[0]!.method).toBe('GET');
  });

  it('checks the saved keys without sending anything', async () => {
    await admin('post', '/messages/whatsapp/check').expect(400);
    await save().expect(200);
    const calls = okNumber();
    const { body: checked } = await admin('post', '/messages/whatsapp/check').expect(200);
    expect(checked.number).toEqual({ displayPhoneNumber: '+91 98765 00000', verifiedName: 'DK Badminton Academy', qualityRating: 'GREEN', verification: 'VERIFIED' });
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('sends a test confirmation to the first owner number, even before switching on', async () => {
    await save({ templates: { booking_confirmed: 'dk_booking_ok_v2' } }).expect(200);
    const calls = fakeMeta();
    const { body: sent } = await admin('post', '/messages/whatsapp/test').expect(200);
    expect(sent).toEqual({ sentTo: '98765 00001', template: 'dk_booking_ok_v2', messageId: 'wamid.TEST1' });
    expect(calls[0]!.body).toMatchObject({ to: '+919876500001', template: { name: 'dk_booking_ok_v2', language: { code: 'en' } } });
    expect(calls[0]!.body.template.components[0].parameters).toHaveLength(WHATSAPP_TEMPLATES.booking_confirmed.params.length);
    fakeMeta(() => metaError(400, 132001));
    expect((await admin('post', '/messages/whatsapp/test').expect(400)).body.error.message).toMatch(/isn’t approved/);
    await save({ ownerNumbers: [] }).expect(200);
    expect((await admin('post', '/messages/whatsapp/test').expect(400)).body.error.code).toBe('NO_OWNER_NUMBER');
  });
});

describe('retrying a WhatsApp message (step 6)', () => {
  it('can be retried, unless it already went by email instead', async () => {
    await turnOn({ ownerWhatsappNumbers: [] });
    fakeMeta(() => metaError(400, 131026));
    await deskBooking({ newCustomer: { name: 'No Email', phone: '98765 22222' } });
    await processMessages(mailer());
    const [failed] = await all();
    const { body: retried } = await admin('post', `/messages/${failed!.id}/retry`).expect(200);
    expect(retried.message).toMatchObject({ status: 'queued', attempts: 0 });

    await deskBooking({ start: '20:00', end: '21:00' });
    await processMessages(mailer());
    const withFallback = (await all()).find((m) => m.channel === 'whatsapp' && m.status === 'failed' && m.bookingId !== failed!.bookingId)!;
    expect((await admin('post', `/messages/${withFallback.id}/retry`).expect(400)).body.error.message).toMatch(/already sent by email/);
  });
});

/** The token as the sender will use it (decrypted), straight from the saved settings. */
async function whatsappSetupKeys() {
  const [row] = await db.select().from(messageSettings);
  const { decrypt } = await import('../src/lib/secret.js');
  return decrypt(row!.whatsappTokenEncrypted!);
}

/* ---------- Step 7: what the admin panel reads ---------- */

describe('messages in the admin panel (step 7)', () => {
  it('filters the message list by channel', async () => {
    await turnOn();
    await deskBooking();
    await db.insert(messages).values({ template: 'enquiry_received', recipient: 'p@example.com', subject: 's', body: 'b' });
    const whatsapp = (await admin('get', '/messages?channel=whatsapp').expect(200)).body.messages;
    const email = (await admin('get', '/messages?channel=email').expect(200)).body.messages;
    expect(whatsapp.map((m: { channel: string }) => m.channel)).toEqual(['whatsapp', 'whatsapp', 'whatsapp']);
    expect(email.map((m: { template: string }) => m.template)).toEqual(['enquiry_received']);
    expect((await admin('get', '/messages?channel=sms').expect(200)).body.messages).toHaveLength(4);
  });

  it('shows channel, audience and fallbacks on a booking’s and a member’s messages', async () => {
    await turnOn({ ownerWhatsappNumbers: ['9000000001'] });
    fakeMeta(() => metaError(400, 131026));
    const b = await deskBooking();
    await processMessages(mailer());
    const { body } = await admin('get', `/bookings/${b.id}`).expect(200);
    const shown = body.messages.map((m: { channel: string; audience: string; fallbackOf: string | null; status: string }) => [m.channel, m.audience, Boolean(m.fallbackOf), m.status]);
    expect(shown).toEqual(expect.arrayContaining([['whatsapp', 'customer', false, 'failed'], ['whatsapp', 'owner', false, 'failed'], ['email', 'customer', true, 'sent']]));

    useTestWhatsapp(null);
    const batch = (await admin('post', '/memberships/batches').send({ name: 'Morning', planId: plan.id, courtId: court1, days: [1], start: '06:00', end: '07:00', capacity: 4, startsOn: addDays(venueToday(), 1), endsOn: addDays(venueToday(), 60) }).expect(201)).body.batch;
    const m = (await admin('post', '/memberships').send({ holderName: 'Meena S', phone: '98765 33333', planId: plan.id, batchId: batch.id, startsOn: addDays(venueToday(), 1) }).expect(201)).body.membership;
    const detail = (await admin('get', `/memberships/${m.id}`).expect(200)).body;
    expect(detail.messages.map((x: { template: string; audience: string }) => [x.template, x.audience])).toEqual(expect.arrayContaining([['membership_confirmed', 'customer'], ['owner_new_membership', 'owner']]));
  });
});

describe('template wording Meta will approve (verified 23 Nov 2026)', () => {
  // Meta rejects a template that starts or ends with a value (error 2388299) or has too many values
  // for its length (2388293), and refuses a send whose value count doesn't match (132000).
  const templates = Object.entries(WHATSAPP_TEMPLATES);

  it.each(templates)('%s numbers its values 1..n, one per parameter', (_kind, t) => {
    const numbers = [...t.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
    expect(numbers).toEqual(t.params.map((_, i) => i + 1));
  });

  it.each(templates)('%s starts and ends with fixed text, with enough words around the values', (_kind, t) => {
    expect(t.body).not.toMatch(/^\s*\{\{/);
    expect(t.body).not.toMatch(/\}\}[.\s]*$/);
    expect(t.body).not.toMatch(/\}\}\s*\{\{/);
    const words = t.body.replace(/\{\{\d+\}\}/g, '').split(/\s+/).filter(Boolean).length;
    expect(words / t.params.length).toBeGreaterThanOrEqual(2.5);
  });

  it('has an approved-name default for every kind', () => {
    expect(Object.keys(DEFAULT_TEMPLATES).sort()).toEqual(Object.keys(WHATSAPP_TEMPLATES).sort());
  });
});

describe('the busiest message inserts fit Cloudflare D1 (max 100 bound values per statement)', () => {
  // test/setup.ts makes every statement fail above D1's real limit, so these run the worst cases:
  // the most owner numbers Settings allows, plus a customer email and the staff alert.
  const FIVE_OWNERS = ['9000000001', '9000000002', '9000000003', '9000000004', '9000000005'];

  it('a paid website booking with 5 owner numbers, a customer email and the staff alert', async () => {
    await turnOn({ ownerWhatsappNumbers: FIVE_OWNERS, notifyEmail: 'owner@example.com' });
    const { body } = await site('post', '/bookings').send({ courtId: court1, date: FUTURE, start: '18:00', durationMinutes: 90, name: 'Web Player', phone: '98765 11111', email: 'web@example.com' }).expect(201);
    await site('post', `/bookings/${body.token}/pay`).send({ result: 'success' }).expect(200);
    expect(await ownerOnes()).toHaveLength(5);
    expect((await all()).filter((m) => m.template === 'staff_new_booking')).toHaveLength(1);
    expect(await customerOnes()).toHaveLength(1);
  });

  it('a membership, its cancellation and a refund with 5 owner numbers', async () => {
    await turnOn({ ownerWhatsappNumbers: FIVE_OWNERS, notifyEmail: 'owner@example.com' });
    const batch = (await admin('post', '/memberships/batches').send({ name: 'Morning', planId: plan.id, courtId: court1, days: [1, 3, 5], start: '06:00', end: '07:00', capacity: 4, startsOn: addDays(venueToday(), 1), endsOn: addDays(venueToday(), 120) }).expect(201)).body.batch;
    const m = (await admin('post', '/memberships').send({ holderName: 'Meena S', phone: '98765 33333', email: 'meena@example.com', planId: plan.id, batchId: batch.id, startsOn: addDays(venueToday(), 1) }).expect(201)).body.membership;
    await admin('post', `/memberships/${m.id}/cancel`).send({ reason: 'Moving city' }).expect(200);
    const b = await deskBooking();
    const staffId = (await db.select().from(bookings))[0]!.createdBy;
    await notifyOwnerRefund({ amountPaise: 45000, receipt: 'RCP-0031', bookingId: b.id, reason: 'Cancelled early', by: staffId });
    const templates = (await ownerOnes()).map((o) => o.template);
    for (const t of ['owner_new_membership', 'owner_membership_cancelled', 'owner_refund']) expect(templates.filter((x) => x === t)).toHaveLength(5);
  });
});
