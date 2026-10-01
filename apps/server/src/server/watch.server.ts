import * as path from "node:path";
import { VIDEO_EXTENSIONS } from "@namarr/core";
import { type Db, getProfile, listWatchFolders, updateWatchFolder, type WatchFolder } from "@namarr/db";
import { type FSWatcher, watch } from "chokidar";
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
    watcher.on("error", (err) => this.deps.log.error({ err, folder: folder.path }, "Watch-Folder-Fehler"));
    this.watchers.set(folder.id, watcher);
    this.deps.log.info({ folder: folder.path }, "Watch-Folder aktiv");
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
    const profile = folder.profileId ? getProfile(this.deps.db, folder.profileId) : undefined;
    // One job per release folder (or per loose file), so folder context stays intact.
    const roots = new Set([...batch.files].map((f) => (path.dirname(f) === folder.path ? f : topFolder(folder.path, f))));
    for (const root of roots) {
      try {
        await this.deps.jobs.create({
          paths: [root],
          kind: "watch",
          watchFolderId: folder.id,
          profileId: profile?.id ?? null,
          config: {
            mode: (profile?.mode as "media" | "rules" | "both" | undefined) ?? "media",
            preset: profile?.preset ?? "jellyfin",
            template: profile?.template ?? {},
            rules: profile?.rulesJson ?? [],
            action: profile?.action && profile.action !== "test" ? profile.action : "hardlink",
            conflictPolicy: profile?.conflictPolicy ?? "skip",
            targetRoot: folder.targetRoot,
            autoThreshold: folder.autoThreshold ?? undefined,
            alwaysReview: folder.autoThreshold === null,
          },
        });
      } catch (err) {
        this.deps.log.error({ err, root }, "Watch-Job konnte nicht angelegt werden");
      }
    }
  }

  async stop(): Promise<void> {
    await Promise.all([...this.watchers.values()].map((w) => w.close()));
    this.watchers.clear();
    for (const b of this.pending.values()) clearTimeout(b.timer);
    this.pending.clear();
  }
}

function topFolder(root: string, file: string): string {
  const first = path.relative(root, file).split(path.sep)[0]!;
  return path.join(root, first);
}
