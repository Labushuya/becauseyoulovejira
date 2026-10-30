// "Aufgaben" in the phone frame (MO-3, ADR-0073 addendum MO-3) in jsdom with the real list store on
// a fake server and a controlled matchMedia: cards instead of the table ("Haken · Titel · Pin ·
// •••" and a muted second line), a tap on a card opens the ticket, the status pill is the menu of the
// status, "Angeheftet", the groups and the indented sub-tasks stay; the row of the view holds the
// search, "Filter (n)" and the menu of the list; the filter sheet holds the filters, "Gruppieren"
// and the sort, its choices are navigations with a history entry; "Auswählen" with "Alle", "Bereich"
// and "Fertig" is the selection of the bulk actions by tap. The counter-checks: on a PC with the
// switch on and on a phone with the switch off the table stays as before. The layout itself (44 px,
// three lines of title, no sideways scrolling) is checked statically here and in a browser by
// tests/mobile/phone-frame.spec.mjs.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseListQuery } from '$lib/domain/list-query';
import { PHONE_QUERY } from '$lib/domain/phone-layout';
import type { Project } from '$lib/domain/project';
import type { Tag } from '$lib/domain/tag';
import type { TicketPatch, TicketSummary } from '$lib/domain/ticket';
import { getMobileLayoutStore } from '$lib/mobile-layout.svelte';
import type { TicketPin } from '$lib/domain/pins';
import { BulkEditStore, type BulkEditData } from '$lib/stores/bulk-edit.svelte';
import { CatalogStore } from '$lib/stores/catalog.svelte';
import { FlagStore } from '$lib/stores/flags.svelte';
import { PinStore } from '$lib/stores/pins.svelte';
import { TicketListStore, type TicketListData } from '$lib/stores/ticket-list.svelte';
import { fakePins, pinOf } from '$lib/test/fake-pins';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import TicketTable from './TicketTable.svelte';

useOverlayStubs();

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: { url: new URL('http://localhost:3000/') }
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));

const SESSION = { ensureValid: () => true, logout: vi.fn() };
const UPDATED = '2026-09-01 10:00:00.000Z';
const PROJECT: Project = {
	id: 'proj00000000001',
	name: 'Haus',
	code: 'HAUS',
	archived: false,
	updated: UPDATED
};
const TAGS: Tag[] = [
	{ id: 'tag000000000001', name: 'Garten', updated: UPDATED },
	{ id: 'tag000000000002', name: 'Einkauf', updated: UPDATED }
];

function ticket(n: number, overrides: Partial<TicketSummary> = {}): TicketSummary {
	return {
		id: `t${String(n).padStart(14, '0')}`,
		key: `TASK-${n}`,
		title: `Ticket ${n}`,
		status: 'open',
		priority: 'medium',
		due: null,
		projectId: null,
		tagIds: [],
		project: null,
		tags: [],
		recurring: false,
		parentId: null,
		blocksParent: true,
		source: null,
		completedAt: null,
		created: `2026-09-${String(n).padStart(2, '0')} 10:00:00.000Z`,
		updated: '2026-09-01 10:00:00.000Z',
		...overrides
	};
}

let stop: (() => void) | null = null;
let stopPins: (() => void) | null = null;

/** The window of the test: narrow (a phone) or wide (a PC), with the switch on or off. */
function useWindow(narrow: boolean, enabled: boolean): void {
	vi.stubGlobal('matchMedia', (media: string) => ({
		matches: media === PHONE_QUERY ? narrow : false,
		media,
		addEventListener: () => undefined,
		removeEventListener: () => undefined
	}));
	stop = getMobileLayoutStore().connect();
	getMobileLayoutStore().choose(enabled);
}

const search = createRawSnippet(() => ({
	render: () => '<div class="test-search"><input type="search" aria-label="Suche" /></div>'
}));
const filters = createRawSnippet(() => ({
	render: () => '<div class="test-filters"><button type="button">Projekt: Alle</button></div>'
}));

