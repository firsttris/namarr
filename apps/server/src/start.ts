import { createMiddleware, createStart } from "@tanstack/react-start";
import { isAuthenticated, isPublicPath } from "./server/auth.server";
import { runtime } from "./server/runtime.server";

/** Pages and server routes need a session; server functions check it in their own middleware. */
const authGate = createMiddleware().server(async ({ next, request }) => {
  const url = new URL(request.url);
  if (isPublicPath(url.pathname)) return next();
  const rt = runtime();
  if (isAuthenticated(rt.env, request.headers)) return next();
  if (url.pathname.startsWith("/api/")) {
    return new Response("Unauthorized", { status: 401, headers: { "www-authenticate": 'Bearer realm="namarr"' } });
  }
  return new Response(null, { status: 302, headers: { location: `/login?next=${encodeURIComponent(url.pathname + url.search)}` } });
});

export const startInstance = createStart(() => ({ requestMiddleware: [authGate] }));
