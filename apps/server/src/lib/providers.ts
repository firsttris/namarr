import type { MovieProvider, SeriesProvider } from "@namarr/db/types";

/** Browser-safe copies of the source lists in @namarr/db (that package pulls in bun:sqlite). */
export const SERIES_SOURCES: SeriesProvider[] = ["tmdb", "tvdb", "tvmaze", "anidb"];
export const MOVIE_SOURCES: MovieProvider[] = ["tmdb", "tvdb"];
