import type { EpisodeOrder, ExternalIds, MetadataProvider } from "@namarr/core";

/** Movies from one source, series from another: TMDB for films, TheTVDB or AniDB for shows. */
export class RoutedProvider implements MetadataProvider {
  readonly name: string;

  constructor(
    private readonly movies: MetadataProvider,
    private readonly series: MetadataProvider,
  ) {
    this.name = movies.name === series.name ? series.name : `${movies.name}+${series.name}`;
  }

  private for(kind: "movie" | "series") {
    return kind === "movie" ? this.movies : this.series;
  }

  nameFor(kind: "movie" | "series") {
    return this.for(kind).nameFor?.(kind) ?? this.for(kind).name;
  }

  searchMovie(query: string, opts?: { year?: number; language?: string }) {
    return this.movies.searchMovie(query, opts);
  }

  searchSeries(query: string, opts?: { year?: number; language?: string }) {
    return this.series.searchSeries(query, opts);
  }

  episodes(seriesId: string, opts?: { season?: number; language?: string; order?: EpisodeOrder }) {
    return this.series.episodes(seriesId, opts);
  }

  details(kind: "movie" | "series", id: string, opts?: { language?: string }) {
    return this.for(kind).details(kind, id, opts);
  }

  async findById(kind: "movie" | "series", ids: ExternalIds, opts?: { language?: string }) {
    return this.for(kind).findById?.(kind, ids, opts);
  }
}
