import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPreview, canTransition, type PreviewInput, summarize } from "../src/jobs/index.ts";
import { matchAll } from "../src/matcher/index.ts";
import { parse } from "../src/parser/index.ts";
import { isInside, PathOutsideRootError, resolveInRoots } from "../src/paths.ts";
import { parseFfprobe, scan } from "../src/scanner/index.ts";
import { FakeProvider, severance, severanceEpisodes } from "./helpers.ts";

let tmp: string;
beforeEach(async () => {
  tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "namarr-scan-")));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function touch(...rels: string[]) {
  for (const rel of rels) {
    await fs.mkdir(path.dirname(path.join(tmp, rel)), { recursive: true });
    await fs.writeFile(path.join(tmp, rel), rel);
  }
}

describe("Scanner", () => {
  it("hängt Begleitdateien an die Hauptdatei", async () => {
    await touch(
      "tv/Show.S01E01.mkv",
      "tv/Show.S01E01.de.srt",
      "tv/Show.S01E01.en.forced.srt",
      "tv/Show.S01E01.nfo",
      "tv/Show.S01E01-poster.jpg",
      "tv/Show.S01E02.mkv",
      "tv/Show.S01E02.idx",
      "tv/Show.S01E02.sub",
      "tv/random.srt",
    );
    const { files, orphans } = await scan(tmp);
    expect(files.map((f) => f.relative)).toEqual(["tv/Show.S01E01.mkv", "tv/Show.S01E02.mkv"]);
    expect(files[0]!.companions.map((c) => c.suffix).sort()).toEqual(["-poster.jpg", ".de.srt", ".en.forced.srt", ".nfo"]);
    expect(files[1]!.companions.map((c) => c.suffix).sort()).toEqual([".idx", ".sub"]);
    expect(orphans.map((o) => path.basename(o))).toEqual(["random.srt"]);
  });

  it("generische Poster gehören zum einzigen Film im Ordner", async () => {
    await touch("Movie (2010)/Movie.2010.mkv", "Movie (2010)/folder.jpg", "Movie (2010)/movie.nfo");
    const { files } = await scan(tmp);
    expect(files[0]!.companions.map((c) => c.suffix).sort()).toEqual(["-poster.jpg", ".nfo"]);
  });

  it("Glob-Include/Exclude und Temp-Dateien", async () => {
    await touch("a/x.mkv", "a/sample/x.sample.mkv", "b/y.mp4", "c/z.mkv.part", "c/.hidden.mkv", "@eaDir/t.mkv");
    const { files } = await scan(tmp, { include: ["**/*.mkv"], exclude: ["!**/sample/**"] });
    expect(files.map((f) => f.relative)).toEqual(["a/x.mkv"]);
  });

  it("flach statt rekursiv", async () => {
    await touch("top.mkv", "sub/deep.mkv");
    const { files } = await scan(tmp, { recursive: false });
    expect(files.map((f) => f.relative)).toEqual(["top.mkv"]);
  });

  it("Regel-Modus: alle Dateien einzeln", async () => {
    await touch("photos/IMG_1.jpg", "photos/IMG_1.xmp", "photos/notes.txt");
    const { files } = await scan(path.join(tmp, "photos"), { mode: "all" });
    expect(files.map((f) => f.relative)).toEqual(["IMG_1.jpg", "IMG_1.xmp", "notes.txt"]);
  });

  it("natürliche Sortierung", async () => {
    await touch("e10.mkv", "e2.mkv", "e1.mkv");
    expect((await scan(tmp)).files.map((f) => f.relative)).toEqual(["e1.mkv", "e2.mkv", "e10.mkv"]);
  });

  it("ffprobe-Ausgabe", () => {
    expect(
      parseFfprobe({
        streams: [
          { codec_type: "video", codec_name: "hevc", width: 3840, height: 1600 },
          { codec_type: "audio", codec_name: "eac3", channels: 6, tags: { language: "ger" } },
        ],
        format: { duration: "3600.5" },
      }),
    ).toEqual({ resolution: "2160p", videoCodec: "H.265", audio: [{ codec: "eac3", channels: 6, language: "ger" }], duration: 3600.5 });
  });
});

