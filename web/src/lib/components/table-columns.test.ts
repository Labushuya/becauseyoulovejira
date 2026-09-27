// Tables without sideways scrolling (ADR-0025 section 11; ADR-0030): next to the embedded side
// panel the view gets narrower, and a table must not be cut off at the panel edge. No table has a
// minimum width or a horizontal scroll area. Since ADR-0030 fitColumns fits the columns into the
// measured frame (fixed table layout with a colgroup) instead of container queries; the order in
// which columns give way and the thresholds are unit tests (domain/columns.test.ts), the fit in a
// component a test with a stubbed ResizeObserver. Tables that have not moved yet (packages SP-2
// to SP-5) still hide columns through container queries of their frame, checked statically here
// because jsdom evaluates none. The look at 1280, 1100 and 900 px is a browser case (BYL-E6-028,
// BYL-E6-142).

import { describe, expect, it } from 'vitest';
import { MORE_COLUMNS_HINT } from '$lib/domain/labels';
import inboxTable from './InboxTable.svelte?raw';
import projectTable from './ProjectTable.svelte?raw';
import recurrenceTable from './RecurrenceTable.svelte?raw';

const components = import.meta.glob('/src/**/*.svelte', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

/** Components that render a table. */
const tables = Object.entries(components).filter(([, source]) => /<table\b/.test(source));

/** Tables on the computed fit of ADR-0030. */
const FITTED = ['TicketTable.svelte'];

const fitted = tables.filter(([path]) => FITTED.includes(path.split('/').pop() ?? ''));
const legacy = tables.filter(([path]) => !FITTED.includes(path.split('/').pop() ?? ''));

function styleOf(source: string): string {
	return /<style>([\s\S]*?)<\/style>/.exec(source)?.[1] ?? '';
}

/** Hidden columns per container query, widest threshold first. */
function hiddenColumns(source: string): { width: number; columns: string[] }[] {
	const rules = [
		...styleOf(source).matchAll(/@container \(max-width: ([\d.]+)rem\) \{([\s\S]*?)\n\t\}/g)
	];
	return rules
		.map(([, width, body]) => ({
			width: Number(width),
			columns: [...(body ?? '').matchAll(/\[data-col='([a-z-]+)'\][^{]*\{\s*display:\s*none/g)].map(
				(match) => match[1] as string
			)
		}))
		.filter((rule) => rule.columns.length > 0)
		.sort((a, b) => b.width - a.width);
}

/** Columns in the order in which they give way. */
function hideOrder(source: string): string[] {
	return hiddenColumns(source).flatMap((rule) => rule.columns);
}

describe('tables without sideways scrolling', () => {
	it('finds the tables of the app', () => {
		expect(tables.map(([path]) => path.split('/').pop()).sort()).toEqual([
			'InboxTable.svelte',
			'ProjectTable.svelte',
			'RecurrenceTable.svelte',
			'TicketTable.svelte'
		]);
		expect(fitted.map(([path]) => path.split('/').pop())).toEqual(FITTED);
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

	it.each(fitted)('%s fits its columns with fitColumns in a fixed layout', (_path, source) => {
		const style = styleOf(source);
		const table = /\n\ttable\s*\{([^}]*)\}/.exec(style)?.[1];
		expect(table).toMatch(/table-layout:\s*fixed/);
		// One mechanism: no own container queries, no container frame.
		expect(style).not.toMatch(/@container/);
		expect(style).not.toMatch(/container-type/);
		expect(style).not.toMatch(/display:\s*none/);
		expect(source).toMatch(/fitColumns\(/);
		expect(source).toMatch(/observeWidth\(/);
		expect(source).toContain('<colgroup>');
		// The caption names the panel only when a column gave way for lack of space.
		expect(source).toMatch(
			/\{#if fit\.autoHidden\.length > 0\}<span class="caption-more"\s*>\{MORE_COLUMNS_HINT\}/
		);
		expect(MORE_COLUMNS_HINT).toBe(' · Weitere Spalten im Panel');
	});

	it.each(legacy)('%s hides columns through container queries of its frame', (_path, source) => {
		const style = styleOf(source);
		expect(style).toMatch(/\.frame\s*\{[^}]*container-type:\s*inline-size/);
		expect(hiddenColumns(source).length).toBeGreaterThanOrEqual(4);
		// The caption names the panel as soon as the first column is gone.
		const first = hiddenColumns(source)[0]?.width;
		expect(style).toMatch(
			new RegExp(
				`@container \\(max-width: ${first}rem\\) \\{\\s*\\.caption-more \\{\\s*display: inline`
			)
		);
		expect(source).toContain('<span class="caption-more">{MORE_COLUMNS_HINT}</span>');
	});

	it('hides the inbox columns in the order arrival, Quelle, Art, Quelldatum', () => {
		expect(hideOrder(inboxTable)).toEqual(['arrival', 'source', 'kind', 'source-date']);
	});

	it('hides the project columns in the order archiviert, neu, gesamt, aktiv', () => {
		expect(hideOrder(projectTable)).toEqual(['archived', 'new', 'total', 'active']);
	});

	it('hides the rule columns in the order Projekt, Offenes Ticket, Nächstes Ticket, Rhythmus', () => {
		expect(hideOrder(recurrenceTable)).toEqual(['project', 'open', 'next', 'rhythm']);
	});
});
