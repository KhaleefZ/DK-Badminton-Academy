import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './client.js';

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

export const runMigrations = () => migrate(db, { migrationsFolder });

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runMigrations();
  await pool.end();
  console.log('Migrations applied.');
}
