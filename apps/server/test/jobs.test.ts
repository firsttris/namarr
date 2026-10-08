import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { APPROVED, DOUBLE_EPISODE, type Parsed } from "@namarr/core";
import {
  allItems,
  createWatchFolder,
  type Db,
  getJob,
  type JobConfig,
  listInbox,
  listOperations,
  listOverrides,
  openDatabase,
  type Settings,
  setSettings,
} from "@namarr/db";
import { DemoProvider } from "@namarr/providers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localizeIn } from "~/lib/i18n";
import { EventBus, type NamarrEvent } from "~/server/events.server";
import { cleanupStop, JobService } from "~/server/jobs.server";
import type { JobSummary } from "~/server/notify.server";

let tmp: string;
let db: Db;
let bus: EventBus;
let events: NamarrEvent[];
let jobs: JobService;
let notify: ReturnType<typeof vi.fn<(settings: Settings, summary: JobSummary) => Promise<void>>>;

const log = { info: () => {}, error: () => {} };
const tv = () => path.join(tmp, "downloads/tv");
const media = () => path.join(tmp, "media/tv");

async function touch(rel: string, content = rel) {
  const full = path.join(tmp, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content);
  return full;
}
const exists = (p: string) =>
  fs.access(p).then(
    () => true,
    () => false,
  );

