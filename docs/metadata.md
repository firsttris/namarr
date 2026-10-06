# Metadata sources

Names come from a database, never from guesses. namarr knows four of them:

| Source | For | Access | Notes |
|---|---|---|---|
| **TMDB** | movies and series | your own API key (themoviedb.org → Settings → API; v3 key or v4 token) | good localized titles; DVD and absolute order through episode groups |
| **TheTVDB** | movies and series | API key (thetvdb.com → dashboard → API keys), with a user-supported key also your subscriber PIN | counts episodes like Sonarr and Jellyfin; aired, DVD and absolute order |
| **TVmaze** | series only | none | free; titles mostly in English or the original language |
| **AniDB** | anime | a registered client (anidb.net → settings → register a client, HTTP API) | absolute numbers and specials; every season is an entry of its own |

## Choosing a source

Under *Settings* you choose where **series** and where **movies** come from. TVmaze and AniDB have
no movies, so movies come from TMDB or TheTVDB. A source without its key is marked right there.

A **watch folder** can pick its own series source, for example AniDB for an anime folder, and the
**workbench** can switch it per job. The download client hook uses the source of the watch folder
it names.

## IDs in folder names

Sonarr, Radarr and Jellyfin write IDs into folder names. namarr reads them and skips the search: the
entry is taken directly, at full confidence.

```
Star Trek - Deep Space Nine (1993) [tvdbid-72073]/Season 01/…
Dune (2021) {tmdb-438631}/…
The Sopranos {imdb-tt0141842}/…
Frieren [anidb-17617]/…
```

Recognised: `[tvdbid-…]`, `{tvdb-…}`, `[tmdbid-…]`, `{tmdb-…}`, `[imdbid-tt…]`, `{imdb-tt…}`,
`[anidb-…]`, in any folder above the file or in the file name itself (the nearest one wins). Foreign
IDs are translated too: TMDB finds series by TVDB and IMDb IDs, TheTVDB by IMDb and TMDB IDs, TVmaze
by TVDB and IMDb IDs.

## AniDB

AniDB has no search API. namarr downloads the daily title list (at most every three days) and
searches it locally. AniDB bans clients that ask too often, so requests are at least 2.5 seconds
apart and every answer is cached for a week.

Every season is an entry of its own at AniDB. For `S02E05` namarr prefers the entry whose title names
the second season and marks the match for review. Fansub names with absolute numbers
(`[Group] Show - 05`) map directly onto the entry.

## Languages

The **title language** (German, English, French, …) is set under *Settings* and is independent of
the UI language. When TMDB or TheTVDB have no translation for an episode title and return a placeholder like
"Episode 5", namarr takes the title from the original language, then from English.

## Episode order

The workbench offers **aired**, **DVD** and **absolute** order. TMDB maps DVD and absolute order
through its episode groups, TheTVDB through its season types. TVmaze and AniDB have only one order.
