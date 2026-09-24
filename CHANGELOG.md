# Changelog

All notable changes to `@arraypress/waveform-playlist` are documented here. The
format is based on [Keep a Changelog](https://keepachangelog.com/) and this
project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.8.0] — 2026-09-24

### Fixed

- **Playlist options passed to the constructor are honoured.** `expandChapters`,
  `showDuration` and `showPlayState` were read from `data-*` alone,
  `showChapterMarkers` was reset to the smart default, and `chapterMarkerColor`
  was always the attribute or the built-in grey — so `new WaveformPlaylist(el,
  { showDuration: false })` did nothing. The React/Vue/Svelte wrappers pass
  exactly these as constructor options, so every one of those props was a
  no-op. Each now resolves as `data-*` > constructor option > default, like the
  rest of the surface.
- **A forwarded `audioMode` no longer produces a playlist that never plays.**
  `audioMode` was stripped from the container's `data-*` but not from the
  constructor options, and the wrappers forward it: `audioMode: 'external'`
  handed the playlist a player that dispatches request-play events nobody
  answers. The playlist always owns its audio, so the option is now ignored
  from either source.
- **Your player callbacks run instead of being replaced.** `onPlay`, `onPause`,
  `onEnd`, `onTimeUpdate`, `onNextTrack` and `onPreviousTrack` are documented
  pass-through options (the Svelte wrapper's `on:play`/`on:pause`/`on:end`/
  `on:timeupdate` ride on them), but the playlist overwrote all six with its
  own handlers. Yours now run after the playlist's own handling, with the
  core's arguments.
- **Per-track `data-waveform` peaks are used.** They were never read, so every
  track decoded its audio even with peaks in the markup. A JSON array is
  parsed (a malformed one warns and falls back to decoding); a `.json` peaks
  URL is passed through for the core to fetch.
- **The previous track's album no longer sticks on the lock screen.** An
  absent album was sent as `undefined`, which the core's option merge skips,
  so Media Session kept the last album that had one.
- **Hero cover art follows the track.** A track without artwork kept showing
  the previous cover, and a hero playlist whose first track had no artwork
  never showed any cover at all. The art is now created on demand and hidden
  for artless tracks.
- **`destroy()` leaves the container as it found it.** It emptied the
  container *before* restoring the original `[data-track]` elements, so they
  were gone — and the React/Vue/Svelte wrappers, which render the tracks as
  children and destroy + rebuild on a prop change, rebuilt an empty playlist.
  It now removes only what the playlist generated, un-hides the tracks in
  place (restoring any inline `display` they had), removes every layout class
  it added (`wp-hero-layout`, `wp-grid-layout`, `wp-density-compact`,
  `wp-cover-top`, `wp-no-artist`, …) while keeping the author's own, and
  clears `data-waveform-playlist-initialized` so `WaveformPlaylist.init()` can
  rebuild it.
- **A chapter seek into another track waits for that track to load.** It
  treated any `waveformplayer:ready` as "loaded", but the core emits that once,
  ~100ms after construction, never after a load — so a deep link such as
  `seekToChapter(1, 60)` right after construction seeked before track 1 had a
  duration and silently stayed at 0:00. It now waits for the player's `onLoad`
  for that track.
- **A pending chapter seek no longer lands on the wrong track.** When the
  target track failed to load, the waiting seek (and a document-level listener)
  stayed armed forever and fired on the next track that did load — jumping it
  to the failed track's chapter time — and survived `destroy()`. There is now
  a single pending seek, cancelled by a load error, by selecting another track,
  and by `destroy()`. Your `onError` still runs.
- **Chapter seeks work with `data-preload="none"`.** The duration is unknown
  until playback starts and the core's `seekTo()` is a no-op without one, so
  clicking a chapter just played from 0:00. Playback now starts and the seek
  lands when the metadata arrives.
