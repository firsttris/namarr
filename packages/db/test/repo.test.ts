import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  addToInbox,
  allItems,
  allowedRoots,
  countItemsByState,
  createJob,
  createProfile,
  createWatchFolder,
  dashboardStats,
  defaultFolder,
  deleteProfile,
  failInterruptedJobs,
  getJob,
  getSettings,
  getWatchFolder,
  insertItems,
  insertOperation,
  type JobConfig,
  knownSourcePaths,
  listInbox,
  listItems,
  listOperations,
  listOverrides,
  listProfiles,
  listWatchFolders,
  markUndone,
  openDatabase,
  removeFromInbox,
  resolveTargets,
  SqliteProviderCache,
  saveOverride,
  schema,
  setSettings,
  updateItem,
} from "../src/index.ts";

const config: JobConfig = { mode: "media", action: "test", conflictPolicy: "skip" };
const fresh = () => openDatabase(":memory:");

describe("Migrationen", () => {
  it("legen alle Tabellen an und laufen idempotent", () => {
    const db = fresh();
    const tables = db.$client
      .query(
        "select name from sqlite_master where type='table' and name not like '\\_\\_%' escape '\\' and name != 'sqlite_sequence' order by name",
      )
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toEqual([
      "inbox",
      "job_items",
      "jobs",
      "match_overrides",
      "operations",
      "profiles",
      "provider_cache",
      "settings",
      "watch_folders",
    ]);
  });
});

describe("Einstellungen", () => {
  it("Defaults, Patch und Löschen", () => {
    const db = fresh();
    expect(getSettings(db)).toMatchObject({ language: "de-DE", folders: [] });
    const folders = [{ path: "/data", name: "data", kind: "folder" as const }];
    setSettings(db, { folders, tmdbApiKey: "abc" });
    expect(getSettings(db)).toMatchObject({ folders, tmdbApiKey: "abc", language: "de-DE" });
    setSettings(db, { tmdbApiKey: undefined });
    expect(getSettings(db).tmdbApiKey).toBeUndefined();
  });
});

describe("Ordner", () => {
  it("übernimmt Wurzelpfade und Standard-Ziel älterer Versionen, bis Ordner gespeichert werden", () => {
    const db = fresh();
    db.insert(schema.settings)
      .values({ key: "roots", valueJson: ["/downloads", "/media"] })
      .run();
    db.insert(schema.settings).values({ key: "defaultTargetRoot", valueJson: "/media" }).run();
    const s = getSettings(db);
    expect(s.folders).toEqual([
      { path: "/downloads", name: "downloads", kind: "folder" },
      { path: "/media", name: "media", kind: "folder" },
      { path: "/media", name: "media", kind: "movies", default: true },
      { path: "/media", name: "media", kind: "series", default: true },
    ]);
    expect(s).not.toHaveProperty("roots");
    expect(allowedRoots(s)).toEqual(["/downloads", "/media"]);
    setSettings(db, { folders: s.folders });
    expect(
      db
        .select()
        .from(schema.settings)
        .all()
        .map((r) => r.key),
    ).toEqual(["folders"]);
  });

  it("Standard je Typ, Ebenen vor Standard, Regel-Ziel ohne Standard", () => {
    const s = {
      folders: [
        { path: "/movies", name: "Filme", kind: "movies" as const, default: true },
        { path: "/movies-4k", name: "Filme 4K", kind: "movies" as const },
        { path: "/tv", name: "Serien", kind: "series" as const },
      ],
    };
    expect(defaultFolder(s, "movies")).toBe("/movies");
    // The only one of its kind is the default without the mark.
    expect(defaultFolder(s, "series")).toBe("/tv");
    expect(defaultFolder({ folders: [...s.folders, { path: "/anime", name: "Anime", kind: "series" }] }, "series")).toBeUndefined();
    expect(resolveTargets(s)).toEqual({ movie: "/movies", series: "/tv", other: undefined });
    expect(resolveTargets(s, { movie: "/movies-4k" }, { movie: "/x", other: "/photos" })).toEqual({
      movie: "/movies-4k",
      series: "/tv",
      other: "/photos",
    });
  });

  it("Migration 0003: ein Zielordner wird Film- und Serien-Ziel, im Regel-Modus Regel-Ziel", () => {
    const db = fresh();
    db.$client.run(
      "INSERT INTO profiles (name, mode, target_root) VALUES ('Medien', 'media', '/media'), ('Fotos', 'rules', '/photos'), ('Leer', 'media', NULL)",
    );
    db.$client.run("INSERT INTO watch_folders (name, path, target_root) VALUES ('TV', '/dl/tv', '/media/tv')");
    const sql = readFileSync(new URL("../drizzle/0003_targets.sql", import.meta.url), "utf8");
    for (const statement of sql.split("--> statement-breakpoint").filter((s) => s.includes("UPDATE"))) db.$client.run(statement);
    expect(listProfiles(db).map((p) => [p.name, p.targets, p.targetRoot])).toEqual([
      ["Fotos", { other: "/photos" }, null],
      ["Leer", {}, null],
      ["Medien", { movie: "/media", series: "/media" }, null],
    ]);
    expect(listWatchFolders(db)[0]).toMatchObject({
      targetRoot: "",
      targets: { movie: "/media/tv", series: "/media/tv", other: "/media/tv" },
    });
  });
});

