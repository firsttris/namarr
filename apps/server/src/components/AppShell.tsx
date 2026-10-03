import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { logout } from "~/functions/auth.functions";
import { getShellInfo } from "~/functions/library.functions";
import { useLive } from "~/lib/events";
import { LANGS, pickMsg, useLang } from "~/lib/i18n";
import { msgGroup } from "~/lib/msg-groups";
import * as m from "~/paraglide/messages";
import { DashboardIcon, EyeIcon, GearIcon, HistoryIcon, InboxIcon, ListIcon, Logo, PenIcon } from "./icons";
import { cx } from "./ui";

const NAV = [
  { to: "/", key: "dashboard", icon: DashboardIcon, exact: true },
  { to: "/rename", key: "workbench", icon: PenIcon },
  { to: "/inbox", key: "inbox", icon: InboxIcon, badge: true },
  { to: "/history", key: "history", icon: HistoryIcon },
  { to: "/profiles", key: "profiles", icon: ListIcon },
  { to: "/watch", key: "watch", icon: EyeIcon },
  { to: "/settings", key: "settings", icon: GearIcon },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { connected } = useLive();
  const shell = useQuery({ queryKey: ["shell"], queryFn: () => getShellInfo(), refetchInterval: 60_000 });
  const inbox = shell.data?.inboxOpen ?? 0;

  return (
    <div className="flex min-h-screen bg-bg text-ink">
      <nav
        aria-label={m.nav_main()}
        className="sticky top-0 flex h-screen w-[232px] flex-shrink-0 flex-col gap-7 border-r border-line bg-nav px-4 py-6"
      >
        <Link to="/" className="flex items-center gap-2.5 px-2 text-ink no-underline hover:text-ink">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent">
            <Logo />
          </div>
          <div className="font-display text-[22px] font-bold tracking-[-0.02em]">namarr</div>
        </Link>

        <div className="flex flex-col gap-1">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: "exact" in item }}
              className="flex h-11 items-center gap-3 rounded-lg px-3 text-sm text-soft no-underline hover:bg-active hover:text-white"
              activeProps={{ className: "bg-active !text-white font-semibold", "aria-current": "page" }}
            >
              <item.icon />
              <span className="flex-grow">{pickMsg(msgGroup.nav, item.key)}</span>
              {"badge" in item && inbox > 0 && (
                <span className="flex h-[22px] min-w-[22px] items-center justify-center rounded-[11px] bg-accent px-[7px] text-xs font-semibold text-accent-ink">
                  {inbox}
                </span>
              )}
            </Link>
          ))}
        </div>

        <div className="mt-auto flex flex-col gap-3">
          <LanguageSwitch />
          <div className="flex flex-col gap-1.5 rounded-[10px] border border-line bg-[#161920] px-3 py-3.5">
            <div className="flex items-center gap-2 text-[13px] font-medium">
              <span className={cx("h-2 w-2 rounded-full", connected ? "bg-info" : "bg-faint")} />
              {connected ? m.nav_connected() : m.nav_disconnected()}
            </div>
            <div className="font-mono text-xs text-muted">{shell.data?.host ?? "…"}</div>
            {shell.data?.demo && <div className="text-xs text-accent-soft">{m.nav_demo()}</div>}
            {shell.data?.authRequired && (
              <button
                type="button"
                onClick={async () => {
                  await logout();
                  window.location.href = "/login";
                }}
                className="mt-1 cursor-pointer self-start border-0 bg-transparent p-0 text-xs text-accent hover:text-accent-soft"
              >
                {m.nav_logout()}
              </button>
            )}
          </div>
        </div>
      </nav>
      <main className="flex min-w-0 flex-grow flex-col gap-6 px-9 py-7">{children}</main>
    </div>
  );
}

/** DE | EN toggle, like in haul: the choice is stored in a cookie for the next server render. */
export function LanguageSwitch() {
  const { lang, setLang } = useLang();
  return (
    <div role="group" aria-label={m.nav_language()} className="flex self-start rounded-lg border border-line-2 bg-[#161920] p-0.5">
      {LANGS.map((l) => (
        <button
          key={l.id}
          type="button"
          lang={l.id}
          aria-pressed={lang === l.id}
          title={l.label}
          onClick={() => setLang(l.id)}
          className={cx(
            "h-7 cursor-pointer rounded-md border-0 px-2.5 text-xs font-semibold uppercase",
            lang === l.id ? "bg-toggle text-white" : "bg-transparent text-soft hover:text-white",
          )}
        >
          {l.id}
        </button>
      ))}
    </div>
  );
}
