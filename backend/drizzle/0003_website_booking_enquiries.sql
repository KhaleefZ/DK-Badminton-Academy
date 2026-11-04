CREATE TYPE "public"."enquiry_status" AS ENUM('new', 'handled');--> statement-breakpoint
ALTER TYPE "public"."booking_status" ADD VALUE 'pending_payment';--> statement-breakpoint
ALTER TYPE "public"."booking_status" ADD VALUE 'expired';--> statement-breakpoint
ALTER TYPE "public"."payment_method" ADD VALUE 'online_test';--> statement-breakpoint
CREATE SEQUENCE "public"."enquiry_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "enquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enquiry_no" text DEFAULT dk_number('ENQ-', nextval('enquiry_number_seq'), 5) NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"topic" text,
	"preferred" text,
	"message" text NOT NULL,
	"status" "enquiry_status" DEFAULT 'new' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enquiries_enquiry_no_unique" UNIQUE("enquiry_no")
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "access_token_hash" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "hold_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "hold_minutes" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
CREATE INDEX "enquiries_status_idx" ON "enquiries" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_access_token_hash_unique" UNIQUE("access_token_hash");