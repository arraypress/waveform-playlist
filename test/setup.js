// WaveformPlaylist is a thin controller over a WaveformPlayer instance it
// constructs from `window.WaveformPlayer`. The real core needs Web Audio /
// canvas decoding that jsdom can't provide, so tests run against this faithful
// stand-in instead. It records the calls the playlist makes and exposes the
// option callbacks (onPlay/onPause/onLoad) the playlist wires up, so behaviour
// — not pixels — can be asserted.
//
// Installed on `window` BEFORE the source module is imported so the playlist's
// auto-init dependency check passes and no readiness-polling interval is armed.

export class MockWaveformPlayer {
	constructor(container, options = {}) {
		this.container = container;
		this.options = { ...options };
		this.isPlaying = false;
		// Mirrors the core's <audio>; used by the playlist's end-of-track reset.
		this.audio = { currentTime: 0, duration: 100 };
		this.calls = { seekTo: [], play: 0, pause: 0, loadTrack: [], destroy: 0 };
		MockWaveformPlayer.instances.push(this);
	}

	seekTo(time) {
		this.calls.seekTo.push(time);
	}

	play() {
		this.calls.play++;
		this.isPlaying = true;
		if (typeof this.options.onPlay === 'function') this.options.onPlay();
		return Promise.resolve();
	}

	pause() {
		this.calls.pause++;
		this.isPlaying = false;
		if (typeof this.options.onPause === 'function') this.options.onPause();
	}

	loadTrack(url, title = null, artist = null, options = {}) {
		this.calls.loadTrack.push({ url, title, artist, options });
		// Merge as the core does, preserving prior options (incl. onLoad set by
		// the playlist's whenPlayerReady before this call).
		this.options = { ...this.options, url, title, artist, ...options };
		// The core auto-plays a freshly loaded track and signals readiness; do
		// the same so cross-track seek + continuous advance paths are exercised.
		if (typeof this.options.onLoad === 'function') this.options.onLoad(this);
	}

	destroy() {
		this.calls.destroy++;
	}
}

MockWaveformPlayer.instances = [];

window.WaveformPlayer = MockWaveformPlayer;
