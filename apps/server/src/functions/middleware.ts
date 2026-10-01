import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { isAuthenticated } from "~/server/auth.server";
import { runtime } from "~/server/runtime.server";

/** Every server function except login runs through this: the function is the data boundary. */
export const authed = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const rt = runtime();
  if (!isAuthenticated(rt.env, getRequest().headers)) throw new Error("Nicht angemeldet");
  return next({ context: { rt } });
});
