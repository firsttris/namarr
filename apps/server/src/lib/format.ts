import * as m from "~/paraglide/messages";

export const num = (n: number, locale = "de-DE") => new Intl.NumberFormat(locale).format(n);
export const pct = (n: number) => `${Math.round(n * 100)} %`;

export function ago(date: Date | string | number | null | undefined, now = Date.now()): string {
  if (!date) return m.time_never();
  const s = Math.max(0, Math.round((now - new Date(date).getTime()) / 1000));
  if (s < 60) return m.time_justNow();
  if (s < 3600) return m.time_minutes({ n: Math.round(s / 60) });
  if (s < 86400) return m.time_hours({ n: Math.round(s / 3600) });
  return m.time_days({ n: Math.round(s / 86400) });
}

export function greeting(hour = new Date().getHours()): string {
  if (hour < 11) return m.time_greetingMorning();
  if (hour < 18) return m.time_greetingDay();
  return m.time_greetingEvening();
}

/** Splits a target path into folder part and file name, for the two-tone rendering. */
export function splitTarget(target: string, roots: (string | null | undefined)[]): { dir: string; file: string } {
  // The deepest folder the target lies in (a job can have one for movies and one for series).
  const root = roots
    .filter((r): r is string => Boolean(r) && target.startsWith(r!.endsWith("/") ? r! : `${r}/`))
    .sort((a, b) => b.length - a.length)[0];
  let rel = target;
  if (root) rel = target.slice(root.length).replace(/^\/+/, "");
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
    const added = n !== "" && !known.has(n) && !/^(mkv|mp4|avi|srt|season|staffel)$/.test(n);
    const last = out.at(-1);
    if (last && (last.added === added || n === "")) last.text += p;
    else out.push({ text: p, added });
  }
  return out;
}
