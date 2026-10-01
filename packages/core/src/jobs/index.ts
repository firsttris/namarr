import * as path from "node:path";
import { formatPath, presetTemplate, type SanitizeOptions, sanitizeSegment } from "../formatter/index.ts";
import { classify, type MatchResult } from "../matcher/index.ts";
import { applyRules, type Rule } from "../rules/index.ts";
import type { Companion, ScannedFile } from "../scanner/index.ts";
import type { Parsed } from "../types.ts";

/** parsed → matched → needs_review | ready → done | skipped | failed → undone */
export type ItemState = "parsed" | "matched" | "needs_review" | "ready" | "done" | "skipped" | "failed" | "undone";

const TRANSITIONS: Record<ItemState, ItemState[]> = {
  parsed: ["matched", "needs_review", "ready", "skipped", "failed"],
  matched: ["needs_review", "ready", "skipped", "failed"],
  needs_review: ["ready", "skipped", "needs_review", "failed"],
  ready: ["done", "skipped", "failed", "needs_review", "ready"],
  done: ["undone", "failed"],
  skipped: ["ready", "needs_review", "skipped"],
  failed: ["ready", "needs_review", "failed", "done"],
  undone: ["ready", "needs_review"],
};

export function canTransition(from: ItemState, to: ItemState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: ItemState, to: ItemState): void {
  if (!canTransition(from, to)) throw new Error(`Ungültiger Zustandswechsel ${from} → ${to}`);
}

export type Mode = "media" | "rules" | "both";

export type PreviewConfig = {
  mode: Mode;
  /** Template or preset id. Empty: preset `jellyfin`. */
  template?: { movie?: string; episode?: string } | string;
  preset?: string;
  rules?: Rule[];
  /** Absolute folder targets go under. Rule mode without it renames in place. */
  targetRoot?: string;
  autoThreshold?: number;
  sanitize?: SanitizeOptions;
};

export type PreviewInput = {
  file: ScannedFile;
  parsed: Parsed;
  match?: MatchResult;
  /** Manual override from the UI. */
  targetOverride?: string;
  excluded?: boolean;
};

export type PreviewItem = {
  source: string;
  target?: string;
  state: ItemState;
  confidence: number;
  reasons: string[];
  companions: { from: string; to: string }[];
  conflict?: "duplicate" | "exists";
};

export type PreviewSummary = { total: number; ready: number; review: number; skipped: number; conflicts: number };

function templateFor(config: PreviewConfig, kind: Parsed["kind"]["value"]): string {
  const t = config.template;
  if (typeof t === "string" && t.trim()) return t;
  if (t && typeof t === "object") {
    const chosen = kind === "episode" ? t.episode : t.movie;
    if (chosen?.trim()) return chosen;
  }
  return presetTemplate(config.preset ?? "jellyfin", kind);
}

function companionTarget(target: string, companion: Companion): string {
  const { dir, name } = path.parse(target);
  return path.join(dir, name + companion.suffix);
}

/**
 * Computes target paths for a set of files: template (media mode), rule stack, or both.
 * Pure: no disk access. Conflicts with existing files are checked by the caller.
 */
export function buildPreview(inputs: PreviewInput[], config: PreviewConfig): PreviewItem[] {
  const items: PreviewItem[] = inputs.map(({ file, parsed, match, targetOverride, excluded }) => {
    const base: PreviewItem = { source: file.path, state: "parsed", confidence: 1, reasons: [], companions: [] };
    if (excluded) return { ...base, state: "skipped", reasons: ["Manuell ausgeschlossen"] };
    if (parsed.sample) return { ...base, state: "skipped", reasons: ["Übersprungen: Sample-Datei"] };

    let relative: string | undefined;
    if (targetOverride) {
      relative = targetOverride;
      return { ...base, target: resolveTarget(relative, file, config), state: "ready", reasons: ["Manuell festgelegt"] };
    }
    if (config.mode === "rules") {
      relative = path.basename(file.path);
      return { ...base, target: resolveTarget(relative, file, config), state: "ready" };
    }
    if (!match?.best) {
      return { ...base, state: "needs_review", confidence: match?.confidence ?? 0, reasons: match?.reasons ?? ["Kein Treffer gefunden"] };
    }
    const kind = match.best.kind === "series" ? "episode" : "movie";
    relative = formatPath(
      templateFor(config, kind),
      { parsed, match: match.best, episodes: match.episodes, original: path.basename(file.path) },
      config.sanitize,
    );
    const decision = classify(match.confidence, config.autoThreshold);
    return {
      ...base,
      target: resolveTarget(relative, file, config),
      state: decision === "auto" ? "ready" : "needs_review",
      confidence: match.confidence,
      reasons: match.reasons,
    };
  });

  if (config.mode !== "media" && config.rules?.length) {
    const indices = items.flatMap((item, i) => (item.target ? [i] : []));
    const withTarget = indices.map((i) => items[i]!);
    const renamed = applyRules(
      indices.map((i) => {
        const { file } = inputs[i]!;
        return { path: items[i]!.target!, mtime: file.mtime, birthtime: file.birthtime };
      }),
      config.rules,
    );
    withTarget.forEach((item, idx) => {
      // Rules may produce invalid names; sanitize the file name, keep the folders.
      const out = renamed[idx]!;
      item.target = path.join(path.dirname(out), sanitizeSegment(path.basename(out), config.sanitize));
    });
  }

  for (const [i, item] of items.entries()) {
    const file = inputs[i]!.file;
    if (item.target) item.companions = file.companions.map((c) => ({ from: c.path, to: companionTarget(item.target!, c) }));
  }
  markDuplicates(items);
  return items;
}

function resolveTarget(relative: string, file: ScannedFile, config: PreviewConfig): string {
  if (path.isAbsolute(relative)) return path.normalize(relative);
  const root = config.targetRoot ?? path.dirname(file.path);
  return path.join(root, relative);
}

/** Two files must never land on the same target. */
export function markDuplicates(items: PreviewItem[]): void {
  const seen = new Map<string, PreviewItem>();
  for (const item of items) {
    if (!item.target || item.state === "skipped") continue;
    const key = item.target.normalize("NFC").toLowerCase();
    const other = seen.get(key);
    if (other) {
      item.conflict = "duplicate";
      other.conflict = "duplicate";
      item.state = "needs_review";
      if (!item.reasons.includes("Doppeltes Ziel")) item.reasons.push("Doppeltes Ziel");
    } else seen.set(key, item);
  }
}

export function summarize(items: PreviewItem[]): PreviewSummary {
  return {
    total: items.length,
    ready: items.filter((i) => i.state === "ready").length,
    review: items.filter((i) => i.state === "needs_review").length,
    skipped: items.filter((i) => i.state === "skipped").length,
    conflicts: items.filter((i) => i.conflict).length,
  };
}
