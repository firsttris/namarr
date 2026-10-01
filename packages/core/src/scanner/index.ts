import * as fs from "node:fs/promises";
import * as path from "node:path";
import picomatch from "picomatch";
import { SIDECAR_EXTENSIONS, splitExtension, VIDEO_EXTENSIONS } from "../parser/index.ts";

export type Companion = {
  path: string;
  /** What follows the main file's stem: `.de.srt`, `-poster.jpg`, `.nfo` */
  suffix: string;
};

export type ScannedFile = {
  path: string;
  relative: string;
  size: number;
  mtime: Date;
  birthtime: Date;
  inode: number;
  companions: Companion[];
};

export type ScanOptions = {
  recursive?: boolean;
  /** Globs relative to the root, e.g. `**\/*.mkv`. Default: video files. */
  include?: string[];
  /** Globs relative to the root, e.g. `**\/sample/**`. A leading `!` is accepted too. */
  exclude?: string[];
  /** `media`: video files with sidecars attached. `all`: every file on its own (rule mode). */
  mode?: "media" | "all";
  signal?: AbortSignal;
};

export type ScanResult = { files: ScannedFile[]; orphans: string[] };

const ALWAYS_EXCLUDE = ["**/@eaDir/**", "**/.*", "**/.*/**", "**/*.part", "**/*.!qB", "**/*.tmp", "**/*.namarr-bak-*"];
const ARTWORK_SUFFIX = /^-(poster|fanart|thumb|banner|landscape|clearlogo)\.(jpe?g|png)$/i;

async function* walk(dir: string, recursive: boolean, signal?: AbortSignal): AsyncGenerator<string> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EACCES") return;
    throw e;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  for (const entry of entries) {
    if (signal?.aborted) return;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (recursive) yield* walk(full, recursive, signal);
    } else if (entry.isFile()) yield full;
  }
}

/** Collects files below `root`; in media mode subtitles, NFOs and artwork attach to their video. */
export async function scan(root: string, options: ScanOptions = {}): Promise<ScanResult> {
  const mode = options.mode ?? "media";
  const base = path.resolve(root);
  const include = options.include?.length ? options.include : ["**/*"];
  const exclude = [...ALWAYS_EXCLUDE, ...(options.exclude ?? []).map((g) => g.replace(/^!/, ""))];
  const isIncluded = picomatch(include, { dot: true, nocase: true });
  const isExcluded = picomatch(exclude, { dot: true, nocase: true });

  const all: string[] = [];
  const rootStat = await fs.stat(base);
  if (rootStat.isFile()) all.push(base);
  else {
    for await (const file of walk(base, options.recursive ?? true, options.signal)) {
      const rel = path.relative(base, file).split(path.sep).join("/");
      if (!isExcluded(rel)) all.push(file);
    }
  }

  const relative = (p: string) => (rootStat.isFile() ? path.basename(p) : path.relative(base, p).split(path.sep).join("/"));
  const toFile = async (p: string): Promise<ScannedFile> => {
    const st = await fs.stat(p);
    return { path: p, relative: relative(p), size: st.size, mtime: st.mtime, birthtime: st.birthtime, inode: st.ino, companions: [] };
  };

  if (mode === "all") {
    const files = await Promise.all(all.filter((p) => isIncluded(relative(p))).map(toFile));
    return { files, orphans: [] };
  }

  const ext = (p: string) => path.extname(p).slice(1).toLowerCase();
  const videos = all.filter((p) => VIDEO_EXTENSIONS.includes(ext(p)) && isIncluded(relative(p)));
  const sidecars = all.filter((p) => SIDECAR_EXTENSIONS.includes(ext(p)));
  const files = await Promise.all(videos.map(toFile));

  const byDir = new Map<string, ScannedFile[]>();
  for (const f of files) {
    const d = path.dirname(f.path);
    byDir.set(d, [...(byDir.get(d) ?? []), f]);
  }

  const orphans: string[] = [];
  for (const sidecar of sidecars) {
    const dir = path.dirname(sidecar);
    const name = path.basename(sidecar);
    const siblings = byDir.get(dir) ?? [];
    // Longest stem first, so "Show.S01E01.Extended" wins over "Show.S01E01".
    const owner = siblings
      .map((v) => ({ v, stem: splitExtension(path.basename(v.path)).stem }))
      .sort((a, b) => b.stem.length - a.stem.length)
      .find(({ stem }) => {
        if (!name.startsWith(stem)) return false;
        const suffix = name.slice(stem.length);
        return suffix.startsWith(".") || ARTWORK_SUFFIX.test(suffix);
      });
    // poster.jpg, folder.jpg, movie.nfo next to a single video belong to it.
    const generic = /^(poster|folder|fanart|movie)\.(jpe?g|png|nfo)$/i.exec(name);
    if (owner) owner.v.companions.push({ path: sidecar, suffix: name.slice(owner.stem.length) });
    else if (siblings.length === 1 && generic) {
      const kind = generic[1]!.toLowerCase() === "folder" ? "poster" : generic[1]!.toLowerCase();
      const suffix = generic[2]!.toLowerCase() === "nfo" ? ".nfo" : `-${kind}.${generic[2]}`;
      siblings[0]!.companions.push({ path: sidecar, suffix });
    } else orphans.push(sidecar);
  }
  return { files, orphans };
}

