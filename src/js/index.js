/**
 * WaveformPlaylist
 * Playlist and chapter navigation for WaveformPlayer
 *
 * @version 1.0.0
 * @author ArrayPress
 * @license MIT
 */

/**
 * Placeholder shown when a track's artwork URL fails to load (404 / broken) — a
 * muted music-note tile instead of the browser's broken-image icon. Inline SVG
 * data-URI (no font / network needed).
 */
const ARTWORK_FALLBACK = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="4" fill="#71717a" fill-opacity="0.15"/><g fill="none" stroke="#a1a1aa" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="17" r="2.2"/><circle cx="17" cy="15" r="2.2"/><path d="M10.2 17V7l9-1.6v9"/></g></svg>'
);

/** Swap a broken artwork `<img>` for the placeholder tile on load failure. */
function applyArtFallback(img) {
    img.addEventListener('error', () => {
        if (!img.src.startsWith('data:')) img.src = ARTWORK_FALLBACK;
    });
}

/**
 * WaveformPlaylist Class
 * Adds playlist and chapter navigation capabilities to WaveformPlayer
 *
 * @class WaveformPlaylist
 */
export class WaveformPlaylist {
    /**
     * Create a new WaveformPlaylist instance
     *
     * @param {string|HTMLElement} container - Container element or CSS selector
     * @param {Object} [options={}] - Configuration options
     * @param {string} [options.layout='list'] - Layout style: 'list' or 'minimal'
     * @param {boolean} [options.continuous=false] - Auto-advance to next track
     * @param {boolean} [options.expandChapters=true] - Show chapters under tracks
     * @param {boolean} [options.showDuration=true] - Display track durations
     * @param {boolean|null} [options.showChapterMarkers=null] - Show chapters as waveform markers (null = smart default)
     * @param {string} [options.chapterMarkerColor='rgba(161, 161, 170, 0.85)'] - Default color for chapter markers
     * @param {boolean} [options.showPlayState=true] - Show play/pause icon on active track artwork
     * @throws {Error} If container not found or WaveformPlayer not available
     */
    constructor(container, options = {}) {
        // Resolve container
        this.container = typeof container === 'string'
            ? document.querySelector(container)
            : container;

        if (!this.container) {
            throw new Error('[WaveformPlaylist] Container element not found');
        }

        // Check for WaveformPlayer dependency
        if (typeof window.WaveformPlayer === 'undefined') {
            throw new Error('[WaveformPlaylist] WaveformPlayer is required but not found');
        }

        // Parse options from data attributes and merge with provided options
        this.options = this.parseOptions(options);

        // Initialize state
        this.tracks = [];
        this.currentTrackIndex = 0;
        this.currentChapterIndex = -1;
        this.player = null;
        this.listElement = null;
        this.isMinimal = this.options.layout === 'minimal';
        this.isHero = this.options.layout === 'hero';
        this.isGrid = this.options.layout === 'grid';
        this.isPlaying = false;
        this.keydownHandler = null;

        // Parse tracks from markup
        this.parseTracks();

        // Initialize if we have tracks
        if (this.tracks.length > 0) {
            this.init();
        }
    }

    /**
     * Parse options from container data attributes and merge with provided options
     * @private
     * @param {Object} providedOptions - Options passed to constructor
     * @returns {Object} Merged options object
     */
    parseOptions(providedOptions) {
        const container = this.container;
        const options = {...providedOptions};

        // Inherit the player's full `data-*` option surface from the container.
        // data-* values take precedence over constructor options (as before).
        const fromData = this.parsePlayerDataAttributes(container);
        // Strip keys the playlist owns or sets per-track, so a container-level
        // data-* can never override them: audioMode (the playlist drives a
        // self-mode player) and the per-track content fields.
        ['audioMode', 'url', 'title', 'artist', 'album', 'artwork', 'markers', 'waveform']
            .forEach(key => delete fromData[key]);
        Object.assign(options, fromData);

        // Playlist-specific options
        options.layout = container.dataset.layout || options.layout || 'list';
        options.continuous = container.dataset.continuous === 'true' || options.continuous || false;
        options.expandChapters = container.dataset.expandChapters !== 'false';
        options.showDuration = container.dataset.showDuration !== 'false';
        options.showPlayState = container.dataset.showPlayState !== 'false';
        // Hero layout: show the now-playing artist. On by default (useful for
        // mixed-artist playlists); set false for single-artist albums where it
        // would just repeat. Honours a JS `{ showArtist: false }` too.
        options.showArtist = options.showArtist !== false && container.dataset.showArtist !== 'false';

        // Hero/grid sizing (px) — null falls back to the derived/CSS default.
        options.coverSize = parseInt(container.dataset.coverSize, 10) || options.coverSize || null;
        options.thumbnailSize = parseInt(container.dataset.thumbnailSize, 10) || options.thumbnailSize || null;
        // Row density ('comfortable' | 'compact') and hero cover position
        // ('left' | 'top').
        options.density = container.dataset.density || options.density || 'comfortable';
        options.coverPosition = container.dataset.coverPosition || options.coverPosition || 'left';
        // Grid layout: place the now-playing bar above or below the cover grid.
        options.barPosition = container.dataset.barPosition || options.barPosition || 'bottom';

        // Smart defaults for chapter markers
        if (container.dataset.showChapterMarkers !== undefined) {
            options.showChapterMarkers = container.dataset.showChapterMarkers === 'true';
        } else {
            options.showChapterMarkers = null; // Will be determined by content
        }

        options.chapterMarkerColor = container.dataset.chapterMarkerColor || 'rgba(161, 161, 170, 0.85)';

        return options;
    }

    /**
     * Read the player's `data-*` option surface off the container.
     *
     * Prefers the core's own parser (`WaveformPlayer.utils.parseDataAttributes`)
     * so the playlist inherits the complete, current contract and never drifts
     * as the player gains options. Falls back to a local parser only for cores
     * older than the one that exposes the bridge helper.
     *
     * @private
     * @param {HTMLElement} container - The playlist container element
     * @returns {Object} Sparse player options parsed from the container's data-*
     */
    parsePlayerDataAttributes(container) {
        const utils = typeof window !== 'undefined'
            && window.WaveformPlayer && window.WaveformPlayer.utils;
        if (utils && typeof utils.parseDataAttributes === 'function') {
            // Single source of truth — let the core parse its own contract.
            return {...utils.parseDataAttributes(container)};
        }
        return this.parsePlayerDataAttributesFallback(container);
    }

