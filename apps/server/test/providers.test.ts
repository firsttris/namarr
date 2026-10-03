import { createProfile, DEFAULT_SETTINGS, openDatabase, type Settings, setSettings } from "@namarr/db";
import { DemoProvider, MemoryCache, RoutedProvider, TmdbProvider } from "@namarr/providers";
import { describe, expect, it, vi } from "vitest";
import { localizeIn } from "~/lib/i18n";
import { automaticConfig } from "~/server/automation.server";
import { EventBus } from "~/server/events.server";
import { JobService } from "~/server/jobs.server";
import { providerFactory } from "~/server/providers.server";

const settings = (extra: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, ...extra });

describe("Anbieter je nach Einstellung", () => {
  it("ohne Zugang gibt es keinen Anbieter, außer im Demo-Modus", () => {
    expect(providerFactory(new MemoryCache(), false)(settings({}))).toBeUndefined();
    expect(providerFactory(new MemoryCache(), true)(settings({}))).toBeInstanceOf(DemoProvider);
  });

  it("ein Client pro Quelle und Zugang, auch über mehrere Jobs", () => {
    const provider = providerFactory(new MemoryCache(), false);
    const a = provider(settings({ tmdbApiKey: "k" }));
    expect(a).toBeInstanceOf(TmdbProvider);
    expect(provider(settings({ tmdbApiKey: "k" }))).toBe(a);
    expect(provider(settings({ tmdbApiKey: "other" }))).not.toBe(a);
  });

  it("Serien von TheTVDB, Filme von TMDB", () => {
    const p = providerFactory(new MemoryCache(), false)(settings({ tmdbApiKey: "k", tvdbApiKey: "t", seriesProvider: "tvdb" }));
    expect(p).toBeInstanceOf(RoutedProvider);
    expect([p!.nameFor!("series"), p!.nameFor!("movie")]).toEqual(["tvdb", "tmdb"]);
  });

  it("TVmaze geht ohne Key; Filme sagen dann, was fehlt", async () => {
    const p = providerFactory(new MemoryCache(), false)(settings({ seriesProvider: "tvmaze" }))!;
    expect(p.nameFor!("series")).toBe("tvmaze");
    const err = await p.searchMovie("Dune").catch((e: Error) => e);
    expect(localizeIn((err as Error).message, "de")).toBe("TMDB: API-Key in den Einstellungen hinterlegen");
  });

  it("der Job (oder sein Profil) wählt die Serien-Quelle", async () => {
    const provider = providerFactory(new MemoryCache(), false);
    const s = settings({ tmdbApiKey: "k", tvdbApiKey: "t" });
    expect(provider(s, { series: "tvdb" })!.nameFor!("series")).toBe("tvdb");
    const anidb = provider(s, { series: "anidb" })!;
    const err = await anidb.searchSeries("Frieren").catch((e: Error) => e);
    expect(localizeIn((err as Error).message, "en")).toBe("AniDB: add a registered client in the settings");
    expect(provider(settings({ anidbClient: "namarr", tmdbApiKey: "k" }), { series: "anidb" })!.nameFor!("series")).toBe("anidb");
  });

  it("JobService fragt mit der Quelle des Jobs; Profile geben sie an Watch-Jobs weiter", async () => {
    const db = openDatabase(":memory:");
    setSettings(db, { roots: ["/"] });
    const factory = vi.fn(() => new DemoProvider());
    const jobs = new JobService({ db, bus: new EventBus(), provider: factory, log: { info: () => {}, error: () => {} } });
    const profile = createProfile(db, { name: "Anime", provider: "anidb" });
    const config = automaticConfig(profile, { targetRoot: "/media", autoThreshold: 0.9 });
    expect(config.provider).toBe("anidb");
    await jobs.create({ paths: [import.meta.dirname], config: { ...config, action: "test" } });
    await jobs.idle();
    expect(factory).toHaveBeenCalledWith(expect.anything(), { series: "anidb" });
  });
});
