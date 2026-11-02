import { type Lang, langOf, msg } from "@namarr/core/i18n";
import { type NotificationEvent, type Settings, wantsEvent } from "@namarr/db";
import { localizeIn } from "~/lib/i18n";
import * as m from "~/paraglide/messages";

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type JobSummary = { jobId: number; done: number; failed: number; skipped: number; source: string };

/** One file that went into the inbox. */
export type InboxEntry = {
  itemId: number;
  file: string;
  title?: string;
  year?: number;
  /** S01E02 for series; absent for movies and unmatched files. */
  episode?: string;
  reason: string;
};

/** Files of one watch or hook job that wait for approval. */
export type InboxSummary = { jobId: number; source: string; items: InboxEntry[] };

/** How many entries an inbox notification lists by name; the rest are counted. */
const INBOX_LISTED = 5;

/** The notification text, in the language set for titles (`de-DE` → German, else English). */
export function summaryText(s: JobSummary, lang: Lang = "de"): string {
  const locale = { locale: lang };
  const parts = [m.notify_renamed({ n: s.done }, locale)];
  if (s.skipped) parts.push(m.notify_skipped({ n: s.skipped }, locale));
  if (s.failed) parts.push(m.notify_failed({ n: s.failed }, locale));
  return m.notify_summary({ id: s.jobId, parts: parts.join(", "), source: s.source }, locale);
}

/** Link to the inbox, when namarr knows the address it is reached at. */
export function inboxLink(publicUrl: string | undefined): string | undefined {
  if (!publicUrl?.trim()) return undefined;
  try {
    return String(new URL("inbox", publicUrl.trim().replace(/\/*$/, "/")));
  } catch {
    return undefined;
  }
}

function entryLabel(e: InboxEntry): string {
  if (!e.title) return e.file;
  const name = e.year ? `${e.title} (${e.year})` : e.title;
  return e.episode ? `${name} ${e.episode}` : name;
}

/** The text for files waiting for approval, in the language set for titles. */
export function inboxText(s: InboxSummary, lang: Lang = "de", link?: string): string {
  const locale = { locale: lang };
  const lines: string[] = [m.notify_inbox({ n: s.items.length, source: s.source }, locale)];
  for (const e of s.items.slice(0, INBOX_LISTED)) lines.push(`• ${entryLabel(e)}: ${e.reason}`);
  if (s.items.length > INBOX_LISTED) lines.push(m.notify_inboxMore({ n: s.items.length - INBOX_LISTED }, locale));
  if (link) lines.push(link);
  return lines.join("\n");
}

/** What a notification carries besides its text: the event, a link and, for webhooks, the details. */
export type NotificationExtra = { event: NotificationEvent; link?: string; data?: object };

/** Builds the HTTP request for one notification target. Exported for tests. */
export function notificationRequest(
  target: Settings["notifications"][number],
  text: string,
  extra: NotificationExtra = { event: "job" },
): { url: string; init: RequestInit } {
  switch (target.kind) {
    case "ntfy":
      return {
        url: target.url,
        init: {
          method: "POST",
          body: text,
          headers: {
            title: "namarr",
            ...(target.token ? { authorization: `Bearer ${target.token}` } : {}),
            ...(extra.link ? { click: extra.link } : {}),
          },
        },
      };
    case "gotify": {
      const url = new URL("/message", target.url);
      if (target.token) url.searchParams.set("token", target.token);
      return {
        url: String(url),
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: "namarr",
            message: text,
            ...(extra.link ? { extras: { "client::notification": { click: { url: extra.link } } } } : {}),
          }),
        },
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
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            source: "namarr",
            event: extra.event,
            text,
            ...(extra.link ? { link: extra.link } : {}),
            data: extra.data,
          }),
        },
      };
  }
}

/**
 * Token header for Jellyfin/Emby. Jellyfin 12 dropped the legacy `X-Emby-Token` header and only
 * accepts `Authorization: MediaBrowser Token="…"` (also understood by Jellyfin 10.x); Emby keeps `X-Emby-Token`.
 */
function mediaServerAuth(target: { kind: string; token: string }): Record<string, string> {
  return target.kind === "jellyfin" ? { authorization: `MediaBrowser Token="${target.token.trim()}"` } : { "X-Emby-Token": target.token };
}

/** Library refresh after execution: Jellyfin/Emby share the API, Plex uses its token parameter. */
export function refreshRequest(target: Settings["libraryRefresh"][number]): { url: string; init: RequestInit } {
  if (target.kind === "plex") {
    const url = new URL("/library/sections/all/refresh", target.url);
    url.searchParams.set("X-Plex-Token", target.token);
    return { url: String(url), init: { method: "GET" } };
  }
  return { url: String(new URL("/Library/Refresh", target.url)), init: { method: "POST", headers: mediaServerAuth(target) } };
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
      headers: plex ? { accept: "application/json" } : { ...mediaServerAuth(target), accept: "application/json" },
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

type Log = (msg: string, err?: unknown) => void;

async function send(requests: { url: string; init: RequestInit }[], log: Log, fetchImpl: FetchLike): Promise<void> {
  await Promise.all(
    requests.map(async ({ url, init }) => {
      try {
        const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(10_000) });
        if (!res.ok) log(`Notification failed: ${new URL(url).host} HTTP ${res.status}`);
      } catch (e) {
        log(`Notification failed: ${new URL(url).host}`, e);
      }
    }),
  );
}

/** Fire-and-forget; failures are logged, never thrown into the job. */
export async function afterExecution(settings: Settings, summary: JobSummary, log: Log, fetchImpl: FetchLike = fetch): Promise<void> {
  const text = summaryText(summary, langOf(settings.language));
  await send(
    [
      ...(summary.done > 0 ? settings.libraryRefresh.map(refreshRequest) : []),
      ...settings.notifications
        .filter((n) => wantsEvent(n, "job"))
        .map((n) => notificationRequest(n, text, { event: "job", data: summary })),
    ],
    log,
    fetchImpl,
  );
}

/** Files went into the inbox: tells every target that wants it. Fire-and-forget like {@link afterExecution}. */
export async function afterInbox(settings: Settings, summary: InboxSummary, log: Log, fetchImpl: FetchLike = fetch): Promise<void> {
  if (!summary.items.length) return;
  const lang = langOf(settings.language);
  const link = inboxLink(settings.publicUrl);
  // Reasons travel as message keys; a notification is read outside the UI.
  const localized = { ...summary, items: summary.items.map((e) => ({ ...e, reason: localizeIn(e.reason, lang) })) };
  const text = inboxText(localized, lang, link);
  await send(
    settings.notifications
      .filter((n) => wantsEvent(n, "inbox"))
      .map((n) => notificationRequest(n, text, { event: "inbox", link, data: localized })),
    log,
    fetchImpl,
  );
}
