import type { Parsed } from "../types.ts";

/** A span of the name a rule consumed. The title ends where the first span starts. */
export type Hit = { rule: string; start: number; end: number; boundsTitle: boolean };

/** A token that is only a release token in release context (English, Extended, Web, Real). */
export type Pending = { rule: string; start: number; end: number; commit: () => void };

export type ParseContext = {
  /** File name without extension and without a leading `[Group]`. */
  name: string;
  out: Parsed;
  hits: Hit[];
  pending: Pending[];
  /** Confidence of the episode numbering, set by the rule that found it. */
  episodeConfidence: number;
  /** A leading `[Group]` tag was found (typical for anime releases). */
  bracketGroup: boolean;
};

export type ParserRule = { name: string; apply(ctx: ParseContext): void };

// Token boundaries: separators, brackets or start/end, never inside a word or number.
const L = "(?<![a-z0-9])";
const R = "(?![a-z0-9])";
const SEP = "[ ._-]";

const re = (body: string) => new RegExp(`${L}(?:${body})${R}`, "gi");

function overlaps(ctx: ParseContext, start: number, end: number): boolean {
  const hitsSpan = (h: { start: number; end: number }) => start < h.end && end > h.start;
  return ctx.hits.some(hitsSpan) || ctx.pending.some(hitsSpan);
}

function hit(ctx: ParseContext, rule: string, m: RegExpExecArray, boundsTitle = true): void {
  ctx.hits.push({ rule, start: m.index, end: m.index + m[0].length, boundsTitle });
}

/** Runs `pattern` over the name and calls `onMatch` for every match not already consumed. */
function scan(ctx: ParseContext, pattern: RegExp, onMatch: (m: RegExpExecArray) => unknown): void {
  pattern.lastIndex = 0;
  for (let m = pattern.exec(ctx.name); m; m = pattern.exec(ctx.name)) {
    if (overlaps(ctx, m.index, m.index + m[0].length)) continue;
    if (onMatch(m) === false) break;
  }
}

/** Defers a match until {@link resolvePending} decides whether it sits in release context. */
function weak(ctx: ParseContext, rule: string, m: RegExpExecArray, commit: () => void): void {
  ctx.pending.push({ rule, start: m.index, end: m.index + m[0].length, commit });
}

/**
 * Accepts a pending token when a strong release token precedes it, or when the next
 * token is itself a release token (not a year): "German.DL.1080p" but not "The.English.Patient.1996".
 */
export function resolvePending(ctx: ParseContext): void {
  const pending = [...ctx.pending].sort((a, b) => a.start - b.start);
  const accepted = new Set<Pending>();
  const firstStrong = Math.min(...ctx.hits.filter((h) => h.boundsTitle).map((h) => h.start));
  for (const p of pending) if (firstStrong < p.start) accepted.add(p);
  for (const p of [...pending].reverse()) {
    if (accepted.has(p)) continue;
    const next = p.end + (/^[ ._-]*/.exec(ctx.name.slice(p.end))?.[0].length ?? 0);
    const followed =
      ctx.hits.some((h) => h.boundsTitle && h.rule !== "year" && h.start === next) ||
      pending.some((q) => accepted.has(q) && q.start === next);
    if (followed) accepted.add(p);
  }
  for (const p of pending) {
    if (!accepted.has(p)) continue;
    p.commit();
    ctx.hits.push({ rule: p.rule, start: p.start, end: p.end, boundsTitle: true });
  }
  ctx.pending = [];
}

/** First match wins: a table of `[pattern, value]` pairs, earlier entries take priority. */
function table(
  name: string,
  field: (ctx: ParseContext, value: string) => void,
  entries: [string, string, "weak"?][],
  allWeak = false,
): ParserRule {
  return {
    name,
    apply(ctx) {
      let found = false;
      const set = (value: string) => {
        if (!found) field(ctx, value);
        found = true;
      };
      for (const [body, value, strength] of entries) {
        scan(ctx, re(body), (m) => {
          if (allWeak || strength === "weak") weak(ctx, name, m, () => set(value));
          else {
            hit(ctx, name, m);
            set(value);
          }
        });
      }
    },
  };
}

