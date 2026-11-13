import { Router } from 'express';
import type { Request } from 'express';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { confirmPassword } from '../auth/passwords.js';
import { config, isProduction } from '../config.js';
import { db } from '../db/client.js';
import { gatewayMode, paymentGateway, paymentSettings } from '../db/schema.js';
import { auditEntry } from '../lib/audit.js';
import { AppError, invalid } from '../lib/errors.js';
import { decrypt, encrypt } from '../lib/secret.js';
import { parseBody } from '../lib/validate.js';
import { currentAuth, requirePasswordCurrent, requirePermission, requireSession } from '../middleware/auth.js';
import { buildGateway, GatewayError, savedGatewayKeys, webhookUrl } from '../payments/gateway.js';

const body = z.object({
  enabled: z.boolean({ error: 'Choose whether online payments are on.' }),
  gateway: z.enum(paymentGateway.enumValues, { error: 'Choose Cashfree or Razorpay.' }).nullable(),
  mode: z.enum(gatewayMode.enumValues, { error: 'Choose Test or Live.' }),
  keyId: z.string().trim().max(200).nullish().transform((v) => v || null),
  // Blank keeps what's saved. Secrets are never sent back, so the form can't show them.
  keySecret: z.string().trim().max(500).nullish().transform((v) => v || null),
  webhookSecret: z.string().trim().max(500).nullish().transform((v) => v || null),
});

type Row = typeof paymentSettings.$inferSelect;

const view = (row: Row, req: Request) => ({
  enabled: row.enabled,
  gateway: row.gateway,
  mode: row.mode,
  keyId: row.keyId,
  hasKeySecret: Boolean(row.keySecretEncrypted),
  hasWebhookSecret: Boolean(row.webhookSecretEncrypted),
  // Pasted into the gateway's dashboard. Locally there's no public address, so a placeholder shows.
  webhookUrl: webhookUrl(req.get('host')) ?? 'https://<your API address>/webhooks/payments',
  simulator: config.PAYMENT_SIMULATOR === 'true' && !isProduction,
});

const auditable = (row: Partial<Row>) => ({ enabled: row.enabled, gateway: row.gateway, mode: row.mode, keyId: row.keyId });

/** Owner only. Whoever controls these keys controls where the academy's money goes. */
export function paymentSettingsRouter(): Router {
  const router = Router();
  router.use(requireSession, requirePasswordCurrent, requirePermission('settings.manage'));
  const load = async () => (await db.select().from(paymentSettings).where(eq(paymentSettings.id, 1)))[0]!;

  router.get('/', async (req, res) => {
    res.json({ settings: view(await load(), req) });
  });

  router.put('/', async (req, res) => {
    const actor = currentAuth(req).staff;
    await confirmPassword(actor, req.body?.currentPassword, req);
    const values = parseBody(body, req.body);
    const before = await load();

    // Switching gateway means new keys: the old ones belong to the other company.
    const sameGateway = values.gateway === before.gateway;
    const keySecretEncrypted = values.keySecret ? encrypt(values.keySecret) : sameGateway ? before.keySecretEncrypted : null;
    const webhookSecretEncrypted = values.webhookSecret ? encrypt(values.webhookSecret) : sameGateway ? before.webhookSecretEncrypted : null;

    if (values.enabled) {
      if (!values.gateway || !values.keyId || !keySecretEncrypted) throw invalid('Choose a gateway and enter its keys before switching online payments on.', 'KEYS_MISSING');
      if (values.gateway === 'razorpay' && !webhookSecretEncrypted) throw invalid('Enter the Razorpay webhook secret before switching online payments on.', 'KEYS_MISSING');
      // Nothing is switched on with keys that don't work.
      const gateway = buildGateway({
        gateway: values.gateway,
        live: values.mode === 'live',
        keyId: values.keyId,
        keySecret: decrypt(keySecretEncrypted),
        webhookSecret: webhookSecretEncrypted ? decrypt(webhookSecretEncrypted) : null,
      });
      try {
        await gateway.checkCredentials();
      } catch (err) {
        if (err instanceof GatewayError) throw invalid(err.message, 'KEYS_REFUSED');
        throw err;
      }
    }

    const change = { enabled: values.enabled, gateway: values.gateway, mode: values.mode, keyId: values.keyId, keySecretEncrypted, webhookSecretEncrypted, updatedByStaffId: actor.id, updatedAt: new Date() };
    const [[row]] = await db.batch([
      db.update(paymentSettings).set(change).where(eq(paymentSettings.id, 1)).returning(),
      auditEntry({ action: 'payments.settings_updated', actorStaffId: actor.id, entityType: 'settings', entityId: 'payments', oldValues: auditable(before), newValues: auditable(change), req }),
    ]);
    res.json({ settings: view(row!, req) });
  });

  /** Tries the saved keys without creating anything. */
  router.post('/check', async (_req, res) => {
    const keys = await savedGatewayKeys();
    if (!keys) throw invalid('Save a gateway and its keys first.', 'KEYS_MISSING');
    try {
      await buildGateway(keys).checkCredentials();
    } catch (err) {
      if (err instanceof GatewayError) throw new AppError(400, 'KEYS_REFUSED', err.message);
      throw err;
    }
    res.json({ ok: true });
  });

  return router;
}
