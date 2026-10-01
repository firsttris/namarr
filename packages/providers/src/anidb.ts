import {
  type EpisodeInfo,
  type ExternalIds,
  type MediaCandidate,
  type MetadataProvider,
  normalizeTitle,
  titleSimilarity,
} from "@namarr/core";
import { tr } from "@namarr/core/i18n";
import type { ProviderCache } from "./cache.ts";
import { textOf as bodyText, lang2, ProviderError, ProviderHttp, yearOf } from "./http.ts";
import { child, childrenOf, parseXml, textOf, type XmlNode } from "./xml.ts";

export type AnidbOptions = {
  /** Client name registered at anidb.net (Settings → Client). */
  client: string;
  clientVersion: string | number;
  language?: string;
  cache?: ProviderCache;
  fetch?: typeof fetch;
  apiUrl?: string;
  titlesUrl?: string;
  /** Milliseconds between requests. AniDB bans clients that ask more than once every two seconds. */
  minTime?: number;
};

/** One anime from the title dump: id, main title and every other title with its language. */
type TitleEntry = { aid: number; main: string; titles: { title: string; lang: string; type: string }[] };

const POSTER_BASE = "https://cdn-eu.anidb.net/images/main/";

/**
 * AniDB: the reference for anime, with absolute numbering and specials. Every season is an
 * entry of its own. There is no search API: namarr keeps the daily title dump and searches
 * that locally. AniDB bans clients that ask too often, so everything is cached for days and
 * requests are spaced out.
 */
export class AnidbProvider implements MetadataProvider {
  readonly name = "anidb";
  private readonly http: ProviderHttp;
  private readonly apiUrl: string;
  private readonly titlesUrl: string;
  private index?: Promise<(TitleEntry & { words: Set<string>; normalized: string[] })[]>;

  constructor(private readonly options: AnidbOptions) {
    this.http = new ProviderHttp(this.name, {
      cache: options.cache,
      fetch: options.fetch,
      minTime: options.minTime ?? 2500,
      maxConcurrent: 1,
    });
    this.apiUrl = options.apiUrl ?? "http://api.anidb.net:9001/httpapi";
    this.titlesUrl = options.titlesUrl ?? "https://anidb.net/api/anime-titles.xml.gz";
  }

  private language(opts?: { language?: string }) {
    return lang2(opts?.language ?? this.options.language);
  }

  /** The title dump, downloaded at most every three days (AniDB allows once a day). */
  private titles() {
    this.index ??= (async () => {
      const entries = await this.http.cached<TitleEntry[]>("titles", 3 * 24 * 3600, async () => {
        const res = await this.http.request(this.titlesUrl);
        if (!res.ok) throw new ProviderError(`AniDB: ${tr("Titelliste", "title list")} HTTP ${res.status}`, res.status);
        return parseTitleDump(await bodyText(res));
      });
      return entries.map((e) => {
        const normalized = [...new Set([e.main, ...e.titles.map((t) => t.title)].map(normalizeTitle))];
        return { ...e, normalized, words: new Set(normalized.flatMap((n) => n.split(" "))) };
      });
    })();
    this.index.catch(() => (this.index = undefined));
    return this.index;
  }

  private async anime(aid: string): Promise<XmlNode | undefined> {
    const params = new URLSearchParams({
      request: "anime",
      client: this.options.client,
      clientver: String(this.options.clientVersion),
      protover: "1",
      aid,
    });
    // AniDB asks not to fetch the same anime more than once a day.
    const xml = await this.http.cached(`anime/${aid}`, 7 * 24 * 3600, async () => {
      const res = await this.http.request(`${this.apiUrl}?${params}`);
      if (!res.ok) throw new ProviderError(`AniDB: HTTP ${res.status}`, res.status);
      const text = await bodyText(res);
      const error = /<error(?:\s+code="(\d+)")?>([^<]*)<\/error>/i.exec(text);
      if (error) {
        if (/no such anime/i.test(error[2]!)) return undefined;
        if (/banned/i.test(error[2]!))
          throw new ProviderError(tr("AniDB: zu viele Anfragen, vorübergehend gesperrt", "AniDB: too many requests, banned for now"));
        if (/client/i.test(error[2]!))
          throw new ProviderError(
            tr("AniDB: Client nicht registriert oder Version falsch", "AniDB: client not registered or wrong version"),
          );
        throw new ProviderError(`AniDB: ${error[2]}`);
      }
      return text;
    });
    return xml === undefined ? undefined : child(parseXml(xml), "anime");
  }