beforeEach(async () => {
  tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "namarr-jobs-")));
  db = openDatabase(":memory:");
  setSettings(db, { folders: [{ path: tmp, name: "root", kind: "folder" }] });
  bus = new EventBus();
  events = [];
  bus.subscribe((e) => events.push(e));
  notify = vi.fn(async (_settings: Settings, _summary: JobSummary) => {});
  jobs = new JobService({ db, bus, provider: () => new DemoProvider(), log, notify });
  await touch("downloads/tv/Severance.S02E01.German.DL.1080p.WEB.h264-GRP.mkv");
  await touch("downloads/tv/Severance.S02E01.German.DL.1080p.WEB.h264-GRP.de.srt");
  await touch("downloads/tv/Severance.S02E02.German.DL.1080p.WEB.h264-GRP.mkv");
  await touch("downloads/tv/severance.204-205.720p.mkv");
  await touch("downloads/tv/Severance.S02E01.sample.mkv");
  await fs.mkdir(media(), { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const config = (extra: Partial<JobConfig> = {}): JobConfig => ({
  mode: "media",
  preset: "jellyfin",
  action: "copy",
  conflictPolicy: "skip",
  targetRoot: media(),
  ...extra,
});

async function analyzed(extra: Partial<JobConfig> = {}, kind: "manual" | "watch" = "manual") {
  const job = await jobs.create({ paths: [tv()], config: config(extra), kind });
  await jobs.idle();
  const items = allItems(db, job.id);
  const by = (name: string) => items.find((i) => i.sourcePath.endsWith(`/${name}`))!;
  return { job: getJob(db, job.id)!, items, by };
}

describe("JobService: Analyse", () => {
  it("{imdb} im Template: die IDs kommen einmal pro Titel aus den Details", async () => {
    const { by } = await analyzed({ template: { episode: "{n} [imdbid-{imdb}]/{s00e00}" } });
    expect(by("Severance.S02E01.German.DL.1080p.WEB.h264-GRP.mkv").targetPath).toBe(
      path.join(media(), "Severance [imdbid-tt11280740]/S02E01.mkv"),
    );
    expect((by("Severance.S02E02.German.DL.1080p.WEB.h264-GRP.mkv").matchJson as { best: { ids?: object } }).best.ids).toEqual({
      tmdb: "95396",
      imdb: "tt11280740",
    });
  });

  it("scannt, parst, matcht und berechnet die Vorschau im Worker", async () => {
    const { job, items, by } = await analyzed();
    expect(job.status).toBe("ready");
    expect(items).toHaveLength(4);
    const e1 = by("Severance.S02E01.German.DL.1080p.WEB.h264-GRP.mkv");
    expect(e1.state).toBe("ready");
    expect(e1.targetPath).toBe(path.join(media(), "Severance (2022)/Season 02/Severance (2022) - S02E01 - Hallo, Frau Cobel.mkv"));
    expect(e1.companions).toEqual([
      {
        from: path.join(tv(), "Severance.S02E01.German.DL.1080p.WEB.h264-GRP.de.srt"),
        to: path.join(media(), "Severance (2022)/Season 02/Severance (2022) - S02E01 - Hallo, Frau Cobel.de.srt"),
        suffix: ".de.srt",
      },
    ]);
    expect(by("severance.204-205.720p.mkv").state).toBe("needs_review");
    expect(by("Severance.S02E01.sample.mkv").state).toBe("skipped");
    const statuses = events.filter((e) => e.type === "job.progress").map((e) => (e as { status: string }).status);
    expect(statuses).toEqual(expect.arrayContaining(["scanning", "matching", "ready"]));
  });

  it("lehnt Pfade außerhalb der Wurzelpfade ab", async () => {
    await expect(jobs.create({ paths: ["/etc"], config: config() })).rejects.toThrow(/paths_outsideRoots/);
    await expect(jobs.create({ paths: [tv()], config: config({ targetRoot: "/etc" }) })).rejects.toThrow(/paths_outsideRoots/);
  });

  it("ohne Anbieter schlägt der Job mit verständlicher Meldung fehl", async () => {
    jobs = new JobService({ db, bus, provider: () => undefined, log, notify });
    const job = await jobs.create({ paths: [tv()], config: config() });
    await jobs.idle();
    expect(getJob(db, job.id)).toMatchObject({ status: "failed", error: expect.stringContaining("jobs_error_noProvider") });
  });

  it("Regel-Modus benennt ohne Matching am Ort um", async () => {
    const job = await jobs.create({
      paths: [tv()],
      config: config({ mode: "rules", targetRoot: undefined, rules: [{ type: "case", mode: "lower" }] }),
    });
    await jobs.idle();
    const item = allItems(db, job.id).find((i) => i.sourcePath.endsWith("Severance.S02E02.German.DL.1080p.WEB.h264-GRP.mkv"))!;
    expect(item.targetPath).toBe(path.join(tv(), "severance.s02e02.german.dl.1080p.web.h264-grp.mkv"));
  });
});

describe("JobService: Regeln mit Daten aus der Datei", () => {
  /** A JPEG with EXIF DateTimeOriginal (little-endian TIFF block in APP1). */
  function photo(date: string): Uint8Array {
    const t = new Uint8Array(76 + 20);
    const v = new DataView(t.buffer);
    t.set(new TextEncoder().encode("II"), 0);
    v.setUint16(2, 42, true);
    v.setUint32(4, 8, true);
    v.setUint16(8, 1, true);
    v.setUint16(10, 0x8769, true);
    v.setUint16(12, 4, true);
    v.setUint32(14, 1, true);
    v.setUint32(18, 38, true);
    v.setUint16(38, 1, true);
    v.setUint16(40, 0x9003, true);
    v.setUint16(42, 2, true);
    v.setUint32(44, 20, true);
    v.setUint32(48, 76, true);
    t.set(new TextEncoder().encode(`${date}\0`), 76);
    const len = 8 + t.length;
    return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 0xff, ...new TextEncoder().encode("Exif\0\0"), ...t, 0xff, 0xda, 0, 2]);
  }

  it("Fotos nach Aufnahmedatum, Musik nach Tags in Ordner; Daten werden nur einmal gelesen", async () => {
    const dir = path.join(tmp, "mixed");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "IMG_0001.JPG"), photo("2024:07:14 18:03:22"));
    await fs.writeFile(path.join(dir, "DSC_9.jpg"), photo("2023:12:24 20:15:00"));
    await fs.writeFile(path.join(dir, "scan.jpg"), "no exif");
    await fs.writeFile(path.join(dir, "track03.mp3"), "mp3");
    const probe = vi.fn(async (file: string) =>
      file.endsWith(".mp3")
        ? { audio: [], tags: { artist: "Queen", album: "A Night at the Opera", track: "11/12", title: "Bohemian Rhapsody" } }
        : undefined,
    );
    jobs = new JobService({ db, bus, provider: () => new DemoProvider(), log, notify, probe });
    const rules = [
      { type: "metadata" as const, template: "{date:YYYY-MM-DD HH-mm-ss}" },
      { type: "metadata" as const, template: "{artist}/{album}/{track} {title}" },
    ];
    const job = await jobs.create({ paths: [dir], config: config({ mode: "rules", targetRoot: undefined, rules }) });
    await jobs.idle();
    const target = (name: string) => allItems(db, job.id).find((i) => i.sourcePath.endsWith(`/${name}`))!.targetPath;
    expect(target("IMG_0001.JPG")).toBe(path.join(dir, "2024-07-14 18-03-22.JPG"));
    expect(target("DSC_9.jpg")).toBe(path.join(dir, "2023-12-24 20-15-00.jpg"));
    expect(target("scan.jpg")).toBe(path.join(dir, "scan.jpg"));
    expect(target("track03.mp3")).toBe(path.join(dir, "Queen/A Night at the Opera/11 Bohemian Rhapsody.mp3"));
    expect(probe).toHaveBeenCalledTimes(1);

    // Editing the rules recomputes the preview; the files are not read again
    await jobs.recompute(job.id, { rules: [...rules, { type: "case", mode: "lower" }] });
    expect(target("track03.mp3")).toBe(path.join(dir, "Queen/A Night at the Opera/11 bohemian rhapsody.mp3"));
    expect(probe).toHaveBeenCalledTimes(1);

    // Renaming creates the folders; undo removes them again
    await jobs.executeNow(job.id, { action: "move" });
    expect(await exists(path.join(dir, "Queen/A Night at the Opera/11 bohemian rhapsody.mp3"))).toBe(true);
    await jobs.undo({ jobId: job.id });
    expect(await exists(path.join(dir, "track03.mp3"))).toBe(true);
    expect(await exists(path.join(dir, "Queen"))).toBe(false);
  });
});

