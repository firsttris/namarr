import { matchAll, parse } from "@namarr/core";
import { describe, expect, it } from "vitest";
import { TvmazeProvider } from "../src/index.ts";
import { fakeFetch, status } from "./fake-fetch.ts";

const ds9 = {
  id: 530,
  name: "Star Trek: Deep Space Nine",
  premiered: "1993-01-03",
  status: "Ended",
  image: { medium: "https://static.tvmaze.com/ds9.jpg" },
  externals: { thetvdb: 72073, imdb: "tt0106145" },
};

const routes = {
  "GET /search/shows?q=Deep%20Space%20Nine": [{ score: 0.9, show: ds9 }],
  "GET /shows/530": ds9,
  "GET /lookup/shows?thetvdb=72073": ds9,
  "GET /lookup/shows?thetvdb=1": status(404),
  "GET /shows/530/episodes?specials=1": [
    { season: 1, number: 1, name: "Emissary", airdate: "1993-01-03", type: "regular" },
    { season: 1, number: null, name: "Behind the Scenes", airdate: "1993-01-04", type: "insignificant_special" },
    { season: 1, number: 2, name: "Past Prologue", airdate: "1993-01-10", type: "regular" },
    { season: 2, number: 1, name: "The Homecoming", airdate: "1993-09-27", type: "regular" },
  ],
};

function tvmaze() {
  const f = fakeFetch(routes);
  return { provider: new TvmazeProvider({ fetch: f.fetchImpl, baseUrl: "https://api.test" }), calls: f.calls };
}

describe("TVmaze-Provider", () => {
  it("sucht Serien ohne Key, Filme gibt es nicht", async () => {
    const { provider, calls } = tvmaze();
    expect(await provider.searchSeries("Deep Space Nine")).toEqual([
      {
        provider: "tvmaze",
        id: "530",
        kind: "series",
        title: "Star Trek: Deep Space Nine",
        year: 1993,
        poster: "https://static.tvmaze.com/ds9.jpg",
        rating: undefined,
        ids: { imdb: "tt0106145", tvdb: "72073" },
      },
    ]);
    expect(await provider.searchMovie()).toEqual([]);
    expect(calls[0]!.headers.get("authorization")).toBeNull();
  });

  it("Episoden: Specials ohne Nummer werden Staffel 0, absolute Nummern zählen durch", async () => {
    const { provider } = tvmaze();
    expect((await provider.episodes("530")).map((e) => [e.season, e.episode, e.absolute, e.title])).toEqual([
      [1, 1, 1, "Emissary"],
      [0, 1, undefined, "Behind the Scenes"],
      [1, 2, 2, "Past Prologue"],
      [2, 1, 3, "The Homecoming"],
    ]);
    expect(await provider.episodes("530", { season: 2 })).toHaveLength(1);
  });

  it("findet Serien über die TVDB-ID aus dem Ordnernamen", async () => {
    const { provider, calls } = tvmaze();
    expect(await provider.findById("series", { tvdb: "1" })).toBeUndefined();
    const file = "/tv/Star Trek - Deep Space Nine (1993) [tvdbid-72073]/Season 01/ds9.s01e02.mkv";
    const result = (await matchAll([{ key: "a", parsed: parse(file) }], provider)).get("a")!;
    expect(result).toMatchObject({ best: { id: "530" }, confidence: 1, episodes: [{ title: "Past Prologue" }] });
    expect(calls.some((c) => c.url.startsWith("/search"))).toBe(false);
  });
});
