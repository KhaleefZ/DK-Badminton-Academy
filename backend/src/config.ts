import 'dotenv/config';
import { z } from 'zod';

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    ADMIN_ORIGIN: z.string().url(),
    WEBSITE_ORIGIN: z.string().url().default('http://localhost:5173'),
    // Confirms website bookings with no real money. Refused in production below.
    PAYMENT_TEST_MODE: z.enum(['true', 'false']).default('true'),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
    // Signs customers' private links and encrypts the saved Gmail app password.
    APP_SECRET: z.string().min(32, 'APP_SECRET must be at least 32 characters').default('development-only-secret-do-not-use-in-production'),
  })
  .refine((env) => env.NODE_ENV !== 'production' || !env.APP_SECRET.startsWith('development-only'), {
    message: 'APP_SECRET must be set to a long random value in production',
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.PAYMENT_TEST_MODE === 'false', {
    message: 'PAYMENT_TEST_MODE must be false in production, or anyone could book a court for free',
  });

export const config = schema.parse(process.env);
export const isProduction = config.NODE_ENV === 'production';
export const paymentTestMode = config.PAYMENT_TEST_MODE === 'true';
