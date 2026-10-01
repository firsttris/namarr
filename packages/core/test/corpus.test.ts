import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { parse } from "../src/parser/index.ts";
import type { Parsed } from "../src/types.ts";

type Case = { name: string; category: string; expect: Record<string, unknown> };

const corpus = parseYaml(readFileSync(new URL("./corpus/releases.yaml", import.meta.url), "utf8")) as Case[];

/** Flattens the parser output to the corpus' field names. */
export function flatten(p: Parsed): Record<string, unknown> {
  const { release, kind, ...rest } = p;
  return { ...rest, ...release, kind: kind.value };
}

describe("Parser-Korpus", () => {
  it("hat Testfälle in jeder Kategorie", () => {
    const categories = new Set(corpus.map((c) => c.category));
    expect([...categories].sort()).toEqual(["anime", "german", "movie", "series"]);
  });

  it.each(corpus.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const actual = flatten(parse(c.name));
    for (const [field, value] of Object.entries(c.expect)) {
      expect({ field, value: actual[field] ?? null }).toEqual({ field, value: value ?? null });
    }
  });
});
