// "Zuständig" in the ticket table (E7-5, ADR-0068 §2 and §3): in a household the initials of the
// assignee stand at the title while the column is off; the menu "Spalten" offers the column, which
// then shows the initials and changes the assignee in place ("Niemand" or a member). Outside a
// household neither the initials nor the column.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseListQuery } from '$lib/domain/list-query';
import type { TicketPatch, TicketSummary } from '$lib/domain/ticket';
import { fixedAssignees } from '$lib/stores/assignees.svelte';
import { CatalogStore } from '$lib/stores/catalog.svelte';
import { COLUMN_PREFS_CONTEXT, ColumnPrefsRegistry } from '$lib/stores/column-prefs.svelte';
import { TicketListStore, type TicketListData } from '$lib/stores/ticket-list.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import { useResizeObserverStub } from '$lib/test/resize-observer-stub';
import TicketTable from './TicketTable.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: { url: new URL('http://localhost:3000/') }
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));

useOverlayStubs();
useResizeObserverStub();

const SESSION = { ensureValid: () => true, logout: vi.fn() };
const SELF = 'anna00000000001';
const BERT = 'bert00000000002';
const MEMBERS = [
	{ id: SELF, name: 'Anna Beispiel', self: true },
	{ id: BERT, name: 'Bert Beispiel', self: false }
];
const ID = 't00000000000001';

function ticket(overrides: Partial<TicketSummary> = {}): TicketSummary {
	return {
		id: ID,
		key: 'HAUS-12',
		title: 'Müll rausbringen',
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
		scope: 'h:house0000000001',
		assignee: BERT,
		...overrides
	};
}

async function showTable(active: boolean, open: TicketSummary[] = [ticket()]) {
	mocks.page.url = new URL('/', 'http://localhost:3000');
	const update = vi.fn(
		async (id: string, patch: TicketPatch): Promise<TicketSummary> =>
			({ ...(store.find(id) as TicketSummary), ...patch }) as TicketSummary
	);
	const data: TicketListData = {
		listOpen: vi.fn(async () => open),
		searchOpen: vi.fn(async (): Promise<string[]> => []),
		setDone: vi.fn(async () => open[0] as TicketSummary),
		update
	};
	const assignees = fixedAssignees(MEMBERS, SELF, active);
	const store = new TicketListStore(data, SESSION, { assignees: () => assignees.context });
	const catalog = new CatalogStore(
		{ listProjects: vi.fn(async () => []), listTags: vi.fn(async () => []), createTag: vi.fn() },
		SESSION
	);
	void catalog.load();
	store.activate(parseListQuery(mocks.page.url.searchParams));
	render(TicketTable, {
		props: { store, catalog, assignees },
		context: new Map([[COLUMN_PREFS_CONTEXT, new ColumnPrefsRegistry(window)]])
	});
	await vi.advanceTimersByTimeAsync(0);
	return { store, update };
}

function titleCell() {
	return document.querySelector('tr[data-ticket-id] th[data-col="title"]') as HTMLElement;
}

async function openColumns() {
	const button = screen.getByRole('button', { name: 'Spalten' });
	await fireEvent.click(button);
	await vi.advanceTimersByTimeAsync(0);
	return document.getElementById(button.getAttribute('aria-controls') ?? '') as HTMLElement;
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
	vi.setSystemTime(Date.UTC(2026, 8, 24, 10));
	localStorage.clear();
	mocks.goto.mockClear();
});

afterEach(() => {
	vi.useRealTimers();
	localStorage.clear();
	document.body.innerHTML = '';
});

describe('"Zuständig" in the ticket table (ADR-0068)', () => {
	it('shows the initials at the title while the column is off', async () => {
		await showTable(true);
		const badge = titleCell().querySelector('.assignee-badge');
		expect(badge?.getAttribute('title')).toBe('Zuständig: Bert Beispiel');
		expect(within(titleCell()).getByText('Zuständig: Bert Beispiel')).toBeTruthy();
		expect(document.querySelector('th[data-col="assignee"]')).toBeNull();
	});

	it('offers the column in the menu "Spalten"; on, it holds the initials and changes them in place', async () => {
		const { update, store } = await showTable(true);
		const menu = await openColumns();
		const box = within(menu).getByRole<HTMLInputElement>('checkbox', {
			hidden: true,
			name: /^Zuständig/
		});
		expect(box.checked).toBe(false);

		await fireEvent.click(box);
		await tick();

		expect(document.querySelector('th[data-col="assignee"]')?.textContent).toContain('Zuständig');
		expect(titleCell().querySelector('.assignee-badge')).toBeNull();
		const cell = screen.getByRole('button', {
			name: /^Zuständig für HAUS-12: Bert Beispiel, ändern$/
		});
		await fireEvent.pointerEnter(cell);
		await fireEvent.click(cell);
		await vi.advanceTimersByTimeAsync(0);
		await tick();
		const items = screen.getAllByRole('menuitemradio', { hidden: true });
		expect(items.map((item) => item.textContent?.replace('✓', '').trim())).toEqual([
			'Niemand',
			'Anna Beispiel (ich)',
			'Bert Beispiel'
		]);
		expect(items.map((item) => item.getAttribute('aria-checked'))).toEqual([
			'false',
			'false',
			'true'
		]);

		await fireEvent.click(
			screen.getByRole('menuitemradio', { hidden: true, name: /Anna Beispiel/ })
		);
		await vi.advanceTimersByTimeAsync(0);

		expect(update).toHaveBeenCalledExactlyOnceWith(ID, { assignee: SELF });
		expect(store.find(ID)?.assignee).toBe(SELF);
	});

	it('shows neither initials nor the column outside a household', async () => {
		await showTable(false);
		expect(titleCell().querySelector('.assignee-badge')).toBeNull();
		const menu = await openColumns();
		expect(within(menu).queryByRole('checkbox', { hidden: true, name: /^Zuständig/ })).toBeNull();
	});
});
