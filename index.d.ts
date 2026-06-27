/**
 * Type definitions for @arraypress/waveform-playlist
 * Playlist and chapter navigation for @arraypress/waveform-player
 */

/**
 * A chapter parsed from `[data-chapter]` markup within a track.
 */
export interface WaveformPlaylistChapter {
    /** Chapter start time in seconds. */
    time: number;
    /** Chapter label text. */
    label: string;
    /** Optional marker colour for this chapter. */
    color?: string;
    /** The source element the chapter was parsed from. */
    element?: HTMLElement;
}

/**
 * A waveform marker (either explicit, via `data-markers`, or derived from a
 * track's chapters).
 */
export interface WaveformPlaylistMarker {
    time: number;
    label?: string;
    color?: string;
}

/**
 * A track parsed from `[data-track]` markup.
 */
export interface WaveformPlaylistTrack {
    /** The source element the track was parsed from. */
    element: HTMLElement | null;
    /** Zero-based index of the track in the playlist. */
    index: number;
    /** Audio file URL. */
    url?: string;
    /** Track title. */
    title: string;
    /** Track subtitle. */
    subtitle: string;
    /** Artwork image URL. */
    artwork?: string;
    /** Album name. */
    album?: string;
    /** Human-readable duration (e.g. "3:45"). */
    duration?: string;
    /** Chapters belonging to this track. */
    chapters: WaveformPlaylistChapter[];
    /** Explicit markers parsed from `data-markers`. */
    markers: WaveformPlaylistMarker[];
}

/**
 * Configuration options for {@link WaveformPlaylist}.
 *
 * Playlist-specific options are typed explicitly below. Any other option is
 * forwarded straight to the underlying WaveformPlayer instance (e.g. `height`,
 * `waveformStyle`, `colorPreset`, `barWidth`, `autoplay`, ...).
 */
export interface WaveformPlaylistOptions {
    /** Layout style. Defaults to `'list'`. */
    layout?: 'list' | 'minimal';
    /** Auto-advance to the next track when one ends. Defaults to `false`. */
    continuous?: boolean;
    /** Show chapters under tracks. Defaults to `true`. */
    expandChapters?: boolean;
    /** Display track durations. Defaults to `true`. */
    showDuration?: boolean;
    /**
     * Show chapters as waveform markers. `null` (the default) lets the
     * playlist decide based on content.
     */
    showChapterMarkers?: boolean | null;
    /** Default colour for chapter markers. */
    chapterMarkerColor?: string;
    /** Show a play/pause icon on the active track artwork. Defaults to `true`. */
    showPlayState?: boolean;

    /** Any additional WaveformPlayer option is passed through. */
    [option: string]: unknown;
}

/**
 * Playlist and chapter navigation for WaveformPlayer.
 */
export class WaveformPlaylist {
    /**
     * Create a new WaveformPlaylist instance.
     *
     * @param container Container element or CSS selector.
     * @param options Configuration options.
     * @throws If the container is not found or WaveformPlayer is unavailable.
     */
    constructor(container: string | HTMLElement, options?: WaveformPlaylistOptions);

    /** The resolved container element. */
    container: HTMLElement;
    /** Merged configuration options. */
    options: WaveformPlaylistOptions;
    /** Parsed tracks. */
    tracks: WaveformPlaylistTrack[];
    /** Index of the currently selected track. */
    currentTrackIndex: number;
    /** Index of the active chapter, or -1 when none. */
    currentChapterIndex: number;
    /** The underlying WaveformPlayer instance, or `null` before init. */
    player: unknown | null;
    /** Whether playback is currently active. */
    isPlaying: boolean;

    /**
     * Select and load a track by index.
     * @param index Track index to select.
     */
    selectTrack(index: number): void;

    /**
     * Seek to a chapter within a track. If the chapter lives on a different
     * track, the track is loaded first and the seek runs once it is ready.
     * @param trackIndex Track index.
     * @param time Time in seconds to seek to.
     */
    seekToChapter(trackIndex: number, time: number): void;

    /** Navigate to the next track (if any). */
    nextTrack(): void;

    /** Navigate to the previous track (if any). */
    previousTrack(): void;

    /** Get the underlying WaveformPlayer instance, or `null`. */
    getPlayer(): unknown | null;

    /** Get the index of the currently selected track. */
    getCurrentTrackIndex(): number;

    /** Get all parsed tracks. */
    getTracks(): WaveformPlaylistTrack[];

    /** Destroy the playlist, remove listeners, and restore original markup. */
    destroy(): void;

    /**
     * Auto-initialize every element with a `data-waveform-playlist` attribute.
     */
    static init(): void;
}

export default WaveformPlaylist;

declare global {
    interface Window {
        WaveformPlaylist: typeof WaveformPlaylist;
    }
}
