import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { LanguageSwitch } from "~/components/AppShell";
import { Logo } from "~/components/icons";
import { Button, ErrorNote, inputClass } from "~/components/ui";
import { login } from "~/functions/auth.functions";
import { useT } from "~/lib/i18n";

export const Route = createFileRoute("/login")({
  validateSearch: z.object({ next: z.string().optional() }),
  component: Login,
});

function Login() {
  const t = useT();
  const { next } = Route.useSearch();
  const navigate = useNavigate();
  const [token, setToken] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-4">
      <form
        className="flex w-[360px] flex-col gap-4 rounded-[14px] border border-line bg-panel p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await login({ data: { token } });
            // Only same-site paths: never redirect to another origin.
            const target = next?.startsWith("/") && !next.startsWith("//") ? next : "/";
            await navigate({ href: target, reloadDocument: true });
          } catch (err) {
            setError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent">
            <Logo />
          </div>
          <h1 className="m-0 flex-grow font-display text-[22px] font-bold">namarr</h1>
          <LanguageSwitch />
        </div>
        <label htmlFor="token" className="text-[13px] text-muted">
          {t.login.token}
        </label>
        <input
          id="token"
          type="password"
          autoComplete="current-password"
          className={inputClass}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          required
        />
        <ErrorNote error={error} />
        <Button type="submit" variant="accent" size="lg" disabled={busy}>
          {t.login.submit}
        </Button>
      </form>
    </main>
  );
}