describe("Profile und Watch-Folder", () => {
  it("Watch-Folder verliert sein Profil beim Löschen nicht", () => {
    const db = fresh();
    const profile = createProfile(db, { name: "Serien", preset: "jellyfin", action: "hardlink" });
    expect(profile).toMatchObject({ id: 1, mode: "media", conflictPolicy: "skip", template: {}, rulesJson: [] });
    const wf = createWatchFolder(db, { name: "Serien", path: "/dl/tv", targetRoot: "/media/tv", profileId: profile.id });
    deleteProfile(db, profile.id);
    expect(getWatchFolder(db, wf.id)).toMatchObject({ profileId: null, autoThreshold: 0.9, enabled: true, stableSeconds: 30 });
  });
});

describe("Jobs und Items", () => {
  it("Cursor-Paging, Filter und Suche", () => {
    const db = fresh();
    const job = createJob(db, { sourcePaths: ["/data/tv"], config });
    const items = insertItems(
      db,
      Array.from({ length: 450 }, (_, i) => ({
        jobId: job.id,
        sourcePath: `/data/tv/file_${i}.mkv`,
        state: i % 3 === 0 ? ("needs_review" as const) : ("ready" as const),
      })),
    );
    expect(items).toHaveLength(450);

    const page1 = listItems(db, job.id, { limit: 200 });
    expect(page1.items).toHaveLength(200);
    const page2 = listItems(db, job.id, { limit: 200, cursor: page1.nextCursor });
    const page3 = listItems(db, job.id, { limit: 200, cursor: page2.nextCursor });
    expect(page3.items).toHaveLength(50);
    expect(page3.nextCursor).toBeUndefined();

    expect(listItems(db, job.id, { filter: { states: ["needs_review"] } }).items).toHaveLength(150);
    expect(listItems(db, job.id, { filter: { search: "file_44" } }).items.map((i) => i.sourcePath)).toEqual([
      "/data/tv/file_44.mkv",
      "/data/tv/file_440.mkv",
      "/data/tv/file_441.mkv",
      "/data/tv/file_442.mkv",
      "/data/tv/file_443.mkv",
      "/data/tv/file_444.mkv",
      "/data/tv/file_445.mkv",
      "/data/tv/file_446.mkv",
      "/data/tv/file_447.mkv",
      "/data/tv/file_448.mkv",
      "/data/tv/file_449.mkv",
    ]);
    // % und _ in der Suche sind keine Wildcards
    expect(listItems(db, job.id, { filter: { search: "%" } }).items).toHaveLength(0);
    expect(countItemsByState(db, job.id)).toMatchObject({ needs_review: 150, ready: 300, done: 0 });
  });

  it("JSON-Spalten bleiben strukturiert", () => {
    const db = fresh();
    const job = createJob(db, { sourcePaths: ["/x"], config: { ...config, rules: [{ type: "transliterate" }] } });
    const [item] = insertItems(db, [
      {
        jobId: job.id,
        sourcePath: "/x/a.mkv",
        parsedJson: { kind: { value: "episode", confidence: 1 }, title: "A", episodes: [1], release: { languages: [] } },
        reasons: ["Doppelfolge"],
      },
    ]);
    updateItem(db, item!.id, { companions: [{ from: "/x/a.srt", to: "/y/a.srt" }] });
    expect(allItems(db, job.id)[0]).toMatchObject({
      parsedJson: { title: "A", episodes: [1] },
      reasons: ["Doppelfolge"],
      companions: [{ from: "/x/a.srt", to: "/y/a.srt" }],
    });
    expect(getJob(db, job.id)!.config.rules).toEqual([{ type: "transliterate" }]);
  });

  it("unterbrochene Jobs werden beim Start als fehlgeschlagen markiert", () => {
    const db = fresh();
    const a = createJob(db, { sourcePaths: ["/a"], config });
    const b = createJob(db, { sourcePaths: ["/b"], config });
    db.$client.exec(`update jobs set status='executing' where id=${a.id}; update jobs set status='done' where id=${b.id}`);
    expect(failInterruptedJobs(db)).toBe(1);
    expect(getJob(db, a.id)).toMatchObject({ status: "failed" });
    expect(getJob(db, b.id)).toMatchObject({ status: "done" });
  });
});

