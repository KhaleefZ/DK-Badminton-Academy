import { Router } from 'express';
import type { Request } from 'express';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { confirmPassword } from '../auth/passwords.js';
import { db } from '../db/client.js';
import { messageChannel, messageSettings, messages, messageStatus } from '../db/schema.js';
import { auditEntry } from '../lib/audit.js';
import type { Mailer } from '../lib/email.js';
import { invalid, notFound, AppError } from '../lib/errors.js';
import { likeTerm, ilike } from '../lib/search.js';
import { encrypt } from '../lib/secret.js';
import { parseBody, UUID } from '../lib/validate.js';
import { friendlyMailError } from '../messages/queue.js';
import { WHATSAPP_TEMPLATES } from '../messages/notify.js';
import { checkConnection, DEFAULT_TEMPLATES, sendTemplate, WhatsappError, type WhatsappKeys, type WhatsappMessageKind } from '../messages/whatsapp.js';
import { decrypt } from '../lib/secret.js';
import { currentAuth, requirePasswordCurrent, requirePermission, requireSession } from '../middleware/auth.js';

const optionalEmail = z.union([z.literal(''), z.string().trim().toLowerCase().email('Enter a valid email address.').max(254)]).nullish().transform((v) => v || null);

const settingsBody = z.object({
  emailEnabled: z.boolean({ error: 'Choose whether email is on.' }),
  senderName: z.string().trim().max(80).nullish().transform((v) => v || null),
  senderEmail: optionalEmail,
  // Google shows app passwords with spaces. Blank keeps the saved one.
  appPassword: z.string().max(100).nullish().transform((v) => v?.replace(/\s/g, '') || null),
  removePassword: z.boolean().optional(),
  notifyEmail: optionalEmail,
  dailyEmailLimit: z.number({ error: 'Enter a daily email limit.' }).int().min(1, 'The daily limit must be at least 1.').max(2000, 'The daily limit can be at most 2000.'),
  whatsappNumber: z
    .string()
    .trim()
    .max(20)
    .nullish()
    .transform((v) => v || null)
    .refine((v) => v === null || /^\+?\d[\d\s-]{8,18}$/.test(v), 'Enter a valid WhatsApp number.'),
});

const KINDS = Object.keys(DEFAULT_TEMPLATES) as WhatsappMessageKind[];

/** What the Owner enters for automatic WhatsApp. The token is a secret: blank keeps the saved one. */
const whatsappBody = z.object({
  enabled: z.boolean({ error: 'Choose whether WhatsApp messages are on.' }),
  phoneNumberId: z
    .string()
    .trim()
    .max(40)
    .nullish()
    .transform((v) => v || null)
    .refine((v) => v === null || /^\d{5,40}$/.test(v), 'The phone number ID is the long number from WhatsApp Manager (digits only).'),
  token: z.string().trim().max(1000).nullish().transform((v) => v || null),
  removeToken: z.boolean().optional(),
  businessAccountId: z
    .string()
    .trim()
    .max(40)
    .nullish()
    .transform((v) => v || null)
    .refine((v) => v === null || /^\d{5,40}$/.test(v), 'The business account ID is digits only.'),
  templateLanguage: z.string().trim().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/, 'Enter a language code like en or en_US.').default('en'),
  // Only names that differ from the built-in ones need to be given; blank keeps the built-in name.
  templates: z
    .record(z.string(), z.string().trim().max(512))
    .default({})
    .refine((t) => Object.keys(t).every((k) => (KINDS as string[]).includes(k)), 'Unknown message in template names.')
    .refine((t) => Object.values(t).every((v) => v === '' || /^[a-z0-9_]+$/.test(v)), 'Template names use small letters, numbers and underscores only.'),
  ownerNumbers: z
    .array(z.string().trim().max(20))
    .max(5, 'Add at most 5 owner numbers.')
    .default([])
    .transform((list) => [...new Set(list.filter(Boolean))])
    .refine((list) => list.every((n) => /^\+?\d[\d\s-]{8,18}$/.test(n)), 'Enter each owner number with its digits, like 98765 43210.'),
  dailyLimit: z.number({ error: 'Enter a daily WhatsApp limit.' }).int().min(1, 'The daily limit must be at least 1.').max(1000, 'The daily limit can be at most 1000.'),
});

/** The settings for the admin panel. Secrets never leave the server: only whether one is saved. */
const settingsView = (s: typeof messageSettings.$inferSelect) => ({
  emailEnabled: s.emailEnabled,
  senderName: s.senderName,
  senderEmail: s.senderEmail,
  hasAppPassword: Boolean(s.appPasswordEncrypted),
  notifyEmail: s.notifyEmail,
  dailyEmailLimit: s.dailyEmailLimit,
  whatsappNumber: s.whatsappNumber,
  whatsapp: {
    enabled: s.whatsappEnabled,
    phoneNumberId: s.whatsappPhoneNumberId,
    hasToken: Boolean(s.whatsappTokenEncrypted),
    businessAccountId: s.whatsappBusinessAccountId,
    templateLanguage: s.whatsappTemplateLanguage,
    templates: s.whatsappTemplates ?? {},
    ownerNumbers: s.ownerWhatsappNumbers ?? [],
    dailyLimit: s.dailyWhatsappLimit,
  },
});

