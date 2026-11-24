import type { D1Database } from '@cloudflare/workers-types';
import type { BatchItem } from 'drizzle-orm/batch';
import { sql } from 'drizzle-orm';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from './schema.js';

export type Db = DrizzleD1Database<typeof schema>;

let current: Db | undefined;

/** Points the app at a D1 database: the Worker's binding in production, a local one in tests and scripts. */
export function useDatabase(binding: D1Database): Db {
  current = drizzle(binding, { schema });
  return current;
}

/**
 * The database for this process. D1 has no open transactions: statements that must succeed or
 * fail together go through `db.batch([...])`, and rules that must never be raced live in triggers.
 */
export const db = new Proxy({} as Db, {
  get(_target, key) {
    if (!current) throw new Error('No database: call useDatabase() first.');
    const value = Reflect.get(current, key, current);
    return typeof value === 'function' ? value.bind(current) : value;
  },
});

/** Codes for the errors the app turns into friendly messages. DKnnn come from triggers in drizzle/0001_rules.sql. */
export const DB_ERRORS = {
  staffLimit: 'DK001',
  lastOwner: 'DK002',
  exclusionViolation: 'DK003',
  batchFull: 'DK004',
  overpayment: 'DK006',
  uniqueViolation: 'UNIQUE',
  foreignKeyViolation: 'FOREIGN_KEY',
} as const;

/** D1 reports errors as text, and Drizzle may wrap them, so every message in the chain is checked. */
export function dbErrorCode(err: unknown): string | undefined {
  for (let e = err as { message?: unknown; cause?: unknown } | undefined, depth = 0; e && depth < 5; e = e.cause as typeof e, depth++) {
    const message = typeof e.message === 'string' ? e.message : '';
    const trigger = /\bDK\d{3}\b/.exec(message);
    if (trigger) return trigger[0];
    if (message.includes('UNIQUE constraint failed')) return DB_ERRORS.uniqueViolation;
    if (message.includes('FOREIGN KEY constraint failed')) return DB_ERRORS.foreignKeyViolation;
  }
  return undefined;
}

export type Statement = BatchItem<'sqlite'>;

/** Runs a list of statements as one atomic batch. For lists built up in code, which `db.batch` can't type. */
export const runBatch = (statements: Statement[]) => db.batch(statements as [Statement, ...Statement[]]);

/** For a statement in a batch that should only take effect if the statement before it changed a row. */
export const previousChanged = sql`changes() > 0`;

/**
 * Collects the writes of one change so they save together. Checks read the database as it is now;
 * writes wait here and run as a single atomic batch on `commit()`. Steps that need the saved result,
 * such as queueing an email, are added with `after()` and run once the batch has saved.
 */
export class Work {
  private readonly steps: Statement[] = [];
  private readonly followUps: (() => Promise<unknown>)[] = [];

  add(...statements: Statement[]): this {
    this.steps.push(...statements);
    return this;
  }

  after(step: () => Promise<unknown>): this {
    this.followUps.push(step);
    return this;
  }

  /** Saves everything, then runs the follow-ups in order. Returns each statement's result. */
  async commit(): Promise<unknown[]> {
    const results = this.steps.length ? await db.batch(this.steps as [Statement, ...Statement[]]) : [];
    for (const step of this.followUps) await step();
    return results as unknown[];
  }
}
