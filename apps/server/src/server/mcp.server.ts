import { ACTIONS } from "@namarr/core";
import {
  countItemsByState,
  dashboardStats,
  defaultFormat,
  FORMAT_KINDS,
  formatsOf,
  getJob,
  getSettings,
  type Job,
  type JobItem,
  listInbox,
  listItems,
  listJobs,
  listOperations,
  listWatchFolders,
  type Operation,
} from "@namarr/db";
import { z } from "zod";
import { localizeIn } from "~/lib/i18n";
import {
  approveInboxInput,
  browseInput,
  createJobInput,
  executeJobInput,
  historyInput,
  jobItemsInput,
  recomputeInput,
  searchInput,
  undoInput,
  updateItemInput,
} from "~/lib/inputs";
import { APP_VERSION } from "~/lib/version";
import * as commands from "./commands.server.ts";
import { JOB_NOT_FOUND } from "./jobs.server.ts";
import type { Runtime } from "./runtime.server.ts";

/**
 * MCP server for AI agents (Streamable HTTP, stateless, JSON answers): POST /api/mcp. The tools
 * are the workbench's steps, so an agent works like a person does: preview first (test mode),
 * look at old → new, correct, then execute; everything it does can be undone.
 *
 * `NAMARR_MCP=readonly` leaves out the tools that touch files (execute, approve, undo).
 */

/** Newest first; an unknown version gets the newest, the client decides whether it can go on. */
export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS = `namarr renames movies, series and anime (matched against TMDB, TheTVDB, TVmaze, AniDB) and other files by rules.
Workflow: get_overview (folders, libraries, formats) → browse_folder → create_job (always a preview in test mode, nothing moves) → list_job_items (old → new, confidence, reasons, conflicts) → fix doubtful files with search_metadata + update_item → execute_job with action move, copy or rename. Every executed operation can be undone with undo.
Watch folders and the download hook put uncertain matches into the inbox: list_inbox, then approve_inbox.
Ask the user before execute_job, approve_inbox or undo unless they told you to go ahead.`;

/** What a tool may change: nothing, only namarr's own previews, or files on disk. */
type Effect = "read" | "preview" | "files";

type Tool<S extends z.ZodObject = z.ZodObject> = {
  name: string;
  title: string;
  description: string;
  input: S;
  effect: Effect;
  /** Talks to a metadata source on the internet. */
  external?: boolean;
  run: (rt: Runtime, args: z.infer<S>) => Promise<unknown> | unknown;
};

const tool = <S extends z.ZodObject>(t: Tool<S>) => t as unknown as Tool;

const en = (text: string | null | undefined) => localizeIn(text, "en");
const BUSY = new Set<Job["status"]>(["pending", "scanning", "matching", "executing"]);
const pad = (n: number) => String(n).padStart(2, "0");

const waitSeconds = (fallback: number) =>
  z
    .number()
    .int()
    .min(0)
    .max(600)
    .optional()
    .describe(`How long to wait for the job to finish (seconds, default ${fallback}); 0 returns at once.`);

/** Waits until the job is no longer busy (or the time is up); `undefined` when it does not exist. */
export async function settled(rt: Runtime, jobId: number, seconds: number): Promise<Job | undefined> {
  const until = Date.now() + seconds * 1000;
  let job = getJob(rt.db, jobId);
  while (job && BUSY.has(job.status) && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 100));
    job = getJob(rt.db, jobId);
  }
  return job;
}

function jobView(rt: Runtime, job: Job) {
  return {
    jobId: job.id,
    kind: job.kind,
    status: job.status,
    busy: BUSY.has(job.status),
    sourcePaths: job.sourcePaths,
    mode: job.config.mode,
    action: job.config.action,
    conflictPolicy: job.config.conflictPolicy,
    progress: { done: job.progressDone, total: job.progressTotal },
    items: countItemsByState(rt.db, job.id),
    error: en(job.error),
    createdAt: job.createdAt,
  };
}