describe("JobService: Aufräumen nach dem Verschieben", () => {
  it("bis wohin leere Ordner verschwinden", () => {
    const settings = { folders: [{ path: "/dl", name: "dl", kind: "folder" as const }] };
    // The folder chosen in the workbench stays.
    expect(cleanupStop({ kind: "manual", sourcePaths: ["/dl/tv"] }, "/dl/tv/a/x.mkv", settings)).toBe("/dl/tv");
    // A release folder from a watch folder or a download client goes too.
    expect(cleanupStop({ kind: "watch", sourcePaths: ["/dl/tv/Rel"] }, "/dl/tv/Rel/x.mkv", settings)).toBe("/dl/tv");
    // A single file: its folder stays.
    expect(cleanupStop({ kind: "hook", sourcePaths: ["/dl/x.mkv"] }, "/dl/x.mkv", settings)).toBe("/dl");
    // A folder from the settings never goes.
    expect(cleanupStop({ kind: "hook", sourcePaths: ["/dl"] }, "/dl/Rel/x.mkv", settings)).toBe("/dl");
    // Several sources: the one the file comes from.
    expect(cleanupStop({ kind: "manual", sourcePaths: ["/a", "/b"] }, "/b/c/x.mkv", settings)).toBe("/b");
  });

  it("Watch-Job: der Release-Ordner verschwindet mit dem Verschieben", async () => {
    const release = path.join(tv(), "Severance.S02.German.DL.1080p.WEB-GRP");
    await touch("downloads/tv/Severance.S02.German.DL.1080p.WEB-GRP/Severance.S02E03.German.DL.1080p.WEB.h264-GRP.mkv");
    await touch("downloads/tv/Severance.S02.German.DL.1080p.WEB-GRP/release.sfv");
    // Sure matches run on their own in a watch job.
    await jobs.create({ paths: [release], config: config({ action: "move", autoThreshold: 0.5 }), kind: "watch" });
    await jobs.idle();
    expect(await exists(path.join(media(), "Severance (2022)/Season 02/Severance (2022) - S02E03 - Wer ist lebendig.mkv"))).toBe(true);
    expect(await exists(release)).toBe(false);
    expect(await exists(tv())).toBe(true);
  });
});

