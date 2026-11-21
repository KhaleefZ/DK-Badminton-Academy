ALTER TABLE `payments` ADD `refunded_paise` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- A partly refunded receipt only counts what was kept, so the overpayment rule compares against that.
DROP TRIGGER payments_no_overpayment;
--> statement-breakpoint
CREATE TRIGGER payments_no_overpayment BEFORE INSERT ON payments
WHEN NEW.amount_paise > CASE
  WHEN NEW.booking_id IS NOT NULL THEN
    (SELECT amount_paise FROM bookings WHERE id = NEW.booking_id)
    - coalesce((SELECT sum(amount_paise - refunded_paise) FROM payments WHERE booking_id = NEW.booking_id AND voided_at IS NULL), 0)
  ELSE
    (SELECT amount_paise FROM membership_periods WHERE id = NEW.period_id)
    - coalesce((SELECT sum(amount_paise - refunded_paise) FROM payments WHERE period_id = NEW.period_id AND voided_at IS NULL), 0)
  END
BEGIN
  SELECT RAISE(ABORT, 'DK006: That is more than is still owed.');
END;
