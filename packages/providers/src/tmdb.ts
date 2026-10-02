import type { EpisodeInfo, EpisodeOrder, ExternalIds, MediaCandidate, MetadataProvider } from "@namarr/core";
import { tr } from "@namarr/core/i18n";
import Bottleneck from "bottleneck";
import { MemoryCache, type ProviderCache } from "./cache.ts";
import { ProviderError } from "./http.ts";

export type TmdbOptions = {
  /** v3 API key or v4 read access token. Every user brings their own. */
  apiKey: string;
  language?: string;
  cache?: ProviderCache;
  fetch?: typeof fetch;
  baseUrl?: string;
  /** Requests per second; TMDB allows roughly 50. */
  rateLimit?: number;
  ttlSeconds?: { search: number; details: number };
};

const IMAGE_BASE = "https://image.tmdb.org/t/p/w185";
const yearOf = (date?: string | null) => (date && /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : undefined);

type TmdbMovie = { id: number; title: string; original_title?: string; release_date?: string; poster_path?: string | null };
type TmdbTv = {
  id: number;
  name: string;
  original_name?: string;
  first_air_date?: string;
  poster_path?: string | null;
  number_of_episodes?: number;
  original_language?: string;
  seasons?: { season_number: number; episode_count: number }[];
};

/**
 * A title TMDB fills in when nobody translated the episode: "Episode 5", "Folge 5", "Épisode 5",
 * a bare number, or nothing. Such a title must not end up in a file name.
 */
export function isPlaceholderTitle(title: string | undefined): boolean {
  if (!title?.trim()) return true;
  return (
    /^(episode|folge|épisode|episodio|epizod|aflevering|afl\.?|odcinek|avsnitt|jakso|capítulo|エピソード|第)\s*\d+\s*(話)?$/i.test(
      title.trim(),
    ) || /^\d+$/.test(title.trim())
  );
}
type TmdbEpisode = { season_number: number; episode_number: number; name?: string; air_date?: string | null; order?: number };
type TmdbEpisodeGroup = { id: string; type: number; name: string; episode_count: number };

/** TMDB episode group types: 2 = absolute, 3 = DVD. */
const GROUP_TYPE: Record<Exclude<EpisodeOrder, "aired">, number> = { absolute: 2, dvd: 3 };

export class TmdbProvider implements MetadataProvider {
  readonly name = "tmdb";
  private readonly limiter: Bottleneck;
  private readonly cache: ProviderCache;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly ttl: { search: number; details: number };

  constructor(private readonly options: TmdbOptions) {
    const rate = options.rateLimit ?? 40;
    this.limiter = new Bottleneck({ maxConcurrent: 8, minTime: Math.ceil(1000 / rate) });
    this.cache = options.cache ?? new MemoryCache();
    this.fetchImpl = options.fetch ?? fetch;
    this.baseUrl = options.baseUrl ?? "https://api.themoviedb.org/3";
    this.ttl = options.ttlSeconds ?? { search: 24 * 3600, details: 7 * 24 * 3600 };
  }

  private async get<T>(path: string, params: Record<string, string | number | undefined>, ttl: number): Promise<T> {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(params).sort(([a], [b]) => a.localeCompare(b))) {
      if (v !== undefined && v !== "") query.set(k, String(v));
    }
    const key = `${path}?${query}`;
    const cached = await this.cache.get(this.name, key);
    if (cached !== undefined) return cached as T;

    const bearer = this.options.apiKey.startsWith("eyJ");
    if (!bearer) query.set("api_key", this.options.apiKey);
    const url = `${this.baseUrl}${path}?${query}`;
    const headers: Record<string, string> = { accept: "application/json" };
    if (bearer) headers.authorization = `Bearer ${this.options.apiKey}`;

