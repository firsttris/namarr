import type { Action, ConflictPolicy } from "@namarr/core/fileops";
import type { MatchResult } from "@namarr/core/matcher";
import type { Rule } from "@namarr/core/rules";
import type { Parsed } from "@namarr/core/types";
import type { JobItem } from "@namarr/db/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { FolderBrowser } from "~/components/FolderBrowser";
import { SearchIcon } from "~/components/icons";
import { MatchPicker } from "~/components/MatchPicker";
import { PreviewTable } from "~/components/PreviewTable";
import { RuleStack } from "~/components/RuleStack";
import { TemplateEditor } from "~/components/TemplateEditor";
import { Button, cx, ErrorNote, inputClass, Panel, Poster, Progress, Select } from "~/components/ui";
import { cancelJob, createJob, executeJob, getJob, getJobItems, recomputePreview, updateJobItem } from "~/functions/jobs.functions";
import { getProfiles, getSettingsFn } from "~/functions/library.functions";
import { useLive } from "~/lib/events";
import { num, pct } from "~/lib/format";
import { type Messages, useLocalize, useT } from "~/lib/i18n";

type Mode = "media" | "rules" | "both";

export const Route = createFileRoute("/rename")({
  // Tens of thousands of virtualized rows: SSR brings nothing here.
  ssr: false,
  validateSearch: z.object({
    path: z.string().optional(),
    profile: z.coerce.number().optional(),
    job: z.coerce.number().optional(),
    item: z.coerce.number().optional(),
    mode: z.enum(["media", "rules", "both"]).optional(),
  }),
  component: Workbench,
});

function Workbench() {
  const search = Route.useSearch();
  return search.job ? <JobWorkbench key={search.job} jobId={search.job} initialItem={search.item} /> : <NewJob />;
}

function ModeToggle({ value, onChange }: { value: Mode; onChange: (m: Mode) => void }) {
  const t = useT();
  const labels = t.modes;
  return (
    <div role="group" aria-label={t.common.mode} className="flex rounded-[10px] border border-line-2 bg-[#161920] p-1">
      {(Object.keys(labels) as Mode[]).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={value === m}
          onClick={() => onChange(m)}
          className={cx(
            "h-9 cursor-pointer rounded-[7px] border-0 px-4 text-[13px]",
            value === m ? "bg-toggle font-semibold text-white" : "bg-transparent text-soft",
          )}
        >
          {labels[m]}
        </button>
      ))}
    </div>
  );
}

function Breadcrumb({ path }: { path?: string }) {
  if (!path) return null;
  const parts = path.split("/").filter(Boolean);
  return (
    <>
      {parts.map((p, i) => (
        <span key={`${p}-${i}`} className="contents">
          <span className={i === parts.length - 1 ? "text-ink" : undefined}>{i === 0 ? `/${p}` : p}</span>
          {i < parts.length - 1 && <span>/</span>}
        </span>
      ))}
    </>
  );
}

// ---------- start: choose folder, mode, profile ----------

