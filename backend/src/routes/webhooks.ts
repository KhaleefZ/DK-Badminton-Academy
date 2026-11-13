import { Router } from 'express';
import { buildGateway, savedGatewayKeys } from '../payments/gateway.js';
import { settlePaidOrder } from '../payments/settle.js';

/**
 * Called by the payment gateway, not by a browser, so it sits outside the origin and session checks.
 * Trust comes only from the signature, checked against the raw body exactly as it arrived. It works
 * even while online payments are switched off, so payments already under way still settle.
 */
export function webhooksRouter(): Router {
  const router = Router();

  router.post('/payments', async (req, res) => {
    const keys = await savedGatewayKeys();
    if (!keys) return void res.status(404).json({ error: { code: 'NO_GATEWAY', message: 'No payment gateway is set up.' } });
    const gateway = buildGateway(keys);
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    let event;
    try {
      event = gateway.verifyWebhook((name) => req.get(name), raw);
    } catch {
      event = null;
    }
    if (!event) return void res.status(401).json({ error: { code: 'BAD_SIGNATURE', message: 'Signature check failed.' } });
    if (event.kind === 'paid') await settlePaidOrder(gateway, event);
    // Anything else (a failed attempt, a refund notice) needs nothing: the hold simply runs out.
    res.json({ received: true });
  });

  return router;
}
