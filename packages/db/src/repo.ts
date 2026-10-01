import { and, asc, count, desc, eq, gt, gte, inArray, isNull, like, lt, or, type SQL, sql } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type * as schema from "./schema.ts";
import {
  inbox,
  ITEM_STATES,
  type JobConfig,
  jobItems,
  jobs,
  matchOverrides,
  operations,
  profiles,
  providerCache,
  settings,
  watchFolders,
} from "./schema.ts";

type AnyDb = BunSQLiteDatabase<typeof schema>;

export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
export type WatchFolder = typeof watchFolders.$inferSelect;
export type NewWatchFolder = typeof watchFolders.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type JobItem = typeof jobItems.$inferSelect;
export type NewJobItem = typeof jobItems.$inferInsert;
export type Operation = typeof operations.$inferSelect;
export type NewOperation = typeof operations.$inferInsert;
export type MatchOverrideRow = typeof matchOverrides.$inferSelect;
export type ItemStateName = (typeof ITEM_STATES)[number];

// ---------- settings ----------

export type Settings = {
  tmdbApiKey?: string;
  language: string;
  roots: string[];
  defaultTargetRoot?: string;
  notifications: { kind: "ntfy" | "gotify" | "telegram" | "discord" | "webhook"; url: string; token?: string }[];
  libraryRefresh: { kind: "jellyfin" | "plex" | "emby"; url: string; token: string }[];
};

export const DEFAULT_SETTINGS: Settings = { language: "de-DE", roots: [], notifications: [], libraryRefresh: [] };

export function getSettings(db: AnyDb): Settings {
  const rows = db.select().from(settings).all();
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.valueJson]));
  return { ...DEFAULT_SETTINGS, ...stored } as Settings;
}

export function setSettings(db: AnyDb, patch: Partial<Settings>): Settings {
  db.transaction((tx) => {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) {
        tx.delete(settings).where(eq(settings.key, key)).run();
        continue;
      }
      tx.insert(settings)
        .values({ key, valueJson: value })
        .onConflictDoUpdate({ target: settings.key, set: { valueJson: value } })
        .run();
    }
  });
  return getSettings(db);
}

// ---------- profiles ----------

export const listProfiles = (db: AnyDb) => db.select().from(profiles).orderBy(asc(profiles.name)).all();
export const getProfile = (db: AnyDb, id: number) => db.select().from(profiles).where(eq(profiles.id, id)).get();
export const createProfile = (db: AnyDb, values: NewProfile) => db.insert(profiles).values(values).returning().get();
export const updateProfile = (db: AnyDb, id: number, values: Partial<NewProfile>) =>
  db.update(profiles).set(values).where(eq(profiles.id, id)).returning().get();
export const deleteProfile = (db: AnyDb, id: number) => db.delete(profiles).where(eq(profiles.id, id)).run();

// ---------- watch folders ----------

export const listWatchFolders = (db: AnyDb) => db.select().from(watchFolders).orderBy(asc(watchFolders.name)).all();
export const getWatchFolder = (db: AnyDb, id: number) => db.select().from(watchFolders).where(eq(watchFolders.id, id)).get();
export const createWatchFolder = (db: AnyDb, values: NewWatchFolder) => db.insert(watchFolders).values(values).returning().get();
export const updateWatchFolder = (db: AnyDb, id: number, values: Partial<NewWatchFolder>) =>
  db.update(watchFolders).set(values).where(eq(watchFolders.id, id)).returning().get();
export const deleteWatchFolder = (db: AnyDb, id: number) => db.delete(watchFolders).where(eq(watchFolders.id, id)).run();

// ---------- jobs ----------

export function createJob(
  db: AnyDb,
  values: { kind?: "manual" | "watch"; profileId?: number | null; watchFolderId?: number | null; sourcePaths: string[]; config: JobConfig },
): Job {
  return db.insert(jobs).values(values).returning().get();
}

export const getJob = (db: AnyDb, id: number) => db.select().from(jobs).where(eq(jobs.id, id)).get();

export function listJobs(db: AnyDb, limit = 20): Job[] {
  return db.select().from(jobs).orderBy(desc(jobs.id)).limit(limit).all();
}

