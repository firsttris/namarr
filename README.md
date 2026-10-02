<div align="center">

<img src="docs/banner.png" alt="namarr: Severance.S02E01.German.DL.1080p.WEB.h264-GRP.mkv becomes Severance (2022)/Season 02/Severance (2022) - S02E01 - Hallo, Frau Cobel.mkv" width="900">

**The self-hosted renamer for movies, series and anime.**<br>
FileBot-style media matching and ReNamer-style rules in one web UI.
Every change starts as a preview, and every change can be undone.

[![CI](https://github.com/firsttris/namarr/actions/workflows/ci.yml/badge.svg)](https://github.com/firsttris/namarr/actions/workflows/ci.yml)
[![Docker Pulls](https://img.shields.io/docker/pulls/tristanteu/namarr?logo=docker&logoColor=white)](https://hub.docker.com/r/tristanteu/namarr)
[![Image Size](https://img.shields.io/docker/image-size/tristanteu/namarr/latest?logo=docker&logoColor=white&label=image)](https://hub.docker.com/r/tristanteu/namarr)
[![Platforms](https://img.shields.io/badge/platform-amd64%20%7C%20arm64-lightgrey)](https://hub.docker.com/r/tristanteu/namarr/tags)
[![Bun](https://img.shields.io/badge/built%20with-Bun-fbf0df?logo=bun&logoColor=black)](https://bun.sh/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

[Features](#-features) •
[Metadata](#-metadata-sources) •
[Quick start](#-quick-start) •
[Documentation](docs/README.md) •
[Contributing](#-contributing)

<img src="docs/screenshot-workbench.png" alt="namarr workbench: eight Severance files with their new names, the template editor and the selected episode" width="900">

</div>

## 💡 Why namarr?

FileBot matches media better than anything else, but it is a paid Java desktop app. ReNamer has the
best rules for everything else, but it only runs on Windows. Sonarr and Radarr rename well, but only
what they downloaded themselves. namarr is one small container for a home server that does both
kinds of renaming for any folder you point it at:

- **Preview first**: new jobs start in test mode. You see old → new for every file before anything
  moves.
- **Undo for everything**: per file, per job or back to a point in time. namarr refuses when a file
  has changed since, so an undo never destroys anything.
- **Names come from a database, never from guesses**: TMDB, TheTVDB, TVmaze or AniDB. Uncertain
  matches wait in the inbox instead of being renamed wrong.

## ✨ Features

- **Workbench**: pick a folder on the server and get a virtualized preview with diff highlighting,
  series groups, subtitles and other companion files, confidence badges and skipped samples, all
  usable from the keyboard
- **Media, rules or both**: match against a database, or rename with rules (replace, regex, insert,
  case, numbering, dates, transliteration …), or match first and polish with rules
- **Template language** with auto-completion and a live example: `{n} ({y})/Season {s00}/{n} - {s00e00} - {t}`,
  with filters, conditions and presets for Plex, Jellyfin, Emby and Kodi
- **Move, copy, hardlink, symlink or rename in place**. Hardlinks keep torrents seeding
- **Conflict handling**, including *keep better*, which compares resolution, source, HDR, codecs and
  audio before it looks at file size
- **Watch folders** that wait until downloads are finished, rename sure matches on their own and
  send the rest to the inbox
- **Download client hook**: qBittorrent, SABnzbd or NZBGet call `POST /api/jobs` after every download
- **IDs in folder names**: `[tvdbid-72073]`, `{tmdb-1399}`, `{imdb-tt…}` or `[anidb-…]`, as Sonarr,
  Radarr and Jellyfin write them, replace the search
- **Library refresh** for Jellyfin, Emby and Plex, **notifications** via ntfy, Gotify, Telegram,
  Discord or webhook
- **ffprobe built in** for files whose names say nothing about resolution or codec
- **English and German UI**, including every message from the server

## 🗂️ Metadata sources

| Source | Movies | Series | Anime | Access |
|---|:---:|:---:|:---:|---|
| **TMDB** | ✅ | ✅ | ✅ | your own API key |
| **TheTVDB** | ✅ | ✅ | ✅ | API key, plus PIN for a user-supported key |
| **TVmaze** | | ✅ | | none, free |
| **AniDB** | | | ✅ | registered client |

Series and movies can come from different sources, and every profile can pick its own series source,
for example AniDB for an anime profile. Details: [docs/metadata.md](docs/metadata.md).

## 🐳 Quick start

```bash
mkdir namarr && cd namarr
curl -o compose.yml https://raw.githubusercontent.com/firsttris/namarr/main/docker/compose.example.yml
# set NAMARR_TOKEN and your media mount, then
docker compose up -d
```

Open **http://localhost:8420**, sign in with your token and add a TMDB API key under *Settings*, or
set up one of the [other sources](docs/metadata.md).

<details>
<summary><b>docker run</b></summary>

```bash
docker run -d --name namarr --restart unless-stopped \
  -p 8420:8420 \
  -e PUID=1000 -e PGID=1000 \
  -e NAMARR_TOKEN="$(openssl rand -hex 24)" \
  -v ./config:/config \
  -v /mnt/data:/data \
  tristanteu/namarr:latest
```

</details>

<details>
<summary><b>Podman Quadlet</b></summary>

```bash
mkdir -p ~/.config/containers/systemd ~/namarr/config
curl -o ~/.config/containers/systemd/namarr.container https://raw.githubusercontent.com/firsttris/namarr/main/docker/quadlet/namarr.container
# adjust /mnt/data in namarr.container, then
printf 'a-long-token' | podman secret create namarr-token -
systemctl --user daemon-reload && systemctl --user start namarr
```

</details>

<details>
<summary><b>Unraid</b></summary>

Use the template in [`docker/unraid/namarr.xml`](docker/unraid/namarr.xml).

</details>

| Volume | Content |
|---|---|
| `/config` | SQLite database |
| `/data` | your downloads and your library. Keep both in the same mount, otherwise hardlinks are impossible |

Environment variables, image tags, updates and the API are in the
[installation guide](docs/installation.md).

## 📸 Screenshots

<div align="center">
<img src="docs/screenshot-dashboard.png" alt="namarr dashboard with the inbox, watch folders and recent jobs" width="900">
</div>

## 📚 Documentation

| | |
|---|---|
| [Installation](docs/installation.md) | Compose, docker run, Quadlet, Unraid, environment variables, image tags, health and events |
| [Workbench](docs/workbench.md) | preview, actions, conflicts and *keep better*, template language, rules |
| [Automation](docs/automation.md) | watch folders, inbox, download client hook, library refresh, notifications |
| [Metadata sources](docs/metadata.md) | TMDB, TheTVDB, TVmaze, AniDB, IDs in folder names, languages |
| [Development](docs/development.md) | setup, checks, architecture, tests, parser corpus, roadmap |

## 🛠️ Development

Requires [Bun](https://bun.sh/) 1.4.

```bash
git clone https://github.com/firsttris/namarr
cd namarr
bun install
NAMARR_DEMO=1 bun run dev   # http://localhost:8420 with an offline demo catalog
```

**Stack**: Bun, TanStack Start (React, server functions), TanStack Query and Virtual, Tailwind,
SQLite with Drizzle, Vitest and Playwright. More in [docs/development.md](docs/development.md).

## 🤝 Contributing

A release name that namarr parses wrong is the most useful issue there is: add it to
`packages/core/test/corpus/releases.yaml` or paste it into an issue. Pull requests are welcome; please
run `bun run lint`, `bun run typecheck` and `bun run test` before opening one.

---

<div align="center">
<sub>namarr is not affiliated with TMDB, TheTVDB, TVmaze or AniDB.
This product uses the TMDB API but is not endorsed or certified by TMDB.</sub>
</div>
