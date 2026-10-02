// Component tests of moving a due date in the calendar (ADR-0053 §12, plan kalender, K-2): dragging
// an open ticket with the mouse onto another day, the threshold of a click, Escape, the click after a
// drag; the keyboard with "m", the keys of the grid, Enter and Escape; "Fälligkeit verschieben …" in
// the menu with a click on the day; "Rückgängig"; the note for a ticket of a series; a ticket changed
// meanwhile; and what does not move (done tickets, planned dates, the inbox, touch, the agenda).
// Navigation and page state are mocked; the list store runs with a fake that checks
// expected_updated like the hook.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { DescriptionGuard } from '$lib/data/tickets';
import { CALENDAR_LAYERS_STORAGE_KEY, SERIES_MOVE_HINT } from '$lib/domain/calendar';
import type { InboxItemSummary } from '$lib/domain/inbox';
import type { Project } from '$lib/domain/project';
import type { RecurrenceRule } from '$lib/domain/recurrence-rule';
import type { Ticket, TicketPatch, TicketSummary } from '$lib/domain/ticket';
import { CalendarDoneStore } from '$lib/stores/calendar.svelte';
import { CalendarPrefsStore } from '$lib/stores/calendar-prefs.svelte';
import { CatalogStore, type CatalogData } from '$lib/stores/catalog.svelte';
import { FlagStore } from '$lib/stores/flags.svelte';
import type { InboxStore } from '$lib/stores/inbox.svelte';
import type { RecurrenceStore } from '$lib/stores/recurrence.svelte';
import { TicketListStore, type TicketListData } from '$lib/stores/ticket-list.svelte';
import {
	TicketRowActionsStore,
	type TicketRowActionsData
} from '$lib/stores/ticket-row-actions.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import { useResizeObserverStub } from '$lib/test/resize-observer-stub';
import CalendarView from './CalendarView.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: { url: new URL('http://localhost:3000/kalender') }
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));

useOverlayStubs();
useResizeObserverStub();

/** Friday, 2 October 2026, at noon in Berlin. */
const NOW = Date.parse('2026-10-02T10:00:00Z');
const TODAY = '2026-10-02';
const T0 = '2026-09-24 08:00:00.000Z';
const SAVED = '2026-10-02 10:00:00.000Z';
const SESSION = { ensureValid: () => true, logout: vi.fn() };
const HOUSE: Project = {
	id: 'proj00000000001',
	name: 'Haus',
	code: 'HAUS',
	archived: false,
	updated: T0
};

let sequence = 0;

function ticket(due: string, overrides: Partial<TicketSummary> = {}): TicketSummary {
	sequence += 1;
	return {
		id: `t${String(sequence).padStart(14, '0')}`,
		key: `HAUS-${sequence}`,
		title: `Ticket ${sequence}`,
		status: 'open',
		priority: 'medium',
		due,
		projectId: HOUSE.id,
		tagIds: [],
		project: null,
		tags: [],
		recurring: false,
		recurrenceId: null,
		source: null,
		completedAt: null,
		created: T0,
		updated: T0,
		...overrides
	};
}

beforeEach(() => {
	mocks.goto.mockClear();
	document.body.innerHTML = '';
	localStorage.clear();
});

interface Setup {
	open?: TicketSummary[];
	done?: TicketSummary[];
	rules?: RecurrenceRule[];
	inbox?: InboxItemSummary[];
	withMenu?: boolean;
	/** The server holds a newer version of every ticket (changed in another tab). */
	changedElsewhere?: boolean;
}