describe("JobService: Watch-Jobs auf denselben Release-Ordner", () => {
  it("der zweite Job nimmt nur, was noch kein Job kennt", async () => {
    const release = path.join(tv(), "Severance.S02.German.DL.1080p.WEB-GRP");
    await touch("downloads/tv/Severance.S02.German.DL.1080p.WEB-GRP/Severance.S02E03.German.DL.1080p.WEB.h264-GRP.mkv");
    await jobs.create({ paths: [release], config: config({ action: "copy", autoThreshold: 0.5 }), kind: "watch" });
    await jobs.idle();
    // The next file of the pack finishes later; with copy the first one is still there.
    await touch("downloads/tv/Severance.S02.German.DL.1080p.WEB-GRP/Severance.S02E04.German.DL.1080p.WEB.h264-GRP.mkv");
    const second = await jobs.create({ paths: [release], config: config({ action: "copy", autoThreshold: 0.5 }), kind: "watch" });
    await jobs.idle();
    expect(allItems(db, second.id).map((i) => path.basename(i.sourcePath))).toEqual(["Severance.S02E04.German.DL.1080p.WEB.h264-GRP.mkv"]);
  });
});

describe("JobService: Vorschau neu berechnen ohne neues Matching", () => {
  it("Template, Regeln und Ziel ändern", async () => {
    const { job, by } = await analyzed();
    await jobs.recompute(job.id, {
      template: { episode: "{n}/{s00e00}" },
      mode: "both",
      rules: [{ type: "insert", text: "x-", position: "start" }],
    });
    const items = allItems(db, job.id);
    const e1 = items.find((i) => i.id === by("Severance.S02E01.German.DL.1080p.WEB.h264-GRP.mkv").id)!;
    expect(e1.targetPath).toBe(path.join(media(), "Severance/x-S02E01.mkv"));
    await jobs.recompute(job.id, { targetRoot: null });
    const inPlace = allItems(db, job.id).find((i) => i.id === e1.id)!;
    expect(inPlace.targetPath?.startsWith(tv())).toBe(true);
  });

  it("Mediathek: Serien in den Serien-Ordner, umschaltbar auf am Ort und zurück", async () => {
    const shows = path.join(tmp, "media/shows");
    await fs.mkdir(shows, { recursive: true });
    setSettings(db, {
      folders: [
        { path: tmp, name: "root", kind: "folder" },
        { path: shows, name: "Serien", kind: "series", default: true },
      ],
    });
    const { job, by } = await analyzed({ targetRoot: undefined, targets: { series: shows } });
    const e1 = () => allItems(db, job.id).find((i) => i.id === by("Severance.S02E01.German.DL.1080p.WEB.h264-GRP.mkv").id)!;
    expect(e1().targetPath?.startsWith(`${shows}/Severance (2022)/`)).toBe(true);
    await jobs.recompute(job.id, { targets: null });
    expect(e1().targetPath?.startsWith(tv())).toBe(true);
    await jobs.recompute(job.id, { targets: "library" });
    expect(e1().targetPath?.startsWith(`${shows}/`)).toBe(true);
    // A folder chosen for the whole job wins over the library.
    await jobs.recompute(job.id, { targetRoot: media() });
    expect(e1().targetPath?.startsWith(`${media()}/Severance (2022)/`)).toBe(true);
  });

  it("Treffer manuell wählen, merken, ausschließen, Ziel überschreiben", async () => {
    const { job, by } = await analyzed();
    const double = by("severance.204-205.720p.mkv");
    const chosen = await jobs.updateItem(double.id, { match: { id: "95396", kind: "series" }, remember: true, approve: true });
    expect(chosen.state).toBe("ready");
    expect(chosen.confidence).toBe(1);
    expect(listOverrides(db)).toMatchObject([{ pattern: "severance", externalId: "95396" }]);

    const excluded = await jobs.updateItem(by("Severance.S02E02.German.DL.1080p.WEB.h264-GRP.mkv").id, { excluded: true });
    expect(excluded.state).toBe("skipped");

    const manual = await jobs.updateItem(by("Severance.S02E01.German.DL.1080p.WEB.h264-GRP.mkv").id, { targetPath: "Eigene/Datei.mkv" });
    expect(manual.targetPath).toBe(path.join(media(), "Eigene/Datei.mkv"));
    await expect(jobs.updateItem(manual.id, { targetPath: "../../../etc/x" })).rejects.toThrow(/paths_outsideRoots/);
    expect(getJob(db, job.id)!.status).toBe("ready");
  });
});