describe("Wurzelpfad-Prüfung", () => {
  it("erlaubt Pfade in der Wurzel, auch noch nicht existierende", async () => {
    await touch("data/a.mkv");
    const root = path.join(tmp, "data");
    expect(await resolveInRoots(path.join(root, "a.mkv"), [root])).toBe(path.join(root, "a.mkv"));
    expect(await resolveInRoots("new/b.mkv", [root])).toBe(path.join(root, "new/b.mkv"));
  });

  it("blockiert Path Traversal", async () => {
    const root = path.join(tmp, "data");
    await fs.mkdir(root);
    await expect(resolveInRoots("../etc/passwd", [root])).rejects.toBeInstanceOf(PathOutsideRootError);
    await expect(resolveInRoots("/etc/passwd", [root])).rejects.toBeInstanceOf(PathOutsideRootError);
    await expect(resolveInRoots(`${root}-evil/x`, [root])).rejects.toBeInstanceOf(PathOutsideRootError);
    await expect(resolveInRoots("a\0b", [root])).rejects.toBeInstanceOf(PathOutsideRootError);
    await expect(resolveInRoots("x", [])).rejects.toBeInstanceOf(PathOutsideRootError);
  });

  it("blockiert Ausbruch über Symlinks", async () => {
    const root = path.join(tmp, "data");
    await fs.mkdir(root);
    await fs.mkdir(path.join(tmp, "secret"));
    await fs.symlink(path.join(tmp, "secret"), path.join(root, "link"));
    await expect(resolveInRoots(path.join(root, "link/x"), [root])).rejects.toBeInstanceOf(PathOutsideRootError);
  });

  it("isInside", () => {
    expect(isInside("/data/a", "/data")).toBe(true);
    expect(isInside("/data", "/data")).toBe(true);
    expect(isInside("/database", "/data")).toBe(false);
  });
});

