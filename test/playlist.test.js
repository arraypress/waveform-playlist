import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockWaveformPlayer, settle } from './setup.js';
import { WaveformPlaylist } from '../src/js/index.js';

/**
 * These exercise the playlist controller in jsdom against the MockWaveformPlayer
 * installed in setup.js. They focus on parsing, navigation, the keyboard
 * contract, accessibility attributes, and teardown — not on audio or pixels.
 */

const created = [];

/** Build a container from HTML, append it, and return a constructed playlist. */
function mount(html, options = {}) {
	const container = document.createElement('div');
	container.innerHTML = html;
	document.body.appendChild(container);
	const playlist = new WaveformPlaylist(container, options);
	created.push(playlist);
	return { container, playlist };
}

const TWO_TRACKS = `
	<div data-track data-url="/audio/a.mp3" data-title="Track A" data-artist="Artist A" data-artwork="/art/a.jpg" data-duration="3:00"></div>
	<div data-track data-url="/audio/b.mp3" data-title="Track B" data-duration="4:30"></div>
`;

const SINGLE_WITH_CHAPTERS = `
	<div data-track data-url="/audio/show.mp3" data-title="The Show">
		<span data-chapter data-time="0:00">Intro</span>
		<span data-chapter data-time="1:30">Main</span>
		<span data-chapter data-time="3:00">Outro</span>
	</div>
`;

beforeEach(() => {
	MockWaveformPlayer.instances = [];
	MockWaveformPlayer.failingUrls = new Set();
	MockWaveformPlayer.durations = {};
	MockWaveformPlayer.loadDelays = {};
});

afterEach(() => {
	// destroy() removes the document-level keydown listener, preventing
	// cross-test leakage between playlist instances.
	created.splice(0).forEach((pl) => { try { pl.destroy(); } catch {} });
	document.body.innerHTML = '';
	// Some tests attach a utils bridge to the mock core; reset it so others
	// exercise the local fallback parser.
	delete MockWaveformPlayer.utils;
});

/** Build a container with data-* attributes and tracks, and construct a playlist. */
function mountWithData(dataset, html = TWO_TRACKS, options = {}) {
	const container = document.createElement('div');
	Object.assign(container.dataset, dataset);
	container.innerHTML = html;
	document.body.appendChild(container);
	const playlist = new WaveformPlaylist(container, options);
	created.push(playlist);
	return { container, playlist };
}

describe('parsing', () => {
	it('parses tracks from [data-track] markup', () => {
		const { playlist } = mount(TWO_TRACKS);
		expect(playlist.tracks).toHaveLength(2);
		expect(playlist.tracks[0].title).toBe('Track A');
		expect(playlist.tracks[0].artist).toBe('Artist A');
		expect(playlist.tracks[1].url).toBe('/audio/b.mp3');
	});

	it('falls back to a title derived from the URL when none is given', () => {
		const { playlist } = mount('<div data-track data-url="/songs/my-great_song.mp3"></div>');
		expect(playlist.tracks[0].title).toBe('my great song');
	});

	it('parses chapters with time in seconds and label text', () => {
		const { playlist } = mount(SINGLE_WITH_CHAPTERS);
		const chapters = playlist.tracks[0].chapters;
		expect(chapters).toHaveLength(3);
		expect(chapters[1]).toMatchObject({ time: 90, label: 'Main' });
	});

	it('does not initialise when there are no tracks', () => {
		const { playlist, container } = mount('<p>nothing here</p>');
		expect(playlist.tracks).toHaveLength(0);
		expect(playlist.player).toBeNull();
		expect(container.querySelector('.wp-list')).toBeNull();
	});
});

describe('time helpers', () => {
	it('parseTime handles M:SS and bare seconds', () => {
		const { playlist } = mount(TWO_TRACKS);
		expect(playlist.parseTime('2:05')).toBe(125);
		expect(playlist.parseTime('45')).toBe(45);
	});

	it('formatTime zero-pads seconds', () => {
		const { playlist } = mount(TWO_TRACKS);
		expect(playlist.formatTime(125)).toBe('2:05');
		expect(playlist.formatTime(9)).toBe('0:09');
	});

	it('extractTitleFromUrl strips path, extension and separators', () => {
		const { playlist } = mount(TWO_TRACKS);
		expect(playlist.extractTitleFromUrl('/a/b/cool-track_01.mp3')).toBe('cool track 01');
		expect(playlist.extractTitleFromUrl(undefined)).toBe('Untitled');
	});
});

describe('track list accessibility', () => {
	it('renders the list as a labelled list of button rows', () => {
		const { container } = mount(TWO_TRACKS);
		const list = container.querySelector('.wp-list');
		expect(list.getAttribute('aria-label')).toBe('Playlist');

		const items = container.querySelectorAll('.wp-item');
		expect(items).toHaveLength(2);
		items.forEach((item) => {
			expect(item.getAttribute('role')).toBe('button');
			expect(item.tabIndex).toBe(0);
		});
	});

	it('marks the active track with aria-current', () => {
		const { container } = mount(TWO_TRACKS);
		const items = container.querySelectorAll('.wp-item');
		expect(items[0].getAttribute('aria-current')).toBe('true');
		expect(items[1].hasAttribute('aria-current')).toBe(false);
	});

	it('treats artwork as decorative and hides the number indicator from AT', () => {
		const { container } = mount(TWO_TRACKS);
		// Track A has artwork; Track B has a number indicator.
		const artwork = container.querySelector('.wp-artwork');
		expect(artwork.getAttribute('alt')).toBe('');
		const indicator = container.querySelector('.wp-indicator');
		expect(indicator.getAttribute('aria-hidden')).toBe('true');
	});
});

