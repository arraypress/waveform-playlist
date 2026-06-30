# Changelog

All notable changes to `@arraypress/waveform-playlist` are documented here. The
format is based on [Keep a Changelog](https://keepachangelog.com/) and this
project adheres to [Semantic Versioning](https://semver.org/).

## [1.5.0] — 2026-06-30

### Added

- **Artwork fallback.** Track artwork that fails to load (404 / broken) now
  shows a muted music-note placeholder in the hero cover, queue thumbnails and
  grid cards instead of the browser's broken-image icon.

### Fixed

- **`density` and `showSubtitle` now apply to the list / minimal layouts**, not
  only hero / grid. `density: 'compact'` tightens list rows (the compact CSS
  already covered `.wp-item`; the class just wasn't being added for list), and
  `showSubtitle: false` hides the now-playing and per-row subtitles. Also gave
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
  title/subtitle + current/total time meta row) over a stripped track queue. The
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
  - `showSubtitle` (boolean) — show/hide the now-playing subtitle.

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
