import { msg } from "../i18n.ts";
import type { EpisodeInfo, EpisodeOrder, MediaCandidate, MetadataProvider, Parsed } from "../types.ts";
import { normalizeTitle, titleSimilarity } from "./similarity.ts";

export * from "./similarity.ts";

export const NO_MATCH = msg("matcher_reason_noMatch");
export const DOUBLE_EPISODE = msg("matcher_reason_doubleEpisode");
export const ID_FROM_FOLDER = msg("matcher_reason_idFromFolder");

export const AUTO_THRESHOLD = 0.9;
export const SUGGEST_THRESHOLD = 0.6;

export type MatchDecision = "auto" | "suggest" | "manual";

/** Ab 0,9 automatisch, 0,6 bis 0,9 Vorschlag, darunter manuelle Auswahl. */
export function classify(confidence: number, auto = AUTO_THRESHOLD, suggest = SUGGEST_THRESHOLD): MatchDecision {
  if (confidence >= auto) return "auto";
  if (confidence >= suggest) return "suggest";
  return "manual";
}

export type ScoredCandidate = { candidate: MediaCandidate; score: number };

export type MatchResult = {
  best?: MediaCandidate;
  episodes: EpisodeInfo[];
  alternatives: ScoredCandidate[];
  confidence: number;
  reasons: string[];
  overridden?: boolean;
};

/** A learned manual decision: "this release group / title is always this series". */
export type MatchOverride = {
  pattern: string;
  provider: string;
  externalId: string;
  seasonOffset?: number;
};

export type MatchInput = { key: string; parsed: Parsed };

export type MatchOptions = {
  language?: string;
  order?: EpisodeOrder;
  overrides?: MatchOverride[];
  /** Called after each group, for progress reporting. */
  onProgress?: (done: number, total: number) => void;
};

/** "2nd Season", "Season 2", "Staffel 2", "II", a trailing "2": which season a title names. */
export function seasonOfTitle(title: string): number | undefined {
  const t = title.toLowerCase().trim();
  const m = /\b(\d+)(?:st|nd|rd|th) season\b/.exec(t) ?? /\b(?:season|staffel|part|cour)\s*(\d+)\b/.exec(t) ?? /[\s:]+(\d)$/.exec(t);
  if (m) return Number(m[1]);
  const roman = /\s(ii|iii|iv|v)$/.exec(t);
  return roman ? { ii: 2, iii: 3, iv: 4, v: 5 }[roman[1] as "ii"] : undefined;
}

/** Score from title similarity and year. Year off by one is common (festival vs. release). */
export function scoreCandidate(parsed: Parsed, candidate: MediaCandidate): number {
  if (!parsed.title) return 0;
  const titles = [candidate.title, candidate.originalTitle, ...(candidate.aliases ?? [])].filter((t): t is string => Boolean(t));
  const sim = Math.max(...titles.map((t) => titleSimilarity(parsed.title!, t)));
  let score: number;
  if (parsed.year !== undefined && candidate.year !== undefined) {
    const diff = Math.abs(parsed.year - candidate.year);
    score = 0.75 * sim + 0.25 * (diff === 0 ? 1 : diff === 1 ? 0.6 : 0);
  } else if (parsed.year !== undefined) {
    score = sim * 0.9;
  } else {
    score = sim * 0.95;
  }
  const episode = parsed.absolute ?? parsed.episodes.at(-1);
  if (episode !== undefined && candidate.episodeCount !== undefined && episode > candidate.episodeCount) {
    score *= 0.8;
  }
  // One entry per season (AniDB): S02 files belong to the entry whose title names season 2.
  if (candidate.seasonsAsEntries && parsed.season !== undefined && parsed.season > 0) {
    const named = Math.max(1, ...titles.map((t) => seasonOfTitle(t) ?? 1));
    if (named !== parsed.season) score *= 0.85;
  }
  return score;
}

