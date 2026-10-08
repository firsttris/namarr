import * as fs from "node:fs";
import * as path from "node:path";
import { type MetadataProvider, prober } from "@namarr/core";
import {
  type Db,
  failInterruptedJobs,
  getSettings,
  migrateProfiles,
  openDatabase,
  type SeriesProvider,
  SqliteProviderCache,
  setSettings,
} from "@namarr/db";
import pino from "pino";
import { setSessionsValidAfter } from "./auth.server.ts";
import { type Env, readEnv } from "./env.server.ts";
import { EventBus } from "./events.server.ts";
import { JobService } from "./jobs.server.ts";
import { providerFactory } from "./providers.server.ts";
import { WatchService } from "./watch.server.ts";

export type Runtime = {
  env: Env;
  db: Db;
  bus: EventBus;
  jobs: JobService;
  watch: WatchService;
  /** The metadata provider for the current settings; `series` picks another series source. */
  provider: (choice?: { series?: SeriesProvider }) => MetadataProvider | undefined;
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
/**
 * First start only (no folders yet): the folders given in NAMARR_ROOTS, as far as they exist. A
 * mount that is not there would only be a folder that cannot be saved; it is logged instead.
 */
export function seedFolders(db: Db, roots: string[], log: { warn: (obj: object, msg: string) => void }): void {
  if (getSettings(db).folders.length || !roots.length) return;
  const existing = roots.filter((p) => fs.statSync(p, { throwIfNoEntry: false })?.isDirectory());
  const missing = roots.filter((p) => !existing.includes(p));
  if (missing.length) log.warn({ missing }, "NAMARR_ROOTS: Ordner nicht gefunden, nicht übernommen");
  if (existing.length) setSettings(db, { folders: existing.map((p) => ({ path: p, name: path.basename(p) || p, kind: "folder" })) });
}

export function runtime(): Runtime {
  const holder = globalThis as Holder;
  if (holder[KEY]) return holder[KEY];

  const env = readEnv();
  const log = pino({ level: env.logLevel, base: undefined });
  fs.mkdirSync(env.configDir, { recursive: true });
  const db = openDatabase(path.join(env.configDir, "namarr.sqlite"));
  const interrupted = failInterruptedJobs(db);
  if (interrupted) log.warn({ interrupted }, "Unterbrochene Jobs als fehlgeschlagen markiert");

  for (const warning of env.warnings) log.warn(warning);
  seedFolders(db, env.roots, log);
  setSessionsValidAfter(getSettings(db).sessionsValidAfter ?? 0);
  const { skippedRules } = migrateProfiles(db);
  if (skippedRules.length)
    log.warn({ profiles: skippedRules }, "Profile mit Regeln: Regeln nicht übernommen (Werkbank → Regeln importieren)");

  const bus = new EventBus();
  const cache = new SqliteProviderCache(db);
  // One client per source and key, so rate limits hold across jobs and manual searches.
  const provider = providerFactory(cache, env.demo);
  const jobs = new JobService({ db, bus, provider, log, probe: prober() });
  const watch = new WatchService({ db, bus, jobs, log });
  const rt: Runtime = { env, db, bus, jobs, watch, provider: (choice) => provider(getSettings(db), choice), log, startedAt: new Date() };
  holder[KEY] = rt;

  void watch.reload().catch((err) => log.error({ err }, "Watch-Folder konnten nicht starten"));
  setInterval(() => cache.prune(), 6 * 3600 * 1000).unref();
  log.info({ configDir: env.configDir, demo: env.demo }, "namarr bereit");
  return rt;
}
