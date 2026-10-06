import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  createWatchFolder,
  type Db,
  getJob,
  insertItems,
  createJob as insertJob,
  listInbox,
  listJobs,
  openDatabase,
  setSettings,
} from "@namarr/db";
import { DemoProvider } from "@namarr/providers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readEnv } from "~/server/env.server";
import { EventBus } from "~/server/events.server";
import { createHookJob, HookError, mapPath, readHookInput } from "~/server/hook.server";
import { JobService } from "~/server/jobs.server";
import type { Runtime } from "~/server/runtime.server";
import { WatchService } from "~/server/watch.server";

let tmp: string;
let db: Db;
let jobs: JobService;
const log = { info: () => {}, error: () => {} };

beforeEach(async () => {
  tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "namarr-auto-")));
  db = openDatabase(":memory:");
  setSettings(db, { folders: [{ path: tmp, name: "root", kind: "folder" }] });
  jobs = new JobService({ db, bus: new EventBus(), provider: () => new DemoProvider(), log, notify: async () => {} });
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const exists = (p: string) =>
  fs.stat(p).then(
    () => true,
    () => false,
  );

async function touch(rel: string, content = rel) {
  const full = path.join(tmp, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content);
  return full;
}

describe("Watch-Folder: Abgleich beim Start", () => {
  let watch: WatchService | undefined;
  afterEach(async () => {
    await watch?.stop();
  });

  it("nimmt verpasste Dateien, lässt bekannte und alten Bestand liegen", async () => {
    const dl = path.join(tmp, "dl");
    await fs.mkdir(dl, { recursive: true });
    const folder = createWatchFolder(db, {
      name: "TV",
      path: dl,
      targets: { movie: path.join(tmp, "media"), series: path.join(tmp, "media") },
      stableSeconds: 1,
    });
    // Arrived while the server was down:
    const missed = await touch("dl/Severance.S02.German.DL.1080p.WEB-GRP/severance.s02e01.mkv");
    // Already taken by a job (e.g. copied, the download stays):
    const known = await touch("dl/Severance.S02.German.DL.1080p.WEB-GRP/severance.s02e02.mkv");
    const job = insertJob(db, { sourcePaths: [dl], config: { mode: "media", action: "copy", conflictPolicy: "skip" } });
    insertItems(db, [{ jobId: job.id, sourcePath: known }]);
    // Not a video, temp file, hidden:
    await touch("dl/notes.txt");
    await touch("dl/x.mkv.part");
    await touch("dl/.hidden.mkv");

    watch = new WatchService({ db, bus: new EventBus(), jobs, log }, 50);
    const taken = await watch.catchUp(folder);
    expect(taken).toEqual([missed]);
  });

  it("alter Bestand vor dem Anlegen des Watch-Folders bleibt unberührt", async () => {
    await touch("dl/Old.Show.S01E01.mkv");
    const folder = createWatchFolder(db, {
      name: "TV",
      path: path.join(tmp, "dl"),
      targets: { movie: path.join(tmp, "media"), series: path.join(tmp, "media") },
      stableSeconds: 1,
    });
    db.$client.exec(`update watch_folders set created_at = ${Date.now() + 60_000} where id = ${folder.id}`);
    watch = new WatchService({ db, bus: new EventBus(), jobs, log }, 50);
    expect(await watch.catchUp({ ...folder, createdAt: new Date(Date.now() + 60_000) })).toEqual([]);
  });

  it("wartet, bis eine Datei nicht mehr wächst", async () => {
    const folder = createWatchFolder(db, {
      name: "TV",
      path: path.join(tmp, "dl"),
      targets: { movie: path.join(tmp, "media"), series: path.join(tmp, "media") },
      stableSeconds: 1,
    });
    const file = await touch("dl/Growing.S01E01.mkv", "a");
    watch = new WatchService({ db, bus: new EventBus(), jobs, log }, 50);
    const started = Date.now();
    const result = watch.catchUp(folder);
    await new Promise((r) => setTimeout(r, 500));
    await fs.appendFile(file, "more data");
    expect(await result).toEqual([file]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1900); // two rounds
  });

  it("beim Start wird daraus ein Watch-Job", async () => {
    const dl = path.join(tmp, "dl");
    const folder = createWatchFolder(db, {
      name: "TV",
      path: dl,
      targets: { movie: path.join(tmp, "media"), series: path.join(tmp, "media") },
      options: { formats: { series: "plex" }, action: "copy" },
      stableSeconds: 1,
    });
    await touch("dl/Severance.S02E01.German.DL.1080p.WEB.h264-GRP.mkv");
    watch = new WatchService({ db, bus: new EventBus(), jobs, log }, 50);
    await watch.reload();
    await expect.poll(() => listJobs(db).length, { timeout: 5000 }).toBe(1);
    await jobs.idle();
    const [job] = listJobs(db);
    expect(job).toMatchObject({ kind: "watch", watchFolderId: folder.id, status: "done" });
    expect(job!.config.formats).toEqual({ movie: "jellyfin", series: "plex" });
    expect(await exists(path.join(tmp, "media/Severance (2022)/Season 02"))).toBe(true);
  });

  it("stop() bricht einen laufenden Abgleich ab", async () => {
    const folder = createWatchFolder(db, {
      name: "TV",
      path: path.join(tmp, "dl"),
      targets: { movie: path.join(tmp, "media"), series: path.join(tmp, "media") },
      stableSeconds: 1,
    });
    await touch("dl/A.S01E01.mkv");
    watch = new WatchService({ db, bus: new EventBus(), jobs, log }, 50);
    const result = watch.catchUp(folder);
    await watch.stop();
    expect(await result).toEqual([]);
  });
});

