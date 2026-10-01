import { readFileSync } from "node:fs";
import { matchAll, parse } from "@namarr/core";
import { localize } from "@namarr/core/i18n";
import { describe, expect, it } from "vitest";
import { AnidbProvider, MemoryCache, type ProviderError, parseTitleDump } from "../src/index.ts";
import { parseXml } from "../src/xml.ts";
import { fakeFetch, gzip } from "./fake-fetch.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/anidb/${name}`, import.meta.url), "utf8");
const API = "GET /httpapi?request=anime&client=namarr&clientver=1&protover=1";

function anidb(extra: Record<string, unknown> = {}, cache = new MemoryCache()) {
  const f = fakeFetch({
    "GET /api/anime-titles.xml.gz": gzip(fixture("anime-titles.xml")),
    [`${API}&aid=17617`]: gzip(fixture("anime-17617.xml")),
    [`${API}&aid=99`]: "<error>No such anime</error>",
    ...extra,
  });
  const provider = new AnidbProvider({
    client: "namarr",
    clientVersion: 1,
    language: "de-DE",
    fetch: f.fetchImpl,
    cache,
    apiUrl: "http://api.test/httpapi",
    titlesUrl: "https://anidb.test/api/anime-titles.xml.gz",
    minTime: 0,
  });
  return { provider, calls: f.calls };
}

describe("XML", () => {
  it("Elemente, Attribute, Entities und CDATA", () => {
    const root = parseXml(`<?xml version="1.0"?><a x="1 &amp; 2"><b>Tom &amp; Jerry&#33;</b><c/><d><![CDATA[<raw>]]></d></a>`);
    const a = root.children[0]!;
    expect(a.attrs.x).toBe("1 & 2");
    expect(a.children.map((c) => [c.name, c.text])).toEqual([
      ["b", "Tom & Jerry!"],
      ["c", ""],
      ["d", "<raw>"],
    ]);
  });

  it("Titelliste", () => {
    expect(parseTitleDump(fixture("anime-titles.xml"))[0]).toMatchObject({ aid: 17617, main: "Sousou no Frieren" });
  });
});

describe("AniDB-Provider", () => {
  it("sucht in der lokalen Titelliste, deutscher Titel zuerst", async () => {
    const { provider, calls } = anidb();
    const [first] = await provider.searchSeries("Frieren");
    expect(first).toMatchObject({
      provider: "anidb",
      id: "17617",
      title: "Frieren - Nach dem Ende der Reise",
      originalTitle: "Sousou no Frieren",
      seasonsAsEntries: true,
    });
    expect(first!.aliases).toContain("Frieren");
    await provider.searchSeries("Cowboy Bebop");
    // The dump is fetched once, not per search
    expect(calls.filter((c) => c.url.includes("anime-titles"))).toHaveLength(1);
  });

  it("die Titelliste kommt beim nächsten Start aus dem Cache", async () => {
    const cache = new MemoryCache();
    await anidb({}, cache).provider.searchSeries("Frieren");
    const second = anidb({}, cache);
    await second.provider.searchSeries("Frieren");
    expect(second.calls).toHaveLength(0);
  });

  it("Episoden: regulär Staffel 1, Specials Staffel 0, Credits fallen weg", async () => {
    const { provider } = anidb();
    expect((await provider.episodes("17617")).map((e) => [e.season, e.episode, e.absolute, e.title])).toEqual([
      [1, 1, 1, "The Journey's End"],
      [1, 2, 2, "Es musste keine Magie sein"],
      [1, 5, 5, "Shisha no Gen'ei"],
      [0, 1, undefined, "Mini Anime 1"],
    ]);
  });

  it("Details, Poster und Folgenzahl; dieselbe Anime-Anfrage nur einmal", async () => {
    const { provider, calls } = anidb();
    expect(await provider.details("series", "17617")).toMatchObject({
      title: "Frieren - Nach dem Ende der Reise",
      year: 2023,
      episodeCount: 28,
      poster: "https://cdn-eu.anidb.net/images/main/279327.jpg",
    });
    await provider.episodes("17617");
    expect(calls.filter((c) => c.url.includes("aid=17617"))).toHaveLength(1);
    expect(calls[0]!.url).toContain("client=namarr&clientver=1&protover=1");
  });

  it("verständliche Fehler: unbekannte ID, Sperre, falscher Client", async () => {
    expect(await anidb().provider.findById("series", { anidb: "99" })).toBeUndefined();
    const banned = anidb({ [`${API}&aid=1`]: '<error code="555">Banned</error>' }).provider;
    const err = await banned.details("series", "1").catch((e: ProviderError) => e);
    expect(localize((err as Error).message, "de")).toBe("AniDB: zu viele Anfragen, vorübergehend gesperrt");
    const client = anidb({ [`${API}&aid=2`]: '<error code="302">client version missing or invalid</error>' }).provider;
    expect(localize(((await client.details("series", "2").catch((e) => e)) as Error).message, "en")).toBe(
      "AniDB: client not registered or wrong version",
    );
  });

  it("Fansub-Datei mit absoluter Nummer und [anidb-…]-ID im Ordner", async () => {
    const { provider } = anidb();
    const file = "/anime/Frieren [anidb-17617]/[SubsPlease] Sousou no Frieren - 02 (1080p) [A1B2C3D4].mkv";
    const result = (await matchAll([{ key: "a", parsed: parse(file) }], provider, { language: "de-DE" })).get("a")!;
    expect(result).toMatchObject({ confidence: 1, episodes: [{ season: 1, episode: 2, title: "Es musste keine Magie sein" }] });
  });

  it("S02-Dateien landen beim Eintrag der zweiten Staffel", async () => {
    const { provider } = anidb({ [`${API}&aid=18290`]: '<anime id="18290"><episodes/></anime>' });
    const result = (await matchAll([{ key: "a", parsed: parse("Frieren.S02E03.1080p.WEB.x264-GRP.mkv") }], provider)).get("a")!;
    expect(result.best?.id).toBe("18290");
  });
});
