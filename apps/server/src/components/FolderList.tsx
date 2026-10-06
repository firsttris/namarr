import { FOLDER_KINDS, type FolderKind, type LibraryFolder } from "@namarr/db/types";
import * as m from "~/paraglide/messages";
import { XIcon } from "./icons";
import { PathInput } from "./PathInput";
import { Button, cx, inputClass, Select } from "./ui";

const kindLabel: Record<FolderKind, () => string> = {
  folder: m.folders_kind_folder,
  movies: m.folders_kind_movies,
  series: m.folders_kind_series,
};

/** The first folder of a kind becomes its default; a kind keeps exactly one default while it has folders. */
function withDefaults(folders: LibraryFolder[]): LibraryFolder[] {
  return folders.map((f, i) => {
    if (f.kind === "folder") return { ...f, default: undefined };
    const ofKind = folders.filter((g) => g.kind === f.kind);
    const marked = ofKind.find((g) => g.default);
    return { ...f, default: marked ? f === marked || undefined : folders.findIndex((g) => g.kind === f.kind) === i || undefined };
  });
}

const nameOf = (p: string) => p.split("/").filter(Boolean).at(-1) ?? "";

/** The folders namarr may use, each optionally a library folder for movies or series. */
export function FolderList({ folders, onChange }: { folders: LibraryFolder[]; onChange: (folders: LibraryFolder[]) => void }) {
  const set = (i: number, patch: Partial<LibraryFolder>) =>
    onChange(withDefaults(folders.map((f, k) => (k === i ? { ...f, ...patch } : f))));
  const makeDefault = (i: number) =>
    onChange(folders.map((f, k) => (f.kind === folders[i]!.kind && f.kind !== "folder" ? { ...f, default: k === i || undefined } : f)));
  const library = (kind: "movies" | "series") => withDefaults(folders).find((f) => f.kind === kind && f.default);

  return (
    <div className="flex flex-col gap-3">
      {folders.map((f, i) => (
        <div
          key={i}
          role="group"
          aria-label={f.name || f.path || m.folders_new()}
          className="flex flex-col gap-2 rounded-[10px] border border-line-2 bg-panel-2 p-3"
        >
          <PathInput
            id={`folder-${i}`}
            label={f.name || m.folders_new()}
            scope="all"
            value={f.path}
            placeholder="/movies"
            // The name follows the path until it is changed by hand.
            onChange={(p) => set(i, { path: p, name: !f.name || f.name === nameOf(f.path) ? nameOf(p) : f.name })}
          />
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label={m.folders_name()}
              className={cx(inputClass, "min-w-0 flex-grow basis-40")}
              value={f.name}
              placeholder={nameOf(f.path) || m.folders_namePlaceholder()}
              onChange={(e) => set(i, { name: e.target.value })}
            />
            <Select aria-label={m.folders_kind()} value={f.kind} onChange={(e) => set(i, { kind: e.target.value as FolderKind })}>
              {FOLDER_KINDS.map((k) => (
                <option key={k} value={k}>
                  {kindLabel[k]()}
                </option>
              ))}
            </Select>
            {f.kind !== "folder" && (
              <label className="flex items-center gap-2 px-1 text-[13px] text-soft">
                <input type="radio" name={`default-${f.kind}`} checked={Boolean(f.default)} onChange={() => makeDefault(i)} />
                {m.folders_default()}
              </label>
            )}
            <Button
              size="sm"
              className="ml-auto"
              aria-label={m.folders_remove({ name: f.name || f.path })}
              onClick={() => onChange(withDefaults(folders.filter((_, k) => k !== i)))}
            >
              <XIcon />
            </Button>
          </div>
        </div>
      ))}
      <div>
        <Button size="sm" onClick={() => onChange([...folders, { path: "", name: "", kind: "folder" }])}>
          {m.folders_addFolder()}
        </Button>
      </div>
      <p className="m-0 text-xs text-muted">
        {library("movies") ? m.folders_moviesGoTo({ path: library("movies")!.path }) : m.folders_noMovieLibrary()}
        {" · "}
        {library("series") ? m.folders_seriesGoTo({ path: library("series")!.path }) : m.folders_noSeriesLibrary()}
      </p>
    </div>
  );
}
