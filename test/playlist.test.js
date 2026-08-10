import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockWaveformPlayer } from './setup.js';
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

	it('seeks to a chapter when its row is activated', () => {
		const { container, playlist } = mount(SINGLE_WITH_CHAPTERS);
		container.querySelectorAll('.wp-chapter-item')[2].click();
		expect(playlist.player.calls.seekTo).toContain(180);
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
