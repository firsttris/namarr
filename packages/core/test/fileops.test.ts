import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupEmptyDirs,
  executeAll,
  executeOperation,
  freeName,
  type OperationRecord,
  type OperationResult,
  undoAll,
  undoOperation,
} from "../src/fileops/index.ts";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "namarr-fileops-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const p = (...parts: string[]) => path.join(tmp, ...parts);
async function write(rel: string, content = "data") {
  await fs.mkdir(path.dirname(p(rel)), { recursive: true });
  await fs.writeFile(p(rel), content);
  return p(rel);
}
const read = (rel: string) => fs.readFile(p(rel), "utf8");
const exists = (rel: string) =>
  fs.access(p(rel)).then(
    () => true,
    () => false,
  );
function done(r: OperationResult): OperationRecord {
  if (r.status !== "done") throw new Error(`expected done, got ${JSON.stringify(r)}`);
  return r.record;
}

describe("Aktionen", () => {
  it("move legt Ordner an und verschiebt", async () => {
    const from = await write("in/a.mkv");
    const record = done(await executeOperation({ from, to: p("out/Show/Season 01/a.mkv"), action: "move" }));
    expect(await exists("in/a.mkv")).toBe(false);
    expect(await read("out/Show/Season 01/a.mkv")).toBe("data");
    expect(record.createdDirs).toEqual([p("out"), p("out/Show"), p("out/Show/Season 01")]);
  });

  it("copy behält die Quelle", async () => {
    const from = await write("a.mkv");
    done(await executeOperation({ from, to: p("b.mkv"), action: "copy" }));
    expect(await read("a.mkv")).toBe("data");
    expect(await read("b.mkv")).toBe("data");
  });

  it("hardlink teilt die Inode (Seeding läuft weiter)", async () => {
    const from = await write("dl/a.mkv");
    const record = done(await executeOperation({ from, to: p("media/a.mkv"), action: "hardlink" }));
    const [a, b] = await Promise.all([fs.stat(from), fs.stat(p("media/a.mkv"))]);
    expect(a.ino).toBe(b.ino);
    expect(record.inode).toBe(a.ino);
  });

  it("symlink zeigt absolut auf die Quelle", async () => {
    const from = await write("a.mkv");
    done(await executeOperation({ from, to: p("links/a.mkv"), action: "symlink" }));
    expect(await fs.readlink(p("links/a.mkv"))).toBe(from);
  });

  it("test ändert nichts und meldet Konflikte", async () => {
    const from = await write("a.mkv");
    await write("b.mkv", "other");
    expect(await executeOperation({ from, to: p("b.mkv"), action: "test" })).toEqual({ status: "tested", to: p("b.mkv"), conflict: true });
    expect(await executeOperation({ from, to: p("c.mkv"), action: "test" })).toMatchObject({ conflict: false });
    expect(await exists("c.mkv")).toBe(false);
  });

  it("fehlende Quelle schlägt fehl, ohne etwas anzulegen", async () => {
    const r = await executeOperation({ from: p("missing.mkv"), to: p("x/y.mkv"), action: "move" });
    expect(r.status).toBe("failed");
    expect(await exists("x")).toBe(false);
  });

  it("gleicher Name wird übersprungen", async () => {
    const from = await write("a.mkv");
    expect(await executeOperation({ from, to: from, action: "move" })).toMatchObject({ status: "skipped" });
  });
});

describe("Konflikte", () => {
  it("skip lässt beide Dateien unangetastet", async () => {
    const from = await write("a.mkv", "new");
    await write("b.mkv", "old");
    expect(await executeOperation({ from, to: p("b.mkv"), action: "move" }, { conflict: "skip" })).toMatchObject({
      status: "skipped",
      reason: "Ziel existiert bereits",
    });
    expect(await read("a.mkv")).toBe("new");
    expect(await read("b.mkv")).toBe("old");
  });

  it("suffix wählt einen freien Namen", async () => {
    const from = await write("a.mkv", "new");
    await write("b.mkv", "old");
    await write("b (1).mkv", "older");
    const record = done(await executeOperation({ from, to: p("b.mkv"), action: "move" }, { conflict: "suffix" }));
    expect(record.to).toBe(p("b (2).mkv"));
    expect(await freeName(p("x.de.srt"))).toBe(p("x.de.srt").replace("x.de.srt", "x (1).de.srt"));
  });

  it("overwrite sichert das alte Ziel und Undo stellt es wieder her", async () => {
    const from = await write("a.mkv", "new");
    await write("b.mkv", "old");
    const record = done(await executeOperation({ from, to: p("b.mkv"), action: "move" }, { conflict: "overwrite", now: () => 42 }));
    expect(record.backup).toBe(`${p("b.mkv")}.namarr-bak-42`);
    expect(await read("b.mkv")).toBe("new");
    expect(await undoOperation(record)).toEqual({ status: "undone" });
    expect(await read("a.mkv")).toBe("new");
    expect(await read("b.mkv")).toBe("old");
    expect(await exists("b.mkv.namarr-bak-42")).toBe(false);
  });

  it("keep-better behält die größere Datei", async () => {
    const small = await write("small.mkv", "x");
    await write("target.mkv", "much bigger content");
    expect(await executeOperation({ from: small, to: p("target.mkv"), action: "copy" }, { conflict: "keep-better" })).toMatchObject({
      status: "skipped",
    });
    const big = await write("big.mkv", "even much much bigger content");
    done(await executeOperation({ from: big, to: p("target.mkv"), action: "copy" }, { conflict: "keep-better" }));
    expect(await read("target.mkv")).toBe("even much much bigger content");
  });

  it("Hardlink, der schon existiert, wird erkannt", async () => {
    const from = await write("a.mkv");
    await fs.link(from, p("b.mkv"));
    expect(await executeOperation({ from, to: p("b.mkv"), action: "hardlink" }, { conflict: "overwrite" })).toMatchObject({
      status: "skipped",
      reason: "Ziel ist bereits dieselbe Datei",
    });
  });
});

