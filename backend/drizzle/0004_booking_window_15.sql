-- The booking window setting now counts days including today, at most 15. Start everyone on 15
-- (today and the next 14), the academy's chosen window; staff can shorten it in Settings.
UPDATE settings SET advance_booking_days = 15;
