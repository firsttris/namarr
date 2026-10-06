import { WATCH_ACTIONS } from "@namarr/core/fileops";
import { FORMAT_KINDS, formatsOf, resolveFormats, type WatchFolder } from "@namarr/db/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PathInput } from "~/components/PathInput";
import { TargetFields } from "~/components/TargetFields";
import { Button, Chip, cx, ErrorNote, Field, inputClass, PageHeader, Panel, Select } from "~/components/ui";
import { getSettingsFn, getWatchFolders, removeWatchFolder, saveWatchFolder } from "~/functions/library.functions";
import { ago, pct } from "~/lib/format";
import { pickMsg } from "~/lib/i18n";
import { msgGroup } from "~/lib/msg-groups";
import { SERIES_SOURCES } from "~/lib/providers";
import * as m from "~/paraglide/messages";

export const Route = createFileRoute("/watch")({
  loader: () => getWatchFolders(),
  component: Watch,
});

type Draft = Pick<WatchFolder, "name" | "path" | "targets" | "options" | "autoThreshold" | "stableSeconds" | "enabled"> & {
  id?: number;
};
const EMPTY: Draft = { name: "", path: "", targets: {}, options: {}, autoThreshold: 0.9, stableSeconds: 30, enabled: true };

function Watch() {
  const initial = Route.useLoaderData();
  const qc = useQueryClient();
  const { data = initial } = useQuery({ queryKey: ["watch"], queryFn: () => getWatchFolders(), initialData: initial });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => getSettingsFn() });
  const folders = settings.data?.folders ?? [];
  const stored = { formats: settings.data?.formats ?? [], defaultFormats: settings.data?.defaultFormats ?? {} };
  /** Where a watch folder's files go, for its card: its own folders, else the defaults. */
  const targetsOf = (f: Pick<WatchFolder, "targets">) => {
    const fallback = (kind: "movies" | "series") => folders.find((x) => x.kind === kind && x.default)?.path;
    const movie = f.targets.movie ?? fallback("movies");
    const series = f.targets.series ?? fallback("series");
    return movie === series ? (movie ?? "–") : `${m.targets_movies()} ${movie ?? "–"} · ${m.targets_series()} ${series ?? "–"}`;
  };
  const setOptions = (d: Draft, options: Partial<Draft["options"]>) => setDraft({ ...d, options: { ...d.options, ...options } });
  const [draft, setDraft] = useState<Draft | null>(null);
  const done = () => {
    qc.invalidateQueries({ queryKey: ["watch"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    setDraft(null);
  };
  const save = useMutation({ mutationFn: (d: Draft) => saveWatchFolder({ data: d }), onSuccess: done });
  const remove = useMutation({ mutationFn: (id: number) => removeWatchFolder({ data: { id } }), onSuccess: done });

  return (
    <>
      <PageHeader title={m.watch_title()} subtitle={m.watch_subtitle()}>
        <Button variant="accent" size="lg" onClick={() => setDraft({ ...EMPTY })}>
          {m.watch_create()}
        </Button>
      </PageHeader>
      <ErrorNote error={save.error ?? remove.error} />
      {draft && (
        <Panel>
          <form
            className="grid gap-4 p-5 md:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(draft);
            }}
          >
            <Field label={m.common_name()} htmlFor="w-name">
              <input
                id="w-name"
                className={inputClass}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                required
              />
            </Field>
            <Field label={m.watch_folder()} htmlFor="w-path">
              <PathInput
                id="w-path"
                label={m.watch_folder()}
                placeholder="/data/downloads/tv"
                value={draft.path}
                onChange={(path) => setDraft({ ...draft, path })}
                required
              />
            </Field>
            <TargetFields
              idPrefix="w-target"
              mode="media"
              targets={draft.targets}
              folders={folders}
              onChange={(targets) => setDraft({ ...draft, targets })}
            />
            {FORMAT_KINDS.map((kind) => (
              <Field key={kind} label={kind === "movie" ? m.watch_formatMovies() : m.watch_formatSeries()} htmlFor={`w-format-${kind}`}>
                <Select
                  id={`w-format-${kind}`}
                  value={draft.options.formats?.[kind] ?? ""}
                  onChange={(e) => setOptions(draft, { formats: { ...draft.options.formats, [kind]: e.target.value || undefined } })}
                >
                  <option value="">{m.common_fromSettings({ name: resolveFormats(stored)[kind].name })}</option>
                  {formatsOf(stored, kind).map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ))}
            <Field label={m.common_seriesSource()} htmlFor="w-provider">
              <Select
                id="w-provider"
                value={draft.options.provider ?? ""}
                onChange={(e) => setOptions(draft, { provider: (e.target.value || undefined) as Draft["options"]["provider"] })}
              >
                <option value="">
                  {m.common_fromSettings({ name: pickMsg(msgGroup.providers, settings.data?.seriesProvider ?? "tmdb") })}
                </option>
                {SERIES_SOURCES.map((p) => (
                  <option key={p} value={p}>
                    {pickMsg(msgGroup.providers, p)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={m.common_action()} htmlFor="w-action">
              <Select
                id="w-action"
                value={draft.options.action ?? "move"}
                onChange={(e) => setOptions(draft, { action: e.target.value as Draft["options"]["action"] })}
              >
                {WATCH_ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {pickMsg(msgGroup.actions, a)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={m.common_conflicts()} htmlFor="w-conflict">
              <Select
                id="w-conflict"
                value={draft.options.conflictPolicy ?? "skip"}
                onChange={(e) => setOptions(draft, { conflictPolicy: e.target.value as Draft["options"]["conflictPolicy"] })}
              >
                {Object.entries(msgGroup.conflictPolicies).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v()}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={m.watch_autoFrom()} htmlFor="w-auto">
              <Select
                id="w-auto"
                value={draft.autoThreshold === null ? "never" : String(draft.autoThreshold)}
                onChange={(e) => setDraft({ ...draft, autoThreshold: e.target.value === "never" ? null : Number(e.target.value) })}
              >
                <option value="0.95">95 %</option>
                <option value="0.9">{m.watch_recommended({ pct: "90 %" })}</option>
                <option value="0.8">80 %</option>
                <option value="never">{m.watch_alwaysReview()}</option>
              </Select>
            </Field>
            <Field label={m.watch_stable()} htmlFor="w-stable">
              <input
                id="w-stable"
                type="number"
                min={1}
                className={inputClass}
                value={draft.stableSeconds}
                onChange={(e) => setDraft({ ...draft, stableSeconds: Number(e.target.value) })}
              />
            </Field>
            <label className="flex items-center gap-2 text-[13px] text-soft">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                className="h-4 w-4"
              />
              {m.watch_enabled()}
            </label>
            <div className="flex gap-2 md:col-span-2">
              <Button type="submit" variant="accent" size="lg" disabled={save.isPending}>
                {m.common_save()}
              </Button>
              <Button size="lg" onClick={() => setDraft(null)}>
                {m.common_cancel()}
              </Button>
            </div>
          </form>
        </Panel>
      )}
      <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
        {data.length === 0 && !draft && <Panel className="p-6 text-sm text-muted">{m.watch_none()}</Panel>}
        {data.map((f) => (
          <Panel key={f.id} className="flex flex-col gap-2.5 p-4">
            <div className="flex items-center gap-2">
              <span className={cx("h-2 w-2 rounded-full", f.enabled ? "bg-info" : "bg-faint")} />
              <div className="flex-grow text-sm font-semibold">{f.name}</div>
              <div className="text-xs text-muted">{f.enabled ? m.watch_lastEvent({ when: ago(f.lastEventAt) }) : m.watch_paused()}</div>
            </div>
            <div className="font-mono text-xs text-soft">
              {f.path} → {targetsOf(f)}
            </div>
            <div className="flex gap-1.5">
              <Chip>{f.autoThreshold === null ? m.watch_alwaysReview() : m.dashboard_autoFrom({ pct: pct(f.autoThreshold) })}</Chip>
              <Chip>{m.dashboard_stableSeconds({ n: f.stableSeconds })}</Chip>
              <Chip>{pickMsg(msgGroup.actions, f.options.action ?? "move")}</Chip>
              <Chip>
                {(() => {
                  const fm = resolveFormats(stored, f.options.formats);
                  return fm.movie.name === fm.series.name ? fm.movie.name : `${fm.movie.name} · ${fm.series.name}`;
                })()}
              </Chip>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setDraft({ ...f })}>
                {m.common_edit()}
              </Button>
              <Button size="sm" onClick={() => save.mutate({ ...f, enabled: !f.enabled })}>
                {f.enabled ? m.watch_pause() : m.watch_activate()}
              </Button>
              <Button size="sm" onClick={() => confirm(m.watch_confirmRemove({ name: f.name })) && remove.mutate(f.id)}>
                {m.common_remove()}
              </Button>
            </div>
          </Panel>
        ))}
      </div>
    </>
  );
}
