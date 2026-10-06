/**
 * The way back: from files that are already named (an existing library) to the template that names
 * them. Each sample is a path relative to its library with what namarr knows about the file
 * (parsed name, match, episodes). A built-in format that reproduces the samples wins; otherwise the
 * known values are replaced by their tokens, and the template that reproduces the most samples is
 * the answer.
 */
import { splitExtension } from "../parser/index.ts";
import { buildValues, type FormatInput, formatPath, PRESETS } from "./index.ts";
import { sanitizePath, sanitizeSegment } from "./sanitize.ts";

export type InferKind = "movie" | "episode";

/** `path`: relative to the library, with the extension (`Severance (2022)/Season 02/….mkv`). */
export type InferSample = { path: string; input: FormatInput };

export type SampleCheck = { path: string; rendered: string; ok: boolean };

export type InferResult = {
  template: string;
  /**
   * Built-in formats that fit just as well, when one fits best (Jellyfin and Emby name episodes
   * alike; movies without an edition fit every one of them).
   */
  presets: string[];
  checks: SampleCheck[];
  matched: number;
};

// Tokens by preference when two give the same text: the more specific first.
const ORDER: Record<InferKind, string[]> = {
  episode: [
    "s00e00",
    "sxe",
    "t",
    "n",
    "y",
    "rating",
    "abs",
    "absolute",
    "s00",
    "e00",
    "s",
    "e",
    "d",
    "vf",
    "vc",
    "ac",
    "af",
    "hdr",
    "source",
    "group",
    "lang",
    "edition",
    "part",
    "imdb",
    "tvdb",
    "tmdb",
    "id",
  ],
  movie: ["n", "y", "rating", "edition", "part", "vf", "vc", "ac", "af", "hdr", "source", "group", "lang", "imdb", "tmdb", "tvdb", "id"],
};
const TEXT_TOKENS = new Set(["n", "t", "edition"]);
/**
 * The parser names codecs one way (`DD+`, `H.264`), libraries write them in others (`EAC3`, `x264`).
 * Each family is one way of writing them, rendered back with `replace` filters. Sources that are
 * part of another's result come first (`AC3` before `DD+` → `E-AC3`).
 */
const SPELLINGS: Record<string, Record<string, string>[]> = {
  ac: [{ "DD+": "EAC3" }, { AC3: "AC-3", "DD+": "E-AC3" }, { AC3: "DD", "DD+": "DDP" }, { "DTS-HD": "DTS-HD MA" }],
  vc: [
    { "H.264": "x264", "H.265": "x265" },
    { "H.264": "H264", "H.265": "H265" },
    { "H.264": "h264", "H.265": "h265" },
    { "H.264": "AVC", "H.265": "HEVC" },
  ],
};
/** Tokens a file may lack: their separator goes into a condition, so files without them still fit. */
const OPTIONAL = /((?: - |[ ._-]?[[(]|[ ._-])?)\{(t|edition|rating)((?:\|[^}]*)?)\}([\])]?)/g;
const OPTIONAL_PART = /((?: - |[ ._-])?(?:pt|part|cd|disc)?)\{part\}/gi;

type Candidate = { expr: string; text: string; rank: number; numeric: boolean };

const normalize = (p: string) => sanitizePath(p.normalize("NFC").replace(/\\/g, "/"));

function render(template: string, input: FormatInput): string {
  try {
    return formatPath(template, input);
  } catch {
    return "";
  }
}

export function checkTemplate(template: string, samples: InferSample[]): SampleCheck[] {
  return samples.map((s) => {
    const rendered = render(template, s.input);
    return { path: s.path, rendered, ok: rendered === normalize(s.path) };
  });
}

function candidates(input: FormatInput, kind: InferKind): Candidate[] {
  const values = buildValues(input);
  const out: Candidate[] = [];
  ORDER[kind].forEach((token, rank) => {
    const raw = values[token];
    if (raw === undefined || raw === "") return;
    const value = String(raw);
    const forms: [string, string][] = [[token, value]];
    if (TEXT_TOKENS.has(token)) {
      const dotted = value.replace(/\s+/g, ".");
      forms.push(
        [`${token}|lower`, value.toLowerCase()],
        [`${token}|upper`, value.toUpperCase()],
        [`${token}|space:'.'`, dotted],
        [`${token}|lower|space:'.'`, dotted.toLowerCase()],
      );
    }
    for (const family of SPELLINGS[token] ?? []) {
      const spelled = family[value];
      if (spelled)
        forms.push([
          `${token}|${Object.entries(family)
            .map(([from, to]) => `replace:'${from}':'${to}'`)
            .join("|")}`,
          spelled,
        ]);
    }
    for (const [expr, text] of forms) {
      // The library has the cleaned form ("Mr. Robot - eps1.0" for "Mr. Robot: eps1.0").
      for (const t of new Set([text, sanitizeSegment(text)])) {
        if (t && t !== "_") out.push({ expr, text: t, rank, numeric: /^\d+$/.test(t) });
      }
    }
  });
  return out;
}

