import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { Button, cx, ErrorNote, inputClass, PageHeader, Panel } from "~/components/ui";
import { undoJob } from "~/functions/jobs.functions";
import { listHistory } from "~/functions/library.functions";
import { ACTION_LABELS } from "~/lib/format";

export const Route = createFileRoute("/history")({
  validateSearch: z.object({ q: z.string().optional(), undone: z.boolean().optional() }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => listHistory({ data: { search: deps.q, includeUndone: deps.undone } }),
  component: History,
});

const dt = new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short" });

function History() {
  const search = Route.useSearch();
  const initial = Route.useLoaderData();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState(search.q ?? "");
  const [until, setUntil] = useState("");
  const { data = initial } = useQuery({
    queryKey: ["history", search],
    queryFn: () => listHistory({ data: { search: search.q, includeUndone: search.undone } }),
    initialData: initial,
  });
  const undo = useMutation({
    mutationFn: (v: { operationIds?: number[]; jobId?: number; since?: string }) => undoJob({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["history"] }),
  });

  return (
    <>
      <PageHeader title="History" subtitle="Jede Operation ist rückgängig machbar, solange die Zieldatei unverändert ist." />
      <div className="flex flex-wrap items-end gap-3">
        <form
          role="search"
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            navigate({ to: "/history", search: { ...search, q: q || undefined } });
          }}
        >
          <label htmlFor="hq" className="sr-only">
            Operationen durchsuchen
          </label>
          <input id="hq" className={cx(inputClass, "w-80")} placeholder="Pfad suchen" value={q} onChange={(e) => setQ(e.target.value)} />
          <Button type="submit">Suchen</Button>
        </form>
        <label className="flex items-center gap-2 text-[13px] text-soft">
          <input
            type="checkbox"
            checked={Boolean(search.undone)}
            onChange={(e) => navigate({ to: "/history", search: { ...search, undone: e.target.checked || undefined } })}
            className="h-4 w-4"
          />
          Rückgängig gemachte zeigen
        </label>
        <div className="flex-grow" />
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (until && confirm(`Alle Operationen seit ${until.replace("T", " ")} rückgängig machen?`))
              undo.mutate({ since: new Date(until).toISOString() });
          }}
        >
          <label htmlFor="until" className="text-[13px] text-muted">
            Alles rückgängig seit
          </label>
          <input id="until" type="datetime-local" className={inputClass} value={until} onChange={(e) => setUntil(e.target.value)} />
          <Button type="submit" disabled={!until || undo.isPending}>
            Rückgängig
          </Button>
        </form>
      </div>
      <ErrorNote error={undo.error} />
      {undo.data && (
        <div className="text-sm text-muted">
          {undo.data.undone} rückgängig gemacht
          {undo.data.failed.length ? ` · ${undo.data.failed.length} verweigert: ${undo.data.failed[0]!.reason}` : ""}
        </div>
      )}
      <Panel>
        <div className="grid grid-cols-[130px_110px_minmax(0,1fr)_70px_120px] gap-4 border-b border-row px-5 py-2.5 text-xs text-muted">
          <div>Zeitpunkt</div>
          <div>Aktion</div>
          <div>Quelle → Ziel</div>
          <div>Job</div>
          <div className="text-right">Undo</div>
        </div>
        {data.length === 0 && <p className="m-0 px-5 py-6 text-sm text-muted">Keine Operationen.</p>}
        {data.map((op) => (
          <div
            key={op.id}
            className="grid grid-cols-[130px_110px_minmax(0,1fr)_70px_120px] items-center gap-4 border-b border-row px-5 py-2.5 text-[13px] last:border-b-0"
          >
            <div className="text-soft">{dt.format(new Date(op.executedAt))}</div>
            <div className="text-soft">{ACTION_LABELS[op.action] ?? op.action}</div>
            <div className="flex min-w-0 flex-col font-mono text-xs">
              <span className="truncate text-muted" title={op.fromPath}>
                {op.fromPath}
              </span>
              <span className="truncate" title={op.toPath}>
                → {op.toPath}
              </span>
            </div>
            <div>
              {op.jobId && (
                <Link to="/jobs/$jobId" params={{ jobId: String(op.jobId) }} className="font-mono no-underline">
                  #{op.jobId}
                </Link>
              )}
            </div>
            <div className="text-right">
              {op.undoneAt ? (
                <span className="text-xs text-faint">rückgängig</span>
              ) : (
                <Button
                  size="sm"
                  aria-label={`${op.toPath.split("/").at(-1)} rückgängig machen`}
                  onClick={() => undo.mutate({ operationIds: [op.id] })}
                  disabled={undo.isPending}
                >
                  Rückgängig
                </Button>
              )}
            </div>
          </div>
        ))}
      </Panel>
    </>
  );
}