describe("JobService: Ausführen und Undo", () => {
  it("Hardlinks mit Begleitdateien, History, Undo", async () => {
    const { job, by } = await analyzed();
    const summary = await jobs.executeNow(job.id);
    expect(summary).toMatchObject({ done: 2, failed: 0 });
    const target = by("Severance.S02E01.German.DL.1080p.WEB.h264-GRP.mkv").targetPath!;
    expect(await exists(target)).toBe(true);
    expect(await exists(target.replace(/\.mkv$/, ".de.srt"))).toBe(true);
    // Hardlink keeps the download for seeding
    expect(await exists(path.join(tv(), "Severance.S02E01.German.DL.1080p.WEB.h264-GRP.mkv"))).toBe(true);
    expect(listOperations(db, { jobId: job.id })).toHaveLength(3);
    expect(getJob(db, job.id)!.status).toBe("done");
    expect(notify).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ done: 2 }));

    const result = await jobs.undo({ jobId: job.id });
    expect(result).toEqual({ undone: 3, failed: [] });
    expect(await exists(path.join(media(), "Severance (2022)"))).toBe(false);
    expect(getJob(db, job.id)!.status).toBe("undone");
    expect(allItems(db, job.id).filter((i) => i.state === "undone")).toHaveLength(2);
  });

  it("Test-Aktion verändert nichts und lässt den Job bereit", async () => {
    const { job } = await analyzed({ action: "test" });
    await jobs.executeNow(job.id);
    expect(await fs.readdir(media())).toEqual([]);
    expect(getJob(db, job.id)!.status).toBe("ready");
    expect(notify).not.toHaveBeenCalled();
  });

  it("Konflikt: vorhandenes Ziel wird markiert und übersprungen", async () => {
    await touch("media/tv/Severance (2022)/Season 02/Severance (2022) - S02E01 - Hallo, Frau Cobel.mkv", "alt");
    const { job, by } = await analyzed();
    expect(by("Severance.S02E01.German.DL.1080p.WEB.h264-GRP.mkv").conflict).toBe("exists");
    await jobs.executeNow(job.id);
    const after = allItems(db, job.id).find((i) => i.sourcePath.endsWith("Severance.S02E01.German.DL.1080p.WEB.h264-GRP.mkv"))!;
    expect(after.state).toBe("skipped");
    expect(await fs.readFile(after.targetPath!, "utf8")).toBe("alt");
  });

  it("Undo einzelner Dateien", async () => {
    const { job, by } = await analyzed();
    await jobs.executeNow(job.id);
    const e2 = by("Severance.S02E02.German.DL.1080p.WEB.h264-GRP.mkv");
    await jobs.undo({ itemIds: [e2.id] });
    expect(await exists(e2.targetPath!)).toBe(false);
    expect(await exists(by("Severance.S02E01.German.DL.1080p.WEB.h264-GRP.mkv").targetPath!)).toBe(true);
    expect(getJob(db, job.id)!.status).toBe("done");
  });

  it("ausgeführte Dateien lassen sich nicht mehr umbiegen", async () => {
    const { job, by } = await analyzed();
    await jobs.executeNow(job.id);
    await expect(jobs.updateItem(by("Severance.S02E02.German.DL.1080p.WEB.h264-GRP.mkv").id, { excluded: true })).rejects.toThrow(
      /jobs_error_alreadyRenamed/,
    );
  });
});

