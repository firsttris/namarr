import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "./schema.ts";

export * from "./repo.ts";
export * from "./schema.ts";
export { schema };

export type Db = BunSQLiteDatabase<typeof schema> & { $client: Database };

function defaultMigrations(): string {
  if (process.env.NAMARR_MIGRATIONS_DIR) return process.env.NAMARR_MIGRATIONS_DIR;
  const local = fileURLToPath(new URL("../drizzle", import.meta.url));
  return existsSync(local) ? local : "./drizzle";
}

/**
 * Opens (or creates) the SQLite file in WAL mode and runs pending migrations.
 * `:memory:` works for tests.
 */
export function openDatabase(file: string, options: { migrationsFolder?: string } = {}): Db {
  const sqlite = new Database(file, { create: true });
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec("PRAGMA busy_timeout = 5000;");
  const db = drizzle({ client: sqlite, schema }) as Db;
  migrate(db, { migrationsFolder: options.migrationsFolder ?? defaultMigrations() });
  return db;
}