    /**
     * Container-level `data-*` parser used only with cores that predate
     * `WaveformPlayer.utils.parseDataAttributes`. Mirrors the player's
     * container-relevant options with correct dataset keys and per-key coercion.
     *
     * Note: the dataset key for `data-show-bpm` is `showBpm`, which maps to the
     * `showBPM` option. Reading `dataset.showBPM` would target the wrong
     * attribute (`data-show-b-p-m`) and silently drop the flag.
     *
     * @private
     * @param {HTMLElement} container - The playlist container element
     * @returns {Object} Sparse player options parsed from the container's data-*
     */
    parsePlayerDataAttributesFallback(container) {
        const ds = container.dataset;
        const opts = {};
        const str = (k, o = k) => { if (ds[k] !== undefined) opts[o] = ds[k]; };
        const bool = (k, o = k) => {
            if (ds[k] === 'true') opts[o] = true;
            else if (ds[k] === 'false') opts[o] = false;
        };
        // Numeric attributes are only forwarded when they actually parsed — a
        // NaN reaching the player sizes its canvas to nothing, which reads as a
        // broken player rather than a bad attribute.
        const num = (k, o, parse) => {
            if (!ds[k]) return;
            const n = parse(ds[k]);
            if (Number.isFinite(n)) opts[o] = n;
            else console.warn(`[WaveformPlaylist] Invalid ${k} attribute, expected a number:`, ds[k]);
        };
        const int = (k, o = k) => num(k, o, (v) => parseInt(v, 10));
        const float = (k, o = k) => num(k, o, parseFloat);
        // JSON.parse validates syntax, not shape: '2' and '{"a":1}' parse
        // cleanly and then throw at the first .map() downstream. Require the
        // array the option is documented to be.
        const jsonArray = (k, o = k) => {
            if (!ds[k]) return;
            let parsed;
            try { parsed = JSON.parse(ds[k]); }
            catch (e) {
                console.warn(`[WaveformPlaylist] Invalid ${k} JSON:`, e);
                return;
            }
            if (Array.isArray(parsed)) opts[o] = parsed;
            else console.warn(`[WaveformPlaylist] Invalid ${k} attribute, expected a JSON array:`, ds[k]);
        };

        // Layout / sizing
        str('waveformStyle'); int('barWidth'); int('barSpacing'); int('barRadius');
        str('buttonAlign'); int('height'); int('samples'); str('preload'); str('crossOrigin');
        // Colours
        str('colorPreset'); str('waveformColor'); str('progressColor'); str('buttonColor');
        str('buttonHoverColor'); str('textColor'); str('textSecondaryColor');
        str('backgroundColor'); str('borderColor');
        // Feature flags
        bool('autoplay'); bool('showControls'); bool('showInfo'); bool('showTime');
        bool('showHoverTime'); bool('showBpm', 'showBPM'); bool('singlePlay'); bool('playOnSeek');
        bool('showPlaybackSpeed'); bool('enableMediaSession'); bool('showMarkers'); bool('accessibleSeek');
        // Playback
        float('playbackRate'); jsonArray('playbackRates');
        // Accessibility / labels / icons
        str('seekLabel'); str('errorText'); str('playIcon'); str('pauseIcon');

        return opts;
    }

    /**
     * Parse a track's `data-markers` attribute into renderable markers.
     *
     * Every track's attribute is read during `parseTracks()`, which runs before
     * anything is rendered — so an unguarded parse here meant one malformed
     * `data-markers` anywhere in the markup threw and took the whole playlist
     * down with it. Bad input now costs that one track its markers and warns.
     *
     * Entries are shape-checked as well as parsed: `JSON.parse` validates
     * syntax only, so `'2'` or `'"x"'` parse cleanly and then fail at the first
     * `.length`/`.map()` downstream, and a marker whose `time` isn't a number
     * renders at `left: NaN%`.
     *
     * @private
     * @param {string|undefined} raw - Raw `data-markers` value.
     * @returns {Array<Object>} Renderable markers (empty when nothing survives).
     */
    parseMarkers(raw) {
        if (!raw) return [];

        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (e) {
            console.warn('[WaveformPlaylist] Invalid markers JSON:', e);
            return [];
        }

        if (!Array.isArray(parsed)) {
            console.warn('[WaveformPlaylist] Invalid markers attribute, expected a JSON array:', raw);
            return [];
        }

        return parsed
            .map(m => (m && typeof m === 'object') ? {...m, time: Number(m.time)} : null)
            .filter(m => m && Number.isFinite(m.time));
    }

    /**
     * Parse tracks and chapters from container markup
     * @private
     */
    parseTracks() {
        const trackElements = this.container.querySelectorAll('[data-track]');

        this.tracks = Array.from(trackElements).map((el, index) => {
            // Parse chapters from child elements
            const chapters = Array.from(el.querySelectorAll('[data-chapter]')).map(ch => ({
                time: this.parseTime(ch.dataset.time || '0:00'),
                label: ch.textContent.trim(),
                color: ch.dataset.color,
                element: ch
            }));

            return {
                element: el,
                index: index,
                url: el.dataset.url,
                title: el.dataset.title || this.extractTitleFromUrl(el.dataset.url),
                artist: el.dataset.artist || '',
                artwork: el.dataset.artwork,
                album: el.dataset.album,
                duration: el.dataset.duration,
                chapters: chapters,
                // Parse explicit markers if provided (separate from chapters)
                markers: this.parseMarkers(el.dataset.markers)
            };
        });
    }

