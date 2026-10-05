import { readdirSync, statSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { brotliCompressSync, constants, createGzip, gzipSync } from "node:zlib";

/** Encodings written next to the file at build time, in order of preference. */
const ENCODINGS = [
  { name: "br", ext: ".br" },
  { name: "gzip", ext: ".gz" },
] as const;
type Encoding = (typeof ENCODINGS)[number]["name"];
const COMPRESSIBLE = /\.(js|mjs|css|html|svg|json|txt|xml|webmanifest)$/;

/** Build step: writes `.br` and `.gz` next to every text asset where that saves something. */
export async function precompress(dir: string): Promise<number> {
  let written = 0;
  for (const rel of await fs.readdir(dir, { recursive: true })) {
    const file = path.join(dir, rel);
    if (!COMPRESSIBLE.test(rel) || !(await fs.stat(file)).isFile()) continue;
    const data = await fs.readFile(file);
    if (data.length < 1024) continue;
    const variants = [
      [".br", brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } })],
      [".gz", gzipSync(data, { level: 9 })],
    ] as const;
    for (const [ext, out] of variants) {
      if (out.length >= data.length) continue;
      await fs.writeFile(file + ext, out);
      written++;
    }
  }
  return written;
}

type Entry = { file: string; type: string; size: number; mtime: Date; etag: string; encodings: Map<Encoding, number> };

/**
 * Serves the built client files (GET and HEAD). The list is read once at boot, the build output
 * does not change at runtime. Picks a precompressed variant by Accept-Encoding and answers
 * If-None-Match / If-Modified-Since with 304.
 */
export function staticFiles(dir: string): (req: Request, pathname: string) => Response | undefined {
  const files = new Map<string, Entry>();
  let names: string[] = [];
  try {
    names = readdirSync(dir, { recursive: true }) as string[];
  } catch {
    // no client build (tests, dev): everything goes to the handler
  }
  const all = new Set(names);
  for (const rel of names) {
    const file = path.join(dir, rel);
    const stat = statSync(file);
    // a precompressed variant is served for its original, not under its own name
    if (!stat.isFile() || ENCODINGS.some((e) => rel.endsWith(e.ext) && all.has(rel.slice(0, -e.ext.length)))) continue;
    const encodings = new Map<Encoding, number>();
    for (const e of ENCODINGS) {
      const variant = statSync(file + e.ext, { throwIfNoEntry: false });
      if (variant) encodings.set(e.name, variant.size);
    }
    files.set(`/${rel.split(path.sep).join("/")}`, {
      file,
      type: Bun.file(file).type,
      size: stat.size,
      mtime: stat.mtime,
      etag: `W/"${stat.size.toString(16)}-${stat.mtime.getTime().toString(16)}"`,
      encodings,
    });
  }

  return (req, pathname) => {
    const entry = files.get(pathname);
    if (!entry) return undefined;
    const headers = new Headers({
      "content-type": entry.type,
      "cache-control": pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "public, max-age=3600",
      etag: entry.etag,
      "last-modified": entry.mtime.toUTCString(),
    });
    if (entry.encodings.size) headers.set("vary", "accept-encoding");
    if (notModified(req.headers, entry)) return new Response(null, { status: 304, headers });

    const encoding = ENCODINGS.find((e) => entry.encodings.has(e.name) && accepts(req.headers, e.name));
    if (encoding) headers.set("content-encoding", encoding.name);
    headers.set("content-length", String(encoding ? entry.encodings.get(encoding.name) : entry.size));
    if (req.method === "HEAD") return new Response(null, { headers });
    return new Response(Bun.file(encoding ? entry.file + encoding.ext : entry.file), { headers });
  };
}

function notModified(headers: Headers, entry: Entry): boolean {
  const ifNoneMatch = headers.get("if-none-match");
  if (ifNoneMatch !== null) {
    const opaque = (tag: string) => tag.trim().replace(/^W\//, "");
    return ifNoneMatch.split(",").some((tag) => tag.trim() === "*" || opaque(tag) === opaque(entry.etag));
  }
  const since = Date.parse(headers.get("if-modified-since") ?? "");
  return !Number.isNaN(since) && Math.floor(entry.mtime.getTime() / 1000) * 1000 <= since;
}

/** Whether Accept-Encoding allows `encoding` (listed or `*`, and not `q=0`). */
export function accepts(headers: Headers, encoding: string): boolean {
  let star = false;
  for (const part of (headers.get("accept-encoding") ?? "").split(",")) {
    const [name = "", ...params] = part.trim().toLowerCase().split(";");
    const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    const allowed = q === undefined || Number(q.slice(2)) > 0;
    if (name === encoding) return allowed;
    if (name === "*") star = allowed;
  }
  return star;
}

/**
 * gzip for SSR HTML. Flushes after every chunk, so streamed HTML still reaches the browser piece
 * by piece (CompressionStream would hold it back until the end). Other responses, the SSE stream
 * above all, pass through unchanged.
 */
export function compressHtml(req: Request, res: Response): Response {
  if (
    !res.body ||
    req.method === "HEAD" ||
    res.headers.has("content-encoding") ||
    !res.headers.get("content-type")?.startsWith("text/html") ||
    !accepts(req.headers, "gzip")
  ) {
    return res;
  }
  const body = res.body;
  const gz = createGzip({ flush: constants.Z_SYNC_FLUSH });
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      gz.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
      gz.on("end", () => controller.close());
      gz.on("error", (err) => controller.error(err));
      void (async () => {
        try {
          for await (const chunk of body) gz.write(chunk);
          gz.end();
        } catch (err) {
          gz.destroy(err as Error);
        }
      })();
    },
    cancel(reason) {
      gz.destroy();
      return body.cancel(reason);
    },
  });
  const headers = new Headers(res.headers);
  headers.set("content-encoding", "gzip");
  headers.delete("content-length");
  headers.append("vary", "accept-encoding");
  return new Response(stream, { status: res.status, statusText: res.statusText, headers });
}
