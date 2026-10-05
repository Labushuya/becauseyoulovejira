// Component tests for the menu "Spalten" (ADR-0030 section 4, package SP-3) in the ticket table:
// popover with a named fieldset of checkboxes, switching columns off and on (header, cells and
// colspan), "schmaler" and "breiter" with a live announcement, columns hidden for lack of space,
// the column "Quelle" and "Standard wiederherstellen" with its flag and the focus staying in the
// popover. The shared stubs stand in for the popover API and ResizeObserver of jsdom.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseListQuery } from '$lib/domain/list-query';
import type { TicketSummary } from '$lib/domain/ticket';
import { CatalogStore } from '$lib/stores/catalog.svelte';
import {
	COLUMNS_RESET_FLAG,
	COLUMN_PREFS_CONTEXT,
	ColumnPrefsRegistry
} from '$lib/stores/column-prefs.svelte';
import { TicketListStore, type TicketListData } from '$lib/stores/ticket-list.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import { resize, useResizeObserverStub } from '$lib/test/resize-observer-stub';
import TicketTable from './TicketTable.svelte';
import source from './ColumnsPopover.svelte?raw';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: { url: new URL('http://localhost:3000/?gruppe=status') }
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));

useOverlayStubs();
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

async function showTable() {
	const flags = { show: vi.fn(() => 'flag'), dismiss: vi.fn() };
	const registry = new ColumnPrefsRegistry(window, flags);
	const store = new TicketListStore(
		fakeData([ticket(1), ticket(2, { source: 'mail' })]),
		SESSION,
		{}
	);
	const catalog = new CatalogStore(
		{ listProjects: vi.fn(async () => []), listTags: vi.fn(async () => []), createTag: vi.fn() },
		SESSION
	);
	void catalog.load();
	store.activate(parseListQuery(mocks.page.url.searchParams));
	render(TicketTable, {
		props: { store, catalog },
		context: new Map([[COLUMN_PREFS_CONTEXT, registry]])
	});
	await vi.advanceTimersByTimeAsync(0);
	return { flags, registry };
}

function table() {
	return screen.getByRole('table', { name: /^Tickets/ });
}

function headerIds(): (string | null)[] {
	return within(table())
		.getAllByRole('columnheader')
		.map((header) => header.getAttribute('data-col'));
}

/**
 * Opens the menu. jsdom styles a popover as hidden even when the stub has shown it, so queries
 * inside pass `hidden: true` (as in group-popover.test.ts).
 */
async function openMenu() {
	const button = screen.getByRole('button', { name: 'Spalten' });
	await fireEvent.click(button);
	await vi.advanceTimersByTimeAsync(0);
	const menu = document.getElementById(button.getAttribute('aria-controls') ?? '') as HTMLElement;
	expect(menu.getAttribute('role')).toBe('dialog');
	return menu;
}

function checkbox(menu: HTMLElement, name: string) {
	return within(menu).getByRole<HTMLInputElement>('checkbox', {
		hidden: true,
		name: new RegExp(`^${name}`)
	});
}

function menuButton(menu: HTMLElement, name: string) {
	return within(menu).getByRole('button', { hidden: true, name });
}

function live(menu: HTMLElement) {
	return menu.querySelector('[aria-live="polite"]')?.textContent;
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
	vi.setSystemTime(Date.UTC(2026, 8, 24, 10));
	localStorage.clear();
});

afterEach(() => {
	vi.useRealTimers();
	localStorage.clear();
	document.body.innerHTML = '';
});

