import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { sanitizeSegment } from "../src/formatter/index.ts";
import { applyRules, describeRule, previewRules, type Rule, RuleError } from "../src/rules/index.ts";
import { text } from "./text.ts";

const one = (path: string, rules: Rule[], extra: { mtime?: Date } = {}) => applyRules([{ path, ...extra }], rules)[0];

describe("Regel-Engine", () => {
  it("Ersetzen: Text, alle Vorkommen, ohne Regex-Sonderzeichen", () => {
    expect(one("a.b.c.txt", [{ type: "replace", find: ".", replace: " " }])).toBe("a b c.txt");
    expect(one("Foo foo.txt", [{ type: "replace", find: "foo", replace: "bar" }])).toBe("bar bar.txt");
    expect(one("Foo foo.txt", [{ type: "replace", find: "foo", replace: "bar", caseSensitive: true }])).toBe("Foo bar.txt");
    expect(one("$1.txt", [{ type: "replace", find: "$1", replace: "$2" }])).toBe("$2.txt");
  });

  it("Ersetzen: Regex mit Gruppen", () => {
    const rule: Rule = { type: "replace", find: "IMG_(\\d{4})(\\d{2})(\\d{2})", replace: "$1-$2-$3", regex: true };
    expect(one("IMG_20260928.jpg", [rule])).toBe("2026-09-28.jpg");
  });

  it("ungültige Regex meldet die Regel", () => {
    expect(() =>
      one("a.txt", [
        { type: "case", mode: "lower" },
        { type: "replace", find: "(", replace: "", regex: true },
      ]),
    ).toThrow(RuleError);
    try {
      one("a.txt", [
        { type: "case", mode: "lower" },
        { type: "replace", find: "(", replace: "", regex: true },
      ]);
    } catch (e) {
      expect((e as RuleError).ruleIndex).toBe(1);
    }
  });

  it("Einfügen am Anfang, Ende und an Position", () => {
    expect(one("name.txt", [{ type: "insert", text: "pre_", position: "start" }])).toBe("pre_name.txt");
    expect(one("name.txt", [{ type: "insert", text: "_post", position: "end" }])).toBe("name_post.txt");
    expect(one("name.txt", [{ type: "insert", text: "-", position: 2 }])).toBe("na-me.txt");
  });

  it("Löschen von vorne und hinten", () => {
    expect(one("0123456.txt", [{ type: "remove", from: 0, count: 2 }])).toBe("23456.txt");
    expect(one("0123456.txt", [{ type: "remove", from: 0, count: 2, fromEnd: true }])).toBe("01234.txt");
  });

  it("Schreibweise", () => {
    expect(one("hello WORLD.txt", [{ type: "case", mode: "title" }])).toBe("Hello World.txt");
    expect(one("hello WORLD.txt", [{ type: "case", mode: "upper" }])).toBe("HELLO WORLD.txt");
    expect(one("hello WORLD.txt", [{ type: "case", mode: "sentence" }])).toBe("Hello world.txt");
  });

  it("Trenner normalisieren", () => {
    expect(one("a__b..c - d.txt", [{ type: "separators", separator: " " }])).toBe("a b c d.txt");
    expect(one(" a b .txt", [{ type: "separators", separator: "." }])).toBe("a.b.txt");
  });

  it("Nummerierung mit Start, Schritt, Padding und Namenssortierung", () => {
    const entries = ["c.jpg", "a.jpg", "b10.jpg", "b2.jpg"].map((path) => ({ path }));
    expect(applyRules(entries, [{ type: "numbering", start: 1, step: 1, padding: 3 }])).toEqual([
      "001 - c.jpg",
      "002 - a.jpg",
      "003 - b10.jpg",
      "004 - b2.jpg",
    ]);
    expect(applyRules(entries, [{ type: "numbering", start: 10, step: 10, sort: "name", position: "end", separator: "_" }])).toEqual([
      "c_40.jpg",
      "a_10.jpg",
      "b10_30.jpg",
      "b2_20.jpg",
    ]);
  });

  it("Datum aus der Datei", () => {
    const mtime = new Date(2026, 8, 28, 14, 5, 0);
    expect(one("Urlaub.jpg", [{ type: "date", format: "YYYY-MM-DD" }], { mtime })).toBe("2026-09-28 Urlaub.jpg");
    expect(one("Urlaub.jpg", [{ type: "date", format: "HHmm", position: "end", separator: "_" }], { mtime })).toBe("Urlaub_1405.jpg");
    expect(one("Urlaub.jpg", [{ type: "date" }])).toBe("Urlaub.jpg");
  });

  it("Erweiterung ändern", () => {
    expect(one("a.JPEG", [{ type: "extension", to: "jpg" }])).toBe("a.jpg");
    expect(one("a.JPG", [{ type: "extension", case: "lower" }])).toBe("a.jpg");
    expect(one("noext", [{ type: "extension", to: ".txt" }])).toBe("noext.txt");
  });

  it("Transliteration", () => {
    expect(one("Größe Übel.txt", [{ type: "transliterate" }])).toBe("Groesse Uebel.txt");
    expect(one("Café.txt", [{ type: "transliterate" }])).toBe("Cafe.txt");
    expect(one("Café ä.txt", [{ type: "transliterate", stripDiacritics: false }])).toBe("Café ae.txt");
  });

  it("Rest nach Muster abschneiden", () => {
    expect(one("Movie.2010.1080p.BluRay.mkv", [{ type: "cutAfter", pattern: ".1080p" }])).toBe("Movie.2010.mkv");
    expect(one("Movie [x264].mkv", [{ type: "cutAfter", pattern: "\\s*\\[", regex: true }])).toBe("Movie.mkv");
  });

  it("Ziel: Name, Erweiterung oder voller Pfad", () => {
    expect(one("dir.x/a.b.txt", [{ type: "replace", find: ".", replace: "_" }])).toBe("dir.x/a_b.txt");
    expect(one("dir/a.txt", [{ type: "case", mode: "upper", target: "extension" }])).toBe("dir/a.TXT");
    expect(one("dir/a.txt", [{ type: "replace", find: "dir", replace: "other", target: "full" }])).toBe("other/a.txt");
  });

  it("deaktivierte Regeln wirken nicht, Vorschau pro Regel", () => {
    const rules: Rule[] = [
      { type: "transliterate", enabled: false },
      { type: "replace", find: ":", replace: " -" },
    ];
    const steps = previewRules([{ path: "Fünf: Zwei.mkv" }], rules);
    expect(steps).toEqual([["Fünf: Zwei.mkv"], ["Fünf: Zwei.mkv"], ["Fünf - Zwei.mkv"]]);
  });

  it("Zahlen auffüllen: kürzere Zahlen auf die Stellenzahl, längere bleiben", () => {
    expect(one("Folge 5 von 12.mkv", [{ type: "pad", digits: 2 }])).toBe("Folge 05 von 12.mkv");
    expect(one("S1E5 (2024).mkv", [{ type: "pad", digits: 3 }])).toBe("S001E005 (2024).mkv");
  });

  it("Aufräumen: Klammern, Punkte, Leerzeichen", () => {
    const cleanup: Rule = { type: "cleanup" };
    expect(one("Song Title [Official Video] (HD)  .mp3", [cleanup])).toBe("Song Title.mp3");
    expect(one("my.holiday_photo  {copy}.jpg", [{ type: "cleanup", separators: true }])).toBe("my holiday photo.jpg");
    expect(one("Keep (this).txt", [{ type: "cleanup", brackets: false }])).toBe("Keep (this).txt");
  });

  it("Zeichen entfernen: Ziffern, Sonderzeichen, eigene Auswahl", () => {
    expect(one("Track 01 - Intro!.mp3", [{ type: "strip", digits: true }])).toBe("Track  - Intro!.mp3");
    expect(one("Größe & Gewicht #2!.txt", [{ type: "strip", symbols: true }])).toBe("Größe  Gewicht 2.txt");
    expect(one("a-b_c]d.txt", [{ type: "strip", chars: "-]" }])).toBe("ab_cd.txt");
  });

  it("Umsortieren an einem Trennzeichen", () => {
    const rule: Rule = { type: "rearrange", delimiter: " - ", pattern: "$2 - $1" };
    expect(one("Bohemian Rhapsody - Queen.mp3", [rule])).toBe("Queen - Bohemian Rhapsody.mp3");
    expect(one("Nur ein Teil.mp3", [rule])).toBe(" - Nur ein Teil.mp3");
    expect(one("a_b_c.txt", [{ type: "rearrange", delimiter: "_", pattern: "$3$2$1 ($0)" }])).toBe("cba (a_b_c).txt");
  });

  it("Namensliste: Zeile für Zeile, in Listen- oder Namensreihenfolge; danach bleibt alles", () => {
    const files = [{ path: "b.jpg" }, { path: "a.jpg" }, { path: "c.jpg" }];
    expect(applyRules(files, [{ type: "list", names: ["Eins", " Zwei ", ""] }])).toEqual(["Eins.jpg", "Zwei.jpg", "c.jpg"]);
    expect(applyRules(files, [{ type: "list", names: ["Eins", "Zwei", "Drei"], sort: "name" }])).toEqual([
      "Zwei.jpg",
      "Eins.jpg",
      "Drei.jpg",
    ]);
  });

  it("Aus der Datei: Aufnahmedatum und Musik-Tags; fehlt ein Wert, bleibt der Name", () => {
    const photo = { path: "IMG_1234.JPG", meta: { taken: new Date(2024, 6, 14, 18, 3, 22), tags: {} } };
    const date: Rule = { type: "metadata", template: "{date:YYYY-MM-DD HH-mm-ss}" };
    expect(applyRules([photo], [date])).toEqual(["2024-07-14 18-03-22.JPG"]);
    expect(applyRules([photo], [{ ...date, template: "{date}", position: "start", separator: "_" }])).toEqual(["2024-07-14_IMG_1234.JPG"]);

    const song = {
      path: "track03.mp3",
      meta: {
        tags: {
          artist: "Queen",
          album_artist: "Queen",
          title: "Bohemian Rhapsody",
          album: "A Night at the Opera",
          track: "11/12",
          date: "1975-11-21",
        },
      },
    };
    // Folders in the template land below the file's folder
    const music: Rule = { type: "metadata", template: "{albumartist}/{year} - {album}/{track} {artist} - {title}" };
    expect(applyRules([{ ...song, path: "/music/in/track03.mp3" }], [music])).toEqual([
      "/music/in/Queen/1975 - A Night at the Opera/11 Queen - Bohemian Rhapsody.mp3",
    ]);
    expect(applyRules([song], [{ type: "metadata", template: "{track:3} {title}" }])).toEqual(["011 Bohemian Rhapsody.mp3"]);
    // Tags cannot create folders or climb out: "AC/DC" stays one name, ".." becomes harmless
    const tricky = { path: "/m/x.mp3", meta: { tags: { artist: "AC/DC", album: "..", title: "T.N.T." } } };
    expect(applyRules([tricky], [{ type: "metadata", template: "{artist}/{album}/{title}" }])).toEqual(["/m/AC-DC/_/T.N.T..mp3"]);
    // No EXIF, no tags: unchanged instead of a half-empty name
    expect(applyRules([{ path: "scan.jpg", meta: { tags: {} } }], [date])).toEqual(["scan.jpg"]);
    expect(applyRules([{ path: "x.mp3" }], [{ type: "metadata", template: "{artist} - {title}" }])).toEqual(["x.mp3"]);
  });

  it("Beschriftungen für den Regel-Stack", () => {
    expect(text(describeRule({ type: "transliterate" }), "de")).toBe("Umlaute ersetzen ä → ae");
    expect(text(describeRule({ type: "transliterate" }), "en")).toBe("Transliterate ä → ae");
    expect(text(describeRule({ type: "replace", find: ":", replace: " -" }), "de")).toBe('Ersetzen : → " -"');
  });
});

