import { defineConfig } from 'drizzle-kit';

// Generates SQLite migrations for D1. Apply them with `wrangler d1 migrations apply`.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
