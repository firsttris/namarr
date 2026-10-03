import { msg } from "../i18n.ts";

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
  if (!canTransition(from, to)) throw new Error(msg("jobs_error_invalidTransition", { path: to }));
}
