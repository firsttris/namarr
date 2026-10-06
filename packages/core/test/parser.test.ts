import { describe, expect, it } from "vitest";
import {
  absoluteEpisodeRule,
  audioRule,
  compactEpisodeRule,
  crossEpisodeRule,
  dateRule,
  editionRule,
  type ParseContext,
  type ParserRule,
  parse,
  parseName,
  resolutionRule,
  resolvePending,
  seasonEpisodeRule,
  seasonPackRule,
  sourceRule,
  splitExtension,
  verboseEpisodeRule,
  videoCodecRule,
  yearRule,
} from "../src/parser/index.ts";

function run(rule: ParserRule, name: string, bracketGroup = false): ParseContext {
  const ctx: ParseContext = {
    name,
    out: { kind: { value: "unknown", confidence: 0 }, episodes: [], release: { languages: [] } },
    hits: [],
    pending: [],
    episodeConfidence: 0,
    bracketGroup,
  };
  rule.apply(ctx);
  resolvePending(ctx);
  return ctx;
}

describe("Parser-Regeln einzeln", () => {
  it("resolution", () => {
    expect(run(resolutionRule, "Movie.2010.1080p").out.release.resolution).toBe("1080p");
    expect(run(resolutionRule, "Movie.2010.4K").out.release.resolution).toBe("2160p");
    expect(run(resolutionRule, "Movie.1080i.HDTV").out.release.resolution).toBe("1080i");
    expect(run(resolutionRule, "Movie.10800p").out.release.resolution).toBeUndefined();
  });

  it("source: Remux hat Vorrang vor BluRay, WEB nur im Release-Kontext", () => {
    expect(run(sourceRule, "Movie.BluRay.REMUX").out.release.source).toBe("Remux");
    expect(run(sourceRule, "Movie.WEB-DL").out.release.source).toBe("WEB-DL");
    expect(run(sourceRule, "Movie.WEBRip").out.release.source).toBe("WEBRip");
    expect(run(sourceRule, "Charlottes.Web.Story").out.release.source).toBeUndefined();
  });

  it("videoCodec", () => {
    expect(run(videoCodecRule, "a.x264").out.release.videoCodec).toBe("H.264");
    expect(run(videoCodecRule, "a.H.264").out.release.videoCodec).toBe("H.264");
    expect(run(videoCodecRule, "a.HEVC").out.release.videoCodec).toBe("H.265");
    expect(run(videoCodecRule, "a.AV1").out.release.videoCodec).toBe("AV1");
  });

  it("audio mit Kanälen", () => {
    const ctx = run(audioRule, "a.DDP5.1.Atmos");
    expect(ctx.out.release).toMatchObject({ audioCodec: "DD+", audioChannels: "5.1" });
    expect(run(audioRule, "a.DTS-HD.MA.7.1").out.release).toMatchObject({ audioCodec: "DTS-HD", audioChannels: "7.1" });
    expect(run(audioRule, "a.AAC2.0").out.release).toMatchObject({ audioCodec: "AAC", audioChannels: "2.0" });
    // Old SD rips: "[360p, MP3]".
    expect(run(audioRule, "Castle S01E01 - [360p, MP3]").out.release).toMatchObject({ audioCodec: "MP3" });
  });

  it("edition nur im Release-Kontext", () => {
    expect(parseName("Movie.Directors.Cut.1080p").edition).toBe("Director's Cut");
    expect(parseName("Movie.2001.Director's.Cut").edition).toBe("Director's Cut");
    expect(run(editionRule, "Movie.Directors.Cut").out.edition).toBeUndefined();
    expect(parseName("Uncut.Gems.2019").edition).toBeUndefined();
  });

  it("seasonEpisode: einfach, Doppelfolge, Bereich", () => {
    expect(run(seasonEpisodeRule, "Show.S01E02").out).toMatchObject({ season: 1, episodes: [2] });
    expect(run(seasonEpisodeRule, "Show.S01E01E02").out).toMatchObject({ season: 1, episodes: [1, 2] });
    expect(run(seasonEpisodeRule, "Show.S01E01-E03").out).toMatchObject({ season: 1, episodes: [1, 2, 3] });
    expect(run(seasonEpisodeRule, "Show.s1e5").out).toMatchObject({ season: 1, episodes: [5] });
    expect(run(seasonEpisodeRule, "Show S01 E05").out).toMatchObject({ season: 1, episodes: [5] });
  });

  it("crossEpisode: 1x01", () => {
    expect(run(crossEpisodeRule, "Show.1x01").out).toMatchObject({ season: 1, episodes: [1] });
    expect(run(crossEpisodeRule, "Show.2x03-04").out).toMatchObject({ season: 2, episodes: [3, 4] });
    expect(run(crossEpisodeRule, "Movie.1920x1080").out.episodes).toEqual([]);
  });

  it("verboseEpisode: deutsch und englisch", () => {
    expect(run(verboseEpisodeRule, "Dark.Staffel.1.Folge.3").out).toMatchObject({ season: 1, episodes: [3] });
    expect(run(verboseEpisodeRule, "Show Season 2 Episode 10").out).toMatchObject({ season: 2, episodes: [10] });
    expect(run(verboseEpisodeRule, "Show.Staffel.2").out).toMatchObject({ season: 2, episodes: [] });
    expect(run(verboseEpisodeRule, "Tatort.Folge.1234").out).toMatchObject({ episodes: [1234] });
  });

  it("seasonPack", () => {
    expect(run(seasonPackRule, "Severance.S02.German").out.season).toBe(2);
  });

  it("date", () => {
    expect(run(dateRule, "Show.2026.09.28.720p").out.date).toBe("2026-09-28");
    expect(run(dateRule, "Show.2026.13.28").out.date).toBeUndefined();
  });

  it("absoluteEpisode: Anime, aber kein Jahr ohne Gruppen-Tag", () => {
    expect(run(absoluteEpisodeRule, "Frieren - 12 (1080p)", true).out.absolute).toBe(12);
    expect(run(absoluteEpisodeRule, "One Piece - 1071v2", true).out.absolute).toBe(1071);
    expect(run(absoluteEpisodeRule, "Movie - 2010").out.absolute).toBeUndefined();
  });

  it("year: Jahr am Anfang gehört zum Titel, das letzte zählt", () => {
    expect(run(yearRule, "2001.A.Space.Odyssey.1968").out.year).toBe(1968);
    expect(run(yearRule, "1917").out.year).toBeUndefined();
    expect(run(yearRule, "Blade.Runner.2049.2017").out.year).toBe(2017);
  });

  it("compactEpisode: nicht am Anfang, nicht mit Jahr", () => {
    expect(run(compactEpisodeRule, "severance.204-205.720p").out).toMatchObject({ season: 2, episodes: [4, 5] });
    expect(run(compactEpisodeRule, "300.mkv").out.episodes).toEqual([]);
  });
});

