# Changelog

All notable changes to `@arraypress/waveform-playlist` are documented here. The
format is based on [Keep a Changelog](https://keepachangelog.com/) and this
project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
