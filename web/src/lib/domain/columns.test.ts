// Unit tests for the columns of the tables (ADR-0030): specs, stored preferences, the fit into the
// frame and the tag chips of a compact row. The order in which columns give way was a static
// check of the container queries before (table-columns.test.ts); here it is computed.

import { describe, expect, it } from 'vitest';
import {
	COLUMN_PREFS_VERSION,
	INBOX_TABLE,
	KEY_AUTO_MAX,
	NEST_SUBTASKS,
	PROJECT_TABLE,
	RECURRENCE_TABLE,
	REM,
	TABLES,
	TICKET_TABLE,
	TRASH_TABLE,
	changedOptions,
	clampWidth,
	columnWidth,
	defaultColumnPrefs,
	estimateTextWidth,
	fitChips,
	fitColumns,
	formatRem,
	isDefaultColumnPrefs,
	flexibleBounds,
	flexibleTarget,
	isKeyCut,
	isResizable,
	keyCellWidth,
	menuColumns,
	optionValue,
	parseColumnPrefs,
	resizeColumn,
	serializeColumnPrefs,
	withKeyDefaults,
	type ColumnPrefs,
	type ColumnSpec,
	type TableOption,
	type TableSpec
} from './columns';

/**
 * Nothing chosen for the tickets: default widths, "Übergeordnet" (ADR-0033 section 5) and "Quelle"
 * (ADR-0019 section 4) off.
 */
const NONE: ColumnPrefs = { widths: {}, hidden: ['parent', 'source'] };

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
		expect(Object.keys(TABLES)).toEqual(['tickets', 'inbox', 'projects', 'recurrences', 'trash']);
	});

	it('keeps key, title and actions of the tickets always shown and lists the rest in the menu', () => {
		// The title is listed for its width only (Nachtrag 3), in the order of the table.
		expect(menuColumns(TICKET_TABLE.columns).map((entry) => entry.id)).toEqual([
			'priority',
			'status',
			'title',
			'parent',
			'source',
			'project',
			'tags',
			'due',
			'created'
		]);
		expect(defaultColumnPrefs(TICKET_TABLE.columns)).toEqual(NONE);
		expect(isResizable(spec(TICKET_TABLE, 'key'))).toBe(true);
		expect(isResizable(spec(TICKET_TABLE, 'actions'))).toBe(false);
		// Since Nachtrag 3 the flexible column of every table can be resized, from 10 to 60rem.
		for (const table of Object.values(TABLES)) {
			const flex = table.columns.find((entry) => entry.flexible) as ColumnSpec;
			expect(isResizable(flex), table.id).toBe(true);
			expect([flex.min, flex.max], table.id).toEqual([10 * REM, 60 * REM]);
		}
		// Maximum widths of the concept: Tags 20rem, Projekt 16rem; Key since KN-1 12rem (8 before).
		expect(spec(TICKET_TABLE, 'tags').max).toBe(20 * REM);
		expect(spec(TICKET_TABLE, 'project').max).toBe(16 * REM);
		expect(spec(TICKET_TABLE, 'key').max).toBe(12 * REM);
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
		const raw = serializeColumnPrefs(prefs, columns);
		expect(JSON.parse(raw)).toEqual({
			v: 1,
			widths: { project: 160, key: 112 },
			hidden: ['created'],
			shown: ['parent']
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
		// The title has a width since Nachtrag 3; it is never hidden.
		expect(parseColumnPrefs(raw, columns)).toEqual({
			widths: { key: spec(TICKET_TABLE, 'key').max, title: 300 },
			hidden: ['parent', 'tags']
		});
		// JSON has no NaN: a text with NaN is broken JSON and means the defaults.
		expect(parseColumnPrefs(`{"v":1,"widths":{"tags":NaN}}`, columns)).toEqual(
			defaultColumnPrefs(columns)
		);
	});

	it('keeps the default hidden columns when the list is missing', () => {
		expect(defaultColumnPrefs(columns).hidden).toEqual(['parent', 'source']);
		const missing = JSON.stringify({ v: 1, widths: {} });
		expect(parseColumnPrefs(missing, columns).hidden).toEqual(['parent', 'source']);
		// A stored empty list means the user switched "Quelle" on; "Übergeordnet" came later and is
		// on only when `shown` names it (ADR-0033), so older lists do not switch it on.
		const empty = JSON.stringify({ v: 1, widths: {}, hidden: [] });
		expect(parseColumnPrefs(empty, columns).hidden).toEqual(['parent']);
		const both = JSON.stringify({ v: 1, widths: {}, hidden: [], shown: ['parent', 'x', 3] });
		expect(parseColumnPrefs(both, columns).hidden).toEqual([]);
		expect(JSON.parse(serializeColumnPrefs({ widths: {}, hidden: [] }, columns)).shown).toEqual([
			'parent'
		]);
		expect(JSON.parse(serializeColumnPrefs(NONE, columns))).not.toHaveProperty('shown');
	});

	it('knows the defaults', () => {
		expect(isDefaultColumnPrefs(defaultColumnPrefs(columns), columns)).toBe(true);
		expect(isDefaultColumnPrefs({ widths: { tags: 200 }, hidden: [] }, columns)).toBe(false);
		expect(isDefaultColumnPrefs({ widths: {}, hidden: ['tags'] }, columns)).toBe(false);
	});
});

