import { sanitizeSegment } from "../formatter/sanitize.ts";
import { FILTERS } from "../formatter/template.ts";
import { tr } from "../i18n.ts";
import type { FileMeta } from "../metadata/index.ts";

/** Which part of the path a rule rewrites. */
export type RuleTarget = "name" | "extension" | "full";

type Base = { id?: string; enabled?: boolean; target?: RuleTarget };

export type Rule = Base &
  (
    | { type: "replace"; find: string; replace: string; regex?: boolean; caseSensitive?: boolean; all?: boolean }
    | { type: "insert"; text: string; position: "start" | "end" | number }
    | { type: "remove"; from: number; count?: number; fromEnd?: boolean }
    | { type: "case"; mode: "title" | "lower" | "upper" | "sentence" }
    | { type: "separators"; separator: string }
    | {
        type: "numbering";
        start?: number;
        step?: number;
        padding?: number;
        position?: "start" | "end";
        separator?: string;
        /** `name`: number in natural name order instead of list order. */
        sort?: "list" | "name";
      }
    | { type: "date"; source?: "mtime" | "birthtime"; format?: string; position?: "start" | "end"; separator?: string }
    | { type: "extension"; to?: string; case?: "lower" | "upper" }
    | { type: "transliterate"; stripDiacritics?: boolean }
    | { type: "cutAfter"; pattern: string; regex?: boolean; keepMatch?: boolean }
    /** Numbers in the name to at least `digits` digits: "Folge 5" → "Folge 05". */
    | { type: "pad"; digits: number }
    /** Bracketed parts away, dots and underscores to spaces, spaces tidied. */
    | { type: "cleanup"; brackets?: boolean; separators?: boolean; spaces?: boolean }
    /** Removes kinds of characters: digits, symbols (neither letter, digit nor space), a custom set. */
    | { type: "strip"; digits?: boolean; symbols?: boolean; chars?: string }
    /** Splits at `delimiter` and joins the parts by `pattern`: "$2 - $1". */
    | { type: "rearrange"; delimiter: string; pattern: string }
    /** New names from a list, one per file in list or name order; files past the list stay. */
    | { type: "list"; names: string[]; sort?: "list" | "name" }
    /**
     * Name from inside the file: `{date:YYYY-MM-DD}` (EXIF capture date, video creation time),
     * `{artist}`, `{title}`, `{album}`, `{track}`, … Files lacking a used value stay unchanged.
     */
    | { type: "metadata"; template: string; position?: "replace" | "start" | "end"; separator?: string }
  );

export type RuleEntry = {
  path: string;
  mtime?: Date;
  birthtime?: Date;
  /** Read only for stacks with a metadata rule (see `needsMetadata`). */
  meta?: FileMeta;
};

/** Whether the stack reads data from inside the files, which costs a file read per entry. */
export const needsMetadata = (rules: Rule[]) => rules.some((r) => r.type === "metadata" && r.enabled !== false);

export class RuleError extends Error {
  constructor(
    message: string,
    readonly ruleIndex: number,
  ) {
    super(message);
    this.name = "RuleError";
  }
}

type Parts = { dir: string; stem: string; ext: string };

function split(path: string): Parts {
  const slash = path.lastIndexOf("/");
  const dir = slash >= 0 ? path.slice(0, slash + 1) : "";
  const base = path.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return { dir, stem: base, ext: "" };
  return { dir, stem: base.slice(0, dot), ext: base.slice(dot + 1) };
}

const join = ({ dir, stem, ext }: Parts) => `${dir}${stem}${ext ? `.${ext}` : ""}`;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pattern(find: string, regex: boolean | undefined, flags: string, index: number): RegExp {
  try {
    return new RegExp(regex ? find : escapeRegex(find), flags);
  } catch (e) {
    throw new RuleError(
      tr(`Ungültiger regulärer Ausdruck: ${(e as Error).message}`, `Invalid regular expression: ${(e as Error).message}`),
      index,
    );
  }
}

