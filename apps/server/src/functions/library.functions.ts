import * as fs from "node:fs/promises";
import * as path from "node:path";
import { CONFLICT_POLICIES, isInside, resolveInRoots, VIDEO_EXTENSIONS, WATCH_ACTIONS } from "@namarr/core";
import { msg } from "@namarr/core/i18n";
import {
  allowedRoots,
  createWatchFolder,
  dashboardStats,
  deleteWatchFolder,
  FOLDER_KINDS,
  FORMAT_KINDS,
  type FolderKind,
  findFormat,
  getItem,
  getSettings,
  type LibraryFolder,
  listInbox,
  listJobs,
  listOperations,
  listWatchFolders,
  MOVIE_PROVIDERS,
  SERIES_PROVIDERS,
  type Settings,
  setSettings,
  type Targets,
  updateWatchFolder,
} from "@namarr/db";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { libraryFormat } from "~/server/infer.server";
import { authed } from "./middleware";

const id = z.number().int().positive();

// ---------- dashboard ----------

export const getDashboard = createServerFn({ method: "GET" })
  .middleware([authed])
  .handler(async ({ context: { rt } }) => {
    const inbox = listInbox(rt.db, 50);
    const folders = listWatchFolders(rt.db);
    const jobs = listJobs(rt.db, 5);
    return {
      stats: dashboardStats(rt.db),
      inbox: inbox.slice(0, 4),
      inboxTotal: inbox.length,
      watchFolders: folders.map((f) => ({
        ...f,
        inboxCount: inbox.filter((i) => i.item.sourcePath.startsWith(f.path + path.sep)).length,
      })),
      jobs,
      /** No folders yet: namarr can neither find files nor put them anywhere. */
      noFolders: !getSettings(rt.db).folders.length,
      server: { host: `${rt.env.host}:${rt.env.port}`, demo: rt.env.demo },
    };
  });

// ---------- folders ----------

const targetsSchema = z.object({ movie: z.string().optional(), series: z.string().optional(), other: z.string().optional() });

/** A profile's or watch folder's own targets must lie inside the allowed folders. */
async function resolveTargetsIn(targets: Targets, roots: string[]): Promise<Targets> {
  const out: Targets = {};
  for (const key of ["movie", "series", "other"] as const) if (targets[key]) out[key] = await resolveInRoots(targets[key]!, roots);
  return out;
}

/** Folders without a kind carry no default; of each kind one default at most (the first marked). */
export function normalizeFolders(folders: LibraryFolder[]): LibraryFolder[] {
  const seen = new Set<FolderKind>();
  return folders.map(({ default: isDefault, ...f }) => {
    const keep = isDefault && f.kind !== "folder" && !seen.has(f.kind);
    if (keep) seen.add(f.kind);
    return keep ? { ...f, default: true } : f;
  });
}

// ---------- folder browser ----------

export const browseFolder = createServerFn({ method: "GET" })
  .middleware([authed])
  // scope "all": the whole file system, folders only, for choosing the folders themselves (settings).
  .validator(z.object({ path: z.string().optional(), scope: z.enum(["allowed", "all"]).optional() }))
  .handler(async ({ data, context: { rt } }) => {
    const all = data.scope === "all";
    const roots = all ? ["/"] : allowedRoots(getSettings(rt.db));
    if (!data.path && !all)
      return { path: null, parent: null, roots, entries: [] as { name: string; path: string; dir: boolean; video: boolean }[] };
    const dir = all ? path.resolve(data.path ?? "/") : await resolveInRoots(data.path!, roots);
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    const entries = dirents
      .filter((d) => !d.name.startsWith(".") && d.name !== "@eaDir" && (!all || d.isDirectory()))
      .map((d) => ({
        name: d.name,
        path: path.join(dir, d.name),
        dir: d.isDirectory(),
        video: VIDEO_EXTENSIONS.includes(path.extname(d.name).slice(1).toLowerCase()),
      }))
      .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name, "de", { numeric: true }));
    const atRoot = roots.some((r) => path.resolve(r) === dir);
    return { path: dir, parent: atRoot ? null : path.dirname(dir), roots, entries };
  });

// ---------- inbox ----------

export const getInbox = createServerFn({ method: "GET" })
  .middleware([authed])
  .handler(async ({ context: { rt } }) => listInbox(rt.db, 500));