function range(from: number, to: number): number[] {
  if (to < from || to - from > 50) return [from, to].filter((n, i, a) => a.indexOf(n) === i);
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

function setEpisode(ctx: ParseContext, season: number | undefined, episodes: number[], confidence: number) {
  if (season !== undefined) ctx.out.season = season;
  ctx.out.episodes = episodes;
  ctx.episodeConfidence = Math.max(ctx.episodeConfidence, confidence);
}

const hasEpisode = (ctx: ParseContext) => ctx.out.episodes.length > 0 || ctx.out.absolute !== undefined || ctx.out.date !== undefined;

export const sampleRule: ParserRule = {
  name: "sample",
  apply(ctx) {
    scan(ctx, re("sample"), (m) => {
      ctx.out.sample = true;
      hit(ctx, "sample", m);
    });
  },
};

export const resolutionRule: ParserRule = {
  name: "resolution",
  apply(ctx) {
    scan(ctx, re("(2160|1440|1080|720|576|480|360)([pi])|4k|uhd"), (m) => {
      ctx.out.release.resolution ??= m[1] ? `${m[1]}${m[2]!.toLowerCase()}` : "2160p";
      hit(ctx, "resolution", m);
    });
  },
};

export const sourceRule = table("source", (ctx, v) => (ctx.out.release.source = v), [
  [`(?:bd${SEP}?)?remux`, "Remux"],
  [`blu${SEP}?ray|bdrip|brrip`, "BluRay"],
  ["bd", "BluRay", "weak"],
  [`web${SEP}?dl`, "WEB-DL"],
  [`web${SEP}?rip`, "WEBRip"],
  ["web", "WEB", "weak"],
  ["hdtv|pdtv|sdtv", "HDTV"],
  ["hdrip", "HDRip"],
  [`dvd${SEP}?rip|dvd${SEP}?r|dvd9|dvd5|dvd`, "DVD"],
]);

export const videoCodecRule = table("videoCodec", (ctx, v) => (ctx.out.release.videoCodec = v), [
  [`x${SEP}?265|h${SEP}?265|hevc`, "H.265"],
  [`x${SEP}?264|h${SEP}?264|avc`, "H.264"],
  ["av1", "AV1"],
  ["xvid|divx", "XviD"],
]);

const AUDIO: [string, string][] = [
  [`dts${SEP}?hd(?:${SEP}?ma)?|dts${SEP}?x`, "DTS-HD"],
  ["truehd", "TrueHD"],
  [`dd\\+|ddp|e${SEP}?ac${SEP}?3`, "DD+"],
  [`dd|ac${SEP}?3`, "AC3"],
  ["dts", "DTS"],
  ["aac", "AAC"],
  ["flac", "FLAC"],
  ["opus", "Opus"],
];

export const audioRule: ParserRule = {
  name: "audio",
  apply(ctx) {
    for (const [body, value] of AUDIO) {
      // Channels often stick to the codec: DDP5.1, AAC2.0, DTS-HD.MA.7.1
      scan(ctx, re(`(?:${body})(?:${SEP}?([1-9])[ ._]([01]))?`), (m) => {
        ctx.out.release.audioCodec ??= value;
        if (m[1]) ctx.out.release.audioChannels ??= `${m[1]}.${m[2]}`;
        hit(ctx, "audio", m);
      });
    }
    scan(ctx, re("atmos"), (m) => void hit(ctx, "audio", m));
  },
};

export const hdrRule = table("hdr", (ctx, v) => (ctx.out.release.hdr = v), [
  [`hdr10\\+|hdr10plus`, "HDR10+"],
  ["hdr10", "HDR10"],
  ["hdr", "HDR"],
  [`dovi|dolby${SEP}?vision`, "DV"],
  ["dv", "DV", "weak"],
]);

const LANGUAGES: [string, string][] = [
  ["german|deutsch|ger", "de"],
  ["english|eng", "en"],
  ["french|fra|vff", "fr"],
  ["spanish|spa", "es"],
  ["italian|ita", "it"],
  ["japanese|jpn|jap", "ja"],
];

export const languageRule: ParserRule = {
  name: "language",
  apply(ctx) {
    const langs = ctx.out.release.languages;
    for (const [body, code] of LANGUAGES) {
      scan(ctx, re(body), (m) =>
        weak(ctx, "language", m, () => {
          if (!langs.includes(code)) langs.push(code);
        }),
      );
    }
    // DL = dual language: the dubbed language plus the original, almost always English.
    scan(ctx, re(`dl|dual${SEP}?audio|dual`), (m) =>
      weak(ctx, "language", m, () => {
        if (!langs.includes("en")) langs.push("en");
      }),
    );
    scan(ctx, re("multi[ ._-]?subs?|multi"), (m) => weak(ctx, "language", m, () => {}));
    scan(ctx, re("dubbed|synced"), (m) => weak(ctx, "language", m, () => (ctx.out.release.dubbed = true)));
  },
};

export const flagsRule: ParserRule = {
  name: "flags",
  apply(ctx) {
    scan(ctx, re("proper|real"), (m) => weak(ctx, "flags", m, () => (ctx.out.release.proper = true)));
    scan(ctx, re("repack|rerip"), (m) => weak(ctx, "flags", m, () => (ctx.out.release.repack = true)));
    scan(ctx, re("internal|int|limited|readnfo|complete|ws|hc"), (m) => weak(ctx, "flags", m, () => {}));
  },
};

export const editionRule = table(
  "edition",
  (ctx, v) => (ctx.out.edition = v),
  [
    [`directors?'?s?${SEP}?cut`, "Director's Cut"],
    [`extended(?:${SEP}(?:cut|edition|version))?`, "Extended"],
    [`theatrical(?:${SEP}(?:cut|edition))?`, "Theatrical Cut"],
    [`final${SEP}cut`, "Final Cut"],
    [`ultimate${SEP}edition`, "Ultimate Edition"],
    [`special${SEP}edition`, "Special Edition"],
    [`(?:4k${SEP})?remastered`, "Remastered"],
    ["unrated", "Unrated"],
    ["uncut", "Uncut"],
    ["imax", "IMAX"],
    ["criterion", "Criterion"],
  ],
  true,
);

/** Talk shows and daily news: Show.2026.09.28 */
export const dateRule: ParserRule = {
  name: "date",
  apply(ctx) {
    scan(ctx, re(`((?:19|20)\\d{2})${SEP}(0[1-9]|1[0-2])${SEP}(0[1-9]|[12]\\d|3[01])`), (m) => {
      ctx.out.date = `${m[1]}-${m[2]}-${m[3]}`;
      ctx.episodeConfidence = Math.max(ctx.episodeConfidence, 0.85);
      hit(ctx, "date", m);
      return false;
    });
  },
};

/** S01E01, S01E01E02, S01E01-E03, S02E04-05 */
export const seasonEpisodeRule: ParserRule = {
  name: "seasonEpisode",
  apply(ctx) {
    scan(ctx, re(`s(\\d{1,2})${SEP}?e(\\d{1,4})((?:${SEP}?(?:-|e|${SEP}e)${SEP}?e?\\d{1,4}(?![0-9]))*)`), (m) => {
      const first = Number(m[2]);
      const tail = m[3] ?? "";
      const rest = [...tail.matchAll(/\d+/g)].map((t) => Number(t[0]));
      const last = rest.at(-1);
      const episodes = last === undefined ? [first] : tail.includes("-") ? range(first, last) : [first, ...rest];
      setEpisode(ctx, Number(m[1]), episodes, 0.95);
      hit(ctx, "seasonEpisode", m);
      return false;
    });
  },
};

/** 1x01, 1x01-02 */
export const crossEpisodeRule: ParserRule = {
  name: "crossEpisode",
  apply(ctx) {
    if (hasEpisode(ctx)) return;
    scan(ctx, re(`(\\d{1,2})x(\\d{2,3})(?:-x?(\\d{2,3}))?`), (m) => {
      const first = Number(m[2]);
      setEpisode(ctx, Number(m[1]), m[3] ? range(first, Number(m[3])) : [first], 0.9);
      hit(ctx, "crossEpisode", m);
      return false;
    });
  },
};

/** Staffel 2 Folge 3, Season 1 Episode 2, Staffel 2 (Pack), Folge 12 */
export const verboseEpisodeRule: ParserRule = {
  name: "verboseEpisode",
  apply(ctx) {
    if (hasEpisode(ctx)) return;
    const word = `(?:staffel|season|series)`;
    const ep = `(?:folge|episode|ep|e)`;
    // The number follows the word directly: "The Final Season - 28" is an absolute episode, not season 28.
    scan(ctx, re(`${word}[ ._]?(\\d{1,2})(?:${SEP}*${ep}${SEP}*(\\d{1,3}))?`), (m) => {
      if (m[2]) setEpisode(ctx, Number(m[1]), [Number(m[2])], 0.9);
      else ctx.out.season ??= Number(m[1]);
      hit(ctx, "verboseEpisode", m);
      return false;
    });
    if (hasEpisode(ctx)) return;
    scan(ctx, re(`(?:folge|episode|ep)${SEP}*(\\d{1,4})|e(\\d{2,4})`), (m) => {
      setEpisode(ctx, undefined, [Number(m[1] ?? m[2])], 0.75);
      hit(ctx, "verboseEpisode", m);
      return false;
    });
  },
};

/** Season packs: Show.S02.German.DL.1080p */
export const seasonPackRule: ParserRule = {
  name: "seasonPack",
  apply(ctx) {
    if (hasEpisode(ctx) || ctx.out.season !== undefined) return;
    scan(ctx, re(`s(\\d{1,2})(?:${SEP}?-${SEP}?s(\\d{1,2}))?`), (m) => {
      ctx.out.season = Number(m[1]);
      hit(ctx, "seasonPack", m);
      return false;
    });
  },
};

/** Anime: [Group] Title - 12 (1080p), Title - 1071v2 */
export const absoluteEpisodeRule: ParserRule = {
  name: "absoluteEpisode",
  apply(ctx) {
    if (hasEpisode(ctx)) return;
    const pattern = /\s-\s(\d{1,4})(?:v\d)?(?=$|[ ._]|\s*[[(])/g;
    scan(ctx, pattern, (m) => {
      const n = Number(m[1]);
      const looksLikeYear = m[1]!.length === 4 && n >= 1900 && n <= 2099;
      if (looksLikeYear && !ctx.bracketGroup) return;
      ctx.out.absolute = n;
      ctx.out.episodes = [n];
      ctx.episodeConfidence = Math.max(ctx.episodeConfidence, ctx.bracketGroup ? 0.8 : 0.65);
      hit(ctx, "absoluteEpisode", m);
      return false;
    });
  },
};

export const yearRule: ParserRule = {
  name: "year",
  apply(ctx) {
    const found: RegExpExecArray[] = [];
    scan(ctx, re("(19\\d{2}|20\\d{2})"), (m) => void found.push(m));
    // A year at the very start is part of the title (2001: A Space Odyssey, 1917).
    const m = found.filter((f) => f.index > 0).at(-1);
    if (!m) return;
    ctx.out.year = Number(m[1]);
    hit(ctx, "year", m);
  },
};

/** CD1, Disc 2, Part 2 (only after the year, so "Dune Part Two" stays a title) */
export const partRule: ParserRule = {
  name: "part",
  apply(ctx) {
    scan(ctx, re(`(?:cd|disc|disk)${SEP}?(\\d{1,2})`), (m) => {
      ctx.out.part = Number(m[1]);
      hit(ctx, "part", m);
      return false;
    });
    const year = ctx.hits.find((h) => h.rule === "year");
    if (ctx.out.part !== undefined || !year) return;
    scan(ctx, re(`(?:part|pt|teil)${SEP}?(\\d{1,2})`), (m) => {
      if (m.index < year.start) return;
      ctx.out.part = Number(m[1]);
      hit(ctx, "part", m);
      return false;
    });
  },
};

/** Compact numbering without markers: show.204.mkv, severance.204-205.720p */
export const compactEpisodeRule: ParserRule = {
  name: "compactEpisode",
  apply(ctx) {
    if (hasEpisode(ctx) || ctx.out.year !== undefined) return;
    scan(ctx, re("([1-9])(\\d{2})(?:-([1-9])?(\\d{2}))?"), (m) => {
      if (m.index === 0) return; // a number at the start is the title (300, 911)
      const season = Number(m[1]);
      if (m[3] && Number(m[3]) !== season) return;
      const first = Number(m[2]);
      setEpisode(ctx, season, m[4] ? range(first, Number(m[4])) : [first], 0.6);
      hit(ctx, "compactEpisode", m);
      return false;
    });
  },
};

/** Release group: the trailing -GRP after the release tokens. */
export const groupRule: ParserRule = {
  name: "group",
  apply(ctx) {
    if (ctx.out.release.group) return;
    const m = /-([a-z0-9][a-z0-9_]*)(?:\[[^\]]*\])?$/i.exec(ctx.name);
    if (!m || overlaps(ctx, m.index, m.index + m[0].length)) return;
    // Only after other release tokens, otherwise "Spider-Man" would yield group "Man".
    if (!ctx.hits.some((h) => h.boundsTitle && h.end <= m.index)) return;
    ctx.out.release.group = m[1];
    ctx.hits.push({ rule: "group", start: m.index, end: m.index + m[0].length, boundsTitle: false });
  },
};

/** Order matters: specific patterns run first and consume their span. `groupRule` runs after {@link resolvePending}. */
export const RULES: ParserRule[] = [
  sampleRule,
  resolutionRule,
  sourceRule,
  videoCodecRule,
  audioRule,
  hdrRule,
  flagsRule,
  editionRule,
  dateRule,
  seasonEpisodeRule,
  crossEpisodeRule,
  verboseEpisodeRule,
  seasonPackRule,
  absoluteEpisodeRule,
  yearRule,
  partRule,
  compactEpisodeRule,
  languageRule,
];
