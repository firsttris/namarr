import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { getShellInfo } from "~/functions/library.functions";
import { useLive } from "~/lib/events";
import { DashboardIcon, EyeIcon, GearIcon, HistoryIcon, InboxIcon, ListIcon, Logo, PenIcon } from "./icons";
import { cx } from "./ui";

const NAV = [
  { to: "/", label: "Dashboard", icon: DashboardIcon, exact: true },
  { to: "/rename", label: "Workbench", icon: PenIcon },
  { to: "/inbox", label: "Inbox", icon: InboxIcon, badge: true },
  { to: "/history", label: "History", icon: HistoryIcon },
  { to: "/profiles", label: "Profile", icon: ListIcon },
  { to: "/watch", label: "Watch-Folder", icon: EyeIcon },
  { to: "/settings", label: "Einstellungen", icon: GearIcon },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { connected } = useLive();
  const shell = useQuery({ queryKey: ["shell"], queryFn: () => getShellInfo(), refetchInterval: 60_000 });
  const inbox = shell.data?.inboxOpen ?? 0;

  return (
    <div className="flex min-h-screen bg-bg text-ink">
      <nav
        aria-label="Hauptnavigation"
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
              <span className="flex-grow">{item.label}</span>
              {"badge" in item && inbox > 0 && (
                <span className="flex h-[22px] min-w-[22px] items-center justify-center rounded-[11px] bg-accent px-[7px] text-xs font-semibold text-accent-ink">
                  {inbox}
                </span>
              )}
            </Link>
          ))}
        </div>

        <div className="mt-auto flex flex-col gap-1.5 rounded-[10px] border border-line bg-[#161920] px-3 py-3.5">
          <div className="flex items-center gap-2 text-[13px] font-medium">
            <span className={cx("h-2 w-2 rounded-full", connected ? "bg-info" : "bg-faint")} />
            {connected ? "Server verbunden" : "Verbindung getrennt"}
          </div>
          <div className="font-mono text-xs text-muted">{shell.data?.host ?? "…"}</div>
          {shell.data?.demo && <div className="text-xs text-accent-soft">Demo-Modus</div>}
        </div>
      </nav>
      <main className="flex min-w-0 flex-grow flex-col gap-6 px-9 py-7">{children}</main>
    </div>
  );
}