describe('track interaction', () => {
	it('selects a different track on click and moves aria-current', () => {
		const { container, playlist } = mount(TWO_TRACKS);
		const items = container.querySelectorAll('.wp-item');
		items[1].click();

		expect(playlist.currentTrackIndex).toBe(1);
		expect(playlist.player.calls.loadTrack).toHaveLength(1);
		expect(playlist.player.calls.loadTrack[0].url).toBe('/audio/b.mp3');
		expect(items[1].getAttribute('aria-current')).toBe('true');
		expect(items[0].hasAttribute('aria-current')).toBe(false);
	});

	it('toggles play/pause when the active track is clicked', () => {
		const { container, playlist } = mount(TWO_TRACKS);
		const first = container.querySelectorAll('.wp-item')[0];

		first.click();                       // active + not playing -> play
		expect(playlist.player.calls.play).toBe(1);
		first.click();                       // active + playing -> pause
		expect(playlist.player.calls.pause).toBe(1);
	});

	it('activates a row with the Enter and Space keys', () => {
		const { container, playlist } = mount(TWO_TRACKS);
		const second = container.querySelectorAll('.wp-item')[1];

		second.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		expect(playlist.currentTrackIndex).toBe(1);

		const first = container.querySelectorAll('.wp-item')[0];
		first.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
		expect(playlist.currentTrackIndex).toBe(0);
	});
});

describe('keyboard shortcuts', () => {
	it('n / p navigate to next / previous track when the playlist has focus', () => {
		const { container, playlist } = mount(TWO_TRACKS);
		container.querySelectorAll('.wp-item')[0].focus();

		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n' }));
		expect(playlist.currentTrackIndex).toBe(1);

		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p' }));
		expect(playlist.currentTrackIndex).toBe(0);
	});

	it('number keys select a track when a playlist row holds focus', () => {
		const { container, playlist } = mount(TWO_TRACKS);
		container.querySelectorAll('.wp-item')[0].focus();

		document.dispatchEvent(new KeyboardEvent('keydown', { key: '2' }));
		expect(playlist.currentTrackIndex).toBe(1);
	});

	it('ignores shortcuts when focus is outside the playlist', () => {
		const { playlist } = mount(TWO_TRACKS);
		const outside = document.createElement('button');
		document.body.appendChild(outside);
		outside.focus();

		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n' }));
		expect(playlist.currentTrackIndex).toBe(0);
	});
});

describe('minimal layout', () => {
	it('renders real buttons and reflects selection with aria-pressed', () => {
		const { container, playlist } = mount(TWO_TRACKS, { layout: 'minimal' });
		const btns = container.querySelectorAll('.wp-track-btn');
		expect(btns).toHaveLength(2);
		expect(btns[0].tagName).toBe('BUTTON');
		expect(btns[0].getAttribute('aria-pressed')).toBe('true');
		expect(btns[1].getAttribute('aria-pressed')).toBe('false');

		btns[1].click();
		expect(playlist.currentTrackIndex).toBe(1);
		expect(btns[1].getAttribute('aria-pressed')).toBe('true');
		expect(btns[0].getAttribute('aria-pressed')).toBe('false');
	});
});

describe('single track with chapters', () => {
	it('renders a labelled chapter list of button rows', () => {
		const { container } = mount(SINGLE_WITH_CHAPTERS);
		const list = container.querySelector('.wp-chapters-only');
		expect(list.getAttribute('aria-label')).toBe('Chapters');

		const items = container.querySelectorAll('.wp-chapter-item');
		expect(items).toHaveLength(3);
		items.forEach((item) => {
			expect(item.getAttribute('role')).toBe('button');
			expect(item.tabIndex).toBe(0);
		});
	});

	it('seeks to a chapter when its row is activated', async () => {
		MockWaveformPlayer.durations['/audio/show.mp3'] = 300;
		const { container, playlist } = mount(SINGLE_WITH_CHAPTERS);
		container.querySelectorAll('.wp-chapter-item')[2].click();
		await settle(); // the seek lands once the duration is known
		expect(playlist.player.calls.seekTo).toContain(180);
		expect(playlist.player.audio.currentTime).toBe(180);
	});

	it('reflects the active chapter with aria-current as playback advances', () => {
		const { container, playlist } = mount(SINGLE_WITH_CHAPTERS);
		playlist.updateActiveChapter(95); // inside the second chapter (1:30+)
		const items = container.querySelectorAll('.wp-chapter-item');
		expect(items[1].getAttribute('aria-current')).toBe('true');
		expect(items[0].hasAttribute('aria-current')).toBe(false);
	});
});

describe('expanded chapters under a track', () => {
	it('makes nested chapter rows keyboard-operable', () => {
		const html = `
			<div data-track data-url="/a.mp3" data-title="A">
				<span data-chapter data-time="0:30">Part 1</span>
			</div>
			<div data-track data-url="/b.mp3" data-title="B"></div>
		`;
		const { container } = mount(html);
		const chapter = container.querySelector('.wp-chapter');
		expect(chapter.getAttribute('role')).toBe('button');
		expect(chapter.tabIndex).toBe(0);
		expect(container.querySelector('.wp-chapters').getAttribute('aria-label')).toBe('Chapters');
	});
});

