import * as fs from "node:fs";
import * as path from "node:path";
import type { MetadataProvider } from "@namarr/core";
import { type Db, failInterruptedJobs, getSettings, openDatabase, type Settings, SqliteProviderCache, setSettings } from "@namarr/db";
import { DemoProvider, TmdbProvider } from "@namarr/providers";
import pino from "pino";
import { type Env, readEnv } from "./env.server.ts";
import { EventBus } from "./events.server.ts";
import { JobService } from "./jobs.server.ts";
import { WatchService } from "./watch.server.ts";

export type Runtime = {
  env: Env;
  db: Db;
  bus: EventBus;
  jobs: JobService;
  watch: WatchService;
  /** The metadata provider for the current settings (TMDB, or the demo catalog). */
  provider: () => MetadataProvider | undefined;
  log: pino.Logger;
  startedAt: Date;
};

const KEY = Symbol.for("namarr.runtime");
type Holder = { [KEY]?: Runtime };

/**
 * The single long-lived process state. Created once per process, on first use: the Bun server
 * entry touches it at boot, dev mode on the first request. Migrations run here, then the job
 * worker and the watch folders start, exactly once (also across Vite HMR reloads).
 */
export function runtime(): Runtime {
  const holder = globalThis as Holder;
  if (holder[KEY]) return holder[KEY];

  const env = readEnv();
  const log = pino({ level: env.logLevel, base: undefined });
  fs.mkdirSync(env.configDir, { recursive: true });
  const db = openDatabase(path.join(env.configDir, "namarr.sqlite"));
  const interrupted = failInterruptedJobs(db);
  if (interrupted) log.warn({ interrupted }, "Unterbrochene Jobs als fehlgeschlagen markiert");

  // First start: seed the allowed roots from NAMARR_ROOTS.
  const settings = getSettings(db);
  if (!settings.roots.length && env.roots.length) setSettings(db, { roots: env.roots });

  const bus = new EventBus();
  const cache = new SqliteProviderCache(db);
  // One client per key, so the rate limit holds across jobs and manual searches.
  let tmdb: { key: string; client: TmdbProvider } | undefined;
  const demo = new DemoProvider();
  const provider = (s: Settings) => {
    if (!s.tmdbApiKey) return env.demo ? demo : undefined;
    const key = `${s.tmdbApiKey}|${s.language}`;
    if (tmdb?.key !== key) tmdb = { key, client: new TmdbProvider({ apiKey: s.tmdbApiKey, language: s.language, cache }) };
    return tmdb.client;
  };
  const jobs = new JobService({ db, bus, provider, log });
  const watch = new WatchService({ db, bus, jobs, log });
  const rt: Runtime = { env, db, bus, jobs, watch, provider: () => provider(getSettings(db)), log, startedAt: new Date() };
  holder[KEY] = rt;

  void watch.reload().catch((err) => log.error({ err }, "Watch-Folder konnten nicht starten"));
  setInterval(() => cache.prune(), 6 * 3600 * 1000).unref();
  log.info({ configDir: env.configDir, demo: env.demo }, "namarr bereit");
  return rt;
}