describe('switches of a table (ADR-0033 section 5)', () => {
	const { columns, options } = TICKET_TABLE;
	const nest = options[0] as TableOption;

	it('has "Unteraufgaben einrücken", on by default, for the tickets only', () => {
		expect(options).toEqual([
			{ id: NEST_SUBTASKS, label: 'Unteraufgaben einrücken', default: true }
		]);
		for (const table of [INBOX_TABLE, PROJECT_TABLE, RECURRENCE_TABLE]) {
			expect(table.options).toEqual([]);
		}
		expect(optionValue(defaultColumnPrefs(columns), nest)).toBe(true);
	});

	it('stores only a switch that differs from its default and reads it back', () => {
		const prefs: ColumnPrefs = {
			widths: {},
			hidden: ['parent', 'source'],
			options: { nest: false }
		};
		const raw = serializeColumnPrefs(prefs);

		expect(JSON.parse(raw)).toEqual({
			v: 1,
			widths: {},
			hidden: ['parent', 'source'],
			options: { nest: false }
		});
		expect(parseColumnPrefs(raw, columns, options)).toEqual(prefs);
		expect(optionValue(parseColumnPrefs(raw, columns, options), nest)).toBe(false);
		expect(isDefaultColumnPrefs(prefs, columns)).toBe(false);
		expect(JSON.parse(serializeColumnPrefs(NONE))).not.toHaveProperty('options');
	});

	it('drops unknown switches, wrong types and values equal to the default', () => {
		const raw = JSON.stringify({
			v: 1,
			widths: {},
			hidden: ['source'],
			options: { nest: true, unknown: false, other: 'false' }
		});
		expect(parseColumnPrefs(raw, columns, options)).toEqual({
			widths: {},
			hidden: ['parent', 'source']
		});
		const wrong = JSON.stringify({ v: 1, widths: {}, hidden: [], options: { nest: 'false' } });
		expect(parseColumnPrefs(wrong, columns, options)).toEqual({ widths: {}, hidden: ['parent'] });
		expect(changedOptions({ nest: false }, options)).toEqual({ nest: false });
		expect(changedOptions({ nest: true }, options)).toBeUndefined();
		// Without the switches of the table nothing is read.
		const off = JSON.stringify({ v: 1, widths: {}, hidden: [], options: { nest: false } });
		expect(parseColumnPrefs(off, columns)).toEqual({ widths: {}, hidden: ['parent'] });
	});
});

