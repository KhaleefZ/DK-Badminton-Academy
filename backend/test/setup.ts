import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { getPlatformProxy } from 'wrangler';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { useDatabase } from '../src/db/client.js';
import { runMigrations, triggerSql } from '../src/db/migrate.js';
import { usePhotos } from '../src/storage.js';

// Each test file gets its own in-memory D1, run by the same engine as production.
const proxy = await getPlatformProxy<{ DB: D1Database; PHOTOS: R2Bucket }>({ configPath: 'wrangler.jsonc', persist: false });
const db = useDatabase(proxy.env.DB);
usePhotos(proxy.env.PHOTOS);

beforeAll(async () => {
  await runMigrations(db);
});

afterAll(async () => {
  await proxy.dispose();
});

// Children before parents, so no foreign key stops a delete.
const TABLES = [
  'payment_issues', 'messages', 'payments', 'referral_redemptions', 'member_credits', 'referral_codes', 'membership_periods', 'membership_players',
  'membership_courts', 'bookings', 'court_reservations', 'memberships', 'member_batches', 'membership_plans', 'customers', 'enquiries',
  'closures', 'price_rules', 'opening_hours', 'courts', 'site_images', 'audit_log', 'admin_sessions', 'password_reset_tokens',
];

beforeEach(async () => {
  const run = (statement: string, ...params: unknown[]) => proxy.env.DB.prepare(statement).bind(...params);
  // The last Owner can't normally be deleted, so that rule is lifted while the tables are emptied.
  await proxy.env.DB.batch([
    ...TABLES.map((t) => run(`DELETE FROM ${t}`)),
    run('DROP TRIGGER staff_last_owner_delete'),
    run('DELETE FROM staff'),
    run(triggerSql('staff_last_owner_delete')),
    run(`INSERT INTO courts (id, name, sort_order) VALUES (?, 'Court 1', 1), (?, 'Court 2', 2)`, crypto.randomUUID(), crypto.randomUUID()),
    run(`UPDATE message_settings SET email_enabled = 1, sender_name = NULL, sender_email = NULL, app_password_encrypted = NULL, notify_email = NULL, daily_email_limit = 100, whatsapp_number = NULL`),
    run(`UPDATE referral_program SET enabled = 0, discount_type = 'percent', discount_value = 10, reward_paise = 0`),
    run(`UPDATE site_content SET content = '{}', version = 1, updated_by_staff_id = NULL`),
    run(`UPDATE settings SET slot_minutes = 60, advance_booking_days = 7, min_notice_minutes = 60, hold_minutes = 10`),
    run(`UPDATE payment_settings SET enabled = 0, gateway = NULL, mode = 'test', key_id = NULL, key_secret_encrypted = NULL, webhook_secret_encrypted = NULL, updated_by_staff_id = NULL`),
  ]);
});
