import { ACTIONS, type Action, CONFLICT_POLICIES, type ConflictPolicy, type WatchAction } from "@namarr/core/fileops";
import type { MatchResult } from "@namarr/core/matcher";
import type { Rule } from "@namarr/core/rules";
import type { Parsed } from "@namarr/core/types";
import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

const now = sql`(unixepoch() * 1000)`;
const createdAt = () => integer("created_at", { mode: "timestamp_ms" }).notNull().default(now);

/** Reusable rename setups. */
/** Where series come from; movies come from TMDB or TheTVDB (TVmaze and AniDB have none). */
export const SERIES_PROVIDERS = ["tmdb", "tvdb", "tvmaze", "anidb"] as const;
export const MOVIE_PROVIDERS = ["tmdb", "tvdb"] as const;
export type SeriesProvider = (typeof SERIES_PROVIDERS)[number];
export type MovieProvider = (typeof MOVIE_PROVIDERS)[number];

/**
 * Where a profile or watch folder puts files: a movie and a series folder for media mode, a folder
 * for rule mode. Unset: the default library folder of that kind (settings), or in place for rules.
 */
export type Targets = { movie?: string; series?: string; other?: string };

/** How a watch folder renames: formats by kind (ids, unset = default), series source, action. */
export type WatchOptions = {
  formats?: { movie?: string; series?: string };
  provider?: SeriesProvider;
  action?: WatchAction;
  conflictPolicy?: ConflictPolicy;
};

/** Replaced by naming formats and watch folder options; read once to take them over (migrateProfiles). */
export const profiles = sqliteTable("profiles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  mode: text("mode", { enum: ["media", "rules", "both"] })
    .notNull()
    .default("media"),
  preset: text("preset").notNull().default("jellyfin"),
  /** `{ movie?: string; episode?: string }`; empty uses the preset. */
  template: text("template", { mode: "json" }).$type<{ movie?: string; episode?: string }>().notNull().default({}),
  rulesJson: text("rules_json", { mode: "json" }).$type<Rule[]>().notNull().default([]),
  action: text("action", { enum: [...ACTIONS, "hardlink", "symlink"] })
    .notNull()
    .default("test"),
  conflictPolicy: text("conflict_policy", { enum: CONFLICT_POLICIES }).notNull().default("skip"),
  /** Replaced by `targets` (migration 0003), kept so older rows read. */
  targetRoot: text("target_root"),
  targets: text("targets_json", { mode: "json" }).$type<Targets>().notNull().default({}),
  /** Series source for this profile (an anime profile uses AniDB); null = the setting. */
  provider: text("provider", { enum: SERIES_PROVIDERS }),
  createdAt: createdAt(),
});

export const watchFolders = sqliteTable("watch_folders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  path: text("path").notNull(),
  profileId: integer("profile_id").references(() => profiles.id, { onDelete: "set null" }),
  /** Replaced by `targets` (migration 0003), kept so older rows read. */
  targetRoot: text("target_root")
    .notNull()
    .$default(() => ""),
  targets: text("targets_json", { mode: "json" }).$type<Targets>().notNull().default({}),
  options: text("options_json", { mode: "json" }).$type<WatchOptions>().notNull().default({}),
  /** Matches at or above this go through without a click; null = always review. */
  autoThreshold: real("auto_threshold").default(0.9),
  stableSeconds: integer("stable_seconds").notNull().default(30),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastEventAt: integer("last_event_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
});

export type JobConfig = {
  mode: "media" | "rules" | "both";
  preset?: string;
  template?: { movie?: string; episode?: string };
  rules?: Rule[];
  action: Action;
  conflictPolicy: ConflictPolicy;
  /** One folder for every file (chosen in the workbench, or the rule-mode target); wins over `targets`. */
  targetRoot?: string;
  /** Library folders by kind for media mode, resolved when the job is created. */
  targets?: { movie?: string; series?: string };
  /** The formats `template` came from (ids), for showing which one is in use. */
  formats?: { movie?: string; series?: string };
  language?: string;
  order?: "aired" | "dvd" | "absolute";
  /** Series source; unset = the setting. */
  provider?: SeriesProvider;
  autoThreshold?: number;
  /** Watch folders set to "Immer prüfen": nothing runs without approval. */
  alwaysReview?: boolean;
  recursive?: boolean;
};

