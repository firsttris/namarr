import { describe, expect, it } from "vitest";
import { localize } from "../src/i18n.ts";
import {
  classify,
  DOUBLE_EPISODE,
  groupInputs,
  jaroWinkler,
  matchAll,
  NO_MATCH,
  normalizeTitle,
  rank,
  resolveEpisodes,
  scoreCandidate,
} from "../src/matcher/index.ts";
import { parse } from "../src/parser/index.ts";
import type { MediaCandidate } from "../src/types.ts";
import { FakeProvider, severance, severanceEpisodes } from "./helpers.ts";

describe("Ähnlichkeit", () => {
  it("Jaro-Winkler Referenzwerte", () => {
    expect(jaroWinkler("martha", "marhta")).toBeCloseTo(0.961, 3);
    expect(jaroWinkler("dixon", "dicksonx")).toBeCloseTo(0.813, 3);
    expect(jaroWinkler("", "abc")).toBe(0);
    expect(jaroWinkler("abc", "abc")).toBe(1);
  });

  it("normalisiert Titel", () => {
    expect(normalizeTitle("The Lord of the Rings: The Two Towers")).toBe("lord of the rings the two towers");
    expect(normalizeTitle("Amélie")).toBe("amelie");
    expect(normalizeTitle("Fast & Furious")).toBe("fast and furious");
    expect(normalizeTitle("Die Straße")).toBe("strasse");
  });
});

describe("Schwellen", () => {
  it("ab 0,9 automatisch, 0,6 bis 0,9 Vorschlag, darunter manuell", () => {
    expect(classify(0.95)).toBe("auto");
    expect(classify(0.9)).toBe("auto");
    expect(classify(0.75)).toBe("suggest");
    expect(classify(0.59)).toBe("manual");
    expect(classify(0.85, 0.8)).toBe("auto");
  });
});

describe("Bewertung", () => {
  const dune2024: MediaCandidate = { provider: "tmdb", id: "693134", kind: "movie", title: "Dune: Part Two", year: 2024 };
  const dune2021: MediaCandidate = { provider: "tmdb", id: "438631", kind: "movie", title: "Dune", year: 2021 };

  it("Jahr entscheidet zwischen ähnlichen Titeln", () => {
    const parsed = parse("dune.part.two.2024.2160p.mkv");
    expect(scoreCandidate(parsed, dune2024)).toBeGreaterThan(scoreCandidate(parsed, dune2021));
    const { ranked, confidence } = rank(parsed, [dune2021, dune2024]);
    expect(ranked[0]!.candidate.id).toBe("693134");
    expect(confidence).toBeGreaterThan(0.9);
  });

  it("gleiche Titel senken die Confidence (The Office US/UK)", () => {
    const parsed = parse("The.Office.S03E05.720p.mkv");
    const us: MediaCandidate = { provider: "tmdb", id: "2316", kind: "series", title: "The Office", year: 2005 };
    const uk: MediaCandidate = { provider: "tmdb", id: "2996", kind: "series", title: "The Office", year: 2001 };
    const { confidence, reasons } = rank(parsed, [us, uk]);
    expect(confidence).toBeLessThan(0.9);
    expect(reasons.map((r) => localize(r, "de"))).toContain("Mehrere Treffer mit gleichem Titel");
    expect(reasons.map((r) => localize(r, "en"))).toContain("Several matches with the same title");
  });

  it("ohne passenden Kandidaten: Confidence 0", () => {
    const { confidence, reasons } = rank(parse("video_2024_final_v2.mp4"), [dune2021]);
    expect(confidence).toBe(0);
    expect(reasons).toEqual([NO_MATCH]);
  });

  it("Episodenzahl über der Anzahl der Serie wird bestraft", () => {
    const parsed = parse("[Grp] Show - 30.mkv");
    const short = { ...severance, title: "Show", episodeCount: 12 };
    const long = { ...severance, title: "Show", episodeCount: 50 };
    expect(scoreCandidate(parsed, short)).toBeLessThan(scoreCandidate(parsed, long));
  });
});

