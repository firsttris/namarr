import type { ExternalIds, Parsed } from "../types.ts";
import { groupRule, type ParseContext, RULES, resolvePending } from "./rules.ts";

export * from "./rules.ts";

export const VIDEO_EXTENSIONS = ["mkv", "mp4", "avi", "m4v", "mov", "wmv", "ts", "m2ts", "webm", "mpg", "mpeg", "flv", "iso"];
export const SUBTITLE_EXTENSIONS = ["srt", "ass", "ssa", "sub", "idx", "sup", "vtt"];
export const SIDECAR_EXTENSIONS = [...SUBTITLE_EXTENSIONS, "nfo", "jpg", "jpeg", "png", "txt"];
const KNOWN_EXTENSIONS = new Set([...VIDEO_EXTENSIONS, ...SIDECAR_EXTENSIONS]);

/** Tags between the base name and a subtitle extension: Movie.de.forced.srt */
const SUBTITLE_TAG = /^(?:[a-z]{2,3}(?:-[a-z]{2})?|forced|sdh|cc|hi|default)$/i;

export type SplitName = { stem: string; extension?: string; suffix: string };

/** Splits `name.de.forced.srt` into stem `name`, extension `srt` and suffix `.de.forced.srt`. */
export function splitExtension(fileName: string): SplitName {
  const parts = fileName.split(".");
  const ext = parts.length > 1 ? parts.at(-1)!.toLowerCase() : undefined;
  if (!ext || !KNOWN_EXTENSIONS.has(ext)) return { stem: fileName, suffix: "" };
  let cut = parts.length - 1;
  if (SUBTITLE_EXTENSIONS.includes(ext)) {
    while (cut > 1 && SUBTITLE_TAG.test(parts[cut - 1]!) && parts.length - cut < 3) cut--;
  }
  return { stem: parts.slice(0, cut).join("."), extension: ext, suffix: `.${parts.slice(cut).join(".")}` };
}

/** `[tvdbid-72073]`, `{tvdb-72073}`, `[tmdbid=1399]`, `{imdb-tt0106145}`, `[anidb-17617]` */
const ID_TAG = /\s*[[{]\s*(tmdb|tvdb|imdb|anidb)(?:id)?\s*[-=:]\s*(tt\d+|\d+)\s*[\]}]/gi;

/** Reads external IDs from a name and returns the name without them. */
export function extractIds(name: string): { ids?: ExternalIds; rest: string } {
  let ids: ExternalIds | undefined;
  const rest = name.replace(ID_TAG, (_, source: string, id: string) => {
    ids = { ...ids, [source.toLowerCase()]: id };
    return "";
  });
  return { ids, rest };
}

function emptyParsed(): Parsed {
  return { kind: { value: "unknown", confidence: 0 }, episodes: [], release: { languages: [] } };
}

function cleanTitle(raw: string): string | undefined {
  const title = raw
    .replace(/[._]+/g, " ")
    .replace(/\(\s*\)|\[\s*\]/g, " ")
    .replace(/[\s\-–([{]+$/g, "")
    .replace(/^[\s\-–)\]}]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return title || undefined;
}

/** Parses a single name (no folders). */
export function parseName(fileName: string): Parsed {
  const { stem, extension } = splitExtension(fileName);
  const out = emptyParsed();
  if (extension) out.extension = extension;

  const { ids, rest } = extractIds(stem);
  if (ids) out.ids = ids;
  let name = rest.trim();
  let bracketGroup = false;
  const lead = /^\[([^\]]+)\]\s*/.exec(name);
  if (lead) {
    out.release.group = lead[1]!.trim();
    name = name.slice(lead[0].length);
    bracketGroup = true;
  }
  // CRC checksums: [A1B2C3D4]
  name = name.replace(/\s*\[[0-9a-f]{8}\]/gi, "");

  const ctx: ParseContext = { name, out, hits: [], pending: [], episodeConfidence: 0, bracketGroup };
  for (const rule of RULES) rule.apply(ctx);
  resolvePending(ctx);
  groupRule.apply(ctx);

  const titleEnd = Math.min(name.length, ...ctx.hits.filter((h) => h.boundsTitle).map((h) => h.start));
  const title = cleanTitle(name.slice(0, titleEnd));
  if (title) out.title = title;

  out.kind = guessKind(out, ctx.episodeConfidence);
  return out;
}