function itemView(item: JobItem) {
  const match = item.matchJson;
  const best = match?.best;
  return {
    itemId: item.id,
    jobId: item.jobId,
    state: item.state,
    source: item.sourcePath,
    target: item.targetPath,
    confidence: Math.round(item.confidence * 100) / 100,
    match: best ? { provider: best.provider, id: best.id, kind: best.kind, title: best.title, year: best.year } : null,
    episodes: match?.episodes.map((e) => `S${pad(e.season)}E${pad(e.episode)}${e.title ? ` ${e.title}` : ""}`) ?? [],
    alternatives:
      match?.alternatives.slice(0, 3).map(({ candidate: c, score }) => ({
        provider: c.provider,
        id: c.id,
        kind: c.kind,
        title: c.title,
        year: c.year,
        score: Math.round(score * 100) / 100,
      })) ?? [],
    reasons: item.reasons.map((r) => en(r)),
    conflict: en(item.conflict),
    error: en(item.error),
    excluded: item.excluded,
    approved: item.approved,
    companions: item.companions.map((c) => c.to),
  };
}

const operationView = (op: Operation) => ({
  operationId: op.id,
  jobId: op.jobId,
  itemId: op.jobItemId,
  action: op.action,
  from: op.fromPath,
  to: op.toPath,
  executedAt: op.executedAt,
  undoneAt: op.undoneAt,
});

function jobOrThrow(job: Job | undefined): Job {
  if (!job) throw new Error(JOB_NOT_FOUND);
  return job;
}

/** The job and its first files: what an agent looks at next anyway. */
async function jobWithItems(rt: Runtime, jobId: number, seconds: number) {
  const job = jobOrThrow(await settled(rt, jobId, seconds));
  const { items, nextCursor } = listItems(rt.db, job.id, { limit: 50 });
  return { job: jobView(rt, job), items: items.map(itemView), nextCursor };
}

const jobId = z.object({ jobId: z.number().int().positive() });

