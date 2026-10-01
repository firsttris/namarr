import type { WatchFolder } from "@namarr/db/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button, Chip, cx, ErrorNote, Field, inputClass, PageHeader, Panel, Select } from "~/components/ui";
import { getProfiles, getWatchFolders, removeWatchFolder, saveWatchFolder } from "~/functions/library.functions";
import { ago, pct } from "~/lib/format";

export const Route = createFileRoute("/watch")({
  loader: () => getWatchFolders(),
  component: Watch,
});

type Draft = Pick<WatchFolder, "name" | "path" | "targetRoot" | "profileId" | "autoThreshold" | "stableSeconds" | "enabled"> & {
  id?: number;
};
const EMPTY: Draft = { name: "", path: "", targetRoot: "", profileId: null, autoThreshold: 0.9, stableSeconds: 30, enabled: true };

function Watch() {
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
      <PageHeader
        title="Watch-Folder"
        subtitle="Neue Downloads werden ohne Klick einsortiert, solange der Treffer sicher ist. Alles Unsichere wartet in der Inbox."
      >
        <Button variant="accent" size="lg" onClick={() => setDraft({ ...EMPTY })}>
          Watch-Folder anlegen
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
            <Field label="Name" htmlFor="w-name">
              <input
                id="w-name"
                className={inputClass}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                required
              />
            </Field>
            <Field label="Profil" htmlFor="w-profile">
              <Select
                id="w-profile"
                value={draft.profileId ?? ""}
                onChange={(e) => setDraft({ ...draft, profileId: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">Standard (Jellyfin, Hardlink)</option>
                {profiles.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Überwachter Ordner" htmlFor="w-path">
              <input
                id="w-path"
                className={cx(inputClass, "font-mono")}
                placeholder="/data/downloads/tv"
                value={draft.path}
                onChange={(e) => setDraft({ ...draft, path: e.target.value })}
                required
              />
            </Field>
            <Field label="Ziel" htmlFor="w-target" hint="Gleicher Mount wie die Downloads, sonst sind keine Hardlinks möglich">
              <input
                id="w-target"
                className={cx(inputClass, "font-mono")}
                placeholder="/data/media/tv"
                value={draft.targetRoot}
                onChange={(e) => setDraft({ ...draft, targetRoot: e.target.value })}
                required
              />
            </Field>
            <Field label="Automatisch ab" htmlFor="w-auto">
              <Select
                id="w-auto"
                value={draft.autoThreshold === null ? "never" : String(draft.autoThreshold)}
                onChange={(e) => setDraft({ ...draft, autoThreshold: e.target.value === "never" ? null : Number(e.target.value) })}
              >
                <option value="0.95">95 %</option>
                <option value="0.9">90 % (empfohlen)</option>
                <option value="0.8">80 %</option>
                <option value="never">Immer prüfen</option>
              </Select>
            </Field>
            <Field label="Datei gilt als fertig nach (Sekunden stabil)" htmlFor="w-stable">
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
              Aktiv
            </label>
            <div className="flex gap-2 md:col-span-2">
              <Button type="submit" variant="accent" size="lg" disabled={save.isPending}>
                Speichern
              </Button>
              <Button size="lg" onClick={() => setDraft(null)}>
                Abbrechen
              </Button>
            </div>
          </form>
        </Panel>
      )}
      <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
        {data.length === 0 && !draft && <Panel className="p-6 text-sm text-muted">Noch keine Watch-Folder.</Panel>}
        {data.map((f) => (
          <Panel key={f.id} className="flex flex-col gap-2.5 p-4">
            <div className="flex items-center gap-2">
              <span className={cx("h-2 w-2 rounded-full", f.enabled ? "bg-info" : "bg-faint")} />
              <div className="flex-grow text-sm font-semibold">{f.name}</div>
              <div className="text-xs text-muted">{f.enabled ? `zuletzt ${ago(f.lastEventAt)}` : "pausiert"}</div>
            </div>
            <div className="font-mono text-xs text-soft">
              {f.path} → {f.targetRoot}
            </div>
            <div className="flex gap-1.5">
              <Chip>{f.autoThreshold === null ? "Immer prüfen" : `Auto ab ${pct(f.autoThreshold)}`}</Chip>
              <Chip>{f.stableSeconds} s stabil</Chip>
              <Chip>{profiles.data?.find((p) => p.id === f.profileId)?.name ?? "Standard"}</Chip>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setDraft({ ...f })}>
                Bearbeiten
              </Button>
              <Button size="sm" onClick={() => save.mutate({ ...f, enabled: !f.enabled })}>
                {f.enabled ? "Pausieren" : "Aktivieren"}
              </Button>
              <Button size="sm" onClick={() => confirm(`Watch-Folder „${f.name}“ entfernen?`) && remove.mutate(f.id)}>
                Entfernen
              </Button>
            </div>
          </Panel>
        ))}
      </div>
    </>
  );
}
