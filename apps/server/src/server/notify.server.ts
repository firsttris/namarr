import { type Lang, langOf, msg } from "@namarr/core/i18n";
import type { Settings } from "@namarr/db";
import * as m from "~/paraglide/messages";

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type JobSummary = { jobId: number; done: number; failed: number; skipped: number; source: string };

/** The notification text, in the language set for titles (`de-DE` → German, else English). */
export function summaryText(s: JobSummary, lang: Lang = "de"): string {
  const locale = { locale: lang };
  const parts = [m.notify_renamed({ n: s.done }, locale)];
  if (s.skipped) parts.push(m.notify_skipped({ n: s.skipped }, locale));
  if (s.failed) parts.push(m.notify_failed({ n: s.failed }, locale));
  return m.notify_summary({ id: s.jobId, parts: parts.join(", "), source: s.source }, locale);
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

export type LibraryCheck = { ok: true; name?: string; version?: string } | { ok: false; reason: string };

/**
 * Tests a library refresh target without refreshing: reads the server info with the token
 * (Jellyfin/Emby `/System/Info`, Plex `/`), so a wrong URL, a wrong token or the wrong server kind
 * show up before the first job. `reason` is a message for the UI.
 */
export async function checkLibrary(target: Settings["libraryRefresh"][number], fetchImpl: FetchLike = fetch): Promise<LibraryCheck> {
  const plex = target.kind === "plex";
  let url: URL;
  try {
    url = new URL(plex ? "/" : "/System/Info", target.url);
  } catch {
    return { ok: false, reason: msg("settings_refreshCheck_badUrl") };
  }
  if (plex) url.searchParams.set("X-Plex-Token", target.token);
  let res: Response;
  try {
    res = await fetchImpl(String(url), {
      method: "GET",
      headers: plex ? { accept: "application/json" } : { "X-Emby-Token": target.token, accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    // Bun sets `code` on the error (ConnectionRefused), Node on its cause (ECONNREFUSED).
    const err = e as Error & { code?: string; cause?: { code?: string } };
    const detail = err.code ?? err.cause?.code ?? (err.name === "TimeoutError" ? "timeout" : err.message);
    return { ok: false, reason: msg("settings_refreshCheck_unreachable", { host: url.host, detail }) };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, reason: msg("settings_refreshCheck_token", { status: res.status }) };
  if (!res.ok) return { ok: false, reason: msg("settings_refreshCheck_http", { status: res.status }) };
  const body = (await res.json().catch(() => undefined)) as
    | { ServerName?: string; Version?: string; MediaContainer?: { friendlyName?: string; version?: string } }
    | undefined;
  const info = plex
    ? body?.MediaContainer && { name: body.MediaContainer.friendlyName, version: body.MediaContainer.version }
    : body?.Version && { name: body.ServerName, version: body.Version };
  if (!info)
    return {
      ok: false,
      reason: msg("settings_refreshCheck_wrongKind", { kind: plex ? "Plex" : target.kind === "emby" ? "Emby" : "Jellyfin" }),
    };
  return { ok: true, ...info };
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
