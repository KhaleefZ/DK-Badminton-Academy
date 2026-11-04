CREATE TYPE "public"."reservation_kind" AS ENUM('booking', 'member_block', 'staff_block');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('active', 'released');--> statement-breakpoint
CREATE TABLE "closures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"court_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "closures_period" CHECK ("closures"."starts_at" < "closures"."ends_at")
);
--> statement-breakpoint
CREATE TABLE "court_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"court_id" uuid NOT NULL,
	"kind" "reservation_kind" NOT NULL,
	"status" "reservation_status" DEFAULT 'active' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "court_reservations_period" CHECK ("court_reservations"."starts_at" < "court_reservations"."ends_at")
);
--> statement-breakpoint
CREATE TABLE "courts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opening_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"weekday" integer NOT NULL,
	"open_minute" integer NOT NULL,
	"close_minute" integer NOT NULL,
	CONSTRAINT "opening_hours_weekday" CHECK ("opening_hours"."weekday" BETWEEN 0 AND 6),
	CONSTRAINT "opening_hours_times" CHECK ("opening_hours"."open_minute" >= 0 AND "opening_hours"."close_minute" <= 1440 AND "opening_hours"."open_minute" < "opening_hours"."close_minute")
);
--> statement-breakpoint
CREATE TABLE "price_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"court_id" uuid,
	"days" integer[] NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	"rate_paise" integer NOT NULL,
	CONSTRAINT "price_rules_times" CHECK ("price_rules"."start_minute" >= 0 AND "price_rules"."end_minute" <= 1440 AND "price_rules"."start_minute" < "price_rules"."end_minute"),
	CONSTRAINT "price_rules_rate" CHECK ("price_rules"."rate_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"venue_name" text NOT NULL,
	"address" text,
	"phone" text,
	"email" text,
	"slot_minutes" integer DEFAULT 60 NOT NULL,
	"advance_booking_days" integer DEFAULT 7 NOT NULL,
	"min_notice_minutes" integer DEFAULT 60 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_single_row" CHECK ("settings"."id" = 1),
	CONSTRAINT "settings_slot_minutes" CHECK ("settings"."slot_minutes" IN (30, 60))
);
--> statement-breakpoint
ALTER TABLE "closures" ADD CONSTRAINT "closures_court_id_courts_id_fk" FOREIGN KEY ("court_id") REFERENCES "public"."courts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "court_reservations" ADD CONSTRAINT "court_reservations_court_id_courts_id_fk" FOREIGN KEY ("court_id") REFERENCES "public"."courts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "court_reservations" ADD CONSTRAINT "court_reservations_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_rules" ADD CONSTRAINT "price_rules_court_id_courts_id_fk" FOREIGN KEY ("court_id") REFERENCES "public"."courts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "closures_period_idx" ON "closures" USING btree ("starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "court_reservations_period_idx" ON "court_reservations" USING btree ("starts_at","ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "courts_name_unique" ON "courts" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "opening_hours_weekday_idx" ON "opening_hours" USING btree ("weekday");--> statement-breakpoint
-- Two active reservations can never share a court and time, however many requests arrive at once.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "court_reservations" ADD CONSTRAINT "court_reservations_no_overlap"
  EXCLUDE USING gist ("court_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&) WHERE ("status" = 'active');--> statement-breakpoint
-- Real hours and prices aren't known yet, so none are seeded: nothing can be booked until the Owner enters them.
INSERT INTO "settings" ("id", "venue_name", "address") VALUES (1, 'DK Badminton Academy', 'Selvapuram North, Coimbatore, Tamil Nadu');--> statement-breakpoint
INSERT INTO "courts" ("name", "sort_order") VALUES ('Court 1', 1), ('Court 2', 2);
