import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  buildValues,
  formatPath,
  PRESETS,
  parseTemplate,
  render,
  sanitizePath,
  sanitizeSegment,
  TemplateError,
} from "../src/formatter/index.ts";
import { parse } from "../src/parser/index.ts";
import type { MediaCandidate } from "../src/types.ts";
import { severance, severanceEpisodes } from "./helpers.ts";

describe("Template-Sprache", () => {
  it("Tokens und Text", () => {
    expect(render("{n} ({y})", { n: "Dune", y: 2024 })).toBe("Dune (2024)");
  });

  it("Filter per Pipe", () => {
    expect(render("{t|lower}", { t: "Hallo Welt" })).toBe("hallo welt");
    expect(render("{n|replace:':':' -'}", { n: "Dune: Part Two" })).toBe("Dune - Part Two");
    expect(render("{vf|default:'SD'}", {})).toBe("SD");
    expect(render("{vf|default:'SD'}", { vf: "1080p" })).toBe("1080p");
    expect(render("{e|pad:3}", { e: 7 })).toBe("007");
    expect(render("{n|upper|truncate:4}", { n: "severance" })).toBe("SEVE");
    expect(render("{n|ascii}", { n: "Bärenstark Café" })).toBe("Baerenstark Cafe");
    expect(render("{n|space:'.'}", { n: "a b  c" })).toBe("a.b.c");
  });

  it("bedingte Blöcke", () => {
    const t = "{n}{?edition} [{edition}]{/}";
    expect(render(t, { n: "Das Boot", edition: "Director's Cut" })).toBe("Das Boot [Director's Cut]");
    expect(render(t, { n: "Das Boot" })).toBe("Das Boot");
    expect(render("{!t}Episode {e}{/}{t}", { e: 3 })).toBe("Episode 3");
    expect(render("{?a}{?b}AB{/}A{/}", { a: 1 })).toBe("A");
  });

  it("escaped Klammern für Plex", () => {
    expect(render("\\{edition-{edition}\\}", { edition: "Final Cut" })).toBe("{edition-Final Cut}");
  });

  it("Pfadtrenner in Werten erzeugen keine Ordner", () => {
    expect(render("{n}", { n: "AC/DC" })).toBe("AC-DC");
  });

  it("Fehler mit Position", () => {
    expect(() => parseTemplate("{n")).toThrow(TemplateError);
    expect(() => parseTemplate("{n|nope}")).toThrow(/Unbekannter Filter 'nope'/);
    expect(() => parseTemplate("{?edition} x")).toThrow(/nicht mit '\{\/\}' geschlossen/);
    expect(() => parseTemplate("x{/}")).toThrow(/ohne öffnenden Block/);
    expect(() => parseTemplate("a}b")).toThrow(/Position 2/);
  });

  it("Filter-Argumente mit Doppelpunkt und Pipe in Anführungszeichen", () => {
    expect(render("{n|replace:'a|b':'x:y'}", { n: "1a|b2" })).toBe("1x:y2");
  });
});

