import { FILTERS } from "../formatter/template.ts";

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
  );

export type RuleEntry = {
  path: string;
  mtime?: Date;
  birthtime?: Date;
};

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
    throw new RuleError(`Ungültiger regulärer Ausdruck: ${(e as Error).message}`, index);
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
      return rule.stripDiacritics === false
        ? value.replace(/[äöüÄÖÜß]/g, (c) => FILTERS.ascii!(c, []))
        : FILTERS.ascii!(value, []);
    case "cutAfter": {
      if (!rule.pattern) return value;
      const m = pattern(rule.pattern, rule.regex, "iu", ruleIndex).exec(value);
      if (!m) return value;
      return value.slice(0, rule.keepMatch ? m.index + m[0].length : m.index).trimEnd();
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
  // Name and extension rules never create folders.
  const text = (v: string) => applyText(rule, v, entry, index, ruleIndex).replace(/[\\/]/g, "-");
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
    const order = rule.type === "numbering" && rule.sort === "name" ? nameOrder(prev) : undefined;
    steps.push(
      rule.enabled === false
        ? prev
        : prev.map((path, i) => applyRule(rule, path, entries[i]!, order ? order[i]! : i, ruleIndex)),
    );
  });
  return steps;
}

const collator = new Intl.Collator("de", { numeric: true, sensitivity: "base" });

/** Position of each path in natural sort order (file2 before file10). */
function nameOrder(paths: string[]): number[] {
  const sorted = paths.map((p, i) => ({ p, i })).sort((a, b) => collator.compare(a.p, b.p));
  const rank: number[] = [];
  sorted.forEach(({ i }, r) => (rank[i] = r));
  return rank;
}

export function applyRules(entries: RuleEntry[], rules: Rule[]): string[] {
  return previewRules(entries, rules).at(-1)!;
}

/** Short German label for the rule stack UI. */
export function describeRule(rule: Rule): string {
  switch (rule.type) {
    case "replace":
      return `Ersetzen ${rule.find} → "${rule.replace}"`;
    case "insert":
      return `Einfügen "${rule.text}"`;
    case "remove":
      return `Löschen ab ${rule.from}`;
    case "case":
      return `Schreibweise: ${rule.mode}`;
    case "separators":
      return `Trenner: "${rule.separator}"`;
    case "numbering":
      return `Nummerierung ab ${rule.start ?? 1}`;
    case "date":
      return `Datum ${rule.format ?? "YYYY-MM-DD"}`;
    case "extension":
      return `Erweiterung ${rule.to ?? rule.case ?? ""}`;
    case "transliterate":
      return "Umlaute ersetzen ä → ae";
    case "cutAfter":
      return `Abschneiden ab "${rule.pattern}"`;
  }
}
