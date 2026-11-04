CREATE TYPE "public"."membership_kind" AS ENUM('individual', 'court');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('active', 'cancelled', 'pending_payment', 'expired');--> statement-breakpoint
CREATE SEQUENCE "public"."court_member_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."individual_member_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "member_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"plan_id" uuid NOT NULL,
	"court_id" uuid NOT NULL,
	"days" integer[] NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	"capacity" integer NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_batches_capacity" CHECK ("member_batches"."capacity" >= 1),
	CONSTRAINT "member_batches_dates" CHECK ("member_batches"."starts_on" <= "member_batches"."ends_on")
);
--> statement-breakpoint
CREATE TABLE "membership_courts" (
	"membership_id" uuid NOT NULL,
	"court_id" uuid NOT NULL,
	CONSTRAINT "membership_courts_membership_id_court_id_pk" PRIMARY KEY("membership_id","court_id")
);
--> statement-breakpoint
CREATE TABLE "membership_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"membership_id" uuid NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"amount_paise" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_periods_amount" CHECK ("membership_periods"."amount_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "membership_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" "membership_kind" NOT NULL,
	"description" text,
	"features" text[] DEFAULT '{}'::text[] NOT NULL,
	"price_paise" integer NOT NULL,
	"players_per_court" integer DEFAULT 10 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_plans_price" CHECK ("membership_plans"."price_paise" >= 0),
	CONSTRAINT "membership_plans_players" CHECK ("membership_plans"."players_per_court" BETWEEN 1 AND 10)
);
--> statement-breakpoint
CREATE TABLE "membership_players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"membership_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"membership_no" text NOT NULL,
	"kind" "membership_kind" NOT NULL,
	"plan_id" uuid NOT NULL,
	"batch_id" uuid,
	"days" integer[],
	"start_minute" integer,
	"end_minute" integer,
	"holder_name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"notes" text,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"price_paise" integer NOT NULL,
	"status" "membership_status" DEFAULT 'active' NOT NULL,
	"source" "booking_source" DEFAULT 'admin' NOT NULL,
	"cancel_reason" text,
	"cancelled_at" timestamp with time zone,
	"access_token_hash" text,
	"hold_expires_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_membership_no_unique" UNIQUE("membership_no"),
	CONSTRAINT "memberships_access_token_hash_unique" UNIQUE("access_token_hash"),
	CONSTRAINT "memberships_price" CHECK ("memberships"."price_paise" >= 0)
);
--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "booking_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "court_reservations" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "court_reservations" ADD COLUMN "membership_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "membership_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "period_id" uuid;--> statement-breakpoint
ALTER TABLE "member_batches" ADD CONSTRAINT "member_batches_plan_id_membership_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."membership_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_batches" ADD CONSTRAINT "member_batches_court_id_courts_id_fk" FOREIGN KEY ("court_id") REFERENCES "public"."courts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_courts" ADD CONSTRAINT "membership_courts_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_courts" ADD CONSTRAINT "membership_courts_court_id_courts_id_fk" FOREIGN KEY ("court_id") REFERENCES "public"."courts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_periods" ADD CONSTRAINT "membership_periods_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_players" ADD CONSTRAINT "membership_players_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_plan_id_membership_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."membership_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_batch_id_member_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."member_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "membership_periods_membership_idx" ON "membership_periods" USING btree ("membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_plans_name_unique" ON "membership_plans" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "membership_players_membership_idx" ON "membership_players" USING btree ("membership_id");--> statement-breakpoint
CREATE INDEX "memberships_batch_idx" ON "memberships" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "memberships_ends_idx" ON "memberships" USING btree ("ends_on");--> statement-breakpoint
ALTER TABLE "court_reservations" ADD CONSTRAINT "court_reservations_batch_id_member_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."member_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "court_reservations" ADD CONSTRAINT "court_reservations_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_period_id_membership_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."membership_periods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "court_reservations_batch_idx" ON "court_reservations" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "court_reservations_membership_idx" ON "court_reservations" USING btree ("membership_id");--> statement-breakpoint
CREATE INDEX "payments_period_idx" ON "payments" USING btree ("period_id");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_one_target" CHECK (num_nonnulls("payments"."booking_id", "payments"."period_id") = 1);