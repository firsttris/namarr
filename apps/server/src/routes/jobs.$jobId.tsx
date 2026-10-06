import { type ItemStateName, jobTargetRoots } from "@namarr/db/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { PreviewTable } from "~/components/PreviewTable";
import { Button, cx, ErrorNote, PageHeader, Progress } from "~/components/ui";
import { getJob, getJobItems, undoJob } from "~/functions/jobs.functions";
import { useLive } from "~/lib/events";
import { num } from "~/lib/format";
import { localeOf, pickMsg, useLocalize } from "~/lib/i18n";
import { msgGroup } from "~/lib/msg-groups";
import { type Search, searchEnum } from "~/lib/search";
import * as m from "~/paraglide/messages";

const FILTERS: ItemStateName[] = ["ready", "needs_review", "done", "skipped", "failed", "undone"];
const itemState = searchEnum<ItemStateName>([...FILTERS, "parsed", "matched"]);

export const Route = createFileRoute("/jobs/$jobId")({
  ssr: false,
  validateSearch: (s: Search): { state?: ItemStateName } => ({ state: itemState(s.state) }),
  component: JobDetail,
});

function JobDetail() {
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
        title={m.job_title({ id: jobId })}
        subtitle={
          j
            ? `${pickMsg(msgGroup.jobStatus, status)} · ${pickMsg(msgGroup.actions, j.config.action) ?? j.config.action} · ${j.sourcePaths.join(", ")}`
            : "…"
        }
      >
        <Link to="/rename" search={{ job: jobId }} className="no-underline">
          <Button>{m.job_openWorkbench()}</Button>
        </Link>
        <Button variant="light" onClick={() => undo.mutate()} disabled={!counts?.done || undo.isPending}>
          {m.job_undoJob()}
        </Button>
      </PageHeader>
      {live && live.total > 0 && <Progress value={live.done / live.total} />}
      <ErrorNote error={undo.error ?? items.error} />
      {undo.data && (
        <div className="text-sm text-muted">
          {m.job_undoResult({ undone: undo.data.undone })}
          {undo.data.failed.length ? m.job_undoFailed({ n: undo.data.failed.length, reason: localize(undo.data.failed[0]!.reason) }) : ""}
        </div>
      )}
      <nav aria-label={m.job_filter()} className="flex flex-wrap gap-2">
        <Link to="/jobs/$jobId" params={{ jobId: String(jobId) }} search={{}} className={chip(!state)}>
          {m.job_all()}
        </Link>
        {FILTERS.map((s) => (
          <Link key={s} to="/jobs/$jobId" params={{ jobId: String(jobId) }} search={{ state: s }} className={chip(state === s)}>
            {pickMsg(msgGroup.states, s)} {counts ? num(counts[s], localeOf()) : ""}
          </Link>
        ))}
      </nav>
      <section
        aria-label={m.job_files()}
        className="flex flex-col overflow-hidden rounded-[14px] border border-line bg-panel"
        style={{ height: "calc(100vh - 260px)", minHeight: 400 }}
      >
        <PreviewTable
          items={items.data?.items ?? []}
          targetRoots={j ? jobTargetRoots(j.config) : []}
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
