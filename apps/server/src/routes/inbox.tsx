import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { InboxRow } from "~/components/InboxRow";
import { Button, ErrorNote, PageHeader, Panel } from "~/components/ui";
import { approveInbox, getInbox } from "~/functions/library.functions";

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
      <PageHeader
        title="Inbox"
        subtitle={`${data.length} unsichere ${data.length === 1 ? "Treffer warten" : "Treffer warten"} auf Freigabe oder Korrektur`}
      >
        <Button onClick={() => approve.mutate({ minConfidence: 0.8 })} disabled={approve.isPending || !data.length}>
          Alle über 80 % freigeben
        </Button>
      </PageHeader>
      <ErrorNote error={approve.error} />
      {approve.data && (
        <div className="text-sm text-muted">
          {approve.data.done} von {approve.data.approved} ausgeführt.
        </div>
      )}
      <Panel>
        {data.length === 0 && <p className="m-0 px-5 py-8 text-sm text-muted">Alles erledigt.</p>}
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