describe('continuous mode', () => {
	it('advances to the next track when one ends', () => {
		const { playlist } = mount(TWO_TRACKS, { continuous: true });
		playlist.onTrackEnd();
		expect(playlist.currentTrackIndex).toBe(1);
		expect(playlist.player.calls.loadTrack).toHaveLength(1);
	});

	it('does not advance past the last track', () => {
		const { playlist } = mount(TWO_TRACKS, { continuous: true });
		playlist.selectTrack(1);
		playlist.onTrackEnd();
		expect(playlist.currentTrackIndex).toBe(1);
	});
});

describe('container data-* coverage', () => {
	it('forwards the full player data-* surface via the local fallback parser', () => {
		// The mock core exposes no utils bridge, so the fallback parser runs.
		const { playlist } = mountWithData({
			barRadius: '4',
			buttonAlign: 'right',
			showControls: 'false',
			showHoverTime: 'true',
			seekLabel: 'Scrub',
			playbackRates: '[1, 1.5, 2]',
		});
		const opts = playlist.player.options;
		expect(opts.barRadius).toBe(4);          // coerced to number
		expect(opts.buttonAlign).toBe('right');
		expect(opts.showControls).toBe(false);   // coerced to boolean
		expect(opts.showHoverTime).toBe(true);
		expect(opts.seekLabel).toBe('Scrub');
		expect(opts.playbackRates).toEqual([1, 1.5, 2]); // JSON-parsed
	});

	it('maps data-show-bpm to the showBPM option (casing-bug regression)', () => {
		const { playlist } = mountWithData({ showBpm: 'true' }); // attribute data-show-bpm
		expect(playlist.player.options.showBPM).toBe(true);
	});

	it('delegates to WaveformPlayer.utils.parseDataAttributes when present, stripping owned keys', () => {
		const spy = vi.fn(() => ({
			height: 222,
			waveformStyle: 'seekbar',
			audioMode: 'external',   // owned by the playlist -> must be stripped
			url: '/ignore-me.mp3',   // per-track content -> must be stripped
		}));
		MockWaveformPlayer.utils = { parseDataAttributes: spy };

		const { container, playlist } = mountWithData({});
		expect(spy).toHaveBeenCalledWith(container);
		expect(playlist.player.options.height).toBe(222);
		expect(playlist.player.options.waveformStyle).toBe('seekbar');
		expect(playlist.player.options.audioMode).toBeUndefined();
		// url comes from the first track, never the stripped delegated value.
		expect(playlist.player.options.url).toBe('/audio/a.mp3');
	});

	it('keeps constructor options working alongside data-* (data-* wins on conflict)', () => {
		const { playlist } = mountWithData({ height: '150' }, TWO_TRACKS, { barWidth: 5, height: 999 });
		expect(playlist.player.options.barWidth).toBe(5);   // from JS options
		expect(playlist.player.options.height).toBe(150);   // data-* overrides JS
	});
});

describe('destroy', () => {
	it('removes the keydown listener, restores markup and tears down the player', () => {
		const { container, playlist } = mount(TWO_TRACKS);
		const original = container.querySelector('[data-track]');
		const player = playlist.player;

		playlist.destroy();

		expect(player.calls.destroy).toBe(1);
		expect(container.querySelector('.wp-list')).toBeNull();
		expect(original.style.display).toBe('');        // un-hidden
		expect(playlist.tracks).toHaveLength(0);

		// The global shortcut handler must no longer fire after destroy.
		expect(() => {
			document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n' }));
		}).not.toThrow();
	});
});

describe('malformed markup does not take the playlist down', () => {
	let warn;
	beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
	afterEach(() => { warn.mockRestore(); });

	// parseTracks() reads every track's data-markers before anything renders,
	// so an unguarded JSON.parse there meant one bad attribute anywhere in the
	// markup threw and destroyed the whole playlist.
	it('survives malformed marker JSON on a track', () => {
		const html = `
			<div data-track data-url="/audio/a.mp3" data-title="Track A" data-markers="{not json"></div>
			<div data-track data-url="/audio/b.mp3" data-title="Track B"></div>
		`;
		let playlist;
		expect(() => { ({ playlist } = mount(html)); }).not.toThrow();

		expect(playlist.tracks).toHaveLength(2);
		expect(playlist.tracks[0].markers).toEqual([]);
		expect(warn).toHaveBeenCalled();
	});

	it('rejects marker JSON that parses but is not an array', () => {
		const html = `<div data-track data-url="/a.mp3" data-markers='"hello"'></div>`;
		const { playlist } = mount(html);
		expect(playlist.tracks[0].markers).toEqual([]);
	});

	it('keeps well-formed markers and drops only the unusable entries', () => {
		const html = `<div data-track data-url="/a.mp3" data-markers='[{"time":"x"},{"time":30,"label":"Drop"},null]'></div>`;
		const { playlist } = mount(html);
		expect(playlist.tracks[0].markers).toEqual([{ time: 30, label: 'Drop' }]);
	});

	it('accepts a numeric-string marker time', () => {
		const html = `<div data-track data-url="/a.mp3" data-markers='[{"time":"30","label":"Drop"}]'></div>`;
		const { playlist } = mount(html);
		expect(playlist.tracks[0].markers).toEqual([{ time: 30, label: 'Drop' }]);
	});

	it('does not forward a non-numeric data-height to the player', () => {
		const { playlist } = mountWithData({ height: 'tall' }, TWO_TRACKS);
		expect(playlist.player.options.height).toBeUndefined();
		expect(warn).toHaveBeenCalled();
	});

	it('does not forward playbackRates that are not a JSON array', () => {
		const { playlist } = mountWithData({ playbackRates: '2' }, TWO_TRACKS);
		expect(playlist.player.options.playbackRates).toBeUndefined();
	});

	it('still forwards valid numeric and list attributes', () => {
		const { playlist } = mountWithData({ height: '150', playbackRates: '[1,2]' }, TWO_TRACKS);
		expect(playlist.player.options.height).toBe(150);
		expect(playlist.player.options.playbackRates).toEqual([1, 2]);
	});
});

