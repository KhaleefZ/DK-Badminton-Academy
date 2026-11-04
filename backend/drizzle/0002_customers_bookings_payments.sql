-- lpad cuts anything longer than the width, so STF-1000 would have come out as STF-100.
CREATE FUNCTION dk_number(prefix text, n bigint, width int) RETURNS text
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT prefix || lpad(n::text, greatest(width, length(n::text)), '0') $$;--> statement-breakpoint
CREATE TYPE "public"."booking_source" AS ENUM('admin', 'website');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('active', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."customer_type" AS ENUM('walk_in', 'website');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'upi');--> statement-breakpoint
CREATE SEQUENCE "public"."booking_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."receipt_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."walk_in_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."website_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_no" text DEFAULT dk_number('BKG-', nextval('booking_number_seq'), 5) NOT NULL,
	"customer_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"amount_paise" integer NOT NULL,
	"source" "booking_source" DEFAULT 'admin' NOT NULL,
	"status" "booking_status" DEFAULT 'active' NOT NULL,
	"notes" text,
	"cancel_reason" text,
	"cancelled_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_booking_no_unique" UNIQUE("booking_no"),
	CONSTRAINT "bookings_reservation_id_unique" UNIQUE("reservation_id"),
	CONSTRAINT "bookings_amount" CHECK ("bookings"."amount_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_no" text NOT NULL,
	"type" "customer_type" NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"notes" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_customer_no_unique" UNIQUE("customer_no")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_no" text DEFAULT dk_number('RCP-', nextval('receipt_number_seq'), 5) NOT NULL,
	"booking_id" uuid NOT NULL,
	"amount_paise" integer NOT NULL,
	"method" "payment_method" NOT NULL,
	"reference" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by" uuid,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"voided_by" uuid,
	CONSTRAINT "payments_receipt_no_unique" UNIQUE("receipt_no"),
	CONSTRAINT "payments_amount" CHECK ("payments"."amount_paise" > 0)
);
--> statement-breakpoint
ALTER TABLE "staff" ALTER COLUMN "staff_no" SET DEFAULT dk_number('STF-', nextval('staff_number_seq'), 3);--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_reservation_id_court_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."court_reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_staff_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_voided_by_staff_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_customer_idx" ON "bookings" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "customers_type_idx" ON "customers" USING btree ("type");--> statement-breakpoint
CREATE INDEX "customers_phone_idx" ON "customers" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "payments_booking_idx" ON "payments" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "payments_received_idx" ON "payments" USING btree ("received_at");