import type { EpisodeInfo, ExternalIds, MediaCandidate, MetadataProvider } from "@namarr/core";
import { tr } from "@namarr/core/i18n";

type Entry = MediaCandidate & { episodes?: EpisodeInfo[] };

const series = (id: string, title: string, year: number, seasons: Record<number, string[]>): Entry => {
  let abs = 0;
  const episodes = Object.entries(seasons).flatMap(([s, titles]) =>
    titles.map((t, i) => ({ season: Number(s), episode: i + 1, title: t, absolute: ++abs })),
  );
  return { provider: "tmdb", id, kind: "series", title, year, episodes, episodeCount: episodes.length };
};

/**
 * Small offline catalog: lets the UI, the Playwright tests and a first look work without a
 * TMDB key. Enabled with `NAMARR_DEMO=1`.
 */
const CATALOG: Entry[] = [
  series("95396", "Severance", 2022, {
    1: [
      "Gute Neuigkeiten über die Hölle",
      "Halb-Lokal",
      "In Perpetuity",
      "Der Du-Du",
      "Die Falle der Gänsehaut",
      "Versteckte Spiele",
      "Abwehr",
      "Was ist für das Frühstück",
      "Wir sind wir",
    ],
    2: [
      "Hallo, Frau Cobel",
      "Goodbye, Mrs. Selvig",
      "Wer ist lebendig?",
      "Woe's Hollow",
      "Trojan's Horse",
      "Attila",
      "Chikhai Bardo",
      "Sweet Vitriol",
      "The After Hours",
      "Cold Harbor",
    ],
  }),
  series("2316", "The Office", 2005, { 3: ["Gay Witch Hunt", "The Convention", "The Coup", "Grief Counseling", "Initiation", "Diwali"] }),
  series("2996", "The Office", 2001, { 1: ["Downsize", "Work Experience", "The Quiz", "Training", "New Girl", "Judgement"] }),
  series("209867", "Frieren", 2023, { 1: Array.from({ length: 28 }, (_, i) => `Episode ${i + 1}`) }),
  series("70523", "Dark", 2017, {
    1: ["Geheimnisse", "Lügen", "Vergangenheit und Gegenwart", "Doppelleben", "Wahrheiten", "Sic Mundus Creatus Est"],
  }),
  { provider: "tmdb", id: "387", kind: "movie", title: "Das Boot", year: 1981 },
  { provider: "tmdb", id: "693134", kind: "movie", title: "Dune: Part Two", year: 2024 },
  { provider: "tmdb", id: "438631", kind: "movie", title: "Dune", year: 2021 },
  { provider: "tmdb", id: "603", kind: "movie", title: "The Matrix", year: 1999 },
];

const words = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !["the", "der", "die", "das", "part"].includes(w));

export class DemoProvider implements MetadataProvider {
  readonly name = "tmdb";

  private search(kind: "movie" | "series", query: string) {
    const q = words(query);
    return CATALOG.filter((e) => e.kind === kind && words(e.title).some((w) => q.includes(w))).map(({ episodes: _, ...c }) => c);
  }

  async searchMovie(query: string) {
    return this.search("movie", query);
  }

  async searchSeries(query: string) {
    return this.search("series", query);
  }

  async episodes(seriesId: string, opts?: { season?: number }) {
    const all = CATALOG.find((e) => e.id === seriesId)?.episodes ?? [];
    return opts?.season === undefined ? all : all.filter((e) => e.season === opts.season);
  }

  async findById(kind: "movie" | "series", ids: ExternalIds) {
    const found = CATALOG.find((e) => e.kind === kind && e.id === ids.tmdb);
    return found ? this.details(kind, found.id) : undefined;
  }

  async details(_kind: "movie" | "series", id: string) {
    const found = CATALOG.find((e) => e.id === id);
    if (!found) throw new Error(tr(`Unbekannte ID ${id}`, `Unknown ID ${id}`));
    const { episodes: _, ...c } = found;
    return c;
  }
}
