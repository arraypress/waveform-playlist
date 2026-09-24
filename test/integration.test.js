import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
// The REAL core, from the package — not the sibling repo — so this runs
// against exactly what a consumer installs.
import { WaveformPlayer } from '@arraypress/waveform-player';
import { WaveformPlaylist } from '../src/js/index.js';

/**
 * The playlist against the real @arraypress/waveform-player.
 *
 * test/setup.js installs MockWaveformPlayer on `window` for every file. Importing
 * the package above replaces that global with the real class (the core attaches
 * `window.WaveformPlayer` on import); it's re-asserted below so this file can
 * never silently fall back to the mock. The playlist reads the global at
 * construction time, so import order doesn't matter beyond that.
 *
 * jsdom has no media pipeline, so <audio> gets just enough behaviour for the
 * core's lifecycle to run: play/pause fire their events, `load()` resets the
 * duration, and tests deliver `loadedmetadata` / `error` by hand — which is
 * exactly the control needed to reproduce "the ready event fired before the
 * track loaded" and "the load failed".
 */

const media = HTMLMediaElement.prototype;
const saved = {};

beforeAll(() => {
	window.WaveformPlayer = WaveformPlayer;

	for (const key of ['play', 'pause', 'load', 'duration', 'paused']) {
		saved[key] = Object.getOwnPropertyDescriptor(media, key);
	}
	Object.defineProperty(media, 'duration', { configurable: true, get() { return this._duration ?? NaN; } });
	Object.defineProperty(media, 'paused', { configurable: true, get() { return this._paused ?? true; } });
	media.play = function () {
		this._paused = false;
		this.dispatchEvent(new Event('play'));
		return Promise.resolve();
	};
	media.pause = function () {
		if (this._paused === false) {
			this._paused = true;
			this.dispatchEvent(new Event('pause'));
		}
	};
	media.load = function () { this._duration = NaN; };

	saved.getContext = HTMLCanvasElement.prototype.getContext;
	HTMLCanvasElement.prototype.getContext = () => null; // silence jsdom's "not implemented"
	saved.matchMedia = window.matchMedia;
	window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
	// The core decodes peaks with Web Audio; without it it falls back to a
	// placeholder waveform and says so. Expected here — keep the output clean.
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
	for (const [key, desc] of Object.entries(saved)) {
		if (key === 'getContext') HTMLCanvasElement.prototype.getContext = desc;
		else if (key === 'matchMedia') window.matchMedia = desc;
		else if (desc) Object.defineProperty(media, key, desc);
	}
	vi.restoreAllMocks();
});

const created = [];
afterEach(() => {
	created.splice(0).forEach((pl) => { try { pl.destroy(); } catch {} });
	document.body.innerHTML = '';
});

function mount(html, options = {}, dataset = {}) {
	const container = document.createElement('div');
	Object.assign(container.dataset, dataset);
	container.innerHTML = html;
	document.body.appendChild(container);
	const playlist = new WaveformPlaylist(container, options);
	created.push(playlist);
	return { container, playlist };
}

/** Deliver the browser's metadata for whatever the player's <audio> holds. */
function metadata(player, duration) {
	player.audio._duration = duration;
	player.audio.dispatchEvent(new Event('loadedmetadata'));
}

/** Resolve after the given wall-clock delay (the core's ready event is ~100ms). */
const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

const THREE_TRACKS = `
	<div data-track data-url="/a.mp3" data-title="A" data-duration="3:00"></div>
	<div data-track data-url="/b.mp3" data-title="B" data-duration="5:00">
		<span data-chapter data-time="0:00">B intro</span>
		<span data-chapter data-time="1:00">B main</span>
	</div>
	<div data-track data-url="/c.mp3" data-title="C" data-duration="2:00"></div>
`;

describe('real core: the mock is not standing in', () => {
	it('builds a real WaveformPlayer', () => {
		const { playlist } = mount(THREE_TRACKS);
		expect(playlist.player).toBeInstanceOf(WaveformPlayer);
	});
});

