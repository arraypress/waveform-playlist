/**
 * WaveformPlaylist
 * Playlist and chapter navigation for WaveformPlayer
 *
 * @version 1.0.0
 * @author ArrayPress
 * @license MIT
 */

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
     * @param {string} [options.chapterMarkerColor='rgba(168, 85, 247, 0.8)'] - Default color for chapter markers
     * @param {boolean} [options.showPlayState=true] - Show play/pause icon on active track artwork
     * @throws {Error} If container not found or WaveformPlayer not available
     */
    constructor(container, options = {}) {
        // Resolve container
        this.container = typeof container === 'string'
            ? document.querySelector(container)
            : container;

        if (!this.container) {
            throw new Error('WaveformPlaylist: Container element not found');
        }

        // Check for WaveformPlayer dependency
        if (typeof window.WaveformPlayer === 'undefined') {
            throw new Error('WaveformPlaylist: WaveformPlayer is required but not found');
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
        this.isPlaying = false;

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

        // Parse all WaveformPlayer attributes that should be inherited
        const playerAttributes = [
            'url', 'waveformStyle', 'barWidth', 'barSpacing', 'height', 'samples',
            'colorPreset', 'waveformColor', 'progressColor', 'buttonColor',
            'buttonHoverColor', 'textColor', 'textSecondaryColor',
            'backgroundColor', 'borderColor', 'showTime', 'showBPM', 'showPlaybackSpeed',
            'playbackRate', 'autoplay', 'singlePlay', 'playOnSeek', 'enableMediaSession'
        ];

        playerAttributes.forEach(attr => {
            const dataAttr = container.dataset[attr];
            if (dataAttr !== undefined) {
                // Convert string booleans to actual booleans
                if (dataAttr === 'true') options[attr] = true;
                else if (dataAttr === 'false') options[attr] = false;
                else options[attr] = dataAttr;
            }
        });

        // Playlist-specific options
        options.layout = container.dataset.layout || options.layout || 'list';
        options.continuous = container.dataset.continuous === 'true' || options.continuous || false;
        options.expandChapters = container.dataset.expandChapters !== 'false';
        options.showDuration = container.dataset.showDuration !== 'false';
        options.showPlayState = container.dataset.showPlayState !== 'false';

        // Smart defaults for chapter markers
        if (container.dataset.showChapterMarkers !== undefined) {
            options.showChapterMarkers = container.dataset.showChapterMarkers === 'true';
        } else {
            options.showChapterMarkers = null; // Will be determined by content
        }

        options.chapterMarkerColor = container.dataset.chapterMarkerColor || 'rgba(168, 85, 247, 0.8)';

        return options;
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
                subtitle: el.dataset.subtitle || '',
                artwork: el.dataset.artwork,
                album: el.dataset.album,
                duration: el.dataset.duration,
                chapters: chapters,
                // Parse explicit markers if provided (separate from chapters)
                markers: el.dataset.markers ? JSON.parse(el.dataset.markers) : []
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

        // Hide original track elements
        this.tracks.forEach(track => {
            if (track.element) {
                track.element.style.display = 'none';
            }
        });

        // Create player container
        const playerContainer = document.createElement('div');
        playerContainer.className = 'wp-player';
        playerContainer.id = 'wp-player-' + this.generateId();
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

        // Initialize WaveformPlayer instance
        this.initPlayer(playerContainer);

        // Bind keyboard shortcuts
        this.bindKeyboard();
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
            subtitle: firstTrack.subtitle,
            artwork: firstTrack.artwork,
            album: firstTrack.album,
            markers: markers,
            onEnd: () => this.onTrackEnd(),
            onTimeUpdate: (current, total) => this.updateActiveChapter(current),
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
                item.classList.toggle('wp-active', i === activeChapterIndex);
            });
        } else if (this.tracks.length > 1 && this.options.expandChapters) {
            // Multiple tracks - update chapters under current track
            const chapters = this.listElement.querySelector(`.wp-chapters[data-track-index="${this.currentTrackIndex}"]`);
            if (chapters) {
                chapters.querySelectorAll('.wp-chapter').forEach((item, i) => {
                    item.classList.toggle('wp-active', i === activeChapterIndex);
                });
            }
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

            item.addEventListener('click', () => {
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
     * Create track list UI for multiple tracks
     * @private
     */
    createTrackList() {
        const listContainer = document.createElement('div');
        listContainer.className = 'wp-list-container';

        const list = document.createElement('ul');
        list.className = 'wp-list';

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
                artwork.alt = track.title;
                artworkContainer.appendChild(artwork);

                // Add play/pause overlay if enabled
                if (this.options.showPlayState) {
                    const overlay = document.createElement('div');
                    overlay.className = 'wp-artwork-overlay';
                    overlay.style.display = 'none';

                    const icon = document.createElement('i');
                    icon.className = 'ti ti-player-play';
                    overlay.appendChild(icon);

                    artworkContainer.appendChild(overlay);
                }

                item.appendChild(artworkContainer);
            } else {
                const indicator = document.createElement('span');
                indicator.className = 'wp-indicator';
                indicator.textContent = index + 1;
                item.appendChild(indicator);
            }

            // Track info container
            const info = document.createElement('div');
            info.className = 'wp-info';

            const title = document.createElement('div');
            title.className = 'wp-title';
            title.textContent = track.title;
            info.appendChild(title);

            if (track.subtitle) {
                const subtitle = document.createElement('div');
                subtitle.className = 'wp-subtitle';
                subtitle.textContent = track.subtitle;
                info.appendChild(subtitle);
            }

            item.appendChild(info);

            // Duration display
            if (this.options.showDuration && track.duration) {
                const duration = document.createElement('span');
                duration.className = 'wp-duration';
                duration.textContent = track.duration;
                item.appendChild(duration);
            }

            // Click handler - toggle play/pause for active track, select for others
            item.addEventListener('click', () => {
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

            // Add expandable chapters if they exist
            if (track.chapters.length > 0 && this.options.expandChapters) {
                const chapters = document.createElement('ul');
                chapters.className = 'wp-chapters';
                chapters.dataset.trackIndex = index;
                chapters.style.display = 'none'; // Hidden by default

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

                    chapterItem.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.seekToChapter(index, chapter.time);
                    });

                    chapters.appendChild(chapterItem);
                });

                list.appendChild(chapters);
            }
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
                track.subtitle,
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
        if (trackIndex !== this.currentTrackIndex) {
            this.selectTrack(trackIndex);
            // Wait for track to load before seeking
            setTimeout(() => {
                this.player.seekTo(time);
                if (!this.player.isPlaying) {
                    this.player.play();
                }
            }, 100);
        } else {
            this.player.seekTo(time);
            if (!this.player.isPlaying) {
                this.player.play();
            }
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
                btn.classList.toggle('wp-active', i === index);
            });
        } else if (this.tracks.length > 1) {
            // Track list - update items
            this.listElement.querySelectorAll('.wp-item').forEach((item, i) => {
                item.classList.toggle('wp-active', i === index);
            });
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
        document.addEventListener('keydown', (e) => {
            // Only handle if playlist or player is focused
            if (!this.container.contains(document.activeElement) &&
                !this.player?.container.contains(document.activeElement)) {
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

            // Number keys for track selection (only if multiple tracks)
            if (this.tracks.length > 1 && e.key >= '1' && e.key <= '9') {
                const index = parseInt(e.key) - 1;
                if (index < this.tracks.length) {
                    e.preventDefault();
                    this.selectTrack(index);
                }
            }
        });
    }

    /**
     * Parse time string to seconds
     * @private
     * @param {string} timeStr - Time string in format "M:SS" or "MM:SS"
     * @returns {number} Time in seconds
     */
    parseTime(timeStr) {
        const parts = timeStr.split(':').map(Number);
        if (parts.length === 2) {
            return parts[0] * 60 + parts[1];
        }
        return parts[0] || 0;
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
            console.error('Failed to initialize WaveformPlaylist:', error);
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