describe('parseTime', () => {
	it('parses the documented formats', () => {
		const { playlist } = mount(TWO_TRACKS);
		expect(playlist.parseTime('0:00')).toBe(0);
		expect(playlist.parseTime('1:30')).toBe(90);
		expect(playlist.parseTime('90')).toBe(90);
	});

	it('returns 0 rather than NaN for a mistyped chapter time', () => {
		const { playlist } = mount(TWO_TRACKS);
		expect(playlist.parseTime('1:ab')).toBe(0);
		expect(playlist.parseTime('soon')).toBe(0);
		expect(playlist.parseTime('')).toBe(0);
		expect(playlist.parseTime(undefined)).toBe(0);
		expect(playlist.parseTime('-5')).toBe(0);
	});

	it('keeps a chapter with a mistyped time out of NaN positioning', () => {
		const html = `
			<div data-track data-url="/a.mp3">
				<span data-chapter data-time="bogus">Intro</span>
			</div>
		`;
		const { playlist } = mount(html);
		expect(playlist.tracks[0].chapters[0].time).toBe(0);
	});
});

describe('playlist options do not leak into the embedded player', () => {
	// The playlist and the player read the same container and the same data-*
	// namespace, and `layout` exists in both with different vocabularies. The
	// leak was silent until core 1.25.0 started validating enums, at which point
	// every hero playlist logged "Invalid layout option, using default: hero".
	it('never forwards its own layout to the player', () => {
		for (const layout of ['hero', 'grid', 'minimal', 'list']) {
			MockWaveformPlayer.instances = [];
			const { playlist } = mountWithData({ layout }, TWO_TRACKS);

			expect(playlist.options.layout).toBe(layout);
			expect(playlist.player.options.layout).toBeUndefined();
		}
	});

	it('keeps the rest of its own option surface out of the player', () => {
		const { playlist } = mountWithData(
			{ layout: 'hero', continuous: 'true', density: 'compact', coverPosition: 'top' },
			TWO_TRACKS
		);

		for (const key of ['continuous', 'density', 'coverPosition', 'showChapterMarkers', 'chapterMarkerColor']) {
			expect(playlist.player.options[key]).toBeUndefined();
		}
	});

	it('still forwards genuine player options', () => {
		const { playlist } = mountWithData({ layout: 'hero', height: '120', waveformStyle: 'bars' }, TWO_TRACKS);

		expect(playlist.player.options.height).toBe(120);
		expect(playlist.player.options.waveformStyle).toBe('bars');
	});

	it('still applies the hero layout to the playlist itself', () => {
		const { playlist } = mountWithData({ layout: 'hero' }, TWO_TRACKS);
		expect(playlist.isHero).toBe(true);
	});
});

describe('constructor options (framework wrappers pass these, not data-*)', () => {
	const CHAPTERED = `
		<div data-track data-url="/a.mp3" data-title="A" data-duration="3:00">
			<span data-chapter data-time="0:30">Part 1</span>
		</div>
		<div data-track data-url="/b.mp3" data-title="B" data-duration="4:00"></div>
	`;

	it('honours expandChapters: false', () => {
		const { container } = mount(CHAPTERED, { expandChapters: false });
		expect(container.querySelector('.wp-chapters')).toBeNull();
	});

	it('honours showDuration: false', () => {
		const { container } = mount(CHAPTERED, { showDuration: false });
		expect(container.querySelector('.wp-duration')).toBeNull();
	});

	it('honours showPlayState: false', () => {
		const { container } = mount(TWO_TRACKS, { showPlayState: false });
		expect(container.querySelector('.wp-artwork-overlay')).toBeNull();
	});

	it('honours showChapterMarkers and chapterMarkerColor', () => {
		const { playlist } = mount(CHAPTERED, { showChapterMarkers: true, chapterMarkerColor: 'red' });
		expect(playlist.options.showChapterMarkers).toBe(true);
		expect(playlist.player.options.markers).toEqual([{ time: 30, label: 'Part 1', color: 'red' }]);
	});

	it('lets data-* win over a constructor option', () => {
		const { playlist } = mountWithData(
			{ showDuration: 'true', chapterMarkerColor: 'blue' },
			CHAPTERED,
			{ showDuration: false, chapterMarkerColor: 'red' }
		);
		expect(playlist.options.showDuration).toBe(true);
		expect(playlist.options.chapterMarkerColor).toBe('blue');
	});

	it('keeps the documented defaults when neither is given', () => {
		const { playlist } = mount(CHAPTERED);
		expect(playlist.options).toMatchObject({
			expandChapters: true,
			showDuration: true,
			showPlayState: true,
			chapterMarkerColor: 'rgba(161, 161, 170, 0.85)',
		});
	});

	it('treats an undefined option (an unset wrapper prop) as absent', () => {
		const { playlist } = mount(CHAPTERED, { showDuration: undefined, expandChapters: undefined });
		expect(playlist.options.showDuration).toBe(true);
		expect(playlist.options.expandChapters).toBe(true);
	});

	// The wrappers forward `audioMode`; an external-mode player inside a
	// playlist dispatches request-play events nobody answers and never plays.
	it('ignores a constructor audioMode: the playlist always owns its audio', () => {
		const { playlist } = mount(TWO_TRACKS, { audioMode: 'external' });
		expect(playlist.options.audioMode).toBeUndefined();
		expect(playlist.player.options.audioMode).toBeUndefined();
	});
});