const ruleArb: fc.Arbitrary<Rule> = fc.oneof(
  fc.record({ type: fc.constant("replace" as const), find: fc.string({ maxLength: 3 }), replace: fc.string({ maxLength: 5 }) }),
  fc.record({
    type: fc.constant("insert" as const),
    text: fc.string({ maxLength: 5 }),
    position: fc.oneof(fc.constant("start" as const), fc.constant("end" as const), fc.nat(10)),
  }),
  fc.record({ type: fc.constant("remove" as const), from: fc.nat(10), count: fc.nat(10) }),
  fc.record({
    type: fc.constant("case" as const),
    mode: fc.constantFrom("title" as const, "lower" as const, "upper" as const, "sentence" as const),
  }),
  fc.record({ type: fc.constant("separators" as const), separator: fc.constantFrom(" ", ".", "_", "-") }),
  fc.record({ type: fc.constant("numbering" as const), start: fc.nat(100), padding: fc.nat(4) }),
  fc.record({ type: fc.constant("transliterate" as const) }),
  fc.record({ type: fc.constant("pad" as const), digits: fc.integer({ min: 1, max: 10 }) }),
  fc.record({ type: fc.constant("cleanup" as const), brackets: fc.boolean(), separators: fc.boolean(), spaces: fc.boolean() }),
  fc.record({ type: fc.constant("strip" as const), digits: fc.boolean(), symbols: fc.boolean(), chars: fc.string({ maxLength: 3 }) }),
  fc.record({
    type: fc.constant("rearrange" as const),
    delimiter: fc.constantFrom(" - ", "_", ""),
    pattern: fc.constantFrom("$2 - $1", "$1", "$0"),
  }),
  fc.record({ type: fc.constant("list" as const), names: fc.array(fc.string({ maxLength: 8 }), { maxLength: 3 }) }),
);

