import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db/client.js';
import { defaultMailer } from './lib/email.js';
import { startMessageWorker } from './messages/queue.js';

const mailer = defaultMailer();
const queueTimer = startMessageWorker(mailer);

const server = createApp({ mailer }).listen(config.PORT, () => {
  console.log(`DK Badminton API listening on port ${config.PORT}`);
});

function shutdown() {
  clearInterval(queueTimer);
  server.close(() => {
    void pool.end().finally(() => process.exit(0));
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