describe('user player callbacks are chained, not overwritten', () => {
	it('runs onPlay/onPause/onEnd/onTimeUpdate after the playlist\'s own handlers', () => {
		const calls = [];
		const cb = (name) => vi.fn(() => calls.push(name));
		const user = {
			onPlay: cb('play'), onPause: cb('pause'), onEnd: cb('end'), onTimeUpdate: cb('time'),
			onNextTrack: cb('next'), onPreviousTrack: cb('prev'),
		};
		const { playlist } = mount(TWO_TRACKS, user);
		const opts = playlist.player.options;

		opts.onPlay(playlist.player);
		expect(playlist.isPlaying).toBe(true);           // playlist logic ran...
		expect(user.onPlay).toHaveBeenCalledWith(playlist.player); // ...and so did the user's

		opts.onPause(playlist.player);
		expect(playlist.isPlaying).toBe(false);
		expect(user.onPause).toHaveBeenCalled();

		opts.onTimeUpdate(12, 100, playlist.player);
		expect(user.onTimeUpdate).toHaveBeenCalledWith(12, 100, playlist.player);

		opts.onNextTrack(playlist.player);
		expect(playlist.currentTrackIndex).toBe(1);
		expect(user.onNextTrack).toHaveBeenCalled();

		opts.onPreviousTrack(playlist.player);
		expect(playlist.currentTrackIndex).toBe(0);
		expect(user.onPreviousTrack).toHaveBeenCalled();

		opts.onEnd(playlist.player);
		expect(user.onEnd).toHaveBeenCalled();
		expect(calls).toEqual(['play', 'pause', 'time', 'next', 'prev', 'end']);
	});

	it('keeps the user callbacks across a track change', async () => {
		const onPlay = vi.fn();
		const { playlist } = mount(TWO_TRACKS, { onPlay });
		playlist.selectTrack(1);
		await settle(); // the core auto-plays the freshly loaded track
		expect(onPlay).toHaveBeenCalled();
		expect(playlist.isPlaying).toBe(true);
	});

	it('still forwards user onLoad', async () => {
		const onLoad = vi.fn();
		const { playlist } = mount(TWO_TRACKS, { onLoad });
		await settle();
		expect(onLoad).toHaveBeenCalledWith(playlist.player);
	});
});

describe('per-track data-waveform peaks', () => {
	const PEAKS = `
		<div data-track data-url="/a.mp3" data-title="A" data-waveform="[0.1,0.5,0.9]"></div>
		<div data-track data-url="/b.mp3" data-title="B" data-waveform="/peaks/b.json"></div>
		<div data-track data-url="/c.mp3" data-title="C"></div>
	`;

	it('parses a JSON peaks array or passes a peaks URL through', () => {
		const { playlist } = mount(PEAKS);
		expect(playlist.tracks[0].waveform).toEqual([0.1, 0.5, 0.9]);
		expect(playlist.tracks[1].waveform).toBe('/peaks/b.json');
		expect(playlist.tracks[2].waveform).toBeUndefined();
	});

	it('hands each track\'s peaks to the player on init and on track change', () => {
		const { playlist } = mount(PEAKS);
		expect(playlist.player.options.waveform).toEqual([0.1, 0.5, 0.9]);

		playlist.selectTrack(1);
		expect(playlist.player.calls.loadTrack[0].options.waveform).toBe('/peaks/b.json');
		expect(playlist.player.options.waveform).toBe('/peaks/b.json');

		playlist.selectTrack(2);
		expect(playlist.player.options.waveform).toBeNull(); // core reset → decode
	});

	it('drops malformed peaks JSON with a warning instead of throwing', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { playlist } = mount('<div data-track data-url="/a.mp3" data-waveform="[0.1,"></div>');
		expect(playlist.tracks[0].waveform).toBeUndefined();
		expect(warn.mock.calls[0][0]).toContain('[WaveformPlaylist]');
		warn.mockRestore();
	});
});

describe('track metadata does not leak between tracks', () => {
	const ALBUMS = `
		<div data-track data-url="/a.mp3" data-title="A" data-album="Album A" data-artwork="/art/a.jpg"></div>
		<div data-track data-url="/b.mp3" data-title="B"></div>
		<div data-track data-url="/c.mp3" data-title="C" data-artwork="/art/c.jpg"></div>
	`;

	// The core's mergeOptions skips undefined, so `album: undefined` left the
	// previous album on the lock screen / Media Session.
	it('clears the album when the next track has none', () => {
		const { playlist } = mount(ALBUMS);
		expect(playlist.player.options.album).toBe('Album A');
		playlist.selectTrack(1);
		expect(playlist.player.options.album).toBe('');
	});

	it('hides the hero cover art for a track without artwork', () => {
		const { container, playlist } = mount(ALBUMS, { layout: 'hero' });
		const art = container.querySelector('.wp-hero-art');
		expect(art.getAttribute('src')).toBe('/art/a.jpg');

		playlist.selectTrack(1);
		expect(art.style.display).toBe('none');
		expect(art.hasAttribute('src')).toBe(false);

		playlist.selectTrack(2);
		expect(art.style.display).toBe('');
		expect(art.getAttribute('src')).toBe('/art/c.jpg');
	});

	it('creates the hero cover art lazily when the first track has none', () => {
		const html = `
			<div data-track data-url="/b.mp3" data-title="B"></div>
			<div data-track data-url="/c.mp3" data-title="C" data-artwork="/art/c.jpg"></div>
		`;
		const { container, playlist } = mount(html, { layout: 'hero' });
		expect(container.querySelector('.wp-hero-art')).toBeNull();

		playlist.selectTrack(1);
		const art = container.querySelector('.wp-hero-art');
		expect(art).not.toBeNull();
		expect(art.getAttribute('src')).toBe('/art/c.jpg');
		// Sits beneath the play/pause overlay, not over it.
		expect(art.nextElementSibling.classList.contains('wp-hero-overlay')).toBe(true);
	});
});