export const TOOLS: Tool[] = [
  tool({
    name: "get_overview",
    title: "Overview",
    description:
      "Start here. The folders namarr may read and write (with the movie and series libraries), watch folders, naming formats per kind with the defaults, open inbox entries and the latest jobs.",
    input: z.object({}),
    effect: "read",
    run: (rt) => {
      const settings = getSettings(rt.db);
      return {
        version: APP_VERSION,
        stats: dashboardStats(rt.db),
        folders: settings.folders,
        watchFolders: listWatchFolders(rt.db).map((w) => ({
          id: w.id,
          name: w.name,
          path: w.path,
          enabled: w.enabled,
          targets: w.targets,
          options: w.options,
          autoThreshold: w.autoThreshold,
        })),
        formats: Object.fromEntries(
          FORMAT_KINDS.map((kind) => [
            kind,
            {
              default: defaultFormat(settings, kind).id,
              available: formatsOf(settings, kind).map((f) => ({ id: f.id, name: f.name, template: f.template })),
            },
          ]),
        ),
        language: settings.language,
        recentJobs: listJobs(rt.db, 10).map((j) => jobView(rt, j)),
      };
    },
  }),
  tool({
    name: "browse_folder",
    title: "Browse folder",
    description: "Lists a folder inside the allowed folders (folders first). Without path: the allowed folders themselves.",
    input: browseInput.pick({ path: true }),
    effect: "read",
    run: (rt, args) => commands.browseFolder(rt, { path: args.path }),
  }),
  tool({
    name: "create_job",
    title: "Create preview job",
    description:
      'Scans files or folders and matches them (mode "media"), applies rename rules ("rules") or both. Always a preview in test mode: nothing on disk changes until execute_job. Waits for the preview and returns the job with its first 50 files (old → new, confidence, reasons); if job.busy is still true, wait with get_job.',
    input: createJobInput.omit({ action: true, preset: true }).extend({ waitSeconds: waitSeconds(60) }),
    effect: "preview",
    external: true,
    run: async (rt, { waitSeconds: seconds, ...data }) => {
      const job = await commands.createManualJob(rt, { ...data, action: "test" });
      return jobWithItems(rt, job.id, seconds ?? 60);
    },
  }),
  tool({
    name: "get_job",
    title: "Job status",
    description: "Status, progress and file counts per state of a job; can wait until it is no longer busy.",
    input: jobId.extend({ waitSeconds: waitSeconds(0) }),
    effect: "read",
    run: async (rt, args) => jobView(rt, jobOrThrow(await settled(rt, args.jobId, args.waitSeconds ?? 0))),
  }),
  tool({
    name: "list_job_items",
    title: "Files of a job",
    description:
      "The files of a job with source and target path, match, episodes, confidence, reasons and conflicts. Filter by state (needs_review: doubtful matches) or text; page with nextCursor.",
    input: jobItemsInput.extend({ limit: z.number().int().min(1).max(500).optional() }),
    effect: "read",
    run: (rt, args) => {
      jobOrThrow(getJob(rt.db, args.jobId));
      const { items, nextCursor } = listItems(rt.db, args.jobId, {
        filter: { states: args.states, search: args.search },
        cursor: args.cursor,
        limit: args.limit ?? 100,
      });
      return { items: items.map(itemView), nextCursor };
    },
  }),
  tool({
    name: "search_metadata",
    title: "Search metadata",
    description:
      "Searches the metadata source for a movie or series (with jobId: the job's series source). Returns candidates whose id and kind update_item takes as match.",
    input: searchInput,
    effect: "read",
    external: true,
    run: (rt, args) => commands.searchMetadata(rt, args),
  }),
  tool({
    name: "update_item",
    title: "Correct a file",
    description:
      "Corrects one file of a job before it runs: another match (id and kind from search_metadata; remember: use it for this release from now on), an own target path (absolute, or relative to the job's targetRoot, else to the file's own folder; null: back to the template), exclude it, or approve a doubtful match. Recomputes the preview.",
    input: updateItemInput,
    effect: "preview",
    external: true,
    run: async (rt, { itemId, ...change }) => itemView(await rt.jobs.updateItem(itemId, change)),
  }),
  tool({
    name: "recompute_preview",
    title: "Recompute preview",
    description:
      "Computes the target names again with another template, format, rule stack or target folder, without matching again. Template fields: {n} title, {y} year, {s00e00}, {t} episode title, {vf} resolution …",
    input: recomputeInput.omit({ preset: true }),
    effect: "preview",
    run: async (rt, { jobId: id, ...patch }) => {
      await rt.jobs.recompute(id, patch);
      return jobWithItems(rt, id, 0);
    },
  }),
  tool({
    name: "cancel_job",
    title: "Cancel job",
    description: "Stops a job that is scanning, matching or executing. What already ran stays done (undo reverts it).",
    input: jobId,
    effect: "preview",
    run: (rt, args) => ({ cancelled: rt.jobs.cancel(args.jobId) }),
  }),
  tool({
    name: "execute_job",
    title: "Execute job",
    description:
      'Carries out the preview: action "move" (into the libraries or target folder), "copy" or "rename" (in place); "test" only checks. Files in state ready run; itemIds limits it to some. conflictPolicy: skip (default), suffix, overwrite, keep-better. Waits for the end and returns the job with its files.',
    input: executeJobInput.extend({ action: z.enum(ACTIONS), waitSeconds: waitSeconds(300) }),
    effect: "files",
    run: async (rt, { waitSeconds: seconds, ...data }) => {
      // Queued synchronously: a missing or busy job fails here; the run itself is followed by status.
      void commands.executeJob(rt, data).catch((err) => rt.log.error({ err }, "MCP: execution failed"));
      return jobWithItems(rt, data.jobId, seconds ?? 300);
    },
  }),
  tool({
    name: "list_inbox",
    title: "Inbox",
    description: "Uncertain matches from watch folders and the download hook, waiting for approval, with the reason.",
    input: z.object({ limit: z.number().int().min(1).max(500).optional() }),
    effect: "read",
    run: (rt, args) =>
      listInbox(rt.db, args.limit ?? 100).map((e) => ({ reason: en(e.reason), createdAt: e.createdAt, ...itemView(e.item) })),
  }),
  tool({
    name: "approve_inbox",
    title: "Approve inbox",
    description:
      "Approves inbox entries and executes them with their job's action (usually move): the given itemIds, or every entry at or above minConfidence.",
    input: approveInboxInput.refine((a) => a.itemIds?.length || a.minConfidence !== undefined, {
      message: "Pass itemIds or minConfidence",
    }),
    effect: "files",
    run: (rt, args) => commands.approveInbox(rt, args),
  }),
  tool({
    name: "list_history",
    title: "History",
    description: "Executed file operations, newest first (200 per page; before: the last operationId for the next page).",
    input: historyInput,
    effect: "read",
    run: (rt, args) => listOperations(rt.db, { ...args, limit: 200 }).map(operationView),
  }),
  tool({
    name: "undo",
    title: "Undo",
    description:
      "Reverts executed operations: a whole job, some of its files (itemIds), single operations (operationIds) or everything since a point in time (ISO date).",
    input: undoInput,
    effect: "files",
    run: (rt, args) => commands.undo(rt, args),
  }),
];

