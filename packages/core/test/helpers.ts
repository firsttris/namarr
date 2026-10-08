import type { EpisodeInfo, MediaCandidate, MetadataProvider } from "../src/types.ts";

/** In-memory provider with call counters, for matcher and pipeline tests. */
export class FakeProvider implements MetadataProvider {
  readonly name = "tmdb";
  calls = { searchMovie: 0, searchSeries: 0, episodes: 0, details: 0 };

  constructor(
    private readonly data: {
      movies?: MediaCandidate[];
      series?: MediaCandidate[];
      episodes?: Record<string, EpisodeInfo[]>;
    },
  ) {}

  private search(list: MediaCandidate[] = [], query: string) {
    const words = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);
    return list.filter((c) => words.some((w) => c.title.toLowerCase().includes(w)));
  }

  async searchMovie(query: string) {
    this.calls.searchMovie++;
    return this.search(this.data.movies, query);
  }

  async searchSeries(query: string) {
    this.calls.searchSeries++;
    return this.search(this.data.series, query);
  }

  async episodes(seriesId: string, _opts?: { season?: number }) {
    this.calls.episodes++;
    return this.data.episodes?.[seriesId] ?? [];
  }

  async details(kind: "movie" | "series", id: string) {
    this.calls.details++;
    const list = kind === "movie" ? this.data.movies : this.data.series;
    const found = list?.find((c) => c.id === id);
    if (!found) throw new Error(`not found: ${id}`);
    return found;
  }
}

export const severance: MediaCandidate = { provider: "tmdb", id: "95396", kind: "series", title: "Severance", year: 2022 };

export const severanceEpisodes: EpisodeInfo[] = [
  { season: 1, episode: 1, title: "Gute Neuigkeiten über die Hölle", absolute: 1 },
  { season: 2, episode: 1, title: "Hallo, Frau Cobel", absolute: 10 },
  { season: 2, episode: 2, title: "Goodbye, Mrs. Selvig", absolute: 11 },
  { season: 2, episode: 3, title: "Wer ist lebendig?", absolute: 12 },
  { season: 2, episode: 4, title: "Woe's Hollow", absolute: 13 },
  { season: 2, episode: 5, title: "Trojan's Horse", absolute: 14 },
  { season: 2, episode: 6, title: "Attila", absolute: 15 },
];
