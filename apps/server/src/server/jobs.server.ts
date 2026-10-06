import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  type Action,
  buildPreview,
  type ConflictPolicy,
  cleanupEmptyDirs,
  entryParsed,
  executeOperation,
  type FileMeta,
  type MatchResult,
  type MetadataProvider,
  matchAll,
  msg,
  needsMetadata,
  type OperationRecord,
  type Parsed,
  type PreviewConfig,
  type PreviewInput,
  type PreviewItem,
  type ProbeInfo,
  parse,
  type Quality,
  qualityOf,
  type Rule,
  readMetadata,
  resolveEpisodes,
  resolveInRoots,
  type ScannedFile,
  scan,
  TARGET_EXISTS,
  undoOperation,
} from "@namarr/core";
import {
  addToInbox,
  allItems,
  allowedRoots,
  countItemsByState,
  createJob,
  type Db,
  findDoneItemByTarget,
  getItem,
  getJob,
  getSettings,
  insertItems,
  insertOperation,
  type Job,
  type JobConfig,
  type JobItem,
  type JobKind,
  listOperations,
  listOverrides,
  listWatchFolders,
  markUndone,
  removeFromInbox,
  resolveTargets,
  type SeriesProvider,
  type Settings,
  saveOverride,
  updateItem,
  updateJob,
} from "@namarr/db";
import type { EventBus } from "./events.server.ts";
import { afterExecution, type JobSummary } from "./notify.server.ts";

export type JobServiceDeps = {
  db: Db;
  bus: EventBus;
  /** `series` is the job's series source; unset uses the setting. */
  provider: (settings: Settings, choice?: { series?: SeriesProvider }) => MetadataProvider | undefined;
  log: { info: (o: object | string, msg?: string) => void; error: (o: object | string, msg?: string) => void };
  notify?: (settings: Settings, summary: JobSummary) => Promise<void>;
  /** Container metadata (ffprobe); undefined when unavailable. */
  probe?: (file: string) => Promise<ProbeInfo | undefined>;
};

export const JOB_BUSY = msg("jobs_error_running");
export const JOB_NOT_FOUND = msg("jobs_error_notFound");
export const NO_PROVIDER = msg("jobs_error_noProvider");
export const ALWAYS_REVIEW = msg("jobs_reason_alwaysReview");

/** Thrown for user errors; the message is shown in the UI. */
export class JobError extends Error {
  override name = "JobError";
}

type StoredMatch = MatchResult;

/** Changes to a job before its preview is computed again. */
export type TargetPatch = Partial<Pick<JobConfig, "mode" | "preset" | "template" | "formats" | "rules">> & {
  /** One folder for every file; null: none. */
  targetRoot?: string | null;
  /** "library": the library folders by kind; null: none (renamed in place). */
  targets?: "library" | null;
};

/**
 * Runs the job pipeline (scan → parse → match → preview → execute → undo) in the server process.
 * Long work never runs inside a server function: functions enqueue and return the job id.
 * One queue, one job at a time: file operations on the same disks gain nothing from parallelism.
 */
export class JobService {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly aborts = new Map<number, AbortController>();
  private readonly metaCache = new Map<string, FileMeta>();

  constructor(private readonly deps: JobServiceDeps) {}

  private settings() {
    return getSettings(this.deps.db);
  }

