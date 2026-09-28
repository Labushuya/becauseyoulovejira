// Sub-tasks in the ticket table (ADR-0033 section 5): the chip "2/5" at a parent, sub-tasks
// indented below their parent only when both are in the same section, otherwise at their sorted
// place with the path hint, the switch "Unteraufgaben einrücken" and the column "Übergeordnet".
// List store and catalog run for real on fake data layers.

import { cleanup, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DoneTicketPage } from '$lib/data/tickets';
import { parseListQuery } from '$lib/domain/list-query';
import type { TicketSummary } from '$lib/domain/ticket';
import { CatalogStore } from '$lib/stores/catalog.svelte';
import { TicketListStore, type TicketListData } from '$lib/stores/ticket-list.svelte';
import TicketTable from './TicketTable.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: { url: new URL('http://localhost:3000/') }
}));
vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));

const SESSION = { ensureValid: () => true, logout: vi.fn() };

function ticket(id: string, key: string, overrides: Partial<TicketSummary> = {}): TicketSummary {
	return {
		id: id.padEnd(15, '0'),
		key,
		title: `Titel ${key}`,
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
		created: '2026-09-01 10:00:00.000Z',
		updated: '2026-09-01 10:00:00.000Z',
		...overrides
	};
}

const PARENT = ticket('parent', 'HAUS-12', {
	priority: 'low',
	status: 'in_progress',
	title: 'Umzug'
});
const URGENT = ticket('urgent', 'HAUS-13', { priority: 'urgent', parentId: PARENT.id });
const MEDIUM = ticket('medium', 'HAUS-14', { parentId: PARENT.id });
const OTHER = ticket('other', 'TASK-1', { priority: 'high' });
const DONE = ticket('done', 'HAUS-15', { parentId: PARENT.id, status: 'done' });

afterEach(() => {
	localStorage.clear();
});

async function showTable(path = '/') {
	mocks.page.url = new URL(path, 'http://localhost:3000');
	const open = [PARENT, URGENT, MEDIUM, OTHER];
	const data = {
		listOpen: vi.fn(async () => open),
		listSubtasks: vi.fn(async () => [URGENT, MEDIUM, DONE]),
		listDone: vi.fn(async (page: number): Promise<DoneTicketPage> => ({
			items: [],
			page,
			hasMore: false
		})),
		searchOpen: vi.fn(async (): Promise<string[]> => []),
		setDone: vi.fn(async () => PARENT),
		update: vi.fn(async () => PARENT)
	} satisfies TicketListData;
	const store = new TicketListStore(data, SESSION);
	const catalog = new CatalogStore(
		{ listProjects: vi.fn(async () => []), listTags: vi.fn(async () => []), createTag: vi.fn() },
		SESSION
	);
	void catalog.load();
	store.activate(parseListQuery(mocks.page.url.searchParams));
	render(TicketTable, { props: { store, catalog } });
	await vi.waitFor(() => expect(store.openState).toBe('ready'));
	await tick();
	return store;
}

function rows(): HTMLElement[] {
	return [...document.querySelectorAll<HTMLElement>('tbody > tr[data-ticket-id]')];
}

const keys = () => rows().map((row) => row.querySelector('[data-col="key"]')?.textContent?.trim());

function rowOf(key: string): HTMLElement {
	const found = rows().find(
		(row) => row.querySelector('[data-col="key"]')?.textContent?.trim() === key
	);
	if (!found) throw new Error(`no row ${key}`);
	return found;
}

