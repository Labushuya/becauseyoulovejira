// Component tests for the columns of the ticket table (ADR-0030, package SP-2): fitColumns with a
// stubbed ResizeObserver instead of container queries, the colgroup, the grip with dragging,
// Escape and double click, and the preferences of the device. Layout, real pointer capture and
// touch are browser cases (BYL-E6-142).

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseListQuery } from '$lib/domain/list-query';
import type { TicketSummary } from '$lib/domain/ticket';
import { CatalogStore } from '$lib/stores/catalog.svelte';
import { COLUMN_PREFS_CONTEXT, ColumnPrefsRegistry } from '$lib/stores/column-prefs.svelte';
import { TicketListStore, type TicketListData } from '$lib/stores/ticket-list.svelte';
import { resize, useResizeObserverStub } from '$lib/test/resize-observer-stub';
import TicketTable from './TicketTable.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: { url: new URL('http://localhost:3000/') }
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));

useResizeObserverStub();

const SESSION = { ensureValid: () => true, logout: vi.fn() };

function ticket(index: number, overrides: Partial<TicketSummary> = {}): TicketSummary {
	return {
		id: `t${String(index).padStart(14, '0')}`,
		key: `TASK-${index}`,
		title: `Ticket ${index}`,
		status: 'open',
		priority: 'medium',
		due: null,
		projectId: null,
		tagIds: [],
		project: null,
		tags: [],
		recurring: false,
		source: null,
		completedAt: null,
		created: `2026-09-0${index} 10:00:00.000Z`,
		updated: '2026-09-01 10:00:00.000Z',
		...overrides
	};
}

function fakeData(open: TicketSummary[]): TicketListData {
	return {
		listOpen: vi.fn(async () => open),
		listDone: vi.fn(async (page: number) => ({ items: [], page, hasMore: false })),
		searchOpen: vi.fn(async (): Promise<string[]> => []),
		setDone: vi.fn(async () => open[0] as TicketSummary),
		update: vi.fn(async () => open[0] as TicketSummary)
	};
}

async function showTable(path = '/', context?: Map<unknown, unknown>) {
	mocks.page.url = new URL(path, 'http://localhost:3000');
	const store = new TicketListStore(fakeData([ticket(1), ticket(2)]), SESSION, {});
	const catalog = new CatalogStore(
		{ listProjects: vi.fn(async () => []), listTags: vi.fn(async () => []), createTag: vi.fn() },
		SESSION
	);
	void catalog.load();
	store.activate(parseListQuery(mocks.page.url.searchParams));
	const result = render(TicketTable, { props: { store, catalog }, context });
	await vi.advanceTimersByTimeAsync(0);
	return result;
}

function table() {
	return screen.getByRole('table', { name: /^Tickets/ });
}

function frame() {
	return table().parentElement as HTMLElement;
}

function headerIds(): (string | null)[] {
	return within(table())
		.getAllByRole('columnheader')
		.map((header) => header.getAttribute('data-col'));
}

function colWidth(id: string): string {
	return (table().querySelector(`col[data-column="${id}"]`) as HTMLElement).style.width;
}

function grip(id: string): HTMLElement {
	return table().querySelector(`[data-column-grip="${id}"]`) as HTMLElement;
}

function stored(): unknown {
	const raw = localStorage.getItem('byl-columns-tickets');
	return raw === null ? null : JSON.parse(raw);
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
	vi.setSystemTime(Date.UTC(2026, 8, 24, 10));
	mocks.goto.mockClear();
	localStorage.clear();
});

afterEach(() => {
	vi.useRealTimers();
	localStorage.clear();
	document.body.innerHTML = '';
});