function NewJob() {
  const t = useT();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>(search.mode ?? "media");
  const [profileId, setProfileId] = useState<number | undefined>(search.profile);
  const profiles = useQuery({ queryKey: ["profiles"], queryFn: () => getProfiles() });
  const create = useMutation({
    mutationFn: (path: string) => createJob({ data: { paths: [path], mode, profileId } }),
    onSuccess: ({ jobId }) => navigate({ to: "/rename", search: { job: jobId } }),
  });

  return (
    <>
      <header className="flex items-center gap-4">
        <div className="flex flex-grow flex-col gap-1">
          <h1 className="m-0 font-display text-[28px] font-bold tracking-[-0.02em]">{t.workbench.title}</h1>
          <div className="text-[13px] text-muted">{t.workbench.intro}</div>
        </div>
        <Select
          aria-label={t.common.profile}
          value={profileId ?? ""}
          onChange={(e) => setProfileId(e.target.value ? Number(e.target.value) : undefined)}
        >
          <option value="">{t.workbench.noProfile}</option>
          {profiles.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <ModeToggle value={mode} onChange={setMode} />
      </header>
      <ErrorNote error={create.error} />
      <Panel className="p-5">
        <FolderBrowser
          initial={search.path}
          onChoose={(p) => create.mutate(p)}
          chooseLabel={create.isPending ? t.workbench.creating : t.workbench.createPreview}
        />
      </Panel>
    </>
  );
}

// ---------- job: preview, format, rules, execute ----------

async function fetchAllItems(jobId: number): Promise<JobItem[]> {
  const out: JobItem[] = [];
  let cursor: number | undefined;
  do {
    const page = await getJobItems({ data: { jobId, cursor, limit: 5000 } });
    out.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return out;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

type Config = { mode: Mode; preset: string; template: { movie?: string; episode?: string }; rules: Rule[] };

function JobWorkbench({ jobId, initialItem }: { jobId: number; initialItem?: number }) {
  const t = useT();
  const wb = t.workbench;
  const localize = useLocalize();
  const n = (x: number) => num(x, t.locale);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { progress } = useLive();
  const job = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => getJob({ data: { jobId } }),
    // SSE drives updates; polling only covers events sent before the stream connected.
    refetchInterval: (q) =>
      ["pending", "scanning", "matching", "executing"].includes(q.state.data?.job.status ?? "pending") ? 1500 : false,
  });
  const items = useQuery({ queryKey: ["items", jobId], queryFn: () => fetchAllItems(jobId) });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => getSettingsFn() });

  const [config, setConfig] = useState<Config | null>(null);
  const [action, setAction] = useState<Action>("test");
  const [conflict, setConflict] = useState<ConflictPolicy>("skip");
  const [selectedId, setSelectedId] = useState<number | undefined>(initialItem);
  const [picking, setPicking] = useState<JobItem | null>(null);
  const [addingFolder, setAddingFolder] = useState(false);
  const [targetDraft, setTargetDraft] = useState("");

  // Take the job's settings once; afterwards local edits lead.
  const loaded = useRef<string | null>(null);
  useEffect(() => {
    const c = job.data?.job.config;
    if (!c || loaded.current !== null) return;
    const initial: Config = { mode: c.mode, preset: c.preset ?? "jellyfin", template: c.template ?? {}, rules: c.rules ?? [] };
    loaded.current = JSON.stringify(initial);
    setConfig(initial);
    setAction(c.action);
    setConflict(c.conflictPolicy);
  }, [job.data]);

  const recompute = useMutation({
    mutationFn: (c: Config) => recomputePreview({ data: { jobId, mode: c.mode, preset: c.preset, template: c.template, rules: c.rules } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["items", jobId] }),
  });
  // Recompute when the settings differ from what the preview was last computed with.
  const debounced = useDebounced(config, 400);
  const { mutate: recomputeNow } = recompute;
  useEffect(() => {
    if (!debounced) return;
    const key = JSON.stringify(debounced);
    if (key === loaded.current) return;
    loaded.current = key;
    recomputeNow(debounced);
  }, [debounced, recomputeNow]);

  const update = useMutation({
    mutationFn: (v: Parameters<typeof updateJobItem>[0]["data"]) => updateJobItem({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["items", jobId] });
      qc.invalidateQueries({ queryKey: ["job", jobId] });
    },
  });
  const execute = useMutation({
    mutationFn: () => executeJob({ data: { jobId, action, conflictPolicy: conflict } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["job", jobId] }),
  });
  const cancel = useMutation({ mutationFn: () => cancelJob({ data: { jobId } }) });
  const retarget = useMutation({
    mutationFn: (targetRoot: string | null) => recomputePreview({ data: { jobId, targetRoot } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["job", jobId] });
      qc.invalidateQueries({ queryKey: ["items", jobId] });
    },
  });
  const rematch = useMutation({
    mutationFn: (extra: { paths?: string[]; order?: "aired" | "dvd" | "absolute"; language?: string }) => {
      const j = job.data!.job;
      return createJob({
        data: {
          paths: extra.paths ?? j.sourcePaths,
          mode: config?.mode,
          preset: config?.preset,
          template: config?.template,
          rules: config?.rules,
          targetRoot: j.config.targetRoot,
          order: extra.order ?? j.config.order,
          language: extra.language ?? j.config.language,
        },
      });
    },
    onSuccess: ({ jobId: next }) => navigate({ to: "/rename", search: { job: next } }),
  });

  // Every status change (matching → ready, executing → done) brings new targets or states.
  const jobStatus = job.data?.job.status;
  useEffect(() => {
    if (jobStatus) qc.invalidateQueries({ queryKey: ["items", jobId] });
  }, [jobStatus, jobId, qc]);

  const list = items.data ?? [];
  const selected = list.find((i) => i.id === selectedId) ?? list.find((i) => i.targetPath) ?? list[0];
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new selection clears the target draft
  useEffect(() => setTargetDraft(""), [selectedId]);

  const counts = useMemo(() => {
    const c = { ready: 0, review: 0, skipped: 0, conflicts: 0, done: 0, failed: 0 };
    for (const i of list) {
      if (i.excluded || i.state === "skipped") c.skipped++;
      else if (i.state === "ready") c.ready++;
      else if (i.state === "needs_review") c.review++;
      else if (i.state === "done") c.done++;
      else if (i.state === "failed") c.failed++;
      if (i.conflict && !i.excluded) c.conflicts++;
    }
    return c;
  }, [list]);

  if (job.error) return <ErrorNote error={job.error} />;
  const j = job.data?.job;
  const live = progress[jobId];
  const status = live?.status ?? j?.status ?? "pending";
  const busy = ["pending", "scanning", "matching", "executing"].includes(status);
  const sourceRoot = j?.sourcePaths.length === 1 ? j.sourcePaths[0] : undefined;
  const parsed = selected?.parsedJson as Parsed | undefined;
  const match = selected?.matchJson as MatchResult | null | undefined;
  const sample = selected && parsed ? { parsed, match, original: selected.sourcePath.split("/").at(-1)! } : undefined;
  const kind = match?.best?.kind === "movie" || parsed?.kind.value === "movie" ? "movie" : "episode";
  const roots = settings.data?.roots ?? [];
  const targets = [...new Set([j?.config.targetRoot, settings.data?.defaultTargetRoot, ...roots].filter((t): t is string => Boolean(t)))];
  const targetRoot = j?.config.targetRoot;

  const setMode = (mode: Mode) => {
    if (!config) return;
    // Rule-only jobs carry no matches: switching to media matches anew.
    if (j?.config.mode === "rules" && mode !== "rules") {
      setConfig({ ...config, mode });
      rematch.mutate({});
      return;
    }
    setConfig({ ...config, mode });
  };

  return (
    <>
      <header className="flex items-center gap-4">
        <div className="flex min-w-0 flex-grow flex-col gap-1">
          <h1 className="m-0 font-display text-[28px] font-bold tracking-[-0.02em]">{wb.title}</h1>
          <div className="flex min-w-0 items-center gap-1.5 font-mono text-[13px] text-muted">
            <span className="truncate">
              <Breadcrumb path={j?.sourcePaths[0]} />
            </span>
            {j && j.sourcePaths.length > 1 && <span>+{j.sourcePaths.length - 1}</span>}
            <Link to="/rename" search={{}} className="ml-2 font-sans text-[13px] no-underline">
              {wb.changeFolder}
            </Link>
          </div>
        </div>
        {config && <ModeToggle value={config.mode} onChange={setMode} />}
      </header>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-panel px-4 py-3">
        {config?.mode !== "rules" && (
          <>
            <label htmlFor="prov" className="text-[13px] text-muted">
              {t.common.source}
            </label>
            <Select id="prov" value="tmdb" onChange={() => {}}>
              <option value="tmdb">{wb.provider(kind)}</option>
            </Select>
            <label htmlFor="order" className="ml-2 text-[13px] text-muted">
              {wb.order}
            </label>
            <Select id="order" value={j?.config.order ?? "aired"} onChange={(e) => rematch.mutate({ order: e.target.value as "aired" })}>
              <option value="aired">{wb.orderAired}</option>
              <option value="dvd">{wb.orderDvd}</option>
              <option value="absolute">{wb.orderAbsolute}</option>
            </Select>
            <label htmlFor="lang" className="ml-2 text-[13px] text-muted">
              {t.common.language}
            </label>
            <Select
              id="lang"
              value={j?.config.language ?? settings.data?.language ?? "de-DE"}
              onChange={(e) => rematch.mutate({ language: e.target.value })}
            >
              {Object.entries(t.titleLanguages).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </Select>
          </>
        )}
        <div className="flex-grow" />
        {busy && status !== "executing" && <Button onClick={() => cancel.mutate()}>{t.common.cancel}</Button>}
        <Button onClick={() => setAddingFolder((a) => !a)} aria-expanded={addingFolder}>
          {wb.addFiles}
        </Button>
        <Button variant="light" onClick={() => rematch.mutate({})} disabled={!j || rematch.isPending}>
          <SearchIcon size={15} /> {wb.rematch}
        </Button>
      </div>

      {addingFolder && j && (
        <Panel className="p-4">
          <FolderBrowser
            initial={j.sourcePaths[0]}
            chooseLabel={t.folders.add}
            onChoose={(p) => {
              setAddingFolder(false);
              rematch.mutate({ paths: [...new Set([...j.sourcePaths, p])] });
            }}
          />
        </Panel>
      )}

      <ErrorNote
        error={
          recompute.error ?? update.error ?? execute.error ?? rematch.error ?? retarget.error ?? (j?.error ? new Error(j.error) : null)
        }
      />

      <div
        className="grid min-h-0 flex-grow grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_312px]"
        style={{ height: "calc(100vh - 230px)", minHeight: 520 }}
      >
        <section aria-label={wb.preview} className="flex min-h-0 flex-col overflow-hidden rounded-[14px] border border-line bg-panel">
          <div className="grid grid-cols-[28px_minmax(0,1fr)_44px_minmax(0,1fr)] items-center gap-3 border-b border-line px-4 py-3 text-xs font-semibold tracking-[0.02em] text-muted">
            <div />
            <div>{wb.original(n(list.length))}</div>
            <div />
            <div>{wb.newName}</div>
          </div>
          {busy && status !== "executing" ? (
            <div className="flex flex-col gap-3 p-6">
              <div className="text-sm">{t.jobStatus[status]}…</div>
              <Progress value={live?.total ? live.done / live.total : 0.05} />
            </div>
          ) : (
            <PreviewTable
              items={list}
              targetRoot={targetRoot}
              sourceRoot={sourceRoot}
              selectedId={selected?.id}
              onSelect={setSelectedId}
              onToggle={(item) => update.mutate({ itemId: item.id, excluded: !(item.excluded || item.state === "skipped") })}
              onSearch={(item) => setPicking(item)}
            />
          )}
          <div className="mt-auto flex flex-col gap-3 border-t border-line bg-panel-3 px-4 py-3.5">
            <div className="flex flex-wrap items-center gap-4 text-[13px]" aria-live="polite">
              <span>
                <strong className="font-semibold">{n(counts.ready)}</strong> <span className="text-muted">{wb.matched}</span>
              </span>
              <span>
                <strong className="font-semibold text-accent">{n(counts.review)}</strong> <span className="text-muted">{wb.review}</span>
              </span>
              <span>
                <strong className="font-semibold">{n(counts.skipped)}</strong> <span className="text-muted">{wb.skipped}</span>
              </span>
              <span className="text-muted">
                {n(counts.conflicts)} {wb.conflicts(counts.conflicts)}
              </span>
              {counts.done > 0 && <span className="text-[#4fd1a5]">{wb.done(n(counts.done))}</span>}
              {counts.failed > 0 && <span className="text-danger">{wb.failed(n(counts.failed))}</span>}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3">
              <label htmlFor="action" className="text-[13px] text-muted">
                {t.common.action}
              </label>
              <Select id="action" className="h-10" value={action} onChange={(e) => setAction(e.target.value as Action)}>
                {Object.entries(t.actions).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
              <label htmlFor="conflict" className="text-[13px] text-muted">
                {t.common.conflicts}
              </label>
              <Select id="conflict" className="h-10" value={conflict} onChange={(e) => setConflict(e.target.value as ConflictPolicy)}>
                {Object.entries(t.conflictPolicies).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
              <label htmlFor="target" className="text-[13px] text-muted">
                {t.common.target}
              </label>
              <Select
                id="target"
                className="h-10 max-w-60 font-mono"
                value={targetRoot ?? ""}
                onChange={(e) => retarget.mutate(e.target.value || null)}
              >
                <option value="">{wb.inPlace}</option>
                {targets.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
              <Button variant="accent" size="lg" onClick={() => execute.mutate()} disabled={!counts.ready || busy || execute.isPending}>
                {wb.run(n(counts.ready), counts.ready, action === "test")}
              </Button>
            </div>
          </div>
        </section>

        <aside aria-label={wb.sidebar} className="flex min-h-0 flex-col gap-4 overflow-auto">
          {config && config.mode !== "rules" && (
            <TemplateEditor
              preset={config.preset}
              template={config.template}
              kind={kind}
              sample={sample}
              onPreset={(preset) => setConfig({ ...config, preset, template: {} })}
              onTemplate={(template) => setConfig({ ...config, template })}
            />
          )}
          {config && config.mode !== "media" && (
            <RuleStack
              rules={config.rules}
              onChange={(rules) => setConfig({ ...config, rules })}
              sample={selected?.targetPath ?? selected?.sourcePath}
              title={config.mode === "rules" ? wb.rules : wb.rulesAfter}
              note={config.mode === "rules" ? wb.rulesNote : wb.rulesAfterNote}
            />
          )}
          {selected && (
            <section aria-labelledby="sel-h" className="flex flex-col gap-3 rounded-[14px] border border-line bg-panel p-4">
              <div className="flex gap-3">
                <Poster title={match?.best?.title ?? parsed?.title} src={match?.best?.poster} size="lg" />
                <div className="flex min-w-0 flex-col gap-1">
                  <h2 id="sel-h" className="m-0 text-sm font-semibold">
                    {selectedTitle(selected, parsed, match)}
                  </h2>
                  {match?.best && (
                    <div className="text-xs text-muted">
                      {match.best.title}
                      {match.best.year ? ` (${match.best.year})` : ""} · {match.best.provider.toUpperCase()}
                    </div>
                  )}
                  <div className="text-xs text-muted">
                    {[parsed?.release.resolution, parsed?.release.videoCodec, languageNames(t, parsed?.release.languages)]
                      .filter(Boolean)
                      .join(" · ") || wb.noRelease}
                  </div>
                  {selected.confidence > 0 && <div className="text-xs text-muted">{wb.confidence(pct(selected.confidence))}</div>}
                  {config?.mode !== "rules" && (
                    <button
                      type="button"
                      onClick={() => setPicking(selected)}
                      className="mt-1 cursor-pointer border-0 bg-transparent p-0 text-left text-xs text-accent hover:text-accent-soft"
                    >
                      {wb.otherMatch}
                    </button>
                  )}
                </div>
              </div>
              {selected.reasons.length > 0 && <div className="text-xs text-muted">{localize(selected.reasons.join(" · "))}</div>}
              {selected.error && <div className="text-xs text-danger">{localize(selected.error)}</div>}
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  update.mutate({ itemId: selected.id, targetPath: targetDraft || null });
                }}
              >
                <label htmlFor="target-override" className="sr-only">
                  {wb.targetOverride}
                </label>
                <input
                  id="target-override"
                  className={cx(inputClass, "h-8 min-w-0 flex-grow font-mono text-xs")}
                  placeholder={selected.overrideTarget ? wb.targetClear : wb.targetPlaceholder}
                  value={targetDraft}
                  onChange={(e) => setTargetDraft(e.target.value)}
                />
                <Button size="sm" type="submit" disabled={update.isPending || (!targetDraft && !selected.overrideTarget)}>
                  {wb.set}
                </Button>
              </form>
              {selected.state === "needs_review" && selected.targetPath && (
                <Button variant="light" onClick={() => update.mutate({ itemId: selected.id, approve: true })} disabled={update.isPending}>
                  {t.common.approve}
                </Button>
              )}
            </section>
          )}
        </aside>
      </div>

      <MatchPicker
        item={picking}
        onClose={() => setPicking(null)}
        onPick={(c, remember) => update.mutateAsync({ itemId: picking!.id, match: { id: c.id, kind: c.kind }, remember, approve: true })}
      />
    </>
  );
}

function selectedTitle(item: JobItem, parsed?: Parsed, match?: MatchResult | null): string {
  const ep = match?.episodes[0];
  if (ep) {
    const code = `S${String(ep.season).padStart(2, "0")}E${String(ep.episode).padStart(2, "0")}`;
    return ep.title ? `${code} · ${ep.title}` : code;
  }
  if (match?.best) return match.best.title;
  return parsed?.title ?? item.sourcePath.split("/").at(-1)!;
}

function languageNames(t: Messages, langs?: string[]) {
  return langs?.length ? langs.map((l) => t.releaseLanguages[l] ?? l).join(", ") : undefined;
}
