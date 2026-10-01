import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createProfile, createWatchFolder, type Db, listJobs, openDatabase, type Settings, setSettings } from "@namarr/db";
import { DemoProvider } from "@namarr/providers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isAuthenticated, isPublicPath, SESSION_COOKIE, sessionCookie, sessionValue } from "~/server/auth.server";
import { assertSafeBinding, readEnv } from "~/server/env.server";
import { EventBus, sseResponse } from "~/server/events.server";
import { JobService } from "~/server/jobs.server";
import { afterExecution, notificationRequest, refreshRequest, summaryText } from "~/server/notify.server";
import { isCandidate, WatchService } from "~/server/watch.server";

describe("Umgebung und Bindung", () => {
  it("liest Variablen mit sicheren Defaults", () => {
    const env = readEnv({ NAMARR_ROOTS: "/data, /media ", NAMARR_DEMO: "1" });
    expect(env).toMatchObject({ host: "127.0.0.1", port: 8420, roots: ["/data", "/media"], demo: true, token: undefined });
  });

  it("ohne Token nur auf Loopback", () => {
    expect(() => assertSafeBinding(readEnv({ NAMARR_HOST: "0.0.0.0" }))).toThrow(/NAMARR_TOKEN/);
    expect(() => assertSafeBinding(readEnv({ NAMARR_HOST: "0.0.0.0", NAMARR_TOKEN: "x" }))).not.toThrow();
    expect(() => assertSafeBinding(readEnv({ NAMARR_HOST: "0.0.0.0", NAMARR_AUTH_HEADER: "Remote-User" }))).not.toThrow();
    expect(() => assertSafeBinding(readEnv({}))).not.toThrow();
  });
});

describe("Auth", () => {
  const env = readEnv({ NAMARR_TOKEN: "geheim" });
  const h = (init: Record<string, string>) => new Headers(init);

  it("ohne Token konfiguriert ist alles offen (nur Loopback)", () => {
    expect(isAuthenticated(readEnv({}), h({}))).toBe(true);
  });

  it("Session-Cookie, Bearer, Basic", () => {
    expect(isAuthenticated(env, h({}))).toBe(false);
    expect(isAuthenticated(env, h({ cookie: `a=b; ${SESSION_COOKIE}=${sessionValue("geheim")}` }))).toBe(true);
    expect(isAuthenticated(env, h({ cookie: `${SESSION_COOKIE}=${sessionValue("falsch")}` }))).toBe(false);
    expect(isAuthenticated(env, h({ authorization: "Bearer geheim" }))).toBe(true);
    expect(isAuthenticated(env, h({ authorization: "Bearer nein" }))).toBe(false);
    expect(isAuthenticated(env, h({ authorization: `Basic ${btoa("user:geheim")}` }))).toBe(true);
    expect(isAuthenticated(env, h({ authorization: `Basic ${btoa("user:nein")}` }))).toBe(false);
  });

  it("Reverse-Proxy-Header", () => {
    const proxied = readEnv({ NAMARR_AUTH_HEADER: "Remote-User" });
    expect(isAuthenticated(proxied, h({ "remote-user": "tristan" }))).toBe(true);
    expect(isAuthenticated(proxied, h({}))).toBe(false);
  });

  it("Cookie ist HttpOnly, SameSite und enthält nicht das Token", () => {
    const c = sessionCookie("geheim", true);
    expect(c).toContain("HttpOnly");
    expect(c).toContain("SameSite=Lax");
    expect(c).toContain("Secure");
    expect(c).not.toContain("geheim");
  });

  it("öffentliche Pfade", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/api/health")).toBe(true);
    expect(isPublicPath("/api/events")).toBe(false);
    expect(isPublicPath("/rename")).toBe(false);
  });
});

