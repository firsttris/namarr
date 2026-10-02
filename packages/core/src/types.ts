/** A value the parser guessed, with how sure it is (0 to 1). */
export type Guess<T> = { value: T; confidence: number };

export type ReleaseInfo = {
  resolution?: string; // 2160p, 1080p, 720p, 480p
  source?: string; // BluRay, WEB-DL, WEBRip, HDTV, DVD, Remux
  videoCodec?: string; // H.264, H.265, AV1, XviD
  audioCodec?: string; // DTS-HD, TrueHD, DD+, AC3, AAC
  audioChannels?: string; // 5.1, 7.1
  hdr?: string; // HDR, HDR10, DV
  group?: string;
  languages: string[]; // ISO 639-1: de, en, ja
  dubbed?: boolean;
  proper?: boolean;
  repack?: boolean;
};

export type MediaKind = "movie" | "episode" | "unknown";

/** IDs written into folder names by Sonarr, Radarr, Jellyfin & co.: `[tvdbid-72073]`, `{imdb-tt0106145}`. */
export type ExternalIds = Partial<Record<"tmdb" | "tvdb" | "imdb" | "anidb", string>>;

export type Parsed = {
  kind: Guess<MediaKind>;
  title?: string;
  year?: number;
  season?: number;
  episodes: number[]; // Doppelfolgen: S01E01E02
  absolute?: number; // Anime
  date?: string; // Talkshows: 2026-09-28
  edition?: string; // Director's Cut, Extended
  release: ReleaseInfo;
  part?: number; // CD1, Part 2
  sample?: boolean;
  extension?: string; // without dot, lower case
  ids?: ExternalIds;
};

export type MediaCandidate = {
  provider: string;
  id: string;
  kind: "movie" | "series";
  title: string;
  originalTitle?: string;
  /** Further known titles (synonyms, other languages); they count for matching, not for naming. */
  aliases?: string[];
  year?: number;
  poster?: string;
  /** Total episodes, used as a matcher signal for anime and season packs. */
  episodeCount?: number;
  /** Every season is an entry of its own (AniDB): S02E05 is episode 5 of the season-2 entry. */
  seasonsAsEntries?: boolean;
};

export type EpisodeInfo = {
  season: number;
  episode: number;
  absolute?: number;
  title?: string;
  airDate?: string;
};

export type EpisodeOrder = "aired" | "dvd" | "absolute";

export interface MetadataProvider {
  readonly name: string;
  searchMovie(query: string, opts?: { year?: number; language?: string }): Promise<MediaCandidate[]>;
  searchSeries(query: string, opts?: { year?: number; language?: string }): Promise<MediaCandidate[]>;
  episodes(seriesId: string, opts?: { season?: number; language?: string; order?: EpisodeOrder }): Promise<EpisodeInfo[]>;
  details(kind: "movie" | "series", id: string, opts?: { language?: string }): Promise<MediaCandidate>;
  /** Looks a title up by an ID from the folder name; undefined when none of the IDs fits. */
  findById?(kind: "movie" | "series", ids: ExternalIds, opts?: { language?: string }): Promise<MediaCandidate | undefined>;
  /** The source per kind, for providers that route movies and series to different ones. */
  nameFor?(kind: "movie" | "series"): string;
}