describe("Regel-Engine: Property-Tests", () => {
  it("nach dem Sanitizing ist jeder Name gültig", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ maxLength: 30 }), { minLength: 1, maxLength: 5 }),
        fc.array(ruleArb, { maxLength: 6 }),
        (names, rules) => {
          const out = applyRules(
            names.map((n) => ({ path: `${n || "x"}.mkv` })),
            rules,
          );
          expect(out).toHaveLength(names.length);
          for (const name of out) {
            const safe = sanitizeSegment(name.split("/").at(-1) ?? "");
            expect(safe.length).toBeGreaterThan(0);
            expect(/[<>:"|?*\\/]/.test(safe)).toBe(false);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("Regeln mit Name-Ziel verändern nie die Erweiterung", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z0-9 ]{1,20}$/), fc.array(ruleArb, { maxLength: 6 }), (stem, rules) => {
        const out = applyRules([{ path: `${stem}.mkv` }], rules)[0]!;
        expect(out.endsWith(".mkv")).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it("ohne aktive Regeln bleibt alles gleich", () => {
    fc.assert(
      fc.property(fc.string(), fc.array(ruleArb, { maxLength: 4 }), (name, rules) => {
        const off = rules.map((r) => ({ ...r, enabled: false }));
        expect(applyRules([{ path: name }], off)).toEqual([name]);
      }),
    );
  });
});
