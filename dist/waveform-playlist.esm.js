// src/js/index.js
var ARTWORK_FALLBACK = "data:image/svg+xml," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="4" fill="#71717a" fill-opacity="0.15"/><g fill="none" stroke="#a1a1aa" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="17" r="2.2"/><circle cx="17" cy="15" r="2.2"/><path d="M10.2 17V7l9-1.6v9"/></g></svg>'
);
function applyArtFallback(img) {
  img.addEventListener("error", () => {
    if (!img.src.startsWith("data:")) img.src = ARTWORK_FALLBACK;
  });
}
var WaveformPlaylist = class {
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
    this.container = typeof container === "string" ? document.querySelector(container) : container;
    if (!this.container) {
      throw new Error("[WaveformPlaylist] Container element not found");
    }
    if (typeof window.WaveformPlayer === "undefined") {
      throw new Error("[WaveformPlaylist] WaveformPlayer is required but not found");
    }
    this.options = this.parseOptions(options);
    this.tracks = [];
    this.currentTrackIndex = 0;
    this.currentChapterIndex = -1;
    this.player = null;
    this.listElement = null;
    this.isMinimal = this.options.layout === "minimal";
    this.isHero = this.options.layout === "hero";
    this.isGrid = this.options.layout === "grid";
    this.isPlaying = false;
    this.keydownHandler = null;
    this.parseTracks();
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
    const options = { ...providedOptions };
    const fromData = this.parsePlayerDataAttributes(container);
    ["audioMode", "url", "title", "artist", "album", "artwork", "markers", "waveform"].forEach((key) => delete fromData[key]);
    Object.assign(options, fromData);
    options.layout = container.dataset.layout || options.layout || "list";
    options.continuous = container.dataset.continuous === "true" || options.continuous || false;
    options.expandChapters = container.dataset.expandChapters !== "false";
    options.showDuration = container.dataset.showDuration !== "false";
    options.showPlayState = container.dataset.showPlayState !== "false";
    options.showArtist = options.showArtist !== false && container.dataset.showArtist !== "false";
    options.coverSize = parseInt(container.dataset.coverSize, 10) || options.coverSize || null;
    options.thumbnailSize = parseInt(container.dataset.thumbnailSize, 10) || options.thumbnailSize || null;
    options.density = container.dataset.density || options.density || "comfortable";
    options.coverPosition = container.dataset.coverPosition || options.coverPosition || "left";
    options.barPosition = container.dataset.barPosition || options.barPosition || "bottom";
    if (container.dataset.showChapterMarkers !== void 0) {
      options.showChapterMarkers = container.dataset.showChapterMarkers === "true";
    } else {
      options.showChapterMarkers = null;
    }
    options.chapterMarkerColor = container.dataset.chapterMarkerColor || "rgba(161, 161, 170, 0.85)";
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
    const utils = typeof window !== "undefined" && window.WaveformPlayer && window.WaveformPlayer.utils;
    if (utils && typeof utils.parseDataAttributes === "function") {
      return { ...utils.parseDataAttributes(container) };
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
    const str = (k, o = k) => {
      if (ds[k] !== void 0) opts[o] = ds[k];
    };
    const bool = (k, o = k) => {
      if (ds[k] === "true") opts[o] = true;
      else if (ds[k] === "false") opts[o] = false;
    };
    const int = (k, o = k) => {
      if (ds[k]) opts[o] = parseInt(ds[k], 10);
    };
    const float = (k, o = k) => {
      if (ds[k]) opts[o] = parseFloat(ds[k]);
    };
    const json = (k, o = k) => {
      if (!ds[k]) return;
      try {
        opts[o] = JSON.parse(ds[k]);
      } catch (e) {
        console.warn(`[WaveformPlaylist] Invalid ${k} JSON:`, e);
      }
    };
    str("waveformStyle");
    int("barWidth");
    int("barSpacing");
    int("barRadius");
    str("buttonAlign");
    int("height");
    int("samples");
    str("preload");
    str("colorPreset");
    str("waveformColor");
    str("progressColor");
    str("buttonColor");
    str("buttonHoverColor");
    str("textColor");
    str("textSecondaryColor");
    str("backgroundColor");
    str("borderColor");
    bool("autoplay");
    bool("showControls");
    bool("showInfo");
    bool("showTime");
    bool("showHoverTime");
    bool("showBpm", "showBPM");
    bool("singlePlay");
    bool("playOnSeek");
    bool("showPlaybackSpeed");
    bool("enableMediaSession");
    bool("showMarkers");
    bool("accessibleSeek");
    float("playbackRate");
    json("playbackRates");
    str("seekLabel");
    str("errorText");
    str("playIcon");
    str("pauseIcon");
    return opts;
  }
  /**
   * Parse tracks and chapters from container markup
   * @private
   */
  parseTracks() {
    const trackElements = this.container.querySelectorAll("[data-track]");
    this.tracks = Array.from(trackElements).map((el, index) => {
      const chapters = Array.from(el.querySelectorAll("[data-chapter]")).map((ch) => ({
        time: this.parseTime(ch.dataset.time || "0:00"),
        label: ch.textContent.trim(),
        color: ch.dataset.color,
        element: ch
      }));
      return {
        element: el,
        index,
        url: el.dataset.url,
        title: el.dataset.title || this.extractTitleFromUrl(el.dataset.url),
        artist: el.dataset.artist || "",
        artwork: el.dataset.artwork,
        album: el.dataset.album,
        duration: el.dataset.duration,
        chapters,
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
    this.container.classList.add("waveform-playlist");
    if (this.isMinimal) {
      this.container.classList.add("wp-minimal");
    }
    if (this.isHero || this.isGrid) {
      this.container.classList.add("wp-hero-layout");
    }
    if (this.isGrid) {
      this.container.classList.add("wp-grid-layout");
    }
    if (this.options.density === "compact") {
      this.container.classList.add("wp-density-compact");
    }
    if ((this.isHero || this.isGrid) && this.options.coverPosition === "top") {
      this.container.classList.add("wp-cover-top");
    }
    if (!this.options.showArtist) {
      this.container.classList.add("wp-no-artist");
    }
    this.tracks.forEach((track) => {
      if (track.element) {
        track.element.style.display = "none";
      }
    });
    const playerContainer = document.createElement("div");
    playerContainer.className = this.isHero || this.isGrid ? "wp-hero-stage" : "wp-player";
    playerContainer.id = "wp-player-" + this.generateId();
    if (this.isGrid && !(this.tracks.length === 1 && this.tracks[0].chapters.length > 0)) {
      if (this.options.barPosition === "top") {
        this.createNowPlayingBar(playerContainer);
        this.createHeroGrid();
      } else {
        this.createHeroGrid();
        this.createNowPlayingBar(playerContainer);
      }
    } else if (this.isHero || this.isGrid) {
      this.createHeroLayout(playerContainer);
      if (this.tracks.length === 1 && this.tracks[0].chapters.length > 0) {
        this.createChapterList();
      } else {
        this.createHeroQueue();
      }
    } else {
      this.container.appendChild(playerContainer);
      if (this.tracks.length === 1 && this.tracks[0].chapters.length > 0) {
        this.createChapterList();
      } else if (this.isMinimal) {
        this.createMinimalControls();
      } else {
        this.createTrackList();
      }
    }
    this.initPlayer(playerContainer);
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
    const hero = document.createElement("div");
    hero.className = "wp-hero";
    const coverSize = (this.options.coverSize || (this.options.height || 56) + 36) + "px";
    const cover = document.createElement("button");
    cover.type = "button";
    cover.className = "wp-hero-cover";
    cover.style.width = coverSize;
    cover.style.height = coverSize;
    cover.setAttribute("aria-label", "Play");
    if (first.artwork) {
      const img = document.createElement("img");
      img.className = "wp-hero-art";
      img.alt = "";
      img.src = first.artwork;
      applyArtFallback(img);
      cover.appendChild(img);
      this.heroArt = img;
    }
    const overlay = document.createElement("span");
    overlay.className = "wp-hero-overlay";
    const icon = document.createElement("i");
    icon.className = "ti ti-player-play";
    icon.setAttribute("aria-hidden", "true");
    overlay.appendChild(icon);
    cover.appendChild(overlay);
    cover.addEventListener("click", () => this.togglePlay());
    this.heroCover = cover;
    this.heroIcon = icon;
    hero.appendChild(cover);
    const main = document.createElement("div");
    main.className = "wp-hero-main";
    main.appendChild(stage);
    const meta = document.createElement("div");
    meta.className = "wp-hero-meta";
    const titles = document.createElement("div");
    titles.className = "wp-hero-titles";
    const titleEl = document.createElement("span");
    titleEl.className = "wp-hero-title";
    titleEl.textContent = first.title || "";
    titles.appendChild(titleEl);
    this.heroTitle = titleEl;
    if (this.options.showArtist) {
      const subEl = document.createElement("span");
      subEl.className = "wp-hero-sub";
      subEl.textContent = first.artist || "";
      titles.appendChild(subEl);
      this.heroSub = subEl;
    }
    meta.appendChild(titles);
    const time = document.createElement("div");
    time.className = "wp-hero-time";
    time.textContent = "0:00 / " + (first.duration || "0:00");
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
    const bar = document.createElement("div");
    bar.className = "wp-now-bar";
    bar.appendChild(stage);
    const meta = document.createElement("div");
    meta.className = "wp-now-meta";
    const titles = document.createElement("div");
    titles.className = "wp-now-titles";
    const titleEl = document.createElement("span");
    titleEl.className = "wp-hero-title";
    titleEl.textContent = first.title || "";
    titles.appendChild(titleEl);
    this.heroTitle = titleEl;
    if (this.options.showArtist) {
      const subEl = document.createElement("span");
      subEl.className = "wp-hero-sub";
      subEl.textContent = first.artist || "";
      titles.appendChild(subEl);
      this.heroSub = subEl;
    }
    meta.appendChild(titles);
    const time = document.createElement("div");
    time.className = "wp-hero-time";
    time.textContent = "0:00 / " + (first.duration || "0:00");
    this.heroTime = time;
    meta.appendChild(time);
    bar.appendChild(meta);
    if (this.options.barPosition === "top") bar.classList.add("wp-now-bar-top");
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
    const listContainer = document.createElement("div");
    listContainer.className = "wp-list-container wp-queue";
    if (this.options.thumbnailSize) {
      listContainer.style.setProperty("--wp-thumb-size", this.options.thumbnailSize + "px");
    }
    const list = document.createElement("ul");
    list.className = "wp-list";
    this.tracks.forEach((track, index) => {
      const item = document.createElement("li");
      item.className = "wp-item wp-queue-item";
      item.dataset.index = index;
      if (track.artwork) {
        const thumb = document.createElement("div");
        thumb.className = "wp-queue-thumb";
        const img = document.createElement("img");
        img.className = "wp-queue-thumb-art";
        img.src = track.artwork;
        img.alt = "";
        applyArtFallback(img);
        thumb.appendChild(img);
        const overlay = document.createElement("span");
        overlay.className = "wp-queue-ov";
        const ic = document.createElement("i");
        ic.className = "wp-queue-state ti ti-player-play";
        ic.setAttribute("aria-hidden", "true");
        overlay.appendChild(ic);
        thumb.appendChild(overlay);
        item.appendChild(thumb);
      } else {
        const num = document.createElement("span");
        num.className = "wp-num";
        num.setAttribute("aria-hidden", "true");
        num.textContent = index + 1;
        item.appendChild(num);
        const ic = document.createElement("i");
        ic.className = "wp-queue-state wp-queue-state-num ti ti-player-play";
        ic.setAttribute("aria-hidden", "true");
        item.appendChild(ic);
      }
      const info = document.createElement("div");
      info.className = "wp-info";
      const title = document.createElement("div");
      title.className = "wp-title";
      title.textContent = track.title;
      info.appendChild(title);
      item.appendChild(info);
      if (this.options.showDuration && track.duration) {
        const duration = document.createElement("span");
        duration.className = "wp-duration";
        duration.textContent = track.duration;
        item.appendChild(duration);
      }
      this.makeActivatable(item, () => {
        if (index === this.currentTrackIndex) {
          this.togglePlay();
        } else {
          this.selectTrack(index);
        }
      });
      list.appendChild(item);
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
    const gridContainer = document.createElement("div");
    gridContainer.className = "wp-grid";
    if (this.options.thumbnailSize) {
      gridContainer.style.setProperty("--wp-grid-cover", this.options.thumbnailSize + "px");
    }
    this.tracks.forEach((track, index) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "wp-item wp-grid-item";
      card.dataset.index = index;
      const cover = document.createElement("span");
      cover.className = "wp-grid-cover";
      if (track.artwork) {
        const img = document.createElement("img");
        img.className = "wp-grid-art";
        img.src = track.artwork;
        img.alt = "";
        applyArtFallback(img);
        cover.appendChild(img);
      } else {
        const num = document.createElement("span");
        num.className = "wp-grid-num";
        num.setAttribute("aria-hidden", "true");
        num.textContent = index + 1;
        cover.appendChild(num);
      }
      const overlay = document.createElement("span");
      overlay.className = "wp-grid-ov";
      const ic = document.createElement("i");
      ic.className = "wp-queue-state ti ti-player-play";
      ic.setAttribute("aria-hidden", "true");
      overlay.appendChild(ic);
      cover.appendChild(overlay);
      card.appendChild(cover);
      const title = document.createElement("span");
      title.className = "wp-grid-title";
      title.textContent = track.title;
      card.appendChild(title);
      card.addEventListener("click", () => {
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
    const totalStr = total && isFinite(total) ? this.formatTime(total) : this.tracks[this.currentTrackIndex] && this.tracks[this.currentTrackIndex].duration || "0:00";
    this.heroTime.textContent = this.formatTime(current) + "\u2009/\u2009" + totalStr;
  }
  /**
   * Initialize the WaveformPlayer instance with first track
   * @private
   * @param {HTMLElement} container - Container for the player
   */
  initPlayer(container) {
    const firstTrack = this.tracks[0];
    let markers = firstTrack.markers;
    if (this.options.showChapterMarkers === null) {
      this.options.showChapterMarkers = this.tracks.length === 1 && firstTrack.chapters.length > 0;
    }
    if (this.options.showChapterMarkers && firstTrack.chapters.length > 0 && markers.length === 0) {
      markers = firstTrack.chapters.map((ch) => ({
        time: ch.time,
        label: ch.label,
        color: ch.color || this.options.chapterMarkerColor
      }));
    }
    const playerOptions = {
      ...this.options,
      url: firstTrack.url,
      title: firstTrack.title,
      artist: firstTrack.artist,
      artwork: firstTrack.artwork,
      album: firstTrack.album,
      markers,
      // Hero layout drives a waveform-ONLY player: the cover (with its
      // play/pause overlay), the time readout and the queue are this
      // component's own chrome, so suppress the player's button + info row.
      ...this.isHero || this.isGrid ? { showControls: false, showInfo: false } : {},
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
    this.player = new window.WaveformPlayer(container, playerOptions);
    if (!this.isHero && !this.isGrid) {
      container.classList.add("wp-player");
    }
    this.setActiveTrack(0);
    this.updateActiveChapter(0);
  }
  /**
   * Update play/pause state on artwork
   * @private
   */
  updatePlayState() {
    if (this.isHero || this.isGrid) {
      const playing = this.isPlaying;
      if (this.heroIcon) {
        this.heroIcon.className = playing ? "ti ti-player-pause" : "ti ti-player-play";
      }
      if (this.heroCover) {
        this.heroCover.setAttribute("aria-label", playing ? "Pause" : "Play");
      }
      if (this.listElement) {
        this.listElement.querySelectorAll(".wp-queue-state").forEach((ic) => {
          const item = ic.closest("[data-index]");
          const i = item ? Number(item.dataset.index) : -1;
          const isActivePlaying = playing && i === this.currentTrackIndex;
          ic.classList.toggle("ti-player-pause", isActivePlaying);
          ic.classList.toggle("ti-player-play", !isActivePlaying);
        });
      }
      return;
    }
    if (!this.options.showPlayState) return;
    this.listElement.querySelectorAll(".wp-artwork-container").forEach((container, i) => {
      const isActive = i === this.currentTrackIndex;
      const overlay = container.querySelector(".wp-artwork-overlay");
      if (overlay) {
        overlay.style.display = isActive ? "flex" : "none";
        const icon = overlay.querySelector("i");
        if (icon) {
          icon.className = this.isPlaying && isActive ? "ti ti-player-pause" : "ti ti-player-play";
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
    let activeChapterIndex = -1;
    for (let i = track.chapters.length - 1; i >= 0; i--) {
      if (currentTime >= track.chapters[i].time) {
        activeChapterIndex = i;
        break;
      }
    }
    if (activeChapterIndex === this.currentChapterIndex) return;
    this.currentChapterIndex = activeChapterIndex;
    if (this.tracks.length === 1 && track.chapters.length > 0) {
      this.listElement.querySelectorAll(".wp-chapter-item").forEach((item, i) => {
        this.setChapterActive(item, i === activeChapterIndex);
      });
    } else if (this.tracks.length > 1 && this.options.expandChapters) {
      const chapters = this.listElement.querySelector(`.wp-chapters[data-track-index="${this.currentTrackIndex}"]`);
      if (chapters) {
        chapters.querySelectorAll(".wp-chapter").forEach((item, i) => {
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
    item.classList.toggle("wp-active", isActive);
    if (isActive) {
      item.setAttribute("aria-current", "true");
    } else {
      item.removeAttribute("aria-current");
    }
  }
  /**
   * Create chapter list UI for single track with chapters
   * @private
   */
  createChapterList() {
    const track = this.tracks[0];
    const listContainer = document.createElement("div");
    listContainer.className = "wp-list-container";
    const list = document.createElement("ul");
    list.className = "wp-list wp-chapters-only";
    list.setAttribute("aria-label", "Chapters");
    track.chapters.forEach((chapter, index) => {
      const item = document.createElement("li");
      item.className = "wp-chapter-item";
      item.dataset.time = chapter.time;
      item.dataset.index = index;
      const time = document.createElement("span");
      time.className = "wp-time";
      time.textContent = this.formatTime(chapter.time);
      item.appendChild(time);
      const label = document.createElement("span");
      label.className = "wp-label";
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
    const chapters = document.createElement("ul");
    chapters.className = "wp-chapters";
    chapters.dataset.trackIndex = index;
    chapters.setAttribute("aria-label", "Chapters");
    chapters.style.display = "none";
    track.chapters.forEach((chapter, chapterIndex) => {
      const chapterItem = document.createElement("li");
      chapterItem.className = "wp-chapter";
      chapterItem.dataset.time = chapter.time;
      chapterItem.dataset.index = chapterIndex;
      const time = document.createElement("span");
      time.className = "wp-chapter-time";
      time.textContent = this.formatTime(chapter.time);
      chapterItem.appendChild(time);
      const label = document.createElement("span");
      label.className = "wp-chapter-label";
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
    const listContainer = document.createElement("div");
    listContainer.className = "wp-list-container";
    const list = document.createElement("ul");
    list.className = "wp-list";
    list.setAttribute("aria-label", "Playlist");
    this.tracks.forEach((track, index) => {
      const item = document.createElement("li");
      item.className = "wp-item";
      item.dataset.index = index;
      if (track.artwork) {
        const artworkContainer = document.createElement("div");
        artworkContainer.className = "wp-artwork-container";
        const artwork = document.createElement("img");
        artwork.className = "wp-artwork";
        artwork.src = track.artwork;
        applyArtFallback(artwork);
        artwork.alt = "";
        artworkContainer.appendChild(artwork);
        if (this.options.showPlayState) {
          const overlay = document.createElement("div");
          overlay.className = "wp-artwork-overlay";
          overlay.style.display = "none";
          const icon = document.createElement("i");
          icon.className = "ti ti-player-play";
          icon.setAttribute("aria-hidden", "true");
          overlay.appendChild(icon);
          artworkContainer.appendChild(overlay);
        }
        item.appendChild(artworkContainer);
      } else {
        const indicator = document.createElement("span");
        indicator.className = "wp-indicator";
        indicator.textContent = index + 1;
        indicator.setAttribute("aria-hidden", "true");
        item.appendChild(indicator);
      }
      const info = document.createElement("div");
      info.className = "wp-info";
      const title = document.createElement("div");
      title.className = "wp-title";
      title.textContent = track.title;
      info.appendChild(title);
      if (track.artist) {
        const artist = document.createElement("div");
        artist.className = "wp-artist";
        artist.textContent = track.artist;
        info.appendChild(artist);
      }
      item.appendChild(info);
      if (this.options.showDuration && track.duration) {
        const duration = document.createElement("span");
        duration.className = "wp-duration";
        duration.textContent = track.duration;
        item.appendChild(duration);
      }
      this.makeActivatable(item, () => {
        if (index === this.currentTrackIndex) {
          if (this.player && this.player.isPlaying) {
            this.player.pause();
          } else if (this.player) {
            this.player.play();
          }
        } else {
          this.selectTrack(index);
        }
      });
      list.appendChild(item);
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
    const controls = document.createElement("div");
    controls.className = "wp-controls";
    this.tracks.forEach((track, index) => {
      const btn = document.createElement("button");
      btn.className = "wp-track-btn";
      btn.dataset.index = index;
      btn.textContent = track.title;
      btn.setAttribute("aria-pressed", "false");
      btn.addEventListener("click", () => this.selectTrack(index));
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
    let markers = track.markers;
    const shouldShowChapterMarkers = this.options.showChapterMarkers || this.options.showChapterMarkers === null && this.tracks.length === 1 && track.chapters.length > 0;
    if (shouldShowChapterMarkers && track.chapters.length > 0 && markers.length === 0) {
      markers = track.chapters.map((ch) => ({
        time: ch.time,
        label: ch.label,
        color: ch.color || this.options.chapterMarkerColor
      }));
    }
    if (this.player) {
      this.player.loadTrack(
        track.url,
        track.title,
        track.artist,
        {
          markers,
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
    this.setActiveTrack(index);
    if (this.options.expandChapters && this.tracks.length > 1) {
      this.listElement.querySelectorAll(".wp-chapters").forEach((chapters, i) => {
        chapters.style.display = i === index ? "block" : "none";
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
    if (trackIndex === this.currentTrackIndex) {
      this.player.seekTo(time);
      if (!this.player.isPlaying) {
        this.player.play();
      }
      return;
    }
    if (trackIndex < 0 || trackIndex >= this.tracks.length) return;
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
      if (e.detail && e.detail.player && e.detail.player !== this.player) return;
      finish();
    };
    const finish = () => {
      if (done) return;
      done = true;
      document.removeEventListener("waveformplayer:ready", onReady, true);
      if (this.player && this.player.container) {
        this.player.container.removeEventListener("waveformplayer:ready", onReady, true);
      }
      if (this.player && this.player.options) {
        this.player.options.onLoad = prevOnLoad;
      }
      callback();
    };
    document.addEventListener("waveformplayer:ready", onReady, true);
    if (this.player.container) {
      this.player.container.addEventListener("waveformplayer:ready", onReady, true);
    }
    if (this.player.options) {
      this.player.options.onLoad = (player) => {
        if (typeof prevOnLoad === "function") prevOnLoad(player);
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
      this.listElement.querySelectorAll(".wp-track-btn").forEach((btn, i) => {
        const isActive = i === index;
        btn.classList.toggle("wp-active", isActive);
        btn.setAttribute("aria-pressed", isActive ? "true" : "false");
      });
    } else if (this.tracks.length > 1 || this.isGrid) {
      this.listElement.querySelectorAll(".wp-item").forEach((item, i) => {
        const isActive = i === index;
        item.classList.toggle("wp-active", isActive);
        if (isActive) {
          item.setAttribute("aria-current", "true");
        } else {
          item.removeAttribute("aria-current");
        }
      });
    }
    if ((this.isHero || this.isGrid) && this.tracks[index]) {
      const t = this.tracks[index];
      if (this.heroArt && t.artwork) {
        this.heroArt.src = t.artwork;
      }
      if (this.heroTitle) this.heroTitle.textContent = t.title || "";
      if (this.heroSub) this.heroSub.textContent = t.artist || "";
      if (this.heroTime && index !== this._heroTimeIndex) {
        this.heroTime.textContent = "0:00 / " + (t.duration || "0:00");
        this._heroTimeIndex = index;
      }
      if (this.options.expandChapters && this.tracks.length > 1 && this.listElement) {
        this.listElement.querySelectorAll(".wp-chapters").forEach((ch) => {
          ch.style.display = Number(ch.dataset.trackIndex) === index ? "block" : "none";
        });
      }
    }
  }
  /**
   * Handle track end event
   * @private
   */
  onTrackEnd() {
    this.currentChapterIndex = -1;
    this.updateActiveChapter(0);
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
    this.keydownHandler = (e) => {
      const active = document.activeElement;
      const playlistHasFocus = this.container.contains(active);
      const playerHasFocus = !!this.player?.container.contains(active);
      if (!playlistHasFocus && !playerHasFocus) {
        return;
      }
      switch (e.key.toLowerCase()) {
        case "n":
          if (this.tracks.length > 1) {
            e.preventDefault();
            this.nextTrack();
          }
          break;
        case "p":
          if (this.tracks.length > 1) {
            e.preventDefault();
            this.previousTrack();
          }
          break;
      }
      if (this.tracks.length > 1 && playlistHasFocus && !playerHasFocus && e.key >= "1" && e.key <= "9") {
        const index = parseInt(e.key, 10) - 1;
        if (index < this.tracks.length) {
          e.preventDefault();
          this.selectTrack(index);
        }
      }
    };
    document.addEventListener("keydown", this.keydownHandler);
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
    el.setAttribute("role", "button");
    el.tabIndex = 0;
    el.addEventListener("click", onActivate);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        onActivate(e);
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
    const parts = timeStr.split(":").map(Number);
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
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }
  /**
   * Extract title from URL filename
   * @private
   * @param {string} url - Audio file URL
   * @returns {string} Extracted title
   */
  extractTitleFromUrl(url) {
    if (!url) return "Untitled";
    const parts = url.split("/");
    const filename = parts[parts.length - 1];
    return filename.split(".")[0].replace(/[-_]/g, " ");
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
    if (this.keydownHandler) {
      document.removeEventListener("keydown", this.keydownHandler);
      this.keydownHandler = null;
    }
    if (this.player) {
      this.player.destroy();
    }
    this.container.innerHTML = "";
    this.container.classList.remove("waveform-playlist", "wp-minimal");
    this.tracks.forEach((track) => {
      if (track.element) {
        track.element.style.display = "";
      }
    });
    this.player = null;
    this.listElement = null;
    this.tracks = [];
  }
};
function autoInit() {
  if (typeof document === "undefined") return;
  const elements = document.querySelectorAll("[data-waveform-playlist]");
  elements.forEach((element) => {
    if (element.dataset.waveformPlaylistInitialized === "true") return;
    try {
      new WaveformPlaylist(element);
      element.dataset.waveformPlaylistInitialized = "true";
    } catch (error) {
      console.error("[WaveformPlaylist] Failed to initialize:", error);
    }
  });
}
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoInit);
  } else {
    if (typeof window !== "undefined" && window.WaveformPlayer) {
      autoInit();
    } else if (typeof window !== "undefined") {
      const checkInterval = setInterval(() => {
        if (window.WaveformPlayer) {
          clearInterval(checkInterval);
          autoInit();
        }
      }, 100);
      setTimeout(() => clearInterval(checkInterval), 5e3);
    }
  }
}
WaveformPlaylist.init = autoInit;
if (typeof window !== "undefined") {
  window.WaveformPlaylist = WaveformPlaylist;
}
var index_default = WaveformPlaylist;
export {
  WaveformPlaylist,
  index_default as default
};
/**
 * WaveformPlaylist
 * Playlist and chapter navigation for WaveformPlayer
 *
 * @version 1.0.0
 * @author ArrayPress
 * @license MIT
 */
