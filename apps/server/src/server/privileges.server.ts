import * as fs from "node:fs";
import * as path from "node:path";

export type Ids = { uid: number; gid: number };

/** PUID/PGID like linuxserver.io images; undefined when not set or not numeric. */
export function readIds(env: Record<string, string | undefined> = process.env): Ids | undefined {
  const uid = Number(env.PUID);
  const gid = Number(env.PGID ?? env.PUID);
  if (!env.PUID || !Number.isInteger(uid) || !Number.isInteger(gid) || uid < 0 || gid < 0) return undefined;
  return { uid, gid };
}

/**
 * Started as root (the Docker default): hand the config folder to PUID/PGID and continue as
 * that user, so files written to /data belong to the user and not to root.
 */
export function dropPrivileges(configDir: string, ids = readIds()): Ids | undefined {
  if (!ids || process.getuid?.() !== 0) return undefined;
  fs.mkdirSync(configDir, { recursive: true });
  for (const entry of [configDir, ...fs.readdirSync(configDir).map((f) => path.join(configDir, f))]) {
    fs.lchownSync(entry, ids.uid, ids.gid);
  }
  process.setgroups?.([ids.gid]);
  process.setgid?.(ids.gid);
  process.setuid?.(ids.uid);
  return ids;
}