function formatDate(date: Date, format: string): string {
  const parts: Record<string, string> = {
    YYYY: String(date.getFullYear()),
    MM: String(date.getMonth() + 1).padStart(2, "0"),
    DD: String(date.getDate()).padStart(2, "0"),
    HH: String(date.getHours()).padStart(2, "0"),
    mm: String(date.getMinutes()).padStart(2, "0"),
    ss: String(date.getSeconds()).padStart(2, "0"),
  };
  return format.replace(/YYYY|MM|DD|HH|mm|ss/g, (t) => parts[t]!);
}

/** `{date:FORMAT}` and tag tokens filled from the file; undefined when a used value is missing. */
function fillMetadata(template: string, meta: FileMeta | undefined): string | undefined {
  let missing = false;
  const out = template.replace(/\{([a-z_.]+)(?::([^}]*))?\}/gi, (_, name: string, arg: string | undefined) => {
    const key = name.toLowerCase();
    let value: string | undefined;
    if (key === "date") value = meta?.taken ? formatDate(meta.taken, arg || "YYYY-MM-DD") : undefined;
    else if (key === "year") value = (meta?.tags.date ?? meta?.tags.year)?.slice(0, 4);
    else if (key === "track" || key === "disc") {
      // "3/12" → 03; the argument sets the digits (default 2 for tracks)
      const n = /\d+/.exec(meta?.tags[key] ?? "")?.[0];
      value = n === undefined ? undefined : n.padStart(Number(arg ?? (key === "track" ? 2 : 1)), "0");
    } else if (key === "albumartist") value = meta?.tags.album_artist ?? meta?.tags.albumartist;
    else value = meta?.tags[key];
    if (!value) missing = true;
    // Only slashes of the template make folders; one in a tag ("AC/DC") does not.
    return (value ?? "").replace(/[\\/]/g, "-");
  });
  return missing ? undefined : out;
}

function place(value: string, addition: string, position: "start" | "end", separator: string): string {
  return position === "start" ? `${addition}${separator}${value}` : `${value}${separator}${addition}`;
}

