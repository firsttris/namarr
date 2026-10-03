import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { InboxRow } from "~/components/InboxRow";
import { Button, ErrorNote, PageHeader, Panel } from "~/components/ui";
import { approveInbox, getInbox } from "~/functions/library.functions";
import * as m from "~/paraglide/messages";

export const Route = createFileRoute("/inbox")({
  loader: () => getInbox(),
  component: Inbox,
});

function Inbox() {
  const initial = Route.useLoaderData();
  const qc = useQueryClient();
  const { data = initial } = useQuery({ queryKey: ["inbox"], queryFn: () => getInbox(), initialData: initial });
  const approve = useMutation({
    mutationFn: (v: { itemIds?: number[]; minConfidence?: number }) => approveInbox({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inbox"] });
      qc.invalidateQueries({ queryKey: ["shell"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
  return (
    <>
      <PageHeader title={m.inbox_title()} subtitle={m.inbox_subtitle({ n: data.length })}>
        <Button onClick={() => approve.mutate({ minConfidence: 0.8 })} disabled={approve.isPending || !data.length}>
          {m.dashboard_approveAbove80()}
        </Button>
      </PageHeader>
      <ErrorNote error={approve.error} />
      {approve.data && (
        <div className="text-sm text-muted">{m.inbox_result({ done: approve.data.done, approved: approve.data.approved })}</div>
      )}
      <Panel>
        {data.length === 0 && <p className="m-0 px-5 py-8 text-sm text-muted">{m.inbox_empty()}</p>}
        {data.map((entry, i) => (
          <InboxRow
            key={entry.item.id}
            entry={entry}
            last={i === data.length - 1}
            busy={approve.isPending}
            onApprove={() => approve.mutate({ itemIds: [entry.item.id] })}
          />
        ))}
      </Panel>
    </>
  );
}
