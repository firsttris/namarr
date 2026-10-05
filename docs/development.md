# Development

Requires [Bun](https://bun.sh/) 1.4.

```bash
bun install
bun run dev          # TanStack Start on http://localhost:8420 (NAMARR_DEMO=1 for the demo catalog)
bun run test         # Vitest: core, providers, db, server (under the Bun runtime because of bun:sqlite)
bun run e2e          # build + Playwright: workbench flows against the demo backend with fake files
bun run lint         # Biome
bun run typecheck
bun run corpus       # parser against the release name corpus, hit rate per category
bun run build && bun run start
```

**Migrations**: change the schema in `packages/db/src/schema.ts`, then run
`bun run --cwd packages/db generate`. They run automatically at startup.

**Texts**: all texts live in `apps/server/messages/{de,en}.json`
([Paraglide JS](https://inlang.com/m/gerre34r/library-inlang-paraglideJs)), keys follow
`area_group_name` (`settings_title`, `rules_describe_pad`). `bun run i18n` compiles them to
`apps/server/src/paraglide` (dev, build, typecheck and test do that on their own). Components call
them directly: `m.settings_title()`, `m.workbench_run({ n, count, test })`; a key chosen at runtime
goes through `pickMsg(msgGroup.actions, action)`. Placeholders are `{name}`, a literal brace is `\{`.

Texts the server produces (match reasons, file errors, provider errors) use `msg("key", inputs)`
from `@namarr/core/i18n`: they travel as key and inputs and are rendered in the viewer's language by
the UI (`useLocalize()`), or by the server where it answers itself (`localizeIn()`, notifications
in the title language). Entries stored by older versions, with both texts side by side, still render.

The first visit follows the browser language (everything but German → English), later the switch in
the navigation or the settings; the choice is kept in the `namarr_lang` cookie, and every request is
rendered in it (`lang.server.ts`). `apps/server/test/i18n.test.ts` checks that both languages have
the same keys and placeholders, that every message is used and every used key exists, and that no
German is left in English.

## Architecture

```
packages/
  core/       domain logic without a framework: parser, matcher, formatter, rules, scanner, fileops, jobs
  providers/  TMDB, TheTVDB, TVmaze, AniDB (cache, rate limit, episode orders), demo catalog
  db/         Drizzle schema, migrations, repositories (bun:sqlite)
apps/
  server/     TanStack Start: routes, server functions (thin adapters with Zod), server routes, worker
scripts/      corpus.ts, the parser benchmark
docker/       Dockerfile, compose example, Quadlet, Unraid template
```

One Bun process: `apps/server/server.ts` runs the migrations at startup and starts the job queue and
the watch folders exactly once (a singleton on `globalThis`, also in Vite dev mode). Server functions
only create jobs; scanning, matching and execution run in the queue, progress arrives over SSE. The
workbench renders on the client (`ssr: false`).

## Tests

| Area | What is tested |
|---|---|
| Parser | every rule on its own, folder context, IDs in folder names, snapshots, YAML corpus |
| Matcher | Jaro-Winkler, year, ambiguity (The Office US/UK), grouping (one search per series), overrides, absolute numbers, lookups by ID, one entry per season |
| Formatter / rules | template language incl. error positions, presets, snapshots; property tests (fast-check): sanitising is idempotent and never produces invalid paths, rules never change the extension |
| FileOps | in temporary folders: all actions, conflicts, quality comparison for *keep better*, backup on overwrite, undo refused for changed files, cancel in the middle of a job |
| Providers | TMDB, TheTVDB, TVmaze and AniDB against responses in their documented format (no live API), cache TTL, 429 retry, login, error messages, IDs from folder names |
| DB / server | migrations, paging, inbox, dashboard numbers; job pipeline end to end, watch folders with real files, download client hook, auth, SSE, notifications |
| E2E | Playwright: preview, match picker, approval, hardlinks, undo, rule mode, history, hook, English and German UI |

## Parser corpus

`bun run corpus`, currently:

| Category | Names | Correct | Hit rate |
|---|---:|---:|---:|
| Anime | 7 | 7 | 100.0 % |
| German | 16 | 16 | 100.0 % |
| Movies | 29 | 29 | 100.0 % |
| Series | 25 | 25 | 100.0 % |
| **Total** | **77** | **77** | **100.0 %** |

The corpus is a start (the goal is 500+ real names) and was written together with the parser, so the
100 % says little. Every reported miss becomes a new entry in
`packages/core/test/corpus/releases.yaml`.

## Releases

A version is a tag. Without a checkout: *Actions → Bump version → Run workflow* with patch, minor or
major ([`bump.yml`](../.github/workflows/bump.yml), the shared
[`bump-version`](https://github.com/firsttris/workflows#bump-version)); it raises the version, commits it
as `Release vX.Y.Z`, tags it and starts the release. Or on an up-to-date `main`, with a clean working
tree:

```bash
bun run release:minor      # or release:patch / release:major
```

This runs `npm version`, which writes the new number into `package.json`, commits it and creates the
tag `vX.Y.Z` from the same number; the `postversion` script then pushes commit and tag
(`git push --follow-tags`).

The tag push starts the *Release* workflow (CI here, the rest from the shared
[`docker-release.yml`](https://github.com/firsttris/workflows) in `firsttris/workflows`):

1. the tag must match `version` in the root `package.json`,
2. the full CI (lint, typecheck, tests, parser benchmark, build, E2E),
3. the image as `x.y.z`, `x.y` and `latest` on Docker Hub and GHCR, plus the Docker Hub description,
4. only then the GitHub release with generated notes.

Started by hand on `main` (Actions → *Release* → Run workflow), the workflow runs the same checks and
pushes the image as `edge`; nothing is released.

CI runs lint, typecheck, tests, the parser benchmark, the build and the E2E tests on every push to
`main` and on every pull request.

## Roadmap

- **M0 foundation, M1 core, M2 web UI and Docker**: done.
- **M3 automation**: watch folders, inbox, learned overrides, library refresh, notifications and the
  download client hook are done.
- **M4 rule mode**: rule engine, rule stack UI and media + rules are done; YAML export and import of
  presets are missing.
- **M5 anime**: absolute numbers, TMDB episode groups, TheTVDB and AniDB are done; mapping AniDB
  entries onto TVDB seasons (anime lists) is open.

Still open: a license, name reservation, a desktop app.
