import { localize } from "@namarr/core/i18n";
import { countItemsByState, getJob } from "@namarr/db";
import { createFileRoute } from "@tanstack/react-router";
import { isAuthenticated } from "~/server/auth.server";
import { runtime } from "~/server/runtime.server";

/** GET /api/jobs/:id: status of a job, for scripts that want to wait for it. */
export const Route = createFileRoute("/api/jobs/$jobId")({
  server: {
    handlers: {
      GET: ({ request, params }) => {
        const rt = runtime();
        if (!isAuthenticated(rt.env, request.headers)) return Response.json({ error: "Unauthorized" }, { status: 401 });
        const job = getJob(rt.db, Number(params.jobId));
        if (!job) return Response.json({ error: "Job not found" }, { status: 404 });
        return Response.json({
          jobId: job.id,
          kind: job.kind,
          status: job.status,
          progress: { done: job.progressDone, total: job.progressTotal },
          items: countItemsByState(rt.db, job.id),
          error: localize(job.error, "en"),
        });
      },
    },
  },
});
