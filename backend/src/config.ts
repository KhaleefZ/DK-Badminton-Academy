import { z } from 'zod';

// On Cloudflare these come from wrangler.jsonc "vars" and `wrangler secret put`; locally from .dev.vars.
const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    ADMIN_ORIGIN: z.string().url(),
    WEBSITE_ORIGIN: z.string().url().default('http://localhost:5173'),
    // Local development only: a button on the website stands in for paying, and no money moves.
    // Real online payments are switched on by the Owner in Settings. Refused in production below.
    PAYMENT_SIMULATOR: z.enum(['true', 'false']).default('false'),
    // Signs customers' private links and encrypts the saved Gmail app password.
    APP_SECRET: z.string().min(32, 'APP_SECRET must be at least 32 characters').default('development-only-secret-do-not-use-in-production'),
  })
  .refine((env) => env.NODE_ENV !== 'production' || !env.APP_SECRET.startsWith('development-only'), {
    message: 'APP_SECRET must be set to a long random value in production',
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.PAYMENT_SIMULATOR === 'false', {
    message: 'PAYMENT_SIMULATOR must be false in production, or anyone could book a court for free',
  });

export const config = schema.parse(process.env);
export const isProduction = config.NODE_ENV === 'production';
