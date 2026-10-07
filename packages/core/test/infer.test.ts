import { describe, expect, it } from "vitest";
import { deriveTemplate, type InferSample, inferFormat } from "../src/formatter/infer.ts";
import { parse } from "../src/parser/index.ts";
import type { MediaCandidate } from "../src/types.ts";
import { severance, severanceEpisodes } from "./helpers.ts";

/** A library file as namarr sees it after matching: parsed from its path, with the episode. */
function episode(path: string, season: number, ep: number): InferSample {
  const info = severanceEpisodes.find((e) => e.season === season && e.episode === ep)!;
  return { path, input: { parsed: parse(path), match: severance, episodes: [info], original: path.split("/").at(-1)! } };
}

const matrix: MediaCandidate = { provider: "tmdb", id: "603", kind: "movie", title: "The Matrix", year: 1999 };
function movie(path: string, match: MediaCandidate = matrix): InferSample {
  return { path, input: { parsed: parse(path), match, original: path.split("/").at(-1)! } };
}

describe("Format aus einer Mediathek erkennen", () => {
  it("erkennt die eingebauten Formate", () => {
    const jellyfin = inferFormat(
      [
        episode("Severance (2022)/Season 02/Severance (2022) - S02E01 - Hallo, Frau Cobel.mkv", 2, 1),
        episode("Severance (2022)/Season 02/Severance (2022) - S02E05 - Trojan's Horse.mkv", 2, 5),
      ],
      "episode",
    )!;
    expect(jellyfin).toMatchObject({ matched: 2, presets: ["plex", "jellyfin", "emby"] });

    const kodi = inferFormat([episode("Severance/Season 2/Severance - 2x03 - Wer ist lebendig.mkv", 2, 3)], "episode")!;
    expect(kodi).toMatchObject({ matched: 1, presets: ["kodi"] });
  });

  it("leitet ein eigenes Format ab, wenn keins passt", () => {
    const result = inferFormat(
      [
        episode("Severance/Staffel 02/Severance - S02E01 - Hallo, Frau Cobel.mkv", 2, 1),
        episode("Severance/Staffel 02/Severance - S02E06 - Attila.mkv", 2, 6),
      ],
      "episode",
    )!;
    expect(result).toMatchObject({ template: "{n}/Staffel {s00}/{n} - {s00e00}{?t} - {t}{/}", presets: [], matched: 2 });
  });

  it("Schreibweisen: klein mit Punkten, IDs in geschweiften Klammern", () => {
    expect(deriveTemplate(movie("The Matrix (1999)/the.matrix.1999.mkv"), "movie")).toBe("{n} ({y})/{n|lower|space:'.'}.{y}");
    const withId = movie("The Matrix (1999) {tmdb-603}/The Matrix (1999).mkv");
    const result = inferFormat([withId], "movie")!;
    expect(result.template).toBe("{n} ({y}) \\{tmdb-{tmdb}\\}/{n} ({y})");
    expect(result.matched).toBe(1);
  });

  it("eine Zahl wird nicht aus einer längeren gerissen", () => {
    // Season 2 must not take the 2 out of 2022.
    expect(deriveTemplate(episode("Severance 2022/S2/Severance 2022 2x01.mkv", 2, 1), "episode")).toBe("{n} {y}/S{s}/{n} {y} {sxe}");
  });

  it("Edition nur, wo es eine gibt", () => {
    const cut = movie("Das Boot (1981)/Das Boot (1981) [Director's Cut].mkv", {
      provider: "tmdb",
      id: "387",
      kind: "movie",
      title: "Das Boot",
      year: 1981,
    });
    expect(cut.input.parsed.edition).toBe("Director's Cut");
    const result = inferFormat([cut, movie("The Matrix (1999)/The Matrix (1999).mkv")], "movie")!;
    expect(result).toMatchObject({ matched: 2, presets: ["jellyfin"] });
    // Without an edition, every built-in movie format fits.
    expect(inferFormat([movie("The Matrix (1999)/The Matrix (1999).mkv")], "movie")!.presets).toEqual(["plex", "jellyfin", "emby", "kodi"]);
  });

  it("sagt, welche Dateien nicht passen", () => {
    const result = inferFormat(
      [
        episode("Severance (2022)/Season 02/Severance (2022) - S02E01 - Hallo, Frau Cobel.mkv", 2, 1),
        episode("Severance (2022)/Season 02/Severance (2022) - S02E02 - Goodbye, Mrs. Selvig.mkv", 2, 2),
        episode("Severance (2022)/Extras/making of.mkv", 2, 3),
      ],
      "episode",
    )!;
    expect(result.matched).toBe(2);
    expect(result.checks.filter((c) => !c.ok).map((c) => c.path)).toEqual(["Severance (2022)/Extras/making of.mkv"]);
  });

  it("IMDb-ID, Bewertung und Codec-Schreibweisen (Jahres-Ordner wie bei Radarr-Nutzern)", () => {
    const film = (title: string, year: number, imdb: string, rating: number | undefined, rest: string) => {
      const name = `${title} (${year}) [imdbid-${imdb}]${rating ? ` ${rating.toFixed(1)}` : ""}`;
      return movie(`${year}/${name}/${name} - ${rest}`, { provider: "tmdb", id: "1", kind: "movie", title, year, rating, ids: { imdb } });
    };
    const samples = [
      film("Minions & Monster", 2026, "tt32890033", undefined, "[2160p, EAC3].mkv"),
      film("Scarface - Narbengesicht", 1932, "tt0023427", 7.5, "[480p, AC3].mkv"),
      film("1984", 1956, "tt0048918", 6.6, "[480p, AC3].mp4"),
      film("Krieg der Sterne", 1977, "tt0076759", 8.2, "[1080p, AC3].mkv"),
    ];
    expect(samples[0]!.input.parsed.release.audioCodec).toBe("DD+");
    const result = inferFormat(samples, "movie")!;
    expect(result.template).toBe(
      "{y}/{n} ({y}) [imdbid-{imdb}]{?rating} {rating}{/}/{n} ({y}) [imdbid-{imdb}]{?rating} {rating}{/} - [{vf}, {ac|replace:'DD+':'EAC3'}]",
    );
    expect(result.matched).toBe(4);
  });

  it("Serien mit TVDB-ID im Ordner (Sonarr), MP3 und EAC3 gemischt", () => {
    const show = (title: string, year: number, tvdb: string, ep: string, epTitle: string, rest: string) => {
      const p = `${title} (${year}) [tvdbid-${tvdb}]/Season 1/${title} ${ep} ${epTitle} - ${rest}`;
      const parsed = parse(p);
      return {
        path: p,
        input: {
          parsed,
          match: { provider: "tvdb", id: tvdb, kind: "series" as const, title, year },
          episodes: [{ season: 1, episode: 1, title: epTitle }],
          original: p.split("/").at(-1)!,
        },
      };
    };
    const result = inferFormat(
      [
        show("Better Call Saul", 2015, "273181", "S01E01", "Anfänge", "[480p, AAC].mkv"),
        show("Castle", 2009, "83462", "S01E01", "Blumen für Dein Grab", "[360p, MP3].avi"),
        show("A Knight of the Seven Kingdoms", 2026, "433631", "S01E01", "Der Heckenritter", "[720p, EAC3].mkv"),
      ],
      "episode",
    )!;
    expect(result.template).toBe("{n} ({y}) [tvdbid-{tvdb}]/Season {s}/{n} {s00e00}{?t} {t}{/} - [{vf}, {ac|replace:'DD+':'EAC3'}]");
    expect(result.matched).toBe(3);
  });

  it("Staffel statt absoluter Nummer, und EAC3 auch neben einem uneinheitlichen Staffelordner", () => {
    const show = (title: string, tvdb: string, season: string, epTitle: string, rest: string) => {
      const p = `${title} (2015) [tvdbid-${tvdb}]/${season}/${title} S01E01 ${epTitle} - ${rest}`;
      return {
        path: p,
        input: {
          parsed: parse(p),
          match: { provider: "tvdb", id: tvdb, kind: "series" as const, title, year: 2015 },
          // S01E01: the absolute number is 1 as well.
          episodes: [{ season: 1, episode: 1, absolute: 1, title: epTitle }],
          original: p.split("/").at(-1)!,
        },
      };
    };
    const result = inferFormat(
      [
        show("Better Call Saul", "273181", "Season 1", "Anfänge", "[480p, AAC].mkv"),
        show("Billions", "279536", "Season 1", "Strafe muss sein", "[480p, AC3].mkv"),
        show("Dark Matter", "292174", "Season 1", "Episode Eins", "[480p, AAC].mkv"),
        show("A Knight", "433631", "Season 01", "Der Heckenritter", "[720p, EAC3].mkv"),
      ],
      "episode",
    )!;
    expect(result.template).toBe("{n} ({y}) [tvdbid-{tvdb}]/Season {s}/{n} {s00e00}{?t} {t}{/} - [{vf}, {ac|replace:'DD+':'EAC3'}]");
    expect(result.matched).toBe(3);
    // The odd one out fails over its folder only.
    expect(result.checks.at(-1)).toMatchObject({
      ok: false,
      rendered: "A Knight (2015) [tvdbid-433631]/Season 1/A Knight S01E01 Der Heckenritter - [720p, EAC3].mkv",
    });
  });

  it("Bewertungen ändern sich: passt bis auf die Bewertung, auch ohne", () => {
    const film = (title: string, year: number, imdb: string, named: string, today: number | undefined) => {
      const name = `${title} (${year}) [imdbid-${imdb}]${named}`;
      return movie(`${year}/${name}/${name} - [480p, AC3].mkv`, {
        provider: "tmdb",
        id: "1",
        kind: "movie",
        title,
        year,
        rating: today,
        ids: { imdb },
      });
    };
    const result = inferFormat(
      [
        film("Der Pate", 1972, "tt0068646", " 8.7", 8.7),
        film("Scarface - Narbengesicht", 1932, "tt0023427", " 7.5", 7.4),
        // Named before it had a rating.
        film("War Machine", 2026, "tt15940132", "", 7.5),
      ],
      "movie",
    )!;
    expect(result.template).toBe(
      "{y}/{n} ({y}) [imdbid-{imdb}]{?rating} {rating}{/}/{n} ({y}) [imdbid-{imdb}]{?rating} {rating}{/} - [{vf}, {ac}]",
    );
    expect(result.matched).toBe(3);
    expect(result.checks.map((c) => c.ratingDiffers ?? false)).toEqual([false, true, true]);
  });

  it("ohne Proben nichts", () => {
    expect(inferFormat([], "movie")).toBeUndefined();
  });
});
