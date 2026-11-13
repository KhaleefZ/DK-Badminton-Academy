import { Router } from 'express';
import type { Request } from 'express';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { confirmPassword } from '../auth/passwords.js';
import { db } from '../db/client.js';
import { messageSettings, messages, messageStatus } from '../db/schema.js';
import { auditEntry } from '../lib/audit.js';
import type { Mailer } from '../lib/email.js';
import { invalid, notFound, AppError } from '../lib/errors.js';
import { likeTerm, ilike } from '../lib/search.js';
import { encrypt } from '../lib/secret.js';
import { parseBody, UUID } from '../lib/validate.js';
import { friendlyMailError } from '../messages/queue.js';
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

const settingsView = (s: typeof messageSettings.$inferSelect) => ({
  emailEnabled: s.emailEnabled,
  senderName: s.senderName,
  senderEmail: s.senderEmail,
  hasAppPassword: Boolean(s.appPasswordEncrypted),
  notifyEmail: s.notifyEmail,
  dailyEmailLimit: s.dailyEmailLimit,
  whatsappNumber: s.whatsappNumber,
});

export function messagesRouter({ mailer }: { mailer: Mailer }): Router {
  const router = Router();
  router.use(requireSession, requirePasswordCurrent);
  const owner = requirePermission('settings.manage');
  const staff = requirePermission('messages.manage');
  const actor = (req: Request) => currentAuth(req).staff;
  const load = async () => (await db.select().from(messageSettings).where(eq(messageSettings.id, 1)))[0]!;

  router.get('/settings', owner, async (_req, res) => {
    res.json({ settings: settingsView(await load()) });
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
    const q = String(req.query.q ?? '').trim().slice(0, 100);
    const rows = await db
      .select()
      .from(messages)
      .where(and(status ? eq(messages.status, status) : undefined, q ? sql`(${ilike(messages.recipient, likeTerm(q))} OR ${ilike(messages.subject, likeTerm(q))})` : undefined))
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
    if (before.channel !== 'email') throw invalid('Only an email can be tried again.', 'NOT_RETRYABLE');
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
