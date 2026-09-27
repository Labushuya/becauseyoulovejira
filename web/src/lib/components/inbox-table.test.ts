// Component tests for the inbox view (E4 plan, package 3; ADR-0014 sections 3 and 4; ADR-0019
// section 6): table with caption and named checkboxes, chips in the URL, "Umwandeln", "Verwerfen"
// with "Rückgängig" in a flag and the focus on the next row, hints on possible duplicates with "Dem Ticket
// zuordnen", selection for "Gesammelt umwandeln", handled entries, empty and missing inbox.
// The store is real with fake data; page state and navigation are mocked.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { InboxItemSummary } from '$lib/domain/inbox';
import type { InboxQuery } from '$lib/domain/inbox-query';
import type { TicketSummary } from '$lib/domain/ticket';
import { FLAG_DURATION_MS, FlagStore } from '$lib/stores/flags.svelte';
import { InboxStore, type InboxData } from '$lib/stores/inbox.svelte';
import { resize, useResizeObserverStub } from '$lib/test/resize-observer-stub';
import InboxTable from './InboxTable.svelte';
import FlagGroup from './overlay/FlagGroup.svelte';
import source from './InboxTable.svelte?raw';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: { url: new URL('http://localhost:3000/eingang') }
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));

function item(id: string, overrides: Partial<InboxItemSummary> = {}): InboxItemSummary {
	return {
		id,
		channel: 'manual',
		kind: 'todo',
		title: `Eintrag ${id.slice(-1)}`,
		sourceUrl: '',
		sourceRef: '',
		sourceDate: null,
		sourceMeta: {},
		original: '',
		state: 'new',
		ticketId: null,
		handledAt: null,
		created: '2026-09-25 08:00:00.000Z',
		updated: '2026-09-25 08:00:00.000Z',
		...overrides
	};
}

const A = item('item00000000001', { title: 'Milch kaufen', created: '2026-09-25 07:00:00.000Z' });
const B = item('item00000000002', {
	title: 'Rechnung September',
	channel: 'eml',
	kind: 'mail',
	sourceDate: '2026-09-24 23:30:00.000Z',
	created: '2026-09-25 08:00:00.000Z'
});
const C = item('item00000000003', {
	title: 'Artikel',
	channel: 'link',
	kind: 'link',
	created: '2026-09-25 07:30:00.000Z'
});

const OPEN_TICKET = {
	id: 'tick00000000001',
	key: 'HAUS-4',
	title: '  milch KAUFEN ',
	status: 'open'
} as TicketSummary;

function setup(
	options: { items?: InboxItemSummary[]; query?: InboxQuery; tickets?: TicketSummary[] } = {}
) {
	const data = {
		listNew: vi.fn<InboxData['listNew']>(async () => options.items ?? [A, B, C]),
		listHandled: vi.fn<InboxData['listHandled']>(async (state, page) => ({
			items: [
				item('item00000000009', {
					title: 'Alt',
					state,
					handledAt: '2026-09-20 10:00:00.000Z',
					ticketId: state === 'converted' ? 'tick00000000009' : null
				})
			],
			page,
			hasMore: true
		})),
		get: vi.fn<InboxData['get']>(async (id) => ({ ...item(id), body: '' })),
		create: vi.fn<InboxData['create']>(),
		discard: vi.fn<InboxData['discard']>(async (id) => ({
			...(options.items ?? [A, B, C]).find((entry) => entry.id === id)!,
			state: 'discarded',
			handledAt: '2026-09-25 09:00:00.000Z',
			updated: '2026-09-25 09:00:00.000Z'
		})),
		restore: vi.fn<InboxData['restore']>(async (id) =>
			item(id, { updated: '2026-09-25 10:00:00.000Z' })
		),
		assign: vi.fn<InboxData['assign']>(async (id, ticketId) =>
			item(id, { state: 'converted', ticketId, updated: '2026-09-25 10:00:00.000Z' })
		),
		originalUrl: vi.fn<InboxData['originalUrl']>(async () => null),
		importCalendar: vi.fn<InboxData['importCalendar']>(async () => ({
			created: 0,
			duplicates: 0,
			skipped: 0,
			failed: 0,
			itemId: ''
		}))
	} satisfies InboxData;
	const flags = new FlagStore();
	const store = new InboxStore(data, { ensureValid: () => true, logout: vi.fn() }, flags);
	store.activate(options.query ?? { source: null, state: 'new' });
	const onbulk = vi.fn();
	const view = render(InboxTable, {
		props: { store, flags, openTickets: options.tickets ?? [], onbulk }
	});
	// The flags of the app layout (ADR-0025 section 8).
	render(FlagGroup, { props: { store: flags } });
	return { store, data, onbulk, view, flags };
}

