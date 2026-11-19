CREATE TABLE `cover_letters` (
	`posting_id` text PRIMARY KEY NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`text` text,
	`language` text,
	`instruction` text,
	`error` text,
	`model` text,
	`edited` integer DEFAULT 0 NOT NULL,
	`generated_at` text,
	`updated_at` text NOT NULL
);