    /**
     * Initialize the playlist UI and player
     * @private
     */
    init() {
        // Add classes to container
        this.container.classList.add('waveform-playlist');
        if (this.isMinimal) {
            this.container.classList.add('wp-minimal');
        }
        // Hero + grid share the "now playing" hero unit; they differ only in the
        // browser below it (a queue list vs a cover-art grid).
        if (this.isHero || this.isGrid) {
            this.container.classList.add('wp-hero-layout');
        }
        if (this.isGrid) {
            this.container.classList.add('wp-grid-layout');
        }
        // Density applies to every layout (the compact CSS covers list rows,
        // queue rows, grid cards and chapters alike).
        if (this.options.density === 'compact') {
            this.container.classList.add('wp-density-compact');
        }
        if ((this.isHero || this.isGrid) && this.options.coverPosition === 'top') {
            this.container.classList.add('wp-cover-top');
        }
        // `showArtist` also applies to the list/minimal layouts: hero/grid skip
        // rendering the artist element, while list relies on this class to hide
        // the now-playing + per-row artists via CSS.
        if (!this.options.showArtist) {
            this.container.classList.add('wp-no-artist');
        }

        // Hide original track elements
        this.tracks.forEach(track => {
            if (track.element) {
                track.element.style.display = 'none';
            }
        });

        // Create player container
        const playerContainer = document.createElement('div');
        playerContainer.className = (this.isHero || this.isGrid) ? 'wp-hero-stage' : 'wp-player';
        playerContainer.id = 'wp-player-' + this.generateId();

        if (this.isGrid && !(this.tracks.length === 1 && this.tracks[0].chapters.length > 0)) {
            // Grid layout: a cover-art grid to browse, with a "now playing" bar
            // (cover + waveform + title/time) above OR below it as the transport.
            // The active card is ringed; nothing is shown as a big hero.
            if (this.options.barPosition === 'top') {
                this.createNowPlayingBar(playerContainer);
                this.createHeroGrid();
            } else {
                this.createHeroGrid();
                this.createNowPlayingBar(playerContainer);
            }
        } else if (this.isHero || this.isGrid) {
            // Hero layout: a "now playing" unit — cover (with play/pause overlay)
            // beside the waveform + a time readout — over a browser of the other
            // tracks (a stripped queue, or, for a single chaptered track, the
            // chapter list). The waveform is a real WaveformPlayer; the cover,
            // time and browser are this component's chrome, so the active track
            // is never shown twice.
            this.createHeroLayout(playerContainer);
            if (this.tracks.length === 1 && this.tracks[0].chapters.length > 0) {
                // Single chaptered track: the area below the hero becomes the
                // seekable chapter list, and the waveform shows chapter markers
                // (converted from chapters in initPlayer).
                this.createChapterList();
            } else {
                this.createHeroQueue();
            }
        } else {
            this.container.appendChild(playerContainer);

            // Create appropriate UI based on content
            if (this.tracks.length === 1 && this.tracks[0].chapters.length > 0) {
                // Single track with chapters - show chapters only (no track list)
                this.createChapterList();
            } else if (this.isMinimal) {
                // Minimal layout - show buttons
                this.createMinimalControls();
            } else {
                // Multiple tracks - show full track list
                this.createTrackList();
            }
        }

        // Initialize WaveformPlayer instance
        this.initPlayer(playerContainer);

        // Bind keyboard shortcuts
        this.bindKeyboard();
    }

    /**
     * Build the hero "now playing" unit: a cover that doubles as the play/pause
     * button, immediately left of the waveform stage, with a current/total time
     * readout beneath the waveform.
     * @private
     * @param {HTMLElement} stage - The container the WaveformPlayer renders into.
     */
    createHeroLayout(stage) {
        const first = this.tracks[0];

        const hero = document.createElement('div');
        hero.className = 'wp-hero';

        // The cover IS the transport — clicking it toggles play/pause. Size it
        // explicitly (coverSize option, else ~waveform height + the time line)
        // so it sits flush with the waveform column and never balloons to the
        // artwork's native size.
        const coverSize = (this.options.coverSize || ((this.options.height || 56) + 36)) + 'px';
        const cover = document.createElement('button');
        cover.type = 'button';
        cover.className = 'wp-hero-cover';
        cover.style.width = coverSize;
        cover.style.height = coverSize;
        cover.setAttribute('aria-label', 'Play');

        if (first.artwork) {
            const img = document.createElement('img');
            img.className = 'wp-hero-art';
            img.alt = '';
            img.src = first.artwork;
            applyArtFallback(img);
            cover.appendChild(img);
            this.heroArt = img;
        }

        const overlay = document.createElement('span');
        overlay.className = 'wp-hero-overlay';
        const icon = document.createElement('i');
        icon.className = 'ti ti-player-play';
        icon.setAttribute('aria-hidden', 'true');
        overlay.appendChild(icon);
        cover.appendChild(overlay);
        cover.addEventListener('click', () => this.togglePlay());
        this.heroCover = cover;
        this.heroIcon = icon;
        hero.appendChild(cover);

        // Waveform stage + time readout.
        const main = document.createElement('div');
        main.className = 'wp-hero-main';
        main.appendChild(stage);

        // Meta row beneath the waveform: now-playing title/artist on the
        // left, current/total time on the right.
        const meta = document.createElement('div');
        meta.className = 'wp-hero-meta';

        const titles = document.createElement('div');
        titles.className = 'wp-hero-titles';
        const titleEl = document.createElement('span');
        titleEl.className = 'wp-hero-title';
        titleEl.textContent = first.title || '';
        titles.appendChild(titleEl);
        this.heroTitle = titleEl;
        // Artist is optional (showArtist); when on it's always present so a
        // later track's artist can fill in (an empty one is hidden via CSS).
        if (this.options.showArtist) {
            const subEl = document.createElement('span');
            subEl.className = 'wp-hero-sub';
            subEl.textContent = first.artist || '';
            titles.appendChild(subEl);
            this.heroSub = subEl;
        }
        meta.appendChild(titles);

        const time = document.createElement('div');
        time.className = 'wp-hero-time';
        time.textContent = '0:00 / ' + (first.duration || '0:00');
        this.heroTime = time;
        meta.appendChild(time);

        main.appendChild(meta);

        hero.appendChild(main);
        this.container.appendChild(hero);
    }

    /**
     * Build the slim "now playing" transport bar for the grid layout: a small
     * cover (play/pause) + title + waveform + time, in one row below the
     * cover-art grid. Shares the hero* refs so updatePlayState / setActiveTrack
     * / updateHeroTime drive it just like the hero.
     * @private
     * @param {HTMLElement} stage - The container the WaveformPlayer renders into.
     */
    createNowPlayingBar(stage) {
        const first = this.tracks[0];

        const bar = document.createElement('div');
        bar.className = 'wp-now-bar';

        // No cover here — the grid cards carry the artwork + play/pause. The bar
        // is just the waveform with a title/time meta row beneath it.
        bar.appendChild(stage);

        // Meta row below the waveform: title/artist on the left, time on the
        // right (full width, so the title is never clipped).
        const meta = document.createElement('div');
        meta.className = 'wp-now-meta';

        const titles = document.createElement('div');
        titles.className = 'wp-now-titles';
        const titleEl = document.createElement('span');
        titleEl.className = 'wp-hero-title';
        titleEl.textContent = first.title || '';
        titles.appendChild(titleEl);
        this.heroTitle = titleEl;
        if (this.options.showArtist) {
            const subEl = document.createElement('span');
            subEl.className = 'wp-hero-sub';
            subEl.textContent = first.artist || '';
            titles.appendChild(subEl);
            this.heroSub = subEl;
        }
        meta.appendChild(titles);

        const time = document.createElement('div');
        time.className = 'wp-hero-time';
        time.textContent = '0:00 / ' + (first.duration || '0:00');
        this.heroTime = time;
        meta.appendChild(time);

        bar.appendChild(meta);

        if (this.options.barPosition === 'top') bar.classList.add('wp-now-bar-top');
        this.container.appendChild(bar);
    }