  private titleIn(titles: { title: string; lang: string; type: string }[], main: string, lang: string): string {
    const official = (l: string) => titles.find((t) => t.lang === l && (t.type === "official" || t.type === "main"))?.title;
    return official(lang) ?? official("en") ?? main;
  }

  async searchMovie(): Promise<MediaCandidate[]> {
    return [];
  }

  async searchSeries(query: string, opts?: { language?: string }) {
    const lang = this.language(opts);
    const q = normalizeTitle(query);
    const qWords = q.split(" ").filter(Boolean);
    const scored: { entry: TitleEntry; score: number }[] = [];
    for (const entry of await this.titles()) {
      if (!qWords.some((w) => entry.words.has(w))) continue;
      const score = Math.max(...entry.normalized.map((n) => titleSimilarity(q, n)));
      if (score >= 0.6) scored.push({ entry, score });
    }
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(({ entry }) => {
        const title = this.titleIn(entry.titles, entry.main, lang);
        return {
          provider: this.name,
          id: String(entry.aid),
          kind: "series" as const,
          title,
          originalTitle: title !== entry.main ? entry.main : undefined,
          aliases: entry.titles.map((t) => t.title).filter((t) => t !== title && t !== entry.main),
          seasonsAsEntries: true,
        };
      });
  }

  async details(kind: "movie" | "series", id: string, opts?: { language?: string }) {
    const found = kind === "series" ? await this.candidate(id, this.language(opts)) : undefined;
    if (!found) throw new ProviderError(tr(`AniDB: ID ${id} nicht gefunden`, `AniDB: ID ${id} not found`), 404);
    return found;
  }

  async findById(kind: "movie" | "series", ids: ExternalIds, opts?: { language?: string }) {
    return kind === "series" && ids.anidb ? this.candidate(ids.anidb, this.language(opts)) : undefined;
  }

  private async candidate(aid: string, lang: string): Promise<MediaCandidate | undefined> {
    const anime = await this.anime(aid);
    if (!anime) return undefined;
    const titles = childrenOf(child(anime, "titles"), "title").map((t) => ({
      title: t.text.trim(),
      lang: t.attrs["xml:lang"] ?? "",
      type: t.attrs.type ?? "",
    }));
    const main = titles.find((t) => t.type === "main")?.title ?? titles[0]?.title ?? aid;
    const title = this.titleIn(titles, main, lang);
    const picture = textOf(child(anime, "picture"));
    const count = Number(textOf(child(anime, "episodecount")));
    return {
      provider: this.name,
      id: aid,
      kind: "series",
      title,
      originalTitle: title !== main ? main : undefined,
      aliases: titles.map((t) => t.title).filter((t) => t !== title && t !== main),
      year: yearOf(textOf(child(anime, "startdate"))),
      poster: picture ? POSTER_BASE + picture : undefined,
      episodeCount: count > 0 ? count : undefined,
      seasonsAsEntries: true,
    };
  }

  /** Regular episodes are season 1 (and absolute), specials season 0. */
  async episodes(seriesId: string, opts?: { season?: number; language?: string }): Promise<EpisodeInfo[]> {
    const anime = await this.anime(seriesId);
    const lang = this.language(opts);
    const out: EpisodeInfo[] = [];
    for (const ep of childrenOf(child(anime, "episodes"), "episode")) {
      const epno = child(ep, "epno");
      const type = epno?.attrs.type;
      const n = Number(/\d+/.exec(epno?.text ?? "")?.[0]);
      if (!n || (type !== "1" && type !== "2")) continue; // credits, trailers, parodies
      const titles = childrenOf(ep, "title");
      const title = [lang, "en", "x-jat", "ja"].map((l) => titles.find((t) => t.attrs["xml:lang"] === l)?.text.trim()).find(Boolean);
      out.push({
        season: type === "1" ? 1 : 0,
        episode: n,
        absolute: type === "1" ? n : undefined,
        title,
        airDate: textOf(child(ep, "airdate")),
      });
    }
    out.sort((a, b) => b.season - a.season || a.episode - b.episode);
    return opts?.season === undefined ? out : out.filter((e) => e.season === opts.season);
  }
}

/** `<animetitles><anime aid="1"><title xml:lang="x-jat" type="main">…</title>…</anime>…` */
export function parseTitleDump(xml: string): TitleEntry[] {
  return childrenOf(child(parseXml(xml), "animetitles"), "anime").map((a) => {
    const titles = childrenOf(a, "title").map((t) => ({ title: t.text.trim(), lang: t.attrs["xml:lang"] ?? "", type: t.attrs.type ?? "" }));
    return { aid: Number(a.attrs.aid), main: titles.find((t) => t.type === "main")?.title ?? titles[0]?.title ?? "", titles };
  });
}