describe("Benachrichtigungen und Library-Refresh", () => {
  it("Requests pro Dienst", () => {
    expect(notificationRequest({ kind: "ntfy", url: "https://ntfy.sh/t", token: "tk" }, "hi")).toEqual({
      url: "https://ntfy.sh/t",
      init: { method: "POST", body: "hi", headers: { title: "namarr", authorization: "Bearer tk" } },
    });
    expect(notificationRequest({ kind: "gotify", url: "https://g.example", token: "app" }, "hi").url).toBe(
      "https://g.example/message?token=app",
    );
    const tg = notificationRequest({ kind: "telegram", url: "https://api.telegram.org/botX/sendMessage?chat_id=42" }, "hi");
    expect(tg.url).toBe("https://api.telegram.org/botX/sendMessage");
    expect(JSON.parse(String(tg.init.body))).toEqual({ chat_id: "42", text: "hi" });
    expect(JSON.parse(String(notificationRequest({ kind: "discord", url: "https://d/w" }, "hi").init.body))).toEqual({ content: "hi" });
    expect(refreshRequest({ kind: "plex", url: "http://plex:32400", token: "p" }).url).toBe(
      "http://plex:32400/library/sections/all/refresh?X-Plex-Token=p",
    );
    expect(refreshRequest({ kind: "jellyfin", url: "http://jf:8096", token: "j" })).toEqual({
      url: "http://jf:8096/Library/Refresh",
      init: { method: "POST", headers: { "X-Emby-Token": "j" } },
    });
  });

  it("Text der Zusammenfassung", () => {
    expect(summaryText({ jobId: 7, done: 3, failed: 1, skipped: 0, source: "/dl" })).toBe(
      "namarr Job #7: 3 umbenannt, 1 fehlgeschlagen (/dl)",
    );
  });

  it("Fehler werden geloggt, nie geworfen", async () => {
    const settings: Settings = {
      language: "de-DE",
      roots: [],
      notifications: [{ kind: "webhook", url: "https://hook.example/x" }],
      libraryRefresh: [{ kind: "jellyfin", url: "http://jf:8096", token: "t" }],
    };
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("jf")) throw new Error("offline");
      return new Response("", { status: 500 });
    });
    const log = vi.fn();
    await afterExecution(settings, { jobId: 1, done: 1, failed: 0, skipped: 0, source: "/x" }, log, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(log.mock.calls.map((c) => c[0])).toEqual(
      expect.arrayContaining(["Benachrichtigung fehlgeschlagen: jf:8096", "Benachrichtigung fehlgeschlagen: hook.example HTTP 500"]),
    );
  });

  it("kein Library-Refresh, wenn nichts umbenannt wurde", async () => {
    const fetchImpl = vi.fn(async () => new Response(""));
    await afterExecution(
      { language: "de", roots: [], notifications: [], libraryRefresh: [{ kind: "plex", url: "http://p", token: "t" }] },
      { jobId: 1, done: 0, failed: 1, skipped: 0, source: "/x" },
      () => {},
      fetchImpl,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("Server-Sent Events", () => {
  it("streamt Events und räumt beim Abbruch auf", async () => {
    const bus = new EventBus();
    const abort = new AbortController();
    const res = sseResponse(bus, abort.signal, 60_000);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const first = decoder.decode((await reader.read()).value);
    expect(first).toContain(": connected");
    expect(bus.size).toBe(1);
    bus.emit({ type: "job.progress", jobId: 3, status: "matching", done: 1, total: 4 });
    const second = decoder.decode((await reader.read()).value);
    expect(second).toBe(`event: job.progress\ndata: {"type":"job.progress","jobId":3,"status":"matching","done":1,"total":4}\n\n`);
    abort.abort();
    expect(bus.size).toBe(0);
  });
});

describe("Watch-Folder", () => {
  let tmp: string | undefined;
  let watch: WatchService | undefined;
  afterEach(async () => {
    await watch?.stop();
    if (tmp) await fs.rm(tmp, { recursive: true, force: true });
  });

  it("ignoriert Temp-Dateien, Samples und Nicht-Videos", () => {
    expect(isCandidate("/dl/Show.S01E01.mkv")).toBe(true);
    expect(isCandidate("/dl/Show.S01E01.mkv.part")).toBe(false);
    expect(isCandidate("/dl/Show.S01E01.mkv.!qB")).toBe(false);
    expect(isCandidate("/dl/Show/Sample/sample.mkv")).toBe(false);
    expect(isCandidate("/dl/Show/.hidden.mkv")).toBe(false);
    expect(isCandidate("/dl/readme.nfo")).toBe(false);
  });

  it("fertige Dateien werden pro Release-Ordner zu einem Watch-Job", async () => {
    tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "namarr-watch-")));
    const dl = path.join(tmp, "dl");
    await fs.mkdir(dl, { recursive: true });
    const db: Db = openDatabase(":memory:");
    setSettings(db, { roots: [tmp] });
    const bus = new EventBus();
    const detected: string[] = [];
    bus.subscribe((e) => e.type === "watch.detected" && detected.push(path.basename(e.path)));
    const log = { info: () => {}, error: () => {} };
    const jobs = new JobService({ db, bus, provider: () => new DemoProvider(), log, notify: async () => {} });
    const profile = createProfile(db, { name: "Serien", action: "hardlink", preset: "plex" });
    createWatchFolder(db, {
      name: "TV",
      path: dl,
      targetRoot: path.join(tmp, "media"),
      profileId: profile.id,
      stableSeconds: 1,
      autoThreshold: null,
    });
    watch = new WatchService({ db, bus, jobs, log }, 200);
    await watch.reload();
    await new Promise((r) => setTimeout(r, 300));

    const release = path.join(dl, "Severance.S02.German.DL.1080p.WEB-GRP");
    await fs.mkdir(release);
    await fs.writeFile(path.join(release, "severance.s02e01.mkv"), "a");
    await fs.writeFile(path.join(release, "severance.s02e02.mkv"), "b");
    await fs.writeFile(path.join(release, "severance.s02e03.mkv.part"), "c");

    await vi.waitFor(() => expect(listJobs(db)).toHaveLength(1), { timeout: 8000, interval: 200 });
    await jobs.idle();
    const [job] = listJobs(db);
    expect(job).toMatchObject({ kind: "watch", sourcePaths: [release], profileId: profile.id });
    expect(job!.config).toMatchObject({ action: "hardlink", preset: "plex", alwaysReview: true, targetRoot: path.join(tmp, "media") });
    expect(detected.sort()).toEqual(["severance.s02e01.mkv", "severance.s02e02.mkv"]);
  }, 15_000);
});
