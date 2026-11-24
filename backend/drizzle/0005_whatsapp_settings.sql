ALTER TABLE `message_settings` ADD `whatsapp_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `message_settings` ADD `whatsapp_phone_number_id` text;--> statement-breakpoint
ALTER TABLE `message_settings` ADD `whatsapp_token_encrypted` text;--> statement-breakpoint
ALTER TABLE `message_settings` ADD `whatsapp_business_account_id` text;--> statement-breakpoint
ALTER TABLE `message_settings` ADD `whatsapp_template_language` text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE `message_settings` ADD `whatsapp_templates` text;--> statement-breakpoint
ALTER TABLE `message_settings` ADD `owner_whatsapp_numbers` text;--> statement-breakpoint
ALTER TABLE `message_settings` ADD `daily_whatsapp_limit` integer DEFAULT 200 NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `template_params` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `audience` text DEFAULT 'customer' NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `fallback_of` text;--> statement-breakpoint
-- Staff alerts already sent are owner messages, not customer ones (only customer messages fall back to email).
UPDATE `messages` SET `audience` = 'owner' WHERE `template` LIKE 'staff\_%' ESCAPE '\';
