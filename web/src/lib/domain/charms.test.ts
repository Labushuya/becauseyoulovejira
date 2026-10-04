// The catalog of the charms (ADR-0062): every charm has a unique key the server can store, a German
// name, a group, search words and a symbol of the copied Lucide set in one grid; the search finds
// them by name, word and group with or without umlauts; the moves of the keys through the grid of
// the dialog. The parity with the hook is in tests/unit/web-charms.test.mjs.

import { describe, expect, it } from 'vitest';
import { CHARM_ICONS, CHARM_SVG, type IconShape } from './charm-icons';
import {
	CHARMS,
	CHARM_COLUMNS,
	CHARM_GROUPS,
	CHARM_GROUP_LABELS,
	CHARM_KEYS,
	charmKeyOf,
	charmMove,
	charmName,
	charmOf,
	charmRows,
	charmSections,
	charmText,
	isCharmKey,
	searchCharms
} from './charms';

const keysOf = (list: readonly { key: string }[]) => list.map((entry) => entry.key);

describe('catalog', () => {
	it('has about forty charms in the eight groups of the user, in the order of the groups', () => {
		expect(CHARMS.length).toBeGreaterThanOrEqual(36);
		expect(CHARMS.length).toBeLessThanOrEqual(48);
		expect([...CHARM_GROUPS]).toEqual([
			'alltag',
			'haushalt',
			'gesundheit',
			'familie',
			'arbeit',
			'reise',
			'finanzen',
			'freizeit'
		]);
		expect(Object.values(CHARM_GROUP_LABELS)).toEqual([
			'Alltag',
			'Haushalt',
			'Gesundheit',
			'Familie',
			'Arbeit',
			'Reise',
			'Finanzen',
			'Freizeit'
		]);
		const groups = CHARMS.map((entry) => CHARM_GROUPS.indexOf(entry.group));
		expect(groups).toEqual([...groups].sort((a, b) => a - b));
		for (const group of CHARM_GROUPS) {
			expect(
				CHARMS.some((entry) => entry.group === group),
				group
			).toBe(true);
		}
	});

	it('names the examples of the user', () => {
		const names = CHARMS.map((entry) => entry.name);
		for (const name of [
			'Müll',
			'Putzen',
			'Wäsche',
			'Einkaufen',
			'Reparatur',
			'Garten',
			'Arzt',
			'Medikament',
			'Sport',
			'Geburtstag',
			'Geschenk',
			'Kind',
			'Haustier',
			'Meeting',
			'Telefon',
			'Dokument',
			'Flugzeug',
			'Zug',
			'Auto',
			'Koffer',
			'Rechnung',
			'Geld',
			'Karte',
			'Film',
			'Musik',
			'Buch',
			'Essen'
		]) {
			expect(names, name).toContain(name);
		}
	});

	it('keeps keys unique, short and plain, names unique, search words in lower case', () => {
		expect(new Set(CHARM_KEYS).size).toBe(CHARMS.length);
		expect(new Set(CHARMS.map((entry) => entry.name)).size).toBe(CHARMS.length);
		expect(CHARM_KEYS).toEqual(keysOf(CHARMS));
		for (const entry of CHARMS) {
			// The field holds at most 40 characters (migration 1790204400).
			expect(entry.key, entry.key).toMatch(/^[a-z][a-z-]{1,39}$/);
			expect(entry.name.trim(), entry.key).toBe(entry.name);
			for (const word of entry.keywords) expect(word, entry.key).toBe(word.toLowerCase());
		}
	});

	it('draws every charm with a symbol of the copied set, all in one grid', () => {
		expect(CHARM_SVG).toEqual({
			viewBox: '0 0 24 24',
			fill: 'none',
			stroke: 'currentColor',
			strokeWidth: 2,
			strokeLinecap: 'round',
			strokeLinejoin: 'round'
		});
		const icons = CHARM_ICONS as Readonly<Record<string, readonly IconShape[]>>;
		for (const entry of CHARMS) {
			const shapes = icons[entry.icon];
			expect(shapes, entry.key).toBeDefined();
			expect(shapes?.length, entry.key).toBeGreaterThan(0);
		}
		// Every symbol stays inside the grid of 24 (numbers of circles, rects and lines).
		for (const [name, shapes] of Object.entries(icons)) {
			for (const shape of shapes) {
				for (const value of Object.values(shape)) {
					if (typeof value === 'number') {
						expect(value, name).toBeGreaterThanOrEqual(0);
						expect(value, name).toBeLessThanOrEqual(24);
					}
				}
			}
		}
		// No symbol is copied without a charm.
		expect(new Set(CHARMS.map((entry) => entry.icon))).toEqual(new Set(Object.keys(icons)));
	});

	it('reads stored values: a key of the catalog, else none', () => {
		expect(charmOf('geburtstag')?.name).toBe('Geburtstag');
		expect(charmOf('')).toBeNull();
		expect(charmOf(null)).toBeNull();
		expect(charmOf(undefined)).toBeNull();
		expect(charmOf('einhorn')).toBeNull();
		expect(isCharmKey('flugzeug')).toBe(true);
		expect(isCharmKey('Flugzeug')).toBe(false);
		expect(isCharmKey(3)).toBe(false);
		expect(charmKeyOf('zug')).toBe('zug');
		expect(charmKeyOf('')).toBeNull();
		expect(charmKeyOf('einhorn')).toBeNull();
	});

	it('names a charm for screen readers and the history', () => {
		expect(charmText({ name: 'Geburtstag' })).toBe('Charm: Geburtstag');
		expect(charmName('muell')).toBe('Müll');
		expect(charmName('')).toBe('');
		expect(charmName('einhorn')).toBe('einhorn');
	});
});