/** manual: workbench; watch: a watch folder; hook: a download client via POST /api/jobs. */
export const JOB_KINDS = ["manual", "watch", "hook"] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export const JOB_STATUSES = ["pending", "scanning", "matching", "ready", "executing", "done", "failed", "cancelled", "undone"] as const;

export const jobs = sqliteTable(
  "jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind", { enum: JOB_KINDS }).notNull().default("manual"),
    profileId: integer("profile_id").references(() => profiles.id, { onDelete: "set null" }),
    watchFolderId: integer("watch_folder_id").references(() => watchFolders.id, { onDelete: "set null" }),
    status: text("status", { enum: JOB_STATUSES }).notNull().default("pending"),
    sourcePaths: text("source_paths", { mode: "json" }).$type<string[]>().notNull(),
    config: text("config_json", { mode: "json" }).$type<JobConfig>().notNull(),
    progressDone: integer("progress_done").notNull().default(0),
    progressTotal: integer("progress_total").notNull().default(0),
    error: text("error"),
    createdAt: createdAt(),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("jobs_created_idx").on(t.createdAt)],
);

export const ITEM_STATES = ["parsed", "matched", "needs_review", "ready", "done", "skipped", "failed", "undone"] as const;

export const jobItems = sqliteTable(
  "job_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    jobId: integer("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    sourcePath: text("source_path").notNull(),
    size: integer("size").notNull().default(0),
    parsedJson: text("parsed_json", { mode: "json" }).$type<Parsed>(),
    matchJson: text("match_json", { mode: "json" }).$type<MatchResult | null>(),
    confidence: real("confidence").notNull().default(0),
    targetPath: text("target_path"),
    /** Target set by hand in the UI; wins over the template. */
    overrideTarget: text("override_target"),
    excluded: integer("excluded", { mode: "boolean" }).notNull().default(false),
    /** Approved by the user: stays ready when the preview is recomputed. */
    approved: integer("approved", { mode: "boolean" }).notNull().default(false),
    state: text("state", { enum: ITEM_STATES }).notNull().default("parsed"),
    reasons: text("reasons_json", { mode: "json" }).$type<string[]>().notNull().default([]),
    companions: text("companions_json", { mode: "json" }).$type<{ from: string; to: string; suffix?: string }[]>().notNull().default([]),
    conflict: text("conflict"),
    error: text("error"),
  },
  (t) => [
    index("job_items_job_idx").on(t.jobId, t.state),
    // Catch-up of watch folders (knownSourcePaths) and keep-better (findDoneItemByTarget).
    index("job_items_source_idx").on(t.sourcePath),
    index("job_items_target_idx").on(t.targetPath),
  ],
);

/** History, basis for undo. One row per file touched, companions included. */
export const operations = sqliteTable(
  "operations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    jobItemId: integer("job_item_id").references(() => jobItems.id, { onDelete: "set null" }),
    jobId: integer("job_id").references(() => jobs.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    fromPath: text("from_path").notNull(),
    toPath: text("to_path").notNull(),
    size: integer("size").notNull(),
    inode: integer("inode").notNull(),
    backupPath: text("backup_path"),
    createdDirs: text("created_dirs_json", { mode: "json" }).$type<string[]>().notNull().default([]),
    executedAt: integer("executed_at", { mode: "timestamp_ms" }).notNull().default(now),
    undoneAt: integer("undone_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("operations_executed_idx").on(t.executedAt),
    index("operations_job_idx").on(t.jobId),
    // Nearly every history query asks for "not undone".
    index("operations_undone_idx").on(t.undoneAt),
  ],
);

/** Uncertain matches waiting for approval. */
export const inbox = sqliteTable(
  "inbox",
  {
    jobItemId: integer("job_item_id")
      .primaryKey()
      .references(() => jobItems.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("inbox_created_idx").on(t.createdAt)],
);

/** Learned manual decisions. */
export const matchOverrides = sqliteTable("match_overrides", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  pattern: text("pattern").notNull(),
  provider: text("provider").notNull(),
  externalId: text("external_id").notNull(),
  seasonOffset: integer("season_offset").notNull().default(0),
  createdAt: createdAt(),
});

export const providerCache = sqliteTable(
  "provider_cache",
  {
    provider: text("provider").notNull(),
    key: text("key").notNull(),
    responseJson: text("response_json").notNull(),
    fetchedAt: integer("fetched_at", { mode: "timestamp_ms" }).notNull(),
    ttl: integer("ttl").notNull(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.key] })],
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json", { mode: "json" }).$type<unknown>().notNull(),
});
