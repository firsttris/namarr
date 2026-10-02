import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ProbeInfo } from "../scanner/index.ts";

/** What rules can read from inside a file: when a photo or video was taken, audio tags. */
export type FileMeta = {
  /** EXIF DateTimeOriginal for photos, the container's creation time for videos. */
  taken?: Date;
  /** Lower-case tag names: artist, albumartist, title, album, track, disc, date, genre, … */
  tags: Record<string, string>;
};

/** Photos whose EXIF namarr reads itself: JPEG and the TIFF-based raw formats. */
export const EXIF_EXTENSIONS = ["jpg", "jpeg", "tif", "tiff", "dng", "cr2", "nef", "arw", "pef", "srw"];
/** Files whose tags and creation time come from ffprobe. */
export const PROBE_EXTENSIONS = [
  "mp3",
  "flac",
  "m4a",
  "m4b",
  "aac",
  "ogg",
  "opus",
  "wav",
  "wma",
  "aiff",
  "mp4",
  "mov",
  "m4v",
  "mkv",
  "avi",
  "webm",
  "3gp",
];

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));

/** "2024:07:14 18:03:22" → that wall-clock time (EXIF has no time zone). */
function exifTime(s: string): Date | undefined {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s);
  if (!m || m[1] === "0000") return undefined;
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  return new Date(y, mo - 1, d, h, mi, se);
}

/**
 * The capture date from EXIF: DateTimeOriginal, else DateTimeDigitized, else the IFD0 DateTime.
 * Reads JPEG (APP1 "Exif") and TIFF-based files (TIFF, DNG, CR2, NEF, ARW …). Undefined when
 * there is none or the data is damaged.
 */
export function exifDate(buf: Uint8Array): Date | undefined {
  try {
    let tiff = 0;
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      tiff = -1;
      for (let i = 2; i + 4 <= buf.length; ) {
        if (buf[i] !== 0xff) return undefined;
        const marker = buf[i + 1]!;
        const len = (buf[i + 2]! << 8) | buf[i + 3]!;
        if (marker === 0xe1 && ascii(buf, i + 4, 6) === "Exif\0\0") {
          tiff = i + 10;
          break;
        }
        if (marker === 0xda) return undefined; // image data starts, no EXIF before it
        i += 2 + len;
      }
      if (tiff < 0) return undefined;
    }
    const order = ascii(buf, tiff, 2);
    if (order !== "II" && order !== "MM") return undefined;
    const le = order === "II";
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    if (view.getUint16(tiff + 2, le) !== 42) return undefined;

    const entries = (ifd: number) => {
      const out = new Map<number, { type: number; count: number; value: number }>();
      const n = view.getUint16(tiff + ifd, le);
      for (let k = 0; k < n; k++) {
        const at = tiff + ifd + 2 + k * 12;
        out.set(view.getUint16(at, le), {
          type: view.getUint16(at + 2, le),
          count: view.getUint32(at + 4, le),
          value: view.getUint32(at + 8, le),
        });
      }
      return out;
    };
    const text = (e: { type: number; count: number; value: number } | undefined) =>
      e && e.type === 2 && e.count >= 19 ? exifTime(ascii(buf, tiff + e.value, 19)) : undefined;

    const ifd0 = entries(view.getUint32(tiff + 4, le));
    const exifPointer = ifd0.get(0x8769);
    const exif = exifPointer ? entries(exifPointer.value) : undefined;
    return text(exif?.get(0x9003)) ?? text(exif?.get(0x9004)) ?? text(ifd0.get(0x0132));
  } catch {
    return undefined; // offsets beyond what was read, or damaged data
  }
}

/** Tags and creation time from ffprobe; Apple's creation date keeps the local time zone. */
export function metaFromProbe(info: ProbeInfo | undefined): FileMeta {
  const tags = { ...(info?.tags ?? {}) };
  const created = tags["com.apple.quicktime.creationdate"] ?? tags.creation_time;
  const taken = created ? new Date(created) : undefined;
  return { taken: taken && !Number.isNaN(taken.getTime()) ? taken : undefined, tags };
}

/** Reads what the rules need from a file. Never throws; missing data stays missing. */
export async function readMetadata(file: string, probe?: (file: string) => Promise<ProbeInfo | undefined>): Promise<FileMeta> {
  const ext = path.extname(file).slice(1).toLowerCase();
  if (EXIF_EXTENSIONS.includes(ext)) {
    // EXIF sits at the start: in JPEG before the image data, in TIFF-based raw files near IFD0.
    const handle = await fs.open(file, "r").catch(() => undefined);
    if (!handle) return { tags: {} };
    try {
      const buf = new Uint8Array(256 * 1024);
      const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
      return { taken: exifDate(buf.subarray(0, bytesRead)), tags: {} };
    } finally {
      await handle.close();
    }
  }
  if (PROBE_EXTENSIONS.includes(ext) && probe) return metaFromProbe(await probe(file).catch(() => undefined));
  return { tags: {} };
}
