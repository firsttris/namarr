import type { Settings } from "@namarr/db/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { XIcon } from "~/components/icons";
import { Button, cx, ErrorNote, Field, inputClass, PageHeader, Panel, Select } from "~/components/ui";
import { getSettingsFn, saveSettings } from "~/functions/library.functions";
import { LANGS, type Lang, useLang, useT } from "~/lib/i18n";

export const Route = createFileRoute("/settings")({
  loader: () => getSettingsFn(),
  component: SettingsPage,
});

function SettingsPage() {
  const t = useT();
  const s = t.settings;
  const { lang, setLang } = useLang();
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
      <PageHeader title={s.title} subtitle={s.subtitle} />
      <form
        className="flex max-w-3xl flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Panel className="flex flex-col gap-4 p-5">
          <h2 className="m-0 text-base font-semibold">{s.metadata}</h2>
          <Field
            label={s.tmdbKey}
            htmlFor="s-key"
            hint={initial.hasTmdbKey ? s.keyStored(initial.tmdbApiKey ?? "") : initial.demo ? s.keyDemo : s.keyHelp}
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
          <Field label={s.titleLanguage} htmlFor="s-lang">
            <Select id="s-lang" value={language} onChange={(e) => setLanguage(e.target.value)}>
              {Object.entries(t.titleLanguages).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={s.uiLanguage} htmlFor="s-ui-lang">
            <Select id="s-ui-lang" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
              {LANGS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </Select>
          </Field>
        </Panel>

        <Panel className="flex flex-col gap-4 p-5">
          <h2 className="m-0 text-base font-semibold">{s.filesystem}</h2>
          <Field label={s.roots} htmlFor="s-roots" hint={s.rootsHint}>
            <textarea
              id="s-roots"
              rows={3}
              className={cx(inputClass, "h-auto py-2 font-mono")}
              value={roots}
              onChange={(e) => setRoots(e.target.value)}
            />
          </Field>
          <Field label={s.defaultTarget} htmlFor="s-target">
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
          <h2 className="m-0 text-base font-semibold">{s.refresh}</h2>
          {refresh.map((r, i) => (
            <div key={i} className="flex gap-2">
              <Select
                aria-label={s.server}
                value={r.kind}
                onChange={(e) => setRefresh(refresh.map((x, k) => (k === i ? { ...x, kind: e.target.value as "plex" } : x)))}
              >
                <option value="jellyfin">Jellyfin</option>
                <option value="emby">Emby</option>
                <option value="plex">Plex</option>
              </Select>
              <input
                aria-label={s.url}
                className={cx(inputClass, "flex-grow")}
                placeholder="http://jellyfin:8096"
                value={r.url}
                onChange={(e) => setRefresh(refresh.map((x, k) => (k === i ? { ...x, url: e.target.value } : x)))}
              />
              <input
                aria-label={t.common.token}
                type="password"
                className={inputClass}
                placeholder={s.apiToken}
                value={r.token}
                onChange={(e) => setRefresh(refresh.map((x, k) => (k === i ? { ...x, token: e.target.value } : x)))}
              />
              <Button aria-label={t.common.remove} onClick={() => setRefresh(refresh.filter((_, k) => k !== i))}>
                <XIcon />
              </Button>
            </div>
          ))}
          <div>
            <Button size="sm" onClick={() => setRefresh([...refresh, { kind: "jellyfin", url: "", token: "" }])}>
              {s.addServer}
            </Button>
          </div>
        </Panel>

        <Panel className="flex flex-col gap-3 p-5">
          <h2 className="m-0 text-base font-semibold">{s.notifications}</h2>
          {notifications.map((n, i) => (
            <div key={i} className="flex gap-2">
              <Select
                aria-label={s.service}
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
                aria-label={s.url}
                className={cx(inputClass, "flex-grow")}
                placeholder="https://ntfy.sh/mein-topic"
                value={n.url}
                onChange={(e) => setNotifications(notifications.map((x, k) => (k === i ? { ...x, url: e.target.value } : x)))}
              />
              <input
                aria-label={t.common.token}
                type="password"
                className={inputClass}
                placeholder={s.tokenOptional}
                value={n.token ?? ""}
                onChange={(e) =>
                  setNotifications(notifications.map((x, k) => (k === i ? { ...x, token: e.target.value || undefined } : x)))
                }
              />
              <Button aria-label={t.common.remove} onClick={() => setNotifications(notifications.filter((_, k) => k !== i))}>
                <XIcon />
              </Button>
            </div>
          ))}
          <div>
            <Button size="sm" onClick={() => setNotifications([...notifications, { kind: "ntfy", url: "" }])}>
              {s.addNotification}
            </Button>
          </div>
        </Panel>

        <ErrorNote error={save.error} />
        {save.isSuccess && <div className="text-sm text-[#4fd1a5]">{t.common.saved}</div>}
        <div>
          <Button type="submit" variant="accent" size="lg" disabled={save.isPending}>
            {t.common.save}
          </Button>
        </div>
      </form>
    </>
  );
}
