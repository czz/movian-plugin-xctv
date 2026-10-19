# movian-plugin-xctv

**Xtream Codes** plugin for [Movian](https://movian.tv) / movian-go.

A complete IPTV client: live TV with EPG guide, catch-up,
recordings, movies and series on demand, favorites, multiple
playlists and a UI translated into 22 languages.

## Features

### Live TV

- **Guide grid** — channels × time, IPTV style, with channel numbers,
  logos, now/next and a progress bar on the current program
- **Zapping** — OK on a channel tunes it; keys 0-9 zap by number
  (per-channel custom numbering supported)
- **Channel schedule** — full ~48h listing per channel: past programs
  play via catch-up, future ones can be recorded or set as reminders
- **Context menus** — long-press (or right-click) on a channel or
  group: favorites, hide, rename, reorder, channel number, schedule,
  catch-up, multiview, PIN lock
- **Multiview** — 2×2 mosaic with muted audio; OK on a tile opens
  the channel fullscreen

### Catch-up

Available on channels with provider-side archive (`tv_archive` flag):

- direct click on a finished program in the guide grid
- long-press on the channel → "Catch-up"
- badge on finished programs in the channel schedule

### Recordings & reminders

- **Live** — REC icon in the player bar: dumps the stream to a `.ts`
  file until stopped
- **Scheduled** — channel schedule → future program → "Record" badge:
  starts on its own and stops at the end of the program (one at a
  time)
- **Series** — "Reminder and series recording" → schedules all future
  episodes with the same title found in the guide
- **Reminder** — notification when the program starts, no recording
- **Management** — Menu → "Recordings": completed files (play /
  delete), scheduled entries and active reminders
- **Custom folder** — Settings → Playback → "Recordings folder"
  (empty = plugin storage)

### Movies & series

- Poster wall with year and rating, detail page with backdrop, plot
  and cast
- **Continue watching** — resume VOD from where you left off
- **Series** — per-season rail, watched marker (✓) and **autoplay**
  of the next episode when one ends
- Catalog sorting: default, name, recently added, rating

### Organization

- **Favorites** — dedicated group on top, exportable as a standard
  **M3U playlist** (Settings → System)
- **Recents** — recently watched channels, most recent first
- **Manual ordering** — channels and groups (persistent)
- **Hide** — unused channels and groups, restore from Settings or
  the group menu
- **PIN lock** — protects groups with adult content

### Sources & search

- **Multiple playlists** — several **Xtream**, **M3U** or **Stalker**
  accounts/sources with quick switching
- **Global search** — the plugin shows up in Movian's searcher
- **Internal search** — channels, movies and series
- **Backup/Restore** — favorites, lists, settings and history in a
  single JSON file

### Interface

- **22 languages** — full translation: en, it, es, de, fr, ru, uk,
  ro, pt-PT, pt-BR, nl, pl, cs, sk, sv, da, fi, hu, el, ja, mk, zh-CN
  (fallback chain: chosen language → English → Italian source string)
- **Appearance** — accent color, panel opacity, channel numbers, logos
- **Built-in guide** — Menu → "Guide" explains every feature
- Audio tracks and subtitles selectable during playback
- Sleep timer, custom HTTP headers and User-Agent
- Black background during playback

## EPG

EPG sources, in order:

1. The Xtream server's `xmltv.php` (cached on disk for `epgTtlH`
   hours)
2. Custom XMLTV URL (`epgUrl` setting)
3. Per-channel `get_short_epg` (now/next fallback)

Time-shift correction (`epgOffsetMin`) and automatic refresh are
configurable.

## Requirements

- movian-go ≥ 8.3.0 — needs plugin i18n support (`Core.getString`,
  `lang/` merge into the NLS table) and the videoparams `live` flag
- File permissions: the manifest declares `bypassFileACLRead` and
  `bypassFileACLWrite` (required for the custom recordings folder)

## Development

```bash
./movian-go -d -p /path/to/plugin
```

The plugin reloads automatically when files change.

## Files

- `xctv.js` — routes, settings, cache, EPG, recordings, scheduler
- `libs/libxtream.js` — Xtream Codes player_api client
- `libs/libm3u.js` — M3U playlist parser
- `libs/libstalker.js` — Stalker portal client
- `libs/libxmltv.js` — XMLTV parser/index
- `views/` — GLW layouts: livetv (guide+player), schedule, episodes,
  moviedetail, browse, multiview, help
- `lang/` — 22 translation files (`id:` = Italian source string)
