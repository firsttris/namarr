import { readFileSync } from "node:fs";
import { classify, matchAll, parse } from "@namarr/core";
import { tr } from "@namarr/core/i18n";
import { describe, expect, it } from "vitest";
import { isPlaceholderTitle, MemoryCache, ProviderError, TmdbProvider } from "../src/index.ts";

/** Replays recorded TMDB responses; no live API in CI. */
function recorded(routes: Record<string, string>) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(`${url.pathname}${url.search}`);
    const auth = new Headers(init?.headers).get("authorization");
    const route = Object.entries(routes).find(([prefix]) => `${url.pathname}${url.search}`.startsWith(prefix));
    if (!route) return new Response("{}", { status: 404 });
    if (route[1] === "429") return new Response("{}", { status: 429, headers: { "retry-after": "0" } });
    if (route[1] === "401") return new Response("{}", { status: 401 });
    const body = readFileSync(new URL(`./fixtures/tmdb/${route[1]}.json`, import.meta.url), "utf8");
    return new Response(body, { status: 200, headers: { "content-type": "application/json", "x-auth": auth ?? "" } });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const routes = {
  "/3/search/tv?first_air_date_year=&language=de-DE&query=Severance": "search_tv_severance",
  "/3/search/tv?language=de-DE&query=Severance": "search_tv_severance",
  "/3/tv/95396/season/1": "tv_95396_season_1",
  "/3/tv/95396/season/2": "tv_95396_season_2",
  "/3/tv/95396/episode_groups": "tv_95396_episode_groups",
  "/3/tv/episode_group/grp-dvd": "episode_group_grp-dvd",
  "/3/tv/95396": "tv_95396",
  "/3/find/371980?external_source=tvdb_id&language=de-DE": "find_tvdb_371980",
  "/3/search/movie?include_adult=false&language=de-DE&query=Dune": "search_movie_dune",
  "/3/search/movie?include_adult=false&language=de-DE&query=Das": "search_movie_das_boot",
};

function provider(extra: Partial<ConstructorParameters<typeof TmdbProvider>[0]> = {}) {
  const r = recorded(routes);
  const tmdb = new TmdbProvider({
    apiKey: "k",
    language: "de-DE",
    fetch: r.fetchImpl,
    baseUrl: "https://api.test/3",
    rateLimit: 1000,
    ...extra,
  });
  return { tmdb, calls: r.calls };
}

