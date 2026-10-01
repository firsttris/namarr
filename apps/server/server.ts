/**
 * Production entry: one long-lived Bun process. Serves the built client assets, hands every
 * other request to TanStack Start, and starts the runtime (migrations, job worker, watch
 * folders) once at boot instead of on the first request.
 */
import { existsSync } from "node:fs";
import * as path from "node:path";
import { assertSafeBinding, readEnv } from "./src/server/env.server.ts";
import { dropPrivileges } from "./src/server/privileges.server.ts";
import { runtime } from "./src/server/runtime.server.ts";

const env = readEnv();
assertSafeBinding(env);
const ids = dropPrivileges(env.configDir);
const rt = runtime();
if (ids) rt.log.info(ids, "Läuft als PUID/PGID");

// Next to the sources (bun run server.ts) or bundled into dist/ (Docker).
const dist = existsSync(path.join(import.meta.dir, "server/server.js")) ? import.meta.dir : path.join(import.meta.dir, "dist");
const { default: handler } = (await import(path.join(dist, "server/server.js"))) as {
  default: { fetch: (req: Request) => Promise<Response> };
};
const clientDir = path.join(dist, "client");

async function serveStatic(pathname: string): Promise<Response | undefined> {
  if (pathname === "/" || pathname.includes("..")) return undefined;
  const file = Bun.file(path.join(clientDir, pathname));
  if (!(await file.exists())) return undefined;
  const immutable = pathname.startsWith("/assets/");
  return new Response(file, {
    headers: { "cache-control": immutable ? "public, max-age=31536000, immutable" : "public, max-age=3600" },
  });
}

const server = Bun.serve({
  hostname: env.host,
  port: env.port,
  // SSE connections stay open; Bun's default idle timeout would cut them.
  idleTimeout: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "GET") {
      const asset = await serveStatic(decodeURIComponent(url.pathname));
      if (asset) return asset;
    }
    return handler.fetch(req);
  },
  error(err) {
    rt.log.error({ err }, "Unbehandelter Fehler");
    return new Response("Interner Fehler", { status: 500 });
  },
});

rt.log.info({ url: `http://${server.hostname}:${server.port}` }, "namarr läuft");

async function shutdown(signal: string) {
  rt.log.info({ signal }, "Beende namarr");
  await rt.watch.stop();
  // Let a running file operation finish; the queue stops between files.
  await Promise.race([rt.jobs.idle(), new Promise((r) => setTimeout(r, 10_000))]);
  server.stop();
  rt.db.$client.close();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