/** The 8 templates to create in Meta: built-in name, the name in use, its body and whether it has a link button. */
const templateGuide = (s: typeof messageSettings.$inferSelect) =>
  KINDS.map((kind) => ({
    kind,
    defaultName: DEFAULT_TEMPLATES[kind],
    name: s.whatsappTemplates?.[kind]?.trim() || DEFAULT_TEMPLATES[kind],
    body: WHATSAPP_TEMPLATES[kind].body,
    params: WHATSAPP_TEMPLATES[kind].params,
    button: WHATSAPP_TEMPLATES[kind].button ?? null,
    audience: kind.startsWith('owner_') ? 'owner' : 'customer',
  }));

/** Meta's refusal as an API error: permanent ones are the Owner's to fix, temporary ones are worth another try. */
const metaError = (err: unknown) =>
  err instanceof WhatsappError ? new AppError(err.temporary ? 503 : 400, err.temporary ? 'WHATSAPP_BUSY' : 'WHATSAPP_REFUSED', err.message) : err;

/** Sample values for the test message, in the booking_confirmed template's order. */
const SAMPLE: Record<string, string> = { name: 'Test', bookingNo: 'BKG-TEST', court: 'Court 1', date: 'Sat 1 Jan 2028', time: '6:00 PM – 7:00 PM', total: '₹600', paid: '₹600', due: '₹0', payment: 'Online payment · RCP-TEST' };

