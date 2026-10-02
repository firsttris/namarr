import type { Profile } from "@namarr/db/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { RuleStack } from "~/components/RuleStack";
import { TemplateEditor } from "~/components/TemplateEditor";
import { Button, cx, ErrorNote, Field, inputClass, PageHeader, Panel, Select } from "~/components/ui";
import { getProfiles, getSettingsFn, removeProfile, saveProfile } from "~/functions/library.functions";
import { useT } from "~/lib/i18n";
import { SERIES_SOURCES } from "~/lib/providers";

export const Route = createFileRoute("/profiles")({
  validateSearch: z.object({ id: z.coerce.number().optional() }),
  loader: () => getProfiles(),
  component: Profiles,
});

type Draft = Omit<Profile, "id" | "createdAt"> & { id?: number };

const EMPTY: Draft = {
  name: "",
  mode: "media",
  preset: "jellyfin",
  template: {},
  rulesJson: [],
  action: "hardlink",
  conflictPolicy: "skip",
  targetRoot: null,
  provider: null,
};

function Profiles() {
  const t = useT();
  const initial = Route.useLoaderData();
  const { id } = Route.useSearch();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data = initial } = useQuery({ queryKey: ["profiles"], queryFn: () => getProfiles(), initialData: initial });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => getSettingsFn() });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [kind, setKind] = useState<"episode" | "movie">("episode");

  // Open the profile named in the URL; local edits are kept until another one is chosen.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only react to a different id
  useEffect(() => {
    const p = data.find((x) => x.id === id);
    setDraft(p ? { ...p } : null);
  }, [id]);

  const save = useMutation({
    mutationFn: (d: Draft) => saveProfile({ data: d }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["profiles"] });
      if (p) {
        setDraft({ ...p });
        navigate({ to: "/profiles", search: { id: p.id } });
      }
    },
  });
  const remove = useMutation({
    mutationFn: (pid: number) => removeProfile({ data: { id: pid } }),
    onSuccess: () => {
      setDraft(null);
      qc.invalidateQueries({ queryKey: ["profiles"] });
      navigate({ to: "/profiles", search: {} });
    },
  });

  return (
    <>
      <PageHeader title={t.profiles.title} subtitle={t.profiles.subtitle}>
        <Button variant="accent" size="lg" onClick={() => setDraft({ ...EMPTY, name: t.profiles.new })}>
          {t.profiles.new}
        </Button>
      </PageHeader>
      <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
        <Panel className="flex flex-col p-2">
          {data.length === 0 && <p className="m-0 p-3 text-sm text-muted">{t.profiles.none}</p>}
          {data.map((p) => (
            <Link
              key={p.id}
              to="/profiles"
              search={{ id: p.id }}
              className={cx(
                "rounded-lg px-3 py-2.5 text-sm no-underline",
                draft?.id === p.id ? "bg-active text-white" : "text-soft hover:bg-panel-2",
              )}
            >
              <div className="font-semibold">{p.name}</div>
              <div className="text-xs text-muted">
                {t.modes[p.mode]} · {t.actions[p.action] ?? p.action}
              </div>
            </Link>
          ))}
        </Panel>
        {draft ? (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(draft);
            }}
          >
            <Panel className="grid gap-4 p-5 md:grid-cols-2">
              <Field label={t.common.name} htmlFor="p-name">
                <input
                  id="p-name"
                  className={inputClass}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  required
                />
              </Field>
              <Field label={t.common.mode} htmlFor="p-mode">
                <Select id="p-mode" value={draft.mode} onChange={(e) => setDraft({ ...draft, mode: e.target.value as Draft["mode"] })}>
                  <option value="media">{t.modes.media}</option>
                  <option value="rules">{t.modes.rules}</option>
                  <option value="both">{t.modes.both}</option>
                </Select>
              </Field>
              <Field label={t.common.action} htmlFor="p-action">
                <Select
                  id="p-action"
                  value={draft.action}
                  onChange={(e) => setDraft({ ...draft, action: e.target.value as Draft["action"] })}
                >
                  {Object.entries(t.actions).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t.common.conflicts} htmlFor="p-conflict">
                <Select
                  id="p-conflict"
                  value={draft.conflictPolicy}
                  onChange={(e) => setDraft({ ...draft, conflictPolicy: e.target.value as Draft["conflictPolicy"] })}
                >
                  {Object.entries(t.conflictPolicies).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </Field>
              {draft.mode !== "rules" && (
                <Field label={t.common.seriesSource} htmlFor="p-provider">
                  <Select
                    id="p-provider"
                    value={draft.provider ?? ""}
                    onChange={(e) => setDraft({ ...draft, provider: (e.target.value || null) as Draft["provider"] })}
                  >
                    <option value="">{t.common.fromSettings(t.providers[settings.data?.seriesProvider ?? "tmdb"])}</option>
                    {SERIES_SOURCES.map((p) => (
                      <option key={p} value={p}>
                        {t.providers[p]}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field label={t.profiles.targetRoot} htmlFor="p-target" hint={t.profiles.targetHint}>
                <input
                  id="p-target"
                  className={cx(inputClass, "font-mono")}
                  value={draft.targetRoot ?? ""}
                  onChange={(e) => setDraft({ ...draft, targetRoot: e.target.value || null })}
                />
              </Field>
            </Panel>
            {draft.mode !== "rules" && (
              <div className="flex flex-col gap-2">
                <div role="group" aria-label={t.profiles.templateFor} className="flex gap-2">
                  {(["episode", "movie"] as const).map((k) => (
                    <Button
                      key={k}
                      size="sm"
                      aria-pressed={kind === k}
                      className={kind === k ? "bg-toggle" : undefined}
                      onClick={() => setKind(k)}
                    >
                      {k === "episode" ? t.common.series : t.common.movies}
                    </Button>
                  ))}
                </div>
                <TemplateEditor
                  preset={draft.preset}
                  template={draft.template}
                  kind={kind}
                  sample={kind === "episode" ? SAMPLE_EPISODE : SAMPLE_MOVIE}
                  onPreset={(preset) => setDraft({ ...draft, preset, template: {} })}
                  onTemplate={(template) => setDraft({ ...draft, template })}
                />
              </div>
            )}
            {draft.mode !== "media" && (
              <RuleStack
                rules={draft.rulesJson}
                onChange={(rules) => setDraft({ ...draft, rulesJson: rules })}
                sample={kind === "episode" ? "Severance (2022) - S02E01 - Hallo, Frau Cobel.mkv" : "Das Boot (1981).mkv"}
              />
            )}
            <ErrorNote error={save.error ?? remove.error} />
            <div className="flex gap-2">
              <Button type="submit" variant="accent" size="lg" disabled={save.isPending}>
                {t.common.save}
              </Button>
              {draft.id && (
                <Button size="lg" onClick={() => confirm(t.profiles.confirmDelete(draft.name)) && remove.mutate(draft.id!)}>
                  {t.profiles.delete}
                </Button>
              )}
              {draft.id && (
                <Link to="/rename" search={{ profile: draft.id }} className="no-underline">
                  <Button size="lg">{t.profiles.useInWorkbench}</Button>
                </Link>
              )}
            </div>
          </form>
        ) : (
          <Panel className="p-6 text-sm text-muted">{t.profiles.pick}</Panel>
        )}
      </div>
    </>
  );
}

const SAMPLE_EPISODE = {
  original: "Severance.S02E01.German.DL.1080p.WEB.h264-GRP.mkv",
  parsed: {
    kind: { value: "episode" as const, confidence: 0.95 },
    title: "Severance",
    season: 2,
    episodes: [1],
    release: { resolution: "1080p", videoCodec: "H.264", group: "GRP", languages: ["de", "en"] },
  },
  match: {
    best: { provider: "tmdb", id: "95396", kind: "series" as const, title: "Severance", year: 2022 },
    episodes: [{ season: 2, episode: 1, title: "Hallo, Frau Cobel" }],
    alternatives: [],
    confidence: 0.97,
    reasons: [],
  },
};

const SAMPLE_MOVIE = {
  original: "Das.Boot.1981.Directors.Cut.German.DL.1080p.BluRay.mkv",
  parsed: {
    kind: { value: "movie" as const, confidence: 0.85 },
    title: "Das Boot",
    year: 1981,
    episodes: [],
    edition: "Director's Cut",
    release: { resolution: "1080p", source: "BluRay", languages: ["de", "en"] },
  },
  match: {
    best: { provider: "tmdb", id: "387", kind: "movie" as const, title: "Das Boot", year: 1981 },
    episodes: [],
    alternatives: [],
    confidence: 0.95,
    reasons: [],
  },
};
