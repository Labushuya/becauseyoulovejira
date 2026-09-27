// Tables without sideways scrolling (ADR-0025 section 11; ADR-0030): next to the embedded side
// panel the view gets narrower, and a table must not be cut off at the panel edge. No table has a
// minimum width or a horizontal scroll area. Since ADR-0030 (packages SP-2 and SP-5) every table
// fits its columns into the measured frame through ColumnFit and fitColumns, with a fixed table
// layout and a colgroup, instead of container queries. The order in which columns give way and
// the thresholds are unit tests (domain/columns.test.ts), the fit in a component a test with a
// stubbed ResizeObserver. This static check keeps one mechanism for all four tables. The look at
// 1280, 1100 and 900 px is a browser case (BYL-E6-028, BYL-E6-142, BYL-E6-148).

import { describe, expect, it } from 'vitest';
import { MORE_COLUMNS_HINT } from '$lib/domain/labels';

const components = import.meta.glob('/src/**/*.svelte', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

/** Components that render a table. */
const tables = Object.entries(components).filter(([, source]) => /<table\b/.test(source));

function styleOf(source: string): string {
	return /<style>([\s\S]*?)<\/style>/.exec(source)?.[1] ?? '';
}

describe('tables without sideways scrolling', () => {
	it('finds the tables of the app', () => {
		expect(tables.map(([path]) => path.split('/').pop()).sort()).toEqual([
			'InboxTable.svelte',
			'ProjectTable.svelte',
			'RecurrenceTable.svelte',
			'TicketTable.svelte'
		]);
	});

	it.each(tables)('%s has no minimum width and no horizontal scroll area', (_path, source) => {
		const style = styleOf(source);
		expect(style).not.toMatch(/overflow-x:\s*(auto|scroll)/);
		expect(style).not.toMatch(/overflow:\s*(auto|scroll)/);
		const table = /\n\ttable\s*\{([^}]*)\}/.exec(style)?.[1];
		expect(table).toMatch(/width:\s*100%/);
		expect(table).not.toMatch(/min-width/);
		expect(source).not.toMatch(/role="region"/);
	});

	it.each(tables)('%s fits its columns with ColumnFit in a fixed layout', (_path, source) => {
		const style = styleOf(source);
		const table = /\n\ttable\s*\{([^}]*)\}/.exec(style)?.[1];
		expect(table).toMatch(/table-layout:\s*fixed/);
		// One mechanism: no own container queries, no container frame, no hiding by CSS.
		expect(style).not.toMatch(/@container/);
		expect(style).not.toMatch(/container-type/);
		expect(style).not.toMatch(/display:\s*none/);
		expect(source).toMatch(
			/new ColumnFit\(\s*getColumnPrefs\('(tickets|inbox|projects|recurrences)'\)/
		);
		expect(source).toMatch(/columnFit\.observe\(/);
		expect(source).toContain('<colgroup>');
		expect(source).toContain('<ResizableHeader');
		// The caption names the panel only when a column gave way for lack of space.
		expect(source).toMatch(
			/\{#if (columnFit\.)?fit\.autoHidden\.length > 0\}<span class="caption-more"\s*>\{MORE_COLUMNS_HINT\}/
		);
		expect(MORE_COLUMNS_HINT).toBe(' · Weitere Spalten im Panel');
	});
});