describe('fitColumns', () => {
	it('shows everything at the default widths without a measured frame', () => {
		const fit = fitColumns(null, TICKET_TABLE.columns, NONE);
		const all = TICKET_TABLE.columns.map((entry) => entry.id);
		expect(fit.visible).toEqual(all.filter((id) => id !== 'source' && id !== 'parent'));
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
	// table layout needs real widths for key, status and actions, so they move by up to 2.5rem. The
	// selection of the tickets (plan BI-2) adds its 2.5rem on top of that, the menu "•••" of a row
	// (plan aktionsmenues, AM-2) another 1.5rem; with the menus of AM-4 the inbox adds 2rem and the
	// projects their new column of 3.5rem (ADR-0030, Nachtrag 5). Trash and rules keep their width.
	const ADDED = new Map([
		[TICKET_TABLE, 2.5 + 1.5],
		[INBOX_TABLE, 2],
		[PROJECT_TABLE, 3.5]
	]);
	it.each([
		[TICKET_TABLE, { created: [60, 64.5], tags: [52, 58.5], project: [44, 50.5], due: [36, 42.5] }],
		[
			INBOX_TABLE,
			{ arrival: [52, 52.5], source: [46, 46.5], kind: [40, 39.5], 'source-date': [34, 33.5] }
		],
		[PROJECT_TABLE, { archived: [40, 41.5], new: [34, 35], total: [28, 30], active: [22, 24.5] }],
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
			const added = ADDED.get(table) ?? 0;
			expect(Math.abs(actual - added - before), label).toBeLessThanOrEqual(2.5);
		}
	});

	it('gives the actions of the other tables room for the menu "•••" of AM-4', () => {
		const actions = (table: TableSpec) => table.columns.find((entry) => entry.id === 'actions');
		expect(actions(INBOX_TABLE)?.width).toBe(15 * REM);
		expect(actions(PROJECT_TABLE)).toMatchObject({ width: 3.5 * REM, required: true });
		expect(actions(RECURRENCE_TABLE)?.width).toBe(3.5 * REM);
		expect(actions(TRASH_TABLE)?.width).toBe(5 * REM);
		expect(menuColumns(PROJECT_TABLE.columns).map((entry) => entry.id)).not.toContain('actions');
	});

	it('hides "Erstellt" and "Tags" of the tickets at 840 px and names them as hidden for space', () => {
		const fit = fitColumns(840, TICKET_TABLE.columns, NONE);
		expect(fit.autoHidden).toEqual(['created', 'tags']);
		expect(fit.visible).toEqual([
			'select',
			'key',
			'priority',
			'status',
			'title',
			'project',
			'due',
			'actions'
		]);
		expect(fit.flexWidth).toBe(840 - 40 - 96 - 64 - 104 - 128 - 128 - 88);
		// 800 px, enough before the menu "•••" of the rows, now leaves "Projekt" out as well.
		expect(fitColumns(800, TICKET_TABLE.columns, NONE).autoHidden).toEqual([
			'created',
			'tags',
			'project'
		]);
	});

	it('hides earlier when the user made columns wider, and keeps their widths', () => {
		const wide: ColumnPrefs = { widths: { tags: 320 }, hidden: ['parent', 'source'] };
		const before = threshold(TICKET_TABLE, 'created');
		expect(threshold(TICKET_TABLE, 'created', wide)).toBeGreaterThan(before);
		// All columns need 1224 px with the wide tags instead of 1032 px (selection included).
		const fit = fitColumns(1240, TICKET_TABLE.columns, wide);
		expect(fit.widths.tags).toBe(320);
		expect(fit.autoHidden).toEqual([]);
		expect(fitColumns(1140, TICKET_TABLE.columns, wide).autoHidden).toEqual(['created']);
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
		// Everything that can give way is gone ("Übergeordnet" and "Quelle" first, they are switched on
		// here); key, Prio, status, actions and 10rem of title stay.
		const fit = fitColumns(500, TICKET_TABLE.columns, big);
		expect(fit.autoHidden).toEqual(['parent', 'source', 'created', 'tags', 'project', 'due']);
		expect(fit.widths.key).toBeLessThan(128);
		expect(fit.widths.status).toBeLessThan(160);
		expect(fit.flexWidth).toBeGreaterThanOrEqual(10 * REM);
		// Below the sum of the minimums the title gives up its minimum (the others need 312 px).
		const narrow = fitColumns(320, TICKET_TABLE.columns, NONE);
		expect(narrow.widths.key).toBe(spec(TICKET_TABLE, 'key').min);
		expect(narrow.flexWidth).toBeLessThan(10 * REM);
	});
});

describe('width of the title (ADR-0030 Nachtrag 3)', () => {
	const columns = TICKET_TABLE.columns;
	/** The default widths of the shown tickets columns: 872 px besides the title. */
	const OTHERS = 40 + 96 + 64 + 104 + 128 + 128 + 128 + 96 + 88;
	const withTitle = (title: number, hidden = NONE.hidden): ColumnPrefs => ({
		widths: { title },
		hidden
	});
	const sumOf = (fit: ReturnType<typeof fitColumns>) =>
		Object.values(fit.widths).reduce((total, value) => total + value, 0) + (fit.flexWidth ?? 0);

	it('reads older preferences without a title width as before: the title takes the rest', () => {
		const old = parseColumnPrefs('{"v":1,"widths":{"project":160},"hidden":[]}', columns);
		expect(flexibleTarget(columns, old)).toBeNull();
		const fit = fitColumns(1400, columns, old);
		// "Quelle" (112 px) is on in that list, "Projekt" is 32 px wider.
		expect(fit.flexWidth).toBe(1400 - (OTHERS + 112 + 32));
		expect(fit.widths.project).toBe(160);
		// A stored title width is clamped to 10 to 60rem.
		expect(parseColumnPrefs('{"v":1,"widths":{"title":5000}}', columns).widths.title).toBe(960);
		expect(parseColumnPrefs('{"v":1,"widths":{"title":50}}', columns).widths.title).toBe(160);
		expect(flexibleTarget(columns, withTitle(400))).toBe(400);
	});

	it('gives the rest beyond a narrower title evenly to the other columns', () => {
		const plain = fitColumns(1200, columns, NONE);
		const fit = fitColumns(1200, columns, withTitle(240));

		expect(plain.flexWidth).toBe(1200 - OTHERS);
		expect(fit.flexWidth).toBe(240);
		expect(sumOf(fit)).toBe(1200);
		for (const id of ['key', 'priority', 'status', 'project', 'tags', 'due', 'created']) {
			expect(fit.widths[id], id).toBeGreaterThan(plain.widths[id] as number);
		}
		// Fixed columns keep their width; the widest room (Tags) gets the most.
		expect(fit.widths.select).toBe(40);
		expect(fit.widths.actions).toBe(88);
		expect((fit.widths.tags as number) - 128).toBeGreaterThan((fit.widths.key as number) - 96);
	});

	it('gives the rest back to the title once every other column is at its maximum', () => {
		const fit = fitColumns(3000, columns, withTitle(240));
		expect(fit.widths.tags).toBe(320);
		expect(fit.widths.project).toBe(256);
		expect(fit.flexWidth).toBe(3000 - (40 + 192 + 96 + 160 + 256 + 320 + 192 + 144 + 88));
	});

	it('lets a wide title give way first when the frame is narrower, without hiding a column', () => {
		for (let width = 1600; width >= 300; width -= 7) {
			const plain = fitColumns(width, columns, NONE);
			const fit = fitColumns(width, columns, withTitle(700));
			expect(fit.autoHidden, `${width}px`).toEqual(plain.autoHidden);
			expect(sumOf(fit), `${width}px`).toBeLessThanOrEqual(width);
			expect(fit.visible, `${width}px`).toContain('title');
			// Below its chosen width the title is exactly what it was without one.
			if ((plain.flexWidth as number) <= 700) expect(fit).toEqual(plain);
		}
	});

	it('shares the rest only among the shown columns', () => {
		const hidden = ['parent', 'source', 'tags'];
		const fit = fitColumns(1200, columns, withTitle(240, hidden));
		expect(fit.widths).not.toHaveProperty('tags');
		expect(sumOf(fit)).toBe(1200);
		expect(fit.flexWidth).toBe(240);
	});

	it('bounds the title by the room of the others: minimum and maximum', () => {
		// 328 px of rest at 1200 px; the others can give 272 px and take 616 px.
		expect(flexibleBounds(1200, columns, NONE)).toEqual({ min: 160, max: 600 });
		// On a very wide frame the others reach their maximum first: the title stays wide.
		expect(flexibleBounds(3000, columns, NONE)).toEqual({ min: 960, max: 960 });
		// Not measured: the bounds of the column.
		expect(flexibleBounds(null, columns, NONE)).toEqual({ min: 160, max: 960 });
	});

	it('makes the title wider by shrinking the others evenly, down to their minimum', () => {
		const prefs = resizeColumn(1200, columns, NONE, 'title', 500);
		expect(prefs.widths.title).toBe(500);
		for (const id of ['key', 'priority', 'status', 'project', 'tags', 'due', 'created']) {
			const column = spec(TICKET_TABLE, id);
			expect(prefs.widths[id], id).toBeLessThan(column.width);
			expect(prefs.widths[id], id).toBeGreaterThanOrEqual(column.min);
		}
		const fit = fitColumns(1200, columns, prefs);
		expect(fit.flexWidth).toBe(500);
		expect(fit.autoHidden).toEqual([]);

		// Wider than the others allow: the grip stops at 600 px, nothing gives way.
		const most = resizeColumn(1200, columns, NONE, 'title', 2000);
		expect(most.widths.title).toBe(600);
		expect(most.widths.key).toBe(spec(TICKET_TABLE, 'key').min);
		expect(fitColumns(1200, columns, most)).toMatchObject({ flexWidth: 600, autoHidden: [] });
	});

	it('makes the title narrower without touching the stored widths of the others', () => {
		const prefs = resizeColumn(1200, columns, NONE, 'title', 200);
		expect(prefs).toEqual({ widths: { title: 200 }, hidden: NONE.hidden });
		expect(resizeColumn(1200, columns, NONE, 'title', 10)).toEqual(withTitle(160));
		expect(resizeColumn(null, columns, NONE, 'title', 400)).toEqual(withTitle(400));
	});

	it('lets the title give and take for another column, so the rest of the table stays put', () => {
		const prefs = withTitle(240);
		const before = fitColumns(1200, columns, prefs);
		const project = before.widths.project as number;

		const next = resizeColumn(1200, columns, prefs, 'project', project + 20);
		const after = fitColumns(1200, columns, next);

		expect(after.widths.project).toBe(project + 20);
		expect(after.flexWidth).toBe((before.flexWidth as number) - 20);
		for (const id of ['key', 'priority', 'status', 'tags', 'due', 'created']) {
			expect(after.widths[id], id).toBe(before.widths[id]);
		}
		// Without a title width only the column itself changes, as before Nachtrag 3.
		expect(resizeColumn(1200, columns, NONE, 'project', 200)).toEqual({
			widths: { project: 200 },
			hidden: NONE.hidden
		});
		expect(resizeColumn(1200, columns, NONE, 'actions', 200)).toBe(NONE);
	});

	it('keeps the title steady while the frame changes: no jumps, the others take the difference', () => {
		const prefs = withTitle(300);
		const at = (width: number) => fitColumns(width, columns, prefs);
		// From 1700 px on every other column is at its maximum and the title takes the rest again.
		for (let width = 800; width < 1699; width += 1) {
			const small = at(width);
			const big = at(width + 1);
			if (small.autoHidden.length !== big.autoHidden.length) continue;
			const title = small.flexWidth as number;
			// Up to its chosen width the title grows pixel by pixel, then it stays at 300 px.
			expect(big.flexWidth, `${width}px`).toBe(Math.min(300, title + 1));
			for (const [id, px] of Object.entries(small.widths)) {
				expect(big.widths[id] as number, `${id} at ${width}px`).toBeGreaterThanOrEqual(px - 1);
				expect(big.widths[id] as number, `${id} at ${width}px`).toBeLessThanOrEqual(px + 1);
			}
		}
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

describe('columns of keys (KN-1, ADR-0030 Nachtrag 7)', () => {
	/** The longest key of the format: a code of six letters and a seven digit number. */
	const LONGEST = 'ABCDEF-1000000';
	const keyColumn = (columns: readonly ColumnSpec[], id = 'key') =>
		columns.find((entry) => entry.id === id) as ColumnSpec;

	it('needs the key in ch of the mono font, the padding and the dot "neu"', () => {
		// 14 characters of 0.6em at 13 px (7.8 px), 1.5rem of padding, 0.875rem of dot, 2 px of slack.
		expect(keyCellWidth(LONGEST, true)).toBe(150);
		expect(keyCellWidth(LONGEST)).toBe(136);
		expect(keyCellWidth('HAUS-100', true)).toBe(103);
		expect(keyCellWidth('HAUS-100')).toBe(89);
		// Every further digit needs one more ch.
		expect(keyCellWidth('HAUS-1000') - keyCellWidth('HAUS-100')).toBeGreaterThanOrEqual(7);
		expect(keyCellWidth('HAUS-1000') - keyCellWidth('HAUS-100')).toBeLessThanOrEqual(9);
		// A larger default font size of the browser makes the key wider.
		expect(keyCellWidth('HAUS-100', true, 20)).toBeGreaterThan(keyCellWidth('HAUS-100', true));
	});

	it('lets the longest key with the dot fit into the widened bounds of every column of keys', () => {
		const need = keyCellWidth(LONGEST, true);
		// Before KN-1 the key had at most 8rem (128 px): "ABCDEF-1000000" with the dot did not fit.
		expect(need).toBeGreaterThan(8 * REM);
		for (const [table, id] of [
			[TICKET_TABLE, 'key'],
			[TRASH_TABLE, 'key'],
			[TICKET_TABLE, 'parent'],
			[RECURRENCE_TABLE, 'open']
		] as const) {
			const column = spec(table, id);
			expect(column.max, `${table.id} ${id}`).toBeGreaterThanOrEqual(need);
			expect(clampWidth(column, need), `${table.id} ${id}`).toBe(need);
		}
		expect(KEY_AUTO_MAX).toBe(12 * REM);
		expect(spec(TICKET_TABLE, 'key').max).toBe(KEY_AUTO_MAX);
		expect(spec(TRASH_TABLE, 'key').max).toBe(KEY_AUTO_MAX);
	});

	it('keeps the default for short keys, so the thresholds stay as they were', () => {
		const columns = TICKET_TABLE.columns;
		const short = withKeyDefaults(columns, [
			{ id: 'key', keys: ['TASK-1', 'TASK-12', 'HAUS-9'], dot: true },
			{ id: 'parent', keys: ['HAUS-12'] }
		]);
		// The very same specs: every width and threshold of ADR-0030 holds for them unchanged.
		expect(short).toBe(columns);
		expect(withKeyDefaults(columns, [{ id: 'key', keys: [], dot: true }])).toBe(columns);
		expect(withKeyDefaults(columns, [])).toBe(columns);
	});

	it('fits the default width to the longest shown key, with room for the dot', () => {
		const columns = withKeyDefaults(TICKET_TABLE.columns, [
			{ id: 'key', keys: ['HAUS-9', 'HAUS-100', 'HAUS-10'], dot: true }
		]);
		// "HAUS-100" with the dot needs 103 px: 6rem (96 px) cut it off before.
		expect(keyColumn(columns).width).toBe(103);
		expect(isKeyCut('HAUS-100', 96, true)).toBe(true);
		expect(isKeyCut('HAUS-100', keyColumn(columns).width, true)).toBe(false);
		// Only the column of keys changes; min and max stay.
		expect(keyColumn(columns)).toMatchObject({ min: 4 * REM, max: 12 * REM });
		expect(columns.filter((entry) => entry.id !== 'key')).toEqual(
			TICKET_TABLE.columns.filter((entry) => entry.id !== 'key')
		);

		const longest = withKeyDefaults(TICKET_TABLE.columns, [
			{ id: 'key', keys: ['TASK-9', LONGEST, 'TASK-10'], dot: true }
		]);
		expect(keyColumn(longest).width).toBe(150);
		expect(fitColumns(null, longest, NONE).widths.key).toBe(150);
		// Measured: the key keeps its width, the title takes the rest.
		const fit = fitColumns(1400, longest, NONE);
		expect(fit.widths.key).toBe(150);
		const before = fitColumns(1400, TICKET_TABLE.columns, NONE).flexWidth as number;
		expect(fit.flexWidth).toBe(before - (150 - 96));
	});

	it('stops at 12rem on its own; only the user makes it wider or narrower', () => {
		const huge = withKeyDefaults(TICKET_TABLE.columns, [
			{ id: 'key', keys: ['ABCDEF-1000000000000000'], dot: true }
		]);
		expect(keyColumn(huge).width).toBe(KEY_AUTO_MAX);
		// A width the user dragged wins over the default from the keys, in both directions.
		const narrow: ColumnPrefs = { widths: { key: 80 }, hidden: NONE.hidden };
		expect(fitColumns(null, huge, narrow).widths.key).toBe(80);
		expect(columnWidth(keyColumn(huge), narrow)).toBe(80);
		const wide = withKeyDefaults(TICKET_TABLE.columns, [{ id: 'key', keys: [LONGEST], dot: true }]);
		expect(fitColumns(null, wide, { widths: { key: 180 }, hidden: NONE.hidden }).widths.key).toBe(
			180
		);
		// "Standard wiederherstellen" (no stored width) brings the default from the keys back.
		expect(fitColumns(null, wide, NONE).widths.key).toBe(150);
	});

	it('fits the trash, "Übergeordnet" and "Offene Tickets" without the dot', () => {
		const trash = withKeyDefaults(TRASH_TABLE.columns, [{ id: 'key', keys: [LONGEST] }]);
		expect(keyColumn(trash).width).toBe(136);
		const parent = withKeyDefaults(TICKET_TABLE.columns, [{ id: 'parent', keys: [LONGEST] }]);
		expect(keyColumn(parent, 'parent').width).toBe(136);
		const open = withKeyDefaults(RECURRENCE_TABLE.columns, [
			{ id: 'open', keys: ['TASK-7', LONGEST] }
		]);
		expect(keyColumn(open, 'open').width).toBe(136);
		// Short keys keep the default of 7rem.
		const short = withKeyDefaults(RECURRENCE_TABLE.columns, [{ id: 'open', keys: ['TASK-7'] }]);
		expect(short).toBe(RECURRENCE_TABLE.columns);
	});

	it('names a key cut off by a narrow column, and only then', () => {
		expect(isKeyCut(LONGEST, 150, true)).toBe(false);
		expect(isKeyCut(LONGEST, 149, true)).toBe(true);
		expect(isKeyCut(LONGEST, 136)).toBe(false);
		// The default of 6rem holds a short key without the dot, not one of ten characters.
		expect(isKeyCut('TASK-12', 6 * REM)).toBe(false);
		expect(isKeyCut('TASK-10000', 6 * REM)).toBe(true);
		// The narrowest column (4rem) cuts every key off.
		expect(isKeyCut('TASK-1', 4 * REM)).toBe(true);
	});
});