    /**
     * Build the stripped queue beneath the hero: numbered rows of title +
     * duration only (no covers, no waveform, no artist), with the active row
     * marked. Reuses the `.wp-item` / `wp-active` machinery the rest of the
     * component already drives.
     * @private
     */
    createHeroQueue() {
        const listContainer = document.createElement('div');
        listContainer.className = 'wp-list-container wp-queue';
        if (this.options.thumbnailSize) {
            listContainer.style.setProperty('--wp-thumb-size', this.options.thumbnailSize + 'px');
        }

        const list = document.createElement('ul');
        list.className = 'wp-list';

        this.tracks.forEach((track, index) => {
            const item = document.createElement('li');
            item.className = 'wp-item wp-queue-item';
            item.dataset.index = index;

            // Leading slot: an artwork thumbnail with a play/pause overlay
            // (shown on hover + on the active row), or a track number when the
            // track has no artwork. The `.wp-queue-state` icon reflects play
            // state and is driven by updatePlayState().
            if (track.artwork) {
                const thumb = document.createElement('div');
                thumb.className = 'wp-queue-thumb';
                const img = document.createElement('img');
                img.className = 'wp-queue-thumb-art';
                img.src = track.artwork;
                img.alt = '';
                applyArtFallback(img);
                thumb.appendChild(img);
                const overlay = document.createElement('span');
                overlay.className = 'wp-queue-ov';
                const ic = document.createElement('i');
                ic.className = 'wp-queue-state ti ti-player-play';
                ic.setAttribute('aria-hidden', 'true');
                overlay.appendChild(ic);
                thumb.appendChild(overlay);
                item.appendChild(thumb);
            } else {
                const num = document.createElement('span');
                num.className = 'wp-num';
                num.setAttribute('aria-hidden', 'true');
                num.textContent = index + 1;
                item.appendChild(num);
                const ic = document.createElement('i');
                ic.className = 'wp-queue-state wp-queue-state-num ti ti-player-play';
                ic.setAttribute('aria-hidden', 'true');
                item.appendChild(ic);
            }

            const info = document.createElement('div');
            info.className = 'wp-info';
            const title = document.createElement('div');
            title.className = 'wp-title';
            title.textContent = track.title;
            info.appendChild(title);
            item.appendChild(info);

            if (this.options.showDuration && track.duration) {
                const duration = document.createElement('span');
                duration.className = 'wp-duration';
                duration.textContent = track.duration;
                item.appendChild(duration);
            }

            // Clicking the active row toggles play/pause (matching the icon it
            // shows); clicking any other row loads + plays that track from 0.
            this.makeActivatable(item, () => {
                if (index === this.currentTrackIndex) {
                    this.togglePlay();
                } else {
                    this.selectTrack(index);
                }
            });

            list.appendChild(item);

            // Expandable chapters beneath the row (revealed for the active
            // track) — multi-track playlists that also carry chapters.
            const sub = this.buildChapterSublist(track, index);
            if (sub) list.appendChild(sub);
        });

        listContainer.appendChild(list);
        this.container.appendChild(listContainer);
        this.listElement = list;
    }

    /**
     * Build the cover-art grid beneath the hero (layout="grid"). Each card is a
     * cover with a play/pause overlay + a title; clicking it plays from the
     * start. Reuses the active-track (.wp-item / wp-active) and play-state
     * (.wp-queue-state) machinery the hero already drives.
     * @private
     */
    createHeroGrid() {
        const gridContainer = document.createElement('div');
        gridContainer.className = 'wp-grid';
        if (this.options.thumbnailSize) {
            gridContainer.style.setProperty('--wp-grid-cover', this.options.thumbnailSize + 'px');
        }

        this.tracks.forEach((track, index) => {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'wp-item wp-grid-item';
            card.dataset.index = index;

            const cover = document.createElement('span');
            cover.className = 'wp-grid-cover';
            if (track.artwork) {
                const img = document.createElement('img');
                img.className = 'wp-grid-art';
                img.src = track.artwork;
                img.alt = '';
                applyArtFallback(img);
                cover.appendChild(img);
            } else {
                // No artwork: a centered track number stands in for the cover.
                const num = document.createElement('span');
                num.className = 'wp-grid-num';
                num.setAttribute('aria-hidden', 'true');
                num.textContent = index + 1;
                cover.appendChild(num);
            }
            const overlay = document.createElement('span');
            overlay.className = 'wp-grid-ov';
            const ic = document.createElement('i');
            ic.className = 'wp-queue-state ti ti-player-play';
            ic.setAttribute('aria-hidden', 'true');
            overlay.appendChild(ic);
            cover.appendChild(overlay);
            card.appendChild(cover);

            const title = document.createElement('span');
            title.className = 'wp-grid-title';
            title.textContent = track.title;
            card.appendChild(title);

            // Clicking the active card toggles play/pause (matching the overlay
            // icon); clicking any other card loads + plays it. Native <button>
            // gives us Enter/Space + focus for free.
            card.addEventListener('click', () => {
                if (index === this.currentTrackIndex) {
                    this.togglePlay();
                } else {
                    this.selectTrack(index);
                }
            });

            gridContainer.appendChild(card);
        });

        this.container.appendChild(gridContainer);
        this.listElement = gridContainer;
    }

    /**
     * Toggle play/pause on the active track (the hero cover + active queue row).
     * @private
     */
    togglePlay() {
        if (!this.player) return;
        // Use the audio element's own paused state as the ground truth — the
        // player's isPlaying flag can lag, and pausing must be reliable.
        const audio = this.player.audio;
        const playing = audio ? !audio.paused : !!this.player.isPlaying;
        if (playing) {
            this.player.pause();
        } else {
            this.player.play();
        }
    }

    /**
     * Update the hero time readout from real playback values.
     * @private
     * @param {number} current
     * @param {number} total
     */
    updateHeroTime(current, total) {
        if (!this.heroTime) return;
        const totalStr = (total && isFinite(total))
            ? this.formatTime(total)
            : ((this.tracks[this.currentTrackIndex] && this.tracks[this.currentTrackIndex].duration) || '0:00');
        this.heroTime.textContent = this.formatTime(current) + ' / ' + totalStr;
    }

