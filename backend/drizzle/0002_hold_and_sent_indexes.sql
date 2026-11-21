CREATE INDEX `bookings_hold_idx` ON `bookings` (`status`,`hold_expires_at`);--> statement-breakpoint
CREATE INDEX `memberships_hold_idx` ON `memberships` (`status`,`hold_expires_at`);--> statement-breakpoint
CREATE INDEX `messages_sent_idx` ON `messages` (`channel`,`status`,`sent_at`);