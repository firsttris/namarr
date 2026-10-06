# Installation

namarr is one Bun process in one container: web UI, API, job queue and watch folders. It needs two
volumes, `/config` for its SQLite database and `/data` for your files.

> [!IMPORTANT]
> Keep your downloads and your library **in the same mount**, for example `/mnt/data/downloads` and
> `/mnt/data/media` mounted together as `/data`. Hardlinks cannot cross file systems, and hardlinks
> are what keep torrents seeding after a rename.

## Docker Compose

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
      - /mnt/data:/data # downloads and library in the same mount, otherwise no hardlinks
    restart: unless-stopped
```

The same file is in [`docker/compose.example.yml`](../docker/compose.example.yml). Then open
`http://<host>:8420`, sign in with the token and, under **Settings**:

1. add your [folders](#folders-and-libraries): `/data` from the example, or your own mounts, each
   picked with *Browse …*; until then the dashboard asks for them;
2. add your own TMDB API key (themoviedb.org → Settings → API; a v3 key or a v4 token), or set up
   one of the [other metadata sources](metadata.md).

## Podman Quadlet

```sh
mkdir -p ~/.config/containers/systemd ~/namarr/config
cp docker/quadlet/namarr.container ~/.config/containers/systemd/   # adjust /mnt/data in it
printf 'a-long-token' | podman secret create namarr-token -
systemctl --user daemon-reload && systemctl --user start namarr
loginctl enable-linger $USER   # start after boot, even without a login
```

Rootless, leave `PUID` empty: root in the container already is your own user, and a `PUID` would be
mapped to a foreign subuid. Rootful (`/etc/containers/systemd/`), set `PUID`/`PGID` as with Docker.
Updates: `podman auto-update` (the unit sets `AutoUpdate=registry`).

## Unraid

A template is in [`docker/unraid/namarr.xml`](../docker/unraid/namarr.xml).

## Images and tags

Images are published to `ghcr.io/firsttris/namarr` and `tristanteu/namarr` for `linux/amd64` and
`linux/arm64`:

| Tag | Content |
|---|---|
| `latest`, `x.y.z` | releases |
| `edge` | the current state of `main` |

A new version is published by pushing a tag `vX.Y.Z` (see [Releases](development.md#releases));
`edge` is built by hand with the *Release* workflow on `main`. The image contains a static `ffprobe`, so
resolution and codecs are read even from files whose names say nothing about them.

## Folders and libraries

Under **Settings → Folders** you list every folder namarr may use. namarr reads and writes only
inside them, and you pick files from them in the workbench and for watch folders. Every path field
has a **Browse …** button that opens a folder browser; in the settings it shows the whole container,
so you can find your mounts.

Each folder has a type:

| Type | Meaning |
|---|---|
| Folder | browse and change files there: downloads, photos, music |
| Library: movies | also a target for movies in media mode |
| Library: series | also a target for series in media mode |

Matched files go to the **default** library of their kind: a movie to the default movie library, an
episode to the default series library. Mark one library per kind as default; the first one is it
automatically. Profiles and watch folders can choose another library per kind (an anime profile
with its own series folder, say), and the workbench can put a whole job into one folder or rename
in place. Rule mode does not use libraries: it renames in place unless you choose a folder.

Example with movies and series on separate mounts:

```ini
Volume=/mnt/downloads:/downloads
Volume=/mnt/movies:/movies
Volume=/mnt/tvshows:/tvshows
```

| Folder | Type | Default |
|---|---|---|
| `/downloads` | Folder | |
| `/movies` | Library: movies | ✓ |
| `/tvshows` | Library: series | ✓ |

Separate mounts work for *move* and *copy*; **hardlinks** need source and target on the same file
system. For hardlinks, mount one parent (`/mnt/data:/data` with `downloads/`, `movies/` and `tv/`
inside) and add `/data/downloads`, `/data/movies` and `/data/tv` as folders.

Settings from earlier versions are taken over: the allowed root paths become folders, the default
target becomes the default library for movies and series.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `NAMARR_TOKEN` | – | Access token for the UI (login) and the API (`Authorization: Bearer …` or Basic auth). **Required** as soon as namarr listens on more than `127.0.0.1`, so always in the Docker image. |
| `NAMARR_AUTH_HEADER` | – | Alternative: a header set by a trusted reverse proxy, e.g. `Remote-User`. |
| `NAMARR_ROOTS` | – | Optional: folders to set up on the very first start, comma-separated, e.g. `/downloads,/movies`; only those that exist. Afterwards the folders are managed under *Settings → Folders* (see [below](#folders-and-libraries)). |
| `NAMARR_CONFIG_DIR` | `/config` (Docker), `./config` | SQLite database (WAL). |
| `NAMARR_HOST` / `NAMARR_PORT` | `127.0.0.1` / `8420` | Outside Docker only reachable locally by default. |
| `PUID` / `PGID` | `1000` | The server starts as root, hands `/config` over and then runs as this user. |
| `NAMARR_PATH_MAP` | – | Maps paths of other containers to namarr's view, e.g. `/downloads:/data/downloads` (several separated by commas). Used by the [download client hook](automation.md#download-client-hook). |
| `NAMARR_DEMO` | – | `1`: offline demo catalog instead of TMDB, to try the UI and for the E2E tests. |
| `NAMARR_LOG_LEVEL` | `info` | pino log level. |

## Health and live events

- `GET /api/health`: health check for Docker, Quadlet or a load balancer; answers `{"status": "ok", "version": "x.y.z", "uptime": …}`. The UI shows the version at the bottom of the navigation, linked to its release notes.
- `GET /api/events`: Server-Sent Events: `job.progress`, `item.updated`, `inbox.added`,
  `watch.detected`.
- `POST /api/jobs` and `GET /api/jobs/<id>`: the [download client hook](automation.md#download-client-hook).