async function show(path = '/kalender', setup: Setup = {}) {
	mocks.page.url = new URL(path, 'http://localhost:3000');
	const catalog = new CatalogStore(
		{
			listProjects: async () => [HOUSE],
			listTags: async () => [],
			createTag: vi.fn()
		} satisfies CatalogData,
		SESSION
	);
	const open = setup.open ?? [];
	const stored = new Map(
		open.map((item) => [item.id, setup.changedElsewhere ? { ...item, updated: SAVED } : item])
	);
	let stamp = 0;
	const update = vi.fn(
		async (id: string, patch: TicketPatch, options?: DescriptionGuard): Promise<TicketSummary> => {
			const current = stored.get(id);
			if (current === undefined) throw new DataError('not_found');
			if (options?.expectedUpdated !== current.updated) {
				throw new DataError('validation', {
					status: 400,
					fields: {
						description: {
							code: 'validation_description_stale',
							message: 'Die Beschreibung wurde inzwischen geändert.'
						}
					}
				});
			}
			stamp += 1;
			const next = { ...current, ...patch, updated: `2026-10-02 10:00:0${stamp}.000Z` };
			stored.set(id, next as TicketSummary);
			return next as TicketSummary;
		}
	);
	const listData: TicketListData = {
		listOpen: vi.fn(async () => open),
		listDone: async (page) => ({ items: [], page, hasMore: false }),
		searchOpen: vi.fn(async (): Promise<string[]> => []),
		setDone: vi.fn(),
		update
	};
	const flags = new FlagStore();
	const tickets = new TicketListStore(listData, SESSION, { now: () => NOW, flags });
	const done = new CalendarDoneStore(
		{ listDone: vi.fn(async () => ({ items: setup.done ?? [], hasMore: false })) },
		SESSION
	);
	const rowData: TicketRowActionsData = {
		get: vi.fn(async (): Promise<Ticket> => ({ ...open[0]!, description: '', sourceItem: null })),
		sources: vi.fn(async () => []),
		commentCount: vi.fn(async () => 0),
		delete: vi.fn(async () => null)
	};
	await catalog.load();
	tickets.loadOpen();
	render(CalendarView, {
		props: {
			tickets,
			catalog,
			rules: { rules: setup.rules ?? [] } as unknown as RecurrenceStore,
			inbox: { newItems: setup.inbox ?? [] } as unknown as InboxStore,
			done,
			prefs: new CalendarPrefsStore(window),
			rowActions: setup.withMenu
				? new TicketRowActionsStore(rowData, SESSION, tickets, null, new FlagStore())
				: null
		}
	});
	await vi.waitFor(() => expect(tickets.openState).toBe('ready'));
	await tick();
	return { tickets, flags, update };
}

const grid = () => screen.getByRole('grid');
const cell = (name: RegExp) => within(grid()).getByRole('gridcell', { name });
const day = (date: string) => grid().querySelector<HTMLElement>(`[data-date="${date}"]`)!;
const linkIn = (date: string) => within(day(date)).getByRole('link');
const moveStatus = () => document.querySelector('.move-text')?.textContent?.trim() ?? '';
/** The popover of a button; jsdom shows popovers as hidden (as in calendar-view.test.ts). */
const popoverOf = (button: Element) =>
	document.getElementById(button.getAttribute('aria-controls') ?? '') as HTMLElement;
const MOUSE = { pointerId: 1, pointerType: 'mouse', button: 0 };

async function drag(from: HTMLElement, to: HTMLElement, release = true) {
	await fireEvent.pointerDown(from, { ...MOUSE, clientX: 10, clientY: 10 });
	await fireEvent.pointerMove(to, { ...MOUSE, clientX: 120, clientY: 40 });
	if (release) await fireEvent.pointerUp(to, { ...MOUSE, clientX: 120, clientY: 40 });
}

