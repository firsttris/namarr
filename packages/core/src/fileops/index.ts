import { constants, type Stats } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tr } from "../i18n.ts";
import { splitExtension } from "../parser/index.ts";
import { compareQuality, type Quality } from "./quality.ts";

export const ACTIONS = ["move", "copy", "hardlink", "symlink", "rename", "test"] as const;
export const CONFLICT_POLICIES = ["skip", "overwrite", "suffix", "keep-better"] as const;

export type Action = (typeof ACTIONS)[number];
export type ConflictPolicy = (typeof CONFLICT_POLICIES)[number];

/** Skip reason when the target exists. */
export const TARGET_EXISTS = tr("Ziel existiert bereits", "Target already exists");

export type PlannedOperation = { from: string; to: string; action: Action };

export type OperationRecord = {
  action: Action;
  from: string;
  to: string;
  size: number;
  inode: number;
  /** An existing target moved aside by `overwrite` / `keep-better`, restored on undo. */
  backup?: string;
  /** Folders this operation created, removed again on undo when empty. */
  createdDirs: string[];
};

export type OperationResult =
  /** `note`: why keep-better replaced the existing file. */
  | { status: "done"; record: OperationRecord; note?: string }
  | { status: "tested"; to: string; conflict: boolean }
  | { status: "skipped"; reason: string; to: string }
  | { status: "failed"; error: string };

export type ExecuteOptions = {
  conflict?: ConflictPolicy;
  /**
   * What `keep-better` compares: resolution, source, HDR, codecs, then size (see compareQuality).
   * Without it only the size is known.
   */
  quality?: (file: string, role: "incoming" | "existing") => Quality | undefined | Promise<Quality | undefined>;
  /** Clock for backup names, injectable for tests. */
  now?: () => number;
};

export class FileOpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileOpError";
  }
}

