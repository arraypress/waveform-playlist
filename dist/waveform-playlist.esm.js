// src/js/index.js
var ARTWORK_FALLBACK = "data:image/svg+xml," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="4" fill="#71717a" fill-opacity="0.15"/><g fill="none" stroke="#a1a1aa" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="17" r="2.2"/><circle cx="17" cy="15" r="2.2"/><path d="M10.2 17V7l9-1.6v9"/></g></svg>'
);
var PLAYLIST_OWN_OPTIONS = [
  "layout",
  "continuous",
  "expandChapters",
  "showDuration",
  "showPlayState",
  "showArtist",
  "coverSize",
  "thumbnailSize",
  "density",
  "coverPosition",
  "barPosition",
  "showChapterMarkers",
  "chapterMarkerColor"
];
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
   * @param {string} [options.layout='list'] - Layout style: 'list', 'minimal', 'hero' or 'grid'
   * @param {boolean} [options.continuous=false] - Auto-advance to next track
   * @param {boolean} [options.expandChapters=true] - Show chapters under tracks
   * @param {boolean} [options.showDuration=true] - Display track durations
   * @param {boolean|null} [options.showChapterMarkers=null] - Show chapters as waveform markers (null = smart default)
   * @param {string} [options.chapterMarkerColor='rgba(161, 161, 170, 0.85)'] - Default color for chapter markers
   * @param {boolean} [options.showPlayState=true] - Show play/pause icon on active track artwork
   * @param {boolean} [options.showArtist=true] - Show the now-playing / per-row artist
   * @param {number} [options.coverSize] - Hero cover size in px
   * @param {number} [options.thumbnailSize] - Queue thumbnail / grid cover size in px
   * @param {string} [options.density='comfortable'] - Row density: 'comfortable' or 'compact'
   * @param {string} [options.coverPosition='left'] - Hero cover position: 'left' or 'top'
   * @param {string} [options.barPosition='bottom'] - Grid now-playing bar position: 'top' or 'bottom'
   *
   * Any other option is forwarded to the embedded WaveformPlayer, including
   * its callbacks (chained after the playlist's own). `audioMode` is ignored:
   * the playlist always owns its audio.
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
    this.pending = null;
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
    const ds = container.dataset;
    const options = { ...providedOptions };
    delete options.audioMode;
    const fromData = this.parsePlayerDataAttributes(container);
    ["audioMode", "url", "title", "artist", "album", "artwork", "markers", "waveform"].forEach((key) => delete fromData[key]);
    Object.assign(options, fromData);
    const flag = (key, fallback) => ds[key] !== void 0 ? ds[key] !== "false" : options[key] ?? fallback;
    options.layout = ds.layout || options.layout || "list";
    options.continuous = flag("continuous", false);
    options.expandChapters = flag("expandChapters", true);
    options.showDuration = flag("showDuration", true);
    options.showPlayState = flag("showPlayState", true);
    options.showArtist = flag("showArtist", true);
    options.coverSize = parseInt(ds.coverSize, 10) || options.coverSize || null;
    options.thumbnailSize = parseInt(ds.thumbnailSize, 10) || options.thumbnailSize || null;
    options.density = ds.density || options.density || "comfortable";
    options.coverPosition = ds.coverPosition || options.coverPosition || "left";
    options.barPosition = ds.barPosition || options.barPosition || "bottom";
    options.showChapterMarkers = flag("showChapterMarkers", null);
    options.chapterMarkerColor = ds.chapterMarkerColor || options.chapterMarkerColor || "rgba(161, 161, 170, 0.85)";
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
      if (ds[k]) opts[o] = ds[k];
    };
    const bool = (k, o = k) => {
      if (ds[k] !== void 0) opts[o] = ds[k] === "true";
    };
    const color = (k, o = k) => {
      if (!ds[k]) return;
      let value = ds[k];
      if (value.trim().startsWith("[")) {
        try {
          value = JSON.parse(value);
        } catch (e) {
        }
      }
      opts[o] = value;
    };
    const length = (k, o = k) => {
      if (!ds[k]) return;
      opts[o] = /^\d+(\.\d+)?$/.test(ds[k].trim()) ? parseFloat(ds[k]) : ds[k];
    };
    const num = (k, o, parse) => {
      if (!ds[k]) return;
      const n = parse(ds[k]);
      if (Number.isFinite(n)) opts[o] = n;
      else console.warn(`[WaveformPlaylist] Invalid ${k} attribute, expected a number:`, ds[k]);
    };
    const int = (k, o = k) => num(k, o, (v) => parseInt(v, 10));
    const float = (k, o = k) => num(k, o, parseFloat);
    const jsonArray = (k, o = k) => {
      if (!ds[k]) return;
      let parsed;
      try {
        parsed = JSON.parse(ds[k]);
      } catch (e) {
        console.warn(`[WaveformPlaylist] Invalid ${k} JSON:`, e);
        return;
      }
      if (Array.isArray(parsed)) opts[o] = parsed;
      else console.warn(`[WaveformPlaylist] Invalid ${k} attribute, expected a JSON array:`, ds[k]);
    };
    str("style", "waveformStyle");
    str("waveformStyle");
    str("waveformGradient");
    int("barWidth");
    int("barSpacing");
    int("barRadius");
    str("buttonAlign");
    str("buttonStyle");
    length("buttonSize");
    length("buttonRadius");
    int("height");
    int("samples");
    str("preload");
    str("crossOrigin");
    str("artworkPosition");
    str("colorPreset");
    color("waveformColor");
    color("progressColor");
    str("color", "waveformColor");
    str("theme", "colorPreset");
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
    bool("seekHandle");
    bool("showBpm", "showBPM");
    int("bpm");
    bool("singlePlay");
    bool("playOnSeek");
    bool("showPlaybackSpeed");
    bool("enableMediaSession");
    bool("showMarkers");
    bool("accessibleSeek");
    float("playbackRate");
    jsonArray("playbackRates");
    str("seekLabel");
    str("seekValueText");
    str("errorText");
    str("playPauseLabel");
    str("speedLabel");
    str("artworkAlt");
    str("unknownTrackText");
    str("playIcon");
    str("pauseIcon");
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
      console.warn("[WaveformPlaylist] Invalid markers JSON:", e);
      return [];
    }
    if (!Array.isArray(parsed)) {
      console.warn("[WaveformPlaylist] Invalid markers attribute, expected a JSON array:", raw);
      return [];
    }
    return parsed.map((m) => m && typeof m === "object" ? { ...m, time: Number(m.time) } : null).filter((m) => m && Number.isFinite(m.time));
  }
  /**
   * Parse a track's `data-waveform` peaks.
   *
   * A JSON array is parsed here so a typo costs that one track its peaks
   * (the player then decodes the audio) rather than reaching the player as
   * a string; anything else — a `.json` peaks URL, or a comma-separated
   * list — is passed through for the core to resolve, which it already does.
   *
   * @private
   * @param {string|undefined} raw - Raw `data-waveform` value.
   * @returns {number[]|string|undefined} Peaks, a peaks source, or undefined.
   */
  parseWaveform(raw) {
    const value = (raw || "").trim();
    if (!value) return void 0;
    if (!value.startsWith("[")) return value;
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {
    }
    console.warn("[WaveformPlaylist] Invalid waveform attribute, expected a JSON array of peaks or a peaks URL:", raw);
    return void 0;
  }
  /**
   * Parse tracks and chapters from container markup
   * @private
   */
  parseTracks() {
    const trackElements = this.container.querySelectorAll("[data-track]");
    this.tracks = Array.from(trackElements).map((el, index) => {
      const chapters = Array.from(el.querySelectorAll("[data-chapter]")).map((ch) => {
        const label = ch.textContent.trim();
        if (!(ch.dataset.time || "").trim()) {
          console.warn(`[WaveformPlaylist] Chapter "${label}" has no data-time; placing it at 0:00.`);
        }
        return {
          time: this.parseTime(ch.dataset.time || "0:00"),
          label,
          color: ch.dataset.color,
          element: ch
        };
      }).sort((a, b) => a.time - b.time);
      return {
        element: el,
        index,
        url: el.dataset.url,
        title: el.dataset.title || this.extractTitleFromUrl(el.dataset.url),
        artist: el.dataset.artist || "",
        artwork: el.dataset.artwork,
        album: el.dataset.album,
        duration: el.dataset.duration,
        waveform: this.parseWaveform(el.dataset.waveform),
        chapters,
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
    this.ownNodes = [];
    this.ownClasses = [];
    this.addOwnClass("waveform-playlist");
    if (this.isMinimal) {
      this.addOwnClass("wp-minimal");
    }
    if (this.isHero || this.isGrid) {
      this.addOwnClass("wp-hero-layout");
    }
    if (this.isGrid) {
      this.addOwnClass("wp-grid-layout");
    }
    if (this.options.density === "compact") {
      this.addOwnClass("wp-density-compact");
    }
    if ((this.isHero || this.isGrid) && this.options.coverPosition === "top") {
      this.addOwnClass("wp-cover-top");
    }
    if (!this.options.showArtist) {
      this.addOwnClass("wp-no-artist");
    }
    this.trackDisplay = /* @__PURE__ */ new Map();
    this.tracks.forEach((track) => {
      if (track.element) {
        this.trackDisplay.set(track.element, track.element.style.display);
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
      this.appendOwn(playerContainer);
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
   * Append a generated node to the container and record it for destroy().
   * @private
   * @param {HTMLElement} node
   */
  appendOwn(node) {
    this.container.appendChild(node);
    this.ownNodes.push(node);
  }
  /**
   * Add a class to the container and record it for destroy() — unless the
   * author already set it, in which case it isn't ours to remove.
   * @private
   * @param {string} name
   */
  addOwnClass(name) {
    if (this.container.classList.contains(name)) return;
    this.container.classList.add(name);
    this.ownClasses.push(name);
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
    this.setHeroArt(first.artwork);
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
    this.appendOwn(hero);
  }
  /**
   * Show `src` on the hero cover, or hide the cover art when the track has
   * none. The `<img>` is created on first use: it used to exist only when
   * the FIRST track had artwork, so a playlist opening on an artless track
   * never showed any later cover — and one that did kept showing the
   * previous cover on an artless track. No-op without a hero cover (grid).
   * @private
   * @param {string|undefined} src - Artwork URL.
   */
  setHeroArt(src) {
    if (!this.heroCover) return;
    if (src) {
      if (!this.heroArt) {
        const img = document.createElement("img");
        img.className = "wp-hero-art";
        img.alt = "";
        applyArtFallback(img);
        this.heroCover.insertBefore(img, this.heroCover.firstChild);
        this.heroArt = img;
      }
      this.heroArt.style.display = "";
      if (this.heroArt.getAttribute("src") !== src) this.heroArt.src = src;
    } else if (this.heroArt) {
      this.heroArt.style.display = "none";
      this.heroArt.removeAttribute("src");
    }
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
    this.appendOwn(bar);
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
    this.appendOwn(listContainer);
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
    this.appendOwn(gridContainer);
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
    if (this.options.showChapterMarkers === null) {
      this.options.showChapterMarkers = this.tracks.length === 1 && firstTrack.chapters.length > 0;
    }
    const forwarded = { ...this.options };
    PLAYLIST_OWN_OPTIONS.forEach((key) => delete forwarded[key]);
    const playerOptions = {
      ...forwarded,
      url: firstTrack.url,
      title: firstTrack.title,
      artist: firstTrack.artist,
      ...this.trackPlayerOptions(firstTrack),
      // Hero layout drives a waveform-ONLY player: the cover (with its
      // play/pause overlay), the time readout and the queue are this
      // component's own chrome, so suppress the player's button + info row.
      ...this.isHero || this.isGrid ? { showControls: false, showInfo: false } : {},
      // Set once here: the core's loadTrack() merges new options over the
      // old, so these survive every track change.
      ...this.playerCallbacks()
    };
    this.player = new window.WaveformPlayer(container, playerOptions);
    if (!this.isHero && !this.isGrid) {
      container.classList.add("wp-player");
    }
    this.setActiveTrack(0);
    this.updateActiveChapter(0);
  }
  /**
   * The per-track options handed to the player — on construction for the
   * first track, via loadTrack() for every later one — so the two paths can't
   * drift apart.
   *
   * Every key is always present, because the core merges loadTrack() options
   * over the previous track's and skips `undefined`: an absent album used to
   * leave the previous track's album on the lock screen / Media Session.
   * The core itself resets `artwork` (removed when falsy), `markers` and
   * `waveform` (falsy = decode from the audio) per load.
   *
   * @private
   * @param {Object} track - Parsed track.
   * @returns {{markers: Array<Object>, artwork: (string|undefined), album: string, waveform: (string|number[]|undefined)}}
   */
  trackPlayerOptions(track) {
    let markers = track.markers;
    if (this.options.showChapterMarkers && track.chapters.length > 0 && markers.length === 0) {
      markers = track.chapters.map((ch) => ({
        time: ch.time,
        label: ch.label,
        color: ch.color || this.options.chapterMarkerColor
      }));
    }
    return {
      markers,
      artwork: track.artwork,
      album: track.album || "",
      waveform: track.waveform
    };
  }
  /**
   * The player callbacks the playlist drives itself off.
   *
   * Every core callback is a documented pass-through option, and the wrappers
   * rely on that (the Svelte one maps its on:play/on:pause/on:end/
   * on:timeupdate onto them), so a user-supplied callback is chained to run
   * AFTER the playlist's own handling instead of being overwritten by it.
   *
   * @private
   * @returns {Object} Callback options for the WaveformPlayer.
   */
  playerCallbacks() {
    const user = this.options;
    const chain = (name, own) => (...args) => {
      own(...args);
      if (typeof user[name] === "function") user[name](...args);
    };
    return {
      onLoad: chain("onLoad", (player) => this.resolvePending(player)),
      // The core never calls onLoad for a failed load, so a seek waiting
      // on it would otherwise stay armed and fire on the next track.
      onError: chain("onError", () => this.cancelPending()),
      onEnd: chain("onEnd", () => this.onTrackEnd()),
      onNextTrack: chain("onNextTrack", () => this.nextTrack()),
      onPreviousTrack: chain("onPreviousTrack", () => this.previousTrack()),
      onTimeUpdate: chain("onTimeUpdate", (current, total) => {
        this.checkChapterRange(total);
        this.updateActiveChapter(current);
        if (this.isHero || this.isGrid) this.updateHeroTime(current, total);
      }),
      onPlay: chain("onPlay", () => {
        this.isPlaying = true;
        this.setActiveTrack(this.currentTrackIndex);
        this.updatePlayState();
      }),
      onPause: chain("onPause", () => {
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
      })
    };
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
    this.listElement.querySelectorAll(".wp-artwork-container").forEach((container) => {
      const row = container.closest("[data-index]");
      const isActive = !!row && Number(row.dataset.index) === this.currentTrackIndex;
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
    for (let i = 0; i < track.chapters.length; i++) {
      const time = track.chapters[i].time;
      if (time > currentTime) break;
      if (activeChapterIndex === -1 || time !== track.chapters[activeChapterIndex].time) {
        activeChapterIndex = i;
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
   * Warn (once per track) about chapters that start beyond the track's end —
   * a typo'd `data-time` that can never become active. Only checkable once
   * the real duration is known, hence the time-update hook.
   * @private
   * @param {number} duration - Track duration in seconds.
   */
  checkChapterRange(duration) {
    const index = this.currentTrackIndex;
    const track = this.tracks[index];
    if (!track || !(duration > 0) || !Number.isFinite(duration)) return;
    this.rangeChecked = this.rangeChecked || /* @__PURE__ */ new Set();
    if (this.rangeChecked.has(index)) return;
    this.rangeChecked.add(index);
    track.chapters.filter((ch) => ch.time > duration).forEach((ch) => {
      console.warn(`[WaveformPlaylist] Chapter "${ch.label}" starts at ${this.formatTime(ch.time)}, after the end of "${track.title}" (${this.formatTime(duration)}).`);
    });
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
      this.makeActivatable(item, () => this.seekToChapter(0, chapter.time));
      list.appendChild(item);
    });
    listContainer.appendChild(list);
    this.appendOwn(listContainer);
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
    this.appendOwn(listContainer);
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
    this.appendOwn(controls);
    this.listElement = controls;
  }
  /**
   * Select and load a track
   * @public
   * @param {number} index - Track index to select
   */
  selectTrack(index) {
    this.loadTrackAt(index, null);
  }
  /**
   * Select and load a track, optionally running `onLoaded` once THAT track
   * has loaded.
   *
   * The callback is registered before loadTrack() is called: the core can
   * report a load synchronously (preload="none" with inline peaks skips
   * every await), so registering afterwards could miss it.
   *
   * @private
   * @param {number} index - Track index to select
   * @param {Function|null} onLoaded - Run after the track's onLoad
   */
  loadTrackAt(index, onLoaded) {
    if (index < 0 || index >= this.tracks.length) return;
    const track = this.tracks[index];
    this.currentTrackIndex = index;
    this.currentChapterIndex = -1;
    this.cancelPending();
    if (onLoaded) {
      this.pending = { url: track.url, onLoad: onLoaded };
    }
    if (this.player) {
      this.player.loadTrack(track.url, track.title, track.artist, this.trackPlayerOptions(track));
    }
    this.setActiveTrack(index);
    this.clearChapterHighlights();
  }
  /**
   * Remove the active styling / `aria-current` from every chapter row.
   * @private
   */
  clearChapterHighlights() {
    if (!this.listElement) return;
    this.listElement.querySelectorAll(".wp-chapter, .wp-chapter-item").forEach((item) => {
      this.setChapterActive(item, false);
    });
  }
  /**
   * Seek to a specific chapter within a track
   * @public
   * @param {number} trackIndex - Track index
   * @param {number} time - Time in seconds to seek to
   */
  seekToChapter(trackIndex, time) {
    if (!this.player) return;
    if (trackIndex === this.currentTrackIndex) {
      this.cancelPending();
      this.seekAndPlay(time);
      return;
    }
    this.loadTrackAt(trackIndex, () => this.seekAndPlay(time));
  }
  /**
   * Seek the current track to `time` and make sure it's playing.
   *
   * The core's seekTo() is a no-op until the duration is known, which with
   * `preload="none"` is not until playback starts. In that case playback is
   * started — which fetches the metadata — and the seek runs on
   * `loadedmetadata` (cancelled like any other pending action).
   *
   * @private
   * @param {number} time - Time in seconds
   */
  seekAndPlay(time) {
    const player = this.player;
    if (!player) return;
    const audio = player.audio;
    if (audio && !(audio.duration > 0) && typeof audio.addEventListener === "function") {
      const pending = {
        cleanup: () => audio.removeEventListener("loadedmetadata", onMetadata)
      };
      const onMetadata = () => {
        if (this.pending !== pending) return;
        this.cancelPending();
        player.seekTo(time);
      };
      this.cancelPending();
      this.pending = pending;
      audio.addEventListener("loadedmetadata", onMetadata);
      if (!player.isPlaying) player.play();
      return;
    }
    player.seekTo(time);
    if (!player.isPlaying) {
      player.play();
    }
  }
  /**
   * Resolve the pending post-load action, if the load that just finished is
   * the one it was waiting for. Wired to the player's `onLoad`.
   * @private
   * @param {Object} [player] - The player that loaded.
   */
  resolvePending(player) {
    const pending = this.pending;
    if (!pending || !pending.onLoad) return;
    const url = player && player.options ? player.options.url : void 0;
    if (url !== void 0 && url !== pending.url) return;
    this.pending = null;
    pending.onLoad();
  }
  /**
   * Drop the pending post-load action (there is only ever one). Called when
   * another track is selected, when a load fails, and on destroy().
   * @private
   */
  cancelPending() {
    const pending = this.pending;
    this.pending = null;
    if (pending && pending.cleanup) pending.cleanup();
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
      this.setHeroArt(t.artwork);
      if (this.heroTitle) this.heroTitle.textContent = t.title || "";
      if (this.heroSub) this.heroSub.textContent = t.artist || "";
      if (this.heroTime && index !== this._heroTimeIndex) {
        this.heroTime.textContent = "0:00 / " + (t.duration || "0:00");
        this._heroTimeIndex = index;
      }
    }
    if (this.options.expandChapters && this.tracks.length > 1 && this.listElement) {
      this.listElement.querySelectorAll(".wp-chapters").forEach((ch) => {
        ch.style.display = Number(ch.dataset.trackIndex) === index ? "block" : "none";
      });
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
      if (e.ctrlKey || e.metaKey || e.altKey) {
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
   *
   * A `data-time` an author mistyped (`"1:ab"`, `"soon"`) used to yield NaN
   * for the two-part form, which then rendered as `NaN` in the chapter list
   * and positioned the chapter marker at `left: NaN%`. Anything unparseable
   * is 0 — the start of the track — rather than a value that poisons every
   * calculation it touches.
   *
   * Hour-long chapters need `H:MM:SS`, which used to read as just the hour
   * (`"1:05:30"` → 1 second).
   *
   * @private
   * @param {string} timeStr - Time string: "SS", "M:SS" or "H:MM:SS"
   * @returns {number} Time in seconds, or 0 when unparseable
   */
  parseTime(timeStr) {
    const parts = String(timeStr ?? "").trim().split(":");
    if (parts.length > 3 || parts.length > 1 && parts.some((p) => p.trim() === "")) return 0;
    const seconds = parts.reduce((acc, p) => acc * 60 + Number(p), 0);
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
    this.cancelPending();
    if (this.player) {
      this.player.destroy();
    }
    (this.ownNodes || []).forEach((node) => node.remove());
    this.container.classList.remove(...this.ownClasses || []);
    delete this.container.dataset.waveformPlaylistInitialized;
    this.tracks.forEach((track) => {
      if (track.element) {
        track.element.style.display = this.trackDisplay && this.trackDisplay.get(track.element) || "";
      }
    });
    this.player = null;
    this.listElement = null;
    this.ownNodes = [];
    this.ownClasses = [];
    this.trackDisplay = null;
    this.heroCover = this.heroArt = this.heroIcon = null;
    this.heroTitle = this.heroSub = this.heroTime = null;
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
