import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isInside, resolveInRoots, VIDEO_EXTENSIONS } from "@namarr/core";
import { type InferResult, type InferSample, inferFormat } from "@namarr/core/formatter/infer";
import { msg } from "@namarr/core/i18n";
import { matchAll } from "@namarr/core/matcher";
import { parse } from "@namarr/core/parser";
import type { Parsed } from "@namarr/core/types";
import { allowedRoots, getSettings } from "@namarr/db";
import type { Runtime } from "./runtime.server.ts";

/** How many files of the library are checked, the chosen one included. */
const SAMPLES = 12;
/** A large library is not read in full: this many files are enough to pick samples from. */
const SCAN_LIMIT = 5000;

export type LibraryFormat = InferResult & {
  kind: "movie" | "series";
  /** The library folder the paths are relative to. */
  root: string;
  /** The language the episode titles matched in. */
  language: string;
  /** No metadata source: only what the file names say (no episode titles). */
  offline: boolean;
};

const isVideo = (name: string) => VIDEO_EXTENSIONS.includes(path.extname(name).slice(1).toLowerCase());

/**
 * Video files of a library, spread over its top folders (one series or movie each): the first file
 * of every folder, then the second, … so the samples cover many titles, not one season.
 */
export async function sampleFiles(root: string, chosen: string, max = SAMPLES): Promise<string[]> {
  const byTop = new Map<string, string[]>();
  let seen = 0;
  const walk = async (dir: string, top: string, depth: number) => {
    if (depth > 4 || seen >= SCAN_LIMIT) return;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "@eaDir" || seen >= SCAN_LIMIT) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full, top || full, depth + 1);
      else if (e.isFile() && isVideo(e.name)) {
        seen++;
        const key = top || root;
        byTop.set(key, [...(byTop.get(key) ?? []), full]);
      }
    }
  };
  await walk(root, "", 0);
  const out = [chosen];
  const lists = [...byTop.values()];
  for (let round = 0; out.length < max && lists.some((l) => l.length > round); round++) {
    for (const list of lists) {
      const file = list[round];
      if (file && !out.includes(file) && out.length < max) out.push(file);
    }
  }
  return out;
}

const formatKind = (p: Parsed) => (p.kind.value === "movie" ? "movie" : p.kind.value === "episode" ? "episode" : undefined);

/** The naming format of the library a file lies in, checked against more of its files. */
export async function libraryFormat(rt: Runtime, file: string): Promise<LibraryFormat> {
  const settings = getSettings(rt.db);
  const real = await resolveInRoots(file, allowedRoots(settings));
  // The innermost folder from the settings: paths are relative to the library, not to /.
  const root = settings.folders
    .map((f) => path.resolve(f.path))
    .filter((f) => isInside(real, f))
    .sort((a, b) => b.length - a.length)[0];
  if (!root || !isVideo(real)) throw new Error(msg("formats_infer_notAVideo"));

  const kind = formatKind(parse(path.relative(root, real)));
  if (!kind) throw new Error(msg("formats_infer_unknownKind"));
  const files = (await sampleFiles(root, real))
    .map((f) => ({ file: f, rel: path.relative(root, f) }))
    .map((f) => ({ ...f, parsed: parse(f.rel) }))
    .filter((f) => formatKind(f.parsed) === kind);

  const provider = rt.provider();
  const infer = async (language: string) => {
    const matches = provider
      ? await matchAll(
          files.map((f, i) => ({ key: String(i), parsed: f.parsed })),
          provider,
          { language },
        )
      : new Map();
    const samples: InferSample[] = files.map((f, i) => {
      const m = matches.get(String(i));
      return { path: f.rel, input: { parsed: f.parsed, match: m?.best, episodes: m?.episodes, original: path.basename(f.file) } };
    });
    return { ...inferFormat(samples, kind)!, language };
  };

  // Episode titles may be in another language than the settings: English is tried as well.
  let result = await infer(settings.language);
  if (provider && result.matched < files.length && !settings.language.startsWith("en")) {
    const english = await infer("en-US");
    if (english.matched > result.matched) result = english;
  }
  return { ...result, kind: kind === "movie" ? "movie" : "series", root, offline: !provider };
}