    /**
     * Initialize the WaveformPlayer instance with first track
     * @private
     * @param {HTMLElement} container - Container for the player
     */
    initPlayer(container) {
        const firstTrack = this.tracks[0];

        // Determine if we should show chapter markers on waveform
        let markers = firstTrack.markers;

        // Smart default: Show chapter markers for single track with chapters
        if (this.options.showChapterMarkers === null) {
            this.options.showChapterMarkers = (this.tracks.length === 1 && firstTrack.chapters.length > 0);
        }

        // Convert chapters to markers if needed
        if (this.options.showChapterMarkers && firstTrack.chapters.length > 0 && markers.length === 0) {
            markers = firstTrack.chapters.map(ch => ({
                time: ch.time,
                label: ch.label,
                color: ch.color || this.options.chapterMarkerColor
            }));
        }

        // Merge container options with first track data
        const playerOptions = {
            ...this.options,
            url: firstTrack.url,
            title: firstTrack.title,
            artist: firstTrack.artist,
            artwork: firstTrack.artwork,
            album: firstTrack.album,
            markers: markers,
            // Hero layout drives a waveform-ONLY player: the cover (with its
            // play/pause overlay), the time readout and the queue are this
            // component's own chrome, so suppress the player's button + info row.
            ...((this.isHero || this.isGrid) ? { showControls: false, showInfo: false } : {}),
            onEnd: () => this.onTrackEnd(),
            onNextTrack: () => this.nextTrack(),
            onPreviousTrack: () => this.previousTrack(),
            onTimeUpdate: (current, total) => {
                this.updateActiveChapter(current);
                if (this.isHero || this.isGrid) this.updateHeroTime(current, total);
            },
            onPlay: () => {
                this.isPlaying = true;
                this.setActiveTrack(this.currentTrackIndex);
                this.updatePlayState();
            },
            onPause: () => {
                this.isPlaying = false;
                this.updatePlayState();
                // Reset chapter when paused at end
                if (this.player && this.player.audio) {
                    const current = this.player.audio.currentTime;
                    const duration = this.player.audio.duration;
                    if (current >= duration - 0.1) {
                        this.currentChapterIndex = -1;
                        this.updateActiveChapter(0);
                    }
                }
            }
        };

        // Create player instance
        this.player = new window.WaveformPlayer(container, playerOptions);

        // The player reclasses its container to `waveform-player`, clobbering the
        // `wp-player` hook the list/minimal now-playing CSS relies on (the inset
        // that aligns it with the track rows + the bottom margin that keeps it
        // from touching the list). Hero/grid target the post-clobber class, so
        // only list/minimal need the hook restored.
        if (!this.isHero && !this.isGrid) {
            container.classList.add('wp-player');
        }

        // Mark first track as active immediately
        this.setActiveTrack(0);

        // Initialize chapter tracking
        this.updateActiveChapter(0);
    }

    /**
     * Update play/pause state on artwork
     * @private
     */
    updatePlayState() {
        // Hero/grid: reflect play/pause on the cover overlay and the active
        // queue row / grid card.
        if (this.isHero || this.isGrid) {
            const playing = this.isPlaying;
            if (this.heroIcon) {
                this.heroIcon.className = playing ? 'ti ti-player-pause' : 'ti ti-player-play';
            }
            if (this.heroCover) {
                this.heroCover.setAttribute('aria-label', playing ? 'Pause' : 'Play');
            }
            if (this.listElement) {
                this.listElement.querySelectorAll('.wp-queue-state').forEach((ic) => {
                    const item = ic.closest('[data-index]');
                    const i = item ? Number(item.dataset.index) : -1;
                    const isActivePlaying = playing && i === this.currentTrackIndex;
                    ic.classList.toggle('ti-player-pause', isActivePlaying);
                    ic.classList.toggle('ti-player-play', !isActivePlaying);
                });
            }
            return;
        }

        if (!this.options.showPlayState) return;

        // Update all artwork play states
        this.listElement.querySelectorAll('.wp-artwork-container').forEach((container, i) => {
            const isActive = i === this.currentTrackIndex;
            const overlay = container.querySelector('.wp-artwork-overlay');
            if (overlay) {
                overlay.style.display = isActive ? 'flex' : 'none';
                const icon = overlay.querySelector('i');
                if (icon) {
                    icon.className = this.isPlaying && isActive ? 'ti ti-player-pause' : 'ti ti-player-play';
                }
            }
        });
    }

    /**
     * Update active chapter based on playback position
     * @private
     * @param {number} currentTime - Current playback time in seconds
     */
    updateActiveChapter(currentTime) {
        const track = this.tracks[this.currentTrackIndex];
        if (!track.chapters.length) return;

        // Find current chapter based on time
        let activeChapterIndex = -1;
        for (let i = track.chapters.length - 1; i >= 0; i--) {
            if (currentTime >= track.chapters[i].time) {
                activeChapterIndex = i;
                break;
            }
        }

        // Only update UI if chapter changed
        if (activeChapterIndex === this.currentChapterIndex) return;
        this.currentChapterIndex = activeChapterIndex;

        // Update UI based on layout
        if (this.tracks.length === 1 && track.chapters.length > 0) {
            // Single track with chapters - update chapter items
            this.listElement.querySelectorAll('.wp-chapter-item').forEach((item, i) => {
                this.setChapterActive(item, i === activeChapterIndex);
            });
        } else if (this.tracks.length > 1 && this.options.expandChapters) {
            // Multiple tracks - update chapters under current track
            const chapters = this.listElement.querySelector(`.wp-chapters[data-track-index="${this.currentTrackIndex}"]`);
            if (chapters) {
                chapters.querySelectorAll('.wp-chapter').forEach((item, i) => {
                    this.setChapterActive(item, i === activeChapterIndex);
                });
            }
        }
    }

    /**
     * Toggle a chapter row's active styling and its `aria-current` state so the
     * playing chapter is conveyed to assistive technology, not just visually.
     * @private
     * @param {HTMLElement} item - Chapter row element
     * @param {boolean} isActive - Whether this chapter is the active one
     */
    setChapterActive(item, isActive) {
        item.classList.toggle('wp-active', isActive);
        if (isActive) {
            item.setAttribute('aria-current', 'true');
        } else {
            item.removeAttribute('aria-current');
        }
    }

    /**
     * Create chapter list UI for single track with chapters
     * @private
     */
    createChapterList() {
        const track = this.tracks[0];

        const listContainer = document.createElement('div');
        listContainer.className = 'wp-list-container';

        const list = document.createElement('ul');
        list.className = 'wp-list wp-chapters-only';
        list.setAttribute('aria-label', 'Chapters');

        track.chapters.forEach((chapter, index) => {
            const item = document.createElement('li');
            item.className = 'wp-chapter-item';
            item.dataset.time = chapter.time;
            item.dataset.index = index;

            const time = document.createElement('span');
            time.className = 'wp-time';
            time.textContent = this.formatTime(chapter.time);
            item.appendChild(time);

            const label = document.createElement('span');
            label.className = 'wp-label';
            label.textContent = chapter.label;
            item.appendChild(label);

            this.makeActivatable(item, () => {
                this.player.seekTo(chapter.time);
                if (!this.player.isPlaying) {
                    this.player.play();
                }
            });

            list.appendChild(item);
        });

        listContainer.appendChild(list);
        this.container.appendChild(listContainer);
        this.listElement = list;
    }

