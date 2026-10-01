import { describe, expect, it } from "vitest";
import { messages } from "~/lib/messages";
import { uiLangFrom } from "~/server/lang.server";

type Tree = { [k: string]: unknown };

/** Every text of a language; functions are called with sample arguments. */
function texts(tree: Tree, path = ""): [string, string][] {
  return Object.entries(tree).flatMap(([key, value]): [string, string][] => {
    const at = path ? `${path}.${key}` : key;
    if (typeof value === "string") return [[at, value]];
    if (typeof value === "function") {
      const args = Array.from({ length: value.length }, (_, i) => (i === 0 ? "3" : 3));
      return [[at, String((value as (...a: unknown[]) => unknown)(...args))]];
    }
    if (value && typeof value === "object") return texts(value as Tree, at);
    return [];
  });
}

describe("Wörterbuch", () => {
  const de = new Map(texts(messages.de as unknown as Tree));
  const en = new Map(texts(messages.en as unknown as Tree));

  it("beide Sprachen haben dieselben Schlüssel", () => {
    expect([...en.keys()].sort()).toEqual([...de.keys()].sort());
  });

  it("im Englischen steht kein Deutsch", () => {
    const german = [...en].filter(([, v]) => /[äöüÄÖÜß]|\b(und|oder|nicht|Datei|Dateien|wählen)\b/.test(v));
    expect(german).toEqual([]);
  });

  it("kein Text ist leer", () => {
    expect([...de, ...en].filter(([, v]) => !v.trim())).toEqual([]);
  });
});

describe("Sprache der ersten Darstellung", () => {
  const h = (init: Record<string, string>) => new Headers(init);

  it("gespeicherte Wahl gewinnt", () => {
    expect(uiLangFrom(h({ cookie: "a=1; namarr_lang=en", "accept-language": "de-DE" }))).toBe("en");
    expect(uiLangFrom(h({ cookie: "namarr_lang=de; b=2", "accept-language": "en-US" }))).toBe("de");
  });

  it("sonst die Browsersprache, Englisch als Rückfall", () => {
    expect(uiLangFrom(h({ "accept-language": "de-DE,de;q=0.9,en;q=0.8" }))).toBe("de");
    expect(uiLangFrom(h({ "accept-language": "fr-FR,fr;q=0.9" }))).toBe("en");
    expect(uiLangFrom(h({}))).toBe("en");
  });

  it("ungültige Werte im Cookie werden ignoriert", () => {
    expect(uiLangFrom(h({ cookie: "namarr_lang=xx", "accept-language": "de" }))).toBe("de");
    expect(uiLangFrom(h({ cookie: "namarr_language=en", "accept-language": "de" }))).toBe("de");
  });
});