export function toolsFor(rt: Pick<Runtime, "env">): Tool[] {
  return rt.env.mcp === "readonly" ? TOOLS.filter((t) => t.effect !== "files") : TOOLS;
}

function describe(t: Tool) {
  const { $schema: _, ...inputSchema } = z.toJSONSchema(t.input, { io: "input" }) as Record<string, unknown>;
  return {
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema,
    annotations: {
      title: t.title,
      readOnlyHint: t.effect === "read",
      destructiveHint: t.effect === "files",
      openWorldHint: Boolean(t.external),
    },
  };
}

async function callTool(rt: Runtime, params: unknown) {
  const { name, arguments: args } = (params ?? {}) as { name?: unknown; arguments?: unknown };
  const t = toolsFor(rt).find((x) => x.name === name);
  if (!t) throw new RpcError(-32602, `Unknown tool: ${String(name)}`);
  const text = (value: unknown, isError = false) => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }], isError });
  // Bad arguments and failures are tool results, not protocol errors: the model can read and correct them.
  const parsed = t.input.safeParse(args ?? {});
  if (!parsed.success)
    return text(
      { error: `Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"} ${i.message}`).join("; ")}` },
      true,
    );
  try {
    return text((await t.run(rt, parsed.data)) ?? { ok: true });
  } catch (e) {
    rt.log.info({ tool: t.name, err: e }, "MCP tool failed");
    return text({ error: en((e as Error).message) ?? String(e) }, true);
  }
}

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

type RpcMessage = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };

async function dispatch(rt: Runtime, message: RpcMessage): Promise<unknown> {
  switch (message.method) {
    case "initialize": {
      const asked = (message.params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
      return {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked as string) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "namarr", title: "namarr", version: APP_VERSION },
        instructions: INSTRUCTIONS,
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return { tools: toolsFor(rt).map(describe) };
    case "tools/call":
      return callTool(rt, message.params);
    default:
      throw new RpcError(-32601, `Method not found: ${String(message.method)}`);
  }
}

const rpcError = (id: unknown, code: number, message: string, status = 200) =>
  Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status });

/** Agents send no Origin; a browser does, and then it has to be namarr's own. */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const host = new URL(origin).host;
    return host === new URL(request.url).host || host === request.headers.get("host");
  } catch {
    return false;
  }
}

/** One JSON-RPC message per POST; notifications and client responses get 202 without a body. */
export async function handleMcp(rt: Runtime, request: Request): Promise<Response> {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } });
  // Against DNS rebinding: a browser page on another site must not reach the tools.
  if (!sameOrigin(request)) return new Response("Forbidden origin", { status: 403 });
  // JSON only: a cross-site form or text/plain POST cannot get past the browser's preflight then.
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json"))
    return new Response("Content-Type must be application/json", { status: 415 });

  let message: RpcMessage;
  try {
    message = await request.json();
  } catch {
    return rpcError(null, -32700, "Parse error", 400);
  }
  if (Array.isArray(message)) return rpcError(null, -32600, "Batches are not supported", 400);
  if (!message || typeof message !== "object" || message.jsonrpc !== "2.0") return rpcError(null, -32600, "Invalid request", 400);
  if (message.method === undefined || message.id === undefined) return new Response(null, { status: 202 });
  try {
    return Response.json({ jsonrpc: "2.0", id: message.id, result: await dispatch(rt, message) });
  } catch (e) {
    if (e instanceof RpcError) return rpcError(message.id, e.code, e.message);
    rt.log.error({ err: e }, "MCP request failed");
    return rpcError(message.id, -32603, "Internal error");
  }
}