    /**
     * Build the expandable `.wp-chapters` sublist for a track (shared by the
     * track list and the hero queue). Returns null when the track has no
     * chapters or `expandChapters` is off. Hidden by default; shown for the
     * active track by setActiveTrack/selectTrack.
     * @private
     * @param {Object} track
     * @param {number} index
     * @returns {HTMLElement|null}
     */
    buildChapterSublist(track, index) {
        if (!(track.chapters.length > 0 && this.options.expandChapters)) return null;

        const chapters = document.createElement('ul');
        chapters.className = 'wp-chapters';
        chapters.dataset.trackIndex = index;
        chapters.setAttribute('aria-label', 'Chapters');
        chapters.style.display = 'none';

        track.chapters.forEach((chapter, chapterIndex) => {
            const chapterItem = document.createElement('li');
            chapterItem.className = 'wp-chapter';
            chapterItem.dataset.time = chapter.time;
            chapterItem.dataset.index = chapterIndex;

            const time = document.createElement('span');
            time.className = 'wp-chapter-time';
            time.textContent = this.formatTime(chapter.time);
            chapterItem.appendChild(time);

            const label = document.createElement('span');
            label.className = 'wp-chapter-label';
            label.textContent = chapter.label;
            chapterItem.appendChild(label);

            this.makeActivatable(chapterItem, (e) => {
                if (e) e.stopPropagation();
                this.seekToChapter(index, chapter.time);
            });

            chapters.appendChild(chapterItem);
        });

        return chapters;
    }

    /**
     * Create track list UI for multiple tracks
     * @private
     */
    createTrackList() {
        const listContainer = document.createElement('div');
        listContainer.className = 'wp-list-container';

        const list = document.createElement('ul');
        list.className = 'wp-list';
        // Each track row is itself focusable (see makeActivatable below), so
        // keyboard users can Tab to a row and use the 1-9 track-select shortcuts;
        // the label gives screen-reader users context for the list of rows.
        list.setAttribute('aria-label', 'Playlist');

        this.tracks.forEach((track, index) => {
            // Create track item
            const item = document.createElement('li');
            item.className = 'wp-item';
            item.dataset.index = index;

            // Track artwork or number indicator
            if (track.artwork) {
                const artworkContainer = document.createElement('div');
                artworkContainer.className = 'wp-artwork-container';

                const artwork = document.createElement('img');
                artwork.className = 'wp-artwork';
                artwork.src = track.artwork;
                applyArtFallback(artwork);
                // Decorative: the row's own text already announces the title, so
                // an empty alt avoids the screen reader reading it twice.
                artwork.alt = '';
                artworkContainer.appendChild(artwork);

                // Add play/pause overlay if enabled
                if (this.options.showPlayState) {
                    const overlay = document.createElement('div');
                    overlay.className = 'wp-artwork-overlay';
                    overlay.style.display = 'none';

                    const icon = document.createElement('i');
                    icon.className = 'ti ti-player-play';
                    icon.setAttribute('aria-hidden', 'true'); // purely visual
                    overlay.appendChild(icon);

                    artworkContainer.appendChild(overlay);
                }

                item.appendChild(artworkContainer);
            } else {
                const indicator = document.createElement('span');
                indicator.className = 'wp-indicator';
                indicator.textContent = index + 1;
                // The visible number duplicates the row's position; hide it from
                // AT so the accessible name stays just the title/artist.
                indicator.setAttribute('aria-hidden', 'true');
                item.appendChild(indicator);
            }

            // Track info container
            const info = document.createElement('div');
            info.className = 'wp-info';

            const title = document.createElement('div');
            title.className = 'wp-title';
            title.textContent = track.title;
            info.appendChild(title);

            if (track.artist) {
                const artist = document.createElement('div');
                artist.className = 'wp-artist';
                artist.textContent = track.artist;
                info.appendChild(artist);
            }

            item.appendChild(info);

            // Duration display
            if (this.options.showDuration && track.duration) {
                const duration = document.createElement('span');
                duration.className = 'wp-duration';
                duration.textContent = track.duration;
                item.appendChild(duration);
            }

            // Keyboard-operable row: toggle play/pause on the active track,
            // select any other track. Works with mouse, Enter and Space.
            this.makeActivatable(item, () => {
                if (index === this.currentTrackIndex) {
                    // Toggle play/pause on the active track
                    if (this.player && this.player.isPlaying) {
                        this.player.pause();
                    } else if (this.player) {
                        this.player.play();
                    }
                } else {
                    // Select a different track
                    this.selectTrack(index);
                }
            });

            list.appendChild(item);

            // Add expandable chapters if they exist.
            const sub = this.buildChapterSublist(track, index);
            if (sub) list.appendChild(sub);
        });

        listContainer.appendChild(list);
        this.container.appendChild(listContainer);
        this.listElement = list;
    }

    /**
     * Create minimal control buttons UI
     * @private
     */
    createMinimalControls() {
        const controls = document.createElement('div');
        controls.className = 'wp-controls';

        this.tracks.forEach((track, index) => {
            const btn = document.createElement('button');
            btn.className = 'wp-track-btn';
            btn.dataset.index = index;
            btn.textContent = track.title;
            // Reflect which track is selected for assistive technology.
            btn.setAttribute('aria-pressed', 'false');

            btn.addEventListener('click', () => this.selectTrack(index));

            controls.appendChild(btn);
        });

        this.container.appendChild(controls);
        this.listElement = controls;
    }

    /**
     * Select and load a track
     * @public
     * @param {number} index - Track index to select
     */
    selectTrack(index) {
        if (index < 0 || index >= this.tracks.length) return;

        const track = this.tracks[index];
        this.currentTrackIndex = index;
        this.currentChapterIndex = -1;

        // Determine markers for this track
        let markers = track.markers;

        // Smart default for showing chapter markers
        const shouldShowChapterMarkers = this.options.showChapterMarkers ||
            (this.options.showChapterMarkers === null && this.tracks.length === 1 && track.chapters.length > 0);

        if (shouldShowChapterMarkers && track.chapters.length > 0 && markers.length === 0) {
            markers = track.chapters.map(ch => ({
                time: ch.time,
                label: ch.label,
                color: ch.color || this.options.chapterMarkerColor
            }));
        }

        // Load track into player
        if (this.player) {
            this.player.loadTrack(
                track.url,
                track.title,
                track.artist,
                {
                    markers: markers,
                    artwork: track.artwork,
                    album: track.album,
                    onPlay: () => {
                        this.isPlaying = true;
                        this.setActiveTrack(this.currentTrackIndex);
                        this.updatePlayState();
                    },
                    onPause: () => {
                        this.isPlaying = false;
                        this.updatePlayState();
                        // Reset chapter when paused at end
                        if (this.player && this.player.audio) {
                            const current = this.player.audio.currentTime;
                            const duration = this.player.audio.duration;
                            if (current >= duration - 0.1) {
                                this.currentChapterIndex = -1;
                                this.updateActiveChapter(0);
                            }
                        }
                    }
                }
            );
        }

        // Update UI
        this.setActiveTrack(index);

        // Show/hide chapters for this track
        if (this.options.expandChapters && this.tracks.length > 1) {
            this.listElement.querySelectorAll('.wp-chapters').forEach((chapters, i) => {
                chapters.style.display = i === index ? 'block' : 'none';
            });
        }
    }

