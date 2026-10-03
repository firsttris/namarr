import { describe, expect, it } from "vitest";
import { langOf, localize, msg } from "../src/i18n.ts";
import { text } from "./text.ts";

const render = (key: string, inputs: Record<string, string | number>, lang: string) =>
  `${lang}:${key}${Object.keys(inputs).length ? JSON.stringify(inputs) : ""}`;

describe("Server-Texte als Schlüssel", () => {
  it("rendert Schlüssel in der Sprache des Betrachters, auch eingebettet in anderen Text", () => {
    const value = `${msg("matcher_reason_doubleEpisode")} · ${msg("matcher_reason_noYear")}`;
    expect(text(value, "de")).toBe("Doppelfolge · Kein Jahr erkannt");
    expect(text(value, "en")).toBe("Double episode · No year found");
  });

  it("Eingaben dürfen selbst Meldungen sein", () => {
    const value = msg("rules_describe_strip", { parts: msg("rules_describe_digits") });
    expect(text(value, "de")).toBe("Entfernen: Ziffern");
    expect(localize(value, "en", render)).toBe('en:rules_describe_strip{"parts":"en:rules_describe_digits"}');
  });

  it("verträgt Pfade mit Doppelpunkten und Klammern in den Eingaben", () => {
    const value = msg("fileops_error_targetExistsAt", { path: "/data/a: b {x}.mkv" });
    expect(text(value, "en")).toBe("Target already exists: /data/a: b {x}.mkv");
  });

  it("liest Einträge früherer Versionen (beide Texte nebeneinander)", () => {
    expect(localize("\u0002Doppelfolge\u001fDouble episode\u0003 · x", "en", render)).toBe("Double episode · x");
    expect(localize("\u0002Doppelfolge\u001fDouble episode\u0003", "de", render)).toBe("Doppelfolge");
  });

  it("lässt einfachen Text und null stehen", () => {
    expect(localize("TMDB: HTTP 500", "en", render)).toBe("TMDB: HTTP 500");
    expect(localize(null, "en", render)).toBeNull();
    expect(localize(undefined, "de", render)).toBeNull();
  });

  it("Sprache aus Locale", () => {
    expect(langOf("de-DE")).toBe("de");
    expect(langOf("de-AT,de;q=0.9")).toBe("de");
    expect(langOf("en-US")).toBe("en");
    expect(langOf("fr-FR")).toBe("en");
    expect(langOf(undefined)).toBe("en");
  });
});
