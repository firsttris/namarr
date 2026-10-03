import type { MatchResult } from "@namarr/core/matcher";
import type { Parsed } from "@namarr/core/types";
import { Link } from "@tanstack/react-router";
import { pct, splitTarget } from "~/lib/format";
import { useLocalize } from "~/lib/i18n";
import * as m from "~/paraglide/messages";
import { Button, Poster, Progress } from "./ui";

export type InboxEntry = {
  reason: string;
  targetRoot: string | null;
  item: {
    id: number;
    jobId: number;
    sourcePath: string;
    targetPath: string | null;
    confidence: number;
    parsedJson: unknown;
    matchJson: unknown;
  };
};

/** One uncertain match: old name, proposed name, why it waits, confidence, approve. */
export function InboxRow({ entry, onApprove, busy, last }: { entry: InboxEntry; onApprove: () => void; busy?: boolean; last?: boolean }) {
  const localize = useLocalize();
  const { item } = entry;
  const match = item.matchJson as MatchResult | null;
  const parsed = item.parsedJson as Parsed | null;
  const fileName = item.sourcePath.split("/").at(-1)!;
  const target = item.targetPath ? splitTarget(item.targetPath, entry.targetRoot) : null;
  const tone = item.confidence >= 0.8 ? "info" : "accent";
  return (
    <div className={`flex items-center gap-4 px-5 py-4 ${last ? "" : "border-b border-row"}`}>
      <Poster title={match?.best?.title ?? parsed?.title} src={match?.best?.poster} />
      <div className="flex min-w-0 flex-grow flex-col gap-1.5">
        <div className="truncate font-mono text-xs text-dim" title={item.sourcePath}>
          {fileName}
        </div>
        <div className="truncate font-mono text-[13px] text-ink">
          {target ? (
            <>
              <span className="text-accent-soft">{target.dir}</span>
              {target.file}
            </>
          ) : (
            <span className="text-muted">{m.inbox_noTarget()}</span>
          )}
        </div>
        <div className="text-xs text-muted">{localize(entry.reason)}</div>
      </div>
      <div className="flex w-24 flex-shrink-0 flex-col gap-1.5">
        <div className="text-[13px] font-semibold">{pct(item.confidence)}</div>
        <Progress value={item.confidence} tone={tone} />
      </div>
      <div className="flex flex-shrink-0 gap-2">
        <Link to="/rename" search={{ job: item.jobId, item: item.id }} className="no-underline">
          <Button>{m.common_change()}</Button>
        </Link>
        <Button
          variant="light"
          onClick={onApprove}
          disabled={busy || !item.targetPath}
          aria-label={m.inbox_approveFile({ file: fileName })}
        >
          {m.common_approve()}
        </Button>
      </div>
    </div>
  );
}
