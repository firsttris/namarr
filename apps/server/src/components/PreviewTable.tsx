import type { MatchResult } from "@namarr/core/matcher";
import type { JobItem } from "@namarr/db/types";
import { useVirtualizer } from "@tanstack/react-virtual";
import { type KeyboardEvent, useMemo, useRef } from "react";
import { diffWords, pct, STATE_LABELS, splitTarget } from "~/lib/format";
import { Arrow } from "./icons";
import { Button, cx, Poster } from "./ui";

type Row =
  | { kind: "group"; key: string; match: MatchResult; count: number }
  | { kind: "item"; key: string; item: JobItem; index: number }
  | { kind: "companion"; key: string; item: JobItem; from: string; to: string };

const GRID = "grid grid-cols-[28px_minmax(0,1fr)_44px_minmax(0,1fr)] items-center gap-3 px-4";

/** Groups consecutive files of the same match under a header, companions as ↳ rows. */
export function buildRows(items: JobItem[]): Row[] {
  const rows: Row[] = [];
  let lastKey: string | undefined;
  items.forEach((item, index) => {
    const match = item.matchJson as MatchResult | null;
    const best = match?.best;
    if (best?.kind === "series") {
      const season = match?.episodes[0]?.season;
      const key = `${best.id}|${season ?? ""}`;
      if (key !== lastKey) {
        rows.push({ kind: "group", key: `g-${key}-${index}`, match: match!, count: 0 });
        lastKey = key;
      }
      const group = rows.findLast((r) => r.kind === "group");
      if (group?.kind === "group") group.count++;
    } else lastKey = undefined;
    rows.push({ kind: "item", key: `i-${item.id}`, item, index });
    for (const c of item.companions) {
      rows.push({ kind: "companion", key: `c-${item.id}-${c.from}`, item, from: c.from, to: c.to });
    }
  });
  return rows;
}

type Props = {
  items: JobItem[];
  targetRoot?: string | null;
  sourceRoot?: string;
  selectedId?: number;
  onSelect: (id: number) => void;
  onToggle: (item: JobItem) => void;
  onSearch: (item: JobItem) => void;
  height?: number;
};

