import type { WatchFolder } from "@namarr/db/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button, Chip, cx, ErrorNote, Field, inputClass, PageHeader, Panel, Select } from "~/components/ui";
import { getProfiles, getWatchFolders, removeWatchFolder, saveWatchFolder } from "~/functions/library.functions";
import { ago, pct } from "~/lib/format";
import { useT } from "~/lib/i18n";

export const Route = createFileRoute("/watch")({
  loader: () => getWatchFolders(),
  component: Watch,
});

type Draft = Pick<WatchFolder, "name" | "path" | "targetRoot" | "profileId" | "autoThreshold" | "stableSeconds" | "enabled"> & {
  id?: number;
};
const EMPTY: Draft = { name: "", path: "", targetRoot: "", profileId: null, autoThreshold: 0.9, stableSeconds: 30, enabled: true };

function Watch() {
  const t = useT();
  const w = t.watch;
  const initial = Route.useLoaderData();
  const qc = useQueryClient();
  const { data = initial } = useQuery({ queryKey: ["watch"], queryFn: () => getWatchFolders(), initialData: initial });
  const profiles = useQuery({ queryKey: ["profiles"], queryFn: () => getProfiles() });
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
      <PageHeader title={w.title} subtitle={w.subtitle}>
        <Button variant="accent" size="lg" onClick={() => setDraft({ ...EMPTY })}>
          {w.create}
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
            <Field label={t.common.name} htmlFor="w-name">
              <input
                id="w-name"
                className={inputClass}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                required
              />
            </Field>
            <Field label={t.common.profile} htmlFor="w-profile">
              <Select
                id="w-profile"
                value={draft.profileId ?? ""}
                onChange={(e) => setDraft({ ...draft, profileId: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">{w.defaultProfile}</option>
                {profiles.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={w.folder} htmlFor="w-path">
              <input
                id="w-path"
                className={cx(inputClass, "font-mono")}
                placeholder="/data/downloads/tv"
                value={draft.path}
                onChange={(e) => setDraft({ ...draft, path: e.target.value })}
                required
              />
            </Field>
            <Field label={t.common.target} htmlFor="w-target" hint={w.targetHint}>
              <input
                id="w-target"
                className={cx(inputClass, "font-mono")}
                placeholder="/data/media/tv"
                value={draft.targetRoot}
                onChange={(e) => setDraft({ ...draft, targetRoot: e.target.value })}
                required
              />
            </Field>
            <Field label={w.autoFrom} htmlFor="w-auto">
              <Select
                id="w-auto"
                value={draft.autoThreshold === null ? "never" : String(draft.autoThreshold)}
                onChange={(e) => setDraft({ ...draft, autoThreshold: e.target.value === "never" ? null : Number(e.target.value) })}
              >
                <option value="0.95">95 %</option>
                <option value="0.9">{w.recommended("90 %")}</option>
                <option value="0.8">80 %</option>
                <option value="never">{w.alwaysReview}</option>
              </Select>
            </Field>
            <Field label={w.stable} htmlFor="w-stable">
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
              {w.enabled}
            </label>
            <div className="flex gap-2 md:col-span-2">
              <Button type="submit" variant="accent" size="lg" disabled={save.isPending}>
                {t.common.save}
              </Button>
              <Button size="lg" onClick={() => setDraft(null)}>
                {t.common.cancel}
              </Button>
            </div>
          </form>
        </Panel>
      )}
      <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
        {data.length === 0 && !draft && <Panel className="p-6 text-sm text-muted">{w.none}</Panel>}
        {data.map((f) => (
          <Panel key={f.id} className="flex flex-col gap-2.5 p-4">
            <div className="flex items-center gap-2">
              <span className={cx("h-2 w-2 rounded-full", f.enabled ? "bg-info" : "bg-faint")} />
              <div className="flex-grow text-sm font-semibold">{f.name}</div>
              <div className="text-xs text-muted">{f.enabled ? w.lastEvent(ago(t, f.lastEventAt)) : w.paused}</div>
            </div>
            <div className="font-mono text-xs text-soft">
              {f.path} → {f.targetRoot}
            </div>
            <div className="flex gap-1.5">
              <Chip>{f.autoThreshold === null ? w.alwaysReview : t.dashboard.autoFrom(pct(f.autoThreshold))}</Chip>
              <Chip>{t.dashboard.stableSeconds(f.stableSeconds)}</Chip>
              <Chip>{profiles.data?.find((p) => p.id === f.profileId)?.name ?? w.standard}</Chip>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setDraft({ ...f })}>
                {t.common.edit}
              </Button>
              <Button size="sm" onClick={() => save.mutate({ ...f, enabled: !f.enabled })}>
                {f.enabled ? w.pause : w.activate}
              </Button>
              <Button size="sm" onClick={() => confirm(w.confirmRemove(f.name)) && remove.mutate(f.id)}>
                {t.common.remove}
              </Button>
            </div>
          </Panel>
        ))}
      </div>
    </>
  );
}