export function messagesRouter({ mailer }: { mailer: Mailer }): Router {
  const router = Router();
  router.use(requireSession, requirePasswordCurrent);
  const owner = requirePermission('settings.manage');
  const staff = requirePermission('messages.manage');
  const actor = (req: Request) => currentAuth(req).staff;
  const load = async () => (await db.select().from(messageSettings).where(eq(messageSettings.id, 1)))[0]!;

  router.get('/settings', owner, async (_req, res) => {
    const saved = await load();
    res.json({ settings: settingsView(saved), whatsappTemplates: templateGuide(saved) });
  });

  /** The saved WhatsApp keys, ready to use, whether or not WhatsApp is switched on. */
  const savedWhatsappKeys = (s: typeof messageSettings.$inferSelect): WhatsappKeys => {
    if (!s.whatsappPhoneNumberId || !s.whatsappTokenEncrypted) throw invalid('Save the phone number ID and access token first.', 'WHATSAPP_KEYS_MISSING');
    try {
      return { phoneNumberId: s.whatsappPhoneNumberId, token: decrypt(s.whatsappTokenEncrypted) };
    } catch {
      throw invalid('The saved access token can’t be read (the app’s secret changed). Paste the token again.', 'WHATSAPP_KEYS_MISSING');
    }
  };

  // Whoever controls these can message customers in the academy's name, so every change takes the password.
  router.put('/whatsapp', owner, async (req, res) => {
    const values = parseBody(whatsappBody, req.body);
    await confirmPassword(actor(req), req.body?.currentPassword, req);
    const before = await load();
    const tokenEncrypted = values.token ? encrypt(values.token) : values.removeToken ? null : before.whatsappTokenEncrypted;
    const change = {
      whatsappEnabled: values.enabled,
      whatsappPhoneNumberId: values.phoneNumberId,
      whatsappTokenEncrypted: tokenEncrypted,
      whatsappBusinessAccountId: values.businessAccountId,
      whatsappTemplateLanguage: values.templateLanguage,
      whatsappTemplates: Object.fromEntries(Object.entries(values.templates).filter(([, name]) => name)),
      ownerWhatsappNumbers: values.ownerNumbers,
      dailyWhatsappLimit: values.dailyLimit,
      updatedAt: new Date(),
    };
    // Switching on only works with keys Meta accepts, so a typo can't silently turn every message into a failure.
    if (values.enabled) {
      if (!values.phoneNumberId || !tokenEncrypted) throw invalid('Enter the phone number ID and access token before switching WhatsApp on.', 'WHATSAPP_KEYS_MISSING');
      try {
        await checkConnection({ phoneNumberId: values.phoneNumberId, token: decrypt(tokenEncrypted) });
      } catch (err) {
        throw metaError(err);
      }
    }
    const [[row]] = await db.batch([
      db.update(messageSettings).set(change).where(eq(messageSettings.id, 1)).returning(),
      auditEntry({ action: 'messages.whatsapp_updated', actorStaffId: actor(req).id, entityType: 'settings', entityId: 'whatsapp', oldValues: settingsView(before).whatsapp, newValues: settingsView({ ...before, ...change }).whatsapp, req }),
    ]);
    res.json({ settings: settingsView(row!), whatsappTemplates: templateGuide(row!) });
  });

  /** Asks Meta about the saved number. Sends nothing and costs nothing. */
  router.post('/whatsapp/check', owner, async (_req, res) => {
    const keys = savedWhatsappKeys(await load());
    try {
      res.json({ number: await checkConnection(keys) });
    } catch (err) {
      throw metaError(err);
    }
  });

  /** Sends the booking confirmation template with sample values to the first owner number (or `to`). */
  router.post('/whatsapp/test', owner, async (req, res) => {
    const saved = await load();
    const keys = savedWhatsappKeys(saved);
    const to = (typeof req.body?.to === 'string' && req.body.to.trim()) || saved.ownerWhatsappNumbers?.[0];
    if (!to) throw invalid('Add an owner number to send the test to.', 'NO_OWNER_NUMBER');
    if (!/^\+?\d[\d\s-]{8,18}$/.test(to)) throw invalid('Enter a valid WhatsApp number.');
    const name = saved.whatsappTemplates?.booking_confirmed?.trim() || DEFAULT_TEMPLATES.booking_confirmed;
    try {
      const { messageId } = await sendTemplate(keys, { to, template: name, language: saved.whatsappTemplateLanguage, bodyParams: WHATSAPP_TEMPLATES.booking_confirmed.params.map((k) => SAMPLE[k] ?? '-'), buttonSuffix: 'test' });
      await db.batch([auditEntry({ action: 'messages.whatsapp_test_sent', actorStaffId: actor(req).id, entityType: 'settings', entityId: 'whatsapp', newValues: { to, template: name }, req })]);
      res.json({ sentTo: to, template: name, messageId });
    } catch (err) {
      throw metaError(err);
    }
  });

  router.put('/settings', owner, async (req, res) => {
    const values = parseBody(settingsBody, req.body);
    const before = await load();
    // Whoever controls these can send email in the academy's name, so changing them takes the password.
    const senderChanged = values.senderEmail !== before.senderEmail || Boolean(values.appPassword) || Boolean(values.removePassword);
    if (senderChanged) await confirmPassword(actor(req), req.body?.currentPassword, req);

    const { appPassword, removePassword, ...plain } = values;
    const change = { ...plain, ...(appPassword ? { appPasswordEncrypted: encrypt(appPassword) } : removePassword ? { appPasswordEncrypted: null } : {}), updatedAt: new Date() };
    const [[row]] = await db.batch([
      db.update(messageSettings).set(change).where(eq(messageSettings.id, 1)).returning(),
      auditEntry({ action: 'messages.settings_updated', actorStaffId: actor(req).id, entityType: 'settings', entityId: 'messages', oldValues: settingsView(before), newValues: settingsView({ ...before, ...change }), req }),
    ]);
    res.json({ settings: settingsView(row!) });
  });

  router.post('/settings/test', owner, async (req, res) => {
    const saved = await load();
    const to = saved.notifyEmail || saved.senderEmail || actor(req).email;
    try {
      await mailer.send({ to, subject: 'DK Badminton test email', text: 'This test email shows that your sender details in Settings work.' });
    } catch (err) {
      throw new AppError(502, 'EMAIL_FAILED', friendlyMailError(err));
    }
    res.json({ sentTo: to });
  });

  router.get('/', staff, async (req, res) => {
    const status = messageStatus.enumValues.find((s) => s === req.query.status);
    const channel = messageChannel.enumValues.find((c) => c === req.query.channel);
    const q = String(req.query.q ?? '').trim().slice(0, 100);
    const rows = await db
      .select()
      .from(messages)
      .where(and(status ? eq(messages.status, status) : undefined, channel ? eq(messages.channel, channel) : undefined, q ? sql`(${ilike(messages.recipient, likeTerm(q))} OR ${ilike(messages.subject, likeTerm(q))})` : undefined))
      .orderBy(desc(messages.createdAt))
      .limit(200);
    res.json({ messages: rows });
  });

  const find = async (req: Request) => {
    const id = String(req.params.id);
    if (!UUID.test(id)) throw notFound('That message');
    const [row] = await db.select().from(messages).where(eq(messages.id, id));
    if (!row) throw notFound('That message');
    return row;
  };

  router.post('/:id/retry', staff, async (req, res) => {
    const before = await find(req);
    if (before.status !== 'failed' && before.status !== 'queued') throw invalid('Only a waiting or failed message can be tried again.', 'NOT_RETRYABLE');
    // A fallback email already replaced this WhatsApp message: trying both would message the customer twice.
    if (before.channel === 'whatsapp' && (await db.select({ id: messages.id }).from(messages).where(eq(messages.fallbackOf, before.id))).length) {
      throw invalid('This message was already sent by email instead, so it isn’t tried again on WhatsApp.', 'NOT_RETRYABLE');
    }
    const [row] = await db.update(messages).set({ status: 'queued', attempts: 0, nextAttemptAt: new Date(), lastError: null }).where(eq(messages.id, before.id)).returning();
    res.json({ message: row });
  });

  router.post('/:id/cancel', staff, async (req, res) => {
    const before = await find(req);
    if (before.status !== 'queued') throw invalid('Only a waiting message can be cancelled.', 'NOT_CANCELLABLE');
    const [row] = await db.update(messages).set({ status: 'cancelled' }).where(eq(messages.id, before.id)).returning();
    res.json({ message: row });
  });

  return router;
}
