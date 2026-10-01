import { constants, type Stats } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { splitExtension } from "../parser/index.ts";

export const ACTIONS = ["move", "copy", "hardlink", "symlink", "rename", "test"] as const;
export const CONFLICT_POLICIES = ["skip", "overwrite", "suffix", "keep-better"] as const;

export type Action = (typeof ACTIONS)[number];
export type ConflictPolicy = (typeof CONFLICT_POLICIES)[number];

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
  | { status: "done"; record: OperationRecord }
  | { status: "tested"; to: string; conflict: boolean }
  | { status: "skipped"; reason: string; to: string }
  | { status: "failed"; error: string };

export type ExecuteOptions = {
  conflict?: ConflictPolicy;
  /** Higher is better. Defaults to file size. */
  quality?: (file: string, stats: Stats) => number | Promise<number>;
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
  throw new FileOpError(`Kein freier Name für ${target}`);
}

/** Copies without ever replacing, then checks the size. */
async function copyVerified(from: string, to: string): Promise<void> {
  await fs.copyFile(from, to, constants.COPYFILE_EXCL);
  const [a, b] = await Promise.all([fs.stat(from), fs.stat(to)]);
  if (a.size !== b.size) {
    await fs.rm(to, { force: true });
    throw new FileOpError(`Kopie unvollständig: ${to}`);
  }
  await fs.utimes(to, a.atime, a.mtime);
}

/** rename() when possible; across file systems copy + verify + delete. */
async function moveFile(from: string, to: string): Promise<void> {
  try {
    if (await exists(to)) throw new FileOpError(`Ziel existiert bereits: ${to}`);
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
          throw new FileOpError("Hardlink über Dateisystemgrenzen nicht möglich: Quelle und Ziel müssen im selben Mount liegen");
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
    if (!source.isFile()) return { status: "failed", error: `Keine Datei: ${from}` };
    if (from === to) return { status: "skipped", reason: "Name unverändert", to };

    const existing = await lstatOrUndefined(to);
    if (op.action === "test") return { status: "tested", to, conflict: existing !== undefined };

    let backup: string | undefined;
    if (existing) {
      // Same file under another name (hardlink already there, case-only rename on macOS).
      if (existing.ino === source.ino && existing.dev === source.dev && op.action !== "rename") {
        return { status: "skipped", reason: "Ziel ist bereits dieselbe Datei", to };
      }
      if (policy === "skip") return { status: "skipped", reason: "Ziel existiert bereits", to };
      if (policy === "suffix") to = await freeName(to);
      else {
        if (policy === "keep-better") {
          const quality = options.quality ?? ((_f: string, s: Stats) => s.size);
          const [mine, theirs] = await Promise.all([quality(from, source), quality(to, existing as Stats)]);
          if (mine <= theirs) return { status: "skipped", reason: "Vorhandene Datei hat gleiche oder bessere Qualität", to };
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
    if (!current) return { status: "failed", reason: `Ziel fehlt: ${record.to}` };

    if (record.action === "symlink") {
      if (!current.isSymbolicLink() || (await fs.readlink(record.to)) !== path.resolve(record.from)) {
        return { status: "failed", reason: "Symlink wurde verändert" };
      }
      await fs.unlink(record.to);
    } else {
      if (current.size !== record.size || current.ino !== record.inode) {
        return { status: "failed", reason: "Zieldatei wurde seit der Ausführung verändert" };
      }
      if (record.action === "move" || record.action === "rename") {
        if (await exists(record.from)) return { status: "failed", reason: `Quelle existiert wieder: ${record.from}` };
        await ensureDir(path.dirname(record.from));
        await moveFile(record.to, record.from);
      } else {
        // copy and hardlink: the source is untouched, drop the target.
        if (record.action === "hardlink" && !(await exists(record.from))) {
          return { status: "failed", reason: "Quelle des Hardlinks fehlt, Ziel ist die letzte Kopie" };
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
