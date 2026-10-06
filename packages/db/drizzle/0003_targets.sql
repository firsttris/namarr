ALTER TABLE `profiles` ADD `targets_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `watch_folders` ADD `targets_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
-- One target folder becomes the movie and the series folder (media modes) or the rule-mode folder.
UPDATE `profiles` SET `targets_json` = CASE WHEN `mode` = 'rules' THEN json_object('other', `target_root`) ELSE json_object('movie', `target_root`, 'series', `target_root`) END, `target_root` = NULL WHERE `target_root` IS NOT NULL AND `target_root` != '';--> statement-breakpoint
UPDATE `watch_folders` SET `targets_json` = json_object('movie', `target_root`, 'series', `target_root`, 'other', `target_root`), `target_root` = '' WHERE `target_root` != '';