/** Approve: mark ready and execute with the job's action. */
export const approveInbox = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ itemIds: z.array(id).optional(), minConfidence: z.number().min(0).max(1).optional() }))
  .handler(async ({ data, context: { rt } }) => {
    const inbox = listInbox(rt.db, 10_000);
    const chosen = inbox.filter(
      (e) =>
        (data.itemIds ? data.itemIds.includes(e.item.id) : true) &&
        (data.minConfidence === undefined || e.item.confidence >= data.minConfidence),
    );
    const byJob = await rt.jobs.approve(chosen.map((e) => e.item.id));
    for (const [jobId, itemIds] of byJob) if (itemIds.length) await rt.jobs.executeNow(jobId, { itemIds });
    const approved = [...byJob.values()].flat();
    return { approved: approved.length, done: approved.filter((i) => getItem(rt.db, i)?.state === "done").length };
  });

// ---------- history ----------

export const listHistory = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(
    z.object({ search: z.string().max(200).optional(), before: z.number().int().optional(), includeUndone: z.boolean().optional() }),
  )
  .handler(async ({ data, context: { rt } }) => listOperations(rt.db, { ...data, limit: 200 }));

// ---------- naming formats ----------

/** Built-in formats (with the presets) are fixed; own ones are saved as a whole with the defaults. */
export const saveFormats = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(
    z.object({
      formats: z.array(
        z.object({
          id: z.string().regex(/^f-[a-z0-9]+$/),
          name: z.string().trim().min(1).max(100),
          kind: z.enum(FORMAT_KINDS),
          template: z.string().trim().min(1).max(500),
        }),
      ),
      defaultFormats: z.object({ movie: z.string().optional(), series: z.string().optional() }),
    }),
  )
  .handler(async ({ data, context: { rt } }) => {
    const formats = data.formats.map((f) => ({ id: f.id, name: f.name, kind: f.kind, template: f.template }));
    if (new Set(formats.map((f) => f.id)).size !== formats.length) throw new Error(msg("formats_error_duplicate"));
    // A format a watch folder renames with cannot go: the folder would silently use another one.
    const gone = (fid?: string) => Boolean(fid?.startsWith("f-")) && !formats.some((f) => f.id === fid);
    const users = listWatchFolders(rt.db).filter((w) => gone(w.options.formats?.movie) || gone(w.options.formats?.series));
    if (users.length) throw new Error(msg("formats_error_inUse", { users: users.map((w) => w.name).join(", ") }));
    // A default that no longer exists falls back to Jellyfin.
    const defaultFormats = Object.fromEntries(
      FORMAT_KINDS.flatMap((kind) => (findFormat({ formats }, kind, data.defaultFormats[kind]) ? [[kind, data.defaultFormats[kind]]] : [])),
    );
    setSettings(rt.db, { formats, defaultFormats });
    return { ok: true };
  });

/** The format of an existing library, from one of its files (checked against more of them). */
export const inferLibraryFormat = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ path: z.string().min(1).max(4096) }))
  .handler(async ({ data, context: { rt } }) => libraryFormat(rt, data.path));

// ---------- watch folders ----------

export const getWatchFolders = createServerFn({ method: "GET" })
  .middleware([authed])
  .handler(async ({ context: { rt } }) => listWatchFolders(rt.db));

export const saveWatchFolder = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(
    z.object({
      id: id.optional(),
      name: z.string().min(1).max(100),
      path: z.string().min(1),
      targets: targetsSchema,
      options: z.object({
        formats: z.object({ movie: z.string().optional(), series: z.string().optional() }).optional(),
        provider: z.enum(SERIES_PROVIDERS).optional(),
        action: z.enum(WATCH_ACTIONS).optional(),
        conflictPolicy: z.enum(CONFLICT_POLICIES).optional(),
      }),
      autoThreshold: z.number().min(0).max(1).nullable(),
      stableSeconds: z.number().int().min(1).max(3600),
      enabled: z.boolean(),
    }),
  )
  .handler(async ({ data: { id: folderId, ...values }, context: { rt } }) => {
    const roots = allowedRoots(getSettings(rt.db));
    values.path = await resolveInRoots(values.path, roots);
    values.targets = await resolveTargetsIn(values.targets, roots);
    const saved = folderId ? updateWatchFolder(rt.db, folderId, values) : createWatchFolder(rt.db, values);
    await rt.watch.reload();
    return saved;
  });

export const removeWatchFolder = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ id }))
  .handler(async ({ data, context: { rt } }) => {
    deleteWatchFolder(rt.db, data.id);
    await rt.watch.reload();
    return { ok: true };
  });