- **The right chapter list opens for the selected track.** Sublists were
  matched to tracks by position, so when not every track had chapters the
  wrong one (or none) was shown — and in the hero layout this overrode the
  correct, index-matched reveal. The list layout also never revealed the first
  track's chapters until you changed track.
- **The play/pause overlay sits on the active row.** Overlays were matched by
  position, but only tracks with artwork have one, so with an artless track
  earlier in the list the overlay appeared on the wrong row (or not at all).
- **No stale chapter highlight when returning to a track.** If its first
  chapter starts after 0:00, the previously active chapter kept its highlight
  and `aria-current` until playback crossed a chapter boundary.
- **Chapters sharing a start time highlight the first, not the last.** Most
  visibly, several chapters without `data-time` all sit at 0:00 and the last
  of them was marked as playing.
- **`H:MM:SS` chapter times parse.** `data-time="1:05:30"` read as 1 second —
  only the first field of a three-part time was used. `SS` and `M:SS` are
  unchanged, and a malformed time still reads as 0.
- **Keyboard shortcuts no longer hijack browser shortcuts.** With focus in the
  playlist, Cmd/Ctrl+P (print) went to the previous track, Ctrl+N to the next,
  and Ctrl/Alt+1–9 selected tracks instead of switching tabs. Keys with Ctrl,
  Cmd or Alt held now pass through untouched.
- **The legacy `data-*` parser (cores without `WaveformPlayer.utils`) is back
  in step with the core.** It was missing `waveformGradient`, `buttonStyle`,
  `buttonSize`/`buttonRadius`, `seekHandle`, `bpm`, `artworkPosition`,
  `seekValueText`, `playPauseLabel`, `speedLabel`, `artworkAlt` and
  `unknownTrackText`, the `data-style`/`data-color`/`data-theme` aliases, and
  JSON gradient stops in `data-waveform-color`/`data-progress-color`; it also
  forwarded empty strings and ignored a present-but-empty boolean attribute
  where the core does the opposite. A test now compares it key-for-key with the
  real core's `parseDataAttributes`.
- **Types cover the whole playlist option surface.** `layout` was typed
  `'list' | 'minimal'` although `'hero'` and `'grid'` ship, and `showArtist`,
  `coverSize`, `thumbnailSize`, `density`, `coverPosition` and `barPosition`
  were untyped, so the framework wrappers couldn't pass them without a cast.
  Parsed tracks also gain `waveform`. A test keeps `index.d.ts` in step with the
  runtime's own option list.

### Changed

- **Boolean playlist attributes follow one rule: present means true unless it
  is `"false"`.** `data-continuous` and `data-show-chapter-markers` previously
  required the literal `"true"`; a bare `data-continuous` now enables it, as
  `data-expand-chapters` and friends always did.
- **Chapters are sorted by time.** Out-of-order markup rendered out of order
  and confused the active-chapter scan. The playlist now also warns
  (`[WaveformPlaylist] …`) about a chapter with no `data-time` (placed at
  0:00) and, once the duration is known, one that starts after the track ends.
- **Peer dependency raised to `@arraypress/waveform-player@^1.24.5`** (was
  `^1.7.2`, which it had long since outgrown). The playlist relies on
  `onNextTrack`/`onPreviousTrack` (1.19.0), `loadTrack()` adding and removing
  artist/artwork in place (1.21.0), `crossOrigin` (1.23.0), and — new with the
  chapter-seek fix above — `load()` reporting `onLoad` under `preload: 'none'`
  instead of hanging (1.24.5).

## [1.7.4] — 2026-08-11

### Fixed

- **The playlist no longer leaks its own `layout` into the embedded player.**
  Both components read options from the same container and the same `data-*`
  namespace, and `layout` exists in both surfaces with different vocabularies —
  the playlist's is `list | minimal | hero | grid`, the player's is
  `default | preview`. `initPlayer()` spread the playlist's whole option object
  into the player, so a hero playlist handed the player a layout it has never
  supported. Harmless in appearance (the player fell back to `default`, which is
  what it silently did before) but it printed
  `[WaveformPlayer] Invalid layout option, using default: hero` on every hero
  playlist once core 1.25.0 began validating enumerated options. Playlist-owned
  options are now stripped before forwarding.