export function updateJob(db: AnyDb, id: number, values: Partial<typeof jobs.$inferInsert>): Job | undefined {
  return db.update(jobs).set(values).where(eq(jobs.id, id)).returning().get();
}

/** Jobs a crash left mid-flight. On startup they are marked failed; their items stay untouched. */
export function failInterruptedJobs(db: AnyDb): number {
  const res = db
    .update(jobs)
    .set({ status: "failed", error: "Server wurde während des Jobs beendet", finishedAt: new Date() })
    .where(inArray(jobs.status, ["pending", "scanning", "matching", "executing"]))
    .returning({ id: jobs.id })
    .all();
  return res.length;
}

// ---------- job items ----------

export function insertItems(db: AnyDb, items: NewJobItem[]): JobItem[] {
  if (!items.length) return [];
  return db.transaction((tx) => {
    const out: JobItem[] = [];
    // SQLite caps bound variables; insert in chunks.
    for (let i = 0; i < items.length; i += 200) {
      out.push(...tx.insert(jobItems).values(items.slice(i, i + 200)).returning().all());
    }
    return out;
  });
}

export const getItem = (db: AnyDb, id: number) => db.select().from(jobItems).where(eq(jobItems.id, id)).get();

export type ItemFilter = { states?: ItemStateName[]; search?: string };

/** Cursor paging by id: stable while the job keeps changing. */
export function listItems(
  db: AnyDb,
  jobId: number,
  options: { filter?: ItemFilter; cursor?: number; limit?: number } = {},
): { items: JobItem[]; nextCursor?: number } {
  const limit = Math.min(options.limit ?? 500, 5000);
  const where: SQL[] = [eq(jobItems.jobId, jobId)];
  if (options.cursor) where.push(gt(jobItems.id, options.cursor));
  if (options.filter?.states?.length) where.push(inArray(jobItems.state, options.filter.states));
  if (options.filter?.search) {
    const q = `%${options.filter.search.replace(/[%_]/g, "\\$&")}%`;
    where.push(or(sql`${jobItems.sourcePath} LIKE ${q} ESCAPE '\\'`, sql`${jobItems.targetPath} LIKE ${q} ESCAPE '\\'`)!);
  }
  const rows = db
    .select()
    .from(jobItems)
    .where(and(...where))
    .orderBy(asc(jobItems.id))
    .limit(limit + 1)
    .all();
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? items.at(-1)!.id : undefined };
}

export function allItems(db: AnyDb, jobId: number): JobItem[] {
  return db.select().from(jobItems).where(eq(jobItems.jobId, jobId)).orderBy(asc(jobItems.id)).all();
}

export function updateItem(db: AnyDb, id: number, values: Partial<NewJobItem>): JobItem | undefined {
  return db.update(jobItems).set(values).where(eq(jobItems.id, id)).returning().get();
}

export function countItemsByState(db: AnyDb, jobId: number): Record<ItemStateName, number> {
  const rows = db
    .select({ state: jobItems.state, n: count() })
    .from(jobItems)
    .where(eq(jobItems.jobId, jobId))
    .groupBy(jobItems.state)
    .all();
  const out = Object.fromEntries(ITEM_STATES.map((s) => [s, 0])) as Record<ItemStateName, number>;
  for (const r of rows) out[r.state] = r.n;
  return out;
}

// ---------- operations (history) ----------

export const insertOperation = (db: AnyDb, values: NewOperation) => db.insert(operations).values(values).returning().get();

export function listOperations(
  db: AnyDb,
  options: { jobId?: number; search?: string; before?: number; limit?: number; includeUndone?: boolean; until?: Date } = {},
): Operation[] {
  const where: SQL[] = [];
  if (options.jobId) where.push(eq(operations.jobId, options.jobId));
  if (options.before) where.push(lt(operations.id, options.before));
  if (!options.includeUndone) where.push(isNull(operations.undoneAt));
  if (options.until) where.push(gte(operations.executedAt, options.until));
  if (options.search) {
    const q = `%${options.search}%`;
    where.push(or(like(operations.fromPath, q), like(operations.toPath, q))!);
  }
  return db
    .select()
    .from(operations)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(operations.id))
    .limit(options.limit ?? 100)
    .all();
}