describe('dragging with the mouse', () => {
	it('sets the due date on the day it is dropped on, with expected_updated and "Rückgängig"', async () => {
		const wash = ticket(TODAY, { title: 'Wäsche' });
		const { tickets, flags, update } = await show('/kalender', { open: [wash] });

		await drag(linkIn(TODAY), day('2026-10-07'), false);
		expect(day('2026-10-07').classList.contains('target')).toBe(true);
		expect(linkIn(TODAY).closest('li')?.classList.contains('moving')).toBe(true);
		expect(moveStatus()).toBe(
			`Fälligkeit von ${wash.key} verschieben: Auf einen Tag ziehen und loslassen, Esc bricht ab.`
		);
		await fireEvent.pointerUp(day('2026-10-07'), { ...MOUSE, clientX: 120, clientY: 40 });

		await vi.waitFor(() => expect(within(day('2026-10-07')).queryByRole('link')).not.toBeNull());
		expect(update).toHaveBeenCalledWith(wash.id, { due: '2026-10-07' }, { expectedUpdated: T0 });
		expect(within(day(TODAY)).queryByRole('link')).toBeNull();
		expect(moveStatus()).toBe('');
		expect(flags.flags.map((flag) => [flag.title, flag.action?.label])).toEqual([
			[`Fälligkeit von ${wash.key} auf 07.10.2026 gesetzt.`, 'Rückgängig']
		]);

		flags.act(flags.flags[0]!.id);
		await vi.waitFor(() => expect(tickets.find(wash.id)?.due).toBe(TODAY));
		await tick();
		expect(within(day(TODAY)).getByRole('link')).toBeTruthy();
		expect(flags.flags[0]?.title).toBe(`Fälligkeit von ${wash.key} wieder auf 02.10.2026 gesetzt.`);
	});

	it('keeps a short press a click, cancels with Escape, and opens nothing after a drag', async () => {
		const wash = ticket(TODAY, { title: 'Wäsche' });
		const { update } = await show('/kalender', { open: [wash] });
		const link = linkIn(TODAY);
		// Clicks that reach the page (and would open the ticket); jsdom does not navigate.
		const reached: boolean[] = [];
		const record = (event: Event) => {
			reached.push(event.defaultPrevented);
			event.preventDefault();
		};
		document.addEventListener('click', record);

		await fireEvent.pointerDown(link, { ...MOUSE, clientX: 10, clientY: 10 });
		await fireEvent.pointerMove(link, { ...MOUSE, clientX: 12, clientY: 11 });
		await fireEvent.pointerUp(link, { ...MOUSE, clientX: 12, clientY: 11 });
		expect(moveStatus()).toBe('');
		await fireEvent.click(link);
		expect(reached).toEqual([false]);

		await drag(link, day('2026-10-08'), false);
		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(moveStatus()).toBe('');
		expect(day('2026-10-08').classList.contains('target')).toBe(false);
		await fireEvent.pointerUp(link, { ...MOUSE, clientX: 10, clientY: 10 });
		// The release after the drag lands on the own entry: it does not open the ticket.
		expect(await fireEvent.click(link)).toBe(false);

		await drag(link, link);
		expect(await fireEvent.click(link)).toBe(false);
		expect(reached).toEqual([false]);
		document.removeEventListener('click', record);
		expect(update).not.toHaveBeenCalled();
		expect(within(day(TODAY)).getByRole('link')).toBe(link);
	});

	it('does not drag done tickets, planned dates, entries of the inbox, or with touch', async () => {
		localStorage.setItem(CALENDAR_LAYERS_STORAGE_KEY, 'offen,erledigt,geplant,eingang');
		const open = ticket('2026-10-06', { title: 'Offen' });
		const finished = ticket('2026-10-08', {
			title: 'Erledigt',
			status: 'done',
			completedAt: '2026-10-01 10:00:00.000Z'
		});
		const dentist: InboxItemSummary = {
			id: 'i00000000000001',
			channel: 'ics',
			kind: 'event',
			title: 'Zahnarzt',
			sourceUrl: '',
			sourceRef: '',
			sourceDate: '2026-10-13 07:00:00.000Z',
			sourceMeta: {},
			original: '',
			state: 'new',
			ticketId: null,
			handledAt: null,
			targetProjectId: null,
			created: T0,
			updated: T0
		};
		const weekly: RecurrenceRule = {
			id: 'rule00000000001',
			title: 'Müll rausbringen',
			description: '',
			projectId: HOUSE.id,
			tagIds: [],
			priority: null,
			mode: 'calendar',
			freq: 'weekly',
			interval: 1,
			weekdays: ['MO'],
			monthDay: null,
			anchor: '2026-09-07',
			leadDays: 3,
			nextDue: '2026-10-05',
			lastGeneratedAt: null,
			active: true,
			lastHint: '',
			created: T0,
			updated: T0
		};
		const { update } = await show('/kalender', {
			open: [open],
			done: [finished],
			rules: [weekly],
			inbox: [dentist]
		});
		await vi.waitFor(() => expect(within(day('2026-10-08')).queryByRole('link')).not.toBeNull());

		const fixed = [
			linkIn('2026-10-08'),
			within(day('2026-10-12')).getByRole('link', { name: /^Geplant: / }),
			within(day('2026-10-13')).getByRole('link', { name: /^Termin im Eingang: / })
		];
		for (const link of fixed) {
			expect(link.hasAttribute('data-movable')).toBe(false);
			await drag(link, day('2026-10-20'));
			expect(moveStatus()).toBe('');
			await fireEvent.keyDown(link, { key: 'm' });
			expect(moveStatus()).toBe('');
		}
		const movable = linkIn('2026-10-06');
		expect(movable.hasAttribute('data-movable')).toBe(true);
		expect(movable.getAttribute('draggable')).toBe('false');
		expect(movable.getAttribute('aria-keyshortcuts')).toBe('M');
		await fireEvent.pointerDown(movable, { ...MOUSE, pointerType: 'touch', clientX: 10 });
		await fireEvent.pointerMove(day('2026-10-20'), { ...MOUSE, pointerType: 'touch', clientX: 99 });
		expect(moveStatus()).toBe('');
		expect(update).not.toHaveBeenCalled();
	});
});