const THREE_TRACKS = `
	<div data-track data-url="/a.mp3" data-title="A"></div>
	<div data-track data-url="/b.mp3" data-title="B">
		<span data-chapter data-time="0:30">B part</span>
	</div>
	<div data-track data-url="/c.mp3" data-title="C"></div>
`;

describe('destroy() leaves the container re-initialisable', () => {
	// The React/Vue/Svelte wrappers render tracks as children and destroy +
	// reconstruct on a prop change; destroy() used to wipe innerHTML BEFORE
	// restoring the tracks, so the rebuilt playlist found none.
	it('keeps the original [data-track] elements, visible and in place', () => {
		const { container, playlist } = mount(TWO_TRACKS);
		const originals = [...container.querySelectorAll('[data-track]')];
		playlist.destroy();

		const after = [...container.querySelectorAll('[data-track]')];
		expect(after).toEqual(originals);
		after.forEach((el) => expect(el.style.display).toBe(''));
		expect(container.children.length).toBe(2); // nothing generated left behind
	});

	it('restores an inline display the author had set', () => {
		const { container, playlist } = mount('<div data-track data-url="/a.mp3" style="display: grid"></div>');
		playlist.destroy();
		expect(container.querySelector('[data-track]').style.display).toBe('grid');
	});

	it('removes every class it added but keeps the author\'s', () => {
		const container = document.createElement('div');
		container.className = 'mine';
		container.innerHTML = TWO_TRACKS;
		document.body.appendChild(container);
		const playlist = new WaveformPlaylist(container, {
			layout: 'grid', density: 'compact', coverPosition: 'top', showArtist: false,
		});
		expect(container.classList.contains('wp-grid-layout')).toBe(true);
		playlist.destroy();
		expect([...container.classList]).toEqual(['mine']);
	});

	it('can be constructed again on the same container', () => {
		const { container, playlist } = mount(TWO_TRACKS, { layout: 'hero' });
		playlist.destroy();

		const again = new WaveformPlaylist(container, { layout: 'hero' });
		created.push(again);
		expect(again.tracks).toHaveLength(2);
		expect(container.querySelectorAll('.wp-hero')).toHaveLength(1);
	});

	it('clears the auto-init flag so WaveformPlaylist.init() picks it up again', () => {
		const container = document.createElement('div');
		container.setAttribute('data-waveform-playlist', '');
		// What autoInit() leaves on an element it has built.
		container.dataset.waveformPlaylistInitialized = 'true';
		container.innerHTML = TWO_TRACKS;
		document.body.appendChild(container);
		const playlist = new WaveformPlaylist(container);

		playlist.destroy();
		expect(container.hasAttribute('data-waveform-playlist-initialized')).toBe(false);

		const before = MockWaveformPlayer.instances.length;
		WaveformPlaylist.init();
		expect(MockWaveformPlayer.instances.length).toBe(before + 1);
		expect(container.querySelectorAll('.wp-item')).toHaveLength(2);
		// Tear the auto-built instance down through its keyboard-free surface.
		MockWaveformPlayer.instances.at(-1).destroy();
	});
});

describe('cross-track chapter seek waits for THAT track to load', () => {
	afterEach(() => { vi.useRealTimers(); });

	// The core emits waveformplayer:ready once, ~100ms after construction, and
	// never after a load. A deep link that seeks into another track straight
	// away used to take that event as "loaded" and seek with no duration.
	it('seeks once the new track has loaded, not on the construction ready event', async () => {
		vi.useFakeTimers();
		MockWaveformPlayer.loadDelays['/b.mp3'] = 300; // slower than the 100ms ready event
		const { playlist } = mount(THREE_TRACKS);
		playlist.seekToChapter(1, 60);

		await vi.advanceTimersByTimeAsync(500);
		expect(playlist.player.audio.src).toBe('/b.mp3');
		expect(playlist.player.audio.currentTime).toBe(60);
	});

	it('drops the pending seek when the target track fails to load', async () => {
		MockWaveformPlayer.failingUrls.add('/b.mp3');
		const { playlist } = mount(THREE_TRACKS);
		playlist.seekToChapter(1, 30);
		await settle();

		playlist.selectTrack(2); // C loads fine; B's seek must not land on it
		await settle();
		expect(playlist.player.audio.src).toBe('/c.mp3');
		expect(playlist.player.audio.currentTime).toBe(0);
		expect(playlist.player.calls.seekTo).toEqual([]);
	});

	it('drops the pending seek when another track is selected first', async () => {
		const { playlist } = mount(THREE_TRACKS);
		playlist.seekToChapter(1, 30);
		playlist.selectTrack(2);
		await settle();
		expect(playlist.player.audio.src).toBe('/c.mp3');
		expect(playlist.player.calls.seekTo).toEqual([]);
	});

	it('still runs the user onError when a load fails', async () => {
		MockWaveformPlayer.failingUrls.add('/b.mp3');
		const onError = vi.fn();
		const { playlist } = mount(THREE_TRACKS, { onError });
		playlist.seekToChapter(1, 30);
		await settle();
		expect(onError).toHaveBeenCalledTimes(1);
	});

	it('leaves no document listener behind after destroy()', async () => {
		const added = [];
		const removed = [];
		const add = vi.spyOn(document, 'addEventListener').mockImplementation(function (type, fn, opts) {
			added.push(fn);
			return EventTarget.prototype.addEventListener.call(this, type, fn, opts);
		});
		const rm = vi.spyOn(document, 'removeEventListener').mockImplementation(function (type, fn, opts) {
			removed.push(fn);
			return EventTarget.prototype.removeEventListener.call(this, type, fn, opts);
		});
		try {
			MockWaveformPlayer.failingUrls.add('/b.mp3');
			const { playlist } = mount(THREE_TRACKS);
			playlist.seekToChapter(1, 30);
			await settle();
			playlist.destroy();
			expect(added.filter((fn) => !removed.includes(fn))).toEqual([]);
		} finally {
			add.mockRestore();
			rm.mockRestore();
		}
	});
});

