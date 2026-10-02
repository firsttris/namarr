import { describe, expect, it } from "vitest";
import { compareQuality, type Quality, qualityOf } from "../src/fileops/quality.ts";
import { localize } from "../src/i18n.ts";
import { parse } from "../src/parser/index.ts";

const GB = 1024 ** 3;
const better = (a: Quality, b: Quality) => compareQuality(a, b).result > 0;
const fromName = (name: string, size?: number) => qualityOf(parse(name).release, undefined, size);

describe("Qualitätsvergleich", () => {
  it("Auflösung schlägt Dateigröße", () => {
    expect(better({ resolution: "2160p", size: 8 * GB }, { resolution: "1080p", size: 20 * GB })).toBe(true);
    expect(better({ resolution: "720p", size: 9 * GB }, { resolution: "1080p", size: 2 * GB })).toBe(false);
  });

  it("bei gleicher Auflösung zählt die Quelle", () => {
    expect(better(fromName("Dune.2021.1080p.BluRay.x264-GRP.mkv", 1), fromName("Dune.2021.1080p.WEB-DL.x264-GRP.mkv", 2))).toBe(true);
    expect(better(fromName("Dune.2021.2160p.BluRay.REMUX.HEVC-GRP.mkv"), fromName("Dune.2021.2160p.BluRay.x265-GRP.mkv"))).toBe(true);
    expect(better(fromName("Dune.2021.1080p.HDTV.x264-GRP.mkv"), fromName("Dune.2021.1080p.WEBRip.x264-GRP.mkv"))).toBe(false);
  });

  it("dann HDR, dann Codec – ein kleineres HEVC schlägt ein größeres H.264", () => {
    expect(better(fromName("Dune.2021.2160p.WEB-DL.DV.HEVC-GRP.mkv"), fromName("Dune.2021.2160p.WEB-DL.HEVC-GRP.mkv"))).toBe(true);
    expect(better(fromName("Dune.2021.1080p.WEB-DL.x265-GRP.mkv", 2 * GB), fromName("Dune.2021.1080p.WEB-DL.x264-GRP.mkv", 6 * GB))).toBe(
      true,
    );
  });

  it("dann Ton, dann PROPER/REPACK, zuletzt die Größe", () => {
    expect(better(fromName("Dune.2021.1080p.BluRay.TrueHD.7.1.x264-GRP.mkv"), fromName("Dune.2021.1080p.BluRay.DDP5.1.x264-GRP.mkv"))).toBe(
      true,
    );
    expect(better({ audioCodec: "DD+", audioChannels: "5.1" }, { audioCodec: "DD+", audioChannels: "2.0" })).toBe(true);
    expect(better(fromName("Dune.2021.1080p.WEB-DL.x264.PROPER-GRP.mkv", 1), fromName("Dune.2021.1080p.WEB-DL.x264-GRP.mkv", 2))).toBe(
      true,
    );
    expect(better(fromName("Dune.2021.1080p.WEB-DL.x264-GRP.mkv", 3), fromName("Dune.2021.1080p.WEB-DL.x264-GRP.mkv", 2))).toBe(true);
    expect(
      compareQuality(fromName("Dune.2021.1080p.WEB-DL.x264-GRP.mkv", 2), fromName("Dune.2021.1080p.WEB-DL.x264-GRP.mkv", 2)).result,
    ).toBe(0);
  });

  it("Unbekanntes verliert nicht gegen Bekanntes, es zählt dann nicht", () => {
    // The renamed target says nothing about its source: the size decides.
    expect(better({ source: "BluRay", size: 1 }, { size: 2 })).toBe(false);
    expect(better({ resolution: "1080p", source: "WEB-DL", size: 1 }, { resolution: "1080p", size: 2 })).toBe(false);
    expect(better({ resolution: "1080p", size: 1 }, { resolution: "720p", size: 2 })).toBe(true);
  });

  it("nennt das entscheidende Kriterium in beiden Sprachen", () => {
    const { reason } = compareQuality({ resolution: "1080p" }, { resolution: "2160p" });
    expect(localize(reason!, "de")).toBe("Auflösung: 1080p vs 2160p");
    expect(localize(reason!, "en")).toBe("Resolution: 1080p vs 2160p");
    expect(localize(compareQuality({ size: 3 * GB }, { size: 1.5 * GB }).reason!, "en")).toBe("File size: 3.0 GB vs 1.5 GB");
    expect(compareQuality({}, {}).reason).toBeUndefined();
  });
});

describe("Qualität aus Name und ffprobe", () => {
  const probe = { resolution: "1080p", videoCodec: "H.265", audio: [{ codec: "aac", channels: 2 }] };

  it("der Container gewinnt für das, was er sieht; Quelle und PROPER kennt nur der Name", () => {
    const q = qualityOf(parse("Dune.2021.720p.BluRay.x264.PROPER-GRP.mkv").release, probe, 5);
    expect(q).toEqual({
      resolution: "1080p",
      source: "BluRay",
      hdr: "SDR",
      videoCodec: "H.265",
      audioCodec: "AAC",
      audioChannels: "2.0",
      revision: 1,
      size: 5,
    });
  });

  it("ein nackter Name sagt nichts über HDR, ein Release-Name ohne HDR-Tag ist SDR", () => {
    expect(fromName("Dune (2021).mkv").hdr).toBeUndefined();
    expect(fromName("Dune.2021.1080p.BluRay.x264-GRP.mkv").hdr).toBe("SDR");
    expect(qualityOf(parse("Dune (2021).mkv").release, { ...probe, hdr: "DV" }).hdr).toBe("DV");
    // HDR10+ lives in frame data, ffprobe -show_streams only sees HDR10
    expect(qualityOf(parse("Dune.2021.2160p.HDR10+.WEB-DL.mkv").release, { ...probe, hdr: "HDR10" }).hdr).toBe("HDR10+");
  });

  it("die beste Tonspur zählt; DTS-HD erkennt ffprobe am Profil", () => {
    const q = qualityOf(undefined, {
      ...probe,
      audio: [
        { codec: "ac3", channels: 2, language: "ger" },
        { codec: "dts", profile: "DTS-HD MA", channels: 8, language: "eng" },
        { codec: "eac3", channels: 6 },
      ],
    });
    expect([q.audioCodec, q.audioChannels]).toEqual(["DTS-HD", "7.1"]);
  });
});