/** Ranks candidates and derives a confidence that drops when the top two are close. */
export function rank(parsed: Parsed, candidates: MediaCandidate[]): { ranked: ScoredCandidate[]; confidence: number; reasons: string[] } {
  const ranked = candidates.map((candidate) => ({ candidate, score: scoreCandidate(parsed, candidate) })).sort((a, b) => b.score - a.score);
  const reasons: string[] = [];
  const [first, second] = ranked;
  if (!first || first.score < 0.5) return { ranked, confidence: 0, reasons: [NO_MATCH] };
  let confidence = first.score;
  if (second) {
    const gap = first.score - second.score;
    if (gap < 0.05) {
      confidence *= 0.75 + 5 * gap;
      reasons.push(
        normalizeTitle(first.candidate.title) === normalizeTitle(second.candidate.title)
          ? msg("matcher_reason_sameTitle")
          : msg("matcher_reason_closeScores"),
      );
    }
  }
  if (parsed.year === undefined && parsed.kind.value === "movie") reasons.push(msg("matcher_reason_noYear"));
  return { ranked, confidence: Math.min(1, confidence), reasons };
}

/** How sure the parser is about a file's structure weighs into its match confidence. */
export function withParserConfidence(confidence: number, parsed: Parsed): number {
  return confidence * (0.4 + 0.6 * Math.max(parsed.kind.confidence, 0.5));
}

type Group = { kind: "movie" | "series"; title: string; year?: number; season?: number; items: MatchInput[] };

/** Files of the same series (or the same movie) share one lookup. */
export function groupInputs(inputs: MatchInput[]): Group[] {
  const groups = new Map<string, Group>();
  for (const input of inputs) {
    const { parsed } = input;
    if (!parsed.title || parsed.kind.value === "unknown") continue;
    const kind = parsed.kind.value === "episode" ? "series" : "movie";
    const key = `${kind}|${normalizeTitle(parsed.title)}|${kind === "movie" ? (parsed.year ?? "") : ""}`;
    let group = groups.get(key);
    if (!group) {
      group = { kind, title: parsed.title, year: parsed.year, items: [] };
      groups.set(key, group);
    }
    group.year ??= parsed.year;
    group.items.push(input);
  }
  return [...groups.values()];
}

function findOverride(parsed: Parsed, overrides: MatchOverride[] | undefined, provider: string) {
  if (!overrides?.length || !parsed.title) return undefined;
  const title = normalizeTitle(parsed.title);
  const group = parsed.release.group?.toLowerCase();
  return overrides.find((o) => {
    if (o.provider !== provider) return false;
    const pattern = o.pattern.toLowerCase();
    if (pattern.startsWith("group:")) return group === pattern.slice(6).trim();
    return normalizeTitle(o.pattern) === title;
  });
}

/** AniDB and co.: the entry is the season, so S02E05 is episode 5 of whatever entry was chosen. */
export function entryParsed(candidate: MediaCandidate, parsed: Parsed): Parsed {
  const season = parsed.season;
  return candidate.seasonsAsEntries && season !== undefined && season > 1 ? { ...parsed, season: 1 } : parsed;
}

/** Maps the parsed numbering onto the provider's episode list. */
export function resolveEpisodes(parsed: Parsed, all: EpisodeInfo[], seasonOffset = 0): EpisodeInfo[] {
  if (parsed.date) return all.filter((e) => e.airDate === parsed.date);
  if (parsed.absolute !== undefined && parsed.season === undefined) {
    const byAbsolute = all.find((e) => e.absolute === parsed.absolute);
    if (byAbsolute) return [byAbsolute];
    // Without absolute numbers from the provider: count through the regular seasons.
    const regular = all.filter((e) => e.season > 0).sort((a, b) => a.season - b.season || a.episode - b.episode);
    const nth = regular[parsed.absolute - 1];
    return nth ? [nth] : [];
  }
  const season = (parsed.season ?? 1) + seasonOffset;
  return parsed.episodes
    .map((n) => all.find((e) => e.season === season && e.episode === n))
    .filter((e): e is EpisodeInfo => e !== undefined);
}

/**
 * Matches parsed files against a provider. Series are looked up once per group and their
 * episode lists once per series.
 */
