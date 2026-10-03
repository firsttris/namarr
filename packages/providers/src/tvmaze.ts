import type { EpisodeInfo, ExternalIds, MediaCandidate, MetadataProvider } from "@namarr/core";
import { msg } from "@namarr/core/i18n";
import type { ProviderCache } from "./cache.ts";
import { ProviderError, ProviderHttp, yearOf } from "./http.ts";

export type TvmazeOptions = {
  cache?: ProviderCache;
  fetch?: typeof fetch;
  baseUrl?: string;
  ttlSeconds?: { search: number; details: number };
};

type TvmazeShow = {
  id: number;
  name: string;
  premiered?: string | null;
  image?: { medium?: string; original?: string } | null;
  externals?: { thetvdb?: number | null; imdb?: string | null };
};
type TvmazeEpisode = { season: number; number: number | null; name?: string | null; airdate?: string | null; type?: string };

/**
 * TVmaze: free, no key. Series only, titles mostly in English (or the original language).
 * A fallback for everyone without a TMDB or TVDB key; also knows TVDB and IMDb IDs.
 */
export class TvmazeProvider implements MetadataProvider {
  readonly name = "tvmaze";
  private readonly http: ProviderHttp;
  private readonly baseUrl: string;
  private readonly ttl: { search: number; details: number };

  constructor(options: TvmazeOptions = {}) {
    // TVmaze allows 20 calls per 10 seconds per IP.
    this.http = new ProviderHttp(this.name, { cache: options.cache, fetch: options.fetch, minTime: 500, maxConcurrent: 2 });
    this.baseUrl = options.baseUrl ?? "https://api.tvmaze.com";
    this.ttl = options.ttlSeconds ?? { search: 24 * 3600, details: 7 * 24 * 3600 };
  }

  private async get<T>(path: string, ttl: number): Promise<T | undefined> {
    return this.http.cached(path, ttl, async () => {
      const res = await this.http.request(`${this.baseUrl}${path}`, { headers: { accept: "application/json" } });
      if (res.status === 404) return undefined as T;
      if (!res.ok) throw new ProviderError(`TVmaze: HTTP ${res.status}`, res.status);
      return (await res.json()) as T;
    });
  }

  private show(s: TvmazeShow): MediaCandidate {
    return {
      provider: this.name,
      id: String(s.id),
      kind: "series",
      title: s.name,
      year: yearOf(s.premiered),
      poster: s.image?.medium ?? undefined,
    };
  }

  async searchMovie(): Promise<MediaCandidate[]> {
    return [];
  }

  async searchSeries(query: string) {
    const res = await this.get<{ show: TvmazeShow }[]>(`/search/shows?q=${encodeURIComponent(query)}`, this.ttl.search);
    return (res ?? []).slice(0, 10).map((r) => this.show(r.show));
  }

  async details(kind: "movie" | "series", id: string) {
    if (kind === "movie") throw new ProviderError(msg("providers_tvmaze_noMovies"));
    const show = await this.get<TvmazeShow>(`/shows/${id}`, this.ttl.details);
    if (!show) throw new ProviderError(msg("providers_tvmaze_idNotFound", { id }), 404);
    return this.show(show);
  }

  async findById(kind: "movie" | "series", ids: ExternalIds) {
    if (kind === "movie") return undefined;
    const lookups = [ids.tvdb && `thetvdb=${ids.tvdb}`, ids.imdb && `imdb=${ids.imdb}`].filter(Boolean);
    for (const q of lookups) {
      const show = await this.get<TvmazeShow>(`/lookup/shows?${q}`, this.ttl.details);
      if (show) return this.show(show);
    }
    return undefined;
  }

  async episodes(seriesId: string, opts?: { season?: number }): Promise<EpisodeInfo[]> {
    const raw = (await this.get<TvmazeEpisode[]>(`/shows/${seriesId}/episodes?specials=1`, this.ttl.details)) ?? [];
    const out: EpisodeInfo[] = [];
    let special = 0;
    for (const e of raw) {
      // Specials carry no number; like everywhere else they become season 0.
      const isSpecial = e.number === null || e.type?.includes("special");
      const info: EpisodeInfo = {
        season: isSpecial ? 0 : e.season,
        episode: isSpecial ? ++special : e.number!,
        title: e.name || undefined,
        airDate: e.airdate || undefined,
      };
      out.push(info);
    }
    let abs = 0;
    for (const e of out.filter((x) => x.season > 0).sort((a, b) => a.season - b.season || a.episode - b.episode)) e.absolute = ++abs;
    return opts?.season === undefined ? out : out.filter((e) => e.season === opts.season);
  }
}
