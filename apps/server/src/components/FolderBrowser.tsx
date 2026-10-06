import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { browseFolder } from "~/functions/library.functions";
import * as m from "~/paraglide/messages";
import { FileIcon, FolderIcon } from "./icons";
import { Button, cx, ErrorNote } from "./ui";

type Props = {
  initial?: string;
  /** Choose the current folder; without it only files can be chosen (`onChooseFile`). */
  onChoose?: (path: string) => void;
  chooseLabel?: string;
  /** "all": the whole file system, folders only (for choosing the allowed folders themselves). */
  scope?: "allowed" | "all";
  /** Video files can be chosen too. */
  onChooseFile?: (path: string) => void;
};

/** Server-side folder browser, limited to the allowed folders unless `scope` is "all". */
export function FolderBrowser({ initial, onChoose, chooseLabel, scope = "allowed", onChooseFile }: Props) {
  const [path, setPath] = useState<string | undefined>(initial);
  const q = useQuery({
    queryKey: ["browse", scope, path ?? ""],
    queryFn: () => browseFolder({ data: { path, scope } }),
    // A typed path that does not exist (yet): start at the top instead of showing an error.
    retry: false,
  });
  if (q.isError && path && path === initial) setPath(undefined);
  const data = q.data;

  if (data && !data.path) {
    return (
      <div className="flex flex-col gap-2">
        <div className="text-sm text-muted">{m.folders_roots()}</div>
        {data.roots.length === 0 && (
          <p className="m-0 text-sm text-muted">
            {m.folders_noRoots()} <Link to="/settings">{m.folders_setRoots()}</Link>
          </p>
        )}
        {data.roots.map((r) => (
          <button key={r} type="button" onClick={() => setPath(r)} className={rowClass}>
            <FolderIcon /> <span className="font-mono">{r}</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex items-center gap-2">
        {/* Long paths: the end (where you are) stays visible. */}
        <div className="min-w-0 flex-grow truncate text-left font-mono text-[13px] text-ink [direction:rtl]" title={data?.path ?? path}>
          <bdi>{data?.path ?? path}</bdi>
        </div>
        <Button size="sm" onClick={() => setPath(data?.parent ?? undefined)} disabled={!data}>
          {data?.parent ? m.folders_up() : m.folders_roots()}
        </Button>
        {onChoose && (
          <Button size="sm" variant="accent" onClick={() => data?.path && onChoose(data.path)} disabled={!data?.path}>
            {chooseLabel ?? m.folders_choose()}
          </Button>
        )}
      </div>
      <ErrorNote error={q.error} />
      <ul className="m-0 flex max-h-[420px] list-none flex-col overflow-auto p-0" aria-label={m.folders_contents()}>
        {data?.entries.length === 0 && <li className="py-2 text-sm text-muted">{m.folders_empty()}</li>}
        {data?.entries.map((e) => (
          <li key={e.path}>
            {e.dir ? (
              <button type="button" onClick={() => setPath(e.path)} onDoubleClick={() => onChoose?.(e.path)} className={rowClass}>
                <FolderIcon /> {e.name}
              </button>
            ) : onChooseFile && e.video ? (
              <button type="button" onClick={() => onChooseFile(e.path)} className={rowClass}>
                <FileIcon /> {e.name}
              </button>
            ) : (
              <div className={cx(rowClass, "cursor-default", !e.video && "text-faint")}>
                <FileIcon /> {e.name}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const rowClass =
  "flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-2 py-1.5 text-left text-[13px] text-soft hover:bg-panel-2 hover:text-ink";