export function PreviewTable({ items, targetRoot, sourceRoot, selectedId, onSelect, onToggle, onSearch }: Props) {
  const rows = useMemo(() => buildRows(items), [items]);
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => (rows[i]!.kind === "group" ? 46 : 41),
    overscan: 20,
  });
  const fileRows = useMemo(() => rows.flatMap((r, i) => (r.kind === "item" ? [i] : [])), [rows]);

  const relative = (p: string) => (sourceRoot && p.startsWith(`${sourceRoot}/`) ? p.slice(sourceRoot.length + 1) : p.split("/").at(-1)!);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!fileRows.length) return;
    const current = rows.findIndex((r) => r.kind === "item" && r.item.id === selectedId);
    const pos = fileRows.indexOf(current);
    const move = (to: number) => {
      const rowIndex = fileRows[Math.max(0, Math.min(fileRows.length - 1, to))]!;
      const row = rows[rowIndex]!;
      if (row.kind === "item") onSelect(row.item.id);
      virtualizer.scrollToIndex(rowIndex, { align: "auto" });
    };
    const selected = rows[current];
    if (e.key === "ArrowDown") move(pos + 1);
    else if (e.key === "ArrowUp") move(pos < 0 ? 0 : pos - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(fileRows.length - 1);
    else if (e.key === " " && selected?.kind === "item") onToggle(selected.item);
    else if (e.key === "Enter" && selected?.kind === "item") onSearch(selected.item);
    else return;
    e.preventDefault();
  };

  return (
    <div
      ref={parentRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      role="grid"
      aria-activedescendant={selectedId ? `row-${selectedId}` : undefined}
      aria-label="Vorschau: Pfeiltasten wählen, Leertaste schließt ein oder aus, Enter sucht einen anderen Treffer"
      aria-rowcount={rows.length}
      className="min-h-0 flex-grow overflow-auto outline-none"
    >
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((v) => {
          const row = rows[v.index]!;
          return (
            <div
              key={row.key}
              data-index={v.index}
              ref={virtualizer.measureElement}
              style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${v.start}px)` }}
            >
              {row.kind === "group" && <GroupRow match={row.match} count={row.count} />}
              {row.kind === "item" && (
                <ItemRow
                  item={row.item}
                  original={relative(row.item.sourcePath)}
                  targetRoot={targetRoot}
                  selected={row.item.id === selectedId}
                  onSelect={() => onSelect(row.item.id)}
                  onToggle={() => onToggle(row.item)}
                  onSearch={() => onSearch(row.item)}
                />
              )}
              {row.kind === "companion" && (
                // biome-ignore lint/a11y/useFocusableInteractive: rows are reached through the grid's aria-activedescendant
                <div role="row" className={cx(GRID, "border-b border-row py-[11px]")}>
                  <span />
                  <div className="truncate pl-4 font-mono text-xs text-muted">↳ {row.from.split("/").at(-1)}</div>
                  <div className="flex justify-center">{row.to && <Arrow />}</div>
                  <div className="truncate pl-4 font-mono text-xs text-soft">
                    {row.to ? <>↳ {companionLabel(row.to, row.item.targetPath)}</> : "–"}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function companionLabel(to: string, main: string | null) {
  const file = to.split("/").at(-1)!;
  const mainStem = main
    ?.split("/")
    .at(-1)
    ?.replace(/\.[^.]+$/, "");
  if (mainStem && file.startsWith(mainStem)) {
    return (
      <>
        {mainStem}
        <span className="text-accent-soft">{file.slice(mainStem.length)}</span>
      </>
    );
  }
  return file;
}

function GroupRow({ match, count }: { match: MatchResult; count: number }) {
  const best = match.best!;
  const season = match.episodes[0]?.season;
  return (
    // biome-ignore lint/a11y/useFocusableInteractive: rows are reached through the grid's aria-activedescendant
    <div role="row" className={cx(GRID, "border-b border-line bg-panel-2 py-1.5")}>
      <div />
      <div className="text-xs text-muted">Serie erkannt · {count} Dateien</div>
      <div />
      <div className="flex items-center gap-2.5">
        <Poster title={best.title} src={best.poster} size="sm" />
        <div className="text-[13px] font-semibold">
          {best.title}
          {best.year ? ` (${best.year})` : ""}
        </div>
        <div className="text-xs text-muted">
          {best.provider.toUpperCase()} {best.id}
          {season !== undefined ? ` · Staffel ${season}` : ""}
        </div>
      </div>
    </div>
  );
}

function ItemRow({
  item,
  original,
  targetRoot,
  selected,
  onSelect,
  onToggle,
  onSearch,
}: {
  item: JobItem;
  original: string;
  targetRoot?: string | null;
  selected: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onSearch: () => void;
}) {
  const review = item.state === "needs_review";
  const skipped = item.state === "skipped" || item.excluded;
  const done = item.state === "done";
  const failed = item.state === "failed";
  const target = item.targetPath ? splitTarget(item.targetPath, targetRoot ?? item.sourcePath.replace(/\/[^/]*$/, "")) : null;
  const fileName = item.sourcePath.split("/").at(-1)!;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/useFocusableInteractive: the grid container handles the keyboard and points at this row via aria-activedescendant
    <div
      id={`row-${item.id}`}
      role="row"
      aria-selected={selected}
      onClick={onSelect}
      className={cx(
        GRID,
        "cursor-default border-b border-row py-[11px]",
        (review || item.conflict) && !skipped && "bg-accent/[0.07]",
        selected && "outline outline-1 -outline-offset-1 outline-accent/60",
      )}
    >
      <input
        type="checkbox"
        checked={!skipped}
        onChange={onToggle}
        onClick={(e) => e.stopPropagation()}
        disabled={done}
        aria-label={`${fileName} einbeziehen`}
        className="h-4 w-4"
      />
      <div className={cx("truncate font-mono text-xs", skipped ? "text-faint line-through" : "text-muted")} title={item.sourcePath}>
        {original}
      </div>
      <div className="flex justify-center">
        {skipped ? (
          <span className="text-base text-faint" aria-hidden="true">
            –
          </span>
        ) : !target ? (
          <span className="text-[15px] font-semibold text-accent" aria-hidden="true">
            ?
          </span>
        ) : (
          <Arrow dashed={review} tone={review ? "#f0a14a" : done ? "#4fd1a5" : "#5fb3ff"} />
        )}
      </div>
      <div className="flex min-w-0 items-center gap-2">
        {skipped ? (
          <div className="text-xs text-muted">{item.excluded ? "Ausgeschlossen" : (item.reasons.at(-1) ?? "Übersprungen")}</div>
        ) : !target ? (
          <>
            <div className="flex-grow text-xs text-muted">{item.reasons[0] ?? "Kein Treffer gefunden"}</div>
            <Button
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onSearch();
              }}
            >
              Manuell suchen
            </Button>
          </>
        ) : (
          <>
            <div className="min-w-0 flex-grow truncate font-mono text-xs" title={item.targetPath!}>
              <span className="text-accent-soft">{target.dir}</span>
              {diffWords(fileName, target.file).map((seg, i) => (
                <span key={i} className={seg.added ? "text-accent-soft" : undefined}>
                  {seg.text}
                </span>
              ))}
            </div>
            {(review || item.conflict || failed || done) && (
              <span
                className={cx(
                  "flex-shrink-0 rounded-md px-2 py-[3px] text-[11px] font-semibold",
                  done ? "bg-[#4fd1a5]/15 text-[#4fd1a5]" : failed ? "bg-danger/15 text-danger" : "bg-accent/15 text-accent-soft",
                )}
                title={item.error ?? item.reasons.join(" · ")}
              >
                {done
                  ? STATE_LABELS.done
                  : failed
                    ? STATE_LABELS.failed
                    : item.conflict
                      ? item.conflict === "duplicate"
                        ? "doppelt"
                        : "Konflikt"
                      : `${pct(item.confidence)} prüfen`}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
