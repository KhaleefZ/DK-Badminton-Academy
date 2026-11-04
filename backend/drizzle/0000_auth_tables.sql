CREATE TYPE "public"."staff_role" AS ENUM('owner', 'manager', 'front_desk');--> statement-breakpoint
CREATE TYPE "public"."staff_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE SEQUENCE "public"."staff_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "admin_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"remember" boolean DEFAULT false NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "admin_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_staff_id" uuid,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"old_values" jsonb,
	"new_values" jsonb,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_no" text DEFAULT 'STF-' || lpad(nextval('staff_number_seq')::text, 3, '0') NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"role" "staff_role" NOT NULL,
	"status" "staff_status" DEFAULT 'active' NOT NULL,
	"password_hash" text NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"failed_login_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"password_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_staff_no_unique" UNIQUE("staff_no")
);
--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_staff_id_staff_id_fk" FOREIGN KEY ("actor_staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_sessions_staff_idx" ON "admin_sessions" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "admin_sessions_expires_idx" ON "admin_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_staff_id");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_staff_idx" ON "password_reset_tokens" USING btree ("staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_email_unique" ON "staff" USING btree (lower("email")) WHERE "staff"."deleted_at" IS NULL;--> statement-breakpoint
-- At most 5 active admin accounts, including the Owner. The lock makes two simultaneous
-- requests wait for each other, so neither can slip past the count.
CREATE FUNCTION enforce_staff_limit() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'active' AND NEW.deleted_at IS NULL
     AND (TG_OP = 'INSERT' OR OLD.status <> 'active' OR OLD.deleted_at IS NOT NULL) THEN
    PERFORM pg_advisory_xact_lock(hashtext('staff_accounts'));
    IF (SELECT count(*) FROM staff WHERE status = 'active' AND deleted_at IS NULL AND id <> NEW.id) >= 5 THEN
      RAISE EXCEPTION 'Only 5 active admin accounts are allowed.' USING ERRCODE = 'DK001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER staff_limit BEFORE INSERT OR UPDATE ON staff
  FOR EACH ROW EXECUTE FUNCTION enforce_staff_limit();
--> statement-breakpoint
-- There must always be one active Owner, or nobody could manage the staff list.
CREATE FUNCTION protect_last_owner() RETURNS trigger AS $$
BEGIN
  IF OLD.role = 'owner' AND OLD.status = 'active' AND OLD.deleted_at IS NULL
     AND (TG_OP = 'DELETE' OR NEW.role <> 'owner' OR NEW.status <> 'active' OR NEW.deleted_at IS NOT NULL) THEN
    PERFORM pg_advisory_xact_lock(hashtext('staff_accounts'));
    IF NOT EXISTS (
      SELECT 1 FROM staff
      WHERE role = 'owner' AND status = 'active' AND deleted_at IS NULL AND id <> OLD.id
    ) THEN
      RAISE EXCEPTION 'The last active Owner can''t be removed.' USING ERRCODE = 'DK002';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER staff_last_owner BEFORE UPDATE OR DELETE ON staff
  FOR EACH ROW EXECUTE FUNCTION protect_last_owner();
