import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

const now = sql`(unixepoch() * 1000)`;
const createdAt = () => integer("created_at", { mode: "timestamp_ms" }).notNull().default(now);

/** Reusable rename setups. */
export const profiles = sqliteTable("profiles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  mode: text("mode", { enum: ["media", "rules", "both"] }).notNull().default("media"),
  preset: text("preset").notNull().default("jellyfin"),
  /** `{ movie?: string; episode?: string }`; empty uses the preset. */
  template: text("template", { mode: "json" }).$type<{ movie?: string; episode?: string }>().notNull().default({}),
  rulesJson: text("rules_json", { mode: "json" }).$type<unknown[]>().notNull().default([]),
  action: text("action").notNull().default("test"),
  conflictPolicy: text("conflict_policy").notNull().default("skip"),
  targetRoot: text("target_root"),
  createdAt: createdAt(),
});

export const watchFolders = sqliteTable("watch_folders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  path: text("path").notNull(),
  profileId: integer("profile_id").references(() => profiles.id, { onDelete: "set null" }),
  targetRoot: text("target_root").notNull(),
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
  rules?: unknown[];
  action: string;
  conflictPolicy: string;
  targetRoot?: string;
  language?: string;
  order?: "aired" | "dvd" | "absolute";
  autoThreshold?: number;
  recursive?: boolean;
};

export const JOB_STATUSES = ["pending", "scanning", "matching", "ready", "executing", "done", "failed", "cancelled", "undone"] as const;

export const jobs = sqliteTable(
  "jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind", { enum: ["manual", "watch"] }).notNull().default("manual"),
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
    parsedJson: text("parsed_json", { mode: "json" }).$type<unknown>(),
    matchJson: text("match_json", { mode: "json" }).$type<unknown>(),
    confidence: real("confidence").notNull().default(0),
    targetPath: text("target_path"),
    /** Target set by hand in the UI; wins over the template. */
    overrideTarget: text("override_target"),
    excluded: integer("excluded", { mode: "boolean" }).notNull().default(false),
    state: text("state", { enum: ITEM_STATES }).notNull().default("parsed"),
    reasons: text("reasons_json", { mode: "json" }).$type<string[]>().notNull().default([]),
    companions: text("companions_json", { mode: "json" }).$type<{ from: string; to: string; suffix?: string }[]>().notNull().default([]),
    conflict: text("conflict"),
    error: text("error"),
  },
  (t) => [index("job_items_job_idx").on(t.jobId, t.state)],
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
  (t) => [index("operations_executed_idx").on(t.executedAt), index("operations_job_idx").on(t.jobId)],
);

/** Uncertain matches waiting for approval. */
export const inbox = sqliteTable("inbox", {
  jobItemId: integer("job_item_id")
    .primaryKey()
    .references(() => jobItems.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  createdAt: createdAt(),
});

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