describe('moving with the keyboard', () => {
	it('starts with "m", chooses the day with the keys of the grid and sets it with Enter', async () => {
		const wash = ticket(TODAY, { title: 'Wäsche' });
		const { update } = await show('/kalender', { open: [wash] });
		const link = linkIn(TODAY);
		link.focus();

		await fireEvent.keyDown(link, { key: 'm' });
		await tick();
		// The day of the ticket, named by its full date, is the first choice.
		expect(document.activeElement).toBe(cell(/^Freitag, 2\. Oktober 2026, heute, 1 Eintrag$/));
		expect(day(TODAY).classList.contains('target')).toBe(true);
		expect(moveStatus()).toBe(
			`Fälligkeit von ${wash.key} verschieben: Tag mit den Pfeiltasten wählen oder anklicken, Enter setzt die Fälligkeit, Esc bricht ab.`
		);
		await fireEvent.keyDown(day(TODAY), { key: 'ArrowDown' });
		await tick();
		expect(document.activeElement).toBe(day('2026-10-09'));
		expect(day('2026-10-09').classList.contains('target')).toBe(true);
		expect(day(TODAY).classList.contains('target')).toBe(false);
		await fireEvent.keyDown(day('2026-10-09'), { key: 'Enter' });

		await vi.waitFor(() => expect(document.activeElement).toBe(linkIn('2026-10-09')));
		expect(update).toHaveBeenCalledWith(wash.id, { due: '2026-10-09' }, { expectedUpdated: T0 });
		expect(moveStatus()).toBe('');
	});

	it('cancels with Escape or "Abbrechen" and gives the focus back to the entry', async () => {
		const wash = ticket(TODAY, { title: 'Wäsche' });
		const { update } = await show('/kalender', { open: [wash] });
		const link = linkIn(TODAY);
		link.focus();

		await fireEvent.keyDown(link, { key: 'm' });
		await tick();
		await fireEvent.keyDown(day(TODAY), { key: 'ArrowRight' });
		await tick();
		await fireEvent.keyDown(day('2026-10-03'), { key: 'Escape' });
		await vi.waitFor(() => expect(document.activeElement).toBe(link));
		expect(moveStatus()).toBe('');

		await fireEvent.keyDown(link, { key: 'm' });
		await tick();
		await fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
		await vi.waitFor(() => expect(document.activeElement).toBe(link));
		expect(screen.queryByRole('button', { name: 'Abbrechen' })).toBeNull();
		expect(update).not.toHaveBeenCalled();
	});

	it('asks for the period around a day outside it and keeps moving', async () => {
		const wash = ticket(TODAY, { title: 'Wäsche' });
		await show('/kalender', { open: [wash] });
		linkIn(TODAY).focus();

		await fireEvent.keyDown(linkIn(TODAY), { key: 'm' });
		await tick();
		await fireEvent.keyDown(day(TODAY), { key: 'PageDown' });

		const call = mocks.goto.mock.calls.at(-1) as unknown as [string];
		expect(new URL(call[0], 'http://localhost:3000').searchParams.get('datum')).toBe('2026-11-02');
		expect(moveStatus()).toContain(`Fälligkeit von ${wash.key} verschieben`);
	});

	it('offers "Fälligkeit verschieben …" in the menu; a click on a day then sets it', async () => {
		const wash = ticket(TODAY, { title: 'Wäsche' });
		const { update } = await show('/kalender', { open: [wash], withMenu: true });
		const link = linkIn(TODAY);

		await fireEvent.contextMenu(link, { clientX: 40, clientY: 50 });
		const button = within(link.closest('li')!).getByRole('button', {
			hidden: true,
			name: `Weitere Aktionen für ${wash.key}`
		});
		const entries = within(popoverOf(button)).getAllByRole('menuitem', { hidden: true });
		expect(entries.map((entry) => entry.textContent?.trim())).toEqual([
			'Im Seitenpanel öffnen',
			'In Vollansicht öffnen',
			'Fälligkeit verschieben …',
			'Link kopieren',
			'In den Papierkorb …'
		]);
		await fireEvent.click(entries[2]!);
		await vi.waitFor(() => expect(document.activeElement).toBe(day(TODAY)));
		expect(moveStatus()).toContain('oder anklicken');

		// A click (or a tap) on another day chooses that day.
		expect(await fireEvent.click(day('2026-10-14'))).toBe(false);
		await vi.waitFor(() => expect(update).toHaveBeenCalledOnce());
		expect(update).toHaveBeenCalledWith(wash.id, { due: '2026-10-14' }, { expectedUpdated: T0 });
	});
});