    const body = await this.limiter.schedule(() => this.request(url, headers));
    await this.cache.set(this.name, key, body, ttl);
    return body as T;
  }

  private async request(url: string, headers: Record<string, string>, attempt = 0): Promise<unknown> {
    const res = await this.fetchImpl(url, { headers });
    if (res.status === 429 && attempt < 3) {
      const wait = Number(res.headers.get("retry-after") ?? 1) * 1000;
      await new Promise((r) => setTimeout(r, Math.min(wait, 10_000)));
      return this.request(url, headers, attempt + 1);
    }
    if (res.status === 401) throw new ProviderError(tr("TMDB: API-Key ungültig", "TMDB: invalid API key"), 401);
    if (!res.ok) throw new ProviderError(`TMDB: HTTP ${res.status}`, res.status);
    return res.json();
  }

  private language(opts?: { language?: string }) {
    return opts?.language ?? this.options.language;
  }

  private movie(m: TmdbMovie): MediaCandidate {
    return {
      provider: this.name,
      id: String(m.id),
      kind: "movie",
      title: m.title,
      originalTitle: m.original_title && m.original_title !== m.title ? m.original_title : undefined,
      year: yearOf(m.release_date),
      poster: m.poster_path ? IMAGE_BASE + m.poster_path : undefined,
    };
  }

  private tv(t: TmdbTv): MediaCandidate {
    return {
      provider: this.name,
      id: String(t.id),
      kind: "series",
      title: t.name,
      originalTitle: t.original_name && t.original_name !== t.name ? t.original_name : undefined,
      year: yearOf(t.first_air_date),
      poster: t.poster_path ? IMAGE_BASE + t.poster_path : undefined,
      episodeCount: t.number_of_episodes,
    };
  }

  async searchMovie(query: string, opts?: { year?: number; language?: string }) {
    const params = { query, year: opts?.year, language: this.language(opts), include_adult: "false" };
    let res = await this.get<{ results: TmdbMovie[] }>("/search/movie", params, this.ttl.search);
    // The parsed year can be off (festival vs. release); retry without it.
    if (!res.results.length && opts?.year) {
      res = await this.get("/search/movie", { ...params, year: undefined }, this.ttl.search);
    }
    return res.results.slice(0, 10).map((m) => this.movie(m));
  }

  async searchSeries(query: string, opts?: { year?: number; language?: string }) {
    const params = { query, first_air_date_year: opts?.year, language: this.language(opts) };
    let res = await this.get<{ results: TmdbTv[] }>("/search/tv", params, this.ttl.search);
    if (!res.results.length && opts?.year) {
      res = await this.get("/search/tv", { ...params, first_air_date_year: undefined }, this.ttl.search);
    }
    return res.results.slice(0, 10).map((t) => this.tv(t));
  }

  async details(kind: "movie" | "series", id: string, opts?: { language?: string }) {
    const language = this.language(opts);
    if (kind === "movie") return this.movie(await this.get<TmdbMovie>(`/movie/${id}`, { language }, this.ttl.details));
    return this.tv(await this.get<TmdbTv>(`/tv/${id}`, { language }, this.ttl.details));
  }

  /** TMDB's own ID, else TVDB or IMDb IDs through `/find`. */
  async findById(kind: "movie" | "series", ids: ExternalIds, opts?: { language?: string }) {
    const orNothing = (e: Error) => {
      if ((e as ProviderError).status === 404) return undefined;
      throw e;
    };
    if (ids.tmdb) {
      const found = await this.details(kind, ids.tmdb, opts).catch(orNothing);
      if (found) return found;
    }
    const language = this.language(opts);
    for (const [source, id] of [
      ["tvdb_id", ids.tvdb],
      ["imdb_id", ids.imdb],
    ] as const) {
      if (!id) continue;
      const res = await this.get<{ movie_results: TmdbMovie[]; tv_results: TmdbTv[] }>(
        `/find/${id}`,
        { external_source: source, language },
        this.ttl.details,
      ).catch(orNothing);
      const hit = kind === "movie" ? res?.movie_results?.[0] : res?.tv_results?.[0];
      if (hit) return kind === "movie" ? this.movie(hit as TmdbMovie) : this.tv(hit as TmdbTv);
    }
    return undefined;
  }

  async episodes(seriesId: string, opts?: { season?: number; language?: string; order?: EpisodeOrder }) {
    const language = this.language(opts);
    const show = await this.get<TmdbTv>(`/tv/${seriesId}`, { language }, this.ttl.details);
    const list = await this.episodesIn(seriesId, show, { ...opts, language });
    // Untranslated titles: take them from the original language, then from English.
    const fallbacks = [show.original_language, "en-US"].filter(
      (l): l is string => Boolean(l) && l!.slice(0, 2) !== (language ?? "").slice(0, 2),
    );
    for (const fallback of [...new Set(fallbacks)]) {
      const missing = list.filter((e) => isPlaceholderTitle(e.title));
      if (!missing.length) break;
      const other = await this.episodesIn(seriesId, show, { ...opts, language: fallback, seasons: new Set(missing.map((e) => e.season)) });
      const byKey = new Map(other.map((e) => [`${e.season}x${e.episode}`, e.title]));
      for (const e of missing) {
        const title = byKey.get(`${e.season}x${e.episode}`);
        if (!isPlaceholderTitle(title)) e.title = title;
      }
    }
    return list;
  }

  /** Episodes in one language; `seasons` limits the fetch (fallback lookups). */
  private async episodesIn(
    seriesId: string,
    show: TmdbTv,
    opts: { season?: number; language?: string; order?: EpisodeOrder; seasons?: Set<number> },
  ): Promise<EpisodeInfo[]> {
    const { language } = opts;
    const order = opts.order ?? "aired";
    if (order !== "aired") {
      const grouped = await this.groupedEpisodes(seriesId, GROUP_TYPE[order], language);
      if (grouped) return opts?.season === undefined ? grouped : grouped.filter((e) => e.season === opts.season);
    }
    const seasons = (show.seasons ?? [])
      .map((s) => s.season_number)
      .filter((n) => (opts.season === undefined || n === opts.season) && (!opts.seasons || opts.seasons.has(n)))
      .sort((a, b) => a - b);
    const lists = await Promise.all(
      seasons.map((n) => this.get<{ episodes: TmdbEpisode[] }>(`/tv/${seriesId}/season/${n}`, { language }, this.ttl.details)),
    );
    const all = lists.flatMap((l) => l.episodes).map((e) => this.episode(e));
    // Absolute numbers count through the regular seasons in aired order.
    let abs = 0;
    for (const e of all.filter((x) => x.season > 0).sort((a, b) => a.season - b.season || a.episode - b.episode)) {
      e.absolute = ++abs;
    }
    return all;
  }

  private episode(e: TmdbEpisode): EpisodeInfo {
    return { season: e.season_number, episode: e.episode_number, title: e.name || undefined, airDate: e.air_date || undefined };
  }

  /** Episode groups (DVD, absolute) remap the numbering: each group is a season. */
  private async groupedEpisodes(seriesId: string, type: number, language?: string): Promise<EpisodeInfo[] | undefined> {
    const groups = await this.get<{ results: TmdbEpisodeGroup[] }>(`/tv/${seriesId}/episode_groups`, {}, this.ttl.details);
    const group = groups.results.filter((g) => g.type === type).sort((a, b) => b.episode_count - a.episode_count)[0];
    if (!group) return undefined;
    const detail = await this.get<{ groups: { order: number; episodes: TmdbEpisode[] }[] }>(
      `/tv/episode_group/${group.id}`,
      { language },
      this.ttl.details,
    );
    const out: EpisodeInfo[] = [];
    let abs = 0;
    for (const g of [...detail.groups].sort((a, b) => a.order - b.order)) {
      for (const e of [...g.episodes].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
        const season = type === GROUP_TYPE.absolute ? 1 : g.order;
        const episode = type === GROUP_TYPE.absolute ? ++abs : (e.order ?? 0) + 1;
        out.push({
          season,
          episode,
          absolute: type === GROUP_TYPE.absolute ? abs : undefined,
          title: e.name || undefined,
          airDate: e.air_date || undefined,
        });
      }
    }
    return out;
  }
}