/** Applies one rule to one string. `index` is the entry's position, for numbering. */
function applyText(rule: Rule, value: string, entry: RuleEntry, index: number, ruleIndex: number): string {
  switch (rule.type) {
    case "replace": {
      if (!rule.find) return value;
      const flags = `${rule.all === false ? "" : "g"}${rule.caseSensitive ? "" : "i"}u`;
      const re = pattern(rule.find, rule.regex, flags, ruleIndex);
      // Plain text replaces literally; regex supports $1 groups.
      return rule.regex ? value.replace(re, rule.replace) : value.replace(re, () => rule.replace);
    }
    case "insert": {
      if (rule.position === "start") return rule.text + value;
      if (rule.position === "end") return value + rule.text;
      const chars = [...value];
      const at = Math.max(0, Math.min(chars.length, rule.position));
      return chars.slice(0, at).join("") + rule.text + chars.slice(at).join("");
    }
    case "remove": {
      const chars = [...value];
      const count = rule.count ?? chars.length;
      const from = rule.fromEnd ? Math.max(0, chars.length - rule.from - count) : rule.from;
      chars.splice(Math.max(0, from), Math.max(0, count));
      return chars.join("");
    }
    case "case":
      switch (rule.mode) {
        case "lower":
          return value.toLowerCase();
        case "upper":
          return value.toUpperCase();
        case "title":
          return FILTERS.title!(value.toLowerCase(), []);
        case "sentence":
          return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
      }
      return value;
    case "separators":
      return value
        .replace(/[\s._-]+/g, rule.separator)
        .replace(new RegExp(`^${escapeRegex(rule.separator)}+|${escapeRegex(rule.separator)}+$`, "g"), "");
    case "numbering": {
      const n = (rule.start ?? 1) + index * (rule.step ?? 1);
      const text = String(n).padStart(rule.padding ?? 0, "0");
      return place(value, text, rule.position ?? "start", rule.separator ?? " - ");
    }
    case "date": {
      const date = (rule.source === "birthtime" ? entry.birthtime : entry.mtime) ?? entry.mtime;
      if (!date) return value;
      return place(value, formatDate(date, rule.format ?? "YYYY-MM-DD"), rule.position ?? "start", rule.separator ?? " ");
    }
    case "extension":
      return value;
    case "transliterate":
      return rule.stripDiacritics === false ? value.replace(/[äöüÄÖÜß]/g, (c) => FILTERS.ascii!(c, [])) : FILTERS.ascii!(value, []);
    case "cutAfter": {
      if (!rule.pattern) return value;
      const m = pattern(rule.pattern, rule.regex, "iu", ruleIndex).exec(value);
      if (!m) return value;
      return value.slice(0, rule.keepMatch ? m.index + m[0].length : m.index).trimEnd();
    }
    case "pad":
      return value.replace(/\d+/g, (n) => n.padStart(Math.min(Math.max(rule.digits, 1), 10), "0"));
    case "cleanup": {
      let v = value;
      if (rule.brackets !== false) v = v.replace(/\s*(\[[^\]]*\]|\([^)]*\)|\{[^}]*\})/g, "");
      if (rule.separators) v = v.replace(/[._]+/g, " ");
      if (rule.spaces !== false) v = v.replace(/\s{2,}/g, " ").replace(/^[\s._-]+|[\s._-]+$/g, "");
      return v;
    }
    case "strip": {
      let v = value;
      if (rule.digits) v = v.replace(/\p{N}/gu, "");
      if (rule.symbols) v = v.replace(/[^\p{L}\p{N}\s]/gu, "");
      if (rule.chars) v = v.replace(new RegExp(`[${escapeRegex(rule.chars).replace(/-/g, "\\-")}]`, "gu"), "");
      return v;
    }
    case "rearrange": {
      if (!rule.delimiter) return value;
      const parts = value.split(rule.delimiter).map((p) => p.trim());
      return rule.pattern.replace(/\$(\d+)/g, (_, n: string) => (n === "0" ? value : (parts[Number(n) - 1] ?? "")));
    }
    case "list": {
      const name = rule.names[index]?.trim();
      return name || value;
    }
    case "metadata": {
      const filled = fillMetadata(rule.template, entry.meta);
      if (filled === undefined) return value;
      const position = rule.position ?? "replace";
      return position === "replace" ? filled : place(value, filled, position, rule.separator ?? " ");
    }
  }
}

function applyRule(rule: Rule, path: string, entry: RuleEntry, index: number, ruleIndex: number): string {
  const parts = split(path);
  if (rule.type === "extension") {
    let ext = rule.to !== undefined ? rule.to.replace(/^\./, "") : parts.ext;
    if (rule.case === "lower") ext = ext.toLowerCase();
    if (rule.case === "upper") ext = ext.toUpperCase();
    return join({ ...parts, ext });
  }
  const target = rule.target ?? "name";
  if (target === "full") return applyText(rule, path, entry, index, ruleIndex);
  // Name and extension rules never create folders, except a metadata template that asks for
  // them ("{artist}/{album}/{track} {title}"): those land below the file's folder.
  const folders = rule.type === "metadata" && target === "name";
  const text = (v: string) => {
    const out = applyText(rule, v, entry, index, ruleIndex);
    if (!folders) return out.replace(/[\\/]/g, "-");
    // Each folder is cleaned like a file name, so ".." or "Album: Live" cannot misbehave.
    const segments = out.split("/").filter((seg) => seg.trim());
    return segments.map((seg, k) => (k < segments.length - 1 ? sanitizeSegment(seg) : seg)).join("/");
  };
  if (target === "extension") return join({ ...parts, ext: text(parts.ext) });
  // An empty name would turn the extension into a hidden file name (".mkv").
  return join({ ...parts, stem: text(parts.stem) || "_" });
}

