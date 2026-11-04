CREATE TYPE "public"."discount_type" AS ENUM('percent', 'fixed');--> statement-breakpoint
CREATE TABLE "member_credits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"membership_id" uuid NOT NULL,
	"amount_paise" integer NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"membership_id" uuid,
	"label" text,
	"active" boolean DEFAULT true NOT NULL,
	"max_uses" integer,
	"expires_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "referral_program" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"discount_type" "discount_type" DEFAULT 'percent' NOT NULL,
	"discount_value" integer DEFAULT 10 NOT NULL,
	"reward_paise" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_program_single_row" CHECK ("referral_program"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "referral_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"discount_paise" integer NOT NULL,
	"reward_paise" integer DEFAULT 0 NOT NULL,
	"credited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_redemptions_membership_id_unique" UNIQUE("membership_id")
);
--> statement-breakpoint
ALTER TABLE "membership_periods" ADD COLUMN "discount_paise" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "membership_periods" ADD COLUMN "credit_paise" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "member_credits" ADD CONSTRAINT "member_credits_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_credits" ADD CONSTRAINT "member_credits_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_redemptions" ADD CONSTRAINT "referral_redemptions_code_id_referral_codes_id_fk" FOREIGN KEY ("code_id") REFERENCES "public"."referral_codes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_redemptions" ADD CONSTRAINT "referral_redemptions_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_credits_membership_idx" ON "member_credits" USING btree ("membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "referral_codes_member_unique" ON "referral_codes" USING btree ("membership_id") WHERE "referral_codes"."membership_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "referral_redemptions_code_idx" ON "referral_redemptions" USING btree ("code_id");--> statement-breakpoint
-- Off, so nobody gets a discount until the Owner sets one.
INSERT INTO "referral_program" ("id") VALUES (1);