describe("Undo", () => {
  it("move zurück, angelegte Ordner werden entfernt", async () => {
    const from = await write("in/a.mkv");
    const record = done(await executeOperation({ from, to: p("out/Show/a.mkv"), action: "move" }));
    expect(await undoOperation(record)).toEqual({ status: "undone" });
    expect(await read("in/a.mkv")).toBe("data");
    expect(await exists("out")).toBe(false);
  });

  it("copy und hardlink: nur das Ziel verschwindet", async () => {
    const from = await write("a.mkv");
    const copy = done(await executeOperation({ from, to: p("c.mkv"), action: "copy" }));
    const link = done(await executeOperation({ from, to: p("l.mkv"), action: "hardlink" }));
    expect(await undoOperation(copy)).toEqual({ status: "undone" });
    expect(await undoOperation(link)).toEqual({ status: "undone" });
    expect(await exists("c.mkv")).toBe(false);
    expect(await exists("l.mkv")).toBe(false);
    expect(await read("a.mkv")).toBe("data");
  });

  it("symlink-Undo", async () => {
    const from = await write("a.mkv");
    const record = done(await executeOperation({ from, to: p("s.mkv"), action: "symlink" }));
    expect(await undoOperation(record)).toEqual({ status: "undone" });
    expect(await exists("s.mkv")).toBe(false);
  });

  it("verweigert Undo, wenn die Zieldatei verändert wurde", async () => {
    const from = await write("a.mkv");
    const record = done(await executeOperation({ from, to: p("b.mkv"), action: "move" }));
    await fs.writeFile(p("b.mkv"), "changed and longer");
    expect(await undoOperation(record)).toMatchObject({ status: "failed", reason: "Zieldatei wurde seit der Ausführung verändert" });
    expect(await read("b.mkv")).toBe("changed and longer");
  });

  it("verweigert Undo, wenn die Quelle wieder existiert", async () => {
    const from = await write("a.mkv");
    const record = done(await executeOperation({ from, to: p("b.mkv"), action: "move" }));
    await write("a.mkv", "new file");
    expect(await undoOperation(record)).toMatchObject({ status: "failed" });
    expect(await read("a.mkv")).toBe("new file");
  });

  it("fehlendes Ziel", async () => {
    const from = await write("a.mkv");
    const record = done(await executeOperation({ from, to: p("b.mkv"), action: "move" }));
    await fs.rm(p("b.mkv"));
    expect(await undoOperation(record)).toMatchObject({ status: "failed" });
  });
});

describe("Batch und Abbruch", () => {
  it("Abbruch mitten im Job: fertige bleiben fertig, der Rest unberührt", async () => {
    const ops = await Promise.all(
      [1, 2, 3, 4, 5].map(async (i) => ({ from: await write(`in/${i}.mkv`), to: p(`out/${i}.mkv`), action: "move" as const })),
    );
    const controller = new AbortController();
    const results = await executeAll(ops, {
      signal: controller.signal,
      onResult: (i) => {
        if (i === 1) controller.abort();
      },
    });
    expect(results).toHaveLength(2);
    expect(await exists("out/1.mkv")).toBe(true);
    expect(await exists("out/2.mkv")).toBe(true);
    for (const i of [3, 4, 5]) {
      expect(await exists(`in/${i}.mkv`)).toBe(true);
      expect(await exists(`out/${i}.mkv`)).toBe(false);
    }
    // Und alles lässt sich zurücknehmen, auch die angelegten Ordner.
    expect(await undoAll(results.map(done))).toEqual([{ status: "undone" }, { status: "undone" }]);
    expect(await exists("out")).toBe(false);
  });

  it("ein Fehler stoppt den Batch nicht", async () => {
    const ok = await write("ok.mkv");
    const results = await executeAll([
      { from: p("missing.mkv"), to: p("x.mkv"), action: "move" },
      { from: ok, to: p("y.mkv"), action: "move" },
    ]);
    expect(results.map((r) => r.status)).toEqual(["failed", "done"]);
  });
});

describe("Aufräumen", () => {
  it("entfernt leere Ordner und Junk bis zur Wurzel", async () => {
    await write("dl/Show.S01/Season/RARBG.txt");
    await write("dl/Show.S01/Thumbs.db");
    await write("dl/keep/a.mkv");
    const removed = await cleanupEmptyDirs(p("dl/Show.S01/Season"), p("dl"));
    expect(removed).toEqual([p("dl/Show.S01/Season"), p("dl/Show.S01")]);
    expect(await exists("dl")).toBe(true);
    expect(await exists("dl/keep/a.mkv")).toBe(true);
  });

  it("stoppt bei echten Dateien", async () => {
    await write("dl/x/notes.md");
    expect(await cleanupEmptyDirs(p("dl/x"), p("dl"))).toEqual([]);
  });
});