/** The flag section bottom left. */
function flagSection() {
	return within(screen.getByRole('region', { name: 'Benachrichtigungen' }));
}

/** Waits until a flag offers "Rückgängig". */
function flagSectionFound() {
	return vi.waitFor(() => flagSection().getByRole('button', { name: 'Rückgängig' }));
}

async function table() {
	return within(await screen.findByRole('table'));
}

beforeEach(() => {
	mocks.goto.mockClear();
	mocks.page.url = new URL('http://localhost:3000/eingang');
});

afterEach(() => {
	vi.useRealTimers();
});

describe('inbox table', () => {
	it('shows the new entries newest first in a named table', async () => {
		setup();
		const rows = within(await table().then((t) => t.getAllByRole('rowgroup')[1]!)).getAllByRole(
			'row'
		);
		expect(rows.map((row) => within(row).getByRole('rowheader').textContent?.trim())).toEqual([
			'Rechnung September',
			'Artikel',
			'Milch kaufen'
		]);
		expect(screen.getByRole('table').querySelector('caption')?.textContent).toBe(
			// The hint on the panel shows only while columns are hidden for lack of space (ADR-0030);
			// without a measured frame nothing gives way (inbox-table-columns.test.ts).
			'Eingang · neu, neueste zuerst'
		);
		// Every header and cell names its column; the widths stand in the colgroup.
		const columns = ['select', 'kind', 'title', 'source', 'source-date', 'arrival', 'actions'];
		const marks = (cells: Element[]) => cells.map((cell) => cell.getAttribute('data-col'));
		expect(marks(screen.getAllByRole('columnheader'))).toEqual(columns);
		expect(marks([...rows[0]!.children])).toEqual(columns);
		const frame = screen.getByRole('table').parentElement as HTMLElement;
		expect(frame.classList.contains('frame')).toBe(true);
		expect(frame.hasAttribute('role')).toBe(false);
		expect(screen.getByRole('heading', { name: 'Eingang' })).toBeTruthy();
		// Same order as in the other views: the section bar with the switch comes first (UI-8).
		const section = screen.getByRole('region', { name: /^Eingang/ });
		expect(section.firstElementChild?.classList.contains('section-bar')).toBe(true);
		expect(
			section.firstElementChild?.contains(screen.getByRole('navigation', { name: 'Ansicht' }))
		).toBe(true);
		expect(screen.getByText('3 Einträge')).toBeTruthy();
		expect(screen.getByRole('checkbox', { name: 'Eintrag „Milch kaufen“ auswählen' })).toBeTruthy();
		const mail = rows[0]!;
		expect(within(mail).getByText('Mail-Datei')).toBeTruthy();
		// 23:30 UTC is the 25th in Berlin.
		expect(
			within(mail).getByText('25.09.2026', { selector: 'time[title="25.09.2026 01:30"]' })
		).toBeTruthy();
		expect(
			within(mail)
				.getByRole('link', { name: 'Umwandeln: „Rechnung September“' })
				.getAttribute('href')
		).toBe('/tickets/neu?aus=item00000000002');
		expect(
			within(mail).getByRole('link', { name: 'Rechnung September' }).getAttribute('href')
		).toBe('/eingang/item00000000002');
	});

	it('writes the chips to the URL; "Zustand" has no "Alle"', async () => {
		setup();
		await table();
		const sourceChips = within(screen.getByRole('group', { name: 'Quelle' }));
		await fireEvent.click(sourceChips.getByRole('radio', { name: 'Mail' }));
		expect(mocks.goto).toHaveBeenLastCalledWith('/eingang?quelle=mail', {
			keepFocus: true,
			noScroll: true
		});
		const stateChips = within(screen.getByRole('group', { name: 'Zustand' }));
		expect(
			stateChips.getAllByRole('radio').map((radio) => radio.closest('label')?.textContent?.trim())
		).toEqual(['Neu', 'Verworfen', 'Umgewandelt']);
		await fireEvent.click(stateChips.getByRole('radio', { name: 'Verworfen' }));
		expect(mocks.goto).toHaveBeenLastCalledWith('/eingang?zustand=verworfen', {
			keepFocus: true,
			noScroll: true
		});
	});

	it('filters by source and offers to reset an empty result', async () => {
		setup({ query: { source: 'chat', state: 'new' } });
		expect(
			await screen.findByRole('heading', { name: 'Keine Einträge für diese Filter' })
		).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
		expect(mocks.goto).toHaveBeenLastCalledWith('/eingang', { keepFocus: true, noScroll: true });
	});

	it('says that the inbox is empty and where entries come from', async () => {
		setup({ items: [] });
		const heading = await screen.findByRole('heading', { name: 'Der Eingang ist leer' });
		const empty = heading.closest('.empty-state') as HTMLElement;
		expect(empty.textContent).toMatch(/Hier landet, was du erfasst oder was deine Kanäle abrufen/);
		// Two links "Erfassen": in the section bar and as the primary action of the empty inbox.
		const links = screen.getAllByRole('link', { name: 'Erfassen' });
		expect(links).toHaveLength(2);
		for (const link of links) expect(link.getAttribute('href')).toBe('/eingang/neu');
		expect(within(empty).getByRole('link', { name: 'Erfassen' }).className).toMatch(
			/button-primary/
		);
		// The second way in: set up a channel (EH-11).
		const channel = within(empty).getByRole('link', { name: 'Kanal einrichten' });
		expect(channel.getAttribute('href')).toBe('/einstellungen/kanaele');
		expect(channel.className).not.toMatch(/button-primary/);
		expect(screen.queryByRole('table')).toBeNull();
	});

	it('offers "Aus Zwischenablage" and shows the hint on Ctrl+V as status, not as error', async () => {
		const { store, flags } = setup({ items: [] });
		const onclipboard = vi.fn();
		const other = render(InboxTable, {
			props: {
				store,
				flags,
				openTickets: [],
				onbulk: vi.fn(),
				onclipboard,
				clipboardHint: 'Bitte in der Eingangsansicht Strg+V drücken.'
			}
		});
		const view = within(other.container);
		const button = view.getByRole('button', { name: 'Aus Zwischenablage' });
		expect(button.getAttribute('aria-keyshortcuts')).toBe('Control+V');
		await fireEvent.click(button);
		expect(onclipboard).toHaveBeenCalledOnce();
		const hint = view.getByText('Bitte in der Eingangsansicht Strg+V drücken.');
		expect(hint.closest('[role="status"]')).not.toBeNull();
		expect(hint.closest('.alert-error')).toBeNull();
		// Without the callback there is no button.
		expect(screen.getAllByRole('button', { name: 'Aus Zwischenablage' })).toHaveLength(1);
	});

	it('explains a missing inbox before the restart, without an error colour', async () => {
		const { data, store } = setup({ items: [] });
		data.listNew.mockRejectedValueOnce(new DataError('not_found', { status: 404 }));
		store.reset();
		await store.load();
		store.activate({ source: null, state: 'new' });
		const note = await screen.findByText(/Der Eingang ist nach dem nächsten Neustart verfügbar/);
		expect(note.closest('.alert-error')).toBeNull();
		// Section message "info" with the role status since EH-11.
		expect(note.closest('[data-tone]')?.getAttribute('data-tone')).toBe('info');
		expect(note.closest('[role="status"]')).not.toBeNull();
	});

	it('shows a failed load as an error message with "Erneut versuchen" (EH-11)', async () => {
		const { data, store } = setup({ items: [] });
		data.listNew.mockRejectedValue(new DataError('network'));
		const reload = vi.spyOn(store, 'reload');
		store.reset();
		await store.load();
		store.activate({ source: null, state: 'new' });
		// activate() loads once more; wait until that failed as well, so the message stays.
		await vi.waitFor(() => expect(data.listNew).toHaveBeenCalledTimes(3));
		await vi.waitFor(() => expect(store.state).toBe('error'));
		await tick();
		const alert = await vi.waitFor(() => {
			const found = screen
				.getAllByRole('alert')
				.find((element) => element.getAttribute('data-tone') === 'error');
			if (!found) throw new Error('no section message');
			return found;
		});
		expect(alert.textContent).toMatch(/^\s*Fehler:/);
		await fireEvent.click(within(alert).getByRole('button', { name: 'Erneut versuchen' }));
		expect(reload).toHaveBeenCalledOnce();
	});

	it.each([
		['discarded', 'Keine verworfenen Einträge'],
		['converted', 'Keine umgewandelten Einträge']
	] as const)('shows the empty state for %s entries without an action', async (state, title) => {
		const { data, store } = setup({ query: { source: null, state } });
		data.listHandled.mockResolvedValue({ items: [], page: 1, hasMore: false });
		store.reset();
		await store.load();
		store.activate({ source: null, state });
		const heading = await screen.findByRole('heading', { name: title });
		const empty = heading.closest('.empty-state') as HTMLElement;
		expect(empty.classList.contains('narrow')).toBe(true);
		expect(within(empty).queryByRole('button')).toBeNull();
		expect(within(empty).queryByRole('link')).toBeNull();
	});

	it('removes a discarded row at once, moves the focus to the next row and offers "Rückgängig" in the flag', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const { data } = setup();
		const view = await table();
		await fireEvent.click(view.getByRole('button', { name: 'Verwerfen: „Artikel“' }));
		await vi.waitFor(() => expect(data.discard).toHaveBeenCalledWith(C.id));
		await vi.waitFor(() =>
			expect(document.activeElement?.textContent?.trim()).toBe('Milch kaufen')
		);
		expect(screen.queryByRole('link', { name: 'Artikel' })).toBeNull();
		expect(view.queryByRole('button', { name: /Rückgängig/ })).toBeNull();
		expect(flagSection().getByRole('listitem').textContent).toContain('„Artikel“ verworfen.');

		await fireEvent.click(flagSection().getByRole('button', { name: 'Rückgängig' }));
		await vi.waitFor(() => expect(data.restore).toHaveBeenCalledWith(C.id));
		await vi.waitFor(() =>
			expect(document.querySelector(`tr[data-item-id="${C.id}"]`)).not.toBeNull()
		);
		// The focus stays where it was; the flag never takes it.
		expect(document.activeElement?.textContent?.trim()).toBe('Milch kaufen');
	});

	it('lets the "Rückgängig" flag leave after 8 s', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		setup();
		const view = await table();
		await fireEvent.click(view.getByRole('button', { name: 'Verwerfen: „Artikel“' }));
		await flagSectionFound();
		await vi.advanceTimersByTimeAsync(FLAG_DURATION_MS);
		await tick();
		expect(flagSection().queryByRole('button', { name: 'Rückgängig' })).toBeNull();
		expect(screen.queryByRole('link', { name: 'Artikel' })).toBeNull();
	});

	it('marks a possible duplicate and assigns the entry to the ticket', async () => {
		const { data } = setup({ tickets: [OPEN_TICKET] });
		const view = await table();
		const row = view.getByRole('link', { name: 'Milch kaufen' }).closest('tr')!;
		expect(within(row).getByText('Mögliches Duplikat:')).toBeTruthy();
		expect(within(row).getByRole('link', { name: 'HAUS-4' }).getAttribute('href')).toBe(
			'/tickets/tick00000000001'
		);
		await fireEvent.click(within(row).getByRole('button', { name: 'Dem Ticket HAUS-4 zuordnen' }));
		await vi.waitFor(() => expect(data.assign).toHaveBeenCalledWith(A.id, 'tick00000000001'));
		await vi.waitFor(() => expect(screen.queryByRole('link', { name: 'Milch kaufen' })).toBeNull());
	});

	it('shows the reason of a failed action as an error flag with an icon (UI-5)', async () => {
		const { data } = setup();
		data.discard.mockRejectedValueOnce(new DataError('network'));
		const view = await table();
		await fireEvent.click(view.getByRole('button', { name: 'Verwerfen: „Artikel“' }));
		await vi.waitFor(() =>
			expect(flagSection().getByRole('alert').textContent).toMatch(
				/„Artikel“ konnte nicht verworfen werden\./
			)
		);
		const flag = flagSection().getByRole('listitem');
		expect(flag.classList.contains('tone-error')).toBe(true);
		expect(flag.querySelector('svg')).toBeTruthy();
		expect(view.getByRole('link', { name: 'Artikel' })).toBeTruthy();
	});

	it('opens "Gesammelt umwandeln" only with a selection', async () => {
		const { onbulk } = setup();
		await table();
		const bulk = screen.getByRole('button', { name: 'Gesammelt umwandeln' });
		expect(bulk.getAttribute('aria-disabled')).toBe('true');
		expect(screen.getByText('Erst Einträge auswählen.')).toBeTruthy();
		await fireEvent.click(bulk);
		expect(onbulk).not.toHaveBeenCalled();

		await fireEvent.click(
			screen.getByRole('checkbox', { name: 'Eintrag „Milch kaufen“ auswählen' })
		);
		await fireEvent.click(screen.getByRole('checkbox', { name: 'Eintrag „Artikel“ auswählen' }));
		const chosen = screen.getByRole('button', { name: 'Gesammelt umwandeln (2)' });
		expect(chosen.hasAttribute('aria-disabled')).toBe(false);
		await fireEvent.click(chosen);
		expect(onbulk).toHaveBeenCalledOnce();

		await fireEvent.click(
			screen.getByRole('checkbox', { name: 'Alle angezeigten Einträge auswählen' })
		);
		expect(screen.getByRole('button', { name: 'Gesammelt umwandeln (3)' })).toBeTruthy();
		await fireEvent.click(
			screen.getByRole('checkbox', { name: 'Alle angezeigten Einträge auswählen' })
		);
		expect(screen.getByRole('button', { name: 'Gesammelt umwandeln' })).toBeTruthy();
	});

	it('shows discarded entries with "Wiederherstellen" and "Weitere laden"', async () => {
		const { data } = setup({ query: { source: null, state: 'discarded' } });
		const view = await table();
		expect(screen.getByRole('table').querySelector('caption')?.textContent).toBe(
			'Eingang · verworfen, zuletzt verworfene zuerst'
		);
		expect(view.queryByRole('checkbox')).toBeNull();
		expect(screen.queryByRole('button', { name: /Gesammelt umwandeln/ })).toBeNull();
		await fireEvent.click(view.getByRole('button', { name: 'Wiederherstellen: „Alt“' }));
		await vi.waitFor(() => expect(data.restore).toHaveBeenCalledWith('item00000000009'));
		await fireEvent.click(await screen.findByRole('button', { name: 'Weitere laden' }));
		expect(data.listHandled).toHaveBeenLastCalledWith('discarded', 2, expect.anything());
	});

	it('links converted entries to their ticket', async () => {
		setup({ query: { source: null, state: 'converted' } });
		const view = await table();
		expect(view.getByRole('link', { name: 'Ticket ansehen: „Alt“' }).getAttribute('href')).toBe(
			'/tickets/tick00000000009'
		);
	});

	it('uses no error colour outside of real failures', () => {
		const withoutAlerts = source.replace(/class="alert-error[^"]*"/g, '');
		expect(withoutAlerts).not.toMatch(/danger/);
	});
});

