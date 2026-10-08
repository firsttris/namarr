import * as fs from "node:fs/promises";
import * as path from "node:path";
import { VIDEO_EXTENSIONS } from "@namarr/core";
import { type Db, getSettings, knownSourcePaths, listWatchFolders, resolveTargets, updateWatchFolder, type WatchFolder } from "@namarr/db";
import { type FSWatcher, watch } from "chokidar";
import { automaticConfig } from "./automation.server.ts";
import type { EventBus } from "./events.server.ts";
import type { JobService } from "./jobs.server.ts";

/** Endings of files still being written by a download client. */
export const TEMP_ENDINGS = [".part", ".!qb", ".tmp", ".crdownload", ".partial", ".aria2"];

export function isCandidate(file: string): boolean {
  const lower = file.toLowerCase();
  if (TEMP_ENDINGS.some((e) => lower.endsWith(e))) return false;
  if (/(^|[\\/])(sample|@eadir)([\\/]|$)/i.test(file) || path.basename(file).startsWith(".")) return false;
  return VIDEO_EXTENSIONS.includes(path.extname(lower).slice(1));
}

type Deps = {
  db: Db;
  bus: EventBus;
  jobs: JobService;
  log: { info: (o: object, m?: string) => void; error: (o: object, m?: string) => void };
};

/**
 * Watches the enabled folders. A file counts as finished once size and mtime were stable
 * for `stableSeconds` (chokidar's awaitWriteFinish). Finished files are batched per folder
 * into one watch job, so a season pack becomes one job, not ten.
 */
export class WatchService {
  private watchers = new Map<number, FSWatcher>();
  private pending = new Map<number, { files: Set<string>; timer: ReturnType<typeof setTimeout> }>();
  /** Bumped by stop(): a catch-up of an older generation gives up. */
  private generation = 0;

  constructor(
    private readonly deps: Deps,
    private readonly batchMs = 5_000,
  ) {}

  async reload(): Promise<void> {
    await this.stop();
    for (const folder of listWatchFolders(this.deps.db)) {
      if (folder.enabled) this.start(folder);
    }
  }

  private start(folder: WatchFolder) {
    const watcher = watch(folder.path, {
      ignoreInitial: true,
      ignored: (p, stats) => Boolean(stats?.isFile() && !isCandidate(p)),
      awaitWriteFinish: { stabilityThreshold: folder.stableSeconds * 1000, pollInterval: 1000 },
      depth: 10,
    });
    watcher.on("add", (file) => this.detected(folder, file));
    watcher.on("error", (err) => this.deps.log.error({ err, folder: folder.path }, "Watch folder error"));
    this.watchers.set(folder.id, watcher);
    this.deps.log.info({ folder: folder.path }, "Watch folder active");
    void this.catchUp(folder, this.generation).catch((err) => this.deps.log.error({ err, folder: folder.path }, "Catch-up failed"));
  }

  /**
   * Files that arrived while the server was down: chokidar only reports changes from now on.
   * Taken are video files that no job knows yet and that appeared after the watch folder was
   * created (ctime), so an old backlog is left alone; that is what the workbench is for.
   * Files still being written are waited for until size and mtime stay put.
   */
  async catchUp(folder: WatchFolder, generation = this.generation): Promise<string[]> {
    const known = knownSourcePaths(this.deps.db, folder.path);
    // Some slack: file systems stamp ctime from a coarser clock than Date.now().
    const since = folder.createdAt.getTime() - 2_000;
    const candidates: { file: string; size: number; mtime: number }[] = [];
    for (const file of await listFiles(folder.path)) {
      if (!isCandidate(file) || known.has(file)) continue;
      const st = await fs.stat(file).catch(() => undefined);
      if (st?.isFile() && st.ctimeMs >= since) candidates.push({ file, size: st.size, mtime: st.mtimeMs });
    }
    if (!candidates.length) return [];
    this.deps.log.info({ folder: folder.path, files: candidates.length }, "Watch folder: missed files found");

    const taken: string[] = [];
    let waiting = candidates;
    while (waiting.length && generation === this.generation) {
      await new Promise((r) => setTimeout(r, folder.stableSeconds * 1000));
      if (generation !== this.generation) break;
      const still: typeof waiting = [];
      for (const c of waiting) {
        const st = await fs.stat(c.file).catch(() => undefined);
        if (!st) continue; // moved away meanwhile
        if (st.size === c.size && st.mtimeMs === c.mtime) {
          this.detected(folder, c.file);
          taken.push(c.file);
        } else still.push({ file: c.file, size: st.size, mtime: st.mtimeMs });
      }
      waiting = still;
    }
    return taken;
  }

  private detected(folder: WatchFolder, file: string) {
    if (!isCandidate(file)) return;
    this.deps.bus.emit({ type: "watch.detected", watchFolderId: folder.id, path: file });
    updateWatchFolder(this.deps.db, folder.id, { lastEventAt: new Date() });
    let batch = this.pending.get(folder.id);
    if (!batch) {
      batch = { files: new Set(), timer: setTimeout(() => this.flush(folder.id), this.batchMs) };
      this.pending.set(folder.id, batch);
    }
    batch.files.add(file);
  }

  /** Creates the watch job for everything collected in this folder. */
  async flush(folderId: number): Promise<void> {
    const batch = this.pending.get(folderId);
    this.pending.delete(folderId);
    if (!batch?.files.size) return;
    clearTimeout(batch.timer);
    const folder = listWatchFolders(this.deps.db).find((f) => f.id === folderId);
    if (!folder) return;
    const settings = getSettings(this.deps.db);
    // One job per release folder (or per loose file), so folder context stays intact.
    const roots = new Set([...batch.files].map((f) => (path.dirname(f) === folder.path ? f : topFolder(folder.path, f))));
    for (const root of roots) {
      try {
        await this.deps.jobs.create({
          paths: [root],
          kind: "watch",
          watchFolderId: folder.id,
          config: automaticConfig(settings, folder, {
            // The watch folder's own folders first, then the default libraries.
            targets: resolveTargets(settings, folder.targets),
            autoThreshold: folder.autoThreshold,
          }),
        });
      } catch (err) {
        this.deps.log.error({ err, root }, "Could not create watch job");
      }
    }
  }

  async stop(): Promise<void> {
    this.generation++;
    await Promise.all([...this.watchers.values()].map((w) => w.close()));
    this.watchers.clear();
    for (const b of this.pending.values()) clearTimeout(b.timer);
    this.pending.clear();
  }
}

/** All files below `dir`, without hidden folders and Synology's @eaDir. */
async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") || e.name === "@eaDir") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listFiles(full)));
    else if (e.isFile()) out.push(full);
  }
  return out;
}

function topFolder(root: string, file: string): string {
  const first = path.relative(root, file).split(path.sep)[0]!;
  return path.join(root, first);
}
