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
  /** Where that header may come from: IPs or IPv4 CIDR; loopback unless set. */
  trustedProxies: string[];
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
    trustedProxies: (env.NAMARR_TRUSTED_PROXIES ?? "127.0.0.1,::1")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean),
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

const ipv4 = (ip: string) => {
  const parts = ip.split(".").map(Number);
  return parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
    ? parts.reduce((acc, n) => acc * 256 + n, 0)
    : undefined;
};

/** Whether a peer address is one of the trusted proxies (`10.88.0.5`, `10.88.0.0/16`, `::1`). */
export function isTrustedProxy(address: string | undefined, trusted: string[]): boolean {
  if (!address) return false;
  const ip = address.replace(/^::ffff:/i, "");
  return trusted.some((entry) => {
    const [net, bits] = entry.split("/");
    if (bits === undefined) return net === ip;
    const a = ipv4(ip);
    const b = ipv4(net!);
    const n = Number(bits);
    if (a === undefined || b === undefined || !Number.isInteger(n) || n < 0 || n > 32) return false;
    const mask = n === 0 ? 0 : (0xffffffff << (32 - n)) >>> 0;
    return (a & mask) >>> 0 === (b & mask) >>> 0;
  });
}

/** Outside loopback a token is mandatory: the server can move and delete files. */
export function assertSafeBinding(env: Env): void {
  if (!LOOPBACK.has(env.host) && !env.token && !env.authHeader) {
    throw new Error(
      `NAMARR_TOKEN is required: without a token namarr only listens on 127.0.0.1 (requested: ${env.host}). / NAMARR_TOKEN fehlt: Ohne Token lauscht namarr nur auf 127.0.0.1.`,
    );
  }
}