describe("JobService: Review-Fixes", () => {
  it("eine Freigabe überlebt das Neuberechnen der Vorschau", async () => {
    const { job, by } = await analyzed();
    const double = by("severance.204-205.720p.mkv");
    expect((await jobs.updateItem(double.id, { approve: true })).state).toBe("ready");
    await jobs.recompute(job.id, { template: { episode: "{n}/{s00e00}" } });
    const after = allItems(db, job.id).find((i) => i.id === double.id)!;
    expect(after.state).toBe("ready");
    expect(after.reasons).toContain(APPROVED);
  });

  it("mehrere Freigaben auf einmal: eine Neuberechnung pro Job", async () => {
    const { job, by } = await analyzed();
    const spy = vi.spyOn(jobs as unknown as { computePreview: () => Promise<unknown> }, "computePreview");
    const ready = await jobs.approve([by("severance.204-205.720p.mkv").id, by("Severance.S02E01.sample.mkv").id]);
    expect(spy).toHaveBeenCalledTimes(1);
    // The sample stays skipped: approval does not override a skip
    expect(ready.get(job.id)).toEqual([by("severance.204-205.720p.mkv").id]);
  });

  it("während der Job läuft, sind Vorschau und Items gesperrt", async () => {
    const job = await jobs.create({ paths: [tv()], config: config() });
    await expect(jobs.recompute(job.id, { preset: "plex" })).rejects.toThrow(/jobs_error_running/);
    // Thrown synchronously, so the server function can report it before queueing
    expect(() => jobs.executeNow(job.id)).toThrow(/jobs_error_running/);
    await jobs.idle();
    await expect(jobs.recompute(job.id, { preset: "plex" })).resolves.toBeDefined();
  });

  it("Undo wartet in der Queue auf eine laufende Ausführung", async () => {
    const { job } = await analyzed();
    const order: string[] = [];
    const exec = jobs.executeNow(job.id).then(() => order.push("execute"));
    const undo = jobs.undo({ jobId: job.id }).then((r) => order.push(`undo ${r.undone}`));
    await Promise.all([exec, undo]);
    expect(order).toEqual(["execute", "undo 3"]);
    expect(await fs.readdir(media())).toEqual([]);
  });

  it("rückgängig gemachte Dateien lassen sich erneut ausführen", async () => {
    const { job } = await analyzed();
    await jobs.executeNow(job.id);
    await jobs.undo({ jobId: job.id });
    await jobs.recompute(job.id);
    const ready = allItems(db, job.id).filter((i) => i.state === "ready");
    expect(ready).toHaveLength(2);
    expect(await jobs.executeNow(job.id)).toMatchObject({ done: 2 });
  });

  it("ein Item bleibt erledigt, solange eine Begleitdatei nicht zurück konnte", async () => {
    const { job, by } = await analyzed();
    await jobs.executeNow(job.id);
    const e1 = by("Severance.S02E01.German.DL.1080p.WEB.h264-GRP.mkv");
    await fs.writeFile(e1.targetPath!.replace(/\.mkv$/, ".de.srt"), "verändert, länger als vorher");
    const result = await jobs.undo({ jobId: job.id });
    expect(result.failed).toHaveLength(1);
    expect(allItems(db, job.id).find((i) => i.id === e1.id)!.state).toBe("done");
    expect(getJob(db, job.id)!.status).toBe("done");
  });

  it("fehlgeschlagene Begleitdateien werden am Item vermerkt", async () => {
    await touch("media/tv/Severance (2022)/Season 02/Severance (2022) - S02E01 - Hallo, Frau Cobel.de.srt", "alt");
    const { job, by } = await analyzed();
    await jobs.executeNow(job.id);
    const e1 = allItems(db, job.id).find((i) => i.id === by("Severance.S02E01.German.DL.1080p.WEB.h264-GRP.mkv").id)!;
    expect(e1.state).toBe("done");
    expect(localizeIn(e1.error, "de")).toContain("Ziel existiert bereits");
    expect(localizeIn(e1.error, "en")).toContain("Target already exists");
  });
});