## [1.7.3] — 2026-08-11

### Fixed

- **One malformed `data-markers` no longer takes the whole playlist down.**
  `parseTracks()` read every track's attribute through a bare `JSON.parse`, and
  it runs before anything is rendered — so a single syntax error anywhere in the
  markup threw and destroyed the playlist rather than costing that one track its
  markers. Markers are now parsed defensively and shape-checked: `JSON.parse`
  validates syntax only, so `'2'` or `'"x"'` parsed cleanly and then failed at
  the first `.length`/`.map()` downstream. Entries whose `time` isn't a number
  are dropped instead of rendering at `left: NaN%`.
- **Unparseable numeric attributes are no longer forwarded to the player.**
  `data-height="tall"` became `NaN`, which sizes the player's canvas to nothing —
  a broken-looking player from a typo'd attribute. Bad values now leave the
  default in place and warn, naming the attribute.
- **`data-playback-rates` must be a JSON array.** Non-array JSON was forwarded
  verbatim and threw inside the player's speed menu.
- **A mistyped chapter `data-time` reads as 0 rather than NaN.** `parseTime`
  returned `NaN` for the two-part form (`"1:ab"`), which then rendered as `NaN`
  in the chapter list and positioned its marker at `left: NaN%`.

## [1.7.2] — 2026-07-22

### Added

- **`crossOrigin` player option is forwarded.** Container `data-cross-origin`
  (and the `crossOrigin` option) now flow to each track's player. The modern
  path already forwarded it verbatim through `WaveformPlayer.utils.parseDataAttributes`;
  this adds it to the legacy fallback parser too, so it works regardless of the
  installed core version. Requires `@arraypress/waveform-player@^1.23.0` for the
  option to take effect.

## [1.7.1] — 2026-07-17

### Fixed

- **The play glyph on cover art is now legible at rest.** The hero cover doubles
  as the transport, and its overlay rested at `rgba(0, 0, 0, 0.22)` — only
  **1.69:1** against a light cover, well under WCAG 1.4.11's 3:1 minimum for
  non-text contrast. The glyph was effectively invisible until you hovered it,
  at which point the overlay deepened to `0.5` and became readable: the resting
  state, which is what everyone actually sees, was the unsafe one. The grid
  item's overlay had the same problem less severely (`0.4` → 2.85:1), and it
  stays up for the *active* item rather than only on hover.

  Both now rest at a scrim that clears 3:1 over any cover, and hover deepens
  from an already-safe floor instead of rescuing an unsafe one. The colours moved
  to `--wp-cover-overlay-color` / `--wp-cover-overlay-scrim` /
  `--wp-cover-overlay-scrim-hover`, mirroring `--wfp-btn-artwork-*` in
  `@arraypress/waveform-player` — re-theme the scrim and glyph together, or the
  contrast guarantee goes with it. A test recomputes the worst case from the
  declared values and fails below 3:1.

## [1.7.0] — 2026-07-01

### Added

- **Lock-screen skip-track buttons.** Wires `onNextTrack` / `onPreviousTrack` to
  the playlist's track navigation, so the OS Media Session next/previous controls
  move between tracks. (Needs `@arraypress/waveform-player` >= 1.19.)

## [1.6.0] — 2026-07-01

### Changed

- **BREAKING — renamed `subtitle` -> `artist`** on tracks and the embedded
  player (`data-subtitle` -> `data-artist`, `showSubtitle` -> `showArtist`,
  `.wp-subtitle` -> `.wp-artist`). No back-compat alias.

## [1.5.1] — 2026-06-30

### Fixed

