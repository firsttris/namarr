import * as fs from "node:fs/promises";
import * as path from "node:path";
import { resolveInRoots, VIDEO_EXTENSIONS } from "@namarr/core";
import { msg } from "@namarr/core/i18n";
import { allowedRoots, getItem, getJob, getSettings, listInbox, resolveFormats, resolveTargets } from "@namarr/db";
import type { z } from "zod";
import type { approveInboxInput, browseInput, createJobInput, executeJobInput, searchInput, undoInput } from "~/lib/inputs";
import { NO_PROVIDER } from "./jobs.server.ts";
import { hiddenInBrowser } from "./paths.server.ts";
import type { Runtime } from "./runtime.server.ts";

/**
 * What the workbench's server functions and the MCP tools both do. The inputs are validated by
 * the caller (`~/lib/inputs`); here they are only carried out.
 */

/** A manual job: scan and match are queued, the preview follows. Test mode unless `action` says otherwise. */
export async function createManualJob(rt: Runtime, data: z.infer<typeof createJobInput>) {
  const settings = getSettings(rt.db);
  const mode = data.mode ?? "media";
  const targets = resolveTargets(settings);
  const formats = resolveFormats(settings, data.formats);
  return rt.jobs.create({
    paths: data.paths,
    config: {
      mode,
      template: {
        movie: data.template?.movie ?? formats.movie.template,
        episode: data.template?.episode ?? formats.series.template,
      },
      formats: { movie: formats.movie.id, series: formats.series.id },
      rules: data.rules ?? [],
      // Test mode is the default: nothing happens without a second, explicit step.
      action: data.action ?? "test",
      conflictPolicy: data.conflictPolicy ?? "skip",
      // Rule mode renames in place unless a folder is chosen; media sorts by kind into the library.
      targetRoot: data.targetRoot,
      targets: data.targets === null ? undefined : (data.targets ?? { movie: targets.movie, series: targets.series }),
      order: data.order,
      provider: data.provider,
      language: data.language,
      recursive: data.recursive,
    },
  });
}

/** Queues the execution; it runs in the worker, progress arrives over SSE. Resolves when it is done. */
export function executeJob(rt: Runtime, data: z.infer<typeof executeJobInput>): Promise<unknown> {
  return rt.jobs.executeNow(data.jobId, { action: data.action, conflictPolicy: data.conflictPolicy, itemIds: data.itemIds });
}

export function undo(rt: Runtime, data: z.infer<typeof undoInput>) {
  if (!data.jobId && !data.itemIds && !data.operationIds && !data.since) throw new Error(msg("history_error_nothingToUndo"));
  return rt.jobs.undo({ ...data, since: data.since ? new Date(data.since) : undefined });
}

export function searchMetadata(rt: Runtime, data: z.infer<typeof searchInput>) {
  // The job's series source, so the picker offers what the job matches against.
  const provider = rt.provider({ series: data.jobId ? getJob(rt.db, data.jobId)?.config.provider : undefined });
  if (!provider) throw new Error(NO_PROVIDER);
  return data.kind === "movie" ? provider.searchMovie(data.q, { year: data.year }) : provider.searchSeries(data.q, { year: data.year });
}

export async function browseFolder(rt: Runtime, data: z.infer<typeof browseInput>) {
  const all = data.scope === "all";
  const roots = all ? ["/"] : allowedRoots(getSettings(rt.db));
  if (!data.path && !all)
    return { path: null, parent: null, roots, entries: [] as { name: string; path: string; dir: boolean; video: boolean }[] };
  const dir = all ? path.resolve(data.path ?? "/") : await resolveInRoots(data.path!, roots);
  const dirents = await fs.readdir(dir, { withFileTypes: true });
  const entries = dirents
    .filter(
      (d) =>
        !d.name.startsWith(".") &&
        d.name !== "@eaDir" &&
        (!all || (d.isDirectory() && !hiddenInBrowser(path.join(dir, d.name), rt.env.configDir))),
    )
    .map((d) => ({
      name: d.name,
      path: path.join(dir, d.name),
      dir: d.isDirectory(),
      video: VIDEO_EXTENSIONS.includes(path.extname(d.name).slice(1).toLowerCase()),
    }))
    .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name, "de", { numeric: true }));
  const atRoot = roots.some((r) => path.resolve(r) === dir);
  return { path: dir, parent: atRoot ? null : path.dirname(dir), roots, entries };
}

/** Approve: mark ready and execute with the job's action. */
export async function approveInbox(rt: Runtime, data: z.infer<typeof approveInboxInput>) {
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
}
