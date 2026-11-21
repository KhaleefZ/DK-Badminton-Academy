// The Cloudflare Worker: the Express app answers HTTP requests, and Cron Triggers (see wrangler.jsonc)
// send queued emails, ask the payment gateway about unconfirmed orders and back up the database.
import { httpServerHandler } from 'cloudflare:node';
import { env } from 'cloudflare:workers';
import { createApp } from './app.js';
import { useDatabase } from './db/client.js';
import { defaultMailer } from './lib/email.js';
import { bindingLimiter } from './lib/rateLimit.js';
import { processMessages } from './messages/queue.js';
import { sweepGatewayOrders } from './payments/settle.js';
import { usePhotos } from './storage.js';
import { BACKUP_CRON, backUpDatabase } from './backup.js';

useDatabase(env.DB);
usePhotos(env.PHOTOS);

const mailer = defaultMailer();
const app = createApp({
  mailer,
  limiters: { login: bindingLimiter(env.LOGIN_LIMIT), reset: bindingLimiter(env.RESET_LIMIT), publicWrite: bindingLimiter(env.PUBLIC_WRITE_LIMIT) },
});

/**
 * What one Cron Trigger run does. Cloudflare's free plan allows 50 database queries and about 10 ms of
 * CPU per run, so the every-minute job takes turns: payment checks on even minutes, emails on odd ones.
 */
export async function scheduledWork(cron: string, at: Date) {
  const report = (what: string) => (err: unknown) => console.error(`${what}:`, err instanceof Error ? err.message : err);
  if (cron === BACKUP_CRON) return backUpDatabase(env, at).catch(report('Backup'));
  if (at.getUTCMinutes() % 2 === 0) return sweepGatewayOrders(at).catch(report('Payment check'));
  return processMessages(mailer, at).catch(report('Message queue'));
}

const PORT = 8080;
app.listen(PORT);

export default {
  ...httpServerHandler({ port: PORT }),
  async scheduled(controller: { cron: string; scheduledTime: number }, _env: unknown, ctx: { waitUntil(work: Promise<unknown>): void }) {
    ctx.waitUntil(scheduledWork(controller.cron, new Date(controller.scheduledTime)));
  },
};