describe('series, conflicts and the agenda', () => {
	it('notes for a ticket of a series that the series does not move', async () => {
		const bins = ticket(TODAY, {
			title: 'Tonne',
			recurring: true,
			recurrenceId: 'rule00000000001'
		});
		const { flags } = await show('/kalender', { open: [bins] });
		linkIn(TODAY).focus();

		await fireEvent.keyDown(linkIn(TODAY), { key: 'm' });
		await tick();
		expect(moveStatus()).toContain('Nur dieses Ticket, die Serie verschiebt sich nicht.');
		await fireEvent.keyDown(day(TODAY), { key: 'ArrowRight' });
		await tick();
		await fireEvent.keyDown(day('2026-10-03'), { key: 'Enter' });

		await vi.waitFor(() => expect(flags.flags).toHaveLength(1));
		expect(flags.flags[0]?.title).toBe(`Fälligkeit von ${bins.key} auf 03.10.2026 gesetzt.`);
		expect(flags.flags[0]?.description).toBe(SERIES_MOVE_HINT);
	});

	it('leaves a ticket changed meanwhile on its day and says so', async () => {
		const wash = ticket(TODAY, { title: 'Wäsche' });
		const { flags } = await show('/kalender', { open: [wash], changedElsewhere: true });

		await drag(linkIn(TODAY), day('2026-10-07'));

		await vi.waitFor(() => expect(flags.flags).toHaveLength(1));
		expect(flags.flags[0]?.tone).toBe('error');
		expect(flags.flags[0]?.title).toBe(
			`Fälligkeit von ${wash.key} nicht gesetzt: Das Ticket wurde inzwischen geändert.`
		);
		expect(within(day(TODAY)).getByRole('link')).toBeTruthy();
		expect(within(day('2026-10-07')).queryByRole('link')).toBeNull();
	});

	it('moves nothing in the agenda: no mark, no key, no menu entry', async () => {
		const wash = ticket(TODAY, { title: 'Wäsche' });
		await show('/kalender?ansicht=agenda', { open: [wash], withMenu: true });
		const link = screen.getByRole('link', { name: /Wäsche/ });

		expect(link.hasAttribute('data-movable')).toBe(false);
		await fireEvent.contextMenu(link, { clientX: 40, clientY: 50 });
		const button = within(link.closest('li')!).getByRole('button', {
			hidden: true,
			name: `Weitere Aktionen für ${wash.key}`
		});
		const entries = within(popoverOf(button)).getAllByRole('menuitem', { hidden: true });
		expect(entries.length).toBeGreaterThan(0);
		expect(entries.map((entry) => entry.textContent?.trim())).not.toContain(
			'Fälligkeit verschieben …'
		);
		expect(document.querySelector('.move-text')).toBeNull();
	});
});