describe("Vorschau (Workbench-Szenario aus dem Design)", () => {
  const names = [
    "Severance.S02E01.German.DL.1080p.WEB.h264-GRP.mkv",
    "Severance.S02E02.German.DL.1080p.WEB.h264-GRP.mkv",
    "severance.204-205.720p.mkv",
    "Severance.S02E01.sample.mkv",
    "video_2024_final_v2.mp4",
  ];

  async function inputs(): Promise<PreviewInput[]> {
    await touch(...names.map((n) => `tv/${n}`), "tv/Severance.S02E01.German.DL.1080p.WEB.h264-GRP.de.srt");
    const { files } = await scan(path.join(tmp, "tv"));
    const provider = new FakeProvider({ series: [severance], episodes: { "95396": severanceEpisodes } });
    const parsed = files.map((f) => ({ key: f.path, parsed: parse(f.relative) }));
    const matches = await matchAll(parsed, provider);
    return files.map((file, i) => ({ file, parsed: parsed[i]!.parsed, match: matches.get(file.path) }));
  }

  it("berechnet Ziele, Zustände und Zusammenfassung", async () => {
    const items = buildPreview(await inputs(), { mode: "media", preset: "jellyfin", targetRoot: "/media/tv" });
    const bySource = (n: string) => items.find((i) => i.source.endsWith(`/${n}`))!;

    const e1 = bySource(names[0]!);
    expect(e1.state).toBe("ready");
    expect(e1.target).toBe("/media/tv/Severance (2022)/Season 02/Severance (2022) - S02E01 - Hallo, Frau Cobel.mkv");
    expect(e1.companions).toEqual([
      {
        from: path.join(tmp, "tv/Severance.S02E01.German.DL.1080p.WEB.h264-GRP.de.srt"),
        to: "/media/tv/Severance (2022)/Season 02/Severance (2022) - S02E01 - Hallo, Frau Cobel.de.srt",
      },
    ]);
    expect(bySource(names[2]!).state).toBe("needs_review");
    expect(bySource(names[3]!)).toMatchObject({ state: "skipped", reasons: ["Übersprungen: Sample-Datei"] });
    expect(bySource(names[4]!)).toMatchObject({ state: "needs_review", reasons: ["Kein Treffer gefunden"] });
    expect(bySource(names[4]!).target).toBeUndefined();
    expect(summarize(items)).toEqual({ total: 5, ready: 2, review: 2, skipped: 1, conflicts: 0 });
  });

  it("Media plus Regeln: Regeln wirken nach dem Template auf den Dateinamen", async () => {
    const items = buildPreview(await inputs(), {
      mode: "both",
      preset: "jellyfin",
      targetRoot: "/media/tv",
      rules: [{ type: "replace", find: ", ", replace: " - " }, { type: "transliterate" }],
    });
    expect(items.find((i) => i.source.endsWith(names[0]!))!.target).toBe(
      "/media/tv/Severance (2022)/Season 02/Severance (2022) - S02E01 - Hallo - Frau Cobel.mkv",
    );
  });

  it("Regel-Modus benennt am Ort um", async () => {
    await touch("photos/IMG_1.JPG");
    const { files } = await scan(path.join(tmp, "photos"), { mode: "all" });
    const items = buildPreview(
      files.map((file) => ({ file, parsed: parse(file.relative) })),
      {
        mode: "rules",
        rules: [
          { type: "extension", case: "lower" },
          { type: "insert", text: "Urlaub ", position: "start" },
        ],
      },
    );
    expect(items[0]).toMatchObject({ state: "ready", target: path.join(tmp, "photos/Urlaub IMG_1.jpg") });
  });

  it("doppelte Ziele werden markiert", async () => {
    const base = (await inputs()).filter((i) => i.file.path.endsWith(names[0]!) || i.file.path.endsWith(names[1]!));
    const dup = { ...base[0]!, file: { ...base[0]!.file, path: `${base[0]!.file.path}.copy.mkv`, companions: [] } };
    const items = buildPreview([base[0]!, dup], { mode: "media", targetRoot: "/media/tv" });
    expect(items.every((i) => i.conflict === "duplicate")).toBe(true);
    expect(summarize(items).conflicts).toBe(2);
  });

  it("manuelles Ziel und Ausschluss", async () => {
    const base = (await inputs()).filter((i) => i.file.path.endsWith(names[0]!) || i.file.path.endsWith(names[1]!));
    const items = buildPreview(
      [
        { ...base[0]!, targetOverride: "Custom/Name.mkv" },
        { ...base[1]!, excluded: true },
      ],
      { mode: "media", targetRoot: "/media/tv" },
    );
    expect(items[0]).toMatchObject({ state: "ready", target: "/media/tv/Custom/Name.mkv" });
    expect(items[1]).toMatchObject({ state: "skipped" });
  });

  it("eigenes Template statt Preset", async () => {
    const items = buildPreview(await inputs(), {
      mode: "media",
      template: { episode: "{n}/{s00e00}" },
      targetRoot: "/m",
    });
    expect(items.find((i) => i.source.endsWith(names[0]!))!.target).toBe("/m/Severance/S02E01.mkv");
  });
});

describe("Zustände eines Job-Items", () => {
  it("parsed → matched → ready → done → undone", () => {
    expect(canTransition("parsed", "matched")).toBe(true);
    expect(canTransition("matched", "ready")).toBe(true);
    expect(canTransition("ready", "done")).toBe(true);
    expect(canTransition("done", "undone")).toBe(true);
  });
  it("verbotene Wechsel", () => {
    expect(canTransition("done", "ready")).toBe(false);
    expect(canTransition("parsed", "done")).toBe(false);
    expect(canTransition("undone", "done")).toBe(false);
  });
});
