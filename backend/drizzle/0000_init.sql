CREATE TABLE `admin_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`staff_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`remember` integer DEFAULT false NOT NULL,
	`ip` text,
	`user_agent` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`last_seen_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_sessions_token_hash_unique` ON `admin_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `admin_sessions_staff_idx` ON `admin_sessions` (`staff_id`);--> statement-breakpoint
CREATE INDEX `admin_sessions_expires_idx` ON `admin_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_staff_id` text,
	`action` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`old_values` text,
	`new_values` text,
	`ip` text,
	`user_agent` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`actor_staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_log_entity_idx` ON `audit_log` (`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_log_actor_idx` ON `audit_log` (`actor_staff_id`);--> statement-breakpoint
CREATE TABLE `bookings` (
	`id` text PRIMARY KEY NOT NULL,
	`booking_no` text NOT NULL,
	`customer_id` text NOT NULL,
	`reservation_id` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`source` text DEFAULT 'admin' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`notes` text,
	`cancel_reason` text,
	`access_token_hash` text,
	`hold_expires_at` integer,
	`cancelled_at` integer,
	`gateway_order_id` text,
	`gateway_order_at` integer,
	`gateway_checked_at` integer,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reservation_id`) REFERENCES `court_reservations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "bookings_amount" CHECK("bookings"."amount_paise" >= 0),
	CONSTRAINT "bookings_source_valid" CHECK("source" IN ('admin', 'website')),
	CONSTRAINT "bookings_status_valid" CHECK("status" IN ('active', 'cancelled', 'pending_payment', 'expired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bookings_booking_no_unique` ON `bookings` (`booking_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `bookings_reservation_id_unique` ON `bookings` (`reservation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `bookings_access_token_hash_unique` ON `bookings` (`access_token_hash`);--> statement-breakpoint
CREATE INDEX `bookings_customer_idx` ON `bookings` (`customer_id`);--> statement-breakpoint
CREATE INDEX `bookings_gateway_order_idx` ON `bookings` (`gateway_order_id`);--> statement-breakpoint
CREATE TABLE `closures` (
	`id` text PRIMARY KEY NOT NULL,
	`court_id` text,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`reason` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`court_id`) REFERENCES `courts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "closures_period" CHECK("closures"."starts_at" < "closures"."ends_at")
);
--> statement-breakpoint
CREATE INDEX `closures_period_idx` ON `closures` (`starts_at`,`ends_at`);--> statement-breakpoint
CREATE TABLE `counters` (
	`prefix` text PRIMARY KEY NOT NULL,
	`value` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `court_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`court_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`note` text,
	`batch_id` text,
	`membership_id` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`court_id`) REFERENCES `courts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`batch_id`) REFERENCES `member_batches`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "court_reservations_period" CHECK("court_reservations"."starts_at" < "court_reservations"."ends_at"),
	CONSTRAINT "court_reservations_kind_valid" CHECK("kind" IN ('booking', 'member_block', 'staff_block')),
	CONSTRAINT "court_reservations_status_valid" CHECK("status" IN ('active', 'released'))
);
--> statement-breakpoint
CREATE INDEX `court_reservations_batch_idx` ON `court_reservations` (`batch_id`);--> statement-breakpoint
CREATE INDEX `court_reservations_membership_idx` ON `court_reservations` (`membership_id`);--> statement-breakpoint
CREATE INDEX `court_reservations_period_idx` ON `court_reservations` (`starts_at`,`ends_at`);--> statement-breakpoint
CREATE INDEX `court_reservations_court_idx` ON `court_reservations` (`court_id`,`status`,`starts_at`);--> statement-breakpoint
CREATE TABLE `courts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `courts_name_unique` ON `courts` (lower("name"));--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_no` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`phone_digits` text GENERATED ALWAYS AS (replace(replace(replace(replace(replace(replace(replace(replace(replace("phone", char(32), ''), char(45), ''), char(43), ''), char(9), ''), char(10), ''), char(11), ''), char(12), ''), char(13), ''), char(160), '')) VIRTUAL,
	`email` text,
	`notes` text,
	`deleted_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT "customers_type_valid" CHECK("type" IN ('walk_in', 'website'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customers_customer_no_unique` ON `customers` (`customer_no`);--> statement-breakpoint
