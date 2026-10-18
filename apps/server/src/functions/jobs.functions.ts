import { countItemsByState, getJob as findJob, listItems } from "@namarr/db";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createJobInput, executeJobInput, jobItemsInput, recomputeInput, searchInput, undoInput, updateItemInput } from "~/lib/inputs";
import * as commands from "~/server/commands.server";
import { JOB_NOT_FOUND } from "~/server/jobs.server";
import { authed } from "./middleware";

const id = z.number().int().positive();

export const createJob = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(createJobInput)
  .handler(async ({ data, context: { rt } }) => ({ jobId: (await commands.createManualJob(rt, data)).id }));

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
  .validator(jobItemsInput)
  .handler(async ({ data, context: { rt } }) =>
    listItems(rt.db, data.jobId, { filter: { states: data.states, search: data.search }, cursor: data.cursor, limit: data.limit ?? 2000 }),
  );

export const updateJobItem = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(updateItemInput)
  .handler(async ({ data: { itemId, ...change }, context: { rt } }) => rt.jobs.updateItem(itemId, change));

export const recomputePreview = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(recomputeInput)
  .handler(async ({ data: { jobId, ...patch }, context: { rt } }) => rt.jobs.recompute(jobId, patch));

export const executeJob = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(executeJobInput)
  .handler(async ({ data, context: { rt } }) => {
    // Runs in the worker; progress arrives over SSE.
    void commands.executeJob(rt, data).catch((err) => rt.log.error({ err }, "Execution failed"));
    return { queued: true };
  });

export const undoJob = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(undoInput)
  .handler(async ({ data, context: { rt } }) => commands.undo(rt, data));

export const cancelJob = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ jobId: id }))
  .handler(async ({ data, context: { rt } }) => ({ cancelled: rt.jobs.cancel(data.jobId) }));

export const searchProvider = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(searchInput)
  .handler(async ({ data, context: { rt } }) => commands.searchMetadata(rt, data));