describe("Bekannte Quellpfade", () => {
  it("nur unterhalb des Ordners, % und _ sind keine Wildcards", () => {
    const db = fresh();
    const job = createJob(db, { sourcePaths: ["/dl"], config });
    insertItems(db, [
      { jobId: job.id, sourcePath: "/dl/100%_done/a.mkv" },
      { jobId: job.id, sourcePath: "/dl/b.mkv" },
      { jobId: job.id, sourcePath: "/dl2/c.mkv" },
      { jobId: job.id, sourcePath: "/dlx_y/d.mkv" },
    ]);
    expect([...knownSourcePaths(db, "/dl")].sort()).toEqual(["/dl/100%_done/a.mkv", "/dl/b.mkv"]);
    expect([...knownSourcePaths(db, "/dl/100%_done/")]).toEqual(["/dl/100%_done/a.mkv"]);
    expect([...knownSourcePaths(db, "/dl_")]).toEqual([]);
  });
});

describe("History", () => {
  it("Operationen filtern und als rückgängig markieren", () => {
    const db = fresh();
    const job = createJob(db, { sourcePaths: ["/a"], config });
    const ops = [1, 2, 3].map((i) =>
      insertOperation(db, { jobId: job.id, action: "move", fromPath: `/a/${i}.mkv`, toPath: `/b/${i}.mkv`, size: 1, inode: i }),
    );
    expect(listOperations(db, { jobId: job.id }).map((o) => o.id)).toEqual([3, 2, 1]);
    markUndone(db, [ops[0]!.id]);
    expect(listOperations(db)).toHaveLength(2);
    expect(listOperations(db, { includeUndone: true })).toHaveLength(3);
    expect(listOperations(db, { search: "2.mkv" })).toHaveLength(1);
    expect(listOperations(db, { before: 3 }).map((o) => o.id)).toEqual([2]);
  });
});

describe("Inbox und Overrides", () => {
  it("Inbox mit Grund, Update und Entfernen", () => {
    const db = fresh();
    const job = createJob(db, { sourcePaths: ["/a"], config });
    const [item] = insertItems(db, [{ jobId: job.id, sourcePath: "/a/x.mkv", state: "needs_review" }]);
    addToInbox(db, item!.id, "Zwei Kandidaten mit ähnlichem Score");
    addToInbox(db, item!.id, "Kein Jahr erkannt");
    expect(listInbox(db)).toMatchObject([{ reason: "Kein Jahr erkannt", item: { sourcePath: "/a/x.mkv" } }]);
    removeFromInbox(db, item!.id);
    expect(listInbox(db)).toHaveLength(0);
  });

  it("Override wird ersetzt statt verdoppelt", () => {
    const db = fresh();
    saveOverride(db, { pattern: "The Office", provider: "tmdb", externalId: "2316" });
    saveOverride(db, { pattern: "The Office", provider: "tmdb", externalId: "2996" });
    expect(listOverrides(db)).toMatchObject([{ externalId: "2996" }]);
  });
});

describe("Provider-Cache", () => {
  it("TTL und Aufräumen", async () => {
    const db = fresh();
    let now = 1_000_000;
    const cache = new SqliteProviderCache(db, () => now);
    await cache.set("tmdb", "/search/tv?query=x", { results: [1] }, 60);
    expect(await cache.get("tmdb", "/search/tv?query=x")).toEqual({ results: [1] });
    await cache.set("tmdb", "/search/tv?query=x", { results: [2] }, 60);
    expect(await cache.get("tmdb", "/search/tv?query=x")).toEqual({ results: [2] });
    now += 61_000;
    expect(await cache.get("tmdb", "/search/tv?query=x")).toBeUndefined();
    expect(cache.prune()).toBe(1);
  });
});

describe("Dashboard", () => {
  it("Kennzahlen", () => {
    const db = fresh();
    const job = createJob(db, { sourcePaths: ["/a"], config });
    const items = insertItems(db, [
      { jobId: job.id, sourcePath: "/a/1.mkv", state: "done", confidence: 0.95 },
      { jobId: job.id, sourcePath: "/a/2.mkv", state: "done", confidence: 0.97 },
      { jobId: job.id, sourcePath: "/a/3.mkv", state: "needs_review", confidence: 0.7 },
      { jobId: job.id, sourcePath: "/a/4.mkv", state: "skipped", confidence: 0 },
    ]);
    insertOperation(db, { jobId: job.id, action: "hardlink", fromPath: "/a/1.mkv", toPath: "/b/1.mkv", size: 1, inode: 1 });
    insertOperation(db, { jobId: job.id, action: "hardlink", fromPath: "/a/2.mkv", toPath: "/b/2.mkv", size: 1, inode: 2 });
    addToInbox(db, items[2]!.id, "x");
    expect(dashboardStats(db)).toEqual({ renamedToday: 2, inboxOpen: 1, autoRate: 2 / 3, undoable: 2 });
  });
});
