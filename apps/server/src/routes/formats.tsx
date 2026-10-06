import { FORMAT_KINDS, type FormatKind, formatsOf, type NameFormat, newFormatId } from "@namarr/db/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { TemplateEditor } from "~/components/TemplateEditor";
import { Button, Chip, cx, ErrorNote, Field, inputClass, PageHeader, Panel } from "~/components/ui";
import { getSettingsFn, saveFormats } from "~/functions/library.functions";
import { SAMPLE_EPISODE, SAMPLE_MOVIE } from "~/lib/samples";
import { type Search, searchEnum, searchString } from "~/lib/search";
import * as m from "~/paraglide/messages";

export const Route = createFileRoute("/formats")({
  validateSearch: (s: Search): { kind?: FormatKind; id?: string } => ({
    kind: searchEnum(FORMAT_KINDS)(s.kind),
    id: searchString(s.id),
  }),
  loader: () => getSettingsFn(),
  component: Formats,
});

type Stored = { formats: NameFormat[]; defaultFormats: { movie?: string; series?: string } };

const kindLabel = (kind: FormatKind) => (kind === "movie" ? m.common_movies() : m.common_series());

function Formats() {
  const initial = Route.useLoaderData();
  const search = Route.useSearch();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data = initial } = useQuery({ queryKey: ["settings"], queryFn: () => getSettingsFn(), initialData: initial });
  const stored: Stored = { formats: data.formats, defaultFormats: data.defaultFormats };
  const isDefault = (f: NameFormat) => (data.defaultFormats[f.kind] ?? "jellyfin") === f.id;

  const selected = search.kind && search.id ? formatsOf(stored, search.kind).find((f) => f.id === search.id) : undefined;
  // An unsaved new format lives only here until it is saved.
  const [draft, setDraft] = useState<NameFormat | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only react to a different selection
  useEffect(() => {
    setDraft(selected ? { ...selected } : null);
  }, [search.kind, search.id]);

  const store = useMutation({
    /** `open`: the format to show afterwards; null: none (it was deleted). */
    mutationFn: (next: Stored & { open: NameFormat | null }) =>
      saveFormats({ data: { formats: next.formats, defaultFormats: next.defaultFormats } }),
    onSuccess: async (_, next) => {
      // The list first, so the format opened next is already in it.
      await qc.invalidateQueries({ queryKey: ["settings"] });
      navigate({ to: "/formats", search: next.open ? { kind: next.open.kind, id: next.open.id } : {} });
    },
  });

  const own = (f: NameFormat) => !f.builtin;
  const create = (kind: FormatKind, from?: NameFormat) =>
    setDraft({
      id: newFormatId(),
      kind,
      name: from ? m.formats_copyOf({ name: from.name }) : m.formats_new(),
      template: from?.template ?? formatsOf(stored, kind).find(isDefault)?.template ?? "",
    });
  const saveDraft = (d: NameFormat) => {
    const clean = { id: d.id, name: d.name, kind: d.kind, template: d.template };
    const exists = stored.formats.some((f) => f.id === d.id);
    store.mutate({
      ...stored,
      formats: exists ? stored.formats.map((f) => (f.id === d.id ? clean : f)) : [...stored.formats, clean],
      open: clean,
    });
  };
  const remove = (d: NameFormat) => store.mutate({ ...stored, formats: stored.formats.filter((f) => f.id !== d.id), open: null });
  const makeDefault = (d: NameFormat) => store.mutate({ ...stored, defaultFormats: { ...stored.defaultFormats, [d.kind]: d.id }, open: d });

  const saved = draft ? stored.formats.find((f) => f.id === draft.id) : undefined;
  const isNew = Boolean(draft && !draft.builtin && !saved);

  return (
    <>
      <PageHeader title={m.formats_title()} subtitle={m.formats_subtitle()} />
      <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          {FORMAT_KINDS.map((kind) => (
            <Panel key={kind} className="flex flex-col p-2" aria-label={kindLabel(kind)} role="group">
              <div className="flex items-center gap-2 px-3 py-2">
                <h2 className="m-0 flex-grow text-sm font-semibold">{kindLabel(kind)}</h2>
                <Button size="sm" onClick={() => create(kind)}>
                  {m.formats_add()}
                </Button>
              </div>
              {formatsOf(stored, kind).map((f) => (
                <Link
                  key={f.id}
                  to="/formats"
                  search={{ kind, id: f.id }}
                  className={cx(
                    "flex items-center gap-2 rounded-lg px-3 py-2 text-sm no-underline",
                    draft?.kind === kind && draft.id === f.id ? "bg-active text-white" : "text-soft hover:bg-panel-2",
                  )}
                >
                  <span className="flex-grow font-semibold">{f.name}</span>
                  {isDefault(f) && <Chip>{m.formats_default()}</Chip>}
                  {f.builtin && <Chip>{m.formats_builtin()}</Chip>}
                </Link>
              ))}
            </Panel>
          ))}
        </div>
        {draft ? (
          <form
            className="flex flex-col gap-4"
            aria-label={draft.name}
            onSubmit={(e) => {
              e.preventDefault();
              if (own(draft)) saveDraft(draft);
            }}
          >
            <Panel className="grid gap-4 p-5 md:grid-cols-2">
              <Field label={m.common_name()} htmlFor="f-name">
                <input
                  id="f-name"
                  className={inputClass}
                  value={draft.name}
                  readOnly={draft.builtin}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  required
                />
              </Field>
              <Field label={m.formats_kind()} htmlFor="f-kind">
                <input id="f-kind" className={inputClass} value={kindLabel(draft.kind)} readOnly />
              </Field>
              {draft.builtin && <p className="m-0 text-[13px] text-muted md:col-span-2">{m.formats_builtinNote()}</p>}
            </Panel>
            <TemplateEditor
              kind={draft.kind === "movie" ? "movie" : "episode"}
              value={draft.template}
              readOnly={draft.builtin}
              onChange={(template) => setDraft({ ...draft, template })}
              sample={draft.kind === "movie" ? SAMPLE_MOVIE : SAMPLE_EPISODE}
            />
            <ErrorNote error={store.error} />
            <div className="flex flex-wrap gap-2">
              {own(draft) && (
                <Button type="submit" variant="accent" size="lg" disabled={store.isPending || !draft.template.trim()}>
                  {m.common_save()}
                </Button>
              )}
              {!isNew && !isDefault(draft) && (
                <Button size="lg" onClick={() => makeDefault(draft)} disabled={store.isPending}>
                  {m.formats_makeDefault({ kind: kindLabel(draft.kind) })}
                </Button>
              )}
              {!isNew && (
                <Button size="lg" onClick={() => create(draft.kind, draft)}>
                  {m.formats_copy()}
                </Button>
              )}
              {saved && (
                <Button size="lg" onClick={() => confirm(m.formats_confirmDelete({ name: draft.name })) && remove(draft)}>
                  {m.formats_delete()}
                </Button>
              )}
            </div>
          </form>
        ) : (
          <Panel className="p-6 text-sm text-muted">{m.formats_pick()}</Panel>
        )}
      </div>
    </>
  );
}
