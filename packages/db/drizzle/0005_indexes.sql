CREATE INDEX `inbox_created_idx` ON `inbox` (`created_at`);--> statement-breakpoint
CREATE INDEX `job_items_source_idx` ON `job_items` (`source_path`);--> statement-breakpoint
CREATE INDEX `job_items_target_idx` ON `job_items` (`target_path`);--> statement-breakpoint
CREATE INDEX `operations_undone_idx` ON `operations` (`undone_at`);