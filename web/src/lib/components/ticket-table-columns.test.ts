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
		searchOpen: vi.fn(async (): Promise<string[]> => []),
		setDone: vi.fn(async () => open[0] as TicketSummary),
		update: vi.fn(async () => open[0] as TicketSummary)
	};
}

/** Three tags on the second ticket (expanded, as the list loads them). */
const TAGS = ['Haus', 'Garten', 'Bank'].map((name, index) => ({ id: `tag${index}`, name }));

async function showTable(
	path = '/',
	context?: Map<unknown, unknown>,
	open: TicketSummary[] = [ticket(1), ticket(2, { tagIds: TAGS.map((tag) => tag.id), tags: TAGS })]
) {
	mocks.page.url = new URL(path, 'http://localhost:3000');
	const store = new TicketListStore(fakeData(open), SESSION, {});
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
			'select',
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

	it('lets Erstellt and Tags give way at 840 px and brings them back on a wide frame', async () => {
		await showTable('/?gruppe=status');

		resize(frame(), 840);
		await vi.advanceTimersByTimeAsync(0);

		expect(headerIds()).toEqual([
			'select',
			'key',
			'priority',
			'status',
			'title',
			'project',
			'due',
			'actions'
		]);
		expect(table().querySelectorAll('col')).toHaveLength(8);
		const row = table().querySelector('tr[data-ticket-id]') as HTMLElement;
		expect([...row.children].map((cell) => cell.getAttribute('data-col'))).toEqual([
			'select',
			'key',
			'priority',
			'status',
			'title',
			'project',
			'due',
			'actions'
		]);
		const head = screen.getByRole('rowheader', { name: /^Offen/ });
		expect(head.getAttribute('colspan')).toBe('8');
		expect(table().querySelector('caption')?.textContent).toMatch(/Weitere Spalten im Panel$/);

		resize(frame(), 1400);
		await vi.advanceTimersByTimeAsync(0);

		expect(headerIds()).toHaveLength(10);
		expect(head.getAttribute('colspan')).toBe('10');
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
		expect(stored()).toEqual({
			v: 1,
			widths: { project: 178 },
			hidden: ['assignee', 'parent', 'source']
		});
	});

	it('clamps the drag to the maximum of the column and to the room of the title', async () => {
		await showTable();
		// All columns need 1032 px (with the selection and the menu of the rows); at 1064 px the title
		// has 32 px above its minimum.
		resize(frame(), 1064);
		await vi.advanceTimersByTimeAsync(0);

		await fireEvent.pointerDown(grip('project'), { button: 0, pointerId: 1, clientX: 100 });
		await fireEvent.pointerMove(grip('project'), { pointerId: 1, clientX: 400 });
		expect(colWidth('project')).toBe('160px');
		await fireEvent.pointerUp(grip('project'), { pointerId: 1, clientX: 400 });

		resize(frame(), 2000);
		await vi.advanceTimersByTimeAsync(0);
		await fireEvent.pointerDown(grip('key'), { button: 0, pointerId: 2, clientX: 0 });
		await fireEvent.pointerMove(grip('key'), { pointerId: 2, clientX: 900 });
		// Key: at most 12rem (8rem before KN-1).
		expect(colWidth('key')).toBe('192px');
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
				hidden: ['assignee', 'parent', 'source']
			});
		} finally {
			delete (Range.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect;
		}
	});

	it('shows the tags in one line with "+N" and fits the column to all chips on a double click', async () => {
		await showTable();
		const chipTexts = () =>
			[...table().querySelectorAll('td[data-col="tags"] .tag')].map((chip) => chip.textContent);
		// Without a canvas every chip is estimated (0.6em of 12 px per character plus 14 px): in
		// 104 px of room only "Haus" and "+2" fit.
		expect(chipTexts()).toEqual(['Haus', '+2']);

		await fireEvent.dblClick(grip('tags'));

		// 42.8 + 57.2 + 42.8 px of chips, two gaps of 4 px and 24 px of padding.
		expect(colWidth('tags')).toBe('175px');
		expect(chipTexts()).toEqual(['Haus', 'Garten', 'Bank']);
	});

	it('has grips only for columns with a changeable width, hidden from assistive technology', async () => {
		await showTable();

		const grips = [...table().querySelectorAll<HTMLElement>('[data-column-grip]')];
		expect(grips.map((entry) => entry.dataset.columnGrip)).toEqual([
			'key',
			'priority',
			'status',
			'title',
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

	describe('width of the title (ADR-0030 Nachtrag 3)', () => {
		/** Width the title gets: the frame minus the widths of the other columns of the colgroup. */
		function titleWidth(frameWidth: number): number {
			const others = [...table().querySelectorAll<HTMLElement>('col')]
				.filter((col) => col.dataset.column !== 'title')
				.reduce((total, col) => total + parseFloat(col.style.width), 0);
			return frameWidth - others;
		}

		async function measure(width: number) {
			resize(frame(), width);
			await vi.advanceTimersByTimeAsync(0);
		}

		it('makes the title narrower by dragging; the others take the rest, the device keeps it', async () => {
			await showTable();
			await measure(1224);
			// 872 px for the other columns, the title has the rest.
			expect(titleWidth(1224)).toBe(352);
			expect(grip('title').getAttribute('title')).toBe(
				'Breite ziehen, Doppelklick gibt den Rest der Tabelle'
			);

			await fireEvent.pointerDown(grip('title'), { button: 0, pointerId: 1, clientX: 500 });
			await fireEvent.pointerMove(grip('title'), { pointerId: 1, clientX: 450 });
			expect(titleWidth(1224)).toBe(302);
			expect(parseFloat(colWidth('tags'))).toBeGreaterThan(128);
			expect(colWidth('title')).toBe('');
			expect(stored()).toBeNull();

			await fireEvent.pointerUp(grip('title'), { pointerId: 1, clientX: 450 });

			expect(stored()).toEqual({
				v: 1,
				widths: { title: 302 },
				hidden: ['assignee', 'parent', 'source']
			});
			expect(titleWidth(1224)).toBe(302);
		});

		it('keeps the width after a reload', async () => {
			localStorage.setItem(
				'byl-columns-tickets',
				JSON.stringify({ v: 1, widths: { title: 302 }, hidden: ['parent', 'source'] })
			);
			await showTable();
			await measure(1200);

			expect(titleWidth(1200)).toBe(302);
		});

		it('makes the title wider by dragging: the others shrink down to their minimum, then it stops', async () => {
			await showTable();
			await measure(1224);

			await fireEvent.pointerDown(grip('title'), { button: 0, pointerId: 1, clientX: 500 });
			await fireEvent.pointerMove(grip('title'), { pointerId: 1, clientX: 600 });
			expect(titleWidth(1224)).toBe(452);
			expect(parseFloat(colWidth('tags'))).toBeLessThan(128);

			// Far beyond the room of the others: they stop at their minimum, none gives way.
			await fireEvent.pointerMove(grip('title'), { pointerId: 1, clientX: 2000 });
			expect(titleWidth(1224)).toBe(624);
			expect(colWidth('key')).toBe('64px');
			expect(headerIds()).toContain('created');
			await fireEvent.pointerUp(grip('title'), { pointerId: 1, clientX: 2000 });

			expect((stored() as { widths: Record<string, number> }).widths).toMatchObject({
				title: 624,
				key: 64,
				tags: 64
			});
		});

		it('puts the old width back on Escape during the drag of the title', async () => {
			await showTable();
			await measure(1224);

			await fireEvent.pointerDown(grip('title'), { button: 0, pointerId: 1, clientX: 500 });
			await fireEvent.pointerMove(grip('title'), { pointerId: 1, clientX: 600 });
			const escape = new KeyboardEvent('keydown', {
				key: 'Escape',
				bubbles: true,
				cancelable: true
			});
			document.body.dispatchEvent(escape);
			await vi.advanceTimersByTimeAsync(0);

			expect(escape.defaultPrevented).toBe(true);
			expect(titleWidth(1224)).toBe(352);
			expect(colWidth('tags')).toBe('128px');
			await fireEvent.pointerUp(grip('title'), { pointerId: 1, clientX: 600 });
			expect(stored()).toBeNull();
		});

		it('gives the title the rest again on a double click on its grip', async () => {
			localStorage.setItem(
				'byl-columns-tickets',
				JSON.stringify({ v: 1, widths: { title: 302, tags: 200 }, hidden: ['parent', 'source'] })
			);
			await showTable();
			await measure(1224);

			await fireEvent.dblClick(grip('title'));

			expect(mocks.goto).not.toHaveBeenCalled();
			expect(stored()).toEqual({
				v: 1,
				widths: { tags: 200 },
				hidden: ['assignee', 'parent', 'source']
			});
			expect(titleWidth(1224)).toBe(1224 - 872 - 72);
		});

		it('lets a wide title give way first in a narrow frame, with the usual columns hidden', async () => {
			localStorage.setItem(
				'byl-columns-tickets',
				JSON.stringify({ v: 1, widths: { title: 500 }, hidden: ['parent', 'source'] })
			);
			await showTable();
			await measure(700);

			expect(headerIds()).toEqual([
				'select',
				'key',
				'priority',
				'status',
				'title',
				'due',
				'actions'
			]);
			expect(titleWidth(700)).toBe(700 - (40 + 96 + 64 + 104 + 128 + 88));

			await measure(1500);
			expect(headerIds()).toHaveLength(10);
			expect(titleWidth(1500)).toBe(500);
		});

		it('keeps the title while another column is dragged', async () => {
			localStorage.setItem(
				'byl-columns-tickets',
				JSON.stringify({ v: 1, widths: { title: 302 }, hidden: ['parent', 'source'] })
			);
			await showTable();
			await measure(1200);
			const tags = parseFloat(colWidth('tags'));
			const due = colWidth('due');

			await fireEvent.pointerDown(grip('project'), { button: 0, pointerId: 1, clientX: 100 });
			await fireEvent.pointerUp(grip('project'), { pointerId: 1, clientX: 120 });

			// The title gives the 20 px, the other columns stay where they were.
			expect(titleWidth(1200)).toBe(282);
			expect(colWidth('tags')).toBe(`${tags}px`);
			expect(colWidth('due')).toBe(due);
		});
	});

	it('follows the stored preferences of the device', async () => {
		localStorage.setItem(
			'byl-columns-tickets',
			JSON.stringify({
				v: 1,
				widths: { project: 200 },
				hidden: ['priority', 'parent', 'created']
			})
		);
		await showTable('/?gruppe=status');

		expect(colWidth('project')).toBe('200px');
		// "Quelle" is not in the stored list, so the user switched it on.
		expect(headerIds()).toEqual([
			'select',
			'key',
			'status',
			'title',
			'source',
			'project',
			'tags',
			'due',
			'actions'
		]);
		expect(screen.getByRole('rowheader', { name: /^Offen/ }).getAttribute('colspan')).toBe('9');
		const row = table().querySelector('tr[data-ticket-id]') as HTMLElement;
		expect(row.querySelector('[data-col="source"]')?.textContent).toBe('Manuell');
		// Switched off by the user, not for lack of space: no hint in the caption.
		expect(table().querySelector('caption')?.textContent).not.toMatch(/Weitere Spalten/);
	});

	it('uses the store of the registry of the app layout', async () => {
		const registry = new ColumnPrefsRegistry(window);
		await showTable('/', new Map([[COLUMN_PREFS_CONTEXT, registry]]));

		registry.get('tickets').setWidths({ due: 150 });
		await vi.advanceTimersByTimeAsync(0);

		expect(colWidth('due')).toBe('150px');
	});
});

describe('ticket table: long keys (KN-1, ADR-0030 Nachtrag 7)', () => {
	const LONG = [
		ticket(1, { key: 'TASK-9' }),
		ticket(2, { key: 'ABCDEF-1000000' }),
		ticket(3, { key: 'TASK-10' })
	];

	/** The key cell of the ticket with this index. */
	function keyCell(index: number): HTMLElement {
		const id = `t${String(index).padStart(14, '0')}`;
		return table().querySelector(`tr[data-ticket-id="${id}"] td[data-col="key"]`) as HTMLElement;
	}

	it('fits the default width of "Key" to the longest key of the list, with room for the dot', async () => {
		await showTable('/', undefined, LONG);

		// "ABCDEF-1000000" with the dot "neu": 150 px instead of 6rem; nothing is cut off.
		expect(colWidth('key')).toBe('150px');
		expect(keyCell(2).textContent?.trim()).toBe('ABCDEF-1000000');
		expect(keyCell(2).hasAttribute('title')).toBe(false);
		expect(stored()).toBeNull();
	});

	it('lets a width of the user win and names a key it cuts off; the default comes back', async () => {
		const registry = new ColumnPrefsRegistry(window);
		await showTable('/', new Map([[COLUMN_PREFS_CONTEXT, registry]]), LONG);

		registry.get('tickets').setWidths({ key: 80 });
		await vi.advanceTimersByTimeAsync(0);
		expect(colWidth('key')).toBe('80px');
		expect(keyCell(2).getAttribute('title')).toBe('ABCDEF-1000000');

		// "Standard wiederherstellen": the default from the keys again.
		registry.get('tickets').reset();
		await vi.advanceTimersByTimeAsync(0);
		expect(colWidth('key')).toBe('150px');
		expect(keyCell(2).hasAttribute('title')).toBe(false);
	});

	it('drags the key up to 12rem', async () => {
		await showTable('/', undefined, LONG);
		resize(frame(), 2000);
		await vi.advanceTimersByTimeAsync(0);
		await fireEvent.pointerDown(grip('key'), { button: 0, pointerId: 1, clientX: 0 });
		await fireEvent.pointerMove(grip('key'), { pointerId: 1, clientX: 900 });
		expect(colWidth('key')).toBe('192px');
		await fireEvent.pointerUp(grip('key'), { pointerId: 1, clientX: 900 });
		expect(stored()).toMatchObject({ widths: { key: 192 } });
	});
});

describe('ticket table: sub projects (ADR-0034, UP-5)', () => {
	it('shows the path "Haus › Garten" in the column "Projekt", with the code in the title', async () => {
		const updated = '2026-09-01 10:00:00.000Z';
		const house = { id: 'proj00000000001', name: 'Haus', code: 'HAUS', archived: false, updated };
		const garden = {
			...house,
			id: 'proj00000000011',
			name: 'Garten',
			code: 'GART',
			parentId: house.id
		};
		const inGarden = ticket(1, { key: 'GART-1', projectId: garden.id, project: garden });
		const inHouse = ticket(2, { key: 'HAUS-1', projectId: house.id, project: house });
		const catalog = new CatalogStore(
			{
				listProjects: vi.fn(async () => [house, garden]),
				listTags: vi.fn(async () => []),
				createTag: vi.fn()
			},
			SESSION
		);
		await catalog.load();
		const store = new TicketListStore(fakeData([inGarden, inHouse]), SESSION, {
			projectOf: (entry) => catalog.projectOf(entry)
		});
		store.activate(parseListQuery(new URLSearchParams()));
		render(TicketTable, { props: { store, catalog } });
		await vi.advanceTimersByTimeAsync(0);

		const cell = (key: string) =>
			screen.getByText(key).closest('tr')?.querySelector('[data-col="project"] span[title]');
		expect(cell('GART-1')?.textContent).toBe('Haus › Garten');
		expect(cell('GART-1')?.getAttribute('title')).toBe('Haus › Garten (GART)');
		expect(cell('HAUS-1')?.textContent).toBe('Haus');
		expect(cell('HAUS-1')?.getAttribute('title')).toBe('Haus (HAUS)');
	});
});
