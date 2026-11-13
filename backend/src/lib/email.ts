import { eq } from 'drizzle-orm';
import { isProduction } from '../config.js';
import { db } from '../db/client.js';
import { messageSettings } from '../db/schema.js';
import { decrypt } from './secret.js';

export type Email = { to: string; subject: string; text: string };
export type Mailer = {
  send(email: Email): Promise<void>;
  /** False while no sender is saved and nothing could go out. A mailer without this is always ready. */
  ready?(): Promise<boolean>;
};

const DEFAULT_SENDER_NAME = 'DK Badminton Academy';

const savedSender = async () => {
  const [row] = await db.select().from(messageSettings).where(eq(messageSettings.id, 1));
  return row?.senderEmail && row.appPasswordEncrypted ? row : null;
};

/** Sends as whoever the Owner saved in the admin panel, read fresh so a change applies at once. */
export function defaultMailer(): Mailer {
  return {
    async ready() {
      return !isProduction || Boolean(await savedSender());
    },
    async send({ to, subject, text }) {
      const sender = await savedSender();
      if (!sender) {
        if (isProduction) throw new Error('No sender email has been saved in Settings.');
        console.log(`\n--- Email not sent (no sender saved in Settings) ---\nTo: ${to}\nSubject: ${subject}\n\n${text}\n---\n`);
        return;
      }
      // Loaded only here: it opens a raw connection through `cloudflare:sockets`, which exists only on Cloudflare.
      const { WorkerMailer } = await import('worker-mailer');
      await WorkerMailer.send(
        { host: 'smtp.gmail.com', port: 465, secure: true, authType: ['plain', 'login'], credentials: { username: sender.senderEmail!, password: decrypt(sender.appPasswordEncrypted!) } },
        { from: { name: sender.senderName || DEFAULT_SENDER_NAME, email: sender.senderEmail! }, to, subject, text },
      );
    },
  };
}
