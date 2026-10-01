import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { InboxRow } from "~/components/InboxRow";
import { PlusIcon, SearchIcon } from "~/components/icons";
import { Button, Chip, cx, ErrorNote, PageHeader, Panel, PanelHeader, Progress } from "~/components/ui";
import { cancelJob, undoJob } from "~/functions/jobs.functions";
import { approveInbox, getDashboard } from "~/functions/library.functions";
import { useLive } from "~/lib/events";
import { ACTION_LABELS, ago, greeting, JOB_STATUS_LABELS, num, pct } from "~/lib/format";

export const Route = createFileRoute("/")({
  loader: () => getDashboard(),
  component: Dashboard,
});

function Dashboard() {
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
      <PageHeader
        title={greeting()}
        subtitle={`${activeFolders} Watch-Folder aktiv · ${stats.inboxOpen} ${stats.inboxOpen === 1 ? "Datei wartet" : "Dateien warten"} auf deine Freigabe`}
      >
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
            Suchen
          </label>
          <input
            id="q"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Datei, Serie oder Job suchen"
            className="flex-grow border-0 bg-transparent text-sm text-ink outline-none"
          />
        </form>
        <Link to="/rename" className="no-underline">
          <Button variant="accent" size="lg">
            <PlusIcon /> Neuer Job
          </Button>
        </Link>
      </PageHeader>

      <section aria-label="Kennzahlen" className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat label="Heute umbenannt" value={num(stats.renamedToday)} unit="Dateien" />
        <Stat label="Inbox offen" value={num(stats.inboxOpen)} unit="brauchen dich" highlight={stats.inboxOpen > 0} />
        <Stat label="Automatisch sicher erkannt" value={stats.autoRate === null ? "–" : pct(stats.autoRate)} unit="letzte 7 Tage" />
        <Stat label="Rückgängig machbar" value={num(stats.undoable)} unit="Operationen" />
      </section>

      <ErrorNote error={approve.error ?? undo.error ?? cancel.error} />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel aria-labelledby="inbox-h" className="flex flex-col">
          <PanelHeader title="Wartet auf Freigabe" id="inbox-h">
            <Button onClick={() => approve.mutate({ minConfidence: 0.8 })} disabled={approve.isPending || !data.inboxTotal}>
              Alle über 80 % freigeben
            </Button>
          </PanelHeader>
          {data.inbox.length === 0 ? (
            <p className="m-0 px-5 py-8 text-sm text-muted">Nichts offen. Unsichere Treffer aus Watch-Foldern landen hier.</p>
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
            Alle {data.inboxTotal} in der Inbox ansehen
          </Link>
        </Panel>

        <Panel aria-labelledby="watch-h" className="flex flex-col">
          <PanelHeader title="Watch-Folder" id="watch-h" />
          <div className="flex flex-col gap-3 p-4">
            {data.watchFolders.length === 0 && (
              <p className="m-0 text-sm text-muted">
                Noch keine Watch-Folder. <Link to="/watch">Jetzt anlegen</Link>
              </p>
            )}
            {data.watchFolders.map((f) => (
              <div key={f.id} className="flex flex-col gap-2.5 rounded-[10px] border border-line-2 bg-panel-2 p-3.5">
                <div className="flex items-center gap-2">
                  <span className={cx("h-2 w-2 rounded-full", !f.enabled ? "bg-faint" : f.inboxCount ? "bg-accent" : "bg-info")} />
                  <div className="flex-grow text-sm font-semibold">{f.name}</div>
                  <div className={cx("text-xs", f.inboxCount ? "text-accent" : "text-muted")}>
                    {f.inboxCount ? `${f.inboxCount} in Inbox` : f.enabled ? ago(f.lastEventAt) : "pausiert"}
                  </div>
                </div>
                <div className="font-mono text-xs text-soft">
                  {f.path} → {f.targetRoot}
                </div>
                <div className="flex gap-1.5">
                  <Chip>{f.autoThreshold === null ? "Immer prüfen" : `Auto ab ${pct(f.autoThreshold)}`}</Chip>
                  <Chip>{f.stableSeconds} s stabil</Chip>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel aria-labelledby="jobs-h">
        <div className="flex items-center border-b border-line px-5 py-[18px]">
          <h2 id="jobs-h" className="m-0 flex-grow text-base font-semibold">
            Letzte Jobs
          </h2>
          <Link to="/history" className="text-[13px] font-medium no-underline">
            Zur History
          </Link>
        </div>
        <div className="grid grid-cols-[90px_minmax(0,1fr)_160px_220px_120px] gap-4 border-b border-row px-5 py-2.5 text-xs text-muted">
          <div>Job</div>
          <div>Quelle</div>
          <div>Auslöser</div>
          <div>Fortschritt</div>
          <div className="text-right">Aktion</div>
        </div>
        {data.jobs.length === 0 && <p className="m-0 px-5 py-6 text-sm text-muted">Noch keine Jobs.</p>}
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
                {job.kind === "watch" ? "Watch-Folder" : job.config.mode === "rules" ? "Regel-Modus" : "Workbench"}
                <span className="block text-xs text-faint">{ACTION_LABELS[job.config.action] ?? job.config.action}</span>
              </div>
              <div className="flex items-center gap-2.5">
                <Progress value={total ? done / total : status === "done" ? 1 : 0} tone={running ? "accent" : "info"} />
                <span className="text-xs whitespace-nowrap text-soft">
                  {total ? `${num(done)} / ${num(total)}` : JOB_STATUS_LABELS[status]}
                </span>
              </div>
              <div className="text-right">
                {running ? (
                  <Button size="sm" onClick={() => cancel.mutate(job.id)}>
                    Abbrechen
                  </Button>
                ) : status === "done" && job.config.action !== "test" ? (
                  <Button size="sm" onClick={() => undo.mutate(job.id)} disabled={undo.isPending}>
                    Rückgängig
                  </Button>
                ) : (
                  <Link to="/rename" search={{ job: job.id }} className="no-underline">
                    <Button size="sm">Öffnen</Button>
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
