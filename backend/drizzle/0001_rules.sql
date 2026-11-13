-- Rules that must hold however a row is changed. D1 runs one write at a time, so a check made
-- inside a trigger can't be raced by another request. Errors carry a DKnnn code that
-- src/db/client.ts turns into a friendly message.

-- At most 5 active admin accounts, including the Owner.
CREATE TRIGGER staff_limit_insert BEFORE INSERT ON staff
WHEN NEW.status = 'active' AND NEW.deleted_at IS NULL
  AND (SELECT count(*) FROM staff WHERE status = 'active' AND deleted_at IS NULL) >= 5
BEGIN
  SELECT RAISE(ABORT, 'DK001: Only 5 active admin accounts are allowed.');
END;
--> statement-breakpoint
CREATE TRIGGER staff_limit_update BEFORE UPDATE OF status, deleted_at ON staff
WHEN NEW.status = 'active' AND NEW.deleted_at IS NULL
  AND (OLD.status <> 'active' OR OLD.deleted_at IS NOT NULL)
  AND (SELECT count(*) FROM staff WHERE status = 'active' AND deleted_at IS NULL AND id <> NEW.id) >= 5
BEGIN
  SELECT RAISE(ABORT, 'DK001: Only 5 active admin accounts are allowed.');
END;
--> statement-breakpoint
-- There must always be one active Owner, or nobody could manage the staff list.
CREATE TRIGGER staff_last_owner_update BEFORE UPDATE OF role, status, deleted_at ON staff
WHEN OLD.role = 'owner' AND OLD.status = 'active' AND OLD.deleted_at IS NULL
  AND (NEW.role <> 'owner' OR NEW.status <> 'active' OR NEW.deleted_at IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM staff WHERE role = 'owner' AND status = 'active' AND deleted_at IS NULL AND id <> OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'DK002: The last active Owner can''t be removed.');
END;
--> statement-breakpoint
CREATE TRIGGER staff_last_owner_delete BEFORE DELETE ON staff
WHEN OLD.role = 'owner' AND OLD.status = 'active' AND OLD.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM staff WHERE role = 'owner' AND status = 'active' AND deleted_at IS NULL AND id <> OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'DK002: The last active Owner can''t be removed.');
END;
--> statement-breakpoint
-- No two active reservations may share a court and any part of their time.
CREATE TRIGGER court_reservations_no_overlap_insert BEFORE INSERT ON court_reservations
WHEN NEW.status = 'active' AND EXISTS (
  SELECT 1 FROM court_reservations
  WHERE court_id = NEW.court_id AND status = 'active' AND starts_at < NEW.ends_at AND ends_at > NEW.starts_at
)
BEGIN
  SELECT RAISE(ABORT, 'DK003: That court is already reserved for some of this time.');
END;
--> statement-breakpoint
CREATE TRIGGER court_reservations_no_overlap_update BEFORE UPDATE OF court_id, status, starts_at, ends_at ON court_reservations
WHEN NEW.status = 'active' AND EXISTS (
  SELECT 1 FROM court_reservations
  WHERE court_id = NEW.court_id AND status = 'active' AND starts_at < NEW.ends_at AND ends_at > NEW.starts_at AND id <> NEW.id
)
BEGIN
  SELECT RAISE(ABORT, 'DK003: That court is already reserved for some of this time.');
END;
--> statement-breakpoint
-- A batch never takes more members than its capacity, counting those whose membership is still
-- running on the new member's first day.
CREATE TRIGGER memberships_batch_capacity_insert BEFORE INSERT ON memberships
WHEN NEW.batch_id IS NOT NULL AND NEW.status IN ('active', 'pending_payment') AND NEW.deleted_at IS NULL
  AND (SELECT count(*) FROM memberships
       WHERE batch_id = NEW.batch_id AND status IN ('active', 'pending_payment') AND deleted_at IS NULL AND ends_on >= NEW.starts_on)
    >= (SELECT capacity FROM member_batches WHERE id = NEW.batch_id)
BEGIN
  SELECT RAISE(ABORT, 'DK004: That batch is full.');
END;
--> statement-breakpoint
CREATE TRIGGER memberships_batch_capacity_update BEFORE UPDATE OF batch_id, status, deleted_at, starts_on ON memberships
WHEN NEW.batch_id IS NOT NULL AND NEW.status IN ('active', 'pending_payment') AND NEW.deleted_at IS NULL
  AND (OLD.batch_id IS NOT NEW.batch_id OR OLD.status NOT IN ('active', 'pending_payment') OR OLD.deleted_at IS NOT NULL)
  AND (SELECT count(*) FROM memberships
       WHERE batch_id = NEW.batch_id AND status IN ('active', 'pending_payment') AND deleted_at IS NULL AND ends_on >= NEW.starts_on AND id <> NEW.id)
    >= (SELECT capacity FROM member_batches WHERE id = NEW.batch_id)