describe("Hook für Download-Clients", () => {
  const rt = () => ({ db, jobs, env: readEnv({ NAMARR_PATH_MAP: `/downloads:${path.join(tmp, "dl")}` }) }) as unknown as Runtime;
  const req = (body: BodyInit | undefined, type?: string, query = "") =>
    new Request(`http://x/api/jobs${query}`, { method: "POST", body, headers: type ? { "content-type": type } : {} });

  it("liest JSON, Formulare und Query-Parameter", async () => {
    expect(await readHookInput(req(JSON.stringify({ path: "/a", watchFolder: 2, review: true }), "application/json"))).toEqual({
      path: "/a",
      watchFolder: 2,
      review: true,
    });
    expect(
      await readHookInput(
        req(new URLSearchParams({ path: "/b", watchFolder: "Serien", review: "0" }), "application/x-www-form-urlencoded"),
      ),
    ).toEqual({
      path: "/b",
      watchFolder: "Serien",
      review: false,
    });
    expect(await readHookInput(req(undefined, undefined, "?path=/c&threshold=0.8&target="))).toEqual({ path: "/c", threshold: 0.8 });
    await expect(readHookInput(req("{", "application/json"))).rejects.toThrow(HookError);
    await expect(readHookInput(req(JSON.stringify({}), "application/json"))).rejects.toThrow(/path/);
    await expect(readHookInput(req(undefined, undefined, "?path=/c&threshold=2"))).rejects.toThrow(/threshold/);
  });

  it("übersetzt Pfade anderer Container", () => {
    const map: [string, string][] = [
      ["/downloads", "/data/downloads"],
      ["/downloads/tv", "/data/tv"],
    ];
    expect(mapPath("/downloads/movies/x.mkv", map)).toBe("/data/downloads/movies/x.mkv");
    expect(mapPath("/downloads/tv/x.mkv", map)).toBe("/data/tv/x.mkv");
    expect(mapPath("/downloadsX/y", map)).toBe("/downloadsX/y");
    expect(mapPath("/other/y", map)).toBe("/other/y");
  });

  it("legt einen Job an, der wie ein Watch-Job läuft", async () => {
    await touch("dl/Severance.S02.German.DL.1080p.WEB-GRP/Severance.S02E01.German.DL.1080p.WEB.h264-GRP.mkv");
    await touch("dl/Severance.S02.German.DL.1080p.WEB-GRP/severance.204-205.720p.mkv");
    const folder = createWatchFolder(db, {
      name: "Serien",
      path: path.join(tmp, "dl"),
      targets: { movie: path.join(tmp, "media"), series: path.join(tmp, "media") },
      options: { action: "copy" },
    });
    const job = await createHookJob(rt(), { path: "/downloads/Severance.S02.German.DL.1080p.WEB-GRP", watchFolder: "serien" });
    expect(job).toMatchObject({
      kind: "hook",
      watchFolderId: folder.id,
      sourcePaths: [path.join(tmp, "dl/Severance.S02.German.DL.1080p.WEB-GRP")],
    });
    await jobs.idle();
    expect(getJob(db, job.id)?.status).toBe("done");
    expect(await exists(path.join(tmp, "media/Severance (2022)/Season 02/Severance (2022) - S02E01 - Hallo, Frau Cobel.mkv"))).toBe(true);
    // The uncertain double episode waits in the inbox
    expect(listInbox(db).map((e) => path.basename(e.item.sourcePath))).toEqual(["severance.204-205.720p.mkv"]);
  });

  it("übernimmt Format, Ziel und Schwelle eines Watch-Folders, review hält alles an", async () => {
    await touch("dl/Severance.S02E01.German.DL.1080p.WEB.h264-GRP.mkv");
    createWatchFolder(db, {
      name: "TV",
      path: path.join(tmp, "dl"),
      targets: { movie: path.join(tmp, "media"), series: path.join(tmp, "media") },
      autoThreshold: 0.95,
    });
    const job = await createHookJob(rt(), {
      path: path.join(tmp, "dl/Severance.S02E01.German.DL.1080p.WEB.h264-GRP.mkv"),
      watchFolder: "tv",
      review: true,
    });
    expect(job.config).toMatchObject({
      targets: { movie: path.join(tmp, "media"), series: path.join(tmp, "media") },
      alwaysReview: true,
      action: "move",
    });
    await jobs.idle();
    expect(listInbox(db)).toHaveLength(1);
    await expect(fs.readdir(path.join(tmp, "media")).catch(() => [])).resolves.toEqual([]);
  });

  it("verständliche Fehler mit HTTP-Status", async () => {
    await touch("dl/a.mkv");
    const err = (p: Promise<unknown>) =>
      p.then(
        () => null,
        (e: HookError) => [e.status, e.message],
      );
    expect(await err(createHookJob(rt(), { path: path.join(tmp, "dl/a.mkv") }))).toEqual([
      400,
      expect.stringContaining("No target folder"),
    ]);
    expect(await err(createHookJob(rt(), { path: "/etc/passwd", target: path.join(tmp, "media") }))).toEqual([
      403,
      expect.stringContaining("outside"),
    ]);
    expect(await err(createHookJob(rt(), { path: path.join(tmp, "dl/missing.mkv"), target: path.join(tmp, "media") }))).toEqual([
      404,
      expect.stringContaining("not found"),
    ]);
    expect(await err(createHookJob(rt(), { path: path.join(tmp, "dl/a.mkv"), watchFolder: "Gibt es nicht" }))).toEqual([
      404,
      "Unknown watch folder: Gibt es nicht",
    ]);
    // Profiles are gone: an old hook call says what to send instead.
    expect(await err(createHookJob(rt(), { path: path.join(tmp, "dl/a.mkv"), profile: "Serien" }))).toEqual([
      400,
      expect.stringContaining("watchFolder"),
    ]);
  });
});
