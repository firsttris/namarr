import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { Button, cx, ErrorNote, inputClass, PageHeader, Panel } from "~/components/ui";
import { undoJob } from "~/functions/jobs.functions";
import { listHistory } from "~/functions/library.functions";
import { localeOf, pickMsg, useLocalize } from "~/lib/i18n";
import { msgGroup } from "~/lib/msg-groups";
import * as m from "~/paraglide/messages";

export const Route = createFileRoute("/history")({
  validateSearch: z.object({ q: z.string().optional(), undone: z.boolean().optional() }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => listHistory({ data: { search: deps.q, includeUndone: deps.undone } }),
  component: History,
});

function History() {
  const localize = useLocalize();
  const dt = new Intl.DateTimeFormat(localeOf(), { dateStyle: "short", timeStyle: "short" });
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
      <PageHeader title={m.history_title()} subtitle={m.history_subtitle()} />
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
            {m.history_searchLabel()}
          </label>
          <input
            id="hq"
            className={cx(inputClass, "w-80")}
            placeholder={m.history_searchPlaceholder()}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Button type="submit">{m.common_search()}</Button>
        </form>
        <label className="flex items-center gap-2 text-[13px] text-soft">
          <input
            type="checkbox"
            checked={Boolean(search.undone)}
            onChange={(e) => navigate({ to: "/history", search: { ...search, undone: e.target.checked || undefined } })}
            className="h-4 w-4"
          />
          {m.history_showUndone()}
        </label>
        <div className="flex-grow" />
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (until && confirm(m.history_confirmSince({ when: until.replace("T", " ") })))
              undo.mutate({ since: new Date(until).toISOString() });
          }}
        >
          <label htmlFor="until" className="text-[13px] text-muted">
            {m.history_undoSince()}
          </label>
          <input id="until" type="datetime-local" className={inputClass} value={until} onChange={(e) => setUntil(e.target.value)} />
          <Button type="submit" disabled={!until || undo.isPending}>
            {m.common_undo()}
          </Button>
        </form>
      </div>
      <ErrorNote error={undo.error} />
      {undo.data && (
        <div className="text-sm text-muted">
          {m.history_result({ undone: undo.data.undone })}
          {undo.data.failed.length ? m.history_refused({ n: undo.data.failed.length, reason: localize(undo.data.failed[0]!.reason) }) : ""}
        </div>
      )}
      <Panel>
        <div className="grid grid-cols-[130px_110px_minmax(0,1fr)_70px_120px] gap-4 border-b border-row px-5 py-2.5 text-xs text-muted">
          <div>{m.history_time()}</div>
          <div>{m.common_action()}</div>
          <div>{m.history_fromTo()}</div>
          <div>{m.dashboard_job()}</div>
          <div className="text-right">{m.history_undoColumn()}</div>
        </div>
        {data.length === 0 && <p className="m-0 px-5 py-6 text-sm text-muted">{m.history_empty()}</p>}
        {data.map((op) => (
          <div
            key={op.id}
            className="grid grid-cols-[130px_110px_minmax(0,1fr)_70px_120px] items-center gap-4 border-b border-row px-5 py-2.5 text-[13px] last:border-b-0"
          >
            <div className="text-soft">{dt.format(new Date(op.executedAt))}</div>
            <div className="text-soft">{pickMsg(msgGroup.actions, op.action) ?? op.action}</div>
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
                <span className="text-xs text-faint">{m.history_undone()}</span>
              ) : (
                <Button
                  size="sm"
                  aria-label={m.history_undoFile({ file: op.toPath.split("/").at(-1)! })}
                  onClick={() => undo.mutate({ operationIds: [op.id] })}
                  disabled={undo.isPending}
                >
                  {m.common_undo()}
                </Button>
              )}
            </div>
          </div>
        ))}
      </Panel>
    </>
  );
}
