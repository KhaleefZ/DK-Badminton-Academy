import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/d1/migrator';
import type { Db } from './client.js';

// Production applies these with `wrangler d1 migrations apply dk-badminton --remote`.
// Tests and local scripts use this, against a local D1.
export const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

export const runMigrations = (database: Db) => migrate(database, { migrationsFolder });

/** One `CREATE TRIGGER` statement from the rules migration, by name. */
export function triggerSql(name: string): string {
  const statements = readFileSync(`${migrationsFolder}/0001_rules.sql`, 'utf8').split('--> statement-breakpoint');
  const found = statements.find((s) => s.includes(`CREATE TRIGGER ${name} `));
  if (!found) throw new Error(`No trigger called ${name}`);
  return found.replace(/^\s*--.*$/gm, '').trim();
}
