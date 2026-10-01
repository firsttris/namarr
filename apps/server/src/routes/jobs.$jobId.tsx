import type { ItemStateName } from "@namarr/db/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { PreviewTable } from "~/components/PreviewTable";
import { Button, cx, ErrorNote, PageHeader, Progress } from "~/components/ui";
import { getJob, getJobItems, undoJob } from "~/functions/jobs.functions";
import { useLive } from "~/lib/events";
import { num } from "~/lib/format";
import { useLocalize, useT } from "~/lib/i18n";

const FILTERS: ItemStateName[] = ["ready", "needs_review", "done", "skipped", "failed", "undone"];

export const Route = createFileRoute("/jobs/$jobId")({
  ssr: false,
  validateSearch: z.object({
    state: z.enum(["ready", "needs_review", "done", "skipped", "failed", "undone", "parsed", "matched"]).optional(),
  }),
  component: JobDetail,
});

function JobDetail() {
  const t = useT();
  const localize = useLocalize();
  const jobId = Number(Route.useParams().jobId);
  const { state } = Route.useSearch();
  const qc = useQueryClient();
  const { progress } = useLive();
  const [selected, setSelected] = useState<number>();
  const job = useQuery({ queryKey: ["job", jobId], queryFn: () => getJob({ data: { jobId } }) });
  const items = useQuery({
    queryKey: ["items", jobId, state ?? "all"],
    queryFn: () => getJobItems({ data: { jobId, states: state ? [state] : undefined, limit: 5000 } }),
  });
  const undo = useMutation({
    mutationFn: () => undoJob({ data: { jobId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["items", jobId] }),
  });

  if (job.error) return <ErrorNote error={job.error} />;
  const j = job.data?.job;
  const counts = job.data?.counts;
  const live = progress[jobId];
  const status = live?.status ?? j?.status ?? "pending";

  return (
    <>
      <PageHeader
        title={t.job.title(jobId)}
        subtitle={j ? `${t.jobStatus[status]} · ${t.actions[j.config.action] ?? j.config.action} · ${j.sourcePaths.join(", ")}` : "…"}
      >
        <Link to="/rename" search={{ job: jobId }} className="no-underline">
          <Button>{t.job.openWorkbench}</Button>
        </Link>
        <Button variant="light" onClick={() => undo.mutate()} disabled={!counts?.done || undo.isPending}>
          {t.job.undoJob}
        </Button>
      </PageHeader>
      {live && live.total > 0 && <Progress value={live.done / live.total} />}
      <ErrorNote error={undo.error ?? items.error} />
      {undo.data && (
        <div className="text-sm text-muted">
          {t.job.undoResult(undo.data.undone)}
          {undo.data.failed.length ? t.job.undoFailed(undo.data.failed.length, localize(undo.data.failed[0]!.reason)) : ""}
        </div>
      )}
      <nav aria-label={t.job.filter} className="flex flex-wrap gap-2">
        <Link to="/jobs/$jobId" params={{ jobId: String(jobId) }} search={{}} className={chip(!state)}>
          {t.job.all}
        </Link>
        {FILTERS.map((s) => (
          <Link key={s} to="/jobs/$jobId" params={{ jobId: String(jobId) }} search={{ state: s }} className={chip(state === s)}>
            {t.states[s]} {counts ? num(counts[s], t.locale) : ""}
          </Link>
        ))}
      </nav>
      <section
        aria-label={t.job.files}
        className="flex flex-col overflow-hidden rounded-[14px] border border-line bg-panel"
        style={{ height: "calc(100vh - 260px)", minHeight: 400 }}
      >
        <PreviewTable
          items={items.data?.items ?? []}
          targetRoot={j?.config.targetRoot}
          sourceRoot={j?.sourcePaths.length === 1 ? j.sourcePaths[0] : undefined}
          selectedId={selected}
          onSelect={setSelected}
          onToggle={() => {}}
          onSearch={() => {}}
        />
      </section>
    </>
  );
}

const chip = (active: boolean) =>
  cx("rounded-md px-3 py-1.5 text-[13px] no-underline", active ? "bg-toggle text-white" : "bg-chip text-chip-ink hover:text-white");
