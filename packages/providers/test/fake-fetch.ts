import { gzipSync } from "node:zlib";

const STATUS = Symbol("status");
const GZIP = Symbol("gzip");

/** A reply with another HTTP status. */
export const status = (code: number, body?: unknown) => ({ [STATUS]: code, body });
/** A gzip-compressed body without content-encoding, like AniDB's title dump. */
export const gzip = (text: string) => ({ [GZIP]: text });

/**
 * Replays canned responses by method + path + query (exact, or prefix with a trailing `*`).
 * The live APIs are not reachable from CI; the bodies follow the documented formats.
 */
export function fakeFetch(routes: Record<string, unknown>) {
  const calls: { method: string; url: string; headers: Headers; body?: string }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const key = `${method} ${url.pathname}${url.search}`;
    calls.push({ method, url: `${url.pathname}${url.search}`, headers: new Headers(init?.headers), body: init?.body as string });
    const hit = Object.entries(routes).find(([k]) => (k.endsWith("*") ? key.startsWith(k.slice(0, -1)) : key === k));
    if (!hit) return new Response("not found", { status: 404 });
    const reply = hit[1] as Record<symbol, unknown> & { body?: unknown };
    if (reply && typeof reply === "object" && GZIP in reply) return new Response(gzipSync(String(reply[GZIP])));
    if (reply && typeof reply === "object" && STATUS in reply) {
      return new Response(reply.body === undefined ? "" : JSON.stringify(reply.body), {
        status: reply[STATUS] as number,
        headers: { "retry-after": "0" },
      });
    }
    return new Response(typeof reply === "string" ? reply : JSON.stringify(reply), { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}