// ---------- settings ----------

const mask = (key?: string) => (key ? `${key.slice(0, 4)}…${key.slice(-4)}` : undefined);

export const getSettingsFn = createServerFn({ method: "GET" })
  .middleware([authed])
  .handler(async ({ context: { rt } }) => {
    const s = getSettings(rt.db);
    return {
      ...s,
      tmdbApiKey: mask(s.tmdbApiKey),
      hasTmdbKey: Boolean(s.tmdbApiKey),
      tvdbApiKey: mask(s.tvdbApiKey),
      hasTvdbKey: Boolean(s.tvdbApiKey),
      tvdbPin: s.tvdbPin ? "••••" : undefined,
      demo: rt.env.demo,
    };
  });

export const saveSettings = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(
    z.object({
      tmdbApiKey: z.string().max(500).optional(),
      tvdbApiKey: z.string().max(500).optional(),
      tvdbPin: z.string().max(100).optional(),
      anidbClient: z
        .string()
        .max(50)
        .regex(/^[a-z0-9]*$/i, msg("settings_error_anidbClient"))
        .optional(),
      anidbClientVersion: z.string().max(10).optional(),
      seriesProvider: z.enum(SERIES_PROVIDERS).optional(),
      movieProvider: z.enum(MOVIE_PROVIDERS).optional(),
      language: z.string().max(20).optional(),
      folders: z
        .array(
          z.object({
            path: z.string().min(1),
            name: z.string().min(1).max(100),
            kind: z.enum(FOLDER_KINDS),
            default: z.boolean().optional(),
          }),
        )
        .optional(),
      notifications: z
        .array(z.object({ kind: z.enum(["ntfy", "gotify", "telegram", "discord", "webhook"]), url: z.url(), token: z.string().optional() }))
        .optional(),
      libraryRefresh: z.array(z.object({ kind: z.enum(["jellyfin", "plex", "emby"]), url: z.url(), token: z.string() })).optional(),
    }),
  )
  .handler(async ({ data, context: { rt } }) => {
    if (data.folders) {
      for (const f of data.folders) {
        if (!path.isAbsolute(f.path)) throw new Error(msg("settings_error_rootNotAbsolute", { path: f.path }));
        const st = await fs.stat(f.path).catch(() => undefined);
        if (!st?.isDirectory()) throw new Error(msg("settings_error_rootMissing", { path: f.path }));
      }
      data.folders = normalizeFolders(data.folders);
      // A folder still used by a watch folder cannot go: it would point nowhere.
      const roots = allowedRoots({ folders: data.folders });
      const outside = (p?: string) => Boolean(p) && !roots.some((r) => isInside(path.resolve(p!), path.resolve(r)));
      const users = [
        ...listWatchFolders(rt.db).flatMap((w) =>
          [w.path, ...Object.values(w.targets)].filter(outside).map((t) => ({ name: w.name, path: t! })),
        ),
      ];
      if (users.length) {
        const first = users[0]!;
        throw new Error(msg("settings_error_folderInUse", { path: first.path, users: [...new Set(users.map((u) => u.name))].join(", ") }));
      }
    }
    // An empty secret field keeps what is stored; "-" removes it.
    const stored = getSettings(rt.db);
    const secret = (key: "tmdbApiKey" | "tvdbApiKey" | "tvdbPin") => (data[key] === "-" ? undefined : data[key] || stored[key]);
    const patch: Partial<Settings> = {
      ...data,
      tmdbApiKey: secret("tmdbApiKey"),
      tvdbApiKey: secret("tvdbApiKey"),
      tvdbPin: secret("tvdbPin"),
      anidbClient: data.anidbClient === undefined ? stored.anidbClient : data.anidbClient || undefined,
      anidbClientVersion: data.anidbClientVersion === undefined ? stored.anidbClientVersion : data.anidbClientVersion || undefined,
    };
    setSettings(rt.db, patch);
    return { ok: true };
  });

// ---------- shell ----------

export const getShellInfo = createServerFn({ method: "GET" })
  .middleware([authed])
  .handler(async ({ context: { rt } }) => ({
    inboxOpen: dashboardStats(rt.db).inboxOpen,
    host: `${rt.env.host}:${rt.env.port}`,
    demo: rt.env.demo,
    authRequired: Boolean(rt.env.token || rt.env.authHeader),
  }));
