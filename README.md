# namarr

Freies, selbst gehostetes Werkzeug, das **FileBot** (Medien-Matching über TMDB) und **ReNamer** (freie Regel-Umbenennung) in einer Web-UI vereint. Ein Bun-Prozess, ein Docker-Image, kein Lizenzschlüssel, kein Account, keine Telemetrie.

- **Nichts passiert ohne Vorschau, alles ist rückgängig machbar.** Neue Jobs starten im Test-Modus; jede Operation landet in der History und lässt sich pro Datei, pro Job oder bis zu einem Zeitpunkt zurücknehmen – aber nur, wenn die Zieldatei seitdem unverändert ist.
- **Die Datenbank ist die Wahrheit.** Namen kommen von TMDB, nie geraten. Unsichere Treffer warten in der Inbox.

## Schnellstart (Docker)

```yaml
services:
  namarr:
    image: ghcr.io/firsttris/namarr:latest
    ports: ["8420:8420"]
    environment:
      PUID: 1000
      PGID: 1000
      NAMARR_TOKEN: change-me
    volumes:
      - ./config:/config
      - /mnt/data:/data # Downloads und Library im selben Mount, sonst keine Hardlinks
```

Danach `http://<host>:8420` öffnen, mit dem Token anmelden und unter **Einstellungen** den eigenen TMDB-API-Key eintragen (themoviedb.org → Einstellungen → API; v3-Key oder v4-Token).

Alles rund ums Image liegt unter [`docker/`](docker/): [`Dockerfile`](docker/Dockerfile), [`compose.example.yml`](docker/compose.example.yml), ein Unraid-Template ([`unraid/namarr.xml`](docker/unraid/namarr.xml)) und ein Podman-Quadlet ([`quadlet/namarr.container`](docker/quadlet/namarr.container)). Images: `ghcr.io/firsttris/namarr` und `tristanteu/namarr` – `latest` und `x.y.z` für Releases, `edge` für den aktuellen Stand von `main`.

### Podman (Quadlet)

```sh
mkdir -p ~/.config/containers/systemd ~/namarr/config
cp docker/quadlet/namarr.container ~/.config/containers/systemd/   # /mnt/data darin anpassen
printf 'mein-langes-token' | podman secret create namarr-token -
systemctl --user daemon-reload && systemctl --user start namarr
loginctl enable-linger $USER   # auch ohne Login nach dem Booten starten
```

Rootless bleibt `PUID` leer: Container-root ist bereits der eigene Nutzer, ein `PUID` würde auf eine fremde subuid gemappt. Rootful (`/etc/containers/systemd/`) wie bei Docker `PUID`/`PGID` setzen. Updates: `podman auto-update`.

| Variable | Standard | Bedeutung |
|---|---|---|
| `NAMARR_TOKEN` | – | Zugangs-Token für UI (Login) und API (`Authorization: Bearer …` oder Basic Auth). **Pflicht**, sobald nicht nur auf `127.0.0.1` gelauscht wird – im Docker-Image also immer. |
| `NAMARR_AUTH_HEADER` | – | Alternativ: Header eines vertrauenswürdigen Reverse-Proxys (z. B. `Remote-User`). |
| `NAMARR_ROOTS` | `/data` (Docker) | Erlaubte Wurzelpfade, kommagetrennt. Nur hier wird gelesen und geschrieben; später in den Einstellungen änderbar. |
| `NAMARR_CONFIG_DIR` | `/config` (Docker), `./config` | SQLite-Datenbank (WAL). |
| `NAMARR_HOST` / `NAMARR_PORT` | `127.0.0.1` / `8420` | Außerhalb von Docker standardmäßig nur lokal erreichbar. |
| `PUID` / `PGID` | `1000` | Der Server startet als root, übergibt `/config` und arbeitet dann als dieser Nutzer. |
| `NAMARR_DEMO` | – | `1`: Offline-Demo-Katalog statt TMDB (UI ausprobieren, E2E-Tests). |

Healthcheck: `GET /api/health`. Live-Events: `GET /api/events` (Server-Sent Events: `job.progress`, `item.updated`, `inbox.added`, `watch.detected`).

## Was drin ist

**Workbench** (`/rename`): Ordner auf dem Server wählen, Modus *Media / Regeln / Beides*, Profil wählen. Die virtualisierte Vorschau zeigt alt → neu mit Diff-Hervorhebung, Serien-Gruppen, Begleitdateien (`↳ .de.srt`), Confidence-Badges, übersprungene Samples. Tastatur: ↑ ↓ wählen, Leertaste ein-/ausschließen, Enter öffnet den **MatchPicker**. Rechts: **Template-Editor** mit Token-Autovervollständigung (`{` tippen) und Live-Beispiel an der gewählten Datei, **Regel-Stack** mit Drag-and-Drop und Vorschau pro Regel. Unten: Aktion (Test, Move, Copy, Hardlink, Symlink, Umbenennen), Konfliktverhalten, Ziel, Ausführen.

**Dashboard, Inbox, History, Profile, Watch-Folder, Einstellungen** wie im Design. Watch-Folder warten, bis Größe und mtime stabil sind, ignorieren `.part`/`.!qB`/`.tmp`, bündeln einen Release-Ordner zu einem Job und führen nur Treffer über der Auto-Schwelle aus (Standard-Aktion Hardlink, damit Seeding weiterläuft). Nach der Ausführung: Library-Refresh (Jellyfin, Emby, Plex) und Benachrichtigungen (ntfy, Gotify, Telegram, Discord, Webhook).

### Template-Sprache

```
{n} ({y})/Season {s00}/{n} ({y}) - {s00e00}{?t} - {t}{/}
{t|lower}   {n|replace:':':' -'}   {vf|default:'SD'}   {n|ascii}   {e|pad:3}
{?edition} [{edition}]{/}   {!t}Episode {e}{/}   \{edition-{edition}\}  (Plex)
```

