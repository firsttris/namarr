import type { MovieProvider, SeriesProvider, Settings } from "@namarr/db/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { XIcon } from "~/components/icons";
import { Button, cx, ErrorNote, Field, inputClass, PageHeader, Panel, Select } from "~/components/ui";
import { getSettingsFn, saveSettings } from "~/functions/library.functions";
import { LANGS, type Lang, pickMsg, useLang } from "~/lib/i18n";
import { msgGroup } from "~/lib/msg-groups";
import { MOVIE_SOURCES, SERIES_SOURCES } from "~/lib/providers";
import * as m from "~/paraglide/messages";

export const Route = createFileRoute("/settings")({
  loader: () => getSettingsFn(),
  component: SettingsPage,
});

function SettingsPage() {
  const { lang, setLang } = useLang();
  const initial = Route.useLoaderData();
  const router = useRouter();
  const qc = useQueryClient();
  const [key, setKey] = useState("");
  const [seriesProvider, setSeriesProvider] = useState<SeriesProvider>(initial.seriesProvider ?? "tmdb");
  const [movieProvider, setMovieProvider] = useState<MovieProvider>(initial.movieProvider ?? "tmdb");
  const [tvdbKey, setTvdbKey] = useState("");
  const [tvdbPin, setTvdbPin] = useState("");
  const [anidbClient, setAnidbClient] = useState(initial.anidbClient ?? "");
  const [anidbVersion, setAnidbVersion] = useState(initial.anidbClientVersion ?? "1");
  const [language, setLanguage] = useState(initial.language);
  const [roots, setRoots] = useState(initial.roots.join("\n"));
  const [defaultTarget, setDefaultTarget] = useState(initial.defaultTargetRoot ?? "");
  const [notifications, setNotifications] = useState<Settings["notifications"]>(initial.notifications);
  const [refresh, setRefresh] = useState<Settings["libraryRefresh"]>(initial.libraryRefresh);

  // A chosen source without credentials only fails at the next job: say so here already.
  const configured: Record<SeriesProvider, boolean> = {
    tmdb: initial.hasTmdbKey || Boolean(key) || initial.demo,
    tvdb: initial.hasTvdbKey || Boolean(tvdbKey),
    tvmaze: true,
    anidb: Boolean(anidbClient),
  };
  const missing = [...new Set<SeriesProvider>([seriesProvider, movieProvider])].filter((p) => !configured[p]);

  const save = useMutation({
    mutationFn: () =>
      saveSettings({
        data: {
          tmdbApiKey: key || undefined,
          tvdbApiKey: tvdbKey || undefined,
          tvdbPin: tvdbPin || undefined,
          anidbClient,
          anidbClientVersion: anidbVersion,
          seriesProvider,
          movieProvider,
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
      setTvdbKey("");
      setTvdbPin("");
      qc.invalidateQueries();
      router.invalidate();
    },
  });

  return (
    <>
      <PageHeader title={m.settings_title()} subtitle={m.settings_subtitle()} />
      <form
        className="flex max-w-3xl flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Panel className="flex flex-col gap-4 p-5">
          <h2 className="m-0 text-base font-semibold">{m.settings_metadata()}</h2>
          <Field
            label={m.settings_tmdbKey()}
            htmlFor="s-key"
            hint={
              initial.hasTmdbKey
                ? m.settings_keyStored({ masked: initial.tmdbApiKey ?? "" })
                : initial.demo
                  ? m.settings_keyDemo()
                  : m.settings_keyHelp()
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
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={m.settings_seriesProvider()} htmlFor="s-series" hint={pickMsg(msgGroup.settings_providerHint, seriesProvider)}>
              <Select id="s-series" value={seriesProvider} onChange={(e) => setSeriesProvider(e.target.value as SeriesProvider)}>
                {SERIES_SOURCES.map((p) => (
                  <option key={p} value={p}>
                    {pickMsg(msgGroup.providers, p)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={m.settings_movieProvider()} htmlFor="s-movies">
              <Select id="s-movies" value={movieProvider} onChange={(e) => setMovieProvider(e.target.value as MovieProvider)}>
                {MOVIE_SOURCES.map((p) => (
                  <option key={p} value={p}>
                    {pickMsg(msgGroup.providers, p)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {missing.length > 0 && (
            <p role="status" className="m-0 text-[13px] text-accent">
              {missing.map((p) => m.settings_missingAccess({ name: pickMsg(msgGroup.providers, p) })).join(" ")}
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={m.settings_tvdbKey()}
              htmlFor="s-tvdb"
              hint={initial.hasTvdbKey ? m.settings_keyStored({ masked: initial.tvdbApiKey ?? "" }) : m.settings_tvdbHelp()}
            >
              <input
                id="s-tvdb"
                type="password"
                autoComplete="off"
                className={inputClass}
                value={tvdbKey}
                onChange={(e) => setTvdbKey(e.target.value)}
              />
            </Field>
            <Field
              label={m.settings_tvdbPin()}
              htmlFor="s-tvdb-pin"
              hint={initial.tvdbPin ? m.settings_keyStored({ masked: initial.tvdbPin }) : undefined}
            >
              <input
                id="s-tvdb-pin"
                type="password"
                autoComplete="off"
                className={inputClass}
                value={tvdbPin}
                onChange={(e) => setTvdbPin(e.target.value)}
              />
            </Field>
            <Field label={m.settings_anidbClient()} htmlFor="s-anidb" hint={m.settings_anidbHelp()}>
              <input
                id="s-anidb"
                autoComplete="off"
                className={inputClass}
                value={anidbClient}
                onChange={(e) => setAnidbClient(e.target.value)}
              />
            </Field>
            <Field label={m.settings_anidbClientVersion()} htmlFor="s-anidb-ver">
              <input
                id="s-anidb-ver"
                inputMode="numeric"
                className={inputClass}
                value={anidbVersion}
                onChange={(e) => setAnidbVersion(e.target.value)}
              />
            </Field>
          </div>
          <Field label={m.settings_titleLanguage()} htmlFor="s-lang">
            <Select id="s-lang" value={language} onChange={(e) => setLanguage(e.target.value)}>
              {Object.entries(msgGroup.titleLanguages).map(([id, label]) => (
                <option key={id} value={id}>
                  {label()}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={m.settings_uiLanguage()} htmlFor="s-ui-lang">
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
          <h2 className="m-0 text-base font-semibold">{m.settings_filesystem()}</h2>
          <Field label={m.settings_roots()} htmlFor="s-roots" hint={m.settings_rootsHint()}>
            <textarea
              id="s-roots"
              rows={3}
              className={cx(inputClass, "h-auto py-2 font-mono")}
              value={roots}
              onChange={(e) => setRoots(e.target.value)}
            />
          </Field>
          <Field label={m.settings_defaultTarget()} htmlFor="s-target">
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
          <h2 className="m-0 text-base font-semibold">{m.settings_refresh()}</h2>
          {refresh.map((r, i) => (
            <div key={i} className="flex gap-2">
              <Select
                aria-label={m.settings_server()}
                value={r.kind}
                onChange={(e) => setRefresh(refresh.map((x, k) => (k === i ? { ...x, kind: e.target.value as "plex" } : x)))}
              >
                <option value="jellyfin">Jellyfin</option>
                <option value="emby">Emby</option>
                <option value="plex">Plex</option>
              </Select>
              <input
                aria-label={m.settings_url()}
                className={cx(inputClass, "flex-grow")}
                placeholder="http://jellyfin:8096"
                value={r.url}
                onChange={(e) => setRefresh(refresh.map((x, k) => (k === i ? { ...x, url: e.target.value } : x)))}
              />
              <input
                aria-label={m.common_token()}
                type="password"
                className={inputClass}
                placeholder={m.settings_apiToken()}
                value={r.token}
                onChange={(e) => setRefresh(refresh.map((x, k) => (k === i ? { ...x, token: e.target.value } : x)))}
              />
              <Button aria-label={m.common_remove()} onClick={() => setRefresh(refresh.filter((_, k) => k !== i))}>
                <XIcon />
              </Button>
            </div>
          ))}
          <div>
            <Button size="sm" onClick={() => setRefresh([...refresh, { kind: "jellyfin", url: "", token: "" }])}>
              {m.settings_addServer()}
            </Button>
          </div>
        </Panel>

        <Panel className="flex flex-col gap-3 p-5">
          <h2 className="m-0 text-base font-semibold">{m.settings_notifications()}</h2>
          {notifications.map((n, i) => (
            <div key={i} className="flex gap-2">
              <Select
                aria-label={m.settings_service()}
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
                aria-label={m.settings_url()}
                className={cx(inputClass, "flex-grow")}
                placeholder="https://ntfy.sh/mein-topic"
                value={n.url}
                onChange={(e) => setNotifications(notifications.map((x, k) => (k === i ? { ...x, url: e.target.value } : x)))}
              />
              <input
                aria-label={m.common_token()}
                type="password"
                className={inputClass}
                placeholder={m.settings_tokenOptional()}
                value={n.token ?? ""}
                onChange={(e) =>
                  setNotifications(notifications.map((x, k) => (k === i ? { ...x, token: e.target.value || undefined } : x)))
                }
              />
              <Button aria-label={m.common_remove()} onClick={() => setNotifications(notifications.filter((_, k) => k !== i))}>
                <XIcon />
              </Button>
            </div>
          ))}
          <div>
            <Button size="sm" onClick={() => setNotifications([...notifications, { kind: "ntfy", url: "" }])}>
              {m.settings_addNotification()}
            </Button>
          </div>
        </Panel>

        <ErrorNote error={save.error} />
        {save.isSuccess && <div className="text-sm text-[#4fd1a5]">{m.common_saved()}</div>}
        <div>
          <Button type="submit" variant="accent" size="lg" disabled={save.isPending}>
            {m.common_save()}
          </Button>
        </div>
      </form>
    </>
  );
}
