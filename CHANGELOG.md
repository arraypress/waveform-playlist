# Changelog

All notable changes to `@arraypress/waveform-playlist` are documented here. The
format is based on [Keep a Changelog](https://keepachangelog.com/) and this
project adheres to [Semantic Versioning](https://semver.org/).

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