describe('chapter seeks with preload="none"', () => {
	// preload="none" leaves the duration unknown until playback starts, and the
	// core's seekTo() is a no-op without one.
	it('seeks within the current track once metadata arrives', async () => {
		const { container, playlist } = mountWithData({ preload: 'none' }, SINGLE_WITH_CHAPTERS);
		await settle();
		expect(Number.isNaN(playlist.player.audio.duration)).toBe(true);

		MockWaveformPlayer.durations['/audio/show.mp3'] = 300;
		container.querySelectorAll('.wp-chapter-item')[1].click();
		await settle();
		expect(playlist.player.audio.currentTime).toBe(90);
		expect(playlist.player.isPlaying).toBe(true);
	});

	it('seeks into another track once its metadata arrives', async () => {
		const { playlist } = mountWithData({ preload: 'none' }, THREE_TRACKS);
		playlist.seekToChapter(1, 30);
		await settle();
		await settle();
		expect(playlist.player.audio.src).toBe('/b.mp3');
		expect(playlist.player.audio.currentTime).toBe(30);
	});

	it('abandons the metadata wait when the track changes', async () => {
		const { container, playlist } = mountWithData({ preload: 'none' }, SINGLE_WITH_CHAPTERS.replace('</div>', '</div><div data-track data-url="/z.mp3"></div>'));
		await settle();
		container.querySelectorAll('.wp-chapter')[2].click(); // 3:00 on track 0
		playlist.selectTrack(1);
		await settle();
		await settle();
		expect(playlist.player.audio.src).toBe('/z.mp3');
		expect(playlist.player.audio.currentTime).toBe(0);
	});
});

describe('chapter sublists follow the active track', () => {
	// Not every track has chapters, so sublist N is not track N.
	const SPARSE = `
		<div data-track data-url="/a.mp3" data-title="A"></div>
		<div data-track data-url="/b.mp3" data-title="B"><span data-chapter data-time="0:10">B1</span></div>
		<div data-track data-url="/c.mp3" data-title="C"><span data-chapter data-time="0:20">C1</span></div>
	`;
	const shown = (container) => [...container.querySelectorAll('.wp-chapters')]
		.filter((el) => el.style.display !== 'none')
		.map((el) => el.dataset.trackIndex);

	for (const layout of ['list', 'hero']) {
		it(`reveals the selected track's sublist by track index (${layout})`, () => {
			const { container, playlist } = mount(SPARSE, { layout });
			playlist.selectTrack(2);
			expect(shown(container)).toEqual(['2']);
			playlist.selectTrack(1);
			expect(shown(container)).toEqual(['1']);
			playlist.selectTrack(0);
			expect(shown(container)).toEqual([]);
		});
	}

	it('reveals the first track\'s chapters on init in the list layout', () => {
		const html = `
			<div data-track data-url="/a.mp3" data-title="A"><span data-chapter data-time="0:10">A1</span></div>
			<div data-track data-url="/b.mp3" data-title="B"></div>
		`;
		const { container } = mount(html);
		expect(shown(container)).toEqual(['0']);
	});
});

describe('play state overlay', () => {
	// Only tracks with artwork have an artwork container, so the Nth container
	// is not necessarily track N.
	it('shows the overlay on the active row when earlier rows have no artwork', () => {
		const html = `
			<div data-track data-url="/a.mp3" data-title="A"></div>
			<div data-track data-url="/b.mp3" data-title="B" data-artwork="/art/b.jpg"></div>
		`;
		const { container, playlist } = mount(html);
		playlist.selectTrack(1);
		playlist.player.play();

		const overlay = container.querySelector('.wp-item[data-index="1"] .wp-artwork-overlay');
		expect(overlay.style.display).toBe('flex');
		expect(overlay.querySelector('i').className).toContain('ti-player-pause');
	});

	it('hides the overlay on a row that is no longer active', () => {
		const { container, playlist } = mount(TWO_TRACKS);
		playlist.player.play();
		const overlay = container.querySelector('.wp-item[data-index="0"] .wp-artwork-overlay');
		expect(overlay.style.display).toBe('flex');
		playlist.selectTrack(1);
		playlist.player.play();
		expect(overlay.style.display).toBe('none');
	});
});

