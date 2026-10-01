import type { Settings } from "@namarr/db/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { XIcon } from "~/components/icons";
import { Button, cx, ErrorNote, Field, inputClass, PageHeader, Panel, Select } from "~/components/ui";
import { getSettingsFn, saveSettings } from "~/functions/library.functions";

export const Route = createFileRoute("/settings")({
  loader: () => getSettingsFn(),
  component: SettingsPage,
});

function SettingsPage() {
  const initial = Route.useLoaderData();
  const router = useRouter();
  const qc = useQueryClient();
  const [key, setKey] = useState("");
  const [language, setLanguage] = useState(initial.language);
  const [roots, setRoots] = useState(initial.roots.join("\n"));
  const [defaultTarget, setDefaultTarget] = useState(initial.defaultTargetRoot ?? "");
  const [notifications, setNotifications] = useState<Settings["notifications"]>(initial.notifications);
  const [refresh, setRefresh] = useState<Settings["libraryRefresh"]>(initial.libraryRefresh);

  const save = useMutation({
    mutationFn: () =>
      saveSettings({
        data: {
          tmdbApiKey: key || undefined,
          language,
          roots: roots
            .split("\n")
            .map((r) => r.trim())
            .filter(Boolean),
          defaultTargetRoot: defaultTarget || undefined,
          notifications,
          libraryRefresh: refresh,
        },
      }),
    onSuccess: () => {
      setKey("");
      qc.invalidateQueries();
      router.invalidate();
    },
  });

  return (
    <>
      <PageHeader title="Einstellungen" subtitle="API-Keys, Sprache, Wurzelpfade, Benachrichtigungen." />
      <form
        className="flex max-w-3xl flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Panel className="flex flex-col gap-4 p-5">
          <h2 className="m-0 text-base font-semibold">Metadaten</h2>
          <Field
            label="TMDB-API-Key (v3 oder v4-Token)"
            htmlFor="s-key"
            hint={
              initial.hasTmdbKey
                ? `Gespeichert: ${initial.tmdbApiKey}. Leer lassen zum Behalten, „-“ zum Entfernen.`
                : initial.demo
                  ? "Kein Key: Demo-Katalog aktiv."
                  : "Jeder Nutzer bringt seinen eigenen Key mit: themoviedb.org → Einstellungen → API."
            }
          >
            <input
              id="s-key"
              type="password"
              autoComplete="off"
              className={inputClass}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </Field>
          <Field label="Sprache der Titel" htmlFor="s-lang">
            <Select id="s-lang" value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="de-DE">Deutsch</option>
              <option value="en-US">Englisch</option>
              <option value="fr-FR">Französisch</option>
              <option value="es-ES">Spanisch</option>
              <option value="ja-JP">Japanisch</option>
            </Select>
          </Field>
        </Panel>

        <Panel className="flex flex-col gap-4 p-5">
          <h2 className="m-0 text-base font-semibold">Dateisystem</h2>
          <Field
            label="Erlaubte Wurzelpfade (einer pro Zeile)"
            htmlFor="s-roots"
            hint="namarr liest und schreibt nur innerhalb dieser Ordner."
          >
            <textarea
              id="s-roots"
              rows={3}
              className={cx(inputClass, "h-auto py-2 font-mono")}
              value={roots}
              onChange={(e) => setRoots(e.target.value)}
            />
          </Field>
          <Field label="Standard-Zielordner" htmlFor="s-target">
            <input
              id="s-target"
              className={cx(inputClass, "font-mono")}
              placeholder="/data/media"
              value={defaultTarget}
              onChange={(e) => setDefaultTarget(e.target.value)}
            />
          </Field>
        </Panel>

        <Panel className="flex flex-col gap-3 p-5">
          <h2 className="m-0 text-base font-semibold">Library-Refresh nach der Ausführung</h2>
          {refresh.map((r, i) => (
            <div key={i} className="flex gap-2">
              <Select
                aria-label="Server"
                value={r.kind}
                onChange={(e) => setRefresh(refresh.map((x, k) => (k === i ? { ...x, kind: e.target.value as "plex" } : x)))}
              >
                <option value="jellyfin">Jellyfin</option>
                <option value="emby">Emby</option>
                <option value="plex">Plex</option>
              </Select>
              <input
                aria-label="URL"
                className={cx(inputClass, "flex-grow")}
                placeholder="http://jellyfin:8096"
                value={r.url}
                onChange={(e) => setRefresh(refresh.map((x, k) => (k === i ? { ...x, url: e.target.value } : x)))}
              />
              <input
                aria-label="Token"
                type="password"
                className={inputClass}
                placeholder="API-Key / Token"
                value={r.token}
                onChange={(e) => setRefresh(refresh.map((x, k) => (k === i ? { ...x, token: e.target.value } : x)))}
              />
              <Button aria-label="Entfernen" onClick={() => setRefresh(refresh.filter((_, k) => k !== i))}>
                <XIcon />
              </Button>
            </div>
          ))}
          <div>
            <Button size="sm" onClick={() => setRefresh([...refresh, { kind: "jellyfin", url: "", token: "" }])}>
              Server hinzufügen
            </Button>
          </div>
        </Panel>

        <Panel className="flex flex-col gap-3 p-5">
          <h2 className="m-0 text-base font-semibold">Benachrichtigungen</h2>
          {notifications.map((n, i) => (
            <div key={i} className="flex gap-2">
              <Select
                aria-label="Dienst"
                value={n.kind}
                onChange={(e) => setNotifications(notifications.map((x, k) => (k === i ? { ...x, kind: e.target.value as "ntfy" } : x)))}
              >
                <option value="ntfy">ntfy</option>
                <option value="gotify">Gotify</option>
                <option value="telegram">Telegram</option>
                <option value="discord">Discord-Webhook</option>
                <option value="webhook">Webhook</option>
              </Select>
              <input
                aria-label="URL"
                className={cx(inputClass, "flex-grow")}
                placeholder="https://ntfy.sh/mein-topic"
                value={n.url}
                onChange={(e) => setNotifications(notifications.map((x, k) => (k === i ? { ...x, url: e.target.value } : x)))}
              />
              <input
                aria-label="Token"
                type="password"
                className={inputClass}
                placeholder="Token (optional)"
                value={n.token ?? ""}
                onChange={(e) =>
                  setNotifications(notifications.map((x, k) => (k === i ? { ...x, token: e.target.value || undefined } : x)))
                }
              />
              <Button aria-label="Entfernen" onClick={() => setNotifications(notifications.filter((_, k) => k !== i))}>
                <XIcon />
              </Button>
            </div>
          ))}
          <div>
            <Button size="sm" onClick={() => setNotifications([...notifications, { kind: "ntfy", url: "" }])}>
              Benachrichtigung hinzufügen
            </Button>
          </div>
        </Panel>

        <ErrorNote error={save.error} />
        {save.isSuccess && <div className="text-sm text-[#4fd1a5]">Gespeichert.</div>}
        <div>
          <Button type="submit" variant="accent" size="lg" disabled={save.isPending}>
            Speichern
          </Button>
        </div>
      </form>
    </>
  );
}
