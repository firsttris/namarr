import { describe, expect, it } from "vitest";
import { langOf, localize, tr } from "../src/i18n.ts";

describe("Zweisprachige Server-Texte", () => {
  it("wählt die Sprache, auch eingebettet in anderen Text", () => {
    const text = `${tr("Doppelfolge", "Double episode")} · ${tr("Kein Jahr erkannt", "No year found")}`;
    expect(localize(text, "de")).toBe("Doppelfolge · Kein Jahr erkannt");
    expect(localize(text, "en")).toBe("Double episode · No year found");
  });

  it("lässt einfachen Text und null stehen", () => {
    expect(localize("TMDB: HTTP 500", "en")).toBe("TMDB: HTTP 500");
    expect(localize(null, "en")).toBeNull();
    expect(localize(undefined, "de")).toBeNull();
  });

  it("verträgt Texte mit Doppelpunkten und Pfaden", () => {
    const t = tr("Ziel existiert bereits: /data/a: b.mkv", "Target already exists: /data/a: b.mkv");
    expect(localize(t, "en")).toBe("Target already exists: /data/a: b.mkv");
  });

  it("Sprache aus Locale", () => {
    expect(langOf("de-DE")).toBe("de");
    expect(langOf("de-AT,de;q=0.9")).toBe("de");
    expect(langOf("en-US")).toBe("en");
    expect(langOf("fr-FR")).toBe("en");
    expect(langOf(undefined)).toBe("en");
  });
});