CREATE INDEX `customers_type_idx` ON `customers` (`type`);--> statement-breakpoint
CREATE INDEX `customers_phone_idx` ON `customers` (`phone`);--> statement-breakpoint
CREATE INDEX `customers_phone_digits_idx` ON `customers` (`phone_digits`);--> statement-breakpoint
CREATE TABLE `enquiries` (
	`id` text PRIMARY KEY NOT NULL,
	`enquiry_no` text NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`phone` text,
	`topic` text,
	`preferred` text,
	`message` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT "enquiries_status_valid" CHECK("status" IN ('new', 'handled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `enquiries_enquiry_no_unique` ON `enquiries` (`enquiry_no`);--> statement-breakpoint
CREATE INDEX `enquiries_status_idx` ON `enquiries` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `member_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`plan_id` text NOT NULL,
	`court_id` text NOT NULL,
	`days` text NOT NULL,
	`start_minute` integer NOT NULL,
	`end_minute` integer NOT NULL,
	`capacity` integer NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `membership_plans`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`court_id`) REFERENCES `courts`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "member_batches_capacity" CHECK("member_batches"."capacity" >= 1),
	CONSTRAINT "member_batches_dates" CHECK("member_batches"."starts_on" <= "member_batches"."ends_on")
);
--> statement-breakpoint
CREATE TABLE `member_credits` (
	`id` text PRIMARY KEY NOT NULL,
	`membership_id` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`reason` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `member_credits_membership_idx` ON `member_credits` (`membership_id`);--> statement-breakpoint
CREATE TABLE `membership_courts` (
	`membership_id` text NOT NULL,
	`court_id` text NOT NULL,
	PRIMARY KEY(`membership_id`, `court_id`),
	FOREIGN KEY (`membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`court_id`) REFERENCES `courts`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `membership_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`membership_id` text NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`discount_paise` integer DEFAULT 0 NOT NULL,
	`credit_paise` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "membership_periods_amount" CHECK("membership_periods"."amount_paise" >= 0)
);
--> statement-breakpoint
CREATE INDEX `membership_periods_membership_idx` ON `membership_periods` (`membership_id`);--> statement-breakpoint
CREATE TABLE `membership_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`description` text,
	`features` text NOT NULL,
	`price_paise` integer NOT NULL,
	`players_per_court` integer DEFAULT 10 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT "membership_plans_price" CHECK("membership_plans"."price_paise" >= 0),
	CONSTRAINT "membership_plans_players" CHECK("membership_plans"."players_per_court" BETWEEN 1 AND 10),
	CONSTRAINT "membership_plans_kind_valid" CHECK("kind" IN ('individual', 'court'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `membership_plans_name_unique` ON `membership_plans` (lower("name"));--> statement-breakpoint
CREATE TABLE `membership_players` (
	`id` text PRIMARY KEY NOT NULL,
	`membership_id` text NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `membership_players_membership_idx` ON `membership_players` (`membership_id`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`membership_no` text NOT NULL,
	`kind` text NOT NULL,
	`plan_id` text NOT NULL,
	`batch_id` text,
	`days` text,
	`start_minute` integer,
	`end_minute` integer,
	`holder_name` text NOT NULL,
	`phone` text NOT NULL,
	`phone_digits` text GENERATED ALWAYS AS (replace(replace(replace(replace(replace(replace(replace(replace(replace("phone", char(32), ''), char(45), ''), char(43), ''), char(9), ''), char(10), ''), char(11), ''), char(12), ''), char(13), ''), char(160), '')) VIRTUAL,
	`email` text,
	`notes` text,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`price_paise` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`source` text DEFAULT 'admin' NOT NULL,
	`cancel_reason` text,
	`cancelled_at` integer,
	`access_token_hash` text,
	`hold_expires_at` integer,
	`gateway_order_id` text,
	`gateway_order_at` integer,
	`gateway_checked_at` integer,
	`deleted_at` integer,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `membership_plans`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`batch_id`) REFERENCES `member_batches`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "memberships_price" CHECK("memberships"."price_paise" >= 0),
	CONSTRAINT "memberships_kind_valid" CHECK("kind" IN ('individual', 'court')),
	CONSTRAINT "memberships_status_valid" CHECK("status" IN ('active', 'cancelled', 'pending_payment', 'expired')),
	CONSTRAINT "memberships_source_valid" CHECK("source" IN ('admin', 'website'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memberships_membership_no_unique` ON `memberships` (`membership_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `memberships_access_token_hash_unique` ON `memberships` (`access_token_hash`);--> statement-breakpoint
CREATE INDEX `memberships_batch_idx` ON `memberships` (`batch_id`);--> statement-breakpoint
CREATE INDEX `memberships_ends_idx` ON `memberships` (`ends_on`);--> statement-breakpoint
CREATE INDEX `memberships_phone_digits_idx` ON `memberships` (`phone_digits`);--> statement-breakpoint
CREATE INDEX `memberships_gateway_order_idx` ON `memberships` (`gateway_order_id`);--> statement-breakpoint
CREATE TABLE `message_settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`email_enabled` integer DEFAULT true NOT NULL,
	`sender_name` text,
	`sender_email` text,
	`app_password_encrypted` text,
	`notify_email` text,
	`daily_email_limit` integer DEFAULT 100 NOT NULL,
	`whatsapp_number` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT "message_settings_single_row" CHECK("message_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`channel` text DEFAULT 'email' NOT NULL,
	`template` text NOT NULL,
	`recipient` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`expires_at` integer,
	`last_error` text,
	`booking_id` text,
	`enquiry_id` text,
	`membership_id` text,
	`sent_at` integer,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`enquiry_id`) REFERENCES `enquiries`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "messages_channel_valid" CHECK("channel" IN ('email', 'whatsapp')),
	CONSTRAINT "messages_status_valid" CHECK("status" IN ('queued', 'sending', 'sent', 'failed', 'expired', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX `messages_queue_idx` ON `messages` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `messages_booking_idx` ON `messages` (`booking_id`);--> statement-breakpoint
CREATE INDEX `messages_created_idx` ON `messages` (`created_at`);--> statement-breakpoint
CREATE TABLE `opening_hours` (
	`id` text PRIMARY KEY NOT NULL,
	`weekday` integer NOT NULL,
	`open_minute` integer NOT NULL,
	`close_minute` integer NOT NULL,
	CONSTRAINT "opening_hours_weekday" CHECK("opening_hours"."weekday" BETWEEN 0 AND 6),
	CONSTRAINT "opening_hours_times" CHECK("opening_hours"."open_minute" >= 0 AND "opening_hours"."close_minute" <= 1440 AND "opening_hours"."open_minute" < "opening_hours"."close_minute")
);
--> statement-breakpoint
CREATE INDEX `opening_hours_weekday_idx` ON `opening_hours` (`weekday`);--> statement-breakpoint
CREATE TABLE `password_reset_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`staff_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `password_reset_tokens_token_hash_unique` ON `password_reset_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `password_reset_tokens_staff_idx` ON `password_reset_tokens` (`staff_id`);--> statement-breakpoint
CREATE TABLE `payment_issues` (
	`id` text PRIMARY KEY NOT NULL,
	`booking_id` text,
	`membership_id` text,
	`payment_id` text,
	`amount_paise` integer,
	`message` text NOT NULL,
	`resolved_at` integer,
	`resolved_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`resolved_by`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `payment_issues_open_idx` ON `payment_issues` (`resolved_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `payment_settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`gateway` text,
	`mode` text DEFAULT 'test' NOT NULL,
	`key_id` text,
	`key_secret_encrypted` text,
	`webhook_secret_encrypted` text,
	`updated_by_staff_id` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`updated_by_staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "payment_settings_single_row" CHECK("payment_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`receipt_no` text NOT NULL,
	`booking_id` text,
	`period_id` text,
	`amount_paise` integer NOT NULL,
	`method` text NOT NULL,
	`reference` text,
	`received_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`recorded_by` text,
	`voided_at` integer,
	`void_reason` text,
	`voided_by` text,
	`gateway` text,
	`gateway_order_id` text,
	`gateway_payment_id` text,
	`refunded_at` integer,
	`gateway_refund_id` text,
	FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`period_id`) REFERENCES `membership_periods`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`recorded_by`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`voided_by`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "payments_amount" CHECK("payments"."amount_paise" > 0),
	CONSTRAINT "payments_one_target" CHECK(("payments"."booking_id" IS NOT NULL) + ("payments"."period_id" IS NOT NULL) = 1),
	CONSTRAINT "payments_method_valid" CHECK("method" IN ('cash', 'upi', 'online', 'online_test'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_receipt_no_unique` ON `payments` (`receipt_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `payments_gateway_payment_id_unique` ON `payments` (`gateway_payment_id`);--> statement-breakpoint
CREATE INDEX `payments_booking_idx` ON `payments` (`booking_id`);--> statement-breakpoint
CREATE INDEX `payments_received_idx` ON `payments` (`received_at`);--> statement-breakpoint
CREATE INDEX `payments_period_idx` ON `payments` (`period_id`);--> statement-breakpoint
CREATE TABLE `price_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`court_id` text,
	`days` text NOT NULL,
	`start_minute` integer NOT NULL,
	`end_minute` integer NOT NULL,
	`rate_paise` integer NOT NULL,
	FOREIGN KEY (`court_id`) REFERENCES `courts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "price_rules_times" CHECK("price_rules"."start_minute" >= 0 AND "price_rules"."end_minute" <= 1440 AND "price_rules"."start_minute" < "price_rules"."end_minute"),
	CONSTRAINT "price_rules_rate" CHECK("price_rules"."rate_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE `referral_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`membership_id` text,
	`label` text,
	`active` integer DEFAULT true NOT NULL,
	`max_uses` integer,
	`expires_on` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `referral_codes_code_unique` ON `referral_codes` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `referral_codes_member_unique` ON `referral_codes` (`membership_id`) WHERE "referral_codes"."membership_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `referral_program` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`discount_type` text DEFAULT 'percent' NOT NULL,
	`discount_value` integer DEFAULT 10 NOT NULL,
	`reward_paise` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT "referral_program_single_row" CHECK("referral_program"."id" = 1),
	CONSTRAINT "referral_program_type_valid" CHECK("discount_type" IN ('percent', 'fixed'))
);
--> statement-breakpoint
CREATE TABLE `referral_redemptions` (
	`id` text PRIMARY KEY NOT NULL,
	`code_id` text NOT NULL,
	`membership_id` text NOT NULL,
	`discount_paise` integer NOT NULL,
	`reward_paise` integer DEFAULT 0 NOT NULL,
	`credited_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`code_id`) REFERENCES `referral_codes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `referral_redemptions_membership_id_unique` ON `referral_redemptions` (`membership_id`);--> statement-breakpoint
CREATE INDEX `referral_redemptions_code_idx` ON `referral_redemptions` (`code_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`venue_name` text NOT NULL,
	`address` text,
	`phone` text,
	`email` text,
	`slot_minutes` integer DEFAULT 60 NOT NULL,
	`advance_booking_days` integer DEFAULT 7 NOT NULL,
	`min_notice_minutes` integer DEFAULT 60 NOT NULL,
	`hold_minutes` integer DEFAULT 10 NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT "settings_single_row" CHECK("settings"."id" = 1),
	CONSTRAINT "settings_slot_minutes" CHECK("settings"."slot_minutes" IN (30, 60))
);
--> statement-breakpoint
CREATE TABLE `site_content` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`content` text DEFAULT '{}' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_by_staff_id` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`updated_by_staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "site_content_single_row" CHECK("site_content"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `site_images` (
	`id` text PRIMARY KEY NOT NULL,
	`content_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `staff` (
	`id` text PRIMARY KEY NOT NULL,
	`staff_no` text NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`phone` text,
	`role` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`password_hash` text NOT NULL,
	`must_change_password` integer DEFAULT false NOT NULL,
	`failed_login_attempts` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	`last_login_at` integer,
	`password_changed_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`deleted_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT "staff_role_valid" CHECK("role" IN ('owner', 'manager', 'front_desk')),
	CONSTRAINT "staff_status_valid" CHECK("status" IN ('active', 'inactive'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_staff_no_unique` ON `staff` (`staff_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `staff_email_unique` ON `staff` (lower("email")) WHERE "staff"."deleted_at" IS NULL;