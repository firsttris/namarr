ALTER TABLE `watch_folders` ADD `options_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
UPDATE `jobs` SET `config_json` = json_set(`config_json`, '$.action', 'copy') WHERE json_extract(`config_json`, '$.action') IN ('hardlink', 'symlink');
