import type { MetadataProvider } from "@namarr/core";
import { tr } from "@namarr/core/i18n";
import type { SeriesProvider, Settings } from "@namarr/db";
import {
  AnidbProvider,
  DemoProvider,
  type ProviderCache,
  ProviderError,
  RoutedProvider,
  TmdbProvider,
  TvdbProvider,
  TvmazeProvider,
} from "@namarr/providers";

export const MISSING = {
  tmdb: tr("TMDB: API-Key in den Einstellungen hinterlegen", "TMDB: add an API key in the settings"),
  tvdb: tr("TheTVDB: API-Key in den Einstellungen hinterlegen", "TheTVDB: add an API key in the settings"),
  anidb: tr("AniDB: registrierten Client in den Einstellungen hinterlegen", "AniDB: add a registered client in the settings"),
};

/** Stands in for a source without credentials; says what is missing as soon as it is used. */
class Unavailable implements MetadataProvider {
  constructor(
    readonly name: string,
    private readonly message: string,
  ) {}
  private fail(): never {
    throw new ProviderError(this.message);
  }
  searchMovie = async () => this.fail();
  searchSeries = async () => this.fail();
  episodes = async () => this.fail();
  details = async () => this.fail();
}

export type ProviderFactory = (settings: Settings, choice?: { series?: SeriesProvider }) => MetadataProvider | undefined;

/**
 * Builds the provider for a job: series from the job's (or profile's, or settings') source,
 * movies from the movie source. One client per source and credentials, so rate limits and
 * logins hold across jobs. Undefined when neither side is usable.
 */
export function providerFactory(cache: ProviderCache, demo: boolean): ProviderFactory {
  const clients = new Map<string, MetadataProvider>();
  const client = (key: string, make: () => MetadataProvider) => {
    let c = clients.get(key);
    if (!c) {
      c = make();
      clients.set(key, c);
    }
    return c;
  };
  const demoProvider = new DemoProvider();

  const build = (name: SeriesProvider, s: Settings): MetadataProvider => {
    switch (name) {
      case "tmdb":
        if (!s.tmdbApiKey) return demo ? demoProvider : new Unavailable("tmdb", MISSING.tmdb);
        return client(`tmdb|${s.tmdbApiKey}|${s.language}`, () => new TmdbProvider({ apiKey: s.tmdbApiKey!, language: s.language, cache }));
      case "tvdb":
        if (!s.tvdbApiKey) return new Unavailable("tvdb", MISSING.tvdb);
        return client(
          `tvdb|${s.tvdbApiKey}|${s.tvdbPin ?? ""}|${s.language}`,
          () => new TvdbProvider({ apiKey: s.tvdbApiKey!, pin: s.tvdbPin, language: s.language, cache }),
        );
      case "tvmaze":
        return client("tvmaze", () => new TvmazeProvider({ cache }));
      case "anidb":
        if (!s.anidbClient) return new Unavailable("anidb", MISSING.anidb);
        return client(
          `anidb|${s.anidbClient}|${s.anidbClientVersion ?? "1"}|${s.language}`,
          () => new AnidbProvider({ client: s.anidbClient!, clientVersion: s.anidbClientVersion ?? "1", language: s.language, cache }),
        );
    }
  };

  return (s, choice) => {
    const series = build(choice?.series ?? s.seriesProvider ?? "tmdb", s);
    const movies = build(s.movieProvider ?? "tmdb", s);
    if (series instanceof Unavailable && movies instanceof Unavailable) return undefined;
    return series === movies ? series : new RoutedProvider(movies, series);
  };
}
