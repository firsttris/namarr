import { type Lang, langOf } from "@namarr/core/i18n";
import type { Settings } from "@namarr/db";

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type JobSummary = { jobId: number; done: number; failed: number; skipped: number; source: string };

/** The notification text, in the language set for titles (`de-DE` → German, else English). */
export function summaryText(s: JobSummary, lang: Lang = "de"): string {
  const de = lang === "de";
  const parts = [de ? `${s.done} umbenannt` : `${s.done} renamed`];
  if (s.skipped) parts.push(de ? `${s.skipped} übersprungen` : `${s.skipped} skipped`);
  if (s.failed) parts.push(de ? `${s.failed} fehlgeschlagen` : `${s.failed} failed`);
  return `namarr Job #${s.jobId}: ${parts.join(", ")} (${s.source})`;
}

/** Builds the HTTP request for one notification target. Exported for tests. */
export function notificationRequest(target: Settings["notifications"][number], text: string): { url: string; init: RequestInit } {
  switch (target.kind) {
    case "ntfy":
      return {
        url: target.url,
        init: {
          method: "POST",
          body: text,
          headers: { title: "namarr", ...(target.token ? { authorization: `Bearer ${target.token}` } : {}) },
        },
      };
    case "gotify": {
      const url = new URL("/message", target.url);
      if (target.token) url.searchParams.set("token", target.token);
      return {
        url: String(url),
        init: { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "namarr", message: text }) },
      };
    }
    case "telegram": {
      // url: https://api.telegram.org/bot<token>/sendMessage?chat_id=<id>
      const url = new URL(target.url);
      const chatId = url.searchParams.get("chat_id") ?? target.token ?? "";
      url.search = "";
      return {
        url: String(url),
        init: { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text }) },
      };
    }
    case "discord":
      return {
        url: target.url,
        init: { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: text }) },
      };
    case "webhook":
      return {
        url: target.url,
        init: { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: "namarr", text }) },
      };
  }
}

/** Library refresh after execution: Jellyfin/Emby share the API, Plex uses its token parameter. */
export function refreshRequest(target: Settings["libraryRefresh"][number]): { url: string; init: RequestInit } {
  if (target.kind === "plex") {
    const url = new URL("/library/sections/all/refresh", target.url);
    url.searchParams.set("X-Plex-Token", target.token);
    return { url: String(url), init: { method: "GET" } };
  }
  return { url: String(new URL("/Library/Refresh", target.url)), init: { method: "POST", headers: { "X-Emby-Token": target.token } } };
}

/** Fire-and-forget; failures are logged, never thrown into the job. */
export async function afterExecution(
  settings: Settings,
  summary: JobSummary,
  log: (msg: string, err?: unknown) => void,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const requests = [
    ...(summary.done > 0 ? settings.libraryRefresh.map(refreshRequest) : []),
    ...settings.notifications.map((n) => notificationRequest(n, summaryText(summary, langOf(settings.language)))),
  ];
  await Promise.all(
    requests.map(async ({ url, init }) => {
      try {
        const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(10_000) });
        if (!res.ok) log(`Benachrichtigung fehlgeschlagen: ${new URL(url).host} HTTP ${res.status}`);
      } catch (e) {
        log(`Benachrichtigung fehlgeschlagen: ${new URL(url).host}`, e);
      }
    }),
  );
}