async function lstatOrUndefined(p: string): Promise<Stats | undefined> {
  try {
    return await fs.lstat(p);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
}

export const exists = async (p: string) => (await lstatOrUndefined(p)) !== undefined;

/** `mkdir -p` that reports which folders it created, outermost first. */
export async function ensureDir(dir: string): Promise<string[]> {
  const missing: string[] = [];
  let cur = path.resolve(dir);
  while (!(await exists(cur))) {
    missing.unshift(cur);
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  for (const d of missing) {
    try {
      await fs.mkdir(d);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
  return missing;
}

/** `name.ext` → `name (1).ext`, `name (2).ext`, … until free. */
export async function freeName(target: string): Promise<string> {
  const dir = path.dirname(target);
  const base = path.basename(target);
  // "Mr. Robot - S01E01.de.srt" → "Mr. Robot - S01E01 (1).de.srt"
  let { stem, suffix: ext } = splitExtension(base);
  if (!ext) {
    const dot = base.lastIndexOf(".");
    if (dot > 0) [stem, ext] = [base.slice(0, dot), base.slice(dot)];
  }
  for (let i = 1; i < 10_000; i++) {
    const candidate = path.join(dir, `${stem} (${i})${ext}`);
    if (!(await exists(candidate))) return candidate;
  }
  throw new FileOpError(tr(`Kein freier Name für ${target}`, `No free name for ${target}`));
}

/** Copies without ever replacing, then checks the size. */
async function copyVerified(from: string, to: string): Promise<void> {
  await fs.copyFile(from, to, constants.COPYFILE_EXCL);
  const [a, b] = await Promise.all([fs.stat(from), fs.stat(to)]);
  if (a.size !== b.size) {
    await fs.rm(to, { force: true });
    throw new FileOpError(tr(`Kopie unvollständig: ${to}`, `Incomplete copy: ${to}`));
  }
  await fs.utimes(to, a.atime, a.mtime);
}

/** rename() when possible; across file systems copy + verify + delete. */
async function moveFile(from: string, to: string): Promise<void> {
  try {
    if (await exists(to)) throw new FileOpError(tr(`Ziel existiert bereits: ${to}`, `Target already exists: ${to}`));
    await fs.rename(from, to);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
    await copyVerified(from, to);
    await fs.unlink(from);
  }
}

async function perform(action: Action, from: string, to: string): Promise<void> {
  switch (action) {
    case "move":
    case "rename":
      return moveFile(from, to);
    case "copy":
      return copyVerified(from, to);
    case "hardlink":
      try {
        return await fs.link(from, to);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "EXDEV") {
          throw new FileOpError(
            tr(
              "Hardlink über Dateisystemgrenzen nicht möglich: Quelle und Ziel müssen im selben Mount liegen",
              "Hardlinks cannot cross file systems: source and target must be on the same mount",
            ),
          );
        }
        throw e;
      }
    case "symlink":
      return fs.symlink(path.resolve(from), to);
    case "test":
      return;
  }
}

/** Executes one planned operation with the conflict policy. Never deletes an existing file. */
export async function executeOperation(op: PlannedOperation, options: ExecuteOptions = {}): Promise<OperationResult> {
  const policy = options.conflict ?? "skip";
  const from = path.resolve(op.from);
  let to = path.resolve(op.to);
  try {
    const source = await fs.stat(from);
    if (!source.isFile()) return { status: "failed", error: tr(`Keine Datei: ${from}`, `Not a file: ${from}`) };
    if (from === to) return { status: "skipped", reason: tr("Name unverändert", "Name unchanged"), to };

    const existing = await lstatOrUndefined(to);
    if (op.action === "test") return { status: "tested", to, conflict: existing !== undefined };

    let backup: string | undefined;
    let note: string | undefined;
    if (existing) {
      // Same file under another name (hardlink already there, case-only rename on macOS).
      if (existing.ino === source.ino && existing.dev === source.dev && op.action !== "rename") {
        return { status: "skipped", reason: tr("Ziel ist bereits dieselbe Datei", "Target is already the same file"), to };
      }
      if (policy === "skip") return { status: "skipped", reason: TARGET_EXISTS, to };
      if (policy === "suffix") to = await freeName(to);
      else {
        if (policy === "keep-better") {
          const [mine, theirs] = await Promise.all([options.quality?.(from, "incoming"), options.quality?.(to, "existing")]);
          const theirSize = existing.isSymbolicLink() ? ((await fs.stat(to).catch(() => undefined))?.size ?? 0) : existing.size;
          const { result, reason } = compareQuality({ ...mine, size: source.size }, { ...theirs, size: theirSize });
          if (result <= 0) {
            const why = reason ? ` (${reason})` : "";
            return {
              status: "skipped",
              reason:
                result < 0
                  ? `${tr("Vorhandene Datei ist besser", "Existing file is better")}${why}`
                  : tr("Vorhandene Datei hat gleiche Qualität", "Existing file has the same quality"),
              to,
            };
          }
          note = `${tr("Schlechtere Datei ersetzt", "Replaced a worse file")} (${reason})`;
        }
        backup = `${to}.namarr-bak-${(options.now ?? Date.now)()}`;
        await fs.rename(to, backup);
      }
    }

    const createdDirs = await ensureDir(path.dirname(to));
    try {
      await perform(op.action, from, to);
    } catch (e) {
      if (backup) await fs.rename(backup, to).catch(() => {});
      await removeEmptyDirs(createdDirs);
      throw e;
    }
    const after = await fs.lstat(to);
    return {
      status: "done",
      record: { action: op.action, from, to, size: source.size, inode: after.ino, backup, createdDirs },
      ...(note ? { note } : {}),
    };
  } catch (e) {
    return { status: "failed", error: (e as Error).message };
  }
}

export type BatchOptions = ExecuteOptions & {
  signal?: AbortSignal;
  onResult?: (index: number, result: OperationResult) => void | Promise<void>;
};

/** Runs operations one after another; an abort stops between files, never inside one. */
export async function executeAll(ops: PlannedOperation[], options: BatchOptions = {}): Promise<OperationResult[]> {
  const results: OperationResult[] = [];
  for (const [i, op] of ops.entries()) {
    if (options.signal?.aborted) break;
    const result = await executeOperation(op, options);
    results.push(result);
    await options.onResult?.(i, result);
  }
  return results;
}

export type UndoResult = { status: "undone" } | { status: "failed"; reason: string };

/** Reverts one operation, but only if the target is still the file we created. */
export async function undoOperation(record: OperationRecord): Promise<UndoResult> {
  try {
    if (record.action === "test") return { status: "undone" };
    const current = await lstatOrUndefined(record.to);
    if (!current) return { status: "failed", reason: tr(`Ziel fehlt: ${record.to}`, `Target missing: ${record.to}`) };

    if (record.action === "symlink") {
      if (!current.isSymbolicLink() || (await fs.readlink(record.to)) !== path.resolve(record.from)) {
        return { status: "failed", reason: tr("Symlink wurde verändert", "Symlink was changed") };
      }
      await fs.unlink(record.to);
    } else {
      if (current.size !== record.size || current.ino !== record.inode) {
        return {
          status: "failed",
          reason: tr("Zieldatei wurde seit der Ausführung verändert", "Target file changed since it was renamed"),
        };
      }
      if (record.action === "move" || record.action === "rename") {
        if (await exists(record.from))
          return { status: "failed", reason: tr(`Quelle existiert wieder: ${record.from}`, `Source exists again: ${record.from}`) };
        await ensureDir(path.dirname(record.from));
        await moveFile(record.to, record.from);
      } else {
        // copy and hardlink: the source is untouched, drop the target.
        if (record.action === "hardlink" && !(await exists(record.from))) {
          return {
            status: "failed",
            reason: tr("Quelle des Hardlinks fehlt, Ziel ist die letzte Kopie", "Hardlink source is missing, the target is the last copy"),
          };
        }
        await fs.unlink(record.to);
      }
    }
    if (record.backup) await fs.rename(record.backup, record.to);
    await removeEmptyDirs([...record.createdDirs].reverse());
    return { status: "undone" };
  } catch (e) {
    return { status: "failed", reason: (e as Error).message };
  }
}

/** Reverts a whole job: newest first, so folders created by earlier operations empty out. */
export async function undoAll(records: OperationRecord[]): Promise<UndoResult[]> {
  const results: UndoResult[] = new Array(records.length);
  for (let i = records.length - 1; i >= 0; i--) results[i] = await undoOperation(records[i]!);
  return results;
}

/** Removes the given folders if empty, innermost first as passed. */
async function removeEmptyDirs(dirs: string[]): Promise<void> {
  for (const d of [...dirs].sort((a, b) => b.length - a.length)) {
    try {
      await fs.rmdir(d);
    } catch {
      // not empty or already gone
    }
  }
}

/** Files left behind by downloaders. Deliberately narrow: a user's own notes are never junk. */
export const DEFAULT_JUNK = [/^thumbs\.db$/i, /^\.ds_store$/i, /^desktop\.ini$/i, /\.(url|nzb|sfv|par2)$/i, /^rarbg.*\.(txt|exe)$/i];

/**
 * Walks up from `start` to `root` (exclusive) and removes folders that are empty
 * or only hold junk. Returns the removed folders.
 */
export async function cleanupEmptyDirs(start: string, root: string, junk: RegExp[] = DEFAULT_JUNK): Promise<string[]> {
  const removed: string[] = [];
  const stop = path.resolve(root);
  let dir = path.resolve(start);
  while (dir !== stop && dir.startsWith(stop + path.sep)) {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      break;
    }
    const keep = [];
    for (const name of entries) {
      const st = await fs.lstat(path.join(dir, name));
      if (st.isDirectory() || !junk.some((j) => j.test(name))) keep.push(name);
    }
    if (keep.length) break;
    await fs.rm(dir, { recursive: true });
    removed.push(dir);
    dir = path.dirname(dir);
  }
  return removed;
}
