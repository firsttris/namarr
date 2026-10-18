import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { type Db, openDatabase, setSettings } from "@namarr/db";
import { DemoProvider } from "@namarr/providers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readEnv } from "~/server/env.server";
import { EventBus } from "~/server/events.server";
import { JobService } from "~/server/jobs.server";
import { handleMcp, PROTOCOL_VERSIONS } from "~/server/mcp.server";
import type { Runtime } from "~/server/runtime.server";

let tmp: string;
let db: Db;
let rt: Runtime;

const log = { info: () => {}, warn: () => {}, error: () => {} };
const tv = () => path.join(tmp, "downloads/tv");
const media = () => path.join(tmp, "media/tv");
const episode = "Severance.S02E01.German.DL.1080p.WEB.h264-GRP.mkv";
const exists = (p: string) =>
  fs.access(p).then(
    () => true,
    () => false,
  );

function runtimeWith(env: Record<string, string> = {}): Runtime {
  const bus = new EventBus();
  const provider = () => new DemoProvider();
  const jobs = new JobService({ db, bus, provider, log, notify: async () => {} });
  return { env: readEnv(env), db, bus, jobs, watch: undefined as never, provider, log: log as never, startedAt: new Date() };
}

beforeEach(async () => {
  tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "namarr-mcp-")));
  db = openDatabase(":memory:");
  setSettings(db, { folders: [{ path: tmp, name: "root", kind: "folder" }] });
  await fs.mkdir(tv(), { recursive: true });
  await fs.writeFile(path.join(tv(), episode), "x");
  await fs.mkdir(media(), { recursive: true });
  rt = runtimeWith();
});

afterEach(async () => {
  await rt.jobs.idle();
  await fs.rm(tmp, { recursive: true, force: true });
});

type ToolInfo = {
  name: string;
  inputSchema: { type: string; required?: string[]; properties: Record<string, unknown> };
  annotations: Record<string, boolean>;
};
type RpcResult = { protocolVersion?: string; instructions?: string; tools?: ToolInfo[]; isError?: boolean; content?: { text: string }[] };

let nextId = 1;
const post = (body: unknown, headers: Record<string, string> = {}) =>
  handleMcp(
    rt,
    new Request("http://namarr:8420/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", host: "namarr:8420", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
async function rpc(method: string, params?: unknown) {
  const res = await post({ jsonrpc: "2.0", id: nextId++, method, params });
  expect(res.status).toBe(200);
  return (await res.json()) as { result: RpcResult; error?: { code: number; message: string } };
}
async function call(name: string, args: object = {}) {
  const { result } = await rpc("tools/call", { name, arguments: args });
  return { isError: result.isError, data: JSON.parse(result.content![0]!.text) };
}

describe("MCP: Protokoll", () => {
  it("initialize nennt Version, Tools und Anleitung", async () => {
    const { result } = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "t", version: "1" },
    });
    expect(result).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "namarr" } });
    expect(result.instructions).toMatch(/create_job/);
    // Unknown: the newest, the client decides.
    expect((await rpc("initialize", { protocolVersion: "1999-01-01" })).result.protocolVersion).toBe(PROTOCOL_VERSIONS[0]);
  });

  it("Notifications ohne Antwort, unbekannte Methoden als JSON-RPC-Fehler", async () => {
    expect((await post({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
    expect((await rpc("resources/list")).error).toMatchObject({ code: -32601 });
    expect((await rpc("ping")).result).toEqual({});
    expect((await post("{kaputt")).status).toBe(400);
    expect((await post([{ jsonrpc: "2.0", id: 1, method: "ping" }])).status).toBe(400);
  });

  it("nur POST mit JSON, keine fremde Origin", async () => {
    const req = (init: RequestInit) => handleMcp(rt, new Request("http://namarr:8420/api/mcp", init));
    expect((await req({ method: "GET" })).status).toBe(405);
    expect((await req({ method: "POST", headers: { "content-type": "text/plain" }, body: "{}" })).status).toBe(415);
    const ping = { jsonrpc: "2.0", id: 1, method: "ping" };
    expect((await post(ping, { origin: "http://evil.example" })).status).toBe(403);
    expect((await post(ping, { origin: "null" })).status).toBe(403);
    expect((await post(ping, { origin: "http://namarr:8420" })).status).toBe(200);
    // Media types are case-insensitive.
    expect((await post(ping, { "content-type": "Application/JSON; charset=utf-8" })).status).toBe(200);
  });

  it("tools/list mit JSON-Schema und Hinweisen; readonly lässt Dateiänderungen weg", async () => {
    const { result } = await rpc("tools/list");
    const tools = result.tools!;
    const names = tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["get_overview", "create_job", "list_job_items", "execute_job", "undo", "approve_inbox"]));
    const create = tools.find((t) => t.name === "create_job")!;
    expect(create.inputSchema).toMatchObject({ type: "object", required: ["paths"] });
    expect(create.inputSchema.properties.action).toBeUndefined();
    expect(tools.find((t) => t.name === "undo")!.annotations).toMatchObject({ destructiveHint: true });

    rt = runtimeWith({ NAMARR_MCP: "readonly" });
    const readonly = (await rpc("tools/list")).result.tools!.map((t) => t.name);
    expect(readonly).toContain("create_job");
    expect(readonly).not.toContain("execute_job");
    expect(readonly).not.toContain("undo");
    expect((await rpc("tools/call", { name: "undo", arguments: { jobId: 1 } })).error).toMatchObject({ code: -32602 });
  });

  it("NAMARR_MCP: on, readonly, off; Unbekanntes schaltet ab", () => {
    expect(readEnv({}).mcp).toBe("on");
    expect(readEnv({ NAMARR_MCP: "ReadOnly" }).mcp).toBe("readonly");
    const typo = readEnv({ NAMARR_MCP: "of" });
    expect(typo.mcp).toBe("off");
    expect(typo.warnings).toEqual([expect.stringContaining("NAMARR_MCP")]);
  });
});

