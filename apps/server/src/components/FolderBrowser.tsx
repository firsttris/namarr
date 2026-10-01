import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { browseFolder } from "~/functions/library.functions";
import { FileIcon, FolderIcon } from "./icons";
import { Button, cx, ErrorNote } from "./ui";

type Props = { initial?: string; onChoose: (path: string) => void; chooseLabel?: string };

/** Server-side folder browser, limited to the allowed root paths. */
export function FolderBrowser({ initial, onChoose, chooseLabel = "Diesen Ordner wählen" }: Props) {
  const [path, setPath] = useState<string | undefined>(initial);
  const q = useQuery({ queryKey: ["browse", path ?? ""], queryFn: () => browseFolder({ data: { path } }) });
  const data = q.data;

  if (data && !data.path) {
    return (
      <div className="flex flex-col gap-2">
        <div className="text-sm text-muted">Wurzelpfade</div>
        {data.roots.length === 0 && (
          <p className="m-0 text-sm text-muted">
            Noch keine Wurzelpfade freigegeben. <Link to="/settings">In den Einstellungen festlegen</Link>
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
        <div className="min-w-0 flex-grow truncate font-mono text-[13px] text-ink">{data?.path ?? path}</div>
        <Button size="sm" onClick={() => setPath(data?.parent ?? undefined)} disabled={!data}>
          {data?.parent ? "Eine Ebene hoch" : "Wurzelpfade"}
        </Button>
        <Button size="sm" variant="accent" onClick={() => data?.path && onChoose(data.path)} disabled={!data?.path}>
          {chooseLabel}
        </Button>
      </div>
      <ErrorNote error={q.error} />
      <ul className="m-0 flex max-h-[420px] list-none flex-col overflow-auto p-0" aria-label="Ordnerinhalt">
        {data?.entries.length === 0 && <li className="py-2 text-sm text-muted">Leer.</li>}
        {data?.entries.map((e) => (
          <li key={e.path}>
            {e.dir ? (
              <button type="button" onClick={() => setPath(e.path)} onDoubleClick={() => onChoose(e.path)} className={rowClass}>
                <FolderIcon /> {e.name}
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
