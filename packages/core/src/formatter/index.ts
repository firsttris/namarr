import { splitExtension } from "../parser/index.ts";
import type { EpisodeInfo, MediaCandidate, Parsed } from "../types.ts";
import { type SanitizeOptions, sanitizePath } from "./sanitize.ts";
import { render, type Values } from "./template.ts";

export * from "./sanitize.ts";
export * from "./template.ts";

export type Preset = { id: string; label: string; movie: string; episode: string };

export const PRESETS: Record<string, Preset> = {
  plex: {
    id: "plex",
    label: "Plex",
    movie: "{n} ({y})/{n} ({y}){?edition} \\{edition-{edition}\\}{/}{?part} - pt{part}{/}",
    episode: "{n} ({y})/Season {s00}/{n} ({y}) - {s00e00}{?t} - {t}{/}",
  },
  jellyfin: {
    id: "jellyfin",
    label: "Jellyfin",
    movie: "{n} ({y})/{n} ({y}){?edition} [{edition}]{/}{?part} - part{part}{/}",
    episode: "{n} ({y})/Season {s00}/{n} ({y}) - {s00e00}{?t} - {t}{/}",
  },
  emby: {
    id: "emby",
    label: "Emby",
    movie: "{n} ({y})/{n} ({y}){?edition} - {edition}{/}{?part} - part{part}{/}",
    episode: "{n} ({y})/Season {s00}/{n} ({y}) - {s00e00}{?t} - {t}{/}",
  },
  kodi: {
    id: "kodi",
    label: "Kodi",
    movie: "{n} ({y})/{n} ({y}){?part} - cd{part}{/}",
    episode: "{n}/Season {s}/{n} - {sxe}{?t} - {t}{/}",
  },
};

export type FormatInput = {
  parsed: Parsed;
  match?: MediaCandidate;
  episodes?: EpisodeInfo[];
  /** Original file name, for `{orig}` and the extension. */
  original: string;
};

const pad = (n: number | undefined, width = 2) => (n === undefined ? undefined : String(n).padStart(width, "0"));

/** The token values for one file. Provider data wins over the parsed name. */
export function buildValues({ parsed, match, episodes = [], original }: FormatInput): Values {
  const first = episodes[0];
  const season = first?.season ?? parsed.season;
  const numbers = episodes.length ? episodes.map((e) => e.episode) : parsed.episodes;
  const firstEp = numbers[0];
  const lastEp = numbers.at(-1);
  const multi = numbers.length > 1;
  const s00 = pad(season);
  const e00 = pad(firstEp);

  let s00e00: string | undefined;
  let sxe: string | undefined;
  if (s00 !== undefined && e00 !== undefined) {
    s00e00 = `S${s00}E${e00}${multi ? `-E${pad(lastEp)}` : ""}`;
    sxe = `${season}x${e00}${multi ? `-${pad(lastEp)}` : ""}`;
  }
  const titles = episodes.map((e) => e.title).filter((t): t is string => Boolean(t));
  const { stem, suffix } = splitExtension(original);
  const absolute = first?.absolute ?? parsed.absolute;

  return {
    n: match?.title ?? parsed.title,
    y: match?.year ?? parsed.year,
    s: season,
    e: firstEp,
    s00,
    e00,
    s00e00,
    sxe,
    t: [...new Set(titles)].join(" & ") || undefined,
    absolute,
    abs: pad(absolute, 2),
    d: first?.airDate ?? parsed.date,
    vf: parsed.release.resolution,
    vc: parsed.release.videoCodec,
    ac: parsed.release.audioCodec,
    af: parsed.release.audioChannels,
    hdr: parsed.release.hdr,
    source: parsed.release.source,
    group: parsed.release.group,
    lang: parsed.release.languages.join(", ") || undefined,
    edition: parsed.edition,
    ext: suffix.replace(/^\./, "") || undefined,
    part: parsed.part,
    id: match?.id,
    provider: match?.provider,
    imdb: match?.ids?.imdb ?? parsed.ids?.imdb,
    tmdb: match?.provider === "tmdb" ? match.id : (match?.ids?.tmdb ?? parsed.ids?.tmdb),
    tvdb: match?.provider === "tvdb" ? match.id : (match?.ids?.tvdb ?? parsed.ids?.tvdb),
    rating: match?.rating ? match.rating.toFixed(1) : undefined,
    orig: stem,
    kind: parsed.kind.value,
  };
}

export type FormatOptions = SanitizeOptions;

/** Whether a template names IDs of other databases, which only the details of a title carry. */
export const usesIds = (template: string) => /\{[?!]?(imdb|tmdb|tvdb)\b/.test(template);

/**
 * Renders the template for one file and appends its full extension suffix
 * (`.mkv`, `.de.forced.srt`). Returns a sanitized relative path.
 */
export function formatPath(template: string, input: FormatInput, options: FormatOptions = {}): string {
  const rendered = render(template, buildValues(input));
  const { suffix } = splitExtension(input.original);
  return sanitizePath(rendered + suffix, options);
}

export function presetTemplate(presetId: string, kind: Parsed["kind"]["value"]): string {
  const preset = PRESETS[presetId] ?? PRESETS.jellyfin!;
  return kind === "episode" ? preset.episode : preset.movie;
}
