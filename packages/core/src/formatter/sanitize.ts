export type SanitizeTarget = "windows" | "posix";

export type SanitizeOptions = {
  /** `windows` is the safe default: SMB shares and most NAS clients follow its rules. */
  target?: SanitizeTarget;
  /** Max bytes per path segment (UTF-8). Most file systems allow 255. */
  maxSegmentBytes?: number;
};

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what we strip
const CONTROL = /[\u0000-\u001f\u007f]/g;

const utf8 = new TextEncoder();
const byteLength = (s: string) => utf8.encode(s).length;

/** Cuts to `max` UTF-8 bytes without splitting a code point. */
function truncateBytes(s: string, max: number): string {
  if (byteLength(s) <= max) return s;
  let out = "";
  for (const ch of s) {
    if (byteLength(out + ch) > max) break;
    out += ch;
  }
  return out;
}

/** Makes one path segment (a folder or file name) valid. Never returns an empty string. */
export function sanitizeSegment(segment: string, options: SanitizeOptions = {}): string {
  const target = options.target ?? "windows";
  const max = options.maxSegmentBytes ?? 255;
  let s = segment.normalize("NFC").replace(CONTROL, "");
  if (target === "windows") {
    s = s
      .replace(/\s*:\s*/g, " - ")
      .replace(/"/g, "'")
      .replace(/[<>|?*]/g, "")
      .replace(/[\\/]/g, "-");
  } else {
    s = s.replace(/\//g, "-");
  }
  s = s.replace(/\s+/g, " ").trim();
  if (target === "windows") s = s.replace(/[. ]+$/, "");
  if (s === "." || s === "..") s = "_";
  if (!s) s = "_";
  if (target === "windows" && WINDOWS_RESERVED.test(s)) s = `${s}_`;

  if (byteLength(s) > max) {
    const dot = s.lastIndexOf(".");
    const ext = dot > 0 && s.length - dot <= 16 ? s.slice(dot) : "";
    s = truncateBytes(s.slice(0, s.length - ext.length), max - byteLength(ext)).trimEnd() + ext;
    if (target === "windows") s = s.replace(/[. ]+$/, "") || "_";
  }
  return s;
}

/** Sanitizes each segment of a relative path. Empty segments collapse; `..` cannot escape. */
export function sanitizePath(path: string, options: SanitizeOptions = {}): string {
  return path
    .split(/[\\/]+/)
    .filter((seg) => seg.trim() !== "")
    .map((seg) => sanitizeSegment(seg, options))
    .join("/");
}
