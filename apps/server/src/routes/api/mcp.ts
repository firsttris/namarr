import { createFileRoute } from "@tanstack/react-router";
import { isAuthenticated } from "~/server/auth.server";
import { handleMcp } from "~/server/mcp.server";
import { runtime } from "~/server/runtime.server";

/** POST /api/mcp: MCP server for AI agents (Streamable HTTP), see docs/automation.md. */
async function mcp(request: Request): Promise<Response> {
  const rt = runtime();
  if (rt.env.mcp === "off") return Response.json({ error: "MCP is turned off (NAMARR_MCP=off)" }, { status: 404 });
  if (!isAuthenticated(rt.env, request.headers))
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "www-authenticate": 'Bearer realm="namarr"' } });
  return handleMcp(rt, request);
}

export const Route = createFileRoute("/api/mcp")({
  server: { handlers: { POST: ({ request }) => mcp(request), GET: ({ request }) => mcp(request), DELETE: ({ request }) => mcp(request) } },
});