describe("JobService: Watch-Jobs", () => {
  it("sichere Treffer laufen automatisch, unsichere landen in der Inbox", async () => {
    const wf = createWatchFolder(db, { name: "Serien", path: tv(), targets: { movie: media(), series: media() } });
    const job = await jobs.create({ paths: [tv()], config: config({ autoThreshold: 0.9 }), kind: "watch", watchFolderId: wf.id });
    await jobs.idle();
    expect(getJob(db, job.id)!.status).toBe("done");
    expect(await exists(path.join(media(), "Severance (2022)/Season 02/Severance (2022) - S02E02 - Goodbye, Mrs. Selvig.mkv"))).toBe(true);
    const inbox = listInbox(db);
    expect(inbox.map((e) => path.basename(e.item.sourcePath))).toEqual(["severance.204-205.720p.mkv"]);
    expect(inbox[0]!.reason).toBe(DOUBLE_EPISODE);
    expect(events.some((e) => e.type === "inbox.added")).toBe(true);
  });

  it("Immer prüfen: nichts läuft ohne Freigabe", async () => {
    const job = await jobs.create({ paths: [tv()], config: config({ alwaysReview: true }), kind: "watch" });
    await jobs.idle();
    expect(await fs.readdir(media())).toEqual([]);
    expect(listInbox(db)).toHaveLength(3);
    expect(listInbox(db).every((e) => localizeIn(e.reason, "de").startsWith("Immer prüfen"))).toBe(true);
    expect(getJob(db, job.id)!.status).toBe("ready");
  });
});

