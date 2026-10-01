const nf = new Intl.NumberFormat("de-DE");

export const num = (n: number) => nf.format(n);
export const pct = (n: number) => `${Math.round(n * 100)} %`;

export function ago(date: Date | string | number | null | undefined, now = Date.now()): string {
  if (!date) return "noch nie";
  const s = Math.max(0, Math.round((now - new Date(date).getTime()) / 1000));
  if (s < 60) return "gerade eben";
  if (s < 3600) return `vor ${Math.round(s / 60)} Min.`;
  if (s < 86400) return `vor ${Math.round(s / 3600)} Std.`;
  return `vor ${Math.round(s / 86400)} Tagen`;
}

export function greeting(hour = new Date().getHours()): string {
  if (hour < 11) return "Guten Morgen";
  if (hour < 18) return "Guten Tag";
  return "Guten Abend";
}

/** Splits a target path into folder part and file name, for the two-tone rendering. */
export function splitTarget(target: string, root?: string | null): { dir: string; file: string } {
  let rel = target;
  if (root && target.startsWith(root.endsWith("/") ? root : `${root}/`)) rel = target.slice(root.length).replace(/^\/+/, "");
  const slash = rel.lastIndexOf("/");
  return slash < 0 ? { dir: "", file: rel } : { dir: rel.slice(0, slash + 1), file: rel.slice(slash + 1) };
}

const norm = (w: string) =>
  w
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]/g, "");

/**
 * Marks the words of the new name that do not appear in the old one: what the rename adds
 * (episode titles, years, S01E12). Returns segments for rendering.
 */
export function diffWords(oldName: string, newName: string): { text: string; added: boolean }[] {
  const known = new Set(
    oldName
      .split(/[\s._\-()[\]]+/)
      .map(norm)
      .filter(Boolean),
  );
  const parts = newName.split(/(\s+|[._\-()[\],]+)/).filter((p) => p !== "");
  const out: { text: string; added: boolean }[] = [];
  for (const p of parts) {
    const n = norm(p);
    const added = n !== "" && !known.has(n) && !/^(mkv|mp4|avi|srt|season)$/.test(n);
    const last = out.at(-1);
    if (last && (last.added === added || n === "")) last.text += p;
    else out.push({ text: p, added });
  }
  return out;
}

export const ACTION_LABELS: Record<string, string> = {
  test: "Test (nur Vorschau)",
  move: "Verschieben",
  copy: "Kopieren",
  hardlink: "Hardlink",
  symlink: "Symlink",
  rename: "Umbenennen am Ort",
};

export const CONFLICT_LABELS: Record<string, string> = {
  skip: "Überspringen",
  overwrite: "Überschreiben",
  suffix: "Suffix anhängen",
  "keep-better": "Bessere behalten",
};

export const STATE_LABELS: Record<string, string> = {
  parsed: "erkannt",
  matched: "zugeordnet",
  needs_review: "prüfen",
  ready: "bereit",
  done: "erledigt",
  skipped: "übersprungen",
  failed: "fehlgeschlagen",
  undone: "rückgängig",
};

export const JOB_STATUS_LABELS: Record<string, string> = {
  pending: "Wartet",
  scanning: "Scannt",
  matching: "Ordnet zu",
  ready: "Vorschau bereit",
  executing: "Läuft",
  done: "Fertig",
  failed: "Fehlgeschlagen",
  cancelled: "Abgebrochen",
  undone: "Rückgängig gemacht",
};