describe("Gruppierung und matchAll", () => {
  const files = [
    "Severance.S02E01.German.DL.1080p.WEB.h264-GRP.mkv",
    "Severance.S02E02.German.DL.1080p.WEB.h264-GRP.mkv",
    "Severance.S02E03.German.DL.1080p.WEB.h264-GRP.mkv",
    "severance.204-205.720p.mkv",
    "Severance/Staffel 2/06.mkv",
    "video_2024_final_v2.mp4",
  ].map((p) => ({ key: p, parsed: parse(p) }));

  it("gruppiert Dateien derselben Serie", () => {
    const groups = groupInputs(files);
    expect(groups.filter((g) => g.kind === "series")).toHaveLength(1);
    expect(groups.find((g) => g.kind === "series")!.items).toHaveLength(5);
  });

  it("sucht die Serie nur einmal und lädt Episoden einmal", async () => {
    const provider = new FakeProvider({ series: [severance], episodes: { "95396": severanceEpisodes } });
    const results = await matchAll(files, provider);
    expect(provider.calls.searchSeries).toBe(1);
    expect(provider.calls.episodes).toBe(1);

    const e1 = results.get(files[0]!.key)!;
    expect(e1.best?.id).toBe("95396");
    expect(e1.episodes.map((e) => e.title)).toEqual(["Hallo, Frau Cobel"]);
    expect(classify(e1.confidence)).toBe("auto");

    const double = results.get("severance.204-205.720p.mkv")!;
    expect(double.episodes.map((e) => e.episode)).toEqual([4, 5]);
    expect(double.reasons).toContain(DOUBLE_EPISODE);
    expect(classify(double.confidence)).toBe("suggest");

    expect(results.get("Severance/Staffel 2/06.mkv")!.episodes[0]?.title).toBe("Attila");
    expect(results.get("video_2024_final_v2.mp4")!.best).toBeUndefined();
  });

  it("fehlende Episode beim Anbieter senkt die Confidence", async () => {
    const provider = new FakeProvider({ series: [severance], episodes: { "95396": severanceEpisodes } });
    const input = [{ key: "x", parsed: parse("Severance.S02E09.1080p.mkv") }];
    const result = (await matchAll(input, provider)).get("x")!;
    expect(result.reasons.map((r) => localize(r, "de"))).toContain("Episode nicht beim Anbieter gefunden");
    expect(classify(result.confidence)).not.toBe("auto");
  });

  it("gespeicherte Entscheidung (Override) gewinnt", async () => {
    const other: MediaCandidate = { provider: "tmdb", id: "1", kind: "series", title: "Office Space Show" };
    const provider = new FakeProvider({ series: [other, severance], episodes: { "95396": severanceEpisodes } });
    const input = [{ key: "x", parsed: parse("Sev.S02E01.mkv") }];
    const result = (await matchAll(input, provider, { overrides: [{ pattern: "Sev", provider: "tmdb", externalId: "95396" }] })).get("x")!;
    expect(result.best?.id).toBe("95396");
    expect(result.confidence).toBe(1);
    expect(result.overridden).toBe(true);
    expect(provider.calls.searchSeries).toBe(0);
  });

  it("Override per Release-Gruppe mit Staffel-Versatz", async () => {
    const provider = new FakeProvider({ series: [severance], episodes: { "95396": severanceEpisodes } });
    const input = [{ key: "x", parsed: parse("Whatever.S01E03.1080p.WEB-ABC.mkv") }];
    const result = (
      await matchAll(input, provider, {
        overrides: [{ pattern: "group:ABC", provider: "tmdb", externalId: "95396", seasonOffset: 1 }],
      })
    ).get("x")!;
    expect(result.episodes[0]?.title).toBe("Wer ist lebendig?");
  });

  it("meldet Fortschritt pro Gruppe", async () => {
    const provider = new FakeProvider({ series: [severance], episodes: { "95396": severanceEpisodes } });
    const progress: number[] = [];
    await matchAll(files, provider, { onProgress: (done) => progress.push(done) });
    expect(progress).toEqual([1, 2]);
  });
});

describe("resolveEpisodes", () => {
  it("absolute Nummer über die Liste des Anbieters", () => {
    const parsed = parse("[SubsPlease] Severance - 10 (1080p).mkv");
    expect(resolveEpisodes(parsed, severanceEpisodes)[0]).toMatchObject({ season: 2, episode: 1 });
  });

  it("absolute Nummer ohne Angabe des Anbieters: durchzählen", () => {
    const parsed = parse("[SubsPlease] Severance - 2 (1080p).mkv");
    const withoutAbsolute = severanceEpisodes.map(({ absolute: _, ...e }) => e);
    expect(resolveEpisodes(parsed, withoutAbsolute)[0]).toMatchObject({ season: 2, episode: 1 });
  });

  it("Datum für Talkshows", () => {
    const parsed = parse("Show.2026.09.28.mkv");
    expect(resolveEpisodes(parsed, [{ season: 5, episode: 3, airDate: "2026-09-28" }])).toHaveLength(1);
  });
});
