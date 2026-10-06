# Workbench

The workbench (`/rename`) is where you rename by hand: pick a folder on the server, check the
preview, fix what is wrong, run it, and undo it if you change your mind.

![Workbench](screenshot-workbench.png)

## The preview

1. **Pick a folder** on the server (one of the [folders in the settings](installation.md#folders-and-libraries)) and a **mode**:
   - *Media*: match against a [metadata source](metadata.md) and name by template
   - *Rules*: rename with a rule stack, no database involved
   - *Both*: match first, then polish the result with rules
2. Optionally pick a **profile**: template, rules, action, conflict policy, target and series source
   in one.
3. The **virtualized preview** shows old → new with diff highlighting, series groups, companion files
   (`↳ .de.srt`), confidence badges and skipped samples.

Keyboard: ↑ ↓ select, space includes or excludes a file, Enter opens the **match picker** to choose
another series or movie. A choice can be remembered, so the same release name always lands on the
same entry.

On the right:

- the **template editor** with token auto-completion (type `{`) and a live example for the selected
  file
- the **rule stack** with drag and drop and a preview per rule

At the bottom: action, conflict policy, target and the button that runs the job. The target is
*Library* by default in media mode: movies go to the default movie library, series to the default
series library (or the profile's). It can be switched to *rename in place* or to one folder for every
file. A matched file without a library for its kind stays in its folder, and the preview says so.
The target of a single file can be set in the side panel, typed or picked with *Browse …*.

## Actions

| Action | What happens |
|---|---|
| Test (preview only) | nothing; conflicts are marked. **New jobs start here.** |
| Move | moves the file (across file systems: copy, check size, delete) |
| Copy | copies and checks the size |
| Hardlink | a second name for the same data; the download keeps seeding. Source and target must be on the same file system |
| Symlink | an absolute symbolic link to the source |
| Rename | renames in place |

Every operation lands in the **history** and can be undone per file, per job or back to a point in
time, but only while the target file is unchanged since. Folders that namarr created are removed
again when they are empty.

## Conflicts

When the target already exists:

| Policy | Behaviour |
|---|---|
| Skip | leaves both files alone (default) |
| Overwrite | moves the existing file aside as a backup, restored on undo |
| Suffix | `Name (1).mkv`, `Name (2).mkv`, … |
| Keep better | replaces the existing file only when the new one is better |

**Keep better** compares one criterion after another, and the first one where the two files differ
decides:

1. resolution
2. source: Remux > BluRay > WEB-DL > WEBRip > HDTV > DVD
3. HDR: DV / HDR10+ > HDR10 / HLG > SDR
4. video codec: AV1 > H.265 > H.264
5. audio: codec, then channels
6. PROPER / REPACK
7. only then file size

So a 4K HEVC beats a bigger 1080p H.264. The facts come from the file name and, when installed, from
ffprobe (resolution, codec, HDR, best audio track). For the existing file namarr uses the release name
it had before namarr renamed it, otherwise it would know nothing about its source. A criterion only
one side knows does not count. The reason is shown on the item ("Existing file is better (Source: WEB
vs BluRay)"); a replaced file is kept as a backup and restored on undo, and its subtitles are replaced
with it.

## Template language

```
{n} ({y})/Season {s00}/{n} ({y}) - {s00e00}{?t} - {t}{/}
{t|lower}   {n|replace:':':' -'}   {vf|default:'SD'}   {n|ascii}   {e|pad:3}
{?edition} [{edition}]{/}   {!t}Episode {e}{/}   \{edition-{edition}\}  (Plex)
```

**Tokens**: `n` name, `y` year, `s`/`e`, `s00`, `e00`, `s00e00` (double episodes: `S02E04-E05`),
`sxe`, `t` episode title, `absolute`, `d` date, `vf` resolution, `vc` video codec, `ac`/`af` audio,
`hdr`, `source`, `group`, `lang`, `edition`, `part`, `id`, `provider`, `orig`, `ext`.

**Filters**: `lower upper title trim replace default pad truncate ascii space first`.

**Conditions**: `{?t}…{/}` only when `t` is set, `{!t}…{/}` only when it is not.

**Presets**: Plex, Jellyfin, Emby, Kodi.

Every path segment is cleaned for the target system: characters Windows forbids, `:` → ` - `,
reserved names, 255 bytes per segment, NFC.

## Rules

In *Rules* mode namarr renames without any database, like ReNamer; in *Both* mode the rules polish
the names that came from the database. Rules run top to bottom, each one shows its result for the
selected file, and each can be switched off on its own. Unless noted, a rule works on the name, the
extension or the full path.

| Rule | What it does | Example |
|---|---|---|
| Replace | text or regex with `$1` groups, all or the first match, optionally case-sensitive | `IMG_(\d{8})` → `$1` |
| Insert | text at the start, the end or a position | `Holiday - ` + name |
| Delete | characters from a position, also counted from the end | drop the first 4 characters |
| Case | title, sentence, lower, UPPER | `the office` → `The Office` |
| Normalise separators | spaces, dots, underscores and dashes to one separator | `a.b_c` → `a b c` |
| Numbering | start, step, digits, separator, list or natural name order | `01 - IMG_0001.jpg` |
| Date from file | modification or creation date, any format | `2024-07-14 IMG.jpg` |
| Extension | new extension, lower or upper case | `.JPG` → `.jpg` |
| Transliterate | umlauts and accents to ASCII | `Größe` → `Groesse` |
| Cut the rest | everything from a pattern on | cut from ` - ` |
| Pad numbers | every number to at least N digits | `Folge 5` → `Folge 05` |
| Clean up | bracketed parts `[ ] ( ) { }`, dots and underscores to spaces, tidy spaces | `Song [Official Video].mp3` → `Song.mp3` |
| Strip characters | digits, symbols or a set of your own | `Track #1!` → `Track 1` |
| Rearrange | split at a delimiter and rebuild with `$1`, `$2` … (`$0` = everything) | `Title - Artist` → `Artist - Title` |
| Name list | one new name per line, assigned in list or natural name order; files past the list stay | paste 20 episode titles |
| From the file | values read from inside the file, see below | `2024-07-14 18-03-22.jpg` |

### From the file: photos, videos, music

The template can use:

| Token | Source |
|---|---|
| `{date:YYYY-MM-DD HH-mm-ss}` | capture date: EXIF of photos (JPEG and TIFF-based raw files such as DNG, CR2, NEF, ARW), the creation time of videos (ffprobe) |
| `{artist}` `{albumartist}` `{title}` `{album}` `{genre}` | audio tags (ffprobe: MP3, FLAC, M4A, Ogg, Opus, …) |
| `{track}` `{disc}` | numbers, `{track}` with 2 digits (`{track:3}` for 3) |
| `{year}` | the year of the release date tag |
| `{any_tag}` | any other tag by its name |

The result can replace the name or go before or after it. **Slashes in the template make folders**
below the file's folder, so `{artist}/{album}/{track} {title}` sorts a pile of MP3s into artist and
album folders. A slash inside a tag (`AC/DC`) does not, and every folder name is cleaned like a file
name. A file that lacks a value the template uses keeps its name, so a scan without EXIF never
becomes a half-empty name.

The values are read only when such a rule is active, and once per file version, so editing the rules
stays fast. HEIC photos are not read yet.

### Sharing rule sets

*Export* below the rule stack saves the rules as `namarr-rules.yaml`; *Import* loads such a file (or
JSON) and replaces the current rules. Profiles keep rule stacks on the server, export and import move
them between installations or to other people.

```yaml
namarr: rules/1
rules:
  - type: cleanup
    brackets: true
  - type: pad
    digits: 2
  - type: metadata
    template: "{date:YYYY-MM-DD HH-mm-ss}"
```
