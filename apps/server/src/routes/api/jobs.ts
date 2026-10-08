import { createFileRoute } from "@tanstack/react-router";
import { isAuthenticated } from "~/server/auth.server";
import { createHookJob, HookError, readHookInput } from "~/server/hook.server";
import { runtime } from "~/server/runtime.server";

/** POST /api/jobs: hook for download clients (qBittorrent, SABnzbd, …), see README. */
export const Route = createFileRoute("/api/jobs")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rt = runtime();
        if (!isAuthenticated(rt.env, request.headers)) return Response.json({ error: "Unauthorized" }, { status: 401 });
        try {
          const job = await createHookJob(rt, await readHookInput(request));
          rt.log.info({ jobId: job.id, paths: job.sourcePaths }, "Hook: job created");
          return Response.json({ jobId: job.id, status: job.status, url: `/jobs/${job.id}` }, { status: 202 });
        } catch (e) {
          if (e instanceof HookError) return Response.json({ error: e.message }, { status: e.status });
          rt.log.error({ err: e }, "Hook failed");
          return Response.json({ error: "Internal error" }, { status: 500 });
        }
      },
    },
  },
});
