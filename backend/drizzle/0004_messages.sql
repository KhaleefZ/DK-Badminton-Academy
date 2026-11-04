CREATE TYPE "public"."message_channel" AS ENUM('email', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('queued', 'sending', 'sent', 'failed', 'expired', 'cancelled');--> statement-breakpoint
CREATE TABLE "message_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"email_enabled" boolean DEFAULT true NOT NULL,
	"sender_name" text,
	"sender_email" text,
	"app_password_encrypted" text,
	"notify_email" text,
	"daily_email_limit" integer DEFAULT 100 NOT NULL,
	"whatsapp_number" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_settings_single_row" CHECK ("message_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" "message_channel" DEFAULT 'email' NOT NULL,
	"template" text NOT NULL,
	"recipient" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" "message_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"last_error" text,
	"booking_id" uuid,
	"enquiry_id" uuid,
	"sent_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_enquiry_id_enquiries_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "public"."enquiries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_queue_idx" ON "messages" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "messages_booking_idx" ON "messages" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "messages_created_idx" ON "messages" USING btree ("created_at");--> statement-breakpoint
-- No sender is seeded: the Owner adds one in the admin panel.
INSERT INTO "message_settings" ("id") VALUES (1);