describe('menu "Spalten" (ADR-0030)', () => {
	it('is a popover panel named "Sichtbare Spalten" with a checkbox per optional column', async () => {
		await showTable();

		const button = screen.getByRole('button', { name: 'Spalten' });
		expect(button.getAttribute('aria-haspopup')).toBe('dialog');
		expect(button.getAttribute('aria-expanded')).toBe('false');
		const menu = await openMenu();
		expect(button.getAttribute('aria-expanded')).toBe('true');
		expect(menu.getAttribute('popover')).toBe('auto');
		const group = within(menu).getByRole('group', { hidden: true, name: 'Sichtbare Spalten' });
		expect(group.tagName).toBe('FIELDSET');
		expect(menu.getAttribute('aria-labelledby')).toBe(group.querySelector('legend')?.id);
		expect(
			within(menu)
				.getAllByRole('checkbox', { hidden: true })
				.map((entry) => [
					entry.closest('label')?.querySelector('.name')?.textContent,
					(entry as HTMLInputElement).checked
				])
		).toEqual([
			['Prio', true],
			['Status', true],
			['Übergeordnet', false],
			['Quelle', false],
			['Projekt', true],
			['Tags', true],
			['Fällig', true],
			['Erstellt', true],
			['Unteraufgaben einrücken', true]
		]);
		expect(within(menu).getByRole('group', { hidden: true, name: 'Darstellung' })).toBeTruthy();
		expect(menu.textContent).toContain('Auswahl, Key, Titel und das Häkchen sind immer sichtbar.');
		// The focus goes to the first checked checkbox.
		expect(document.activeElement).toBe(checkbox(menu, 'Prio'));
	});

	it('switches a column off and on: header, cells and colspan follow, the device keeps it', async () => {
		await showTable();
		const menu = await openMenu();

		await fireEvent.click(checkbox(menu, 'Erstellt'));

		expect(headerIds()).not.toContain('created');
		expect(table().querySelector('td[data-col="created"]')).toBeNull();
		expect(screen.getByRole('rowheader', { name: /^Offen/ }).getAttribute('colspan')).toBe('9');
		expect(JSON.parse(localStorage.getItem('byl-columns-tickets') ?? '')).toEqual({
			v: 1,
			widths: {},
			hidden: ['assignee', 'parent', 'source', 'created']
		});
		await vi.advanceTimersByTimeAsync(0);
		expect(live(menu)).toBe('Erstellt ausgeblendet.');

		await fireEvent.click(checkbox(menu, 'Erstellt'));
		expect(headerIds()).toContain('created');
		expect(localStorage.getItem('byl-columns-tickets')).toBeNull();
	});

	it('shows the column "Quelle" with the source family of each ticket', async () => {
		await showTable();
		const menu = await openMenu();

		await fireEvent.click(checkbox(menu, 'Quelle'));

		expect(headerIds()).toEqual([
			'select',
			'key',
			'priority',
			'status',
			'title',
			'source',
			'project',
			'tags',
			'due',
			'created',
			'actions'
		]);
		const cells = [...table().querySelectorAll('td[data-col="source"]')].map(
			(cell) => cell.textContent
		);
		expect(cells.sort()).toEqual(['Mail', 'Manuell']);
	});

	it('switches "Unteraufgaben einrücken" and the column "Übergeordnet" (ADR-0033)', async () => {
		await showTable();
		const menu = await openMenu();

		await fireEvent.click(checkbox(menu, 'Übergeordnet'));
		expect(headerIds()).toContain('parent');
		await fireEvent.click(checkbox(menu, 'Unteraufgaben einrücken'));

		expect((checkbox(menu, 'Unteraufgaben einrücken') as HTMLInputElement).checked).toBe(false);
		expect(JSON.parse(localStorage.getItem('byl-columns-tickets') ?? '')).toEqual({
			v: 1,
			widths: {},
			hidden: ['assignee', 'source'],
			shown: ['parent'],
			options: { nest: false }
		});
		await vi.advanceTimersByTimeAsync(0);
		expect(live(menu)).toBe('Unteraufgaben einrücken aus.');
	});

	it('makes a column narrower and wider in steps of 1rem and says the new width', async () => {
		await showTable();
		const menu = await openMenu();
		const wider = menuButton(menu, 'Spalte Projekt breiter');
		const narrower = menuButton(menu, 'Spalte Projekt schmaler');
		expect(wider.getAttribute('title')).toBe('Breiter');
		expect(wider.classList.contains('button-icon')).toBe(true);

		await fireEvent.click(wider);
		await vi.advanceTimersByTimeAsync(0);

		const col = table().querySelector('col[data-column="project"]') as HTMLElement;
		expect(col.style.width).toBe('144px');
		expect(live(menu)).toBe('Projekt: 9 rem');
		expect(menu.textContent).toContain('9 rem');

		await fireEvent.click(narrower);
		await fireEvent.click(narrower);
		await vi.advanceTimersByTimeAsync(0);
		expect(col.style.width).toBe('112px');
		expect(live(menu)).toBe('Projekt: 7 rem');
	});

	it('changes the width of the title from the keyboard, the way of its grip (Nachtrag 3)', async () => {
		await showTable();
		resize(table().parentElement as HTMLElement, 1224);
		await vi.advanceTimersByTimeAsync(0);
		const menu = await openMenu();
		const row = menuButton(menu, 'Spalte Titel breiter').closest('.row') as HTMLElement;
		// Always shown: a row without a checkbox, "auto" until a width is chosen.
		expect(within(row).queryByRole('checkbox', { hidden: true })).toBeNull();
		expect(row.textContent).toContain('Titel');
		expect(row.querySelector('.width')?.textContent).toBe('auto');
		const wider = menuButton(menu, 'Spalte Titel breiter');
		const narrower = menuButton(menu, 'Spalte Titel schmaler');
		for (const button of [wider, narrower]) {
			expect(button.tagName).toBe('BUTTON');
			expect(button.getAttribute('tabindex')).toBeNull();
		}

		wider.focus();
		await fireEvent.click(wider);
		await vi.advanceTimersByTimeAsync(0);

		// 352 px of rest plus 1rem; the other columns gave the 16 px.
		expect(live(menu)).toBe('Titel: 23 rem');
		expect(row.querySelector('.width')?.textContent).toBe('23 rem');
		const widths = JSON.parse(localStorage.getItem('byl-columns-tickets') ?? '').widths;
		expect(widths.title).toBe(368);
		expect(document.activeElement).toBe(wider);

		await fireEvent.click(narrower);
		await fireEvent.click(narrower);
		await vi.advanceTimersByTimeAsync(0);
		expect(live(menu)).toBe('Titel: 21 rem');

		await fireEvent.click(menuButton(menu, 'Standard wiederherstellen'));
		await vi.advanceTimersByTimeAsync(0);
		expect(row.querySelector('.width')?.textContent).toBe('auto');
		expect(localStorage.getItem('byl-columns-tickets')).toBeNull();
	});

	it('stops the title at its minimum of 10rem and marks the button there', async () => {
		localStorage.setItem('byl-columns-tickets', '{"v":1,"widths":{"title":170}}');
		await showTable();
		resize(table().parentElement as HTMLElement, 1200);
		await vi.advanceTimersByTimeAsync(0);
		const menu = await openMenu();
		const narrower = menuButton(menu, 'Spalte Titel schmaler');

		await fireEvent.click(narrower);
		await vi.advanceTimersByTimeAsync(0);
		expect(live(menu)).toBe('Titel: 10 rem');
		expect(narrower.getAttribute('aria-disabled')).toBe('true');
		await fireEvent.click(narrower);
		expect(JSON.parse(localStorage.getItem('byl-columns-tickets') ?? '').widths.title).toBe(160);
	});

	it('stops at the bounds of a column and marks the button there', async () => {
		await showTable();
		const menu = await openMenu();
		const narrower = menuButton(menu, 'Spalte Erstellt schmaler');

		// "Erstellt": 6rem, minimum 5rem.
		await fireEvent.click(narrower);
		expect(narrower.getAttribute('aria-disabled')).toBe('true');
		await fireEvent.click(narrower);
		const col = table().querySelector('col[data-column="created"]') as HTMLElement;
		expect(col.style.width).toBe('80px');
	});

	it('keeps columns hidden for lack of space checked and says why', async () => {
		await showTable();
		resize(table().parentElement as HTMLElement, 840);
		await vi.advanceTimersByTimeAsync(0);
		const menu = await openMenu();

		const created = checkbox(menu, 'Erstellt');
		expect(created.checked).toBe(true);
		const hint = document.getElementById(created.getAttribute('aria-describedby') ?? '');
		expect(hint?.textContent).toBe('wegen Platz ausgeblendet');
		expect(checkbox(menu, 'Projekt').hasAttribute('aria-describedby')).toBe(false);
	});

	it('restores the defaults of this table with an info flag, the focus stays in the menu', async () => {
		localStorage.setItem('byl-columns-inbox', '{"v":1,"widths":{"kind":120},"hidden":[]}');
		const { flags } = await showTable();
		const menu = await openMenu();
		await fireEvent.click(menuButton(menu, 'Spalte Tags breiter'));
		await fireEvent.click(checkbox(menu, 'Prio'));
		const reset = menuButton(menu, 'Standard wiederherstellen');
		reset.focus();

		await fireEvent.click(reset);
		await vi.advanceTimersByTimeAsync(0);

		expect(localStorage.getItem('byl-columns-tickets')).toBeNull();
		expect(localStorage.getItem('byl-columns-inbox')).not.toBeNull();
		expect(headerIds()).toContain('priority');
		expect(flags.show).toHaveBeenCalledExactlyOnceWith({ tone: 'info', title: COLUMNS_RESET_FLAG });
		expect(menu.contains(document.activeElement)).toBe(true);
		expect(reset.getAttribute('aria-disabled')).toBe('true');
	});

	it('neither sorts nor opens a ticket and closes on Escape with the focus on its button', async () => {
		await showTable();
		const menu = await openMenu();
		await fireEvent.click(checkbox(menu, 'Tags'));

		await fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });

		expect(mocks.goto).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Spalten' }));
	});

	it('styles the checkboxes only through base.css and uses the tokens', () => {
		const style = /<style>([\s\S]*?)<\/style>/.exec(source)?.[1] ?? '';
		expect(style).not.toMatch(/input/);
		expect(style).not.toMatch(/font-size:\s*\d/);
	});
});