    /**
     * Seek to a specific chapter within a track
     * @public
     * @param {number} trackIndex - Track index
     * @param {number} time - Time in seconds to seek to
     */
    seekToChapter(trackIndex, time) {
        // Same track - seek straight away.
        if (trackIndex === this.currentTrackIndex) {
            this.player.seekTo(time);
            if (!this.player.isPlaying) {
                this.player.play();
            }
            return;
        }

        if (trackIndex < 0 || trackIndex >= this.tracks.length) return;

        // Cross-track: load the new track, then seek once it is actually ready.
        // Waiting on the core player's load signal (instead of a fixed
        // setTimeout) keeps the seek from being lost on slow loads and from
        // double-firing on fast ones. Register the listener BEFORE selectTrack()
        // kicks off the async load so we never miss the ready signal.
        this.whenPlayerReady(() => {
            this.player.seekTo(time);
            if (!this.player.isPlaying) {
                this.player.play();
            }
        });

        this.selectTrack(trackIndex);
    }

    /**
     * Run a callback exactly once, when the core player has finished
     * (re)loading its current track.
     *
     * Listens for whichever load signal the installed core version exposes so
     * the seek is deterministic across versions:
     *   - the `waveformplayer:ready` CustomEvent (detail: { player, url })
     *     the core dispatches after init/load, and
     *   - the `onLoad(player)` option the core invokes after a load.
     * Whichever fires first wins and the other hook is torn down, so the
     * callback never runs twice.
     *
     * @private
     * @param {Function} callback - Invoked once the player's track is ready
     */
    whenPlayerReady(callback) {
        if (!this.player) return;

        let done = false;
        const prevOnLoad = this.player.options ? this.player.options.onLoad : null;

        const onReady = (e) => {
            // Ignore ready events from other players sharing the document.
            if (e.detail && e.detail.player && e.detail.player !== this.player) return;
            finish();
        };

        const finish = () => {
            if (done) return;
            done = true;

            document.removeEventListener('waveformplayer:ready', onReady, true);
            if (this.player && this.player.container) {
                this.player.container.removeEventListener('waveformplayer:ready', onReady, true);
            }
            if (this.player && this.player.options) {
                this.player.options.onLoad = prevOnLoad;
            }

            callback();
        };

        // Capture-phase listeners on both document and the player container so we
        // catch the event whether or not the core bubbles it.
        document.addEventListener('waveformplayer:ready', onReady, true);
        if (this.player.container) {
            this.player.container.addEventListener('waveformplayer:ready', onReady, true);
        }

        // Fallback for cores that only expose the onLoad option (no event).
        if (this.player.options) {
            this.player.options.onLoad = (player) => {
                if (typeof prevOnLoad === 'function') prevOnLoad(player);
                finish();
            };
        }
    }

    /**
     * Update active track UI state
     * @private
     * @param {number} index - Track index to mark as active
     */
    setActiveTrack(index) {
        if (this.isMinimal) {
            // Minimal layout - update buttons
            this.listElement.querySelectorAll('.wp-track-btn').forEach((btn, i) => {
                const isActive = i === index;
                btn.classList.toggle('wp-active', isActive);
                btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
            });
        } else if (this.tracks.length > 1 || this.isGrid) {
            // Track list / grid - update items (grid highlights even a single card)
            this.listElement.querySelectorAll('.wp-item').forEach((item, i) => {
                const isActive = i === index;
                item.classList.toggle('wp-active', isActive);
                // aria-current marks the playing track for screen-reader users.
                if (isActive) {
                    item.setAttribute('aria-current', 'true');
                } else {
                    item.removeAttribute('aria-current');
                }
            });
        }

        // Hero: the single cover always shows the active track's artwork. Reset
        // the time readout to the new track's known duration until playback
        // reports real values (avoids briefly showing the previous track's time).
        if ((this.isHero || this.isGrid) && this.tracks[index]) {
            const t = this.tracks[index];
            if (this.heroArt && t.artwork) {
                this.heroArt.src = t.artwork;
            }
            if (this.heroTitle) this.heroTitle.textContent = t.title || '';
            if (this.heroSub) this.heroSub.textContent = t.artist || '';
            if (this.heroTime && index !== this._heroTimeIndex) {
                this.heroTime.textContent = '0:00 / ' + (t.duration || '0:00');
                this._heroTimeIndex = index;
            }
            // Reveal the active track's chapter sublist, hide the rest (matched
            // by data-track-index so it's correct even with sparse chapters).
            if (this.options.expandChapters && this.tracks.length > 1 && this.listElement) {
                this.listElement.querySelectorAll('.wp-chapters').forEach((ch) => {
                    ch.style.display = Number(ch.dataset.trackIndex) === index ? 'block' : 'none';
                });
            }
        }
        // Single track with chapters doesn't need track highlighting
    }

    /**
     * Handle track end event
     * @private
     */
    onTrackEnd() {
        // Reset chapter highlighting to beginning
        this.currentChapterIndex = -1;
        this.updateActiveChapter(0);

        // Auto-advance if continuous mode is enabled
        if (this.options.continuous && this.currentTrackIndex < this.tracks.length - 1) {
            this.selectTrack(this.currentTrackIndex + 1);
        }
    }

    /**
     * Navigate to next track
     * @public
     */
    nextTrack() {
        if (this.currentTrackIndex < this.tracks.length - 1) {
            this.selectTrack(this.currentTrackIndex + 1);
        }
    }

    /**
     * Navigate to previous track
     * @public
     */
    previousTrack() {
        if (this.currentTrackIndex > 0) {
            this.selectTrack(this.currentTrackIndex - 1);
        }
    }