/** Read marks with everything created after 2026-09-20 still new (E4 plan, package 4). */
function fakeReads() {
	return {
		unreadSince: () => '2026-09-20 00:00:00.000Z',
		list: vi.fn(async () => []),
		markRead: vi.fn(async (id: string) => ({ id: 'read00000000001', ticket: id })),
		markAllRead: vi.fn(async () => '2026-09-26 00:00:00.000Z')
	};
}

async function showTable(
	open: TicketSummary[],
	{
		path = '/',
		withSnippets = true,
		reads,
		pinned
	}: {
		path?: string;
		withSnippets?: boolean;
		reads?: ReturnType<typeof fakeReads>;
		/** Pins of the account (ADR-0064); without them the cards have no pin toggle. */
		pinned?: TicketPin[];
	} = {}
) {
	mocks.page.url = new URL(path, 'http://localhost:3000');
	const data: TicketListData = {
		listOpen: vi.fn(async () => open),
		listSubtasks: vi.fn(async () => open.filter((entry) => entry.parentId)),
		searchOpen: vi.fn(async (): Promise<string[]> => []),
		setDone: vi.fn(async (id: string, done: boolean) => ({
			...(open.find((entry) => entry.id === id) as TicketSummary),
			status: done ? ('done' as const) : ('open' as const)
		})),
		update: vi.fn(
			async (id: string, patch: TicketPatch): Promise<TicketSummary> =>
				({
					...(open.find((entry) => entry.id === id) as TicketSummary),
					...patch,
					updated: '2026-09-02 10:00:00.000Z'
				}) as TicketSummary
		)
	};
	const flags = new FlagStore();
	const pins = pinned === undefined ? null : new PinStore(fakePins(pinned).data, SESSION, flags);
	stopPins = pins?.start() ?? null;
	const store = new TicketListStore(data, SESSION, { reads, flags, pins: pins ?? undefined });
	const catalog = new CatalogStore(
		{
			listProjects: vi.fn(async () => [PROJECT]),
			listTags: vi.fn(async () => TAGS),
			createTag: vi.fn()
		},
		SESSION
	);
	void catalog.load();
	store.activate(parseListQuery(mocks.page.url.searchParams));
	const bulkData: BulkEditData = {
		update: vi.fn(),
		delete: vi.fn(async () => null),
		restore: vi.fn(async () => undefined),
		sourceDates: vi.fn(async () => new Map()),
		sourceCount: vi.fn(async () => 0)
	};
	const bulk = new BulkEditStore(bulkData, SESSION, store);
	const tools = createRawSnippet(() => ({
		render: () => '<div class="test-tools">Filterleiste des PC</div>'
	}));
	const view = render(TicketTable, {
		props: {
			store,
			catalog,
			bulk,
			tools,
			pins,
			...(withSnippets ? { search, filters } : {})
		}
	});
	await vi.advanceTimersByTimeAsync(0);
	await tick();
	return { store, data, view };
}

/** The card of a ticket by its key (the key may follow the hidden "neu,"). */
const card = (key: string) =>
	[...document.querySelectorAll<HTMLElement>('li[data-ticket-id]')].find((entry) =>
		entry.querySelector('.key')?.textContent?.endsWith(key)
	) as HTMLElement;
/** The visible parts of a card, by their classes. */
const partsOf = (key: string) =>
	[...card(key).children]
		.map((child) => child.classList[0])
		.filter((name) => name !== 'color-slot');

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
	vi.setSystemTime(Date.UTC(2026, 8, 24, 10));
	mocks.goto.mockClear();
});

afterEach(() => {
	stop?.();
	stop = null;
	stopPins?.();
	stopPins = null;
	getMobileLayoutStore().choose(false);
	vi.unstubAllGlobals();
	vi.useRealTimers();
	localStorage.clear();
	sessionStorage.clear();
	document.body.innerHTML = '';
});

