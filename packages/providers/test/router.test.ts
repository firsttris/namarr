import { matchAll, parse } from "@namarr/core";
import { describe, expect, it } from "vitest";
import { DemoProvider, RoutedProvider, TvmazeProvider } from "../src/index.ts";
import { fakeFetch } from "./fake-fetch.ts";

describe("Filme und Serien aus verschiedenen Quellen", () => {
  const f = fakeFetch({
    "GET /search/shows?q=Dark": [{ show: { id: 17861, name: "Dark", premiered: "2017-12-01" } }],
    "GET /shows/17861/episodes?specials=1": [{ season: 1, number: 1, name: "Secrets", type: "regular" }],
  });
  const routed = new RoutedProvider(new DemoProvider(), new TvmazeProvider({ fetch: f.fetchImpl, baseUrl: "https://api.test" }));

  it("Filme vom einen, Serien vom anderen Anbieter", async () => {
    const results = await matchAll(
      [
        { key: "movie", parsed: parse("Das.Boot.1981.1080p.BluRay.x264-GRP.mkv") },
        { key: "episode", parsed: parse("Dark.S01E01.1080p.WEB.x264-GRP.mkv") },
      ],
      routed,
    );
    expect(results.get("movie")!.best).toMatchObject({ provider: "tmdb", title: "Das Boot" });
    expect(results.get("episode")!.best).toMatchObject({ provider: "tvmaze", id: "17861" });
    expect(results.get("episode")!.episodes).toMatchObject([{ title: "Secrets" }]);
  });

  it("gespeicherte Entscheidungen gelten pro Quelle", async () => {
    expect(routed.name).toBe("tmdb+tvmaze");
    expect([routed.nameFor("movie"), routed.nameFor("series")]).toEqual(["tmdb", "tvmaze"]);
    const results = await matchAll([{ key: "e", parsed: parse("Dark.S01E01.mkv") }], routed, {
      overrides: [{ pattern: "Dark", provider: "tmdb", externalId: "70523" }],
    });
    // The TMDB decision does not apply to the TVmaze series
    expect(results.get("e")!.overridden).toBe(false);
  });
});
