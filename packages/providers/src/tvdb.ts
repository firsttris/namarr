import type { EpisodeInfo, EpisodeOrder, ExternalIds, MediaCandidate, MetadataProvider } from "@namarr/core";
import { msg } from "@namarr/core/i18n";
import type { ProviderCache } from "./cache.ts";
import { lang3, ProviderError, ProviderHttp, yearOf } from "./http.ts";
import { isPlaceholderTitle } from "./tmdb.ts";

export type TvdbOptions = {
  /** Project API key from thetvdb.com. */
  apiKey: string;
  /** Subscriber PIN, needed with a user-supported key. */
  pin?: string;
  language?: string;
  cache?: ProviderCache;
  fetch?: typeof fetch;
  baseUrl?: string;
  /** Requests per second. TheTVDB names no limit; stay polite. */
  rateLimit?: number;
  ttlSeconds?: { search: number; details: number };
};

type TvdbSearchResult = {
  tvdb_id: string;
  name: string;
  year?: string;
  first_air_time?: string;
  image_url?: string;
  thumbnail?: string;
  translations?: Record<string, string>;
  aliases?: string[];
  type?: string;
};
type TvdbRecord = { id: number; name: string; year?: string; firstAired?: string; image?: string; originalLanguage?: string };
type TvdbEpisode = { seasonNumber: number; number: number; absoluteNumber?: number; name?: string | null; aired?: string | null };
type TvdbEpisodePage = { data: { series?: TvdbRecord; episodes: TvdbEpisode[] }; links?: { next?: string | null } };

/** TheTVDB season types: what namarr calls "aired" is TVDB's "default". */
const SEASON_TYPE: Record<EpisodeOrder, string> = { aired: "default", dvd: "dvd", absolute: "absolute" };

/**
 * TheTVDB v4. Sonarr and Jellyfin count episodes the TVDB way, so a library organised by them
 * keeps its numbering. Needs a project API key, with a user-supported key also the subscriber PIN.
 */
export class TvdbProvider implements MetadataProvider {
  readonly name = "tvdb";
  private readonly http: ProviderHttp;
  private readonly baseUrl: string;
  private readonly ttl: { search: number; details: number };
  private token?: Promise<string>;

  constructor(private readonly options: TvdbOptions) {
    this.http = new ProviderHttp(this.name, {
      cache: options.cache,
      fetch: options.fetch,
      minTime: Math.ceil(1000 / (options.rateLimit ?? 10)),
    });
    this.baseUrl = options.baseUrl ?? "https://api4.thetvdb.com/v4";
    this.ttl = options.ttlSeconds ?? { search: 24 * 3600, details: 7 * 24 * 3600 };
  }