- **List/minimal now-playing header had no spacing — it touched the track
  list.** The core player reclasses its container to `waveform-player` on init,
  which clobbered the `wp-player` hook the list-layout CSS targets, so the
  header's styling (including its bottom margin) silently never applied. The
  class is now restored after the player mounts, and the header carries a small
  bottom margin so it sits cleanly above the list.

## [1.5.0] — 2026-06-30

### Added

- **Artwork fallback.** Track artwork that fails to load (404 / broken) now
  shows a muted music-note placeholder in the hero cover, queue thumbnails and
  grid cards instead of the browser's broken-image icon.

### Fixed

- **`density` and `showArtist` now apply to the list / minimal layouts**, not
  only hero / grid. `density: 'compact'` tightens list rows (the compact CSS
  already covered `.wp-item`; the class just wasn't being added for list), and
  `showArtist: false` hides the now-playing and per-row artists. Also gave
  the list-layout now-playing header a little more bottom margin.
- **`new WaveformPlaylist(...)` from the IIFE/CDN build.** The browser bundle was
  built with esbuild `--global-name=WaveformPlaylist`, which wrapped the exports
  so `window.WaveformPlaylist` resolved to the ES-module *namespace*
  (`{ default, WaveformPlaylist }`) rather than the class — so manual
  construction (`new WaveformPlaylist('#el', { ... })`, as the docs show) threw
  "not a constructor". Dropped `--global-name` so the bundle's own
  `window.WaveformPlaylist = WaveformPlaylist` (the class, with its static
  `init`) stands, matching `@arraypress/waveform-player`. Auto-init and
  `WaveformPlaylist.init()` are unaffected.

- **Light-mode rendering.** The list / hero / grid surfaces built their hover,
  active-row and chapter-panel highlights from fixed `rgba(255,255,255,…)` and
  `rgba(0,0,0,…)` overlays that assumed a dark background — so on a light page
  the chapter panel and active states rendered as muddy grey slabs. Those
  page-surface overlays are now `color-mix(in srgb, currentColor …, transparent)`,
  which adapts to the surrounding text colour (near-identical on dark, correct on
  light). Artwork play-overlays stay dark — they sit over cover images.

## [1.4.0] — 2026-06-30

### Added

- **`hero` layout** (`layout="hero"`) — a "now playing" unit (cover artwork that
  doubles as the play/pause button, immediately beside the waveform, with a
  title/artist + current/total time meta row) over a stripped track queue. The
  active track lives only in the hero and the queue carries titles, so nothing is
  shown twice.
- **`grid` layout** (`layout="grid"`) — a responsive grid of cover-art cards to
  browse, with a slim "now playing" bar (waveform + title/time) docked above or
  below it. The active card is ringed.
- **Chapters in the hero layout.** A single chaptered track renders a seekable
  chapter list beneath the hero with chapter markers on the waveform; a
  multi-track playlist expands the active track's row to reveal its chapters
  (and shows that track's markers when `showChapterMarkers` is on).
- **Sizing + style options**, all settable via `data-*` or JS:
  - `coverSize` / `thumbnailSize` (px) — hero cover + queue/grid artwork size
    (`thumbnailSize` is also exposed as the `--wp-thumb-size` CSS variable).
  - `density` (`'comfortable'` | `'compact'`) — row spacing.
  - `coverPosition` (`'left'` | `'top'`) — hero cover beside or above the waveform.
  - `barPosition` (`'top'` | `'bottom'`) — grid's now-playing bar placement.
  - `showArtist` (boolean) — show/hide the now-playing artist.

### Changed

- **Clicking the active track row/card now toggles play/pause** (matching the
  play/pause icon it shows) instead of restarting from the top. Clicking a
  different track still loads and plays it from the start.
- `togglePlay()` reads the embedded audio element's `paused` state directly, so
  pausing is reliable even though the hero/grid player runs without its built-in
  controls.

### Notes

- Requires `@arraypress/waveform-player` `^1.7.2` (peer dependency). The hero and
  grid layouts embed a single waveform-only player and supply their own cover,
  time and queue chrome.
