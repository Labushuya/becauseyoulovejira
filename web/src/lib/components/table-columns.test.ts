// Tables without sideways scrolling (ADR-0025 section 6; plan UI-Konsistenz, package UI-6b):
// next to the embedded side panel the view gets narrower, and a table must not be cut off at the
// panel edge. No table has a minimum width or a horizontal scroll area; instead its frame is a
// size container, and container queries hide columns in a fixed order. jsdom evaluates no
// container queries, so this is a static check of the sources; the look at 1280, 1100 and
// 900 px is a browser case (BYL-E6-028).

import { describe, expect, it } from 'vitest';
import { MORE_COLUMNS_HINT } from '$lib/domain/labels';
import inboxTable from './InboxTable.svelte?raw';
import ticketTable from './TicketTable.svelte?raw';

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

	it.each(tables)('%s hides columns through container queries of its frame', (_path, source) => {
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
		expect(MORE_COLUMNS_HINT).toBe(' · Weitere Spalten im Panel');
	});

	it('hides the ticket columns in the order Erstellt, Tags, Projekt, Fällig', () => {
		expect(hideOrder(ticketTable)).toEqual(['created', 'tags', 'project', 'due']);
	});

	it('hides the inbox columns in the order arrival, Quelle, Art, Quelldatum', () => {
		expect(hideOrder(inboxTable)).toEqual(['arrival', 'source', 'kind', 'source-date']);
	});
});