const isDigit = (c?: string) => c !== undefined && /\d/.test(c);
const isWord = (c?: string) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/** A number must not be part of a longer number (`2` in `2022`), a word not part of a longer word. */
function fits(body: string, at: number, c: Candidate): boolean {
  const before = body[at - 1];
  const after = body[at + c.text.length];
  if (c.numeric) return !isDigit(before) && !isDigit(after);
  return !(isWord(before) && isWord(c.text[0])) && !(isWord(after) && isWord(c.text.at(-1)));
}

/** The template that names this one file, or undefined when its extension does not fit. */
export function deriveTemplate(sample: InferSample, kind: InferKind): string | undefined {
  const target = normalize(sample.path);
  const { suffix } = splitExtension(sample.input.original);
  if (!target.toLowerCase().endsWith(suffix.toLowerCase())) return undefined;
  const body = target.slice(0, target.length - suffix.length);
  const list = candidates(sample.input, kind);

  let template = "";
  for (let i = 0; i < body.length; ) {
    let best: Candidate | undefined;
    for (const c of list) {
      if (!body.startsWith(c.text, i) || !fits(body, i, c)) continue;
      if (!best || c.text.length > best.text.length || (c.text.length === best.text.length && c.rank < best.rank)) best = c;
    }
    if (best) {
      template += `{${best.expr}}`;
      i += best.text.length;
    } else {
      const ch = body[i]!;
      template += ch === "{" || ch === "}" ? `\\${ch}` : ch;
      i++;
    }
  }
  return template
    .replace(OPTIONAL, (_, pre: string, token: string, filters: string, post: string) => `{?${token}}${pre}{${token}${filters}}${post}{/}`)
    .replace(OPTIONAL_PART, (_, pre: string) => `{?part}${pre}{part}{/}`);
}

// A template as parts: a conditional block, a token, an escaped brace, or one literal character.
const PART = /\{\?[^{}]+\}(?:\\.|\{[^?/][^{}]*\}|[^{\\])*?\{\/\}|\{[^{}]+\}|\\.|[\s\S]/g;
const tokenName = (part: string) => /^\{([a-z0-9]+)/i.exec(part)?.[1];
const isToken = (part: string) => part.startsWith("{") && !part.startsWith("{?") && !part.startsWith("{!") && part !== "{/}";

/**
 * Two derived templates as one: what only one of them has must be a conditional block (a rating
 * that one file lacks), the same token with filters wins over it without (`EAC3` only shows on
 * some files). Undefined when they differ otherwise.
 */
export function mergeTemplates(a: string, b: string): string | undefined {
  const x = a.match(PART) ?? [];
  const y = b.match(PART) ?? [];
  const same = (p: string, q: string) => p === q || (isToken(p) && isToken(q) && tokenName(p) === tokenName(q));
  // Longest common subsequence of parts.
  const lcs = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--)
      lcs[i]![j] = same(x[i]!, y[j]!) ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  let out = "";
  let i = 0;
  let j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && same(x[i]!, y[j]!)) {
      out += x[i]!.length >= y[j]!.length ? x[i] : y[j];
      i++;
      j++;
    } else if (i < x.length && (j >= y.length || lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) {
      if (!x[i]!.startsWith("{?")) return undefined;
      out += x[i++];
    } else {
      if (!y[j]!.startsWith("{?")) return undefined;
      out += y[j++];
    }
  }
  return out;
}

/**
 * The format of a library, from a few of its files. Undefined without samples. `matched` says on
 * how many samples the template reproduces the name exactly.
 */
export function inferFormat(samples: InferSample[], kind: InferKind): InferResult | undefined {
  if (!samples.length) return undefined;
  const builtin = Object.values(PRESETS).map((p) => (kind === "movie" ? p.movie : p.episode));
  const derived = samples.map((s) => deriveTemplate(s, kind)).filter((t): t is string => Boolean(t));
  const votes = new Map<string, number>();
  for (const t of derived) votes.set(t, (votes.get(t) ?? 0) + 1);
  // Each file shows only part of the format: fold the others into each derived template.
  const unique = [...votes.keys()];
  const merged = unique.map((start) => unique.reduce((acc, t) => mergeTemplates(acc, t) ?? acc, start));

  const scored = new Map<string, number>();
  let best: Omit<InferResult, "presets"> | undefined;
  let bestScore: number[] = [];
  for (const template of new Set([...builtin, ...derived, ...merged])) {
    const checks = checkTemplate(template, samples);
    const matched = checks.filter((c) => c.ok).length;
    scored.set(template, matched);
    // Most samples first, then a built-in format (in their order), then the one derived from most
    // samples, then the shorter.
    const preset = builtin.indexOf(template);
    const score = [matched, preset >= 0 ? builtin.length - preset : 0, votes.get(template) ?? 0, -template.length];
    if (!best || compare(score, bestScore) > 0) {
      best = { template, checks, matched };
      bestScore = score;
    }
  }
  const winner = best!;
  const presets = builtin.includes(winner.template)
    ? Object.values(PRESETS)
        .filter((p) => scored.get(kind === "movie" ? p.movie : p.episode) === winner.matched)
        .map((p) => p.id)
    : [];
  return { ...winner, presets };
}

function compare(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}
