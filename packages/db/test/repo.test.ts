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
  failInterruptedJobs,
  formatsOf,
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
  migrateProfiles,
  openDatabase,
  removeFromInbox,
  resolveFormats,
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

describe("Formate", () => {
  it("eingebaute und eigene Formate, Standard pro Art, Watch-Folder wählen andere", () => {
    const own = { id: "f-mine", name: "Meins", kind: "series" as const, template: "{n}/{s00e00}" };
    const s = { formats: [own], defaultFormats: { movie: "plex" } };
    expect(formatsOf(s, "series").map((f) => f.id)).toEqual(["plex", "jellyfin", "emby", "kodi", "f-mine"]);
    expect(formatsOf(s, "movie").map((f) => f.id)).not.toContain("f-mine");
    expect(resolveFormats(s)).toMatchObject({ movie: { id: "plex" }, series: { id: "jellyfin" } });
    expect(resolveFormats(s, { series: "f-mine" })).toMatchObject({
      movie: { id: "plex" },
      series: { id: "f-mine", template: "{n}/{s00e00}" },
    });
    // Gone or unknown: the default.
    expect(resolveFormats(s, { series: "f-weg", movie: "f-mine" })).toMatchObject({ movie: { id: "plex" }, series: { id: "jellyfin" } });
  });

  it("Profile werden einmalig zu Formaten und Watch-Folder-Optionen", () => {
    const db = fresh();
    const custom = createProfile(db, {
      name: "Anime",
      template: { episode: "{n}/{absolute}" },
      provider: "anidb",
      action: "hardlink",
      targets: { series: "/anime" },
    });
    const plex = createProfile(db, { name: "Plex", preset: "plex", action: "move", rulesJson: [{ type: "case", mode: "lower" }] as never });
    const a = createWatchFolder(db, { name: "Anime", path: "/dl/anime", profileId: custom.id, targets: { movie: "/movies" } });
    const b = createWatchFolder(db, { name: "Rest", path: "/dl/rest", profileId: plex.id });

    expect(migrateProfiles(db)).toEqual({ skippedRules: ["Plex"] });
    const [format] = getSettings(db).formats;
    expect(format).toMatchObject({ name: "Anime", kind: "series", template: "{n}/{absolute}" });
    expect(getWatchFolder(db, a.id)).toMatchObject({
      profileId: null,
      targets: { movie: "/movies", series: "/anime" },
      // Links are gone: copy leaves the download in place.
      options: { formats: { series: format!.id }, provider: "anidb", action: "copy", conflictPolicy: "skip" },
    });
    expect(getWatchFolder(db, b.id)!.options).toMatchObject({ formats: { movie: "plex", series: "plex" }, action: "move" });

    // Only once.
    expect(migrateProfiles(db)).toEqual({ skippedRules: [] });
    expect(getSettings(db).formats).toHaveLength(1);
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
    // A neighbour like "/dl.old" stays outside the range.
    insertItems(db, [{ jobId: job.id, sourcePath: "/dl.old/e.mkv" }]);
    expect([...knownSourcePaths(db, "/dl")].sort()).toEqual(["/dl/100%_done/a.mkv", "/dl/b.mkv"]);
  });

  it("Pragmas für WAL", () => {
    const pragma = (name: string) => Object.values(fresh().$client.query(`PRAGMA ${name}`).get() as object)[0];
    expect(pragma("synchronous")).toBe(1); // NORMAL
    expect(pragma("temp_store")).toBe(2); // MEMORY
  });

  it("Indizes für die häufigen Abfragen", () => {
    const db = fresh();
    const plan = (q: string) => (db.$client.query(`EXPLAIN QUERY PLAN ${q}`).all() as { detail: string }[]).map((r) => r.detail).join(" ");
    expect(plan("SELECT source_path FROM job_items WHERE source_path >= '/dl/' AND source_path < '/dl0'")).toContain(
      "job_items_source_idx",
    );
    expect(plan("SELECT * FROM job_items WHERE target_path = '/x'")).toContain("job_items_target_idx");
    expect(plan("SELECT * FROM operations WHERE undone_at IS NULL")).toContain("operations_undone_idx");
    expect(plan("SELECT * FROM inbox ORDER BY created_at")).toContain("inbox_created_idx");
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

  it("Auto-Quote nach der Schwelle des Jobs", () => {
    const db = fresh();
    const lenient = createJob(db, { sourcePaths: ["/a"], config: { ...config, autoThreshold: 0.8 } });
    const strict = createJob(db, { sourcePaths: ["/b"], config: { ...config, autoThreshold: 0.95 } });
    insertItems(db, [
      { jobId: lenient.id, sourcePath: "/a/1.mkv", state: "done", confidence: 0.85 },
      { jobId: lenient.id, sourcePath: "/a/2.mkv", state: "done", confidence: 0.82 },
      { jobId: strict.id, sourcePath: "/b/1.mkv", state: "needs_review", confidence: 0.92 },
    ]);
    // Sure by 0.8, but not by 0.9; the 0.92 is not sure by 0.95.
    expect(dashboardStats(db).autoRate).toBe(2 / 3);
  });
});