describe('sub-tasks in the ticket table', () => {
	it('indents sub-tasks below their parent and shows the progress at the parent', async () => {
		await showTable();

		// Default order: urgent HAUS-13, high TASK-1, medium HAUS-14, low HAUS-12.
		expect(keys()).toEqual(['TASK-1', 'HAUS-12', 'HAUS-13', 'HAUS-14']);
		for (const key of ['HAUS-13', 'HAUS-14']) {
			const row = rowOf(key);
			expect(row.classList.contains('nested')).toBe(true);
			expect(row.querySelector('th')?.textContent).toContain('Unteraufgabe von HAUS-12:');
			expect(row.querySelector('.path')).toBeNull();
		}
		const chip = rowOf('HAUS-12').querySelector('.progress-chip');
		expect(chip?.getAttribute('title')).toBe('1 von 3 Unteraufgaben erledigt');
		expect(chip?.querySelector('[aria-hidden="true"]')?.textContent).toBe('1/3');
		expect(rowOf('TASK-1').querySelector('.progress-chip')).toBeNull();
		expect(rowOf('TASK-1').classList.contains('nested')).toBe(false);
	});

	it('keeps a sub-task at its place with the path when its parent is filtered out', async () => {
		await showTable('/?prio=urgent');

		expect(keys()).toEqual(['HAUS-13']);
		const path = rowOf('HAUS-13').querySelector('.path');
		expect(path?.textContent).toBe('HAUS-12 ›');
		expect(path?.getAttribute('aria-hidden')).toBe('true');
		expect(path?.getAttribute('title')).toBe('Umzug');
		expect(rowOf('HAUS-13').classList.contains('nested')).toBe(false);
		expect(screen.getByRole('rowheader', { name: /Unteraufgabe von HAUS-12/ })).toBeTruthy();
	});

	it('leaves every row at its sorted place when "Unteraufgaben einrücken" is off', async () => {
		localStorage.setItem(
			'byl-columns-tickets',
			JSON.stringify({ v: 1, widths: {}, hidden: ['parent', 'source'], options: { nest: false } })
		);
		await showTable();

		expect(keys()).toEqual(['HAUS-13', 'TASK-1', 'HAUS-14', 'HAUS-12']);
		expect(rowOf('HAUS-13').querySelector('.path')?.textContent).toBe('HAUS-12 ›');
		expect(rows().some((row) => row.classList.contains('nested'))).toBe(false);
	});

	it('never nests across groups', async () => {
		await showTable('/?gruppe=status');

		const inProgress = document.querySelector('tbody[data-group="in_progress"]');
		const open = document.querySelector('tbody[data-group="open"]');
		expect(inProgress?.querySelectorAll('tr[data-ticket-id]')).toHaveLength(1);
		const openKeys = [...(open?.querySelectorAll('tr[data-ticket-id]') ?? [])].map((row) =>
			row.querySelector('[data-col="key"]')?.textContent?.trim()
		);
		expect(openKeys).toEqual(['HAUS-13', 'TASK-1', 'HAUS-14']);
		expect(rowOf('HAUS-14').querySelector('.path')?.textContent).toBe('HAUS-12 ›');
		// The group counts every ticket on its own.
		expect(open?.querySelector('.group-count')?.textContent).toContain('3');
	});

	it('nests only within the same leaf group of two levels (plan OR-3)', async () => {
		// One level "Nach Wiederholung": all tickets are single, parent and sub-tasks share the group.
		await showTable('/?gruppe=wiederholung');
		expect(rowOf('HAUS-13').classList.contains('nested')).toBe(true);
		expect(keys()).toEqual(['TASK-1', 'HAUS-12', 'HAUS-13', 'HAUS-14']);
		cleanup();

		// A second level by status puts the parent (in progress) into another leaf than its
		// sub-tasks (open): no indent, the path stands instead.
		await showTable('/?gruppe=wiederholung&untergruppe=status');
		const leaf = (group: string) =>
			[
				...(document
					.querySelector(`tbody[data-group="${group}"]`)
					?.querySelectorAll<HTMLElement>('tr[data-ticket-id]') ?? [])
			].map((row) => row.querySelector('[data-col="key"]')?.textContent?.trim());
		expect(leaf('once/in_progress')).toEqual(['HAUS-12']);
		expect(leaf('once/open')).toEqual(['HAUS-13', 'TASK-1', 'HAUS-14']);
		expect(rows().some((row) => row.classList.contains('nested'))).toBe(false);
		expect(rowOf('HAUS-14').querySelector('.path')?.textContent).toBe('HAUS-12 ›');
	});

	it('shows the parent in the column "Übergeordnet" when it is switched on', async () => {
		localStorage.setItem(
			'byl-columns-tickets',
			JSON.stringify({ v: 1, widths: {}, hidden: ['source'], shown: ['parent'] })
		);
		await showTable();

		expect(rowOf('HAUS-13').querySelector('[data-col="parent"]')?.textContent?.trim()).toBe(
			'HAUS-12'
		);
		expect(rowOf('TASK-1').querySelector('[data-col="parent"]')?.textContent?.trim()).toBe('');
		expect(document.querySelector('th[data-col="parent"]')?.textContent).toContain('Übergeordnet');
	});
});
