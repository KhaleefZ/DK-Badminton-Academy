import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { config } from './config.js';
import { DB_ERRORS, dbErrorCode } from './db/client.js';
import { defaultMailer, type Mailer } from './lib/email.js';
import { AppError } from './lib/errors.js';
import { requireTrustedOrigin } from './middleware/origin.js';
import { authRouter } from './routes/auth.js';
import { availabilityRouter } from './routes/availability.js';
import { blocksRouter } from './routes/blocks.js';
import { bookingsRouter } from './routes/bookings.js';
import { customersRouter } from './routes/customers.js';
import { enquiriesRouter } from './routes/enquiries.js';
import { membershipsRouter } from './routes/memberships.js';
import { messagesRouter } from './routes/messages.js';
import { paymentsRouter } from './routes/payments.js';
import { publicRouter } from './routes/public.js';
import { referralsRouter } from './routes/referrals.js';
import { reportsRouter } from './routes/reports.js';
import { scheduleRouter } from './routes/schedule.js';
import { searchRouter } from './routes/search.js';
import { settingsRouter } from './routes/settings.js';
import { siteContentRouter } from './routes/siteContent.js';
import { staffRouter } from './routes/staff.js';

type AppOptions = {
  /** Login attempts allowed from one network in the window. */
  loginLimitPerWindow?: number;
  /** Password reset requests allowed from one network in the window. */
  resetLimitPerWindow?: number;
  /** Website bookings and enquiries allowed from one network in the window. */
  publicWriteLimitPerWindow?: number;
  mailer?: Mailer;
};

const LIMIT_WINDOW_MS = 5 * 60 * 1000;

const DB_ERROR_RESPONSES: Record<string, { code: string; message: string }> = {
  [DB_ERRORS.staffLimit]: { code: 'STAFF_LIMIT', message: 'Only 5 active admin accounts are allowed. Deactivate one first.' },
  [DB_ERRORS.lastOwner]: { code: 'LAST_OWNER', message: 'There must always be one active Owner. Make someone else an Owner first.' },
  [DB_ERRORS.uniqueViolation]: { code: 'DUPLICATE', message: 'That email is already used by another staff account.' },
  [DB_ERRORS.exclusionViolation]: { code: 'SLOT_TAKEN', message: 'That court is already reserved for some of this time.' },
};

const tooManyRequests = (message: string) => ({ error: { code: 'TOO_MANY_REQUESTS', message } });

export function createApp({ loginLimitPerWindow = 50, resetLimitPerWindow = 10, publicWriteLimitPerWindow = 20, mailer = defaultMailer() }: AppOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY_HOPS);

  app.use(helmet());
  // The website's text is saved in one go, so it gets more room than any other request.
  app.use('/site-content', express.json({ limit: '1mb' }));
  app.use(express.json({ limit: '32kb' }));

  // Private data must not stay in the browser's cache, or the Back button could show it after sign-out.
  app.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  // The website has no login, so its routes sit apart: they never read a session cookie,
  // and the website's origin can't reach anything below this line.
  const publicWriteLimiter = rateLimit({
    windowMs: LIMIT_WINDOW_MS,
    limit: publicWriteLimitPerWindow,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: tooManyRequests('Too many requests from this network. Try again in a few minutes, or contact the academy.'),
  });
  app.use('/public', cors({ origin: config.WEBSITE_ORIGIN }), requireTrustedOrigin(config.WEBSITE_ORIGIN), publicRouter({ writeLimiter: publicWriteLimiter }));

  app.use(cors({ origin: config.ADMIN_ORIGIN, credentials: true }));
  app.use(cookieParser());
  app.use(requireTrustedOrigin(config.ADMIN_ORIGIN));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  const loginLimiter = rateLimit({
    windowMs: LIMIT_WINDOW_MS,
    limit: loginLimitPerWindow,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: tooManyRequests('Too many attempts from this network. Try again in a few minutes.'),
  });
  const resetLimiter = rateLimit({
    windowMs: LIMIT_WINDOW_MS,
    limit: resetLimitPerWindow,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: tooManyRequests('Too many password reset requests from this network. Try again in a few minutes.'),
  });
  app.use('/auth', authRouter({ loginLimiter, resetLimiter, mailer }));
  app.use('/staff', staffRouter());
  app.use('/settings', settingsRouter());
  app.use('/availability', availabilityRouter());
  app.use('/customers', customersRouter());
  app.use('/bookings', bookingsRouter());
  app.use('/payments', paymentsRouter());
  app.use('/blocks', blocksRouter());
  app.use('/schedule', scheduleRouter());
  app.use('/search', searchRouter());
  app.use('/enquiries', enquiriesRouter());
  app.use('/memberships', membershipsRouter());
  app.use('/referrals', referralsRouter());
  app.use('/messages', messagesRouter({ mailer }));
  app.use('/reports', reportsRouter());
  app.use('/site-content', siteContentRouter());

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express identifies error handlers by their four arguments.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    const dbResponse = DB_ERROR_RESPONSES[dbErrorCode(err) ?? ''];
    if (dbResponse) {
      res.status(409).json({ error: dbResponse });
      return;
    }
    const status = (err as { status?: unknown }).status;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      res.status(status).json({ error: { code: 'BAD_REQUEST', message: 'The request could not be read.' } });
      return;
    }
    console.error(err instanceof Error ? err.stack : err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' } });
  });

  return app;
}
