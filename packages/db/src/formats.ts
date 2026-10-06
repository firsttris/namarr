// Naming formats: the built-in presets plus the user's own. Pure: safe to import from browser code.
import { PRESETS } from "@namarr/core/formatter";

export const FORMAT_KINDS = ["movie", "series"] as const;
export type FormatKind = (typeof FORMAT_KINDS)[number];

/** A naming format for one kind. Built-in ones carry the preset id (`jellyfin`), own ones `f-…`. */
export type NameFormat = { id: string; name: string; kind: FormatKind; template: string; builtin?: boolean };

/** The presets (Plex, Jellyfin, Emby, Kodi), one format per kind each. Copy one to change it. */
export const BUILTIN_FORMATS: NameFormat[] = Object.values(PRESETS).flatMap((p) => [
  { id: p.id, name: p.label, kind: "movie" as const, template: p.movie, builtin: true },
  { id: p.id, name: p.label, kind: "series" as const, template: p.episode, builtin: true },
]);

const FALLBACK = "jellyfin";

type WithFormats = { formats: NameFormat[]; defaultFormats: { movie?: string; series?: string } };

/** Every format of a kind: built-in first, then the own ones by name. */
export function formatsOf(s: Pick<WithFormats, "formats">, kind: FormatKind): NameFormat[] {
  const own = s.formats.filter((f) => f.kind === kind).sort((a, b) => a.name.localeCompare(b.name));
  return [...BUILTIN_FORMATS.filter((f) => f.kind === kind), ...own];
}

export function findFormat(s: Pick<WithFormats, "formats">, kind: FormatKind, id: string | undefined): NameFormat | undefined {
  return id ? formatsOf(s, kind).find((f) => f.id === id) : undefined;
}

/** The format used unless a job or watch folder picks another: the default, else Jellyfin. */
export function defaultFormat(s: WithFormats, kind: FormatKind): NameFormat {
  return findFormat(s, kind, s.defaultFormats[kind]) ?? findFormat(s, kind, FALLBACK)!;
}

/** The formats a job uses: the first layer that names an existing one, else the default. */
export function resolveFormats(s: WithFormats, ...layers: ({ movie?: string; series?: string } | null | undefined)[]) {
  const pick = (kind: FormatKind) =>
    layers.map((l) => findFormat(s, kind, l?.[kind])).find((f): f is NameFormat => Boolean(f)) ?? defaultFormat(s, kind);
  return { movie: pick("movie"), series: pick("series") };
}

/** A new id for an own format. */
export const newFormatId = () => `f-${Math.random().toString(36).slice(2, 10)}`;
