import { createFileRoute } from "@tanstack/react-router";
import { APP_VERSION } from "~/lib/version";
import { runtime } from "~/server/runtime.server";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: () => {
        try {
          const rt = runtime();
          rt.db.$client.query("select 1").get();
          return Response.json({ status: "ok", version: APP_VERSION, uptime: Math.round((Date.now() - rt.startedAt.getTime()) / 1000) });
        } catch (e) {
          return Response.json({ status: "error", error: (e as Error).message }, { status: 503 });
        }
      },
    },
  },
});
