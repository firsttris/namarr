import { matchAll, parse } from "@namarr/core";
import { describe, expect, it } from "vitest";
import { text } from "../../core/test/text.ts";
import { ProviderError, TvdbProvider } from "../src/index.ts";
import { fakeFetch, status } from "./fake-fetch.ts";

const ds9 = {
  id: 72073,
  name: "Star Trek: Deep Space Nine",
  year: "1993",
  originalLanguage: "eng",
  image: "https://artworks.thetvdb.com/ds9.jpg",
};
const ep = (seasonNumber: number, number: number, absoluteNumber: number, name: string | null) => ({
  seasonNumber,
  number,
  absoluteNumber,
  name,
  aired: `1993-01-${String(number).padStart(2, "0")}`,
});

const routes = {
  "POST /v4/login": { status: "success", data: { token: "TOKEN" } },
  "GET /v4/search?limit=10&query=Deep+Space+Nine&type=series&year=1993": { data: [] },
  "GET /v4/search?limit=10&query=Deep+Space+Nine&type=series": {
    data: [
      {
        tvdb_id: "72073",
        name: "Star Trek: Deep Space Nine",
        year: "1993",
        translations: { deu: "Star Trek: Deep Space Nine", eng: "Star Trek: Deep Space Nine" },
        aliases: ["DS9", "Star Trek: DS9"],
        thumbnail: "https://artworks.thetvdb.com/ds9-thumb.jpg",
      },
    ],
  },
  "GET /v4/search?limit=10&query=Das+Boot&type=movie": {
    data: [{ tvdb_id: "1234", name: "The Boat", year: "1981", translations: { deu: "Das Boot" } }],
  },
  "GET /v4/series/72073": { data: ds9 },
  "GET /v4/series/72073/translations/deu": { data: { name: "Star Trek: Deep Space Nine", language: "deu" } },
  "GET /v4/series/72073/episodes/default/deu?page=0": {
    data: {
      series: ds9,
      episodes: [ep(1, 1, 1, "Der Abgesandte (1)"), ep(1, 2, 2, "Der Abgesandte (2)"), ep(0, 1, 0, "Behind the Scenes")],
    },
    links: { next: "https://api4.thetvdb.com/v4/series/72073/episodes/default/deu?page=1" },
  },
  "GET /v4/series/72073/episodes/default/deu?page=1": {
    data: { series: ds9, episodes: [ep(1, 3, 3, "Die Khon-Ma"), ep(1, 7, 7, null)] },
    links: { next: null },
  },
  "GET /v4/series/72073/episodes/default/eng?page=0": {
    data: { series: ds9, episodes: [ep(1, 1, 1, "Emissary (1)"), ep(1, 7, 7, "Q-Less")] },
    links: { next: null },
  },
  "GET /v4/series/72073/episodes/dvd/deu?page=0": {
    data: { series: ds9, episodes: [ep(1, 1, 1, "Der Abgesandte")] },
    links: { next: null },
  },
  "GET /v4/search/remoteid/tt0106145": { data: [{ series: { id: 72073 } }] },
};

function tvdb(extra: Record<string, unknown> = {}, pin?: string) {
  const f = fakeFetch({ ...routes, ...extra });
  const provider = new TvdbProvider({
    apiKey: "KEY",
    pin,
    language: "de-DE",
    fetch: f.fetchImpl,
    baseUrl: "https://api.test/v4",
    rateLimit: 1000,
  });
  return { provider, calls: f.calls };
}