describe('columns of the ticket table (ADR-0030)', () => {
	it('fixes the widths in a colgroup and shows every column while the frame is not measured', async () => {
		await showTable();

		expect(headerIds()).toEqual([
			'key',
			'priority',
			'status',
			'title',
			'project',
			'tags',
			'due',
			'created',
			'actions'
		]);
		expect(colWidth('key')).toBe('96px');
		expect(colWidth('tags')).toBe('128px');
		// The title takes the rest.
		expect(colWidth('title')).toBe('');
		expect(table().querySelector('caption')?.textContent).not.toMatch(/Weitere Spalten/);
	});

	it('lets Erstellt and Tags give way at 800 px and brings them back on a wide frame', async () => {
		await showTable('/?gruppe=status');

		resize(frame(), 800);
		await vi.advanceTimersByTimeAsync(0);

		expect(headerIds()).toEqual([
			'key',
			'priority',
			'status',
			'title',
			'project',
			'due',
			'actions'
		]);
		expect(table().querySelectorAll('col')).toHaveLength(7);
		const row = table().querySelector('tr[data-ticket-id]') as HTMLElement;
		expect([...row.children].map((cell) => cell.getAttribute('data-col'))).toEqual([
			'key',
			'priority',
			'status',
			'title',
			'project',
			'due',
			'actions'
		]);
		const head = screen.getByRole('rowheader', { name: /^Offen/ });
		expect(head.getAttribute('colspan')).toBe('7');
		expect(table().querySelector('caption')?.textContent).toMatch(/Weitere Spalten im Panel$/);

		resize(frame(), 1400);
		await vi.advanceTimersByTimeAsync(0);

		expect(headerIds()).toHaveLength(9);
		expect(head.getAttribute('colspan')).toBe('9');
		expect(table().querySelector('caption')?.textContent).not.toMatch(/Weitere Spalten/);
	});

	it('changes the width live while dragging the grip and stores it on release', async () => {
		await showTable();

		await fireEvent.pointerDown(grip('project'), { button: 0, pointerId: 1, clientX: 100 });
		await fireEvent.pointerMove(grip('project'), { pointerId: 1, clientX: 140 });
		expect(colWidth('project')).toBe('168px');
		expect(stored()).toBeNull();

		await fireEvent.pointerUp(grip('project'), { pointerId: 1, clientX: 150 });

		expect(colWidth('project')).toBe('178px');
		expect(stored()).toEqual({ v: 1, widths: { project: 178 }, hidden: ['source'] });
	});

	it('clamps the drag to the maximum of the column and to the room of the title', async () => {
		await showTable();
		// All columns need 968 px; at 1000 px the title has 32 px above its minimum.
		resize(frame(), 1000);
		await vi.advanceTimersByTimeAsync(0);

		await fireEvent.pointerDown(grip('project'), { button: 0, pointerId: 1, clientX: 100 });
		await fireEvent.pointerMove(grip('project'), { pointerId: 1, clientX: 400 });
		expect(colWidth('project')).toBe('160px');
		await fireEvent.pointerUp(grip('project'), { pointerId: 1, clientX: 400 });

		resize(frame(), 2000);
		await vi.advanceTimersByTimeAsync(0);
		await fireEvent.pointerDown(grip('key'), { button: 0, pointerId: 2, clientX: 0 });
		await fireEvent.pointerMove(grip('key'), { pointerId: 2, clientX: 900 });
		// Key: at most 8rem.
		expect(colWidth('key')).toBe('128px');
		await fireEvent.pointerMove(grip('key'), { pointerId: 2, clientX: -900 });
		expect(colWidth('key')).toBe('64px');
	});

	it('puts the old width back on Escape during the drag and consumes the key', async () => {
		await showTable();
		const outside = vi.fn();
		document.addEventListener('keydown', outside);

		await fireEvent.pointerDown(grip('tags'), { button: 0, pointerId: 1, clientX: 100 });
		await fireEvent.pointerMove(grip('tags'), { pointerId: 1, clientX: 180 });
		expect(colWidth('tags')).toBe('208px');

		const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
		document.body.dispatchEvent(escape);
		await vi.advanceTimersByTimeAsync(0);

		expect(escape.defaultPrevented).toBe(true);
		expect(outside).not.toHaveBeenCalled();
		expect(colWidth('tags')).toBe('128px');
		// The release after Escape changes nothing.
		await fireEvent.pointerUp(grip('tags'), { pointerId: 1, clientX: 180 });
		expect(colWidth('tags')).toBe('128px');
		expect(stored()).toBeNull();
		document.removeEventListener('keydown', outside);
	});

	it('does not sort on a click or double click on the grip', async () => {
		await showTable();

		await fireEvent.click(grip('due'));
		await fireEvent.dblClick(grip('due'));

		expect(mocks.goto).not.toHaveBeenCalled();
	});

	it('fits the width to the content on a double click, at most up to the maximum', async () => {
		await showTable();
		// jsdom has no layout for ranges: the content of every cell measures `width`.
		let width = 70;
		Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
			configurable: true,
			value: () => ({ width }) as DOMRect
		});
		try {
			await fireEvent.dblClick(grip('created'));
			// Below the minimum of "Erstellt" (5rem).
			expect(colWidth('created')).toBe('80px');

			width = 1000;
			await fireEvent.dblClick(grip('project'));
			expect(colWidth('project')).toBe('256px');
			expect(stored()).toEqual({
				v: 1,
				widths: { created: 80, project: 256 },
				hidden: ['source']
			});
		} finally {
			delete (Range.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect;
		}
	});

	it('has grips only for columns with a changeable width, hidden from assistive technology', async () => {
		await showTable();

		const grips = [...table().querySelectorAll<HTMLElement>('[data-column-grip]')];
		expect(grips.map((entry) => entry.dataset.columnGrip)).toEqual([
			'key',
			'priority',
			'status',
			'project',
			'tags',
			'due',
			'created'
		]);
		for (const entry of grips) {
			expect(entry.getAttribute('aria-hidden')).toBe('true');
			expect(entry.hasAttribute('tabindex')).toBe(false);
		}
	});

	it('follows the stored preferences of the device', async () => {
		localStorage.setItem(
			'byl-columns-tickets',
			JSON.stringify({ v: 1, widths: { project: 200 }, hidden: ['priority', 'created'] })
		);
		await showTable('/?gruppe=status');

		expect(colWidth('project')).toBe('200px');
		// "Quelle" is not in the stored list, so the user switched it on.
		expect(headerIds()).toEqual([
			'key',
			'status',
			'title',
			'source',
			'project',
			'tags',
			'due',
			'actions'
		]);
		expect(screen.getByRole('rowheader', { name: /^Offen/ }).getAttribute('colspan')).toBe('8');
		const row = table().querySelector('tr[data-ticket-id]') as HTMLElement;
		expect(row.querySelector('[data-col="source"]')?.textContent).toBe('Manuell');
		// Switched off by the user, not for lack of space: no hint in the caption.
		expect(table().querySelector('caption')?.textContent).not.toMatch(/Weitere Spalten/);
	});

	it('uses the store of the registry of the app layout', async () => {
		const registry = new ColumnPrefsRegistry(window);
		await showTable('/', new Map([[COLUMN_PREFS_CONTEXT, registry]]));

		registry.get('tickets').setWidth('due', 150);
		await vi.advanceTimersByTimeAsync(0);

		expect(colWidth('due')).toBe('150px');
	});
});