describe("JobService: Bessere Qualität behalten", () => {
  const episode = () => path.join(media(), "Severance (2022)/Season 02/Severance (2022) - S02E01 - Hallo, Frau Cobel");
  const severanceE01 = (items: { sourcePath: string }[]) =>
    items.find((i) => i.sourcePath.endsWith("Severance.S02E01.German.DL.1080p.WEB.h264-GRP.mkv")) as ReturnType<typeof allItems>[number];

  /** An earlier job put another release of S02E01 into the library under the template name. */
  async function earlier(release: string, content: string) {
    await touch(`downloads/old/${release}.mkv`, content);
    await touch(`downloads/old/${release}.de.srt`, "alte Untertitel");
    const job = await jobs.create({ paths: [path.join(tmp, "downloads/old")], config: config() });
    await jobs.idle();
    await jobs.executeNow(job.id);
    expect(await fs.readFile(`${episode()}.mkv`, "utf8")).toBe(content);
  }

  it("ersetzt eine 720p-HDTV-Datei durch 1080p WEB, auch wenn die neue kleiner ist", async () => {
    await earlier("Severance.S02E01.720p.HDTV.x264-OLD", "a much bigger but worse 720p HDTV file");
    const { job } = await analyzed({ conflictPolicy: "keep-better" });
    await jobs.executeNow(job.id);
    const item = severanceE01(allItems(db, job.id));
    expect(item.state).toBe("done");
    expect(localizeIn(item.reasons.at(-1)!, "en")).toBe("Replaced a worse file (Resolution: 1080p vs 720p)");
    expect(await fs.readFile(`${episode()}.mkv`, "utf8")).toContain("1080p.WEB");
    // The subtitle belongs to the new file, not compared by size
    expect(await fs.readFile(`${episode()}.de.srt`, "utf8")).toContain("1080p.WEB");
    // Undo restores the old release with its subtitle
    await jobs.undo({ jobId: job.id });
    expect(await fs.readFile(`${episode()}.mkv`, "utf8")).toContain("720p HDTV");
    expect(await fs.readFile(`${episode()}.de.srt`, "utf8")).toBe("alte Untertitel");
  });

  it("lässt eine bessere vorhandene Datei liegen und sagt warum", async () => {
    await earlier("Severance.S02E01.1080p.BluRay.x264-OLD", "BluRay");
    const { job } = await analyzed({ conflictPolicy: "keep-better" });
    await jobs.executeNow(job.id);
    const item = severanceE01(allItems(db, job.id));
    expect(item.state).toBe("skipped");
    expect(localizeIn(item.reasons.at(-1)!, "de")).toBe("Vorhandene Datei ist besser (Quelle: WEB vs BluRay)");
    expect(await fs.readFile(`${episode()}.mkv`, "utf8")).toBe("BluRay");
  });

  it("ffprobe zählt für beide Dateien: 4K-Inhalt unter einem nackten Namen gewinnt", async () => {
    await touch("media/tv/Severance (2022)/Season 02/Severance (2022) - S02E01 - Hallo, Frau Cobel.mkv", "x");
    const probe = vi.fn(async (file: string) =>
      file.startsWith(media())
        ? { resolution: "2160p", videoCodec: "H.265", hdr: "DV", audio: [] }
        : { resolution: "1080p", videoCodec: "H.264", audio: [] },
    );
    jobs = new JobService({ db, bus, provider: () => new DemoProvider(), log, notify, probe });
    const { job } = await analyzed({ conflictPolicy: "keep-better" });
    await jobs.executeNow(job.id);
    const item = severanceE01(allItems(db, job.id));
    expect(item.state).toBe("skipped");
    expect(localizeIn(item.reasons.at(-1)!, "en")).toBe("Existing file is better (Resolution: 1080p vs 2160p)");
  });
});

describe("JobService: ffprobe", () => {
  it("ergänzt fehlende Auflösung und Codec aus dem Container", async () => {
    const probe = vi.fn(async () => ({ resolution: "2160p", videoCodec: "H.265", audio: [] }));
    jobs = new JobService({ db, bus, provider: () => new DemoProvider(), log, notify, probe });
    const { by } = await analyzed({ template: { episode: "{n} {s00e00} {vf} {vc}" } });
    expect(probe).toHaveBeenCalledTimes(2); // only the two names without codec
    expect(by("severance.204-205.720p.mkv").targetPath).toBe(path.join(media(), "Severance S02E04-E05 720p H.265.mkv"));
    expect(by("Severance.S02E01.German.DL.1080p.WEB.h264-GRP.mkv").targetPath).toBe(path.join(media(), "Severance S02E01 1080p H.264.mkv"));
  });

  it("eine unlesbare erste Datei hält die anderen nicht auf", async () => {
    let calls = 0;
    const probe = vi.fn(async () => (calls++ === 0 ? undefined : { resolution: "2160p", videoCodec: "H.265", audio: [] }));
    jobs = new JobService({ db, bus, provider: () => new DemoProvider(), log, notify, probe });
    const { items } = await analyzed();
    expect(probe).toHaveBeenCalledTimes(2);
    // The second file still gets what ffprobe read.
    expect(items.filter((i) => (i.parsedJson as Parsed).release.videoCodec === "H.265")).toHaveLength(1);
  });
});

describe("JobService: Abbruch", () => {
  it("cancel bricht die Analyse ab", async () => {
    const job = await jobs.create({ paths: [tv()], config: config() });
    expect(jobs.cancel(job.id)).toBe(true);
    await jobs.idle();
    expect(getJob(db, job.id)!.status).toBe("cancelled");
    expect(jobs.cancel(job.id)).toBe(false);
  });
});
