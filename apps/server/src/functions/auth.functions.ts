import { msg } from "@namarr/core/i18n";
import { createServerFn } from "@tanstack/react-start";
import { getRequest, setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { checkToken, isAuthenticated, SESSION_COOKIE, sessionCookie } from "~/server/auth.server";
import { runtime } from "~/server/runtime.server";

export const authStatus = createServerFn({ method: "GET" }).handler(async () => {
  const rt = runtime();
  return { required: Boolean(rt.env.token || rt.env.authHeader), authenticated: isAuthenticated(rt.env, getRequest().headers) };
});

/** Ends the session: the cookie is replaced by an expired one. */
export const logout = createServerFn({ method: "POST" }).handler(async () => {
  setResponseHeader("set-cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return { ok: true };
});

export const login = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string().min(1).max(500) }))
  .handler(async ({ data }) => {
    const rt = runtime();
    if (!checkToken(rt.env, data.token)) {
      await new Promise((r) => setTimeout(r, 500)); // slows down guessing
      throw new Error(msg("auth_error_wrongToken"));
    }
    const secure = new URL(getRequest().url).protocol === "https:";
    setResponseHeader("set-cookie", sessionCookie(rt.env.token!, secure));
    return { ok: true };
  });
