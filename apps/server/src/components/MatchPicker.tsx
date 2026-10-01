import type { MatchResult } from "@namarr/core/matcher";
import type { MediaCandidate, Parsed } from "@namarr/core/types";
import type { JobItem } from "@namarr/db/types";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { searchProvider } from "~/functions/jobs.functions";
import { useT } from "~/lib/i18n";
import { Button, cx, ErrorNote, inputClass, Poster, Select } from "./ui";

type Props = {
  item: JobItem | null;
  onClose: () => void;
  onPick: (candidate: MediaCandidate, remember: boolean) => Promise<unknown>;
};

/** Search dialog: posters, year, episode count, alternatives from the matcher first. */
export function MatchPicker({ item, onClose, onPick }: Props) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const parsed = item?.parsedJson as Parsed | undefined;
  const match = item?.matchJson as MatchResult | null | undefined;
  const [q, setQ] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [kind, setKind] = useState<"movie" | "series">("series");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!item) {
      dialog.current?.close();
      return;
    }
    const title = parsed?.title ?? "";
    setQ(title);
    setSubmitted(title);
    setKind(parsed?.kind.value === "movie" ? "movie" : "series");
    setError(null);
    if (!dialog.current?.open) dialog.current?.showModal();
  }, [item, parsed]);

  const results = useQuery({
    queryKey: ["search", kind, submitted, item?.jobId],
    queryFn: () => searchProvider({ data: { q: submitted, kind, jobId: item?.jobId } }),
    enabled: Boolean(item && submitted),
  });

  const alternatives = [match?.best, ...(match?.alternatives ?? []).map((a) => a.candidate)].filter(
    (c): c is MediaCandidate => Boolean(c) && c!.kind === kind,
  );
  const seen = new Set(alternatives.map((a) => a.id));
  const list = [...alternatives, ...(results.data ?? []).filter((r) => !seen.has(r.id))];

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-labelledby="picker-h"
      className="m-auto w-[640px] max-w-[95vw] rounded-[14px] border border-line bg-panel p-0 text-ink"
    >
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-center gap-2">
          <h2 id="picker-h" className="m-0 flex-grow text-base font-semibold">
            {t.picker.title}
          </h2>
          <Button size="sm" onClick={() => dialog.current?.close()}>
            {t.common.close}
          </Button>
        </div>
        <div className="truncate font-mono text-xs text-muted">{item?.sourcePath.split("/").at(-1)}</div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(q.trim());
          }}
        >
          <label htmlFor="picker-q" className="sr-only">
            {t.picker.query}
          </label>
          <input id="picker-q" className={cx(inputClass, "flex-grow")} value={q} onChange={(e) => setQ(e.target.value)} />
          <Select aria-label={t.picker.kind} value={kind} onChange={(e) => setKind(e.target.value as "movie" | "series")}>
            <option value="series">{t.common.seriesOne}</option>
            <option value="movie">{t.common.movieOne}</option>
          </Select>
          <Button type="submit" variant="light">
            {t.common.search}
          </Button>
        </form>
        <ErrorNote error={results.error ?? error} />
        <ul className="m-0 flex max-h-[420px] list-none flex-col gap-1 overflow-auto p-0">
          {results.isFetching && !list.length && <li className="text-sm text-muted">{t.picker.searching}</li>}
          {!results.isFetching && !list.length && submitted && <li className="text-sm text-muted">{t.picker.none}</li>}
          {list.map((c) => (
            <li key={`${c.provider}-${c.id}`}>
              <button
                type="button"
                disabled={busy !== null}
                onClick={async () => {
                  setBusy(c.id);
                  setError(null);
                  try {
                    await onPick(c, remember);
                    dialog.current?.close();
                  } catch (e) {
                    setError(e);
                  } finally {
                    setBusy(null);
                  }
                }}
                className={cx(
                  "flex w-full cursor-pointer items-center gap-3 rounded-lg border border-transparent bg-transparent p-2 text-left text-ink hover:border-line-3 hover:bg-panel-2",
                  match?.best?.id === c.id && "border-line-3",
                )}
              >
                <Poster title={c.title} src={c.poster} />
                <div className="flex min-w-0 flex-grow flex-col gap-1">
                  <div className="text-sm font-semibold">
                    {c.title} {c.year ? <span className="font-normal text-muted">({c.year})</span> : null}
                  </div>
                  <div className="text-xs text-muted">
                    {c.provider.toUpperCase()} {c.id}
                    {c.originalTitle ? ` · ${c.originalTitle}` : ""}
                    {c.episodeCount ? t.picker.episodes(c.episodeCount) : ""}
                    {match?.best?.id === c.id ? t.picker.current : ""}
                  </div>
                </div>
                {busy === c.id && <span className="text-xs text-muted">…</span>}
              </button>
            </li>
          ))}
        </ul>
        <label className="flex items-center gap-2 text-[13px] text-soft">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4" />
          {t.picker.remember(parsed?.title ?? t.picker.thisTitle)}
        </label>
      </div>
    </dialog>
  );
}