describe('search', () => {
	it('shows all for an empty query', () => {
		expect(keysOf(searchCharms(''))).toEqual(CHARM_KEYS);
		expect(keysOf(searchCharms('   '))).toEqual(CHARM_KEYS);
	});

	it('finds by name, search word, group and key, in any case', () => {
		expect(keysOf(searchCharms('Geburtstag'))).toEqual(['geburtstag']);
		expect(keysOf(searchCharms('torte'))).toEqual(['geburtstag']);
		expect(keysOf(searchCharms('FLUG'))).toContain('flugzeug');
		expect(keysOf(searchCharms('hantel'))).toEqual(['sport']);
		expect(keysOf(searchCharms('finanzen'))).toEqual(['rechnung', 'geld', 'karte', 'sparen']);
	});

	it('finds with and without umlauts', () => {
		for (const query of ['müll', 'muell', 'Müll', 'mull']) {
			expect(keysOf(searchCharms(query)), query).toContain('muell');
		}
		for (const query of ['wäsche', 'waesche', 'wasche']) {
			expect(keysOf(searchCharms(query)), query).toContain('waesche');
		}
		expect(keysOf(searchCharms('behörde'))).toEqual(['behoerde']);
	});

	it('needs every word of the query and finds nothing for an unknown one', () => {
		expect(keysOf(searchCharms('reise zug'))).toEqual(['zug']);
		expect(searchCharms('einhorn')).toEqual([]);
	});

	it('keeps the groups in their order and leaves out empty ones', () => {
		const sections = charmSections(searchCharms('karte'));
		expect(sections.map((section) => section.label)).toEqual(['Reise', 'Finanzen']);
		expect(sections.map((section) => keysOf(section.charms))).toEqual([['zug'], ['karte']]);
		expect(charmSections([])).toEqual([]);
	});
});

describe('grid of the dialog', () => {
	const sections = charmSections(searchCharms(''));
	const rows = charmRows(sections, '');

	it('puts "Kein Charm" alone first, then every group in rows of six', () => {
		expect(CHARM_COLUMNS).toBe(6);
		expect(rows[0]).toEqual(['']);
		expect(rows.slice(1).every((row) => row.length >= 1 && row.length <= CHARM_COLUMNS)).toBe(true);
		expect(rows.flat()).toEqual(['', ...CHARM_KEYS]);
		// Each group starts a row.
		const firsts = new Set(rows.slice(1).map((row) => row[0]));
		for (const section of sections) expect(firsts.has(section.charms[0]?.key)).toBe(true);
	});

	it('moves left and right in reading order, up and down by row, Home and End to the ends', () => {
		expect(charmMove(rows, '', 'ArrowRight')).toBe('einkaufen');
		expect(charmMove(rows, 'einkaufen', 'ArrowLeft')).toBe('');
		expect(charmMove(rows, '', 'ArrowLeft')).toBeNull();
		expect(charmMove(rows, '', 'ArrowDown')).toBe('einkaufen');
		// Alltag (5) and Haushalt (6): down from the 3rd of Alltag is the 3rd of Haushalt.
		expect(charmMove(rows, 'erinnerung', 'ArrowDown')).toBe('waesche');
		expect(charmMove(rows, 'waesche', 'ArrowUp')).toBe('erinnerung');
		// From the 6th of Haushalt up into the shorter row of Alltag: its last.
		expect(charmMove(rows, 'kochen', 'ArrowUp')).toBe('behoerde');
		expect(charmMove(rows, 'einkaufen', 'ArrowUp')).toBe('');
		expect(charmMove(rows, '', 'ArrowUp')).toBeNull();
		expect(charmMove(rows, 'muell', 'Home')).toBe('');
		expect(charmMove(rows, 'muell', 'End')).toBe(CHARM_KEYS.at(-1));
		expect(charmMove(rows, CHARM_KEYS.at(-1) ?? '', 'ArrowRight')).toBeNull();
		expect(charmMove(rows, CHARM_KEYS.at(-1) ?? '', 'ArrowDown')).toBeNull();
		expect(charmMove(rows, 'muell', 'Enter')).toBeNull();
		// An option that is no longer shown (after a search) starts at the first.
		expect(charmMove(rows, 'einhorn', 'ArrowDown')).toBe('');
	});
});
