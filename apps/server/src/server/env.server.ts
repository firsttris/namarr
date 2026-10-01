import * as path from "node:path";

/** Process configuration from environment variables. */
export type Env = {
  configDir: string;
  host: string;
  port: number;
  /** Required whenever the server listens on anything but loopback. */
  token?: string;
  /** Trusted reverse-proxy header carrying the user (e.g. `Remote-User`). */
  authHeader?: string;
  /** Allowed root paths seeded on first start (comma separated). */
  roots: string[];
  /** Path prefixes of other containers mapped to namarr's view: `/downloads:/data/downloads`. */
  pathMap: [from: string, to: string][];
  demo: boolean;
  logLevel: string;
};

export function readEnv(env: Record<string, string | undefined> = process.env): Env {
  return {
    configDir: path.resolve(env.NAMARR_CONFIG_DIR ?? "./config"),
    host: env.NAMARR_HOST ?? "127.0.0.1",
    port: Number(env.NAMARR_PORT ?? env.PORT ?? 8420),
    token: env.NAMARR_TOKEN || undefined,
    authHeader: env.NAMARR_AUTH_HEADER || undefined,
    pathMap: (env.NAMARR_PATH_MAP ?? "")
      .split(",")
      .map((pair) => pair.trim().split(":"))
      .filter((p): p is [string, string] => p.length === 2 && Boolean(p[0]) && Boolean(p[1]))
      .map(([from, to]) => [from.replace(/\/+$/, ""), to.replace(/\/+$/, "")]),
    roots: (env.NAMARR_ROOTS ?? "")
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean),
    demo: env.NAMARR_DEMO === "1" || env.NAMARR_DEMO === "true",
    logLevel: env.NAMARR_LOG_LEVEL ?? "info",
  };
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

/** Outside loopback a token is mandatory: the server can move and delete files. */
export function assertSafeBinding(env: Env): void {
  if (!LOOPBACK.has(env.host) && !env.token && !env.authHeader) {
    throw new Error(
      `NAMARR_TOKEN is required: without a token namarr only listens on 127.0.0.1 (requested: ${env.host}). / NAMARR_TOKEN fehlt: Ohne Token lauscht namarr nur auf 127.0.0.1.`,
    );
  }
}
