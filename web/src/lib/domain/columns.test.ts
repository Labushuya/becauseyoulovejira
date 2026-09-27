// Unit tests for the columns of the tables (ADR-0030): specs, stored preferences, the fit into the
// frame and the tag chips of a compact row. The order in which columns give way was a static
// check of the container queries before (table-columns.test.ts); here it is computed.

import { describe, expect, it } from 'vitest';
import {
	COLUMN_PREFS_VERSION,
	INBOX_TABLE,
	PROJECT_TABLE,
	RECURRENCE_TABLE,
	REM,
	TABLES,
	TICKET_TABLE,
	clampWidth,
	columnWidth,
	defaultColumnPrefs,
	estimateTextWidth,
	fitChips,
	fitColumns,
	formatRem,
	isDefaultColumnPrefs,
	isResizable,
	optionalColumns,
	parseColumnPrefs,
	serializeColumnPrefs,
	type ColumnPrefs,
	type ColumnSpec,
	type TableSpec
} from './columns';

/** Nothing chosen for the tickets: default widths, "Quelle" off (ADR-0019 section 4). */
const NONE: ColumnPrefs = { widths: {}, hidden: ['source'] };

function spec(table: TableSpec, id: string): ColumnSpec {
	const found = table.columns.find((entry) => entry.id === id);
	if (!found) throw new Error(`no column ${id}`);
	return found;
}

/** Order in which the columns give way while the frame shrinks from wide to narrow. */
function hideOrder(
	table: TableSpec,
	prefs: ColumnPrefs = defaultColumnPrefs(table.columns)
): string[] {
	const order: string[] = [];
	for (let width = 3000; width > 0; width -= 4) {
		for (const id of fitColumns(width, table.columns, prefs).autoHidden) {
			if (!order.includes(id)) order.push(id);
		}
	}
	return order;
}

/** Widest frame (in rem) at which `id` is hidden for lack of space. */
function threshold(
	table: TableSpec,
	id: string,
	prefs: ColumnPrefs = defaultColumnPrefs(table.columns)
): number {
	for (let width = 3000; width > 0; width -= 1) {
		if (fitColumns(width, table.columns, prefs).autoHidden.includes(id)) return (width + 1) / REM;
	}
	throw new Error(`${id} never gives way`);
}

describe('column specs', () => {
	it('has one flexible, required column per table and keys byl-columns-*', () => {
		for (const table of Object.values(TABLES)) {
			expect(table.columns.filter((entry) => entry.flexible)).toHaveLength(1);
			expect(table.columns.find((entry) => entry.flexible)?.required).toBe(true);
			expect(table.storageKey).toBe(`byl-columns-${table.id}`);
			for (const entry of table.columns) {
				expect(entry.min, entry.id).toBeLessThanOrEqual(entry.width);
				expect(entry.width, entry.id).toBeLessThanOrEqual(entry.max);
			}
		}
		expect(Object.keys(TABLES)).toEqual(['tickets', 'inbox', 'projects', 'recurrences']);
	});

	it('keeps key, title and actions of the tickets always shown and lists the rest in the menu', () => {
		expect(optionalColumns(TICKET_TABLE.columns).map((entry) => entry.id)).toEqual([
			'priority',
			'status',
			'source',
			'project',
			'tags',
			'due',
			'created'
		]);
		expect(defaultColumnPrefs(TICKET_TABLE.columns)).toEqual(NONE);
		expect(isResizable(spec(TICKET_TABLE, 'key'))).toBe(true);
		expect(isResizable(spec(TICKET_TABLE, 'title'))).toBe(false);
		expect(isResizable(spec(TICKET_TABLE, 'actions'))).toBe(false);
		// Maximum widths of the concept: Tags 20rem, Projekt 16rem, Key 8rem.
		expect(spec(TICKET_TABLE, 'tags').max).toBe(20 * REM);
		expect(spec(TICKET_TABLE, 'project').max).toBe(16 * REM);
		expect(spec(TICKET_TABLE, 'key').max).toBe(8 * REM);
	});

	it('names widths in rem for the menu "Spalten"', () => {
		expect(formatRem(128)).toBe('8 rem');
		expect(formatRem(136)).toBe('8,5 rem');
		expect(formatRem(139)).toBe('8,5 rem');
		expect(formatRem(142)).toBe('9 rem');
	});

	it('clamps a width to the bounds of its column', () => {
		const tags = spec(TICKET_TABLE, 'tags');
		expect(clampWidth(tags, 10)).toBe(tags.min);
		expect(clampWidth(tags, 10_000)).toBe(tags.max);
		expect(clampWidth(tags, 150.6)).toBe(151);
		expect(columnWidth(tags, NONE)).toBe(tags.width);
		expect(columnWidth(tags, { widths: { tags: 200 }, hidden: [] })).toBe(200);
	});
});

