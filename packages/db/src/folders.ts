// Folders namarr works in, some of them library folders. Pure: safe to import from browser code.
import type { JobConfig, Targets } from "./schema.ts";

export const FOLDER_KINDS = ["folder", "movies", "series"] as const;
export type FolderKind = (typeof FOLDER_KINDS)[number];

/**
 * A folder namarr may browse and change. `movies`/`series`: also a library folder, a target for
 * that kind in media mode; the one marked `default` is used unless a profile or job picks another.
 */
export type LibraryFolder = { path: string; name: string; kind: FolderKind; default?: boolean };

/** Settings from before library folders: allowed roots, plus one default target for everything. */
export function migrateFolders(roots: string[] = [], defaultTarget?: string): LibraryFolder[] {
  const name = (p: string) => p.split("/").filter(Boolean).at(-1) ?? p;
  const folders: LibraryFolder[] = roots.map((p) => ({ path: p, name: name(p), kind: "folder" }));
  if (defaultTarget) {
    folders.push({ path: defaultTarget, name: name(defaultTarget), kind: "movies", default: true });
    folders.push({ path: defaultTarget, name: name(defaultTarget), kind: "series", default: true });
  }
  return folders;
}

/** The folders namarr may read and write in. */
export const allowedRoots = (s: { folders: LibraryFolder[] }): string[] => [...new Set(s.folders.map((f) => f.path))];

/** The library folder for a kind: the one marked default, else the only one. */
export function defaultFolder(s: { folders: LibraryFolder[] }, kind: "movies" | "series"): string | undefined {
  const ofKind = s.folders.filter((f) => f.kind === kind);
  return (ofKind.find((f) => f.default) ?? (ofKind.length === 1 ? ofKind[0] : undefined))?.path;
}

/**
 * The folders a job uses: the first layer that names one (job, watch folder, profile …), else the
 * default library folders. `other` (rule mode) has no default: rule mode renames in place.
 */
export function resolveTargets(s: { folders: LibraryFolder[] }, ...layers: (Targets | null | undefined)[]): Targets {
  const pick = (key: keyof Targets) => layers.map((l) => l?.[key]).find((v) => v);
  return {
    movie: pick("movie") ?? defaultFolder(s, "movies"),
    series: pick("series") ?? defaultFolder(s, "series"),
    other: pick("other"),
  };
}

/** The folders a job's targets lie under, for showing targets relative to them. */
export function jobTargetRoots(config: Pick<JobConfig, "targetRoot" | "targets">): string[] {
  return [config.targetRoot, config.targets?.movie, config.targets?.series].filter((r): r is string => Boolean(r));
}