describe("TMDB-Provider", () => {
  it("sucht Serien und bildet Kandidaten", async () => {
    const { tmdb } = provider();
    const [first] = await tmdb.searchSeries("Severance");
    expect(first).toEqual({
      provider: "tmdb",
      id: "95396",
      kind: "series",
      title: "Severance",
      originalTitle: undefined,
      year: 2022,
      poster: "https://image.tmdb.org/t/p/w185/pPHpeI2X1qEd1CS1SeyrdhZ4qnT.jpg",
      episodeCount: undefined,
    });
  });

  it("sucht Filme, mit Jahr und ohne", async () => {
    const { tmdb, calls } = provider();
    const results = await tmdb.searchMovie("Dune Part Two", { year: 2024 });
    expect(results.map((r) => r.id)).toEqual(["693134", "438631"]);
    expect(calls[0]).toContain("year=2024");
  });

  it("lädt Episoden aller Staffeln mit absoluter Nummer", async () => {
    const { tmdb } = provider();
    const eps = await tmdb.episodes("95396");
    expect(eps).toHaveLength(6);
    expect(eps.find((e) => e.season === 2 && e.episode === 1)).toEqual({
      season: 2,
      episode: 1,
      title: "Hallo, Frau Cobel",
      airDate: "2025-01-16",
      absolute: 4,
    });
  });

  it("unübersetzte Episodentitel kommen aus der Originalsprache, dann aus Englisch", async () => {
    const r = recorded({
      "/3/tv/95396/season/2?language=de-DE": "tv_95396_season_2_untranslated",
      "/3/tv/95396/season/2?language=en-US": "tv_95396_season_2_en_us",
      "/3/tv/95396/season/2?language=en&": "tv_95396_season_2_en",
      ...routes,
    });
    const tmdb = new TmdbProvider({ apiKey: "k", language: "de-DE", fetch: r.fetchImpl, baseUrl: "https://api.test/3", rateLimit: 1000 });
    const eps = await tmdb.episodes("95396", { season: 2 });
    expect(eps.map((e) => e.title)).toEqual(["Hallo, Frau Cobel", "Goodbye, Mrs. Selvig", "Who Is Alive?"]);
    // Only the season with gaps is fetched again
    expect(r.calls.filter((c) => c.includes("/season/")).map((c) => new URL(`http://x${c}`).searchParams.get("language"))).toEqual([
      "de-DE",
      "en",
      "en-US",
    ]);
  });

  it("Platzhalter-Titel werden erkannt", () => {
    for (const t of ["Episode 5", "Folge 12", "Épisode 3", "Episodio 7", "第5話", "12", "", undefined])
      expect(isPlaceholderTitle(t)).toBe(true);
    for (const t of ["Hallo, Frau Cobel", "Episode IV", "The 5th Episode", "Folge dem Licht"]) expect(isPlaceholderTitle(t)).toBe(false);
  });

  it("DVD-Reihenfolge über Episode Groups", async () => {
    const { tmdb } = provider();
    const eps = await tmdb.episodes("95396", { order: "dvd" });
    expect(eps.map((e) => `${e.season}x${e.episode} ${e.title}`)).toEqual([
      "1x1 Halb-Lokal",
      "1x2 Gute Neuigkeiten über die Hölle",
      "2x1 Hallo, Frau Cobel",
    ]);
  });

  it("ohne passende Episode Group: Ausstrahlungsreihenfolge", async () => {
    const { tmdb } = provider();
    expect(await tmdb.episodes("95396", { order: "absolute", season: 1 })).toHaveLength(3);
  });

  it("cached Antworten (keine zweite Anfrage)", async () => {
    const { tmdb, calls } = provider();
    await tmdb.searchSeries("Severance");
    await tmdb.searchSeries("Severance");
    expect(calls).toHaveLength(1);
  });

  it("Cache läuft nach TTL ab", async () => {
    let now = 0;
    const cache = new MemoryCache(() => now);
    await cache.set("tmdb", "k", 1, 10);
    expect(await cache.get("tmdb", "k")).toBe(1);
    now = 10_001;
    expect(await cache.get("tmdb", "k")).toBeUndefined();
  });

  it("v4-Token als Bearer, v3-Key als Query", async () => {
    const r = recorded(routes);
    let seen: Headers | undefined;
    const spy = (async (input: string | URL | Request, init?: RequestInit) => {
      seen = new Headers(init?.headers);
      return r.fetchImpl(input, init);
    }) as typeof fetch;
    await new TmdbProvider({ apiKey: "eyJtoken", fetch: spy, baseUrl: "https://api.test/3", language: "de-DE" }).searchSeries("Severance");
    expect(seen?.get("authorization")).toBe("Bearer eyJtoken");
    expect(r.calls[0]).not.toContain("api_key");

    const { tmdb, calls } = provider();
    await tmdb.searchSeries("Severance");
    expect(calls[0]).toContain("api_key=k");
  });

  it("wiederholt bei 429 und meldet 401 verständlich", async () => {
    let n = 0;
    const flaky = (async (input: string | URL | Request, init?: RequestInit) => {
      if (n++ === 0) return new Response("{}", { status: 429, headers: { "retry-after": "0" } });
      return recorded(routes).fetchImpl(input, init);
    }) as typeof fetch;
    const tmdb = new TmdbProvider({ apiKey: "k", fetch: flaky, baseUrl: "https://api.test/3", language: "de-DE" });
    expect(await tmdb.searchSeries("Severance")).toHaveLength(1);

    const bad = new TmdbProvider({ apiKey: "k", fetch: recorded({ "/3/": "401" }).fetchImpl, baseUrl: "https://api.test/3" });
    await expect(bad.searchMovie("x")).rejects.toThrow(new ProviderError(tr("TMDB: API-Key ungültig", "TMDB: invalid API key"), 401));
  });

  it("Ende-zu-Ende: Parser + Matcher gegen aufgezeichnete Antworten", async () => {
    const { tmdb } = provider();
    const inputs = ["Severance.S02E01.German.DL.1080p.WEB.h264-GRP.mkv", "Das.Boot.1981.Directors.Cut.German.DL.1080p.BluRay.mkv"].map(
      (key) => ({ key, parsed: parse(key) }),
    );
    const results = await matchAll(inputs, tmdb, { language: "de-DE" });
    const ep = results.get(inputs[0]!.key)!;
    expect(ep.best?.title).toBe("Severance");
    expect(ep.episodes[0]?.title).toBe("Hallo, Frau Cobel");
    expect(classify(ep.confidence)).toBe("auto");
    const movie = results.get(inputs[1]!.key)!;
    expect(movie.best).toMatchObject({ id: "387", year: 1981 });
    expect(classify(movie.confidence)).toBe("auto");
  });

  it("findet Serien über TMDB-, TVDB- und IMDb-IDs aus dem Ordnernamen", async () => {
    const { tmdb, calls } = provider();
    expect(await tmdb.findById("series", { tmdb: "95396" })).toMatchObject({ id: "95396", title: "Severance" });
    expect(await tmdb.findById("series", { tvdb: "371980" })).toMatchObject({ id: "95396" });
    expect(await tmdb.findById("series", { tmdb: "1", imdb: "tt0" })).toBeUndefined();
    expect(calls).toContain("/3/find/371980?external_source=tvdb_id&language=de-DE&api_key=k");
  });
});
