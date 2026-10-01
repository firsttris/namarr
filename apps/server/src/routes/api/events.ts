import { createFileRoute } from "@tanstack/react-router";
import { isAuthenticated } from "~/server/auth.server";
import { sseResponse } from "~/server/events.server";
import { runtime } from "~/server/runtime.server";

/** Server-Sent Events: job.progress, item.updated, inbox.added, watch.detected */
export const Route = createFileRoute("/api/events")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const rt = runtime();
        if (!isAuthenticated(rt.env, request.headers)) return new Response("Unauthorized", { status: 401 });
        return sseResponse(rt.bus, request.signal);
      },
    },
  },
});
