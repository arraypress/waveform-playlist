import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * index.d.ts is hand-written, and the four framework wrappers derive their
 * prop types from it — so an option the runtime supports but the types omit is
 * an option the wrappers can't pass without a cast. It drifted once: `layout`
 * was typed `'list' | 'minimal'` long after 'hero' and 'grid' shipped, and the
 * hero/grid sizing options were never typed at all.
 *
 * There is no TypeScript toolchain here, so this reads both files as text.
 */
const SRC = readFileSync(resolve(process.cwd(), 'src/js/index.js'), 'utf8');
const DTS = readFileSync(resolve(process.cwd(), 'index.d.ts'), 'utf8');

/** The body of `export interface WaveformPlaylistOptions { … }`. */
const optionsBody = DTS.slice(
	DTS.indexOf('export interface WaveformPlaylistOptions'),
	DTS.indexOf('export class WaveformPlaylist')
);

/** The keys of the runtime's PLAYLIST_OWN_OPTIONS array. */
const ownOptions = SRC
	.match(/const PLAYLIST_OWN_OPTIONS = \[([\s\S]*?)\];/)[1]
	.match(/'([^']+)'/g)
	.map((k) => k.slice(1, -1));

describe('index.d.ts matches the runtime option surface', () => {
	it('declares every option the playlist owns', () => {
		const missing = ownOptions.filter((key) => !new RegExp(`\\b${key}\\?:`).test(optionsBody));
		expect(missing).toEqual([]);
	});

	it('types every layout the runtime handles', () => {
		const runtime = [...SRC.matchAll(/this\.options\.layout === '(\w+)'/g)].map((m) => m[1]);
		const typed = optionsBody.match(/layout\?:([^;]+);/)[1];
		expect(runtime.length).toBeGreaterThan(0);
		for (const layout of [...runtime, 'list']) {
			expect(typed).toContain(`'${layout}'`);
		}
	});
});
