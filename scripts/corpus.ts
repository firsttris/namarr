/**
 * Runs the parser against the release-name corpus and prints the hit rate per category
 * as a Markdown table (README, CI report). `--fail-under=0.95` makes CI fail below that rate.
 *
 *   bun scripts/corpus.ts
 *   bun scripts/corpus.ts --verbose
 */
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { parse } from "../packages/core/src/parser/index.ts";

type Case = { name: string; category: string; expect: Record<string, unknown> };

const file = new URL("../packages/core/test/corpus/releases.yaml", import.meta.url);
const corpus = parseYaml(readFileSync(file, "utf8")) as Case[];
const verbose = process.argv.includes("--verbose");
const failUnder = Number(process.argv.find((a) => a.startsWith("--fail-under="))?.split("=")[1] ?? 0);

const LABELS: Record<string, string> = { movie: "Filme", series: "Serien", anime: "Anime", german: "Deutsch" };
const stats = new Map<string, { total: number; ok: number }>();
const failures: string[] = [];

for (const c of corpus) {
  const p = parse(c.name);
  const flat: Record<string, unknown> = { ...p, ...p.release, kind: p.kind.value };
  const wrong = Object.entries(c.expect).filter(([k, v]) => JSON.stringify(flat[k] ?? null) !== JSON.stringify(v ?? null));
  const s = stats.get(c.category) ?? { total: 0, ok: 0 };
  s.total++;
  if (!wrong.length) s.ok++;
  else failures.push(`${c.name}: ${wrong.map(([k, v]) => `${k} = ${JSON.stringify(flat[k])}, erwartet ${JSON.stringify(v)}`).join("; ")}`);
  stats.set(c.category, s);
}

const pct = (ok: number, total: number) => `${((ok / total) * 100).toFixed(1)} %`;
let ok = 0;
console.log("| Kategorie | Namen | Korrekt | Trefferquote |\n|---|---:|---:|---:|");
for (const [cat, s] of [...stats].sort()) {
  ok += s.ok;
  console.log(`| ${LABELS[cat] ?? cat} | ${s.total} | ${s.ok} | ${pct(s.ok, s.total)} |`);
}
console.log(`| **Gesamt** | **${corpus.length}** | **${ok}** | **${pct(ok, corpus.length)}** |`);
if (verbose && failures.length) console.log(`\nFehlschläge:\n${failures.map((f) => `- ${f}`).join("\n")}`);
if (ok / corpus.length < failUnder) {
  console.error(`Trefferquote ${pct(ok, corpus.length)} unter ${failUnder * 100} %`);
  process.exit(1);
}