describe("splitExtension", () => {
  it("trennt Untertitel-Tags mit ab", () => {
    expect(splitExtension("Movie.2010.de.forced.srt")).toEqual({ stem: "Movie.2010", extension: "srt", suffix: ".de.forced.srt" });
    expect(splitExtension("Movie.2010.mkv")).toEqual({ stem: "Movie.2010", extension: "mkv", suffix: ".mkv" });
    expect(splitExtension("Severance.S02")).toEqual({ stem: "Severance.S02", suffix: "" });
  });
});

describe("Ordnerkontext", () => {
  it("Serie/Staffel 2/06.mkv", () => {
    expect(parse("Severance/Staffel 2/06.mkv")).toMatchObject({ title: "Severance", season: 2, episodes: [6], kind: { value: "episode" } });
  });

  it("Serie (Jahr)/Season 01/E03 - Titel.mkv", () => {
    expect(parse("/tv/Severance (2022)/Season 01/E03 - In Perpetuity.mkv")).toMatchObject({
      title: "Severance",
      year: 2022,
      season: 1,
      episodes: [3],
    });
  });

  it("Specials-Ordner ist Staffel 0", () => {
    expect(parse("Show/Specials/Show.E01.mkv")).toMatchObject({ season: 0, episodes: [1] });
  });

  it("Release-Ordner liefert Staffel und Gruppe", () => {
    const p = parse("Severance.S02.German.DL.1080p.WEB-GRP/severance.204-205.mkv");
    expect(p).toMatchObject({ title: "severance", season: 2, episodes: [4, 5] });
    expect(p.release).toMatchObject({ group: "GRP", languages: ["de", "en"], resolution: "1080p" });
  });

  it("Filmordner liefert das Jahr, wenn der Titel passt", () => {
    expect(parse("Das Boot (1981)/das.boot.mkv")).toMatchObject({ title: "das boot", year: 1981 });
    expect(parse("Andere (1999)/das.boot.mkv").year).toBeUndefined();
  });

  it("Generischer Dateiname im Filmordner", () => {
    expect(parse("Inception (2010)/1080p.mkv")).toMatchObject({ title: "Inception", year: 2010, kind: { value: "movie" } });
  });

  it("IDs von Sonarr, Radarr und Jellyfin im Ordnernamen", () => {
    const ds9 = parse(
      "/tv/Star Trek - Deep Space Nine (1993) [tvdbid-72073]/Season 01/Star Trek - Deep Space Nine S01E07 'Q'-unerwünscht - [1080p, AC3].mkv",
    );
    expect(ds9).toMatchObject({ title: "Star Trek - Deep Space Nine", year: 1993, season: 1, episodes: [7], ids: { tvdb: "72073" } });
    // The file's own ID wins over the folder's; the tags never end up in the title
    const dune = parse("/movies/Dune (2021) {tmdb-438631} [imdbid-tt0000001]/Dune (2021) {imdb-tt1160419}.mkv");
    expect(dune).toMatchObject({ title: "Dune", year: 2021, ids: { tmdb: "438631", imdb: "tt1160419" } });
    expect(parse("[SubsPlease] Frieren - 05 (1080p) [anidb-17617].mkv")).toMatchObject({ title: "Frieren", ids: { anidb: "17617" } });
    expect(parse("Dark.S01E01.mkv").ids).toBeUndefined();
  });

  it("Windows-Pfade", () => {
    expect(parse("D:\\TV\\Dark\\Staffel 1\\03.mkv")).toMatchObject({ title: "Dark", season: 1, episodes: [3] });
  });
});

describe("Snapshots", () => {
  const names = [
    "The.Office.US.S03E05.720p.WEB.x264-GRP.mkv",
    "Das.Boot.1981.Directors.Cut.German.DL.1080p.BluRay.mkv",
    "[SubsPlease] Frieren - 12 (1080p).mkv",
    "dune.part.two.2024.2160p.mkv",
    "severance.204-205.720p.mkv",
    "video_2024_final_v2.mp4",
  ];
  it.each(names)("%s", (name) => {
    expect(parseName(name)).toMatchSnapshot();
  });
});
