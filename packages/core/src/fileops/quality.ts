import { tr } from "../i18n.ts";
import type { ProbeInfo } from "../scanner/index.ts";
import type { ReleaseInfo } from "../types.ts";

/**
 * What `keep-better` knows about one file. Every field is optional: a criterion only counts
 * when both files have it, so "unknown" never loses against "known".
 */
export type Quality = {
  resolution?: string;
  source?: string;
  /** "SDR" when known to have no HDR. */
  hdr?: string;
  videoCodec?: string;
  audioCodec?: string;
  audioChannels?: string;
  /** PROPER / REPACK: a fixed release of the same quality. */
  revision?: number;
  size?: number;
};

const RESOLUTION: Record<string, number> = { "2160p": 7, "1440p": 6, "1080p": 5, "1080i": 4, "720p": 3, "576p": 2, "480p": 1, "360p": 0 };
const SOURCE: Record<string, number> = { Remux: 7, BluRay: 6, "WEB-DL": 5, WEB: 4, WEBRip: 4, HDRip: 3, HDTV: 2, DVD: 1 };
const HDR: Record<string, number> = { SDR: 0, HDR: 1, HDR10: 1, HLG: 1, "HDR10+": 2, DV: 2 };
// Newer codecs need less space for the same picture, so they rank above a bigger old one.
const CODEC: Record<string, number> = { AV1: 3, "H.265": 2, VP9: 2, "H.264": 1, XviD: 0 };
const AUDIO: Record<string, number> = { TrueHD: 5, "DTS-HD": 5, FLAC: 4, "DD+": 3, DTS: 3, AC3: 2, AAC: 1, Opus: 1, MP3: 0 };

type Criterion = {
  /** May carry tr() markers; they are localized inside the reason text. */
  label: string;
  rank: (q: Quality) => number | undefined;
  show: (q: Quality) => string;
};

/** Most important first; the first criterion where both files differ decides. */
const CRITERIA: Criterion[] = [
  { label: tr("Auflösung", "Resolution"), rank: (q) => lookup(RESOLUTION, q.resolution), show: (q) => q.resolution! },
  { label: tr("Quelle", "Source"), rank: (q) => lookup(SOURCE, q.source), show: (q) => q.source! },
  { label: "HDR", rank: (q) => lookup(HDR, q.hdr), show: (q) => q.hdr! },
  { label: tr("Video-Codec", "Video codec"), rank: (q) => lookup(CODEC, q.videoCodec), show: (q) => q.videoCodec! },
  {
    label: "Audio",
    // Codec first, channels within the same codec: 7.1 beats 5.1 beats 2.0.
    rank: (q) => {
      const codec = lookup(AUDIO, q.audioCodec);
      return codec === undefined ? undefined : codec * 100 + Math.round(Number.parseFloat(q.audioChannels ?? "0") * 10);
    },
    show: (q) => [q.audioCodec, q.audioChannels].filter(Boolean).join(" "),
  },
  { label: "Proper/Repack", rank: (q) => q.revision, show: (q) => (q.revision ? "Proper" : "–") },
  { label: tr("Dateigröße", "File size"), rank: (q) => q.size, show: (q) => formatSize(q.size!) },
];

function lookup(table: Record<string, number>, value: string | undefined): number | undefined {
  if (!value) return undefined;
  return table[value] ?? table[Object.keys(table).find((k) => k.toLowerCase() === value.toLowerCase()) ?? ""];
}

function formatSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export type QualityComparison = {
  /** > 0: the new file is better, < 0: the existing one, 0: no difference found. */
  result: number;
  /** The criterion that decided, e.g. "Resolution: 2160p vs 1080p". Undefined on a tie. */
  reason?: string;
};

/** Compares the incoming file `a` with the existing file `b`. */
export function compareQuality(a: Quality, b: Quality): QualityComparison {
  for (const c of CRITERIA) {
    const [ra, rb] = [c.rank(a), c.rank(b)];
    if (ra === undefined || rb === undefined || ra === rb) continue;
    return { result: ra - rb, reason: `${c.label}: ${c.show(a)} vs ${c.show(b)}` };
  }
  return { result: 0 };
}

const CHANNELS: Record<number, string> = { 1: "1.0", 2: "2.0", 6: "5.1", 8: "7.1" };
const PROBE_AUDIO: Record<string, string> = {
  truehd: "TrueHD",
  dts: "DTS",
  eac3: "DD+",
  ac3: "AC3",
  aac: "AAC",
  flac: "FLAC",
  opus: "Opus",
  mp3: "MP3",
};

/**
 * Quality of a file from its parsed name and, when available, ffprobe. The container wins
 * for what it can see (resolution, codec, HDR, audio); only the name knows source and
 * PROPER/REPACK.
 */
export function qualityOf(release: Partial<ReleaseInfo> | undefined, probe?: ProbeInfo, size?: number): Quality {
  const r = release ?? {};
  // A name with release details but no HDR tag is SDR; a bare name says nothing.
  const nameHdr = r.hdr ?? (r.resolution && (r.source || r.videoCodec) ? "SDR" : undefined);
  const best = probe?.audio.length ? bestAudio(probe.audio) : undefined;
  return {
    resolution: probe?.resolution ?? r.resolution,
    source: r.source,
    // ffprobe sees HDR10+ only in frame data, so a name saying HDR10+ refines its HDR10.
    hdr: probe?.hdr === "HDR10" && r.hdr === "HDR10+" ? r.hdr : (probe?.hdr ?? (probe?.resolution ? "SDR" : nameHdr)),
    videoCodec: probe?.videoCodec ?? r.videoCodec,
    audioCodec: best?.codec ?? r.audioCodec,
    audioChannels: best ? best.channels : r.audioChannels,
    revision: r.proper || r.repack ? 1 : release && (r.resolution || r.source) ? 0 : undefined,
    size,
  };
}

/** The best audio track: a German dub in 2.0 next to the English original in 5.1 counts as 5.1. */
function bestAudio(tracks: ProbeInfo["audio"]): { codec: string; channels?: string } {
  const audio = CRITERIA.find((c) => c.label === "Audio")!;
  const mapped = tracks.map((t) => ({
    // DTS-HD MA and DTS:X are "dts" with a profile.
    codec: t.codec === "dts" && /hd|x/i.test(t.profile ?? "") ? "DTS-HD" : (PROBE_AUDIO[t.codec.toLowerCase()] ?? t.codec),
    channels: t.channels ? (CHANNELS[t.channels] ?? `${t.channels}.0`) : undefined,
  }));
  const rank = (t: (typeof mapped)[number]) => audio.rank({ audioCodec: t.codec, audioChannels: t.channels }) ?? -1;
  return mapped.reduce((best, t) => (rank(t) > rank(best) ? t : best));
}