    /**
     * Bind keyboard shortcuts for navigation
     * @private
     */
    bindKeyboard() {
        // Store the bound handler so destroy() can remove it. A document-level
        // listener that is never cleaned up leaks closures and, with several
        // playlists on one page, would cross-fire between instances.
        this.keydownHandler = (e) => {
            const active = document.activeElement;
            // `contains` matches the element itself too, so when the player has
            // focus playlistHasFocus is also true (the player lives inside the
            // playlist container). Tracking both lets us tell "playlist UI" from
            // "player" focus below.
            const playlistHasFocus = this.container.contains(active);
            const playerHasFocus = !!this.player?.container.contains(active);

            // Only act when this playlist (or its own player) holds focus, so
            // multiple playlists on the same page never cross-fire.
            if (!playlistHasFocus && !playerHasFocus) {
                return;
            }

            switch (e.key.toLowerCase()) {
                case 'n':
                    if (this.tracks.length > 1) {
                        e.preventDefault();
                        this.nextTrack();
                    }
                    break;
                case 'p':
                    if (this.tracks.length > 1) {
                        e.preventDefault();
                        this.previousTrack();
                    }
                    break;
            }

            // Number keys 1-9 select a track. The core player already binds 0-9
            // to "seek to 0%-90%" whenever it holds focus, so handling bare
            // digits here too would make a single keypress BOTH seek and switch
            // track. To avoid that collision we only treat digits as
            // track-select when focus is on the playlist's own UI (e.g. a track
            // button or the focusable list) and NOT on the player. When the
            // player is focused, bare digits fall through to the core player's
            // documented seek behaviour.
            if (this.tracks.length > 1 && playlistHasFocus && !playerHasFocus &&
                e.key >= '1' && e.key <= '9') {
                const index = parseInt(e.key, 10) - 1;
                if (index < this.tracks.length) {
                    e.preventDefault();
                    this.selectTrack(index);
                }
            }
        };

        document.addEventListener('keydown', this.keydownHandler);
    }

    /**
     * Make a non-interactive element (e.g. an `<li>` row) behave like a button
     * for keyboard and assistive-technology users: it exposes a `button` role,
     * joins the tab order, and runs the same handler on Enter/Space as on click.
     *
     * Without this, the clickable track and chapter rows are mouse-only and
     * invisible to keyboard and screen-reader users.
     *
     * @private
     * @param {HTMLElement} el - Element to make activatable
     * @param {Function} onActivate - Handler run on click / Enter / Space; receives the originating event
     */
    makeActivatable(el, onActivate) {
        el.setAttribute('role', 'button');
        el.tabIndex = 0;
        el.addEventListener('click', onActivate);
        el.addEventListener('keydown', (e) => {
            // Enter and Space are the standard activation keys for buttons.
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                e.preventDefault(); // stop Space from scrolling the page
                onActivate(e);
            }
        });
    }

    /**
     * Parse time string to seconds
     *
     * A `data-time` an author mistyped (`"1:ab"`, `"soon"`) used to yield NaN
     * for the two-part form, which then rendered as `NaN` in the chapter list
     * and positioned the chapter marker at `left: NaN%`. Anything unparseable
     * is 0 — the start of the track — rather than a value that poisons every
     * calculation it touches.
     *
     * @private
     * @param {string} timeStr - Time string in format "M:SS" or "MM:SS"
     * @returns {number} Time in seconds, or 0 when unparseable
     */
    parseTime(timeStr) {
        const parts = String(timeStr ?? '').split(':').map(Number);
        const seconds = parts.length === 2
            ? parts[0] * 60 + parts[1]
            : parts[0];

        return Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
    }

    /**
     * Format seconds to time string
     * @private
     * @param {number} seconds - Time in seconds
     * @returns {string} Formatted time string "M:SS"
     */
    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    /**
     * Extract title from URL filename
     * @private
     * @param {string} url - Audio file URL
     * @returns {string} Extracted title
     */
    extractTitleFromUrl(url) {
        if (!url) return 'Untitled';
        const parts = url.split('/');
        const filename = parts[parts.length - 1];
        return filename.split('.')[0].replace(/[-_]/g, ' ');
    }

    /**
     * Generate unique ID
     * @private
     * @returns {string} Random ID string
     */
    generateId() {
        return Math.random().toString(36).substring(2, 9);
    }

    /**
     * Get current player instance
     * @public
     * @returns {WaveformPlayer|null} The WaveformPlayer instance
     */
    getPlayer() {
        return this.player;
    }

    /**
     * Get current track index
     * @public
     * @returns {number} Current track index
     */
    getCurrentTrackIndex() {
        return this.currentTrackIndex;
    }

    /**
     * Get all tracks
     * @public
     * @returns {Array} Array of track objects
     */
    getTracks() {
        return this.tracks;
    }

    /**
     * Destroy the playlist instance and cleanup
     * @public
     */
    destroy() {
        // Remove the global keydown listener so it does not leak or keep
        // firing after this playlist is gone.
        if (this.keydownHandler) {
            document.removeEventListener('keydown', this.keydownHandler);
            this.keydownHandler = null;
        }

        // Destroy player instance
        if (this.player) {
            this.player.destroy();
        }

        // Clear container
        this.container.innerHTML = '';
        this.container.classList.remove('waveform-playlist', 'wp-minimal');

        // Restore original elements
        this.tracks.forEach(track => {
            if (track.element) {
                track.element.style.display = '';
            }
        });

        // Clear references
        this.player = null;
        this.listElement = null;
        this.tracks = [];
    }
}

/**
 * Auto-initialization function
 * Automatically initializes all elements with data-waveform-playlist attribute
 */
function autoInit() {
    if (typeof document === 'undefined') return;

    const elements = document.querySelectorAll('[data-waveform-playlist]');
    elements.forEach(element => {
        if (element.dataset.waveformPlaylistInitialized === 'true') return;

        try {
            new WaveformPlaylist(element);
            element.dataset.waveformPlaylistInitialized = 'true';
        } catch (error) {
            console.error('[WaveformPlaylist] Failed to initialize:', error);
        }
    });
}

// Initialize when DOM is ready
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoInit);
    } else {
        if (typeof window !== 'undefined' && window.WaveformPlayer) {
            autoInit();
        } else if (typeof window !== 'undefined') {
            // Wait for WaveformPlayer to load
            const checkInterval = setInterval(() => {
                if (window.WaveformPlayer) {
                    clearInterval(checkInterval);
                    autoInit();
                }
            }, 100);
            // Give up after 5 seconds
            setTimeout(() => clearInterval(checkInterval), 5000);
        }
    }
}

// Add static init method
WaveformPlaylist.init = autoInit;

// Export for browser usage
if (typeof window !== 'undefined') {
    window.WaveformPlaylist = WaveformPlaylist;
}

// Default export
export default WaveformPlaylist;