describe('parseColumnPrefs and serializeColumnPrefs', () => {
	const columns = TICKET_TABLE.columns;

	it('reads what it wrote', () => {
		const prefs: ColumnPrefs = { widths: { project: 160, key: 112 }, hidden: ['created'] };
		const raw = serializeColumnPrefs(prefs);
		expect(JSON.parse(raw)).toEqual({
			v: 1,
			widths: { project: 160, key: 112 },
			hidden: ['created']
		});
		expect(parseColumnPrefs(raw, columns)).toEqual({
			widths: { key: 112, project: 160 },
			hidden: ['created']
		});
	});

	it.each([
		['nothing stored', null],
		['an empty text', ''],
		['broken JSON', '{"v":1,'],
		['another version', JSON.stringify({ v: 2, widths: { project: 160 }, hidden: ['created'] })],
		['no version', JSON.stringify({ widths: { project: 160 } })],
		['an array', '[1,2]'],
		['a number', '42'],
		['null', 'null']
	])('falls back to the defaults for %s', (_case, raw) => {
		expect(parseColumnPrefs(raw, columns)).toEqual(defaultColumnPrefs(columns));
	});

	it('drops unknown columns, wrong types, NaN, negative widths and required columns', () => {
		const raw = JSON.stringify({
			v: COLUMN_PREFS_VERSION,
			widths: {
				project: 'wide',
				tags: -20,
				due: 0,
				created: null,
				unknown: 100,
				title: 300,
				actions: 90,
				key: 1e9
			},
			hidden: ['tags', 'key', 'title', 'unknown', 7, null]
		});
		expect(parseColumnPrefs(raw, columns)).toEqual({
			widths: { key: spec(TICKET_TABLE, 'key').max },
			hidden: ['tags']
		});
		// JSON has no NaN: a text with NaN is broken JSON and means the defaults.
		expect(parseColumnPrefs(`{"v":1,"widths":{"tags":NaN}}`, columns)).toEqual(
			defaultColumnPrefs(columns)
		);
	});

	it('keeps the default hidden columns when the list is missing', () => {
		expect(defaultColumnPrefs(columns).hidden).toEqual(['source']);
		const missing = JSON.stringify({ v: 1, widths: {} });
		expect(parseColumnPrefs(missing, columns).hidden).toEqual(['source']);
		// A stored empty list means the user switched "Quelle" on.
		const empty = JSON.stringify({ v: 1, widths: {}, hidden: [] });
		expect(parseColumnPrefs(empty, columns).hidden).toEqual([]);
	});

	it('knows the defaults', () => {
		expect(isDefaultColumnPrefs(defaultColumnPrefs(columns), columns)).toBe(true);
		expect(isDefaultColumnPrefs({ widths: { tags: 200 }, hidden: [] }, columns)).toBe(false);
		expect(isDefaultColumnPrefs({ widths: {}, hidden: ['tags'] }, columns)).toBe(false);
	});
});

