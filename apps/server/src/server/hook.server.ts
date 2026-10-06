import * as fs from "node:fs/promises";
import { getProfile, getSettings, type Job, listProfiles, listWatchFolders, resolveTargets } from "@namarr/db";
import { z } from "zod";
import { localizeIn } from "../lib/i18n.tsx";
import { automaticConfig } from "./automation.server.ts";
import type { Runtime } from "./runtime.server.ts";

/**
 * POST /api/jobs: a download client reports a finished download. The job runs like a watch
 * folder job: sure matches are renamed right away, uncertain ones wait in the inbox.
 *
 *   path         file or folder, as the client sees it (NAMARR_PATH_MAP translates it)
 *   profile      profile id or name (optional)
 *   watchFolder  watch folder id or name: take its profile, target and threshold (optional)
 *   target       target folder (else profile, watch folder, default target)
 *   review       true: nothing runs without approval
 *   threshold    auto threshold 0..1 (default 0.9)
 */
const hookSchema = z.object({
  path: z.string().min(1).max(4096),
  profile: z.union([z.coerce.number().int().positive(), z.string().min(1)]).optional(),
  watchFolder: z.union([z.coerce.number().int().positive(), z.string().min(1)]).optional(),
  target: z.string().min(1).optional(),
  review: z
    .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
    .transform((v) => v === true || v === "true" || v === "1")
    .optional(),
  threshold: z.coerce.number().min(0).max(1).optional(),
});

export type HookInput = z.infer<typeof hookSchema>;

export class HookError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "HookError";
  }
}

/** JSON, form or query string: whatever is easiest from the client's "run on completion" box. */
export async function readHookInput(request: Request): Promise<HookInput> {
  const url = new URL(request.url);
  const raw: Record<string, unknown> = Object.fromEntries(url.searchParams);
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = await request.json().catch(() => {
      throw new HookError("Invalid JSON body", 400);
    });
    if (!body || typeof body !== "object") throw new HookError("JSON body must be an object", 400);
    Object.assign(raw, body);
  } else if (type.includes("form")) {
    Object.assign(raw, Object.fromEntries((await request.formData()).entries()));
  }
  // An empty value means "not given": clients fill unused placeholders with "".
  for (const [k, v] of Object.entries(raw)) if (v === "") delete raw[k];
  const parsed = hookSchema.safeParse(raw);
  if (!parsed.success)
    throw new HookError(`Invalid request: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`, 400);
  return parsed.data;
}

/** `/downloads/x` → `/data/downloads/x` with NAMARR_PATH_MAP=/downloads:/data/downloads; longest prefix wins. */
export function mapPath(p: string, map: [string, string][]): string {
  const hit = [...map].sort((a, b) => b[0].length - a[0].length).find(([from]) => p === from || p.startsWith(`${from}/`));
  return hit ? hit[1] + p.slice(hit[0].length) : p;
}

const byIdOrName = <T extends { id: number; name: string }>(list: T[], key: string | number | undefined) =>
  key === undefined ? undefined : list.find((x) => (typeof key === "number" ? x.id === key : x.name.toLowerCase() === key.toLowerCase()));

export async function createHookJob(rt: Runtime, input: HookInput): Promise<Job> {
  const settings = getSettings(rt.db);
  const watchFolder = byIdOrName(listWatchFolders(rt.db), input.watchFolder);
  if (input.watchFolder !== undefined && !watchFolder) throw new HookError(`Unknown watch folder: ${input.watchFolder}`, 404);
  const profile =
    input.profile !== undefined
      ? byIdOrName(listProfiles(rt.db), input.profile)
      : watchFolder?.profileId
        ? getProfile(rt.db, watchFolder.profileId)
        : undefined;
  if (input.profile !== undefined && !profile) throw new HookError(`Unknown profile: ${input.profile}`, 404);

  const targetRoot = input.target ? mapPath(input.target, rt.env.pathMap) : undefined;
  const targets = resolveTargets(settings, profile?.targets, watchFolder?.targets);
  if (!targetRoot && (profile?.mode ?? "media") !== "rules" && !targets.movie && !targets.series)
    throw new HookError("No target folder: pass target, or add a library folder for movies or series in the settings", 400);
  const autoThreshold = input.review ? null : (input.threshold ?? watchFolder?.autoThreshold ?? 0.9);

  const source = mapPath(input.path, rt.env.pathMap);
  if (!(await fs.stat(source).catch(() => undefined))) throw new HookError(`Path not found: ${source}`, 404);

  try {
    return await rt.jobs.create({
      paths: [source],
      kind: "hook",
      profileId: profile?.id ?? null,
      watchFolderId: watchFolder?.id ?? null,
      config: automaticConfig(profile, { targets, targetRoot, autoThreshold }),
    });
  } catch (e) {
    // By name, not instanceof: the server entry and the Start bundle each carry a copy of core.
    if ((e as Error).name === "PathOutsideRootError") throw new HookError(localizeIn((e as Error).message, "en"), 403);
    throw e;
  }
}