describe("formatPath mit Presets", () => {
  const dasBoot: MediaCandidate = { provider: "tmdb", id: "387", kind: "movie", title: "Das Boot", year: 1981 };

  it("Jellyfin-Serie wie im Design", () => {
    const original = "Severance.S02E01.German.DL.1080p.WEB.h264-GRP.mkv";
    const out = formatPath(PRESETS.jellyfin!.episode, {
      parsed: parse(original),
      match: severance,
      episodes: [severanceEpisodes[1]!],
      original,
    });
    expect(out).toBe("Severance (2022)/Season 02/Severance (2022) - S02E01 - Hallo, Frau Cobel.mkv");
  });

  it("Untertitel behalten ihre Sprach-Endung", () => {
    const original = "Severance.S02E01.German.DL.1080p.WEB.h264-GRP.de.srt";
    const out = formatPath(PRESETS.jellyfin!.episode, {
      parsed: parse(original),
      match: severance,
      episodes: [severanceEpisodes[1]!],
      original,
    });
    expect(out.endsWith("S02E01 - Hallo, Frau Cobel.de.srt")).toBe(true);
  });

  it("Doppelfolge mit zwei Titeln", () => {
    const original = "severance.204-205.720p.mkv";
    const out = formatPath(PRESETS.plex!.episode, {
      parsed: parse(original),
      match: severance,
      episodes: [severanceEpisodes[4]!, severanceEpisodes[5]!],
      original,
    });
    expect(out).toBe("Severance (2022)/Season 02/Severance (2022) - S02E04-E05 - Woe's Hollow & Trojan's Horse.mkv");
  });

  it("Film mit Edition (Jellyfin und Plex)", () => {
    const original = "Das.Boot.1981.Directors.Cut.German.DL.1080p.BluRay.mkv";
    const input = { parsed: parse(original), match: dasBoot, original };
    expect(formatPath(PRESETS.jellyfin!.movie, input)).toBe("Das Boot (1981)/Das Boot (1981) [Director's Cut].mkv");
    expect(formatPath(PRESETS.plex!.movie, input)).toBe("Das Boot (1981)/Das Boot (1981) {edition-Director's Cut}.mkv");
  });

  it("Doppelpunkt im Titel wird zu ' - ' (Windows-sicher)", () => {
    const original = "dune.part.two.2024.2160p.mkv";
    const match: MediaCandidate = { provider: "tmdb", id: "693134", kind: "movie", title: "Dune: Part Two", year: 2024 };
    expect(formatPath("{n} ({y})/{n} ({y}) - {vf}", { parsed: parse(original), match, original })).toBe(
      "Dune - Part Two (2024)/Dune - Part Two (2024) - 2160p.mkv",
    );
  });

  it("Kodi nutzt 2x01", () => {
    const original = "Severance.S02E01.mkv";
    const values = buildValues({ parsed: parse(original), match: severance, episodes: [severanceEpisodes[1]!], original });
    expect(values.sxe).toBe("2x01");
  });

  it("Snapshot aller Presets", () => {
    const original = "Severance.S02E01.German.DL.1080p.WEB.h264-GRP.mkv";
    const input = { parsed: parse(original), match: severance, episodes: [severanceEpisodes[1]!], original };
    const out = Object.fromEntries(Object.values(PRESETS).map((p) => [p.id, formatPath(p.episode, input)]));
    expect(out).toMatchSnapshot();
  });
});

describe("Sanitizing", () => {
  it("Windows-verbotene Zeichen und reservierte Namen", () => {
    expect(sanitizeSegment('What? "Now" <1|2>*')).toBe("What 'Now' 12");
    expect(sanitizeSegment("CON")).toBe("CON_");
    expect(sanitizeSegment("name. ")).toBe("name");
    expect(sanitizeSegment("..")).toBe("_");
    expect(sanitizeSegment("")).toBe("_");
  });

  it("posix erlaubt mehr", () => {
    expect(sanitizeSegment("a:b?", { target: "posix" })).toBe("a:b?");
  });

  it("NFC-Normalisierung", () => {
    expect(sanitizeSegment("Amélie")).toBe("Amélie");
  });

  it("Länge in Bytes, Endung bleibt", () => {
    const long = `${"ä".repeat(200)}.mkv`;
    const out = sanitizeSegment(long);
    expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(255);
    expect(out.endsWith(".mkv")).toBe(true);
  });

  it("Pfade: leere Segmente und .. entfallen", () => {
    expect(sanitizePath("a//b/../c")).toBe("a/b/_/c");
  });

  const forbidden = /[<>:"|?*\\/\u0000-\u001f]/;

  it("Property: nie ungültige Segmente", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary", maxLength: 400 }), (input) => {
        const out = sanitizeSegment(input);
        expect(out.length).toBeGreaterThan(0);
        expect(forbidden.test(out)).toBe(false);
        expect(/[. ]$/.test(out)).toBe(false);
        expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(255);
        expect(out).toBe(out.normalize("NFC"));
        expect(out === "." || out === "..").toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  it("Property: idempotent", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary", maxLength: 300 }), (input) => {
        const once = sanitizeSegment(input);
        expect(sanitizeSegment(once)).toBe(once);
      }),
      { numRuns: 500 },
    );
  });

  it("Property: Pfade ohne Ausbruch aus dem Ziel", () => {
    fc.assert(
      fc.property(fc.array(fc.oneof(fc.constant(".."), fc.constant("."), fc.string()), { maxLength: 8 }), (segs) => {
        const out = sanitizePath(segs.join("/"));
        expect(out.startsWith("/")).toBe(false);
        expect(out.split("/").some((s) => s === ".." || s === ".")).toBe(false);
      }),
    );
  });
});
