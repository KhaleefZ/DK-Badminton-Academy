// The Cloudflare Worker: the Express app answers HTTP requests, and a Cron Trigger (every minute,
// see wrangler.jsonc) sends queued emails and asks the payment gateway about unconfirmed orders.
import { httpServerHandler } from 'cloudflare:node';
import { env } from 'cloudflare:workers';
import { createApp } from './app.js';
import { useDatabase } from './db/client.js';
import { defaultMailer } from './lib/email.js';
import { bindingLimiter } from './lib/rateLimit.js';
import { processMessages } from './messages/queue.js';
import { sweepGatewayOrders } from './payments/settle.js';
import { usePhotos } from './storage.js';

useDatabase(env.DB);
usePhotos(env.PHOTOS);

const mailer = defaultMailer();
const app = createApp({
  mailer,
  limiters: { login: bindingLimiter(env.LOGIN_LIMIT), reset: bindingLimiter(env.RESET_LIMIT), publicWrite: bindingLimiter(env.PUBLIC_WRITE_LIMIT) },
});

const PORT = 8080;
app.listen(PORT);

export default {
  ...httpServerHandler({ port: PORT }),
  async scheduled(_controller: unknown, _env: unknown, ctx: { waitUntil(work: Promise<unknown>): void }) {
    const report = (what: string) => (err: unknown) => console.error(`${what}:`, err instanceof Error ? err.message : err);
    ctx.waitUntil(Promise.all([processMessages(mailer).catch(report('Message queue')), sweepGatewayOrders().catch(report('Payment check'))]));
  },
};