export type ProbeInfo = {
  resolution?: string;
  videoCodec?: string;
  /** DV, HDR10, HLG; undefined for SDR. HDR10+ only shows in frame data and reads as HDR10. */
  hdr?: string;
  audio: { codec: string; profile?: string; channels?: number; language?: string }[];
  duration?: number;
};

type FfprobeStream = {
  codec_type?: string;
  codec_name?: string;
  profile?: string;
  width?: number;
  height?: number;
  channels?: number;
  color_transfer?: string;
  side_data_list?: { side_data_type?: string }[];
  tags?: { language?: string };
};

const CODEC_NAMES: Record<string, string> = { h264: "H.264", hevc: "H.265", av1: "AV1", mpeg4: "XviD", vp9: "VP9" };

/** Turns `ffprobe -print_format json -show_streams -show_format` output into release fields. */
export function parseFfprobe(json: { streams?: FfprobeStream[]; format?: { duration?: string } }): ProbeInfo {
  const streams = json.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  let resolution: string | undefined;
  if (video?.width && video.height) {
    const w = video.width;
    resolution = w >= 3200 ? "2160p" : w >= 1800 ? "1080p" : w >= 1200 ? "720p" : w >= 900 ? "576p" : "480p";
  }
  const hdr = video?.side_data_list?.some((d) => /dovi|dolby vision/i.test(d.side_data_type ?? ""))
    ? "DV"
    : video?.color_transfer === "smpte2084"
      ? "HDR10"
      : video?.color_transfer === "arib-std-b67"
        ? "HLG"
        : undefined;
  return {
    resolution,
    hdr,
    videoCodec: video?.codec_name ? (CODEC_NAMES[video.codec_name] ?? video.codec_name.toUpperCase()) : undefined,
    audio: streams
      .filter((s) => s.codec_type === "audio")
      .map((s) => ({ codec: s.codec_name ?? "unknown", profile: s.profile, channels: s.channels, language: s.tags?.language })),
    duration: json.format?.duration ? Number(json.format.duration) : undefined,
  };
}

/** Reads container metadata with ffprobe. Returns undefined when ffprobe is not installed. */
export async function probe(file: string, ffprobe = "ffprobe"): Promise<ProbeInfo | undefined> {
  const { execFile } = await import("node:child_process");
  return new Promise((resolve) => {
    execFile(
      ffprobe,
      ["-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", file],
      { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return resolve(undefined);
        try {
          resolve(parseFfprobe(JSON.parse(stdout)));
        } catch {
          resolve(undefined);
        }
      },
    );
  });
}