  /** Everything that touches files runs here, one after another. */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work);
    this.queue = run.catch((e) => this.deps.log.error({ err: e }, "Job fehlgeschlagen"));
    return run;
  }

  private enqueue<T>(jobId: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    this.aborts.set(jobId, controller);
    return this.serial(() => work(controller.signal)).finally(() => this.aborts.delete(jobId));
  }

  /** Previews and items of a job that is scanning, matching or executing are not editable. */
  private assertIdle(job: Job) {
    if (["pending", "scanning", "matching", "executing"].includes(job.status)) throw new JobError(JOB_BUSY);
  }

  /** Waits until everything queued so far has finished (tests, shutdown). */
  idle(): Promise<unknown> {
    return this.queue;
  }

  cancel(jobId: number): boolean {
    const c = this.aborts.get(jobId);
    c?.abort();
    return Boolean(c);
  }

  private progress(job: Pick<Job, "id">, status: Job["status"], done: number, total: number) {
    updateJob(this.deps.db, job.id, { status, progressDone: done, progressTotal: total });
    this.deps.bus.emit({ type: "job.progress", jobId: job.id, status, done, total });
  }

  // ---------- create & analyze ----------

  /** Creates a job and queues scan + match. Returns immediately. */
  async create(input: { paths: string[]; config: JobConfig; kind?: JobKind; watchFolderId?: number | null }): Promise<Job> {
    const settings = this.settings();
    const resolved: string[] = [];
    for (const p of input.paths) resolved.push(await resolveInRoots(p, allowedRoots(settings)));
    if (input.config.targetRoot) input.config.targetRoot = await resolveInRoots(input.config.targetRoot, allowedRoots(settings));
    input.config.targets = await this.resolveTargetFolders(input.config.targets, allowedRoots(settings));
    const job = createJob(this.deps.db, {
      sourcePaths: resolved,
      config: input.config,
      kind: input.kind ?? "manual",
      watchFolderId: input.watchFolderId ?? null,
    });
    void this.enqueue(job.id, (signal) => this.analyze(job.id, signal)).catch(() => {});
    return job;
  }

  private async analyze(jobId: number, signal: AbortSignal): Promise<void> {
    const { db } = this.deps;
    const job = getJob(db, jobId);
    if (!job) return;
    try {
      this.progress(job, "scanning", 0, 0);
      const mode = job.config.mode;
      const files: ScannedFile[] = [];
      const parsed: Parsed[] = [];
      for (const root of job.sourcePaths) {
        const result = await scan(root, { mode: mode === "rules" ? "all" : "media", recursive: job.config.recursive ?? true, signal });
        const rootIsFile = (await fs.stat(root)).isFile();
        for (const f of result.files) {
          files.push(f);
          // The source folder's own name is context too: "Severance.S02.German.DL-GRP/204.mkv".
          parsed.push(
            parse(rootIsFile ? path.join(path.basename(path.dirname(f.path)), f.relative) : path.join(path.basename(root), f.relative)),
          );
        }
      }
      if (signal.aborted) return this.finishCancelled(job);
      if (mode !== "rules") await this.probeMissing(files, parsed);

      const rows = insertItems(
        db,
        files.map((f, i) => ({
          jobId,
          sourcePath: f.path,
          size: f.size,
          parsedJson: parsed[i],
          companions: f.companions.map((c) => ({ from: c.path, to: "", suffix: c.suffix })),
          state: "parsed" as const,
        })),
      );

      let matches = new Map<string, MatchResult>();
      if (mode !== "rules") {
        const settings = this.settings();
        const provider = this.deps.provider(settings, { series: job.config.provider });
        if (!provider) throw new JobError(NO_PROVIDER);
        this.progress(job, "matching", 0, files.length);
        matches = await matchAll(
          rows.map((r, i) => ({ key: String(r.id), parsed: parsed[i]! })),
          provider,
          {
            language: job.config.language ?? settings.language,
            order: job.config.order,
            overrides: listOverrides(db).map((o) => ({ ...o, seasonOffset: o.seasonOffset })),
            onProgress: (done, total) => this.progress(job, "matching", Math.round((done / total) * files.length), files.length),
          },
        );
        if (signal.aborted) return this.finishCancelled(job);
        for (const r of rows) updateItem(db, r.id, { matchJson: matches.get(String(r.id)) ?? null, state: "matched" });
      }

      await this.computePreview(jobId);
      const counts = countItemsByState(db, jobId);
      this.progress(job, "ready", files.length, files.length);
      this.deps.log.info({ jobId, files: files.length, counts }, "Job analysiert");

      // Watch folders and download-client hooks run on their own: sure matches go through.
      if (job.kind !== "manual") await this.autoProcess(jobId);
    } catch (e) {
      updateJob(db, jobId, { status: "failed", error: (e as Error).message, finishedAt: new Date() });
      this.deps.bus.emit({ type: "job.progress", jobId, status: "failed", done: 0, total: 0 });
      throw e;
    }
  }

  /**
   * Names without resolution or codec ("Severance/Staffel 2/06.mkv"): read them from the
   * container with ffprobe, if installed (it is in the Docker image). Four at a time.
   */
  private async probeMissing(files: ScannedFile[], parsed: Parsed[]) {
    const todo = files.map((f, i) => ({ f, p: parsed[i]! })).filter(({ p }) => !p.release.resolution || !p.release.videoCodec);
    for (let i = 0; i < todo.length; i += 4) {
      const infos = await Promise.all(todo.slice(i, i + 4).map(({ f }) => this.deps.probe?.(f.path)));
      if (i === 0 && infos[0] === undefined) return; // no ffprobe: don't try the rest
      infos.forEach((info, k) => {
        const { p } = todo[i + k]!;
        if (!info) return;
        p.release.resolution ??= info.resolution;
        p.release.videoCodec ??= info.videoCodec;
      });
    }
  }

  /**
   * What keep-better knows about a file: the parsed name (for the existing file the name it
   * had before namarr renamed it, since the new name rarely says "BluRay") plus ffprobe.
   */
  private async quality(file: string, incoming?: JobItem): Promise<Quality> {
    const release = incoming
      ? (incoming.parsedJson?.release ?? parse(file).release)
      : (findDoneItemByTarget(this.deps.db, file)?.parsedJson?.release ?? parse(file).release);
    return qualityOf(release, await this.deps.probe?.(file));
  }

  private finishCancelled(job: Job) {
    updateJob(this.deps.db, job.id, { status: "cancelled", finishedAt: new Date() });
    this.deps.bus.emit({ type: "job.progress", jobId: job.id, status: "cancelled", done: 0, total: 0 });
  }

  /** Watch jobs: sure matches go through, the rest waits in the inbox. */
  private async autoProcess(jobId: number) {
    const { db } = this.deps;
    const job = getJob(db, jobId)!;
    const always = job.config.alwaysReview === true;
    const review: number[] = [];
    let ready = 0;
    for (const item of allItems(db, jobId)) {
      if (item.state === "ready" && !always) {
        ready++;
        continue;
      }
      if (item.state !== "needs_review" && item.state !== "ready") continue;
      const reason = item.reasons[0] ?? msg("jobs_reason_belowThreshold");
      addToInbox(db, item.id, always ? (item.reasons[0] ? `${ALWAYS_REVIEW}: ${reason}` : ALWAYS_REVIEW) : reason);
      updateItem(db, item.id, { state: "needs_review" });
      review.push(item.id);
    }
    if (review.length) this.deps.bus.emit({ type: "inbox.added", itemIds: review });
    if (ready) await this.execute(jobId, new AbortController().signal);
  }

  // ---------- preview ----------

  private async toInput(item: JobItem): Promise<PreviewInput> {
    let mtime = new Date(0);
    let birthtime = new Date(0);
    try {
      const st = await fs.stat(item.sourcePath);
      mtime = st.mtime;
      birthtime = st.birthtime;
    } catch {
      // file vanished; the item fails on execution
    }
    const file: ScannedFile = {
      path: item.sourcePath,
      relative: path.basename(item.sourcePath),
      size: item.size,
      mtime,
      birthtime,
      inode: 0,
      companions: item.companions.map((c) => ({ path: c.from, suffix: c.suffix ?? "" })),
    };
    return {
      file,
      parsed: item.parsedJson as Parsed,
      match: (item.matchJson as StoredMatch | null) ?? undefined,
      targetOverride: item.overrideTarget ?? undefined,
      excluded: item.excluded,
      approved: item.approved,
    };
  }

  /** Library folders must lie inside the allowed folders too, like every other target. */
  private async resolveTargetFolders(targets: JobConfig["targets"], roots: string[]): Promise<JobConfig["targets"]> {
    if (!targets) return undefined;
    const resolve = async (p?: string) => (p ? resolveInRoots(p, roots) : undefined);
    return { movie: await resolve(targets.movie), series: await resolve(targets.series) };
  }

  private previewConfig(config: JobConfig): PreviewConfig {
    return {
      mode: config.mode,
      preset: config.preset,
      template: config.template,
      rules: (config.rules ?? []) as Rule[],
      targetRoot: config.targetRoot,
      targets: config.targets,
      autoThreshold: config.autoThreshold,
    };
  }

  /** Recomputes targets from stored parse and match results, without matching again. */
  async recompute(jobId: number, patch?: TargetPatch) {
    const job = getJob(this.deps.db, jobId);
    if (!job) throw new JobError(JOB_NOT_FOUND);
    this.assertIdle(job);
    return this.computePreview(jobId, patch);
  }

  private async computePreview(jobId: number, patch?: TargetPatch) {
    const { db } = this.deps;
    let job = getJob(db, jobId);
    if (!job) throw new JobError(JOB_NOT_FOUND);
    if (patch) {
      const { targetRoot, targets, ...rest } = patch;
      const config: JobConfig = { ...job.config, ...rest };
      const settings = this.settings();
      if (targetRoot === null) delete config.targetRoot;
      else if (targetRoot !== undefined) config.targetRoot = await resolveInRoots(targetRoot, allowedRoots(settings));
      // "library": the library folders by kind (the watch folder's, else the defaults); null: none, in place.
      if (targets === null) delete config.targets;
      else if (targets === "library") {
        const watchId = job.watchFolderId;
        const watch = watchId ? listWatchFolders(db).find((w) => w.id === watchId) : undefined;
        const { movie, series } = resolveTargets(settings, watch?.targets);
        config.targets = await this.resolveTargetFolders({ movie, series }, allowedRoots(settings));
      }
      job = updateJob(db, jobId, { config })!;
    }
    // Undone files are back at their source and can be renamed again.
    const items = allItems(db, jobId).filter((i) => i.state !== "done");
    const inputs = await Promise.all(items.map((i) => this.toInput(i)));
    if (job.config.mode !== "media" && needsMetadata(job.config.rules ?? [])) await this.loadMetadata(inputs);
    const preview = buildPreview(inputs, this.previewConfig(job.config));
    await this.markExisting(preview);
    db.transaction(() => {
      preview.forEach((p, i) => {
        const item = items[i]!;
        updateItem(db, item.id, {
          targetPath: p.target ?? null,
          state: p.state === "parsed" ? "needs_review" : p.state,
          confidence: p.confidence,
          reasons: p.reasons,
          conflict: p.conflict ?? null,
          companions: p.companions.map((c, k) => ({ ...c, suffix: item.companions[k]?.suffix })),
        });
      });
    });
    this.deps.bus.emit({ type: "item.updated", jobId, itemIds: items.map((i) => i.id) });
    return countItemsByState(db, jobId);
  }

  /**
   * EXIF dates and audio tags for metadata rules. The workbench recomputes the preview on every
   * rule change, so results are cached per file version (path, size, mtime). Eight at a time.
   */
  private async loadMetadata(inputs: PreviewInput[]) {
    const key = (f: ScannedFile) => `${f.path}|${f.size}|${f.mtime.getTime()}`;
    const todo = inputs.filter((i) => !this.metaCache.has(key(i.file)));
    for (let i = 0; i < todo.length; i += 8) {
      const metas = await Promise.all(todo.slice(i, i + 8).map((t) => readMetadata(t.file.path, this.deps.probe)));
      for (const [k, m] of metas.entries()) this.metaCache.set(key(todo[i + k]!.file), m);
    }
    for (const input of inputs) input.meta = this.metaCache.get(key(input.file));
    // Keep the cache bounded: drop the oldest entries.
    for (const k of this.metaCache.keys()) {
      if (this.metaCache.size <= 20_000) break;
      this.metaCache.delete(k);
    }
  }

  /** An existing target is a conflict unless the policy resolves it. */
  private async markExisting(items: PreviewItem[]) {
    await Promise.all(
      items.map(async (item) => {
        if (!item.target || item.conflict) return;
        try {
          await fs.lstat(item.target);
          if (item.target !== item.source) {
            item.conflict = "exists";
            item.reasons = [...item.reasons, TARGET_EXISTS];
          }
        } catch {
          // free
        }
      }),
    );
  }

  // ---------- manual corrections ----------

  /** Choose another match, set a target by hand, or exclude the file. */
  async updateItem(
    itemId: number,
    change: {
      match?: { id: string; kind: "movie" | "series" };
      targetPath?: string | null;
      excluded?: boolean;
      remember?: boolean;
      approve?: boolean;
    },
  ) {
    const { db } = this.deps;
    const item = getItem(db, itemId);
    if (!item) throw new JobError(msg("jobs_error_fileNotFound"));
    if (item.state === "done") throw new JobError(msg("jobs_error_alreadyRenamed"));
    const job = getJob(db, item.jobId)!;
    this.assertIdle(job);
    const values: Parameters<typeof updateItem>[2] = {};

    if (change.match) {
      const settings = this.settings();
      const provider = this.deps.provider(settings, { series: job.config.provider });
      if (!provider) throw new JobError(NO_PROVIDER);
      const best = await provider.details(change.match.kind, change.match.id, { language: settings.language });
      const parsed = item.parsedJson as Parsed;
      const episodes =
        best.kind === "series"
          ? resolveEpisodes(
              entryParsed(best, parsed),
              await provider.episodes(best.id, { language: settings.language, order: job.config.order }),
            )
          : [];
      const previous = item.matchJson as StoredMatch | null;
      const match: StoredMatch = {
        best,
        episodes,
        alternatives: previous?.alternatives ?? [],
        confidence: 1,
        reasons: [msg("jobs_reason_chosenManually")],
        overridden: true,
      };
      values.matchJson = match;
      if (change.remember && parsed.title) {
        saveOverride(db, { pattern: parsed.title, provider: best.provider, externalId: best.id, seasonOffset: 0 });
      }
    }
    if (change.targetPath !== undefined) {
      if (change.targetPath) {
        const root = job.config.targetRoot ?? path.dirname(item.sourcePath);
        const absolute = path.isAbsolute(change.targetPath) ? change.targetPath : path.join(root, change.targetPath);
        values.overrideTarget = await resolveInRoots(absolute, allowedRoots(this.settings()));
      } else values.overrideTarget = null;
    }
    if (change.excluded !== undefined) values.excluded = change.excluded;
    if (change.approve) values.approved = true;
    updateItem(db, itemId, values);
    await this.computePreview(item.jobId);
    return getItem(db, itemId)!;
  }

  /** Approves several files at once; each job's preview is recomputed once. */
  async approve(itemIds: number[]): Promise<Map<number, number[]>> {
    const { db } = this.deps;
    const byJob = new Map<number, number[]>();
    for (const id of itemIds) {
      const item = getItem(db, id);
      if (!item || item.state === "done") continue;
      byJob.set(item.jobId, [...(byJob.get(item.jobId) ?? []), id]);
    }
    const ready = new Map<number, number[]>();
    for (const [jobId, ids] of byJob) {
      this.assertIdle(getJob(db, jobId)!);
      db.transaction(() => {
        for (const id of ids) updateItem(db, id, { approved: true });
      });
      await this.computePreview(jobId);
      ready.set(
        jobId,
        ids.filter((id) => getItem(db, id)?.state === "ready"),
      );
    }
    return ready;
  }

  // ---------- execute ----------

  /**
   * Queues the execution. Validation errors throw synchronously, so a caller that does not
   * wait for the result still learns that the job is busy or missing.
   */
  executeNow(jobId: number, options: { action?: Action; conflictPolicy?: ConflictPolicy; itemIds?: number[] } = {}) {
    const { db } = this.deps;
    const job = getJob(db, jobId);
    if (!job) throw new JobError(JOB_NOT_FOUND);
    this.assertIdle(job);
    if (options.action || options.conflictPolicy) {
      updateJob(db, jobId, {
        config: {
          ...job.config,
          action: options.action ?? job.config.action,
          conflictPolicy: options.conflictPolicy ?? job.config.conflictPolicy,
        },
      });
    }
    return this.enqueue(jobId, (signal) => this.execute(jobId, signal, options.itemIds));
  }

  private async execute(jobId: number, signal: AbortSignal, onlyItems?: number[]) {
    const { db, bus } = this.deps;
    const job = getJob(db, jobId)!;
    const settings = this.settings();
    const action = job.config.action;
    const conflict = job.config.conflictPolicy;
    const items = allItems(db, jobId).filter(
      (i) => i.state === "ready" && !i.excluded && i.targetPath && (!onlyItems || onlyItems.includes(i.id)),
    );
    const summary: JobSummary = { jobId, done: 0, failed: 0, skipped: 0, source: job.sourcePaths.join(", ") };
    this.progress(job, "executing", 0, items.length);

    for (const [index, item] of items.entries()) {
      if (signal.aborted) break;
      try {
        const target = await resolveInRoots(item.targetPath!, allowedRoots(settings));
        const quality =
          conflict === "keep-better"
            ? (file: string, role: string) => this.quality(file, role === "incoming" ? item : undefined)
            : undefined;
        const result = await executeOperation({ from: item.sourcePath, to: target, action }, { conflict, quality });
        if (result.status === "done") {
          this.record(jobId, item.id, result.record);
          // Companions follow their main file with the same action. Subtitles of a replaced
          // worse file belong to it, so they are replaced too instead of compared by size.
          const companionConflict = conflict === "keep-better" ? "overwrite" : conflict;
          const companionErrors: string[] = [];
          for (const c of item.companions) {
            if (!c.to) continue;
            const cr = await executeOperation(
              { from: c.from, to: await resolveInRoots(c.to, allowedRoots(settings)), action },
              { conflict: companionConflict },
            );
            if (cr.status === "done") this.record(jobId, item.id, cr.record);
            else if (cr.status === "failed") companionErrors.push(`${path.basename(c.from)}: ${cr.error}`);
            else if (cr.status === "skipped") companionErrors.push(`${path.basename(c.from)}: ${cr.reason}`);
          }
          updateItem(db, item.id, {
            state: "done",
            targetPath: result.record.to,
            error: companionErrors.join("; ") || null,
            ...(result.note ? { reasons: [...item.reasons, result.note] } : {}),
          });
          removeFromInbox(db, item.id);
          summary.done++;
          if (action === "move") await cleanupEmptyDirs(path.dirname(item.sourcePath), job.sourcePaths[0] ?? "/").catch(() => []);
        } else if (result.status === "tested") {
          updateItem(db, item.id, {
            reasons: [...item.reasons, result.conflict ? msg("jobs_test_targetExists") : msg("jobs_test_ok")],
          });
        } else if (result.status === "skipped") {
          updateItem(db, item.id, { state: "skipped", reasons: [...item.reasons, result.reason] });
          summary.skipped++;
        } else {
          updateItem(db, item.id, { state: "failed", error: result.error });
          summary.failed++;
        }
      } catch (e) {
        updateItem(db, item.id, { state: "failed", error: (e as Error).message });
        summary.failed++;
      }
      bus.emit({ type: "item.updated", jobId, itemIds: [item.id] });
      this.progress(job, "executing", index + 1, items.length);
    }

    const status = action === "test" ? "ready" : signal.aborted ? "cancelled" : summary.failed && !summary.done ? "failed" : "done";
    updateJob(db, jobId, { status, finishedAt: new Date() });
    bus.emit({ type: "job.progress", jobId, status, done: items.length, total: items.length });
    if (action !== "test") {
      const notify = this.deps.notify ?? ((s, sum) => afterExecution(s, sum, (m, err) => this.deps.log.error({ err }, m)));
      void notify(settings, summary);
    }
    return summary;
  }

  private record(jobId: number, jobItemId: number, r: OperationRecord) {
    insertOperation(this.deps.db, {
      jobId,
      jobItemId,
      action: r.action,
      fromPath: r.from,
      toPath: r.to,
      size: r.size,
      inode: r.inode,
      backupPath: r.backup ?? null,
      createdDirs: r.createdDirs,
    });
  }

  // ---------- undo ----------

  /** Undo a whole job, some of its files, or single operations. Newest first, in the file queue. */
  undo(target: { jobId?: number; itemIds?: number[]; operationIds?: number[]; since?: Date }) {
    return this.serial(() => this.undoNow(target));
  }

  private async undoNow(target: { jobId?: number; itemIds?: number[]; operationIds?: number[]; since?: Date }) {
    const { db, bus } = this.deps;
    let ops = listOperations(db, { jobId: target.jobId, limit: 100_000, until: target.since });
    if (target.itemIds) ops = ops.filter((o) => o.jobItemId !== null && target.itemIds!.includes(o.jobItemId));
    if (target.operationIds) ops = ops.filter((o) => target.operationIds!.includes(o.id));
    const undone: number[] = [];
    const failed: { id: number; reason: string }[] = [];
    for (const op of ops) {
      const result = await undoOperation({
        action: op.action as Action,
        from: op.fromPath,
        to: op.toPath,
        size: op.size,
        inode: op.inode,
        backup: op.backupPath ?? undefined,
        createdDirs: op.createdDirs,
      });
      if (result.status === "undone") undone.push(op.id);
      else failed.push({ id: op.id, reason: result.reason });
    }
    markUndone(db, undone);
    const done = new Set(undone);
    const jobIds = [...new Set(ops.map((o) => o.jobId).filter((j): j is number => j !== null))];
    for (const jobId of jobIds) {
      const remaining = listOperations(db, { jobId, limit: 100_000 });
      const stillApplied = new Set(remaining.map((o) => o.jobItemId));
      const itemIds = [...new Set(ops.filter((o) => o.jobId === jobId && done.has(o.id) && o.jobItemId).map((o) => o.jobItemId!))];
      for (const id of itemIds) {
        // Only when the main file and all its companions went back is the item undone.
        if (stillApplied.has(id)) continue;
        if (getItem(db, id)?.state === "done") updateItem(db, id, { state: "undone", approved: false });
      }
      if (!remaining.length) updateJob(db, jobId, { status: "undone" });
      bus.emit({ type: "item.updated", jobId, itemIds });
    }
    return { undone: undone.length, failed };
  }
}
