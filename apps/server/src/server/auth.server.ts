import { createHmac, timingSafeEqual } from "node:crypto";
import type { Env } from "./env.server.ts";

export const SESSION_COOKIE = "namarr_session";

export function sessionValue(token: string): string {
  return createHmac("sha256", token).update("namarr-session-v1").digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function checkToken(env: Env, candidate: string): boolean {
  return Boolean(env.token) && safeEqual(candidate, env.token!);
}

function cookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

/**
 * One check for UI and API: session cookie (UI), `Authorization: Bearer <token>` or Basic Auth
 * with the token as password (API, scripts), or a trusted reverse-proxy header.
 * Without token and proxy header, the server only listens on loopback and needs no login.
 */
export function isAuthenticated(env: Env, headers: Headers): boolean {
  if (!env.token && !env.authHeader) return true;
  if (env.authHeader && headers.get(env.authHeader)) return true;
  if (!env.token) return false;
  const session = cookie(headers.get("cookie"), SESSION_COOKIE);
  if (session && safeEqual(session, sessionValue(env.token))) return true;
  const auth = headers.get("authorization") ?? "";
  if (auth.startsWith("Bearer ")) return checkToken(env, auth.slice(7).trim());
  if (auth.startsWith("Basic ")) {
    const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
    return checkToken(env, decoded.slice(decoded.indexOf(":") + 1));
  }
  return false;
}

export function sessionCookie(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${sessionValue(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${secure ? "; Secure" : ""}`;
}

/** Paths reachable without login. Server functions check auth themselves (middleware). */
export function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/api/health" ||
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/_serverFn/") ||
    pathname.startsWith("/@") ||
    pathname.startsWith("/node_modules/") ||
    pathname.startsWith("/src/") ||
    pathname === "/favicon.svg"
  );
}