function guessKind(out: Parsed, episodeConfidence: number): Parsed["kind"] {
  if (out.episodes.length > 0 || out.absolute !== undefined || out.date !== undefined) {
    return { value: "episode", confidence: episodeConfidence };
  }
  if (out.season !== undefined) return { value: "episode", confidence: 0.7 };
  const hasRelease = Boolean(out.release.resolution || out.release.source || out.release.videoCodec);
  if (out.year !== undefined) return { value: "movie", confidence: hasRelease ? 0.85 : 0.6 };
  if (hasRelease && out.title) return { value: "movie", confidence: 0.4 };
  return { value: "unknown", confidence: 0 };
}

const SEASON_DIR = /^(?:season|staffel|series|s)[ ._-]*(\d{1,2})$/i;
const SPECIALS_DIR = /^(?:specials|extras)$/i;
const BARE_EPISODE = /^(?:e|ep|episode|folge)?[ ._-]*(\d{1,3})(?:[ ._-]+-?[ ._-]*(.+))?$/i;

/**
 * Parses a path: the file name plus its folders as context.
 * `Serie/Staffel 2/03.mkv` yields title, season and episode.
 */
export function parse(path: string): Parsed {
  const segments = path.split(/[\\/]+/).filter(Boolean);
  const fileName = segments.pop() ?? "";
  const out = parseName(fileName);

  let dirs = segments;
  // Folder context: the nearest season folder, then the series or release folder above it.
  let seasonFromDir: number | undefined;
  const nearest = dirs.at(-1);
  if (nearest && (SEASON_DIR.test(nearest) || SPECIALS_DIR.test(nearest))) {
    seasonFromDir = SPECIALS_DIR.test(nearest) ? 0 : Number(SEASON_DIR.exec(nearest)![1]);
    dirs = dirs.slice(0, -1);
  }
  const parentName = dirs.at(-1);
  const parent = parentName ? parseName(parentName) : undefined;

  const { stem } = splitExtension(fileName);
  const bare = BARE_EPISODE.exec(stem);
  const inSeries = seasonFromDir !== undefined || parent?.kind.value === "episode";
  if (bare && inSeries && out.episodes.length === 0 && !/^\d{4}$/.test(stem)) {
    out.episodes = [Number(bare[1])];
    out.title = undefined;
    out.year = undefined;
    out.kind = { value: "episode", confidence: 0.8 };
  }

  if (out.season === undefined && out.kind.value === "episode") {
    const season = seasonFromDir ?? parent?.season;
    if (season !== undefined && out.absolute === undefined) out.season = season;
  }

  if (parent) {
    if (!out.title && parent.title) {
      out.title = parent.title;
      if (out.year === undefined && parent.year !== undefined) out.year = parent.year;
      if (out.kind.value === "unknown" && parent.kind.value !== "unknown") out.kind = parent.kind;
    } else if (out.title && parent.title && out.year === undefined && parent.year !== undefined) {
      // Movie folder "Das Boot (1981)/das.boot.mkv": adopt the year when the titles agree.
      if (normalize(parent.title) === normalize(out.title)) out.year = parent.year;
    }
    if (!out.release.group && parent.release.group) out.release.group = parent.release.group;
    for (const lang of parent.release.languages) {
      if (!out.release.languages.includes(lang)) out.release.languages.push(lang);
    }
    out.release.resolution ??= parent.release.resolution;
    out.release.source ??= parent.release.source;
  }
  // IDs from any folder above: "Serie (1993) [tvdbid-72073]/Season 01/…"; the nearest wins.
  const own = out.ids;
  for (const dir of segments) {
    const { ids } = extractIds(dir);
    if (ids) out.ids = { ...out.ids, ...ids };
  }
  if (own) out.ids = { ...out.ids, ...own };
  return out;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
