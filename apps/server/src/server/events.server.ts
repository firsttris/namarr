export type NamarrEvent =
  | { type: "job.progress"; jobId: number; status: string; done: number; total: number }
  | { type: "item.updated"; jobId: number; itemIds: number[] }
  | { type: "inbox.added"; itemIds: number[] }
  | { type: "watch.detected"; watchFolderId: number; path: string };

type Listener = (event: NamarrEvent) => void;

/** In-process pub/sub feeding the SSE route. */
export class EventBus {
  private readonly listeners = new Set<Listener>();

  emit(event: NamarrEvent): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        // one broken subscriber must not stop the others
      }
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get size(): number {
    return this.listeners.size;
  }
}

/** Server-Sent Events stream: one `event:` per message, keep-alive comments every 25 s. */
export function sseResponse(bus: EventBus, signal: AbortSignal, keepAliveMs = 25_000): Response {
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let timer: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const cleanup = () => {
        unsubscribe();
        if (timer) clearInterval(timer);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      send("retry: 3000\n: connected\n\n");
      unsubscribe = bus.subscribe((e) => send(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
      timer = setInterval(() => send(": keep-alive\n\n"), keepAliveMs);
      signal.addEventListener("abort", cleanup, { once: true });
    },
    cancel() {
      unsubscribe();
      if (timer) clearInterval(timer);
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // nginx: do not buffer the stream
      "x-accel-buffering": "no",
    },
  });
}