BEGIN
  SELECT RAISE(ABORT, 'DK004: That batch is full.');
END;
--> statement-breakpoint
-- A referral code with a use limit can't be used past it, even by two people at the same moment.
CREATE TRIGGER referral_redemptions_max_uses BEFORE INSERT ON referral_redemptions
WHEN (SELECT max_uses FROM referral_codes WHERE id = NEW.code_id) IS NOT NULL
  AND (SELECT count(*) FROM referral_redemptions r JOIN memberships m ON m.id = r.membership_id
       WHERE r.code_id = NEW.code_id AND m.status IN ('active', 'pending_payment'))
    >= (SELECT max_uses FROM referral_codes WHERE id = NEW.code_id)
BEGIN
  SELECT RAISE(ABORT, 'DK005: That referral code isn''t valid.');
END;
--> statement-breakpoint
-- A receipt can't take more than is still owed, even when two staff record payments at once.
CREATE TRIGGER payments_no_overpayment BEFORE INSERT ON payments
WHEN NEW.amount_paise > CASE
  WHEN NEW.booking_id IS NOT NULL THEN
    (SELECT amount_paise FROM bookings WHERE id = NEW.booking_id)
    - coalesce((SELECT sum(amount_paise) FROM payments WHERE booking_id = NEW.booking_id AND voided_at IS NULL), 0)
  ELSE
    (SELECT amount_paise FROM membership_periods WHERE id = NEW.period_id)
    - coalesce((SELECT sum(amount_paise) FROM payments WHERE period_id = NEW.period_id AND voided_at IS NULL), 0)
  END
BEGIN
  SELECT RAISE(ABORT, 'DK006: That is more than is still owed.');
END;
--> statement-breakpoint
-- Record numbers. The insert reads value + 1 (see nextNumber in schema.ts) and these move the
-- counter on in the same statement, so a number is never given out twice or reused.
INSERT INTO counters (prefix, value) VALUES ('STF-', 0), ('WLK-', 0), ('WEB-', 0), ('BKG-', 0), ('RCP-', 0), ('ENQ-', 0), ('MEM-', 0), ('CRT-', 0);
--> statement-breakpoint
CREATE TRIGGER staff_number AFTER INSERT ON staff
BEGIN
  UPDATE counters SET value = value + 1 WHERE prefix = substr(NEW.staff_no, 1, 4);
END;
--> statement-breakpoint
CREATE TRIGGER customers_number AFTER INSERT ON customers
BEGIN
  UPDATE counters SET value = value + 1 WHERE prefix = substr(NEW.customer_no, 1, 4);
END;
--> statement-breakpoint
CREATE TRIGGER bookings_number AFTER INSERT ON bookings
BEGIN
  UPDATE counters SET value = value + 1 WHERE prefix = substr(NEW.booking_no, 1, 4);
END;
--> statement-breakpoint
CREATE TRIGGER payments_number AFTER INSERT ON payments
BEGIN
  UPDATE counters SET value = value + 1 WHERE prefix = substr(NEW.receipt_no, 1, 4);
END;
--> statement-breakpoint
CREATE TRIGGER enquiries_number AFTER INSERT ON enquiries
BEGIN
  UPDATE counters SET value = value + 1 WHERE prefix = substr(NEW.enquiry_no, 1, 4);
END;
--> statement-breakpoint
CREATE TRIGGER memberships_number AFTER INSERT ON memberships
BEGIN
  UPDATE counters SET value = value + 1 WHERE prefix = substr(NEW.membership_no, 1, 4);
END;
--> statement-breakpoint
-- Single-row tables and the starting courts.
INSERT INTO settings (id, venue_name, address) VALUES (1, 'DK Badminton Academy', 'Selvapuram North, Coimbatore, Tamil Nadu');
--> statement-breakpoint
INSERT INTO courts (id, name, sort_order) VALUES ('6f1c2a4e-8b3d-4c5a-9e7f-1a2b3c4d5e01', 'Court 1', 1), ('6f1c2a4e-8b3d-4c5a-9e7f-1a2b3c4d5e02', 'Court 2', 2);
--> statement-breakpoint
INSERT INTO message_settings (id) VALUES (1);
--> statement-breakpoint
INSERT INTO referral_program (id) VALUES (1);
--> statement-breakpoint
INSERT INTO site_content (id) VALUES (1);
--> statement-breakpoint
INSERT INTO payment_settings (id) VALUES (1);