describe('columns of the inbox (ADR-0030, package SP-5)', () => {
	useResizeObserverStub();

	afterEach(() => {
		localStorage.clear();
	});

	const marks = () =>
		screen.getAllByRole('columnheader').map((header) => header.getAttribute('data-col'));

	it('lets the arrival date and "Quelle" give way at 600 px; selection, title and actions stay', async () => {
		setup();
		await table();

		resize(screen.getByRole('table').parentElement as HTMLElement, 600);
		await tick();

		expect(marks()).toEqual(['select', 'kind', 'title', 'source-date', 'actions']);
		expect(screen.getByRole('table').querySelectorAll('colgroup > col')).toHaveLength(5);
		expect(screen.getByRole('table').querySelector('caption')?.textContent).toMatch(
			/Weitere Spalten im Panel$/
		);
	});

	it('has no selection column for handled entries', async () => {
		setup({ query: { source: null, state: 'discarded' } });
		await table();

		expect(marks()).toEqual(['kind', 'title', 'source', 'source-date', 'arrival', 'actions']);
	});

	it('resizes a column with its grip and stores it under byl-columns-inbox', async () => {
		setup();
		await table();
		const grip = screen
			.getByRole('table')
			.querySelector('[data-column-grip="kind"]') as HTMLElement;

		await fireEvent.pointerDown(grip, { button: 0, pointerId: 1, clientX: 100 });
		await fireEvent.pointerMove(grip, { pointerId: 1, clientX: 132 });
		await fireEvent.pointerUp(grip, { pointerId: 1, clientX: 132 });

		const col = screen.getByRole('table').querySelector('col[data-column="kind"]') as HTMLElement;
		expect(col.style.width).toBe('128px');
		expect(JSON.parse(localStorage.getItem('byl-columns-inbox') ?? '')).toEqual({
			v: 1,
			widths: { kind: 128 },
			hidden: []
		});
	});

	it('clamps long titles to two lines and offers the menu "Spalten" in the section bar', async () => {
		setup();
		await table();

		const title = screen.getByRole('rowheader', { name: /Milch kaufen/ });
		expect(title.querySelector('.title-clamp a.title-link')).not.toBeNull();
		const bar = document.querySelector('.section-bar') as HTMLElement;
		expect(within(bar).getByRole('button', { name: 'Spalten' })).toBeTruthy();
	});
});