describe("MCP: Tools", () => {
  it("Vorschau, Ausführen, Rückgängig: wie in der Werkbank", async () => {
    const overview = await call("get_overview");
    expect(overview.data.folders).toEqual([{ path: tmp, name: "root", kind: "folder" }]);
    expect(overview.data.formats.series.default).toBe("jellyfin");

    const browse = await call("browse_folder", { path: tv() });
    expect(browse.data.entries).toEqual([expect.objectContaining({ name: episode, video: true })]);

    const preview = await call("create_job", { paths: [tv()], targetRoot: media() });
    expect(preview.isError).toBe(false);
    expect(preview.data.job).toMatchObject({ status: "ready", action: "test", busy: false });
    const [item] = preview.data.items;
    const target = path.join(media(), "Severance (2022)/Season 02/Severance (2022) - S02E01 - Hallo, Frau Cobel.mkv");
    expect(item).toMatchObject({ state: "ready", target, match: { title: "Severance", kind: "series" } });
    expect(item.episodes).toEqual(["S02E01 Hallo, Frau Cobel"]);
    // A preview moves nothing.
    expect(await exists(path.join(tv(), episode))).toBe(true);
    expect(await exists(target)).toBe(false);

    const run = await call("execute_job", { jobId: preview.data.job.jobId, action: "move" });
    expect(run.data.job.status).toBe("done");
    expect(await exists(target)).toBe(true);
    expect(await exists(path.join(tv(), episode))).toBe(false);

    const history = await call("list_history");
    expect(history.data).toEqual([expect.objectContaining({ action: "move", to: target, undoneAt: null })]);

    const undone = await call("undo", { jobId: preview.data.job.jobId });
    expect(undone.isError).toBe(false);
    expect(await exists(path.join(tv(), episode))).toBe(true);
    expect(await exists(target)).toBe(false);
  });

  it("Fehler kommen als Tool-Ergebnis zurück, lesbar fürs Modell", async () => {
    const bad = await call("create_job", { paths: [] });
    expect(bad.isError).toBe(true);
    expect(bad.data.error).toMatch(/paths/);
    const outside = await call("create_job", { paths: ["/etc"] });
    expect(outside.isError).toBe(true);
    expect(outside.data.error).not.toMatch(/paths_outsideRoots/);
    expect((await call("get_job", { jobId: 999 })).isError).toBe(true);
    expect((await call("approve_inbox", {})).data.error).toMatch(/itemIds or minConfidence/);
  });

  it("Korrektur per search_metadata und update_item", async () => {
    const { data } = await call("create_job", { paths: [tv()], targetRoot: media() });
    const found = await call("search_metadata", { q: "Severance", kind: "series" });
    expect(found.data[0]).toMatchObject({ title: "Severance", kind: "series" });
    const fixed = await call("update_item", { itemId: data.items[0].itemId, excluded: true });
    expect(fixed.data).toMatchObject({ excluded: true, state: "skipped" });
  });
});
