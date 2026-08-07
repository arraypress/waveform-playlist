# CLAUDE.md — @arraypress/waveform-playlist

Multi-track playlist built on `@arraypress/waveform-player`. Parses `[data-track]`
markup into tracks/chapters/markers and drives one embedded player.

## Commands
- `npm test` — vitest (run before committing).
- `npm run build` — iife + esm + min + css. `prepublishOnly` runs it.
- `npm run size`, `npm run dev` — as elsewhere in the family.

## The rule that matters: two parsers, one is easy to miss

Player options reach the embedded player by **two** paths:

1. **Modern** — core's `parseDataAttributes` handles it. **No edit needed here.**
2. **Legacy fallback** — a hand-rolled parser in `src/js/index.js` (~line 191,
   the `str('waveformStyle'); int('barWidth'); …` block) that runs against older
   cores. A new option needs `str('<key>')` / `int` / `bool` / `float` added there.

Because path 1 works on a current core, forgetting path 2 passes every local test
and only breaks for users pinned to an older `@arraypress/waveform-player`.
If only the fallback parser changed, that's a **patch** release.

## Layout
- `src/js/index.js` — the whole library (single file: parsing, DOM, playlist logic).
- `index.d.ts` — **hand-written**; owns `WaveformPlaylistOptions` and the parsed
  track/chapter/marker shapes. The four `waveform-playlist-*` wrappers derive their
  types from it *and* from `waveform-player`'s.

## Conventions
- Peer dep on `@arraypress/waveform-player@^1.x`; `dist/` is committed.
- Logging prefix `[WaveformPlaylist]`.

## Cross-repo
The four `waveform-playlist-*` wrappers do **not** inherit runtime forwarding from
this package — each needs its own edit. They were missed in the `crossOrigin`
release. Load the `waveform-release` skill for the full checklist.
