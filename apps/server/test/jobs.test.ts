import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
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
import { EventBus, type NamarrEvent } from "~/server/events.server";
import { JobService } from "~/server/jobs.server";
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
  setSettings(db, { roots: [tmp] });
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
  action: "hardlink",
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
    await expect(jobs.create({ paths: ["/etc"], config: config() })).rejects.toThrow(/außerhalb/);
    await expect(jobs.create({ paths: [tv()], config: config({ targetRoot: "/etc" }) })).rejects.toThrow(/außerhalb/);
  });

  it("ohne Anbieter schlägt der Job mit verständlicher Meldung fehl", async () => {
    jobs = new JobService({ db, bus, provider: () => undefined, log, notify });
    const job = await jobs.create({ paths: [tv()], config: config() });
    await jobs.idle();
    expect(getJob(db, job.id)).toMatchObject({ status: "failed", error: expect.stringContaining("TMDB-API-Key") });
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
    await expect(jobs.updateItem(manual.id, { targetPath: "../../../etc/x" })).rejects.toThrow(/außerhalb/);
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
      /rückgängig/,
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
    expect(after.reasons).toContain("Freigegeben");
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
    await expect(jobs.recompute(job.id, { preset: "plex" })).rejects.toThrow(/läuft noch/);
    // Thrown synchronously, so the server function can report it before queueing
    expect(() => jobs.executeNow(job.id)).toThrow(/läuft noch/);
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
    expect(e1.error).toContain("Ziel existiert bereits");
  });
});

describe("JobService: Watch-Jobs", () => {
  it("sichere Treffer laufen automatisch, unsichere landen in der Inbox", async () => {
    const wf = createWatchFolder(db, { name: "Serien", path: tv(), targetRoot: media() });
    const job = await jobs.create({ paths: [tv()], config: config({ autoThreshold: 0.9 }), kind: "watch", watchFolderId: wf.id });
    await jobs.idle();
    expect(getJob(db, job.id)!.status).toBe("done");
    expect(await exists(path.join(media(), "Severance (2022)/Season 02/Severance (2022) - S02E02 - Goodbye, Mrs. Selvig.mkv"))).toBe(true);
    const inbox = listInbox(db);
    expect(inbox.map((e) => path.basename(e.item.sourcePath))).toEqual(["severance.204-205.720p.mkv"]);
    expect(inbox[0]!.reason).toBe("Doppelfolge");
    expect(events.some((e) => e.type === "inbox.added")).toBe(true);
  });

  it("Immer prüfen: nichts läuft ohne Freigabe", async () => {
    const job = await jobs.create({ paths: [tv()], config: config({ alwaysReview: true }), kind: "watch" });
    await jobs.idle();
    expect(await fs.readdir(media())).toEqual([]);
    expect(listInbox(db)).toHaveLength(3);
    expect(listInbox(db).every((e) => e.reason.startsWith("Immer prüfen"))).toBe(true);
    expect(getJob(db, job.id)!.status).toBe("ready");
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

  it("ohne ffprobe wird nach dem ersten Versuch abgebrochen", async () => {
    const probe = vi.fn(async () => undefined);
    jobs = new JobService({ db, bus, provider: () => new DemoProvider(), log, notify, probe });
    await touch("downloads/tv/a.s01e01.mkv");
    await touch("downloads/tv/b.s01e01.mkv");
    await touch("downloads/tv/c.s01e01.mkv");
    await touch("downloads/tv/d.s01e01.mkv");
    await touch("downloads/tv/e.s01e01.mkv");
    await analyzed();
    expect(probe).toHaveBeenCalledTimes(4);
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