  /** The bearer token lives a month; one login per process is enough. */
  private login(): Promise<string> {
    this.token ??= (async () => {
      const res = await this.http.request(`${this.baseUrl}/login`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(this.options.pin ? { apikey: this.options.apiKey, pin: this.options.pin } : { apikey: this.options.apiKey }),
      });
      if (res.status === 401) throw new ProviderError(msg("providers_tvdb_invalidKey"), 401);
      if (!res.ok) throw new ProviderError(`TheTVDB: HTTP ${res.status}`, res.status);
      const body = (await res.json()) as { data?: { token?: string } };
      if (!body.data?.token) throw new ProviderError(msg("providers_tvdb_noToken"));
      return body.data.token;
    })();
    this.token.catch(() => (this.token = undefined));
    return this.token;
  }

  /** GET with cache; a 404 becomes undefined, an expired token one new login. */
  private async get<T>(path: string, params: Record<string, string | number | undefined>, ttl: number): Promise<T | undefined> {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(params).sort(([a], [b]) => a.localeCompare(b))) {
      if (v !== undefined && v !== "") query.set(k, String(v));
    }
    const qs = query.size ? `?${query}` : "";
    return this.http.cached(`${path}${qs}`, ttl, async () => {
      for (let attempt = 0; ; attempt++) {
        const token = await this.login();
        const res = await this.http.request(`${this.baseUrl}${path}${qs}`, {
          headers: { accept: "application/json", authorization: `Bearer ${token}` },
        });
        if (res.status === 401 && attempt === 0) {
          this.token = undefined;
          continue;
        }
        if (res.status === 404) return undefined as T;
        if (res.status === 401) throw new ProviderError(msg("providers_tvdb_invalidKey"), 401);
        if (!res.ok) throw new ProviderError(`TheTVDB: HTTP ${res.status}`, res.status);
        return (await res.json()) as T;
      }
    });
  }

  private language(opts?: { language?: string }) {
    return lang3(opts?.language ?? this.options.language);
  }

  private candidate(kind: "movie" | "series", r: TvdbSearchResult, lang: string): MediaCandidate {
    const translated = r.translations?.[lang];
    const title = translated || r.name;
    return {
      provider: this.name,
      id: String(r.tvdb_id),
      kind,
      title,
      originalTitle: title !== r.name ? r.name : undefined,
      aliases: r.aliases?.length ? r.aliases : undefined,
      year: r.year ? Number(r.year) : yearOf(r.first_air_time),
      poster: r.thumbnail || r.image_url || undefined,
    };
  }

  private async search(kind: "movie" | "series", query: string, opts?: { year?: number; language?: string }) {
    const lang = this.language(opts);
    const params = { query, type: kind, year: opts?.year, limit: 10 };
    let res = await this.get<{ data: TvdbSearchResult[] }>("/search", params, this.ttl.search);
    // The parsed year can be off (premiere vs. first episode); retry without it.
    if (!res?.data?.length && opts?.year) res = await this.get("/search", { ...params, year: undefined }, this.ttl.search);
    return (res?.data ?? []).slice(0, 10).map((r) => this.candidate(kind, r, lang));
  }

  searchMovie(query: string, opts?: { year?: number; language?: string }) {
    return this.search("movie", query, opts);
  }

  searchSeries(query: string, opts?: { year?: number; language?: string }) {
    return this.search("series", query, opts);
  }

  async details(kind: "movie" | "series", id: string, opts?: { language?: string }): Promise<MediaCandidate> {
    const found = await this.record(kind, id, this.language(opts));
    if (!found) throw new ProviderError(msg("providers_tvdb_idNotFound", { id }), 404);
    return found;
  }

  private async record(kind: "movie" | "series", id: string, lang: string): Promise<MediaCandidate | undefined> {
    const path = kind === "movie" ? `/movies/${id}` : `/series/${id}`;
    const base = await this.get<{ data: TvdbRecord }>(path, {}, this.ttl.details);
    if (!base?.data) return undefined;
    const translation = await this.get<{ data: { name?: string } }>(`${path}/translations/${lang}`, {}, this.ttl.details);
    const r = base.data;
    const title = translation?.data?.name || r.name;
    return {
      provider: this.name,
      id: String(r.id),
      kind,
      title,
      originalTitle: title !== r.name ? r.name : undefined,
      year: r.year ? Number(r.year) : yearOf(r.firstAired),
      poster: r.image || undefined,
    };
  }

  async findById(kind: "movie" | "series", ids: ExternalIds, opts?: { language?: string }) {
    const lang = this.language(opts);
    if (ids.tvdb) {
      const found = await this.record(kind, ids.tvdb, lang);
      if (found) return found;
    }
    for (const remote of [ids.imdb, ids.tmdb]) {
      if (!remote) continue;
      const res = await this.get<{ data: { series?: { id: number }; movie?: { id: number } }[] }>(
        `/search/remoteid/${remote}`,
        {},
        this.ttl.details,
      );
      const hit = res?.data?.map((d) => (kind === "movie" ? d.movie : d.series)).find(Boolean);
      if (hit) return this.record(kind, String(hit.id), lang);
    }
    return undefined;
  }

  async episodes(seriesId: string, opts?: { season?: number; language?: string; order?: EpisodeOrder }): Promise<EpisodeInfo[]> {
    const order = opts?.order ?? "aired";
    const lang = this.language(opts);
    const { episodes, series } = await this.episodesIn(seriesId, order, lang);
    // Untranslated titles: take them from the original language, then from English.
    for (const fallback of [...new Set([series?.originalLanguage, "eng"])]) {
      if (!fallback || fallback === lang) continue;
      const missing = episodes.filter((e) => isPlaceholderTitle(e.title));
      if (!missing.length) break;
      const other = await this.episodesIn(seriesId, order, fallback);
      const byKey = new Map(other.episodes.map((e) => [`${e.season}x${e.episode}`, e.title]));
      for (const e of missing) {
        const title = byKey.get(`${e.season}x${e.episode}`);
        if (!isPlaceholderTitle(title)) e.title = title;
      }
    }
    return opts?.season === undefined ? episodes : episodes.filter((e) => e.season === opts.season);
  }

  /** All pages of one season type in one language; without that translation the original titles. */
  private async episodesIn(seriesId: string, order: EpisodeOrder, lang: string) {
    const type = SEASON_TYPE[order];
    const raw: TvdbEpisode[] = [];
    let series: TvdbRecord | undefined;
    let path = `/series/${seriesId}/episodes/${type}/${lang}`;
    for (let page = 0; page < 50; page++) {
      let res = await this.get<TvdbEpisodePage>(path, { page }, this.ttl.details);
      if (!res && page === 0) {
        path = `/series/${seriesId}/episodes/${type}`;
        res = await this.get<TvdbEpisodePage>(path, { page }, this.ttl.details);
      }
      if (!res) break;
      series ??= res.data.series;
      raw.push(...res.data.episodes);
      if (!res.links?.next) break;
    }
    const episodes = raw.map((e) => this.episode(e, order));
    // Absolute numbers count through the regular seasons when TVDB has none.
    if (order !== "absolute" && episodes.every((e) => e.season === 0 || e.absolute === undefined)) {
      let abs = 0;
      for (const e of episodes.filter((x) => x.season > 0).sort((a, b) => a.season - b.season || a.episode - b.episode)) e.absolute = ++abs;
    }
    return { episodes, series };
  }

  private episode(e: TvdbEpisode, order: EpisodeOrder): EpisodeInfo {
    const absolute = e.absoluteNumber && e.absoluteNumber > 0 ? e.absoluteNumber : undefined;
    // Absolute order: one long season, as with TMDB's absolute episode groups.
    const [season, episode] = order === "absolute" && e.seasonNumber > 0 ? [1, absolute ?? e.number] : [e.seasonNumber, e.number];
    return { season, episode, absolute, title: e.name || undefined, airDate: e.aired || undefined };
  }
}