describe('real core: constructor options (finding 1)', () => {
	it('honours the options the framework wrappers pass', () => {
		const { container, playlist } = mount(THREE_TRACKS, {
			showDuration: false,
			expandChapters: false,
			showChapterMarkers: true,
			chapterMarkerColor: 'red',
			audioMode: 'external',
		});
		expect(container.querySelector('.wp-duration')).toBeNull();
		expect(container.querySelector('.wp-chapters')).toBeNull();
		// The playlist always owns its audio.
		expect(playlist.player.options.audioMode).toBe('self');
		expect(playlist.player.audio).toBeInstanceOf(HTMLAudioElement);

		playlist.selectTrack(1);
		expect(playlist.player.options.markers.map((m) => m.color)).toEqual(['red', 'red']);
	});
});

describe('real core: destroy() and rebuild (finding 2)', () => {
	it('keeps the track markup so the same container can be rebuilt', () => {
		const { container, playlist } = mount(THREE_TRACKS, { layout: 'hero' });
		playlist.destroy();

		expect(container.querySelectorAll('[data-track]')).toHaveLength(3);
		expect(container.className).toBe('');

		const again = new WaveformPlaylist(container, { layout: 'hero' });
		created.push(again);
		expect(again.tracks).toHaveLength(3);
		expect(again.player).toBeInstanceOf(WaveformPlayer);
		expect(container.querySelectorAll('.wp-queue-item')).toHaveLength(3);
	});
});

describe('real core: cross-track chapter seek (findings 3 + 4)', () => {
	it('seeks a deep link into another track once THAT track has loaded', async () => {
		const { playlist } = mount(THREE_TRACKS);
		// Straight after construction — before the core's one-off ready event.
		playlist.seekToChapter(1, 60);

		await wait(150); // the ready event has fired; track B has not loaded
		expect(playlist.player.audio.currentTime).toBe(0);

		metadata(playlist.player, 300);
		await vi.waitFor(() => expect(playlist.player.audio.currentTime).toBe(60));
		expect(playlist.player.options.url).toBe('/b.mp3');
	});

	it('does not carry a failed track\'s seek over to the next track', async () => {
		const { playlist } = mount(THREE_TRACKS);
		await wait(150);

		const onError = vi.fn();
		const chainedError = playlist.player.options.onError;
		playlist.player.options.onError = (...args) => { chainedError?.(...args); onError(); };
		playlist.seekToChapter(1, 30);
		playlist.player.audio.dispatchEvent(new Event('error')); // B fails
		await vi.waitFor(() => expect(onError).toHaveBeenCalled());

		const onLoad = vi.fn();
		const chainedLoad = playlist.player.options.onLoad;
		playlist.player.options.onLoad = (...args) => { chainedLoad?.(...args); onLoad(); };
		playlist.selectTrack(2);
		metadata(playlist.player, 120); // C loads fine
		await vi.waitFor(() => expect(onLoad).toHaveBeenCalled());

		expect(playlist.player.options.url).toBe('/c.mp3');
		expect(playlist.player.audio.currentTime).toBe(0);
	});
});

describe('real core: preload="none" chapter seek (finding 11)', () => {
	it('starts playback and seeks once metadata arrives', async () => {
		const html = `
			<div data-track data-url="/show.mp3" data-title="Show">
				<span data-chapter data-time="0:00">Intro</span>
				<span data-chapter data-time="1:30">Main</span>
			</div>
		`;
		const { container, playlist } = mount(html, {}, { preload: 'none' });
		await wait(50);
		expect(playlist.player.audio.preload).toBe('none');

		container.querySelectorAll('.wp-chapter-item')[1].click();
		expect(playlist.player.audio.paused).toBe(false); // play() requested
		metadata(playlist.player, 600);
		expect(playlist.player.audio.currentTime).toBe(90);
	});
});
