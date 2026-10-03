import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRootRoute, HeadContent, Outlet, Scripts, useRouterState } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { AppShell } from "~/components/AppShell";
import { getUiLang } from "~/functions/i18n.functions";
import { LiveProvider } from "~/lib/events";
import { LangProvider, useLang } from "~/lib/i18n";
import * as m from "~/paraglide/messages";
import styles from "~/styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "color-scheme", content: "dark" },
      { title: "namarr" },
    ],
    links: [
      { rel: "stylesheet", href: styles },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap",
      },
    ],
  }),
  // The language for SSR; afterwards the provider's state leads.
  loader: () => getUiLang(),
  staleTime: Number.POSITIVE_INFINITY,
  component: RootComponent,
  notFoundComponent: NotFound,
});

function RootComponent() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: false, retry: 1 } } }),
  );
  const { lang } = Route.useLoaderData();
  const bare = useRouterState({ select: (s) => s.location.pathname === "/login" });
  return (
    <LangProvider initial={lang}>
      <Document>
        <QueryClientProvider client={queryClient}>
          {bare ? (
            <Outlet />
          ) : (
            <LiveProvider>
              <AppShell>
                <Outlet />
              </AppShell>
            </LiveProvider>
          )}
        </QueryClientProvider>
      </Document>
    </LangProvider>
  );
}

function NotFound() {
  return <p className="text-muted">{m.common_notFound()}</p>;
}

function Document({ children }: { children: ReactNode }) {
  const { lang } = useLang();
  return (
    <html lang={lang}>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
