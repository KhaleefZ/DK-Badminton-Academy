import { sql } from 'drizzle-orm';
import { beforeAll, beforeEach } from 'vitest';
import { db } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';

beforeAll(async () => {
  await runMigrations();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE staff, admin_sessions, password_reset_tokens, audit_log RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE courts, opening_hours, price_rules, closures, court_reservations, customers, bookings, payments, enquiries, messages, membership_plans, member_batches, memberships, membership_courts, membership_players, membership_periods, referral_codes, referral_redemptions, member_credits CASCADE`);
  await db.execute(sql`INSERT INTO courts (name, sort_order) VALUES ('Court 1', 1), ('Court 2', 2)`);
  await db.execute(sql`UPDATE message_settings SET email_enabled = true, sender_name = NULL, sender_email = NULL, app_password_encrypted = NULL, notify_email = NULL, daily_email_limit = 100, whatsapp_number = NULL`);
  await db.execute(sql`UPDATE referral_program SET enabled = false, discount_type = 'percent', discount_value = 10, reward_paise = 0`);
  await db.execute(sql`TRUNCATE site_images`);
  // Emptying staff above also empties this table, because it points at who last saved.
  await db.execute(sql`INSERT INTO site_content (id) VALUES (1) ON CONFLICT (id) DO UPDATE SET content = '{}', version = 1, updated_by_staff_id = NULL`);
  await db.execute(sql`UPDATE settings SET slot_minutes = 60, advance_booking_days = 7, min_notice_minutes = 60, hold_minutes = 10`);
});
