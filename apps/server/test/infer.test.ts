import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { type Db, openDatabase, setSettings } from "@namarr/db";
import { DemoProvider } from "@namarr/providers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { libraryFormat, sampleFiles } from "~/server/infer.server";
import type { Runtime } from "~/server/runtime.server";

let tmp: string;
let db: Db;
const rt = (offline = false) => ({ db, provider: () => (offline ? undefined : new DemoProvider()) }) as unknown as Runtime;

async function touch(rel: string) {
  const full = path.join(tmp, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, "x");
  return full;
}

beforeEach(async () => {
  tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "namarr-infer-")));
  db = openDatabase(":memory:");
  setSettings(db, {
    folders: [
      { path: tmp, name: "data", kind: "folder" },
      { path: path.join(tmp, "tv"), name: "tv", kind: "series", default: true },
      { path: path.join(tmp, "movies"), name: "movies", kind: "movies", default: true },
    ],
  });
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("Format einer bestehenden Mediathek", () => {
  it("eigenes Serien-Format, geprüft an weiteren Serien der Mediathek", async () => {
    const chosen = await touch("tv/Severance/Staffel 02/Severance - S02E01 - Hallo, Frau Cobel.mkv");
    await touch("tv/Severance/Staffel 02/Severance - S02E04 - Woe's Hollow.mkv");
    await touch("tv/Dark/Staffel 01/Dark - S01E02 - Lügen.mkv");
    await touch("tv/Dark/Staffel 01/notes.txt");
    const result = await libraryFormat(rt(), chosen);
    expect(result).toMatchObject({
      kind: "series",
      root: path.join(tmp, "tv"),
      template: "{n}/Staffel {s00}/{n} - {s00e00}{?t} - {t}{/}",
      presets: [],
      matched: 3,
      offline: false,
    });
    expect(result.checks.map((c) => c.path)).toEqual([
      "Severance/Staffel 02/Severance - S02E01 - Hallo, Frau Cobel.mkv",
      "Dark/Staffel 01/Dark - S01E02 - Lügen.mkv",
      "Severance/Staffel 02/Severance - S02E04 - Woe's Hollow.mkv",
    ]);
  });

  it("Filme ohne Edition: jedes eingebaute Format passt, auch mit Doppelpunkt im Titel", async () => {
    const chosen = await touch("movies/The Matrix (1999)/The Matrix (1999).mkv");
    await touch("movies/Dune - Part Two (2024)/Dune - Part Two (2024).mkv");
    const result = await libraryFormat(rt(), chosen);
    expect(result).toMatchObject({ kind: "movie", matched: 2, presets: ["plex", "jellyfin", "emby", "kodi"] });
  });

  it("ohne Metadaten-Quelle: was der Name hergibt", async () => {
    const chosen = await touch("tv/Severance (2022)/Season 02/Severance (2022) - S02E01.mkv");
    const result = await libraryFormat(rt(true), chosen);
    expect(result).toMatchObject({ offline: true, matched: 1, presets: ["plex", "jellyfin", "emby"] });
  });

  it("Proben über viele Titel verteilt, die gewählte Datei zuerst", async () => {
    for (const show of ["A", "B", "C"]) for (const e of [1, 2, 3]) await touch(`tv/${show}/${show} - S01E0${e}.mkv`);
    const files = await sampleFiles(path.join(tmp, "tv"), path.join(tmp, "tv/B/B - S01E03.mkv"), 5);
    expect(files.map((f) => path.relative(path.join(tmp, "tv"), f))).toEqual([
      "B/B - S01E03.mkv",
      "A/A - S01E01.mkv",
      "B/B - S01E01.mkv",
      "C/C - S01E01.mkv",
      "A/A - S01E02.mkv",
    ]);
  });

  it("verständliche Fehler", async () => {
    await expect(libraryFormat(rt(), await touch("tv/notes.txt"))).rejects.toThrow(/formats_infer_notAVideo/);
    await expect(libraryFormat(rt(), "/etc/passwd")).rejects.toThrow();
  });
});
