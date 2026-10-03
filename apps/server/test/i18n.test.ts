import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { msg } from "@namarr/core/i18n";
import { describe, expect, it } from "vitest";
import { localizeIn } from "~/lib/i18n";
import { uiLangFrom } from "~/server/lang.server";

const read = (lang: string) =>
  JSON.parse(readFileSync(new URL(`../messages/${lang}.json`, import.meta.url), "utf8")) as Record<string, unknown>;
const de = read("de");
const en = read("en");
const keys = Object.keys(en).filter((k) => k !== "$schema");

/** Placeholders a message uses, over all variants; escaped braces are text. */
const placeholders = (v: unknown) => [...new Set([...JSON.stringify(v).matchAll(/(?<!\\\\)\{(\w+)\}/g)].map((m) => m[1]))].sort().join(",");

/** The text of every variant. */
const variants = (v: unknown): string[] =>
  typeof v === "string" ? [v] : (v as { match: Record<string, string> }[]).flatMap((x) => Object.values(x.match));

const here = new URL("..", import.meta.url).pathname;
const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return e.name === "paraglide" || e.name === "node_modules" ? [] : sources(join(dir, e.name));
    return /\.tsx?$/.test(e.name) ? [readFileSync(join(dir, e.name), "utf8")] : [];
  });

describe("messages/*.json", () => {
  it("beide Sprachen haben dieselben Schlüssel und Platzhalter, kein Text ist leer", () => {
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
    expect(keys.filter((k) => placeholders(de[k]) !== placeholders(en[k]))).toEqual([]);
    expect(keys.filter((k) => [...variants(de[k]), ...variants(en[k])].some((t) => !t.trim()))).toEqual([]);
  });

  it("im Englischen steht kein Deutsch", () => {
    // "ä → ae" names what the transliterate rule does
    const german = keys.filter(
      (k) =>
        k !== "rules_describe_transliterate" && variants(en[k]).some((t) => /[äöüÄÖÜß]|\b(und|oder|nicht|Datei|Dateien|wählen)\b/.test(t)),
    );
    expect(german).toEqual([]);
  });

  it("jede Meldung wird verwendet, jeder verwendete Schlüssel existiert", () => {
    const ui = sources(join(here, "src"));
    const server = ["src", "../../packages/core/src", "../../packages/providers/src", "../../packages/db/src"]
      .map((d) => join(here, d))
      .flatMap(sources);
    // m.key only counts in files that import the Paraglide messages as m
    const mCode = ui.filter((s) => s.includes('from "~/paraglide/messages"')).join("\n");
    const viaM = [...mCode.matchAll(/\bm\.(\w+)\b/g)].map((x) => x[1]!);
    const viaMsg = [...server.join("\n").matchAll(/\bmsg\(\s*"(\w+)"/g)].map((x) => x[1]!);
    const used = new Set([...viaM, ...viaMsg]);
    expect(keys.filter((k) => !used.has(k))).toEqual([]);
    expect([...used].filter((k) => !(k in en))).toEqual([]);
  });
});

describe("Server-Texte", () => {
  it("kommen in der Sprache des Betrachters, auch verschachtelt und neben altem Format", () => {
    const reason = `${msg("fileops_conflict_existingBetter")} (${msg("quality_resolution")}: 720p vs 1080p)`;
    expect(localizeIn(reason, "de")).toBe("Vorhandene Datei ist besser (Auflösung: 720p vs 1080p)");
    expect(localizeIn(reason, "en")).toBe("Existing file is better (Resolution: 720p vs 1080p)");
    expect(localizeIn(msg("rules_describe_strip", { parts: msg("rules_describe_digits") }), "en")).toBe("Strip: digits");
    expect(localizeIn("\u0002Doppelfolge\u001fDouble episode\u0003", "en")).toBe("Double episode");
    expect(localizeIn(msg("no_such_key"), "en")).toBe("no_such_key");
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