describe("TheTVDB-Provider", () => {
  it("meldet sich einmal an und sucht mit Bearer-Token", async () => {
    const { provider, calls } = tvdb({}, "1234");
    const [first] = await provider.searchSeries("Deep Space Nine", { year: 1993 });
    expect(first).toEqual({
      provider: "tvdb",
      id: "72073",
      kind: "series",
      title: "Star Trek: Deep Space Nine",
      originalTitle: undefined,
      aliases: ["DS9", "Star Trek: DS9"],
      year: 1993,
      poster: "https://artworks.thetvdb.com/ds9-thumb.jpg",
    });
    expect(JSON.parse(calls[0]!.body!)).toEqual({ apikey: "KEY", pin: "1234" });
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
    expect(calls.at(-1)!.headers.get("authorization")).toBe("Bearer TOKEN");
  });

  it("Filme: deutscher Titel, Original als zweiter Titel", async () => {
    const { provider } = tvdb();
    expect(await provider.searchMovie("Das Boot")).toMatchObject([
      { kind: "movie", title: "Das Boot", originalTitle: "The Boat", year: 1981 },
    ]);
  });

  it("Episoden über alle Seiten, fehlende Übersetzung aus dem Englischen", async () => {
    const { provider } = tvdb();
    const all = await provider.episodes("72073");
    expect(all.map((e) => [e.season, e.episode, e.absolute, e.title])).toEqual([
      [1, 1, 1, "Der Abgesandte (1)"],
      [1, 2, 2, "Der Abgesandte (2)"],
      [0, 1, undefined, "Behind the Scenes"],
      [1, 3, 3, "Die Khon-Ma"],
      [1, 7, 7, "Q-Less"],
    ]);
    expect(await provider.episodes("72073", { season: 0 })).toHaveLength(1);
  });

  it("DVD-Reihenfolge nutzt den DVD-Staffeltyp", async () => {
    const { provider, calls } = tvdb();
    expect(await provider.episodes("72073", { order: "dvd" })).toMatchObject([{ season: 1, episode: 1, title: "Der Abgesandte" }]);
    expect(calls.some((c) => c.url.startsWith("/v4/series/72073/episodes/dvd/deu"))).toBe(true);
  });

  it("findet Serien über TVDB- und IMDb-IDs", async () => {
    const { provider } = tvdb();
    expect(await provider.findById("series", { tvdb: "72073" })).toMatchObject({
      id: "72073",
      title: "Star Trek: Deep Space Nine",
      year: 1993,
    });
    expect(await provider.findById("series", { imdb: "tt0106145" })).toMatchObject({ id: "72073" });
    expect(await provider.findById("series", { tvdb: "999" })).toBeUndefined();
  });

  it("abgelaufenes Token: einmal neu anmelden; falscher Key: verständlicher Fehler", async () => {
    // The first series call answers 401, the retry with a fresh token succeeds
    let first = true;
    const f = fakeFetch(routes);
    const flaky = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("/series/72073") && first) {
        first = false;
        return new Response("", { status: 401 });
      }
      return f.fetchImpl(input, init);
    }) as typeof fetch;
    const retrying = new TvdbProvider({ apiKey: "KEY", fetch: flaky, baseUrl: "https://api.test/v4", rateLimit: 1000 });
    expect(await retrying.details("series", "72073")).toMatchObject({ id: "72073" });
    expect(f.calls.filter((c) => c.method === "POST")).toHaveLength(2);

    const denied = tvdb({ "POST /v4/login": status(401) }).provider;
    const err = await denied.searchSeries("Deep Space Nine").catch((e: ProviderError) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(text((err as Error).message, "de")).toBe("TheTVDB: API-Key oder PIN ungültig");
  });

  it("die ID im Ordnernamen spart die Suche", async () => {
    const { provider, calls } = tvdb();
    const file = "/tv/Star Trek - Deep Space Nine (1993) [tvdbid-72073]/Season 01/Star Trek - Deep Space Nine S01E07 'Q'-unerwünscht.mkv";
    const result = (await matchAll([{ key: "a", parsed: parse(file) }], provider, { language: "de-DE" })).get("a")!;
    expect(result).toMatchObject({ best: { id: "72073" }, confidence: 1, episodes: [{ season: 1, episode: 7, title: "Q-Less" }] });
    expect(calls.some((c) => c.url.startsWith("/v4/search"))).toBe(false);
  });
});
