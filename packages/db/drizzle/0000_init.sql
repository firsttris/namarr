CREATE TABLE `inbox` (
	`job_item_id` integer PRIMARY KEY NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`job_item_id`) REFERENCES `job_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `job_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`source_path` text NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`parsed_json` text,
	`match_json` text,
	`confidence` real DEFAULT 0 NOT NULL,
	`target_path` text,
	`override_target` text,
	`excluded` integer DEFAULT false NOT NULL,
	`state` text DEFAULT 'parsed' NOT NULL,
	`reasons_json` text DEFAULT '[]' NOT NULL,
	`companions_json` text DEFAULT '[]' NOT NULL,
	`conflict` text,
	`error` text,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `job_items_job_idx` ON `job_items` (`job_id`,`state`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text DEFAULT 'manual' NOT NULL,
	`profile_id` integer,
	`watch_folder_id` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`source_paths` text NOT NULL,
	`config_json` text NOT NULL,
	`progress_done` integer DEFAULT 0 NOT NULL,
	`progress_total` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`watch_folder_id`) REFERENCES `watch_folders`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `jobs_created_idx` ON `jobs` (`created_at`);--> statement-breakpoint
CREATE TABLE `match_overrides` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pattern` text NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`season_offset` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `operations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_item_id` integer,
	`job_id` integer,
	`action` text NOT NULL,
	`from_path` text NOT NULL,
	`to_path` text NOT NULL,
	`size` integer NOT NULL,
	`inode` integer NOT NULL,
	`backup_path` text,
	`created_dirs_json` text DEFAULT '[]' NOT NULL,
	`executed_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`undone_at` integer,
	FOREIGN KEY (`job_item_id`) REFERENCES `job_items`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `operations_executed_idx` ON `operations` (`executed_at`);--> statement-breakpoint
CREATE INDEX `operations_job_idx` ON `operations` (`job_id`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`mode` text DEFAULT 'media' NOT NULL,
	`preset` text DEFAULT 'jellyfin' NOT NULL,
	`template` text DEFAULT '{}' NOT NULL,
	`rules_json` text DEFAULT '[]' NOT NULL,
	`action` text DEFAULT 'test' NOT NULL,
	`conflict_policy` text DEFAULT 'skip' NOT NULL,
	`target_root` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `provider_cache` (
	`provider` text NOT NULL,
	`key` text NOT NULL,
	`response_json` text NOT NULL,
	`fetched_at` integer NOT NULL,
	`ttl` integer NOT NULL,
	PRIMARY KEY(`provider`, `key`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `watch_folders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`profile_id` integer,
	`target_root` text NOT NULL,
	`auto_threshold` real DEFAULT 0.9,
	`stable_seconds` integer DEFAULT 30 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_event_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null
);
