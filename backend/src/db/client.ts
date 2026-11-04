import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { config } from '../config.js';
import * as schema from './schema.js';

export const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 10 });
export const db = drizzle(pool, { schema });

export type Db = typeof db;
/** Either the shared connection or an open transaction. */
export type DbOrTx = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

/** Custom error codes raised by the database triggers. */
export const DB_ERRORS = {
  staffLimit: 'DK001',
  lastOwner: 'DK002',
  uniqueViolation: '23505',
  foreignKeyViolation: '23503',
  exclusionViolation: '23P01',
} as const;

/** Drizzle wraps driver errors, so the Postgres code may sit on `cause`. */
export function dbErrorCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = e?.code ?? e?.cause?.code;
  return typeof code === 'string' ? code : undefined;
}
