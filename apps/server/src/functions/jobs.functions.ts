import { ACTIONS, CONFLICT_POLICIES } from "@namarr/core";
import { msg } from "@namarr/core/i18n";
import { countItemsByState, getJob as findJob, getProfile, getSettings, ITEM_STATES, listItems, SERIES_PROVIDERS } from "@namarr/db";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { rulesSchema, templateSchema } from "~/lib/schemas";
import { JOB_NOT_FOUND, NO_PROVIDER } from "~/server/jobs.server";
import { authed } from "./middleware";

const id = z.number().int().positive();
const mode = z.enum(["media", "rules", "both"]);
const template = templateSchema;
const rules = rulesSchema;

export const createJob = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(
    z.object({
      paths: z.array(z.string().min(1)).min(1).max(100),
      profileId: id.optional(),
      mode: mode.optional(),
      preset: z.string().optional(),
      template: template.optional(),
      rules: rules.optional(),
      action: z.enum(ACTIONS).optional(),
      conflictPolicy: z.enum(CONFLICT_POLICIES).optional(),
      targetRoot: z.string().optional(),
      order: z.enum(["aired", "dvd", "absolute"]).optional(),
      provider: z.enum(SERIES_PROVIDERS).optional(),
      language: z.string().optional(),
      recursive: z.boolean().optional(),
    }),
  )
  .handler(async ({ data, context: { rt } }) => {
    const profile = data.profileId ? getProfile(rt.db, data.profileId) : undefined;
    const settings = getSettings(rt.db);
    const mode = data.mode ?? profile?.mode ?? "media";
    const job = await rt.jobs.create({
      paths: data.paths,
      profileId: profile?.id,
      config: {
        mode,
        preset: data.preset ?? profile?.preset ?? "jellyfin",
        template: data.template ?? profile?.template ?? {},
        rules: data.rules ?? profile?.rulesJson ?? [],
        // Test mode is the default: nothing happens without a second, explicit step.
        action: data.action ?? profile?.action ?? "test",
        conflictPolicy: data.conflictPolicy ?? profile?.conflictPolicy ?? "skip",
        // Rule mode renames in place unless a target is chosen explicitly.
        targetRoot: data.targetRoot ?? profile?.targetRoot ?? (mode === "rules" ? undefined : settings.defaultTargetRoot),
        order: data.order,
        provider: data.provider ?? profile?.provider ?? undefined,
        language: data.language,
        recursive: data.recursive,
      },
    });
    return { jobId: job.id };
  });

export const getJob = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(z.object({ jobId: id }))
  .handler(async ({ data, context: { rt } }) => {
    const job = findJob(rt.db, data.jobId);
    if (!job) throw new Error(JOB_NOT_FOUND);
    return { job, counts: countItemsByState(rt.db, job.id) };
  });

export const getJobItems = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(
    z.object({
      jobId: id,
      states: z.array(z.enum(ITEM_STATES)).optional(),
      search: z.string().max(200).optional(),
      cursor: z.number().int().optional(),
      limit: z.number().int().min(1).max(5000).optional(),
    }),
  )
  .handler(async ({ data, context: { rt } }) =>
    listItems(rt.db, data.jobId, { filter: { states: data.states, search: data.search }, cursor: data.cursor, limit: data.limit ?? 2000 }),
  );

export const updateJobItem = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(
    z.object({
      itemId: id,
      match: z.object({ id: z.string(), kind: z.enum(["movie", "series"]) }).optional(),
      targetPath: z.string().max(4096).nullable().optional(),
      excluded: z.boolean().optional(),
      remember: z.boolean().optional(),
      approve: z.boolean().optional(),
    }),
  )
  .handler(async ({ data: { itemId, ...change }, context: { rt } }) => rt.jobs.updateItem(itemId, change));

export const recomputePreview = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(
    z.object({
      jobId: id,
      mode: mode.optional(),
      preset: z.string().optional(),
      template: template.optional(),
      rules: rules.optional(),
      /** `null` renames in place again. */
      targetRoot: z.string().min(1).nullable().optional(),
    }),
  )
  .handler(async ({ data: { jobId, ...patch }, context: { rt } }) => rt.jobs.recompute(jobId, patch));

export const executeJob = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(
    z.object({
      jobId: id,
      action: z.enum(ACTIONS).optional(),
      conflictPolicy: z.enum(CONFLICT_POLICIES).optional(),
      itemIds: z.array(id).optional(),
    }),
  )
  .handler(async ({ data, context: { rt } }) => {
    // Runs in the worker; progress arrives over SSE.
    void rt.jobs
      .executeNow(data.jobId, {
        action: data.action,
        conflictPolicy: data.conflictPolicy,
        itemIds: data.itemIds,
      })
      .catch((err) => rt.log.error({ err }, "Ausführung fehlgeschlagen"));
    return { queued: true };
  });

export const undoJob = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(
    z.object({
      jobId: id.optional(),
      itemIds: z.array(id).optional(),
      operationIds: z.array(id).optional(),
      since: z.string().datetime().optional(),
    }),
  )
  .handler(async ({ data, context: { rt } }) => {
    if (!data.jobId && !data.itemIds && !data.operationIds && !data.since) throw new Error(msg("history_error_nothingToUndo"));
    return rt.jobs.undo({ ...data, since: data.since ? new Date(data.since) : undefined });
  });

export const cancelJob = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ jobId: id }))
  .handler(async ({ data, context: { rt } }) => ({ cancelled: rt.jobs.cancel(data.jobId) }));

export const searchProvider = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(
    z.object({ q: z.string().min(1).max(200), kind: z.enum(["movie", "series"]), year: z.number().int().optional(), jobId: id.optional() }),
  )
  .handler(async ({ data, context: { rt } }) => {
    // The job's series source, so the picker offers what the job matches against.
    const provider = rt.provider({ series: data.jobId ? findJob(rt.db, data.jobId)?.config.provider : undefined });
    if (!provider) throw new Error(NO_PROVIDER);
    return data.kind === "movie" ? provider.searchMovie(data.q, { year: data.year }) : provider.searchSeries(data.q, { year: data.year });
  });
