import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { InboxRow } from "~/components/InboxRow";
import { PlusIcon, SearchIcon } from "~/components/icons";
import { Button, Chip, cx, ErrorNote, PageHeader, Panel, PanelHeader, Progress } from "~/components/ui";
import { cancelJob, undoJob } from "~/functions/jobs.functions";
import { approveInbox, getDashboard } from "~/functions/library.functions";
import { useLive } from "~/lib/events";
import { ago, greeting, num, pct } from "~/lib/format";
import { localeOf, pickMsg } from "~/lib/i18n";
import { msgGroup } from "~/lib/msg-groups";
import * as m from "~/paraglide/messages";

export const Route = createFileRoute("/")({
  loader: () => getDashboard(),
  component: Dashboard,
});

function Dashboard() {
  const n = (x: number) => num(x, localeOf());
  const initial = Route.useLoaderData();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { progress } = useLive();
  const { data = initial } = useQuery({ queryKey: ["dashboard"], queryFn: () => getDashboard(), initialData: initial });
  const [q, setQ] = useState("");

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["shell"] });
  };
  const approve = useMutation({
    mutationFn: (v: { itemIds?: number[]; minConfidence?: number }) => approveInbox({ data: v }),
    onSuccess: refresh,
  });
  const undo = useMutation({ mutationFn: (jobId: number) => undoJob({ data: { jobId } }), onSuccess: refresh });
  const cancel = useMutation({ mutationFn: (jobId: number) => cancelJob({ data: { jobId } }), onSuccess: refresh });

  const { stats } = data;
  const activeFolders = data.watchFolders.filter((f) => f.enabled).length;

  return (
    <>
      <PageHeader title={greeting()} subtitle={m.dashboard_subtitle({ folders: activeFolders, inbox: stats.inboxOpen })}>
        <form
          role="search"
          className="flex h-11 w-80 items-center gap-2 rounded-[10px] border border-line-2 bg-[#161920] px-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            navigate({ to: "/history", search: { q } });
          }}
        >
          <span className="text-muted">
            <SearchIcon />
          </span>
          <label htmlFor="q" className="sr-only">
            {m.dashboard_search()}
          </label>
          <input
            id="q"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={m.dashboard_searchPlaceholder()}
            className="flex-grow border-0 bg-transparent text-sm text-ink outline-none"
          />
        </form>
        <Link to="/rename" className="no-underline">
          <Button variant="accent" size="lg">
            <PlusIcon /> {m.dashboard_newJob()}
          </Button>
        </Link>
      </PageHeader>

      <section aria-label={m.dashboard_stats()} className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat label={m.dashboard_renamedToday()} value={n(stats.renamedToday)} unit={m.dashboard_files()} />
        <Stat label={m.dashboard_inboxOpen()} value={n(stats.inboxOpen)} unit={m.dashboard_needYou()} highlight={stats.inboxOpen > 0} />
        <Stat label={m.dashboard_autoRate()} value={stats.autoRate === null ? "–" : pct(stats.autoRate)} unit={m.dashboard_last7Days()} />
        <Stat label={m.dashboard_undoable()} value={n(stats.undoable)} unit={m.common_operations()} />
      </section>

      <ErrorNote error={approve.error ?? undo.error ?? cancel.error} />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel aria-labelledby="inbox-h" className="flex flex-col">
          <PanelHeader title={m.dashboard_waiting()} id="inbox-h">
            <Button onClick={() => approve.mutate({ minConfidence: 0.8 })} disabled={approve.isPending || !data.inboxTotal}>
              {m.dashboard_approveAbove80()}
            </Button>
          </PanelHeader>
          {data.inbox.length === 0 ? (
            <p className="m-0 px-5 py-8 text-sm text-muted">{m.dashboard_inboxEmpty()}</p>
          ) : (
            data.inbox.map((entry, i) => (
              <InboxRow
                key={entry.item.id}
                entry={entry}
                last={i === data.inbox.length - 1}
                busy={approve.isPending}
                onApprove={() => approve.mutate({ itemIds: [entry.item.id] })}
              />
            ))
          )}
          <Link to="/inbox" className="mt-auto border-t border-line px-5 py-3.5 text-[13px] font-medium no-underline">
            {m.dashboard_inboxAll({ n: data.inboxTotal })}
          </Link>
        </Panel>

        <Panel aria-labelledby="watch-h" className="flex flex-col">
          <PanelHeader title={m.nav_watch()} id="watch-h" />
          <div className="flex flex-col gap-3 p-4">
            {data.watchFolders.length === 0 && (
              <p className="m-0 text-sm text-muted">
                {m.dashboard_noWatchFolders()} <Link to="/watch">{m.dashboard_createNow()}</Link>
              </p>
            )}
            {data.watchFolders.map((f) => (
              <div key={f.id} className="flex flex-col gap-2.5 rounded-[10px] border border-line-2 bg-panel-2 p-3.5">
                <div className="flex items-center gap-2">
                  <span className={cx("h-2 w-2 rounded-full", !f.enabled ? "bg-faint" : f.inboxCount ? "bg-accent" : "bg-info")} />
                  <div className="flex-grow text-sm font-semibold">{f.name}</div>
                  <div className={cx("text-xs", f.inboxCount ? "text-accent" : "text-muted")}>
                    {f.inboxCount ? m.dashboard_inInbox({ n: f.inboxCount }) : f.enabled ? ago(f.lastEventAt) : m.dashboard_paused()}
                  </div>
                </div>
                <div className="font-mono text-xs text-soft">
                  {f.path} → {f.targetRoot}
                </div>
                <div className="flex gap-1.5">
                  <Chip>{f.autoThreshold === null ? m.dashboard_alwaysReview() : m.dashboard_autoFrom({ pct: pct(f.autoThreshold) })}</Chip>
                  <Chip>{m.dashboard_stableSeconds({ n: f.stableSeconds })}</Chip>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel aria-labelledby="jobs-h">
        <div className="flex items-center border-b border-line px-5 py-[18px]">
          <h2 id="jobs-h" className="m-0 flex-grow text-base font-semibold">
            {m.dashboard_recentJobs()}
          </h2>
          <Link to="/history" className="text-[13px] font-medium no-underline">
            {m.dashboard_toHistory()}
          </Link>
        </div>
        <div className="grid grid-cols-[90px_minmax(0,1fr)_160px_220px_120px] gap-4 border-b border-row px-5 py-2.5 text-xs text-muted">
          <div>{m.dashboard_job()}</div>
          <div>{m.common_source()}</div>
          <div>{m.dashboard_trigger()}</div>
          <div>{m.dashboard_progress()}</div>
          <div className="text-right">{m.common_action()}</div>
        </div>
        {data.jobs.length === 0 && <p className="m-0 px-5 py-6 text-sm text-muted">{m.dashboard_noJobs()}</p>}
        {data.jobs.map((job, i) => {
          const live = progress[job.id];
          const status = live?.status ?? job.status;
          const done = live?.done ?? job.progressDone;
          const total = live?.total ?? job.progressTotal;
          const running = ["scanning", "matching", "executing", "pending"].includes(status);
          return (
            <div
              key={job.id}
              className={cx(
                "grid grid-cols-[90px_minmax(0,1fr)_160px_220px_120px] items-center gap-4 px-5 py-3 text-[13px]",
                i < data.jobs.length - 1 && "border-b border-row",
              )}
            >
              <Link to="/jobs/$jobId" params={{ jobId: String(job.id) }} className="font-mono text-soft no-underline">
                #{job.id}
              </Link>
              <div className="truncate font-mono" title={job.sourcePaths.join(", ")}>
                {job.sourcePaths.join(", ")}
              </div>
              <div className="text-soft">
                {job.kind === "watch"
                  ? m.dashboard_triggerWatch()
                  : job.kind === "hook"
                    ? m.dashboard_triggerHook()
                    : job.config.mode === "rules"
                      ? m.dashboard_triggerRules()
                      : m.dashboard_triggerWorkbench()}
                <span className="block text-xs text-faint">{pickMsg(msgGroup.actions, job.config.action) ?? job.config.action}</span>
              </div>
              <div className="flex items-center gap-2.5">
                <Progress value={total ? done / total : status === "done" ? 1 : 0} tone={running ? "accent" : "info"} />
                <span className="text-xs whitespace-nowrap text-soft">
                  {total ? `${n(done)} / ${n(total)}` : pickMsg(msgGroup.jobStatus, status)}
                </span>
              </div>
              <div className="text-right">
                {running ? (
                  <Button size="sm" onClick={() => cancel.mutate(job.id)}>
                    {m.common_cancel()}
                  </Button>
                ) : status === "done" && job.config.action !== "test" ? (
                  <Button size="sm" onClick={() => undo.mutate(job.id)} disabled={undo.isPending}>
                    {m.common_undo()}
                  </Button>
                ) : (
                  <Link to="/rename" search={{ job: job.id }} className="no-underline">
                    <Button size="sm">{m.common_open()}</Button>
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </Panel>
    </>
  );
}

function Stat({ label, value, unit, highlight }: { label: string; value: string; unit: string; highlight?: boolean }) {
  return (
    <div className={cx("flex flex-col gap-2 rounded-xl border bg-panel px-5 py-[18px]", highlight ? "border-accent" : "border-line")}>
      <div className="text-[13px] text-muted">{label}</div>
      <div className="flex items-baseline gap-2.5">
        <div className={cx("font-display text-[34px] font-bold", highlight && "text-accent")}>{value}</div>
        <div className="text-[13px] text-muted">{unit}</div>
      </div>
    </div>
  );
}