describe('"Aufgaben" as cards in the phone frame (MO-3)', () => {
	it('shows cards instead of the table: check mark, title block, "•••"', async () => {
		useWindow(true, true);
		await showTable([ticket(1, { title: 'Fenster putzen' }), ticket(2)]);

		expect(screen.queryByRole('table')).toBeNull();
		expect(document.querySelectorAll('li[data-ticket-id]')).toHaveLength(2);
		expect(partsOf('TASK-1')).toEqual(['check-target', 'body', 'end']);
		// The target is the label of the check mark; the name stays the one of the box.
		const check = screen.getByRole('checkbox', { name: 'TASK-1 erledigt' });
		expect(check.closest('label')?.classList.contains('check-target')).toBe(true);
		expect(check.closest('label')?.textContent?.trim()).toBe('');
		const title = within(card('TASK-1')).getByRole('link', { name: 'Fenster putzen' });
		expect(title.getAttribute('href')).toBe('/tickets/t00000000000001');
		expect(title.closest('.title')).not.toBeNull();
		// Without the store of the row menu (outside the app layout) there is no "•••", as in the table.
		expect(within(card('TASK-1')).queryByRole('button', { name: /^Weitere Aktionen/ })).toBeNull();
	});

	it('shows key, status, priority, due date, project and the number of tags in the second line, not "Erstellt"', async () => {
		useWindow(true, true);
		await showTable([
			ticket(1, {
				due: '2026-09-24',
				priority: 'urgent',
				projectId: PROJECT.id,
				tagIds: ['tag000000000001', 'tag000000000002'],
				recurring: true
			})
		]);

		const meta = card('TASK-1').querySelector('.meta') as HTMLElement;
		expect(within(meta).getByText('TASK-1')).toBeTruthy();
		expect(
			within(meta).getByRole('button', { name: 'Status von TASK-1: Offen, ändern' })
		).toBeTruthy();
		expect(within(meta).getByText('Priorität: Dringend')).toBeTruthy();
		expect(meta.textContent).toContain('heute');
		await vi.waitFor(() => expect(meta.textContent).toContain('Haus'));
		expect(within(meta).getByText('Tags: Garten, Einkauf')).toBeTruthy();
		expect(within(meta).getByText('2 Tags')).toBeTruthy();
		expect(within(meta).getByText('Wiederkehrend')).toBeTruthy();
		// "Erstellt" (01.09.2026) is in the ticket, one level deeper.
		expect(card('TASK-1').textContent).not.toContain('01.09.2026');
	});

	it('opens the ticket with a tap on the card and completes it with a tap on its target', async () => {
		useWindow(true, true);
		const { data } = await showTable([ticket(1), ticket(2)]);

		await fireEvent.click(card('TASK-2').querySelector('.meta') as HTMLElement);
		expect(mocks.goto).toHaveBeenCalledWith('/tickets/t00000000000002');

		mocks.goto.mockClear();
		await fireEvent.click(card('TASK-1').querySelector('.check-target') as HTMLElement);
		await vi.waitFor(() => expect(data.setDone).toHaveBeenCalledWith('t00000000000001', true));
		expect(mocks.goto).not.toHaveBeenCalled();
	});

	it('changes the status through the menu of the pill, as in the cell', async () => {
		useWindow(true, true);
		const { data } = await showTable([ticket(1)]);

		const pill = within(card('TASK-1')).getByRole('button', {
			name: 'Status von TASK-1: Offen, ändern'
		});
		await fireEvent.pointerEnter(pill.closest('.editable-cell') as HTMLElement);
		await fireEvent.click(pill);
		await tick();
		const menu = document.getElementById(pill.getAttribute('aria-controls') ?? '') as HTMLElement;
		await fireEvent.click(
			within(menu).getByRole('menuitemradio', { name: 'In Arbeit', hidden: true })
		);
		await vi.waitFor(() =>
			expect(data.update).toHaveBeenCalledWith(
				't00000000000001',
				expect.objectContaining({ status: 'in_progress' })
			)
		);
		expect(mocks.goto).not.toHaveBeenCalled();
	});

	it('keeps the groups with their heads and the sub-tasks indented below their parent', async () => {
		useWindow(true, true);
		await showTable(
			[
				ticket(1, { priority: 'high' }),
				ticket(2, { priority: 'low' }),
				ticket(3, { priority: 'high', parentId: 't00000000000001', title: 'Teil von 1' })
			],
			{ path: '/?gruppe=prio' }
		);

		const heads = screen.getAllByRole('button', { name: /^(Hoch|Niedrig)/ });
		expect(heads.map((head) => head.closest('h3') !== null)).toEqual([true, true]);
		expect(heads[0]?.getAttribute('aria-expanded')).toBe('true');
		expect(card('TASK-3').classList.contains('nested')).toBe(true);
		const high = heads[0]?.closest('section') as HTMLElement;
		expect(
			[...high.querySelectorAll('li[data-ticket-id] .key')].map((key) => key.textContent)
		).toEqual(['TASK-1', 'TASK-3']);

		await fireEvent.click(heads[0] as HTMLElement);
		expect(heads[0]?.getAttribute('aria-expanded')).toBe('false');
		expect(screen.queryByText('TASK-1')).toBeNull();
		expect(screen.getByText('TASK-2')).toBeTruthy();
	});

	it('keeps "Angeheftet" first, with the pin toggle on every card, folding like a group', async () => {
		useWindow(true, true);
		await showTable([ticket(1), ticket(2)], { pinned: [pinOf('t00000000000001', 10)] });

		const head = screen.getByRole('button', { name: /^Angeheftet/ });
		expect(head.getAttribute('aria-expanded')).toBe('true');
		const pinnedList = head.closest('section')?.querySelector('ol[data-section="pinned"]');
		expect(
			[...(pinnedList?.querySelectorAll('li .key') ?? [])].map((key) => key.textContent)
		).toEqual(['TASK-1']);
		expect(document.querySelector('ol[data-section="open"]')?.textContent).not.toContain('TASK-1');
		for (const key of ['TASK-1', 'TASK-2']) {
			const toggle = within(card(key)).getByRole('button', { name: `${key} anheften` });
			expect(card(key).querySelector('.end')?.contains(toggle)).toBe(true);
		}
		expect(
			within(card('TASK-1'))
				.getByRole('button', { name: 'TASK-1 anheften' })
				.getAttribute('aria-pressed')
		).toBe('true');

		await fireEvent.click(head);
		expect(head.getAttribute('aria-expanded')).toBe('false');
		expect(card('TASK-1')).toBeUndefined();
	});

	it('shows the row of the view: the search, "Filter" with the number of filters and the menu of the list', async () => {
		useWindow(true, true);
		const { view } = await showTable([ticket(1)], { path: '/?karte=dringend&prio=high&q=Fenster' });

		const row = view.container.querySelector('.phone-tools') as HTMLElement;
		expect(row.querySelector('.test-search')).not.toBeNull();
		const button = within(row).getByRole('button', { name: 'Filter, 2 aktiv' });
		expect(button.getAttribute('aria-haspopup')).toBe('dialog');
		expect(within(row).getByRole('button', { name: 'Weitere Aktionen der Liste' })).toBeTruthy();
		// The filters of the PC, "Gruppieren" and "Spalten" are not in the list: they are in the sheet.
		expect(view.container.querySelector('.test-tools')).toBeNull();
		expect(screen.queryByRole('button', { name: /^(Gruppieren|Gruppiert)/ })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Spalten' })).toBeNull();
		expect(
			screen
				.getByRole('heading', { level: 2, name: 'Aufgaben' })
				.classList.contains('visually-hidden')
		).toBe(true);
	});

	it('offers "Auswählen", "Alle als gelesen markieren" and "Erledigte ansehen" in the menu of the list', async () => {
		useWindow(true, true);
		const reads = fakeReads();
		await showTable(
			[
				ticket(25, { created: '2026-09-25 10:00:00.000Z', projectId: PROJECT.id }),
				ticket(1, { projectId: PROJECT.id })
			],
			{ path: '/?projekt=proj00000000001', reads }
		);
		expect(card('TASK-25').querySelector('.new-dot')).not.toBeNull();
		expect(card('TASK-1').querySelector('.new-dot')).toBeNull();

		const trigger = screen.getByRole('button', { name: 'Weitere Aktionen der Liste' });
		const menu = document.getElementById(
			trigger.getAttribute('aria-controls') ?? ''
		) as HTMLElement;
		const entries = within(menu)
			.getAllByRole('menuitem', { hidden: true })
			.map((entry) => entry.textContent?.trim());
		// The sheet of the frame ends with "Schließen" (MO-1b).
		expect(entries).toEqual([
			'Auswählen',
			'Alle als gelesen markieren',
			'Erledigte ansehen',
			'Schließen'
		]);
		expect(
			within(menu)
				.getByRole('menuitem', { name: 'Erledigte ansehen', hidden: true })
				.getAttribute('href')
		).toBe('/erledigt?projekt=proj00000000001');
		await fireEvent.click(
			within(menu).getByRole('menuitem', { name: 'Alle als gelesen markieren', hidden: true })
		);
		await vi.advanceTimersByTimeAsync(0);
		expect(reads.markAllRead).toHaveBeenCalledOnce();
	});

	it('opens the filter sheet with the filters, "Gruppieren" and the sort; a choice navigates and the sheet stays', async () => {
		useWindow(true, true);
		await showTable([ticket(1), ticket(2)]);

		const button = screen.getByRole('button', { name: 'Filter' });
		button.focus();
		await fireEvent.click(button);
		await tick();
		const sheet = screen.getByRole('dialog', { name: 'Filter' });
		expect(sheet.querySelector('.test-filters')).not.toBeNull();
		expect(within(sheet).getByRole('group', { name: 'Gruppieren' })).toBeTruthy();
		const sortGroup = within(sheet).getByRole('group', { name: 'Sortieren nach' });
		expect(within(sortGroup).getByRole('radio', { name: 'Standard' })).toHaveProperty(
			'checked',
			true
		);
		expect(within(sheet).queryByRole('group', { name: 'Reihenfolge' })).toBeNull();
		expect(
			within(sheet).getByRole('button', { name: 'Zurücksetzen' }).getAttribute('aria-disabled')
		).toBe('true');
		// The switch of "Spalten" that applies to cards too stands here (no columns on the phone).
		const nest = within(within(sheet).getByRole('group', { name: 'Darstellung' })).getByRole(
			'checkbox',
			{ name: 'Unteraufgaben einrücken' }
		);
		expect(nest).toHaveProperty('checked', true);
		await fireEvent.click(nest);
		expect(nest).toHaveProperty('checked', false);
		expect(localStorage.getItem('byl-columns-tickets')).toContain('"nest":false');

		await fireEvent.click(within(sortGroup).getByRole('radio', { name: 'Priorität' }));
		expect(mocks.goto).toHaveBeenCalledWith('/?sort=prio', { keepFocus: true, noScroll: true });
		expect(screen.getByRole('dialog', { name: 'Filter' })).toBeTruthy();

		await fireEvent.click(within(sheet).getByRole('button', { name: '2 Tickets anzeigen' }));
		await tick();
		expect(screen.queryByRole('dialog', { name: 'Filter' })).toBeNull();
		expect(document.activeElement).toBe(button);
	});

	it('offers the direction of a chosen sort in words and resets the filters from the sheet', async () => {
		useWindow(true, true);
		await showTable([ticket(1)], { path: '/?prio=high&sort=prio' });

		await fireEvent.click(screen.getByRole('button', { name: 'Filter, 1 aktiv' }));
		await tick();
		const sheet = screen.getByRole('dialog', { name: 'Filter' });
		const order = within(sheet).getByRole('group', { name: 'Reihenfolge' });
		expect(
			within(order)
				.getAllByRole('radio')
				.map((radio) => radio.closest('label')?.textContent?.trim())
		).toEqual(['Dringend zuerst', 'Niedrig zuerst']);
		await fireEvent.click(within(order).getByRole('radio', { name: 'Niedrig zuerst' }));
		expect(mocks.goto).toHaveBeenLastCalledWith('/?prio=high&sort=-prio', {
			keepFocus: true,
			noScroll: true
		});

		await fireEvent.click(within(sheet).getByRole('button', { name: 'Zurücksetzen' }));
		expect(mocks.goto).toHaveBeenLastCalledWith('/?sort=prio', { keepFocus: true, noScroll: true });
	});

	it('chooses with "Auswählen": boxes instead of check marks, a tap chooses, "Alle", "Bereich" and "Fertig"', async () => {
		useWindow(true, true);
		await showTable([ticket(1), ticket(2), ticket(3), ticket(4)]);
		expect(screen.queryByRole('checkbox', { name: 'TASK-1 auswählen' })).toBeNull();

		const trigger = screen.getByRole('button', { name: 'Weitere Aktionen der Liste' });
		const menu = document.getElementById(
			trigger.getAttribute('aria-controls') ?? ''
		) as HTMLElement;
		await fireEvent.click(within(menu).getByRole('menuitem', { name: 'Auswählen', hidden: true }));
		await tick();

		const box = (key: string) =>
			screen.getByRole<HTMLInputElement>('checkbox', { name: `${key} auswählen` });
		expect(screen.queryByRole('checkbox', { name: 'TASK-1 erledigt' })).toBeNull();
		const bar = screen.getByRole('group', { name: 'Auswahl' });
		const range = within(bar).getByRole('button', { name: 'Bereich' });
		expect(range.getAttribute('aria-disabled')).toBe('true');
		// MO-7b: the bar of the selection stands after the cards at the bottom, from the start of
		// "Auswählen", its actions locked while nothing is chosen; "Fertig" moved into it.
		expect(within(bar).queryByRole('button', { name: 'Fertig' })).toBeNull();
		const empty = screen.getByRole('region', { name: '0 Tickets ausgewählt' });
		expect(
			within(empty).getByRole('button', { name: 'Aktionen' }).getAttribute('aria-disabled')
		).toBe('true');
		const list = document.querySelector('.card-list') as HTMLElement;
		expect(list.compareDocumentPosition(empty) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

		// Default order: newest first, so the cards are 4, 3, 2, 1. A tap on the card chooses it.
		await fireEvent.click(card('TASK-4').querySelector('.meta') as HTMLElement);
		expect(box('TASK-4').checked).toBe(true);
		expect(mocks.goto).not.toHaveBeenCalled();
		const chosen = screen.getByRole('region', { name: /1 Ticket ausgewählt/ });
		await fireEvent.click(within(chosen).getByRole('button', { name: 'Aktionen' }));
		await tick();
		expect(
			within(within(chosen).getByRole('group', { name: 'Sammelaktionen' })).getByRole('button', {
				name: 'Erledigen'
			})
		).toBeTruthy();

		// "Bereich", then the last one: every card in between, and "Bereich" is off again.
		await fireEvent.click(range);
		expect(range.getAttribute('aria-pressed')).toBe('true');
		expect(within(bar).getByText('Jetzt das letzte Ticket des Bereichs antippen.')).toBeTruthy();
		await fireEvent.click(box('TASK-2'));
		expect(['TASK-4', 'TASK-3', 'TASK-2', 'TASK-1'].map((key) => box(key).checked)).toEqual([
			true,
			true,
			true,
			false
		]);
		expect(range.getAttribute('aria-pressed')).toBe('false');

		const all = within(bar).getByRole<HTMLInputElement>('checkbox', {
			name: 'Alle angezeigten Tickets auswählen'
		});
		expect(all.indeterminate).toBe(true);
		await fireEvent.click(all);
		expect(['TASK-4', 'TASK-3', 'TASK-2', 'TASK-1'].every((key) => box(key).checked)).toBe(true);

		await fireEvent.click(
			within(screen.getByRole('region', { name: /ausgewählt$/ })).getByRole('button', {
				name: 'Fertig'
			})
		);
		expect(screen.queryByRole('group', { name: 'Auswahl' })).toBeNull();
		expect(screen.getByRole('checkbox', { name: 'TASK-1 erledigt' })).toBeTruthy();
		expect(screen.queryByRole('region', { name: /ausgewählt/ })).toBeNull();
	});

	// MO-7b round 2 (P-1, P-4): after an action the actions are closed; "Fertig" leaves "Auswählen"
	// and the result stays alone with "Ergebnis schließen", like the bar of the PC after ×.
	it('closes the actions after an action; "Fertig" leaves "Auswählen" and the result stands alone, as on the PC', async () => {
		useWindow(true, true);
		await showTable([ticket(1), ticket(2)]);
		const trigger = screen.getByRole('button', { name: 'Weitere Aktionen der Liste' });
		const menu = document.getElementById(
			trigger.getAttribute('aria-controls') ?? ''
		) as HTMLElement;
		await fireEvent.click(within(menu).getByRole('menuitem', { name: 'Auswählen', hidden: true }));
		await tick();
		await fireEvent.click(card('TASK-2').querySelector('.meta') as HTMLElement);
		const bar = () => screen.getByRole('region', { name: /ausgewählt$/ });
		await fireEvent.click(within(bar()).getByRole('button', { name: 'Aktionen' }));
		await tick();
		// "Verschieben um" skips a ticket without a due date: a result without a failure.
		await fireEvent.click(within(bar()).getByRole('button', { name: 'Fälligkeit …' }));
		await fireEvent.click(screen.getByRole('radio', { name: 'Verschieben um' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
		await vi.advanceTimersByTimeAsync(0);
		await vi.waitFor(() => expect(within(bar()).getByText(/1 Ticket übersprungen/)).toBeTruthy());
		expect(within(bar()).getByText('1 Ticket ausgewählt')).toBeTruthy();
		expect(within(bar()).queryByRole('group', { name: 'Sammelaktionen' })).toBeNull();
		expect(
			within(bar()).getByRole('button', { name: 'Aktionen' }).getAttribute('aria-expanded')
		).toBe('false');

		await fireEvent.click(within(bar()).getByRole('button', { name: 'Fertig' }));
		await tick();
		expect(screen.queryByRole('group', { name: 'Auswahl' })).toBeNull();
		expect(screen.getByRole('checkbox', { name: 'TASK-1 erledigt' })).toBeTruthy();
		const left = screen.getByRole('region', { name: '0 Tickets ausgewählt' });
		expect(within(left).getByText(/1 Ticket übersprungen/)).toBeTruthy();
		expect(within(left).queryByRole('button', { name: 'Aktionen' })).toBeNull();
		expect(within(left).queryByRole('button', { name: 'Fertig' })).toBeNull();
		await fireEvent.click(within(left).getByRole('button', { name: 'Ergebnis schließen' }));
		await tick();
		expect(screen.queryByRole('region', { name: /ausgewählt/ })).toBeNull();
	});

	it('renders fewer elements as cards than as rows of the table', async () => {
		const tickets = Array.from({ length: 30 }, (_, index) =>
			ticket(index + 1, { due: '2026-09-30', projectId: PROJECT.id, tagIds: ['tag000000000001'] })
		);
		useWindow(true, true);
		const phone = await showTable(tickets);
		const cards =
			phone.view.container.querySelector('.card-list')?.querySelectorAll('*').length ?? 0;
		phone.view.unmount();
		stop?.();
		getMobileLayoutStore().choose(false);
		vi.unstubAllGlobals();

		const desktop = await showTable(tickets);
		const rows = desktop.view.container.querySelector('table')?.querySelectorAll('*').length ?? 0;
		expect(cards).toBeGreaterThan(0);
		expect(cards).toBeLessThan(rows);
	});
});

describe('"Aufgaben" outside the phone frame stays the table (MO-3)', () => {
	it.each([
		['a PC with the switch on', false, true],
		['a phone with the switch off', true, false]
	])(
		'shows the table, the bar of the PC and no row of the frame on %s',
		async (_name, narrow, enabled) => {
			useWindow(narrow, enabled);
			const { view } = await showTable([ticket(1), ticket(2)]);

			expect(screen.getByRole('table')).toBeTruthy();
			expect(document.querySelectorAll('li[data-ticket-id]')).toHaveLength(0);
			expect(view.container.querySelector('.test-tools')).not.toBeNull();
			expect(view.container.querySelector('.test-search')).toBeNull();
			expect(screen.queryByRole('button', { name: /^Filter/ })).toBeNull();
			expect(screen.getByRole('button', { name: /^Gruppieren/ })).toBeTruthy();
			expect(screen.getByRole('button', { name: 'Spalten' })).toBeTruthy();
			expect(screen.getByRole('checkbox', { name: 'TASK-1 auswählen' })).toBeTruthy();
			expect(
				screen
					.getByRole('heading', { level: 2, name: 'Aufgaben' })
					.classList.contains('visually-hidden')
			).toBe(false);
		}
	);
});

describe('styles of the cards in the phone frame (MO-3)', () => {
	const read = (name: string) => readFileSync(join(import.meta.dirname, name), 'utf8');
	const FRAME = ":global(:root[data-mobile-layout='on'])";

	/** The block below the one breakpoint, from its prelude to its closing brace. */
	function frameBlock(source: string): string {
		const start = source.indexOf('@media (max-width: 39.99rem) {');
		expect(start).toBeGreaterThan(-1);
		let depth = 0;
		for (let index = source.indexOf('{', start); index < source.length; index++) {
			if (source[index] === '{') depth += 1;
			if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
		}
		throw new Error('The block of the phone frame does not end.');
	}

	/** The declarations of `selector` (behind the switch) in the block of the phone frame. */
	function rule(file: string, selector: string): string {
		const block = frameBlock(read(file));
		const head = `${FRAME} ${selector} {`;
		const at = block.indexOf(head);
		expect(at, `${file}: ${selector}`).toBeGreaterThan(-1);
		return block.slice(at + head.length, block.indexOf('}', at));
	}

	it('gives the check mark a target of 44 px, the title the rest of the row in up to three lines', () => {
		expect(rule('TicketCard.svelte', '.card')).toMatch(
			/display: grid;\s*grid-template-columns: auto minmax\(0, 1fr\) auto;/
		);
		const target = rule('TicketCard.svelte', '.check-target');
		expect(target).toMatch(/min-width: var\(--control-height-touch\);/);
		expect(target).toMatch(/min-height: var\(--control-height-touch\);/);
		expect(rule('TicketCard.svelte', '.title')).toMatch(/-webkit-line-clamp: 3;\s*line-clamp: 3;/);
		expect(rule('TicketCard.svelte', '.meta :global(button.cell-edit)')).toMatch(
			/min-height: var\(--control-height-touch\);/
		);
	});

	// MO-7b: the bar of the selection moved from below the top bar to the bottom, above the bottom bar.
	it('gives the heads of the sections and the choices of the sheet 44 px, and the bar of the selection its place above the bottom bar', () => {
		expect(rule('TicketTable.svelte', '.card-head .group-toggle')).toMatch(
			/min-height: var\(--control-height-touch\);/
		);
		expect(rule('FilterBar.svelte', '.choices :global(.toggle)')).toMatch(
			/min-height: var\(--control-height-touch\);/
		);
		expect(rule('SelectionBar.svelte', '.bulk-bar')).toMatch(
			/bottom: calc\(var\(--bottom-bar-height\) \+ var\(--safe-bottom\) \+ 0\.5rem\);/
		);
	});
});
