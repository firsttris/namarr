import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";

export type LiveEvent =
  | { type: "job.progress"; jobId: number; status: string; done: number; total: number }
  | { type: "item.updated"; jobId: number; itemIds: number[] }
  | { type: "inbox.added"; itemIds: number[] }
  | { type: "watch.detected"; watchFolderId: number; path: string };

type Live = { connected: boolean; progress: Record<number, { status: string; done: number; total: number }> };
const LiveContext = createContext<Live>({ connected: false, progress: {} });

/** SSE events invalidate exactly the query caches they concern. */
export function applyEvent(qc: QueryClient, e: LiveEvent) {
  switch (e.type) {
    case "job.progress":
      qc.invalidateQueries({ queryKey: ["job", e.jobId] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      if (["ready", "done", "failed", "cancelled", "undone"].includes(e.status)) qc.invalidateQueries({ queryKey: ["items", e.jobId] });
      break;
    case "item.updated":
      qc.invalidateQueries({ queryKey: ["items", e.jobId] });
      qc.invalidateQueries({ queryKey: ["job", e.jobId] });
      break;
    case "inbox.added":
      qc.invalidateQueries({ queryKey: ["inbox"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["shell"] });
      break;
    case "watch.detected":
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      break;
  }
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [live, setLive] = useState<Live>({ connected: false, progress: {} });

  useEffect(() => {
    const source = new EventSource("/api/events");
    const onEvent = (msg: MessageEvent<string>) => {
      const e = JSON.parse(msg.data) as LiveEvent;
      if (e.type === "job.progress") {
        setLive((l) => ({ ...l, progress: { ...l.progress, [e.jobId]: { status: e.status, done: e.done, total: e.total } } }));
      }
      applyEvent(qc, e);
    };
    for (const t of ["job.progress", "item.updated", "inbox.added", "watch.detected"]) source.addEventListener(t, onEvent as EventListener);
    source.onopen = () => setLive((l) => ({ ...l, connected: true }));
    source.onerror = () => setLive((l) => ({ ...l, connected: false }));
    return () => source.close();
  }, [qc]);

  return <LiveContext.Provider value={live}>{children}</LiveContext.Provider>;
}

export const useLive = () => useContext(LiveContext);
