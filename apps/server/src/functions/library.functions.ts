import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ACTIONS, CONFLICT_POLICIES, resolveInRoots, VIDEO_EXTENSIONS } from "@namarr/core";
import { tr } from "@namarr/core/i18n";
import {
  createProfile,
  createWatchFolder,
  dashboardStats,
  deleteProfile,
  deleteWatchFolder,
  getItem,
  getSettings,
  listInbox,
  listJobs,
  listOperations,
  listProfiles,
  listWatchFolders,
  setSettings,
  updateProfile,
  updateWatchFolder,
} from "@namarr/db";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { rulesSchema, templateSchema } from "~/lib/schemas";
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
      server: { host: `${rt.env.host}:${rt.env.port}`, demo: rt.env.demo },
    };
  });

// ---------- folder browser ----------

export const browseFolder = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(z.object({ path: z.string().optional() }))
  .handler(async ({ data, context: { rt } }) => {
    const { roots } = getSettings(rt.db);
    if (!data.path)
      return { path: null, parent: null, roots, entries: [] as { name: string; path: string; dir: boolean; video: boolean }[] };
    const dir = await resolveInRoots(data.path, roots);
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    const entries = dirents
      .filter((d) => !d.name.startsWith(".") && d.name !== "@eaDir")
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

// ---------- profiles ----------

const profileInput = z.object({
  name: z.string().min(1).max(100),
  mode: z.enum(["media", "rules", "both"]),
  preset: z.string(),
  template: templateSchema,
  rulesJson: rulesSchema,
  action: z.enum(ACTIONS),
  conflictPolicy: z.enum(CONFLICT_POLICIES),
  targetRoot: z.string().nullable(),
});

export const getProfiles = createServerFn({ method: "GET" })
  .middleware([authed])
  .handler(async ({ context: { rt } }) => listProfiles(rt.db));

export const saveProfile = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(profileInput.extend({ id: id.optional() }))
  .handler(async ({ data: { id: profileId, ...values }, context: { rt } }) => {
    if (values.targetRoot) values.targetRoot = await resolveInRoots(values.targetRoot, getSettings(rt.db).roots);
    return profileId ? updateProfile(rt.db, profileId, values) : createProfile(rt.db, values);
  });

export const removeProfile = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ id }))
  .handler(async ({ data, context: { rt } }) => {
    deleteProfile(rt.db, data.id);
    return { ok: true };
  });

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
      targetRoot: z.string().min(1),
      profileId: id.nullable(),
      autoThreshold: z.number().min(0).max(1).nullable(),
      stableSeconds: z.number().int().min(1).max(3600),
      enabled: z.boolean(),
    }),
  )
  .handler(async ({ data: { id: folderId, ...values }, context: { rt } }) => {
    const { roots } = getSettings(rt.db);
    values.path = await resolveInRoots(values.path, roots);
    values.targetRoot = await resolveInRoots(values.targetRoot, roots);
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
    return { ...s, tmdbApiKey: mask(s.tmdbApiKey), hasTmdbKey: Boolean(s.tmdbApiKey), demo: rt.env.demo };
  });

export const saveSettings = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(
    z.object({
      tmdbApiKey: z.string().max(500).optional(),
      language: z.string().max(20).optional(),
      roots: z.array(z.string().min(1)).optional(),
      defaultTargetRoot: z.string().optional(),
      notifications: z
        .array(z.object({ kind: z.enum(["ntfy", "gotify", "telegram", "discord", "webhook"]), url: z.url(), token: z.string().optional() }))
        .optional(),
      libraryRefresh: z.array(z.object({ kind: z.enum(["jellyfin", "plex", "emby"]), url: z.url(), token: z.string() })).optional(),
    }),
  )
  .handler(async ({ data, context: { rt } }) => {
    if (data.roots) {
      for (const r of data.roots) {
        if (!path.isAbsolute(r)) throw new Error(tr(`Wurzelpfad muss absolut sein: ${r}`, `Root path must be absolute: ${r}`));
        const st = await fs.stat(r).catch(() => undefined);
        if (!st?.isDirectory()) throw new Error(tr(`Ordner existiert nicht: ${r}`, `Folder does not exist: ${r}`));
      }
    }
    // An empty key field keeps the stored key; "-" removes it.
    const patch = { ...data, tmdbApiKey: data.tmdbApiKey === "-" ? undefined : data.tmdbApiKey || getSettings(rt.db).tmdbApiKey };
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