describe('fitColumns', () => {
	it('shows everything at the default widths without a measured frame', () => {
		const fit = fitColumns(null, TICKET_TABLE.columns, NONE);
		const all = TICKET_TABLE.columns.map((entry) => entry.id);
		expect(fit.visible).toEqual(all.filter((id) => id !== 'source'));
		expect(fitColumns(null, TICKET_TABLE.columns, { widths: {}, hidden: [] }).visible).toEqual(all);
		expect(fit.autoHidden).toEqual([]);
		expect(fit.flexWidth).toBeNull();
		expect(fit.widths.tags).toBe(8 * REM);
		expect(fit.widths.title).toBeUndefined();
		expect(fitColumns(0, TICKET_TABLE.columns, NONE).autoHidden).toEqual([]);
	});

	it.each([
		[TICKET_TABLE, ['created', 'tags', 'project', 'due']],
		[INBOX_TABLE, ['arrival', 'source', 'kind', 'source-date']],
		[PROJECT_TABLE, ['archived', 'new', 'total', 'active']],
		[RECURRENCE_TABLE, ['project', 'open', 'next', 'rhythm']]
	])('lets the columns of %# give way in the order of ADR-0025 section 11', (table, order) => {
		expect(hideOrder(table)).toEqual(order);
	});

	// Thresholds of the container queries before ADR-0030 and with the default widths now. A fixed
	// table layout needs real widths for key, status and actions, so they move by up to 2.5rem.
	it.each([
		[TICKET_TABLE, { created: [60, 60.5], tags: [52, 54.5], project: [44, 46.5], due: [36, 38.5] }],
		[
			INBOX_TABLE,
			{ arrival: [52, 50.5], source: [46, 44.5], kind: [40, 37.5], 'source-date': [34, 31.5] }
		],
		[PROJECT_TABLE, { archived: [40, 38], new: [34, 31.5], total: [28, 26.5], active: [22, 21] }],
		[
			RECURRENCE_TABLE,
			{ project: [52, 53.5], open: [44, 44.5], next: [36, 37.5], rhythm: [28, 30.5] }
		]
	])('keeps the thresholds of %# close to the container queries', (table, expected) => {
		for (const [id, pair] of Object.entries(expected)) {
			const [before, now] = pair as [number, number];
			const actual = threshold(table, id);
			expect(Math.abs(actual - now), `${table.id}/${id}: ${actual}rem`).toBeLessThanOrEqual(1);
			const label = `${table.id}/${id} against ${before}rem`;
			expect(Math.abs(actual - before), label).toBeLessThanOrEqual(2.5);
		}
	});

	it('hides "Erstellt" and "Tags" of the tickets at 800 px and names them as hidden for space', () => {
		const fit = fitColumns(800, TICKET_TABLE.columns, NONE);
		expect(fit.autoHidden).toEqual(['created', 'tags']);
		expect(fit.visible).toEqual([
			'key',
			'priority',
			'status',
			'title',
			'project',
			'due',
			'actions'
		]);
		expect(fit.flexWidth).toBe(800 - 96 - 64 - 104 - 128 - 128 - 64);
	});

	it('hides earlier when the user made columns wider, and keeps their widths', () => {
		const wide: ColumnPrefs = { widths: { tags: 320 }, hidden: ['source'] };
		const before = threshold(TICKET_TABLE, 'created');
		expect(threshold(TICKET_TABLE, 'created', wide)).toBeGreaterThan(before);
		// All columns need 1160 px with the wide tags instead of 968 px.
		const fit = fitColumns(1200, TICKET_TABLE.columns, wide);
		expect(fit.widths.tags).toBe(320);
		expect(fit.autoHidden).toEqual([]);
		expect(fitColumns(1100, TICKET_TABLE.columns, wide).autoHidden).toEqual(['created']);
	});

	it('does not count columns the user switched off as hidden for space', () => {
		const prefs: ColumnPrefs = { widths: {}, hidden: ['priority', 'source', 'created'] };
		const fit = fitColumns(2000, TICKET_TABLE.columns, prefs);
		expect(fit.autoHidden).toEqual([]);
		expect(fit.visible).not.toContain('created');
		expect(fit.visible).not.toContain('priority');
		// Their space goes to the others: "Tags" gives way later than with them.
		expect(threshold(TICKET_TABLE, 'tags', prefs)).toBeLessThan(threshold(TICKET_TABLE, 'tags'));
	});

	it('keeps the required columns and never exceeds the frame, even when everything shrinks', () => {
		const big: ColumnPrefs = {
			widths: { key: 128, priority: 96, status: 160 },
			hidden: []
		};
		for (const width of [2000, 1280, 1100, 900, 700, 600, 480, 400, 320, 200, 100, 40, 1]) {
			for (const prefs of [NONE, big]) {
				const fit = fitColumns(width, TICKET_TABLE.columns, prefs);
				const sum = Object.values(fit.widths).reduce((total, value) => total + value, 0);
				expect(sum + (fit.flexWidth ?? 0), `${width}px`).toBeLessThanOrEqual(width);
				expect(fit.visible).toEqual(expect.arrayContaining(['key', 'title', 'actions']));
			}
		}
	});

	it('shrinks the widths of the user towards their minimum before the title goes below its own', () => {
		const big: ColumnPrefs = { widths: { key: 128, status: 160 }, hidden: [] };
		// Everything that can give way is gone ("Quelle" first, it is switched on here); key, Prio,
		// status, actions and 10rem of title stay.
		const fit = fitColumns(500, TICKET_TABLE.columns, big);
		expect(fit.autoHidden).toEqual(['source', 'created', 'tags', 'project', 'due']);
		expect(fit.widths.key).toBeLessThan(128);
		expect(fit.widths.status).toBeLessThan(160);
		expect(fit.flexWidth).toBeGreaterThanOrEqual(10 * REM);
		// Below the sum of the minimums the title gives up its minimum.
		const narrow = fitColumns(300, TICKET_TABLE.columns, NONE);
		expect(narrow.widths.key).toBe(spec(TICKET_TABLE, 'key').min);
		expect(narrow.flexWidth).toBeLessThan(10 * REM);
	});
});

