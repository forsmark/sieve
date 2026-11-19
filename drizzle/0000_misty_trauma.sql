CREATE TABLE `application_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`posting_id` text NOT NULL,
	`from_stage` text,
	`to_stage` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `application_events_posting` ON `application_events` (`posting_id`);--> statement-breakpoint
CREATE TABLE `applications` (
	`posting_id` text PRIMARY KEY NOT NULL,
	`stage` text DEFAULT 'applied' NOT NULL,
	`notes` text,
	`interview_at` text,
	`applied_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`snapshot_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `fetch_run_sources` (
	`run_id` integer NOT NULL,
	`source` text NOT NULL,
	`state` text NOT NULL,
	`found` integer DEFAULT 0 NOT NULL,
	`added` integer DEFAULT 0 NOT NULL,
	`invalid` integer DEFAULT 0 NOT NULL,
	`error` text,
	PRIMARY KEY(`run_id`, `source`)
);
--> statement-breakpoint
CREATE TABLE `fetch_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trigger` text NOT NULL,
	`state` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text
);
--> statement-breakpoint
CREATE TABLE `logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`level` text NOT NULL,
	`message` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `matches` (
	`posting_id` text PRIMARY KEY NOT NULL,
	`state` text DEFAULT 'waiting' NOT NULL,
	`fail_reason` text,
	`judge_version` text,
	`rule_version` text,
	`excluded_reason` text,
	`soft_violations` text DEFAULT '[]' NOT NULL,
	`skills_score` integer,
	`experience_score` integer,
	`preference_score` integer,
	`location_score` integer,
	`total_score` integer,
	`matched_skills` text DEFAULT '[]' NOT NULL,
	`missing_skills` text DEFAULT '[]' NOT NULL,
	`assessment` text,
	`provider` text,
	`model` text,
	`first_scored_at` text,
	`updated_at` text,
	`notify_queued_at` text,
	`notified_at` text
);
--> statement-breakpoint
CREATE INDEX `matches_total` ON `matches` (`total_score`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`posting_ids` text NOT NULL,
	`state` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	`sent_at` text
);
--> statement-breakpoint
CREATE TABLE `posting_facts` (
	`posting_id` text PRIMARY KEY NOT NULL,
	`facts_json` text NOT NULL,
	`description_hash` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `postings` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	`title` text NOT NULL,
	`company` text NOT NULL,
	`location` text,
	`url` text NOT NULL,
	`description` text,
	`lacks_description` integer DEFAULT 0 NOT NULL,
	`posted_at` text,
	`first_seen_at` text NOT NULL,
	`company_key` text NOT NULL,
	`fingerprint` text NOT NULL,
	`duplicate_of` text,
	`duplicate_locked` integer DEFAULT 0 NOT NULL,
	`link_status` text DEFAULT 'unchecked' NOT NULL,
	`link_checked_at` text,
	`triage_status` text DEFAULT 'new' NOT NULL,
	`triage_origin` text,
	`read_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `postings_source_external` ON `postings` (`source`,`external_id`);--> statement-breakpoint
CREATE INDEX `postings_fingerprint` ON `postings` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `postings_company_key` ON `postings` (`company_key`);--> statement-breakpoint
CREATE INDEX `postings_triage` ON `postings` (`triage_status`);--> statement-breakpoint
CREATE TABLE `preferences` (
	`id` integer PRIMARY KEY NOT NULL,
	`prefs_json` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `profile` (
	`id` integer PRIMARY KEY NOT NULL,
	`cv_text` text NOT NULL,
	`derived_json` text,
	`edits_json` text DEFAULT '{}' NOT NULL,
	`derive_state` text DEFAULT 'idle' NOT NULL,
	`derive_error` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `schedule` (
	`id` integer PRIMARY KEY NOT NULL,
	`interval_hours` integer DEFAULT 4 NOT NULL,
	`paused` integer DEFAULT 0 NOT NULL,
	`next_run_at` text
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`subject_id` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`run_after` text NOT NULL,
	`locked_at` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_open_unique` ON `tasks` (`kind`,`subject_id`) WHERE state IN ('pending', 'running');--> statement-breakpoint
CREATE INDEX `tasks_claim` ON `tasks` (`state`,`run_after`);