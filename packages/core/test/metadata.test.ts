import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { exifDate, metaFromProbe, readMetadata } from "../src/metadata/index.ts";
import { parseFfprobe } from "../src/scanner/index.ts";

/** A TIFF block with IFD0 (DateTime, pointer to the EXIF IFD) and an EXIF IFD (DateTimeOriginal). */
function tiff(le: boolean, dates: { ifd0?: string; original?: string }): Uint8Array {
  const buf = new Uint8Array(96);
  const v = new DataView(buf.buffer);
  buf.set(new TextEncoder().encode(le ? "II" : "MM"), 0);
  v.setUint16(2, 42, le);
  v.setUint32(4, 8, le);
  const entry = (at: number, tag: number, type: number, count: number, value: number) => {
    v.setUint16(at, tag, le);
    v.setUint16(at + 2, type, le);
    v.setUint32(at + 4, count, le);
    v.setUint32(at + 8, value, le);
  };
  // IFD0 at 8: two entries, then next-IFD 0 → ends at 38
  v.setUint16(8, 2, le);
  entry(10, 0x0132, 2, 20, 56);
  entry(22, 0x8769, 4, 1, 38);
  // EXIF IFD at 38: one entry → ends at 56
  v.setUint16(38, 1, le);
  entry(40, 0x9003, 2, 20, 76);
  buf.set(new TextEncoder().encode(`${dates.ifd0 ?? "0000:00:00 00:00:00"}\0`), 56);
  buf.set(new TextEncoder().encode(`${dates.original ?? "0000:00:00 00:00:00"}\0`), 76);
  return buf;
}

/** A JPEG: SOI, an APP0, APP1 with the EXIF block, then the start of the image data. */
function jpeg(exif?: Uint8Array): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x04, 0x00, 0x00];
  const parts: number[] = [0xff, 0xd8, ...app0];
  if (exif) {
    const len = 2 + 6 + exif.length;
    parts.push(0xff, 0xe1, len >> 8, len & 0xff, ...new TextEncoder().encode("Exif\0\0"), ...exif);
  }
  parts.push(0xff, 0xda, 0x00, 0x02, 0x11, 0x22);
  return new Uint8Array(parts);
}

describe("EXIF-Aufnahmedatum", () => {
  it("DateTimeOriginal aus JPEG, Little- und Big-Endian", () => {
    for (const le of [true, false]) {
      const date = exifDate(jpeg(tiff(le, { ifd0: "2020:01:01 10:00:00", original: "2024:07:14 18:03:22" })));
      expect(date).toEqual(new Date(2024, 6, 14, 18, 3, 22));
    }
  });

  it("TIFF-basierte Raw-Dateien direkt; ohne DateTimeOriginal das IFD0-Datum", () => {
    expect(exifDate(tiff(true, { original: "2023:12:24 20:15:00" }))).toEqual(new Date(2023, 11, 24, 20, 15, 0));
    expect(exifDate(tiff(true, { ifd0: "2019:05:01 08:30:00" }))).toEqual(new Date(2019, 4, 1, 8, 30, 0));
  });

  it("ohne EXIF, leer oder kaputt: kein Datum, kein Fehler", () => {
    expect(exifDate(jpeg())).toBeUndefined();
    expect(exifDate(tiff(true, {}))).toBeUndefined();
    expect(exifDate(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x08, 0x45, 0x78]))).toBeUndefined();
    expect(exifDate(new TextEncoder().encode("not an image"))).toBeUndefined();
    expect(exifDate(jpeg(tiff(true, { original: "2024:07:14 18:03:22" })).subarray(0, 40))).toBeUndefined();
  });
});

describe("Tags aus ffprobe", () => {
  it("Container- und Audio-Stream-Tags, Namen klein, Sprache ausgenommen", () => {
    const info = parseFfprobe({
      streams: [{ codec_type: "audio", codec_name: "opus", tags: { ARTIST: "Queen", TITLE: "Bohemian Rhapsody", language: "eng" } }],
      format: { tags: { album: "A Night at the Opera", track: "11/12" } },
    });
    expect(info.tags).toEqual({ album: "A Night at the Opera", track: "11/12", artist: "Queen", title: "Bohemian Rhapsody" });
  });

  it("Aufnahmezeit von Videos, Apples Datum mit Zeitzone bevorzugt", () => {
    expect(metaFromProbe({ audio: [], tags: { creation_time: "2024-07-14T16:03:22.000000Z" } }).taken).toEqual(
      new Date("2024-07-14T16:03:22Z"),
    );
    const iphone = metaFromProbe({
      audio: [],
      tags: { creation_time: "2024-07-14T16:03:22.000000Z", "com.apple.quicktime.creationdate": "2024-07-14T18:03:22+0200" },
    });
    expect(iphone.taken?.toISOString()).toBe("2024-07-14T16:03:22.000Z");
    expect(metaFromProbe({ audio: [], tags: { creation_time: "kaputt" } }).taken).toBeUndefined();
  });
});

describe("readMetadata", () => {
  it("liest Fotos selbst, Musik über ffprobe, alles andere nicht", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "namarr-meta-"));
    try {
      await fs.writeFile(path.join(dir, "a.jpg"), jpeg(tiff(true, { original: "2024:07:14 18:03:22" })));
      await fs.writeFile(path.join(dir, "b.mp3"), "x");
      await fs.writeFile(path.join(dir, "c.txt"), "x");
      const calls: string[] = [];
      const probe = async (f: string) => {
        calls.push(path.basename(f));
        return { audio: [], tags: { artist: "Queen" } };
      };
      expect((await readMetadata(path.join(dir, "a.jpg"), probe)).taken).toEqual(new Date(2024, 6, 14, 18, 3, 22));
      expect((await readMetadata(path.join(dir, "b.mp3"), probe)).tags).toEqual({ artist: "Queen" });
      expect(await readMetadata(path.join(dir, "c.txt"), probe)).toEqual({ tags: {} });
      expect(await readMetadata(path.join(dir, "missing.jpg"), probe)).toEqual({ tags: {} });
      expect(calls).toEqual(["b.mp3"]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