Tokens: `n` Name, `y` Jahr, `s`/`e`, `s00`, `e00`, `s00e00` (Doppelfolgen: `S02E04-E05`), `sxe`, `t` Episodentitel, `absolute`, `d` Datum, `vf` Auflösung, `vc` Video-Codec, `ac`/`af` Audio, `hdr`, `source`, `group`, `lang`, `edition`, `part`, `id`, `provider`, `orig`, `ext`. Filter: `lower upper title trim replace default pad truncate ascii space first`. Presets: Plex, Jellyfin, Emby, Kodi. Jeder Pfadteil wird pro Zielsystem bereinigt (Windows-verbotene Zeichen, `:` → ` - `, reservierte Namen, 255 Bytes pro Segment, NFC).

### Regeln

Ersetzen (Text oder Regex mit `$1`), Einfügen, Löschen, Schreibweise, Trenner normalisieren, Nummerierung (Start, Schritt, Stellen, natürliche Sortierung), Datum aus der Datei, Erweiterung, Umlaute/Akzente transliterieren, Rest nach Muster abschneiden – jeweils auf Name, Erweiterung oder vollen Pfad, einzeln abschaltbar.

## Entwicklung

```bash
bun install
bun run dev          # TanStack Start auf http://localhost:8420 (NAMARR_DEMO=1 für den Demo-Katalog)
bun run test         # Vitest: core, providers, db, server (unter der Bun-Runtime wegen bun:sqlite)
bun run e2e          # Build + Playwright: Workbench-Flows gegen Demo-Backend mit Fake-Dateien
bun run lint         # Biome
bun run typecheck
bun run corpus       # Parser gegen den Release-Namen-Korpus, Trefferquote pro Kategorie
bun run build && bun run start
```

Migrationen: Schema in `packages/db/src/schema.ts` ändern, dann `bun run --cwd packages/db generate`. Sie laufen beim Start automatisch.

### Aufbau

```
packages/
  core/       Domänenlogik ohne Framework: parser, matcher, formatter, rules, scanner, fileops, jobs
  providers/  TMDB-Client (Cache, Rate-Limit, Episodenreihenfolgen) und Demo-Katalog
  db/         Drizzle-Schema, Migrationen, Repositories (bun:sqlite)
apps/
  server/     TanStack Start: Routen, Server Functions (dünne Adapter mit Zod), Server Routes, Worker
scripts/      corpus.ts – Parser-Benchmark
```

Ein Bun-Prozess: `apps/server/server.ts` führt beim Start die Migrationen aus und startet Job-Queue und Watch-Folder genau einmal (Singleton über `globalThis`, auch im Vite-Dev-Modus). Server Functions legen Jobs nur an; Scan, Match und Ausführung laufen in der Queue, Fortschritt kommt per SSE. Die Workbench rendert clientseitig (`ssr: false`).

### Tests

| Bereich | Was geprüft wird |
|---|---|
| Parser | jede Regel einzeln, Ordnerkontext, Snapshots, YAML-Korpus |
| Matcher | Jaro-Winkler, Jahr, Mehrdeutigkeit (The Office US/UK), Gruppierung (eine Suche pro Serie), Overrides, absolute Nummern |
| Formatter / Regeln | Template-Sprache inkl. Fehlerpositionen, Presets, Snapshots; Property-Tests (fast-check): Sanitizing ist idempotent und erzeugt nie ungültige Pfade, Regeln ändern nie die Erweiterung |
| FileOps | in temporären Ordnern: alle Aktionen, Konflikte, Sicherung beim Überschreiben, Undo mit Verweigerung bei veränderten Dateien, Abbruch mitten im Job |
| Provider | TMDB gegen aufgezeichnete Antworten (keine Live-API), Cache-TTL, 429-Retry, v3/v4-Auth |
| DB / Server | Migrationen, Paging, Inbox, Dashboard-Zahlen; Job-Pipeline Ende zu Ende, Watch-Folder mit echten Dateien, Auth, SSE, Benachrichtigungen |
| E2E | Playwright: Vorschau, MatchPicker, Freigabe, Hardlinks, Undo, Regel-Modus, History |

Parser-Korpus (`bun run corpus`), aktuell:

| Kategorie | Namen | Korrekt | Trefferquote |
|---|---:|---:|---:|
| Anime | 7 | 7 | 100.0 % |
| Deutsch | 16 | 16 | 100.0 % |
| Filme | 29 | 29 | 100.0 % |
| Serien | 25 | 25 | 100.0 % |
| **Gesamt** | **77** | **77** | **100.0 %** |

Der Korpus ist ein Anfang (Ziel laut Plan: 500+ echte Namen) und wurde zusammen mit dem Parser geschrieben – die 100 % sagen deshalb wenig. Jeder gemeldete Fehlschlag wird ein neuer Eintrag in `packages/core/test/corpus/releases.yaml`.

## Stand gegenüber der Roadmap

- **M0 Fundament, M1 Core, M2 Web-UI und Docker:** umgesetzt.
- **M3 Automatisierung:** Watch-Folder, Inbox, gelernte Overrides, Library-Refresh und Benachrichtigungen umgesetzt.
- **M4 Regel-Modus:** Regel-Engine, RuleStack-UI und Media + Regeln umgesetzt; YAML-Export/-Import von Presets fehlt noch.
- **M5 Anime:** absolute Nummern und TMDB-Episodengruppen (DVD/absolut) sind da; TVDB und AniDB fehlen.

Offen laut Plan: Lizenz (GPL-3.0 oder MIT/Apache-2.0), Namensreservierung, Desktop-App.