/**
 * Applies the rule stack to every entry and returns each intermediate step:
 * `steps[k][i]` is entry `i` after the first `k` rules, `steps[0]` the input.
 */
export function previewRules(entries: RuleEntry[], rules: Rule[]): string[][] {
  const steps: string[][] = [entries.map((e) => e.path)];
  rules.forEach((rule, ruleIndex) => {
    const prev = steps.at(-1)!;
    const order = (rule.type === "numbering" || rule.type === "list") && rule.sort === "name" ? nameOrder(prev) : undefined;
    steps.push(rule.enabled === false ? prev : prev.map((path, i) => applyRule(rule, path, entries[i]!, order ? order[i]! : i, ruleIndex)));
  });
  return steps;
}

const collator = new Intl.Collator("de", { numeric: true, sensitivity: "base" });

/** Position of each path in natural sort order (file2 before file10). */
function nameOrder(paths: string[]): number[] {
  const sorted = paths.map((p, i) => ({ p, i })).sort((a, b) => collator.compare(a.p, b.p));
  const rank: number[] = [];
  sorted.forEach(({ i }, r) => {
    rank[i] = r;
  });
  return rank;
}

export function applyRules(entries: RuleEntry[], rules: Rule[]): string[] {
  return previewRules(entries, rules).at(-1)!;
}

/** Short label for the rule stack UI, in both languages (see `localize`). */
export function describeRule(rule: Rule): string {
  switch (rule.type) {
    case "replace":
      return tr(`Ersetzen ${rule.find} → "${rule.replace}"`, `Replace ${rule.find} → "${rule.replace}"`);
    case "insert":
      return tr(`Einfügen "${rule.text}"`, `Insert "${rule.text}"`);
    case "remove":
      return tr(`Löschen ab ${rule.from}`, `Delete from ${rule.from}`);
    case "case":
      return tr(`Schreibweise: ${rule.mode}`, `Case: ${rule.mode}`);
    case "separators":
      return tr(`Trenner: "${rule.separator}"`, `Separator: "${rule.separator}"`);
    case "numbering":
      return tr(`Nummerierung ab ${rule.start ?? 1}`, `Numbering from ${rule.start ?? 1}`);
    case "date":
      return tr(`Datum ${rule.format ?? "YYYY-MM-DD"}`, `Date ${rule.format ?? "YYYY-MM-DD"}`);
    case "extension":
      return tr(`Erweiterung ${rule.to ?? rule.case ?? ""}`, `Extension ${rule.to ?? rule.case ?? ""}`);
    case "transliterate":
      return tr("Umlaute ersetzen ä → ae", "Transliterate ä → ae");
    case "cutAfter":
      return tr(`Abschneiden ab "${rule.pattern}"`, `Cut from "${rule.pattern}"`);
    case "pad":
      return tr(`Zahlen auf ${rule.digits} Stellen`, `Numbers to ${rule.digits} digits`);
    case "cleanup":
      return tr("Aufräumen: Klammern, Leerzeichen", "Clean up: brackets, spaces");
    case "strip":
      return tr(
        `Entfernen: ${[rule.digits && "Ziffern", rule.symbols && "Sonderzeichen", rule.chars && `„${rule.chars}“`].filter(Boolean).join(", ") || "–"}`,
        `Strip: ${[rule.digits && "digits", rule.symbols && "symbols", rule.chars && `"${rule.chars}"`].filter(Boolean).join(", ") || "–"}`,
      );
    case "rearrange":
      return tr(`Umsortieren an "${rule.delimiter}" → ${rule.pattern}`, `Rearrange at "${rule.delimiter}" → ${rule.pattern}`);
    case "list":
      return tr(`Namensliste (${rule.names.length})`, `Name list (${rule.names.length})`);
    case "metadata":
      return tr(`Aus der Datei: ${rule.template}`, `From the file: ${rule.template}`);
  }
}