export function markUndone(db: AnyDb, ids: number[]): void {
  if (!ids.length) return;
  db.update(operations).set({ undoneAt: new Date() }).where(inArray(operations.id, ids)).run();
}

// ---------- inbox ----------

export function addToInbox(db: AnyDb, jobItemId: number, reason: string): void {
  db.insert(inbox).values({ jobItemId, reason }).onConflictDoUpdate({ target: inbox.jobItemId, set: { reason } }).run();
}

export const removeFromInbox = (db: AnyDb, jobItemId: number) => db.delete(inbox).where(eq(inbox.jobItemId, jobItemId)).run();

export function listInbox(db: AnyDb, limit = 100) {
  return db
    .select({ reason: inbox.reason, createdAt: inbox.createdAt, item: jobItems })
    .from(inbox)
    .innerJoin(jobItems, eq(inbox.jobItemId, jobItems.id))
    .orderBy(desc(inbox.createdAt), desc(inbox.jobItemId))
    .limit(limit)
    .all();
}

// ---------- overrides ----------

export const listOverrides = (db: AnyDb) => db.select().from(matchOverrides).orderBy(desc(matchOverrides.id)).all();

export function saveOverride(db: AnyDb, values: { pattern: string; provider: string; externalId: string; seasonOffset?: number }) {
  const existing = db
    .select()
    .from(matchOverrides)
    .where(and(eq(matchOverrides.pattern, values.pattern), eq(matchOverrides.provider, values.provider)))
    .get();
  if (existing) {
    return db.update(matchOverrides).set(values).where(eq(matchOverrides.id, existing.id)).returning().get();
  }
  return db.insert(matchOverrides).values(values).returning().get();
}

// ---------- provider cache ----------

/** `ProviderCache` backed by SQLite, so lookups survive restarts. */
export class SqliteProviderCache {
  constructor(
    private readonly db: AnyDb,
    private readonly now: () => number = Date.now,
  ) {}

  async get(provider: string, key: string): Promise<unknown | undefined> {
    const row = this.db
      .select()
      .from(providerCache)
      .where(and(eq(providerCache.provider, provider), eq(providerCache.key, key)))
      .get();
    if (!row) return undefined;
    if (row.fetchedAt.getTime() + row.ttl * 1000 <= this.now()) return undefined;
    return JSON.parse(row.responseJson);
  }

  async set(provider: string, key: string, value: unknown, ttlSeconds: number): Promise<void> {
    const values = { provider, key, responseJson: JSON.stringify(value), fetchedAt: new Date(this.now()), ttl: ttlSeconds };
    this.db
      .insert(providerCache)
      .values(values)
      .onConflictDoUpdate({ target: [providerCache.provider, providerCache.key], set: values })
      .run();
  }

  /** Drops expired entries. */
  prune(): number {
    return this.db
      .delete(providerCache)
      .where(sql`${providerCache.fetchedAt} + ${providerCache.ttl} * 1000 <= ${this.now()}`)
      .returning({ key: providerCache.key })
      .all().length;
  }
}

// ---------- dashboard ----------

export type DashboardStats = { renamedToday: number; inboxOpen: number; autoRate: number | null; undoable: number };

export function dashboardStats(db: AnyDb, now = new Date()): DashboardStats {
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const renamedToday =
    db
      .select({ n: count() })
      .from(operations)
      .where(and(gte(operations.executedAt, startOfDay), isNull(operations.undoneAt)))
      .get()?.n ?? 0;
  const inboxOpen = db.select({ n: count() }).from(inbox).get()?.n ?? 0;
  const undoable = db.select({ n: count() }).from(operations).where(isNull(operations.undoneAt)).get()?.n ?? 0;
  const recent = db
    .select({ auto: sql<number>`sum(case when ${jobItems.confidence} >= 0.9 then 1 else 0 end)`, n: count() })
    .from(jobItems)
    .innerJoin(jobs, eq(jobItems.jobId, jobs.id))
    .where(and(gte(jobs.createdAt, weekAgo), inArray(jobItems.state, ["done", "ready", "needs_review"])))
    .get();
  const autoRate = recent && recent.n > 0 ? (recent.auto ?? 0) / recent.n : null;
  return { renamedToday, inboxOpen, autoRate, undoable };
}