describe('chapter highlighting', () => {
	const LATE_CHAPTERS = `
		<div data-track data-url="/a.mp3" data-title="A">
			<span data-chapter data-time="0:30">A1</span>
			<span data-chapter data-time="1:00">A2</span>
		</div>
		<div data-track data-url="/b.mp3" data-title="B"></div>
	`;
	const current = (container) => [...container.querySelectorAll('[aria-current="true"]')]
		.filter((el) => el.matches('.wp-chapter, .wp-chapter-item'));

	it('does not keep a stale chapter highlighted when returning to a track', () => {
		const { container, playlist } = mount(LATE_CHAPTERS);
		playlist.updateActiveChapter(45);
		expect(current(container)).toHaveLength(1);

		playlist.selectTrack(1);
		playlist.selectTrack(0);
		playlist.updateActiveChapter(0); // before the first chapter
		expect(current(container)).toHaveLength(0);
		expect(container.querySelectorAll('.wp-chapter.wp-active')).toHaveLength(0);
	});

	it('clears the highlight when a single chaptered track is reselected', () => {
		const html = LATE_CHAPTERS.replace(/<div data-track data-url="\/b.mp3"[^>]*><\/div>/, '');
		const { container, playlist } = mount(html);
		playlist.updateActiveChapter(45);
		expect(current(container)).toHaveLength(1);
		playlist.selectTrack(0);
		playlist.updateActiveChapter(0);
		expect(current(container)).toHaveLength(0);
	});
});

describe('chapter times', () => {
	let warn;
	beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
	afterEach(() => { warn.mockRestore(); });

	it('sorts chapters by time', () => {
		const html = `
			<div data-track data-url="/a.mp3">
				<span data-chapter data-time="1:30">Main</span>
				<span data-chapter data-time="0:00">Intro</span>
				<span data-chapter data-time="0:45">Early</span>
			</div>
		`;
		const { container, playlist } = mount(html);
		expect(playlist.tracks[0].chapters.map((c) => c.label)).toEqual(['Intro', 'Early', 'Main']);
		expect([...container.querySelectorAll('.wp-chapter-item .wp-label')].map((el) => el.textContent))
			.toEqual(['Intro', 'Early', 'Main']);
	});

	it('warns about chapters without a data-time', () => {
		const html = `
			<div data-track data-url="/a.mp3">
				<span data-chapter>Untimed</span>
				<span data-chapter data-time="0:45">Timed</span>
			</div>
		`;
		mount(html);
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0][0]).toContain('[WaveformPlaylist]');
		expect(warn.mock.calls[0].join(' ')).toContain('Untimed');
	});

	it('highlights the FIRST of several chapters sharing a time', () => {
		const html = `
			<div data-track data-url="/a.mp3">
				<span data-chapter>One</span>
				<span data-chapter>Two</span>
				<span data-chapter data-time="1:00">Three</span>
			</div>
		`;
		const { container, playlist } = mount(html);
		playlist.updateActiveChapter(10);
		const items = container.querySelectorAll('.wp-chapter-item');
		expect(items[0].getAttribute('aria-current')).toBe('true');
		expect(items[1].hasAttribute('aria-current')).toBe(false);
		playlist.updateActiveChapter(61);
		expect(items[2].getAttribute('aria-current')).toBe('true');
	});

	it('warns once about chapters beyond the duration once it is known', () => {
		const html = `
			<div data-track data-url="/a.mp3">
				<span data-chapter data-time="0:00">Intro</span>
				<span data-chapter data-time="3:00">Too late</span>
			</div>
		`;
		const { playlist } = mount(html);
		playlist.player.options.onTimeUpdate(1, 120, playlist.player);
		playlist.player.options.onTimeUpdate(2, 120, playlist.player);
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0][0]).toContain('[WaveformPlaylist]');
		expect(warn.mock.calls[0].join(' ')).toContain('Too late');
	});
});

describe('parseTime H:MM:SS', () => {
	it('parses hour-long chapter times', () => {
		const { playlist } = mount(TWO_TRACKS);
		expect(playlist.parseTime('1:05:30')).toBe(3930);
		expect(playlist.parseTime('01:00:00')).toBe(3600);
		expect(playlist.parseTime('0:01:30')).toBe(90);
	});

	it('keeps M:SS, plain seconds and the 0-on-garbage contract', () => {
		const { playlist } = mount(TWO_TRACKS);
		expect(playlist.parseTime('2:05')).toBe(125);
		expect(playlist.parseTime('90')).toBe(90);
		expect(playlist.parseTime('12.5')).toBe(12.5);
		expect(playlist.parseTime('1:05:ab')).toBe(0);
		expect(playlist.parseTime('1:2:3:4')).toBe(0);
		expect(playlist.parseTime('1::30')).toBe(0);
	});
});

describe('keyboard shortcuts leave modified keys alone', () => {
	// Cmd/Ctrl+P is print, Ctrl+N a new window, Ctrl/Alt+digit tab switching.
	for (const mod of ['ctrlKey', 'metaKey', 'altKey']) {
		it(`ignores n / p / digits with ${mod}`, () => {
			const { container, playlist } = mount(TWO_TRACKS);
			container.querySelectorAll('.wp-item')[0].focus();

			for (const key of ['n', '2']) {
				const e = new KeyboardEvent('keydown', { key, [mod]: true, cancelable: true });
				document.dispatchEvent(e);
				expect(e.defaultPrevented).toBe(false);
				expect(playlist.currentTrackIndex).toBe(0);
			}
			playlist.selectTrack(1);
			const p = new KeyboardEvent('keydown', { key: 'p', [mod]: true, cancelable: true });
			document.dispatchEvent(p);
			expect(p.defaultPrevented).toBe(false);
			expect(playlist.currentTrackIndex).toBe(1);
		});
	}
});
