CREATE TABLE `match_analyses` (
	`posting_id` text PRIMARY KEY NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`content_json` text,
	`error` text,
	`model` text,
	`generated_at` text,
	`updated_at` text NOT NULL
);
