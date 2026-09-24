// WaveformPlaylist is a thin controller over a WaveformPlayer instance it
// constructs from `window.WaveformPlayer`. The real core needs Web Audio /
// canvas decoding that jsdom can't provide, so most tests run against this
// stand-in instead. It records the calls the playlist makes and exposes the
// option callbacks (onPlay/onPause/onLoad) the playlist wires up, so behaviour
// — not pixels — can be asserted. test/integration.test.js covers the same
// lifecycle against the real core.
//
// The stand-in has to be FAITHFUL where the playlist depends on the core's
// timing, or it hides bugs — an earlier version called onLoad synchronously,
// never failed, seeked without a duration and merged `undefined` over earlier
// options, and every one of those masked a real defect. So, like the core:
//   - loading is async: `onLoad` fires on a later microtask, after
//     `loadedmetadata`, never inside the loadTrack() call;
//   - a load can fail (`MockWaveformPlayer.failingUrls`): `onError` fires and
//     `onLoad` never does;
//   - `seekTo()` is a no-op until the duration is known, and `preload: 'none'`
//     leaves it unknown until play() fetches metadata;
//   - options merge with the core's `mergeOptions` semantics (null/undefined
//     never overwrite an earlier value);
//   - `waveformplayer:ready` is emitted ONCE, ~100ms after construction, and
//     never after a later load.
//
// Installed on `window` BEFORE the source module is imported so the playlist's
// auto-init dependency check passes and no readiness-polling interval is armed.

/** The core's `mergeOptions`: later sources win, nullish values are skipped. */
function mergeOptions(...sources) {
	const result = {};
	for (const source of sources) {
		for (const key in source) {
			if (source[key] !== null && source[key] !== undefined) result[key] = source[key];
		}
	}
	return result;
}

/** Minimal `<audio>` stand-in: the fields the playlist reads, plus events. */
class MockAudio extends EventTarget {
	constructor() {
		super();
		this.src = '';
		this.currentTime = 0;
		this.duration = NaN;
		this.paused = true;
		this.preload = 'metadata';
	}
}

/** Resolve after pending microtasks and zero-delay timers have run. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

export class MockWaveformPlayer {
	constructor(container, options = {}) {
		this.container = container;
		this.options = mergeOptions(options);
		this.isPlaying = false;
		this.audio = new MockAudio();
		if (this.options.preload) this.audio.preload = this.options.preload;
		this.calls = { seekTo: [], play: 0, pause: 0, loadTrack: [], destroy: 0 };
		MockWaveformPlayer.instances.push(this);

		// The core loads its initial url asynchronously (rAF + metadata wait).
		if (this.options.url) this._load(this.options.url);

		// ...and emits `waveformplayer:ready` exactly once, ~100ms after
		// construction — NOT after each load. Code that treats it as a
		// load-complete signal is wrong against the real core.
		this._readyTimer = setTimeout(() => {
			this.container.dispatchEvent(new CustomEvent('waveformplayer:ready', {
				bubbles: true,
				detail: { player: this, url: this.options.url },
			}));
		}, 100);
	}

	/** Mirrors core `load()`: async, metadata first, then onLoad (or onError). */
	async _load(url) {
		const seq = (this._loadSeq = (this._loadSeq || 0) + 1);
		this.audio.src = url;
		this.audio.duration = NaN;
		this.audio.currentTime = 0;

		await Promise.resolve();
		// A newer load superseded this one; the core's metadata handler would
		// resolve on the NEW track's metadata, so just let the newer one report.
		if (seq !== this._loadSeq || this.destroyed) return;

		if (MockWaveformPlayer.failingUrls.has(url)) {
			if (typeof this.options.onError === 'function') {
				this.options.onError(new Error(`Failed to load ${url}`), this);
			}
			return;
		}

		// preload="none": the core skips the metadata wait and reports loaded
		// with the duration still unknown; play() fetches it later.
		if (this.audio.preload !== 'none') this._metadata(url);

		if (typeof this.options.onLoad === 'function') this.options.onLoad(this);
	}

	_metadata(url) {
		this.audio.duration = MockWaveformPlayer.durations[url] ?? 100;
		this.audio.dispatchEvent(new Event('loadedmetadata'));
	}

	/** Core `seekTo`: clamped, and a no-op until the duration is known. */
	seekTo(time) {
		this.calls.seekTo.push(time);
		if (this.audio.duration) {
			this.audio.currentTime = Math.min(Math.max(time, 0), this.audio.duration);
		}
	}

	play() {
		this.calls.play++;
		this.isPlaying = true;
		this.audio.paused = false;
		// preload="none" defers the metadata fetch until playback is requested.
		if (!this.audio.duration && this.audio.src && !MockWaveformPlayer.failingUrls.has(this.audio.src)) {
			const url = this.audio.src;
			Promise.resolve().then(() => {
				if (this.audio.src === url && !this.audio.duration && !this.destroyed) this._metadata(url);
			});
		}
		if (typeof this.options.onPlay === 'function') this.options.onPlay(this);
		return Promise.resolve();
	}

	pause() {
		this.calls.pause++;
		this.isPlaying = false;
		this.audio.paused = true;
		if (typeof this.options.onPause === 'function') this.options.onPause(this);
	}

	/** Core `loadTrack`: merge (nullish-skipping), reset per-track state, load, autoplay. */
	async loadTrack(url, title = null, artist = null, options = {}) {
		this.calls.loadTrack.push({ url, title, artist, options });
		if (this.isPlaying) this.pause();

		this.options = mergeOptions(this.options, {
			url,
			title: title === null ? this.options.title : title,
			artist: artist === null ? this.options.artist : artist,
			...options,
		});
		if (Object.prototype.hasOwnProperty.call(options, 'artwork')) {
			this.options.artwork = options.artwork || null;
		}
		if (options.preload) this.audio.preload = options.preload;
		// The core clears per-track markers/peaks rather than inheriting them.
		this.options.markers = options.markers || [];
		this.options.waveform = options.waveform || null;

		await this._load(url);
		if (options.autoplay !== false && !this.destroyed) this.play();
	}

	destroy() {
		this.calls.destroy++;
		this.destroyed = true;
		clearTimeout(this._readyTimer);
		// The core empties its own container on teardown.
		this.container.innerHTML = '';
	}
}

MockWaveformPlayer.instances = [];
/** URLs whose load fails (onError, never onLoad). Reset per test. */
MockWaveformPlayer.failingUrls = new Set();
/** Per-URL duration once metadata loads; defaults to 100s. */
MockWaveformPlayer.durations = {};

window.WaveformPlayer = MockWaveformPlayer;