export async function matchAll(
  inputs: MatchInput[],
  provider: MetadataProvider,
  options: MatchOptions = {},
): Promise<Map<string, MatchResult>> {
  const results = new Map<string, MatchResult>();
  for (const input of inputs) {
    results.set(input.key, { episodes: [], alternatives: [], confidence: 0, reasons: [msg("matcher_reason_noTitle")] });
  }
  const groups = groupInputs(inputs);
  const episodeCache = new Map<string, Promise<EpisodeInfo[]>>();
  const loadEpisodes = (id: string) => {
    let promise = episodeCache.get(id);
    if (!promise) {
      promise = provider.episodes(id, { language: options.language, order: options.order });
      episodeCache.set(id, promise);
    }
    return promise;
  };

  let done = 0;
  for (const group of groups) {
    const first = group.items[0]!.parsed;
    const override = findOverride(first, options.overrides, provider.nameFor?.(group.kind) ?? provider.name);
    const ids = group.items.find((i) => i.parsed.ids)?.parsed.ids;
    const byId =
      !override && ids && provider.findById ? await provider.findById(group.kind, ids, { language: options.language }) : undefined;
    let best: MediaCandidate | undefined;
    let alternatives: ScoredCandidate[] = [];
    let confidence = 0;
    let reasons: string[] = [];
    if (override) {
      best = await provider.details(group.kind, override.externalId, { language: options.language });
      confidence = 1;
      reasons = [msg("matcher_reason_savedDecision")];
    } else if (byId) {
      best = byId;
      confidence = 1;
      reasons = [ID_FROM_FOLDER];
    } else {
      const search = group.kind === "series" ? provider.searchSeries : provider.searchMovie;
      const candidates = await search.call(provider, group.title, { year: group.year, language: options.language });
      const ranked = rank({ ...first, year: group.year ?? first.year }, candidates);
      best = ranked.confidence > 0 ? ranked.ranked[0]?.candidate : undefined;
      alternatives = ranked.ranked.slice(best ? 1 : 0, 6);
      confidence = ranked.confidence;
      reasons = ranked.reasons;
    }

    const episodes = best && group.kind === "series" ? await loadEpisodes(best.id) : [];
    for (const item of group.items) {
      const result: MatchResult = {
        best,
        episodes: [],
        alternatives,
        confidence: override || byId ? confidence : withParserConfidence(confidence, item.parsed),
        reasons: [...reasons],
        overridden: Boolean(override),
      };
      if (best && group.kind === "series") {
        const parsed = entryParsed(best, item.parsed);
        result.episodes = resolveEpisodes(parsed, episodes, override?.seasonOffset);
        if (parsed !== item.parsed) {
          result.reasons.push(msg("matcher_reason_seasonAsEntry", { season: item.parsed.season ?? "" }));
          if (!override && !byId) result.confidence = Math.min(result.confidence, 0.7);
        }
        const wanted = item.parsed.date ? 1 : Math.max(1, item.parsed.episodes.length);
        if (result.episodes.length < wanted) {
          result.confidence *= item.parsed.episodes.length === 0 && !item.parsed.date ? 0.5 : 0.7;
          result.reasons.push(item.parsed.episodes.length === 0 ? msg("matcher_reason_noEpisode") : msg("matcher_reason_episodeNotFound"));
        }
        // With one entry per season (AniDB) the absolute number is exact, nothing is estimated.
        if (item.parsed.absolute !== undefined && item.parsed.season === undefined && !best.seasonsAsEntries) {
          result.reasons.push(msg("matcher_reason_absoluteNumber"));
          result.confidence = Math.min(result.confidence, 0.85);
        }
        if (item.parsed.episodes.length > 1) result.reasons.push(DOUBLE_EPISODE);
      }
      results.set(item.key, result);
    }
    options.onProgress?.(++done, groups.length);
  }
  return results;
}

/**
 * IDs in other databases (`{imdb}`, `{tvdb}`) come only with the details of a title, not with search
 * results: looked up once per title for the matches that lack them. Sets `best.ids` in place (an
 * empty object when the source has none, so it is not asked again) and returns the changed matches.
 */
export async function loadIds(
  matches: MatchResult[],
  provider: MetadataProvider,
  options: { language?: string } = {},
): Promise<MatchResult[]> {
  const todo = matches.filter((m) => m.best && !m.best.ids);
  const lookups = new Map<string, Promise<MediaCandidate["ids"]>>();
  for (const m of todo) {
    const best = m.best!;
    const key = `${best.kind}:${best.id}`;
    if (!lookups.has(key)) {
      lookups.set(
        key,
        provider.details(best.kind, best.id, options).then(
          (d) => d.ids ?? {},
          () => ({}),
        ),
      );
    }
  }
  for (const m of todo) m.best!.ids = await lookups.get(`${m.best!.kind}:${m.best!.id}`)!;
  return todo;
}