describe('fitChips', () => {
	/** Every character 10 px, plus 10 px padding and border per chip. */
	const measure = (text: string) => text.length * 10 + 10;

	it('shows nothing for no tags and a single tag that fits', () => {
		expect(fitChips([], 100, measure)).toEqual({ shown: [], rest: [] });
		expect(fitChips(['Haus'], 100, measure)).toEqual({ shown: ['Haus'], rest: [] });
	});

	it('shows every tag when they fit exactly, including the gaps', () => {
		// 50 + 4 + 50 + 4 + 50 = 158
		expect(fitChips(['Haus', 'Auto', 'Bank'], 158, measure)).toEqual({
			shown: ['Haus', 'Auto', 'Bank'],
			rest: []
		});
	});

	it('keeps room for "+N" when not all fit', () => {
		// Two chips (104) + gap + "+1" (30) = 138 fits in 157; all three (158) do not.
		expect(fitChips(['Haus', 'Auto', 'Bank'], 157, measure)).toEqual({
			shown: ['Haus', 'Auto'],
			rest: ['Bank']
		});
		// 50 + 4 + "+2" (30) = 84
		expect(fitChips(['Haus', 'Auto', 'Bank'], 84, measure)).toEqual({
			shown: ['Haus'],
			rest: ['Auto', 'Bank']
		});
	});

	it('shows many tags as a few chips and a count', () => {
		const names = Array.from({ length: 12 }, (_, index) => `T${index}`);
		// Two chips (64) + gap + "+10" (40) = 108; three chips and "+9" would need 132.
		const fit = fitChips(names, 120, measure);
		expect(fit.shown).toEqual(['T0', 'T1']);
		expect(fit.rest).toHaveLength(10);
	});

	it('shows one very long tag (the stylesheet shortens it) and counts the rest', () => {
		const long = 'Ein sehr langer Tag, der nie in eine Zelle passt';
		expect(fitChips([long], 100, measure)).toEqual({ shown: [long], rest: [] });
		expect(fitChips([long, 'Haus'], 100, measure)).toEqual({ shown: [long], rest: ['Haus'] });
	});

	it('estimates text widths without a canvas', () => {
		expect(estimateTextWidth('Garten', 12)).toBeCloseTo(43.2);
	});
});
