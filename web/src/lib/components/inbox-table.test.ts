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
import type { Project } from '$lib/domain/project';
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
	options: {
		items?: InboxItemSummary[];
		query?: InboxQuery;
		tickets?: TicketSummary[];
		onlink?: () => void;
		/** Entries of the paged views instead of the one default entry. */
		handled?: InboxItemSummary[];
		/** Projects of the catalog (target projects, ADR-0049). */
		projects?: Project[];
		/** The connection is missing (OF-3): the bulk actions of EG-1 are locked. */
		offline?: boolean;
	} = {}
) {
	const data = {
		listNew: vi.fn<InboxData['listNew']>(async () => options.items ?? [A, B, C]),
		listHandled: vi.fn<InboxData['listHandled']>(async (state, page) => ({
			items: options.handled ?? [
				item('item00000000009', {
					title: 'Alt',
					state: state === 'all' ? 'converted' : state,
					handledAt: '2026-09-20 10:00:00.000Z',
					ticketId: state === 'discarded' ? null : 'tick00000000009'
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
		})),
		savePage: vi.fn<InboxData['savePage']>(async () => ({
			kind: 'saved',
			title: '',
			size: 0,
			truncated: false
		}))
	} satisfies InboxData;
	const flags = new FlagStore();
	const projects = options.projects ?? [];
	const store = new InboxStore(
		data,
		{ ensureValid: () => true, logout: vi.fn() },
		flags,
		() => projects
	);
	store.activate(options.query ?? { source: null, state: 'new' });
	const onbulk = vi.fn();
	const view = render(InboxTable, {
		props: {
			store,
			flags,
			openTickets: options.tickets ?? [],
			projects,
			onbulk,
			onlink: options.onlink,
			offline: options.offline ?? false
		}
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

/** Target of the last navigation. */
function lastTarget(): string {
	const call = mocks.goto.mock.calls.at(-1) as unknown[] | undefined;
	return String(call?.[0]);
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

	it('writes the chips to the URL; "Zustand" offers "Verknüpft" and "Alle"', async () => {
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
		).toEqual(['Neu', 'Verknüpft', 'Verworfen', 'Alle']);
		expect((stateChips.getByRole('radio', { name: 'Neu' }) as HTMLInputElement).checked).toBe(true);
		await fireEvent.click(stateChips.getByRole('radio', { name: 'Verworfen' }));
		expect(mocks.goto).toHaveBeenLastCalledWith('/eingang?zustand=verworfen', {
			keepFocus: true,
			noScroll: true
		});
		await fireEvent.click(stateChips.getByRole('radio', { name: 'Verknüpft' }));
		expect(mocks.goto).toHaveBeenLastCalledWith('/eingang?zustand=verknuepft', {
			keepFocus: true,
			noScroll: true
		});
		await fireEvent.click(stateChips.getByRole('radio', { name: 'Alle' }));
		expect(mocks.goto).toHaveBeenLastCalledWith('/eingang?zustand=alle', {
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
		['converted', 'Keine verknüpften Einträge'],
		['all', 'Noch keine Einträge']
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

	it('offers "Mit Ticket verknüpfen …" for the selection (ADR-0031)', async () => {
		const onlink = vi.fn();
		setup({ onlink });
		await table();
		const link = screen.getByRole('button', { name: 'Mit Ticket verknüpfen …' });
		expect(link.getAttribute('aria-disabled')).toBe('true');
		expect(link.getAttribute('aria-describedby')).toBe(
			screen.getByText('Erst Einträge auswählen.').id
		);
		await fireEvent.click(link);
		expect(onlink).not.toHaveBeenCalled();

		await fireEvent.click(screen.getByRole('checkbox', { name: 'Eintrag „Artikel“ auswählen' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Mit Ticket verknüpfen … (1)' }));
		expect(onlink).toHaveBeenCalledOnce();
	});

	it('has no "Mit Ticket verknüpfen …" without its handler', async () => {
		setup();
		await table();
		expect(screen.queryByRole('button', { name: /^Mit Ticket verknüpfen/ })).toBeNull();
	});

	it('shows discarded entries with "Wiederherstellen" and "Weitere laden"', async () => {
		const { data } = setup({ query: { source: null, state: 'discarded' } });
		const view = await table();
		expect(screen.getByRole('table').querySelector('caption')?.textContent).toBe(
			'Eingang · verworfen, zuletzt verworfene zuerst'
		);
		// Since EG-1 discarded entries can be chosen for "Wiederherstellen (n)"; nothing else is offered.
		expect(view.getByRole('checkbox', { name: 'Eintrag „Alt“ auswählen' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: /Gesammelt umwandeln/ })).toBeNull();
		await fireEvent.click(view.getByRole('button', { name: 'Wiederherstellen: „Alt“' }));
		await vi.waitFor(() => expect(data.restore).toHaveBeenCalledWith('item00000000009'));
		await fireEvent.click(await screen.findByRole('button', { name: 'Weitere laden' }));
		expect(data.listHandled).toHaveBeenLastCalledWith('discarded', 2, expect.anything());
	});

	it('links converted entries to their ticket', async () => {
		setup({ query: { source: null, state: 'converted' } });
		const view = await table();
		expect(screen.getByRole('table').querySelector('caption')?.textContent).toBe(
			'Eingang · verknüpft, zuletzt verknüpfte zuerst'
		);
		// Without the expanded ticket the row keeps the plain link.
		expect(view.getByRole('link', { name: 'Ticket ansehen: „Alt“' }).getAttribute('href')).toBe(
			'/tickets/tick00000000009'
		);
	});

	it('marks linked entries in the accent colour with the chip "→ HAUS-9" (ADR-0031)', async () => {
		setup({
			query: { source: null, state: 'converted' },
			handled: [
				item('item00000000009', {
					title: 'Alt',
					state: 'converted',
					handledAt: '2026-09-20 10:00:00.000Z',
					ticketId: 'tick00000000009',
					ticket: { id: 'tick00000000009', key: 'HAUS-9', title: 'Steuer', primary: false }
				})
			]
		});
		const view = await table();
		const chip = await view.findByRole('link', { name: 'Ticket HAUS-9 öffnen: „Alt“' });
		expect(chip.getAttribute('href')).toBe('/tickets/tick00000000009');
		// The chip names its ticket for the way back from it (ADR-0054 §7).
		expect(chip.getAttribute('data-ticket-link')).toBe('tick00000000009');
		expect(chip.textContent?.replace(/\s+/g, ' ').trim()).toBe('→ HAUS-9');
		expect(chip.getAttribute('title')).toBe('HAUS-9 · Steuer');
		expect(chip.className).toContain('ticket-chip');
		expect(chip.closest('tr')?.classList.contains('linked')).toBe(true);
		expect(view.queryByRole('link', { name: /^Ticket ansehen/ })).toBeNull();
	});

	it('shows every entry in the view "Alle", newest first, and new ones stay in it', async () => {
		const { data, store: inbox } = setup({ query: { source: null, state: 'all' } });
		const view = await table();
		expect(data.listHandled).toHaveBeenLastCalledWith('all', 1, expect.anything());
		expect(screen.getByRole('table').querySelector('caption')?.textContent).toBe(
			'Eingang · alle, neueste zuerst'
		);
		expect(view.getByRole('columnheader', { name: 'Eingang' })).toBeTruthy();
		// A new entry arriving by realtime joins the view; it has no selection here.
		inbox.upsert(item('item00000000008', { title: 'Frisch', created: '2026-09-26 08:00:00.000Z' }));
		await tick();
		const rows = view.getAllByRole('row').slice(1);
		expect(rows.map((row) => row.getAttribute('data-item-id'))).toEqual([
			'item00000000008',
			'item00000000009'
		]);
		expect(view.queryByRole('checkbox')).toBeNull();
	});

	it('uses no error colour outside of real failures', () => {
		const withoutAlerts = source.replace(/class="alert-error[^"]*"/g, '');
		expect(withoutAlerts).not.toMatch(/danger/);
	});
});

// EG-1 (ADR-0014 addendum EG-1): "Verwerfen (n)" in the view "Neu" and "Wiederherstellen (n)" in the
// view "Verworfen", one entry after the other, with the progress and the result above the table.
describe('several entries at once (EG-1)', () => {
	const SERVER_FAILURE =
		'Der Server hat mit einem Fehler geantwortet. Bitte später erneut versuchen.';

	function deferred<T>() {
		let resolve!: (value: T) => void;
		const promise = new Promise<T>((done) => {
			resolve = done;
		});
		return { promise, resolve };
	}

	const box = (title: string) =>
		screen.getByRole<HTMLInputElement>('checkbox', { name: `Eintrag „${title}“ auswählen` });

	/** The bar of the running action and of its result, above the table. */
	const bar = () => screen.getByRole('region', { name: /ausgewählt$/ });

	it('discards the chosen entries with "Verwerfen (n)" one after the other, names a skipped one and keeps the focus', async () => {
		const { data, store } = setup();
		await table();
		const locked = screen.getByRole('button', { name: 'Verwerfen' });
		expect(locked.getAttribute('aria-disabled')).toBe('true');
		expect(locked.getAttribute('aria-describedby')).toBe(
			screen.getByText('Erst Einträge auswählen.').id
		);
		await fireEvent.click(locked);
		expect(data.discard).not.toHaveBeenCalled();

		await fireEvent.click(
			screen.getByRole('checkbox', { name: 'Alle angezeigten Einträge auswählen' })
		);
		const chosen = screen.getByRole('button', { name: 'Verwerfen (3)' });
		expect(chosen.hasAttribute('aria-disabled')).toBe(false);
		const first = deferred<InboxItemSummary>();
		data.discard.mockReturnValueOnce(first.promise);
		chosen.focus();
		await fireEvent.click(chosen);
		// Newest first: "Rechnung September" goes first; the progress stands above the table.
		expect(data.discard.mock.calls).toEqual([[B.id]]);
		expect(within(bar()).getByText('Verwerfen: 0 von 3 Einträgen')).toBeTruthy();
		expect(bar().getAttribute('aria-busy')).toBe('true');
		expect(chosen.getAttribute('aria-disabled')).toBe('true');
		// Meanwhile another tab links "Artikel" to a ticket: it is no longer new, skipped and named.
		store.upsert({
			...C,
			state: 'converted',
			ticketId: 'tick00000000009',
			handledAt: '2026-09-25 09:30:00.000Z',
			updated: '2026-09-25 09:30:00.000Z'
		});
		first.resolve({ ...B, state: 'discarded', updated: '2026-09-25 09:00:00.000Z' });
		await vi.waitFor(() => expect(data.discard.mock.calls).toEqual([[B.id], [A.id]]));
		await vi.waitFor(() => expect(within(bar()).getByText('1 Eintrag übersprungen:')).toBeTruthy());
		expect(within(bar()).getByRole('listitem').textContent?.trim()).toBe(
			'„Artikel“: Nicht mehr neu.'
		);
		expect(screen.queryByRole('link', { name: 'Milch kaufen' })).toBeNull();
		await vi.waitFor(() =>
			expect(flagSection().getByRole('listitem').textContent).toContain(
				'2 Einträge verworfen, 1 übersprungen.'
			)
		);
		expect(flagSection().getByRole('button', { name: 'Rückgängig' })).toBeTruthy();
		// The focus stays on the button, which waits for the next choice.
		const after = screen.getByRole('button', { name: 'Verwerfen' });
		expect(document.activeElement).toBe(after);
		expect(after.getAttribute('aria-disabled')).toBe('true');

		await fireEvent.click(within(bar()).getByRole('button', { name: 'Ergebnis schließen' }));
		expect(screen.queryByRole('region', { name: /ausgewählt$/ })).toBeNull();
	});

	it('names failures of "Verwerfen (n)" and of its "Rückgängig" in the result; the rest goes on', async () => {
		const { data } = setup();
		await table();
		data.discard.mockImplementation(async (id) => {
			if (id === C.id) throw new DataError('server');
			const entry = [A, B].find((value) => value.id === id)!;
			return { ...entry, state: 'discarded', updated: '2026-09-25 09:00:00.000Z' };
		});
		await fireEvent.click(
			screen.getByRole('checkbox', { name: 'Alle angezeigten Einträge auswählen' })
		);
		await fireEvent.click(screen.getByRole('button', { name: 'Verwerfen (3)' }));
		await vi.waitFor(() => expect(data.discard).toHaveBeenCalledTimes(3));
		const failures = await vi.waitFor(() => within(bar()).getByRole('alert'));
		expect(within(failures).getByText('1 Eintrag wurde nicht verworfen:')).toBeTruthy();
		// The item holds "Details" of the request besides the reason since round 2 (E-7).
		expect(
			within(within(failures).getByRole('listitem')).getByText(`„Artikel“: ${SERVER_FAILURE}`)
		).toBeTruthy();
		// The failed entry stays, still chosen, for another try.
		expect(box('Artikel').checked).toBe(true);
		expect(screen.getByRole('button', { name: 'Verwerfen (1)' })).toBeTruthy();
		await vi.waitFor(() =>
			expect(flagSection().getByRole('listitem').textContent).toContain(
				'2 Einträge verworfen, 1 fehlgeschlagen.'
			)
		);

		data.restore.mockImplementation(async (id) => {
			if (id === A.id) throw new DataError('server');
			return { ...B, updated: '2026-09-25 10:00:00.000Z' };
		});
		await fireEvent.click(flagSection().getByRole('button', { name: 'Rückgängig' }));
		await vi.waitFor(() => expect(data.restore.mock.calls).toEqual([[B.id], [A.id]]));
		const undone = await vi.waitFor(() =>
			within(within(bar()).getByRole('alert')).getByText('1 Eintrag wurde nicht wiederhergestellt:')
		);
		const undoneItem = undone.closest('[role="alert"]')?.querySelector('li') as HTMLElement;
		expect(within(undoneItem).getByText(`„Milch kaufen“: ${SERVER_FAILURE}`)).toBeTruthy();
		await vi.waitFor(() =>
			expect(screen.getByRole('link', { name: 'Rechnung September' })).toBeTruthy()
		);
		await vi.waitFor(() =>
			expect(flagSection().getByRole('listitem').textContent).toContain(
				'1 Eintrag wiederhergestellt, 1 fehlgeschlagen.'
			)
		);
	});

	it('restores the chosen entries with "Wiederherstellen (n)" in the view "Verworfen"', async () => {
		const gone = [
			item('item00000000007', {
				title: 'Alt eins',
				state: 'discarded',
				handledAt: '2026-09-21 10:00:00.000Z'
			}),
			item('item00000000008', {
				title: 'Alt zwei',
				state: 'discarded',
				handledAt: '2026-09-20 10:00:00.000Z'
			})
		];
		const { data } = setup({ query: { source: null, state: 'discarded' }, handled: gone });
		await table();
		expect(screen.queryByRole('button', { name: /^Gesammelt umwandeln/ })).toBeNull();
		expect(screen.queryByRole('button', { name: /^Verwerfen/ })).toBeNull();
		const locked = screen.getByRole('button', { name: 'Wiederherstellen' });
		expect(locked.getAttribute('aria-disabled')).toBe('true');

		await fireEvent.click(box('Alt eins'));
		await fireEvent.click(box('Alt zwei'));
		await fireEvent.click(screen.getByRole('button', { name: 'Wiederherstellen (2)' }));
		await vi.waitFor(() =>
			expect(data.restore.mock.calls).toEqual([['item00000000007'], ['item00000000008']])
		);
		await vi.waitFor(() => expect(screen.queryByRole('link', { name: 'Alt eins' })).toBeNull());
		expect(screen.queryByRole('link', { name: 'Alt zwei' })).toBeNull();
		const flag = await vi.waitFor(() => flagSection().getByRole('listitem'));
		expect(flag.textContent).toContain('2 Einträge wiederhergestellt.');
		expect(within(flag).queryByRole('button', { name: 'Rückgängig' })).toBeNull();
		// Nothing failed or was skipped: no result stands above the table.
		expect(screen.queryByRole('region', { name: /ausgewählt$/ })).toBeNull();
	});

	it('keeps "Verwerfen (n)" without a connection, locked, and names why on a click or Enter', async () => {
		const { data, flags } = setup({ offline: true });
		await table();
		await fireEvent.click(box('Artikel'));
		const button = screen.getByRole('button', { name: 'Verwerfen (1)' });
		expect(button.getAttribute('aria-disabled')).toBe('true');
		// A button, not disabled: Enter reaches it and is a click in the browser.
		expect(button.hasAttribute('disabled')).toBe(false);
		const hint = screen.getByText('Nur mit Verbindung');
		expect(button.getAttribute('aria-describedby')).toBe(hint.id);
		await fireEvent.click(button);
		expect(data.discard).not.toHaveBeenCalled();
		expect(flags.flags.map((flag) => [flag.tone, flag.title])).toEqual([
			['info', '„Verwerfen (1)“ geht nur mit Verbindung.']
		]);
		// The other bulk actions stay as they were (EG-1 locks only its own).
		expect(
			screen.getByRole('button', { name: 'Gesammelt umwandeln (1)' }).hasAttribute('aria-disabled')
		).toBe(false);
	});

	// Round 2 of EG-1 (review E-1, E-3, E-5 and E-7).
	const caption = () => screen.getByRole('table').querySelector('caption')?.textContent;

	it('empties the selection when another view is chosen (E-1)', async () => {
		const { store } = setup();
		await table();
		await fireEvent.click(box('Milch kaufen'));
		expect(screen.getByRole('button', { name: 'Verwerfen (1)' })).toBeTruthy();
		store.activate({ source: null, state: 'discarded' });
		await vi.waitFor(() =>
			expect(caption()).toBe('Eingang · verworfen, zuletzt verworfene zuerst')
		);
		expect(screen.getByRole('button', { name: 'Wiederherstellen' })).toBeTruthy();
		store.activate({ source: null, state: 'new' });
		await vi.waitFor(() => expect(caption()).toBe('Eingang · neu, neueste zuerst'));
		expect(box('Milch kaufen').checked).toBe(false);
		expect(screen.getByRole('button', { name: 'Verwerfen' }).getAttribute('aria-disabled')).toBe(
			'true'
		);
	});

	it('drops a discarded entry from the selection once it leaves the view, by its row action or in another tab (E-1)', async () => {
		const gone = [
			item('item00000000007', {
				title: 'Alt eins',
				state: 'discarded',
				handledAt: '2026-09-21 10:00:00.000Z'
			}),
			item('item00000000008', {
				title: 'Alt zwei',
				state: 'discarded',
				handledAt: '2026-09-20 10:00:00.000Z'
			})
		];
		const { store } = setup({ query: { source: null, state: 'discarded' }, handled: gone });
		await table();
		await fireEvent.click(box('Alt eins'));
		await fireEvent.click(box('Alt zwei'));
		// "Wiederherstellen" of its row brings "Alt eins" back to "Neu"; another tab restores "Alt zwei".
		await fireEvent.click(screen.getByRole('button', { name: 'Wiederherstellen: „Alt eins“' }));
		await vi.waitFor(() =>
			expect(screen.queryByRole('link', { name: /Alt eins|Eintrag 7/ })).toBeNull()
		);
		store.upsert({
			...gone[1]!,
			state: 'new',
			handledAt: null,
			updated: '2026-09-25 11:00:00.000Z'
		});
		await vi.waitFor(() => expect(screen.queryByRole('link', { name: 'Alt zwei' })).toBeNull());
		// Both come back discarded from another tab: neither is chosen any more.
		store.upsert({
			...gone[0]!,
			handledAt: '2026-09-25 12:00:00.000Z',
			updated: '2026-09-25 12:00:00.000Z'
		});
		store.upsert({
			...gone[1]!,
			handledAt: '2026-09-25 12:30:00.000Z',
			updated: '2026-09-25 12:30:00.000Z'
		});
		await vi.waitFor(() => expect(screen.getByRole('link', { name: 'Alt zwei' })).toBeTruthy());
		expect(box('Alt eins').checked).toBe(false);
		expect(box('Alt zwei').checked).toBe(false);
		expect(
			screen.getByRole('button', { name: 'Wiederherstellen' }).getAttribute('aria-disabled')
		).toBe('true');
	});

	it('drops a new entry from the selection once it is converted or discarded elsewhere (E-1)', async () => {
		const { store } = setup();
		await table();
		await fireEvent.click(box('Milch kaufen'));
		await fireEvent.click(box('Artikel'));
		await fireEvent.click(box('Rechnung September'));
		// "Umwandeln" in the panel converts "Milch kaufen"; another tab discards "Artikel".
		store.markConverted(A.id, 'tick00000000009', '2026-09-25 10:00:00.000Z');
		store.upsert({
			...C,
			state: 'discarded',
			handledAt: '2026-09-25 10:00:00.000Z',
			updated: '2026-09-25 10:00:00.000Z'
		});
		await vi.waitFor(() => expect(screen.queryByRole('link', { name: 'Artikel' })).toBeNull());
		// Both come back new (released, restored in another tab): neither is chosen any more.
		store.upsert({ ...A, updated: '2026-09-25 11:00:00.000Z' });
		store.upsert({ ...C, updated: '2026-09-25 11:00:00.000Z' });
		await vi.waitFor(() => expect(screen.getByRole('link', { name: 'Artikel' })).toBeTruthy());
		expect(box('Milch kaufen').checked).toBe(false);
		expect(box('Artikel').checked).toBe(false);
		expect(box('Rechnung September').checked).toBe(true);
		expect(screen.getByRole('button', { name: 'Verwerfen (1)' })).toBeTruthy();
	});

	it('shows a result only in its view: another view drops it (E-3)', async () => {
		const { store, data } = setup();
		await table();
		data.discard.mockRejectedValueOnce(new DataError('server'));
		await fireEvent.click(box('Milch kaufen'));
		await fireEvent.click(screen.getByRole('button', { name: 'Verwerfen (1)' }));
		await vi.waitFor(() => expect(within(bar()).getByRole('alert')).toBeTruthy());
		store.activate({ source: null, state: 'converted' });
		await vi.waitFor(() =>
			expect(caption()).toBe('Eingang · verknüpft, zuletzt verknüpfte zuerst')
		);
		expect(screen.queryByRole('region', { name: /ausgewählt$/ })).toBeNull();
		store.activate({ source: null, state: 'new' });
		await vi.waitFor(() => expect(caption()).toBe('Eingang · neu, neueste zuerst'));
		expect(screen.queryByRole('region', { name: /ausgewählt$/ })).toBeNull();
	});

	it('keeps every bulk action locked while a run goes on, with the progress as reason and a flag on a click or Enter (E-5)', async () => {
		const onlink = vi.fn();
		const { data, onbulk, flags } = setup({ onlink });
		await table();
		await fireEvent.click(
			screen.getByRole('checkbox', { name: 'Alle angezeigten Einträge auswählen' })
		);
		const first = deferred<InboxItemSummary>();
		data.discard.mockReturnValueOnce(first.promise);
		await fireEvent.click(screen.getByRole('button', { name: 'Verwerfen (3)' }));
		const progress = within(bar()).getByText('Verwerfen: 0 von 3 Einträgen');
		expect(progress.id).not.toBe('');
		for (const name of [
			'Gesammelt umwandeln (3)',
			'Mit Ticket verknüpfen … (3)',
			'Verwerfen (3)'
		]) {
			const button = screen.getByRole('button', { name });
			expect(button.getAttribute('aria-disabled')).toBe('true');
			// A button, not disabled: Enter reaches it and is a click in the browser.
			expect(button.hasAttribute('disabled')).toBe(false);
			expect(button.getAttribute('aria-describedby')).toBe(progress.id);
			await fireEvent.click(button);
		}
		expect(onbulk).not.toHaveBeenCalled();
		expect(onlink).not.toHaveBeenCalled();
		expect(data.discard).toHaveBeenCalledOnce();
		expect(flags.flags.map((flag) => [flag.tone, flag.title])).toEqual([
			['info', '„Verwerfen (3)“ geht erst, wenn „Verwerfen“ fertig ist.'],
			['info', '„Mit Ticket verknüpfen … (3)“ geht erst, wenn „Verwerfen“ fertig ist.'],
			['info', '„Gesammelt umwandeln (3)“ geht erst, wenn „Verwerfen“ fertig ist.']
		]);
		first.resolve({ ...B, state: 'discarded', updated: '2026-09-25 09:00:00.000Z' });
		await vi.waitFor(() => expect(data.discard).toHaveBeenCalledTimes(3));
	});

	it('offers "Details" of a failed request in the result, like one failed action (E-7)', async () => {
		const { data } = setup();
		await table();
		data.discard.mockRejectedValueOnce(new DataError('server'));
		await fireEvent.click(box('Milch kaufen'));
		await fireEvent.click(screen.getByRole('button', { name: 'Verwerfen (1)' }));
		const failures = await vi.waitFor(() => within(bar()).getByRole('alert'));
		const failure = within(failures).getByRole('listitem');
		expect(within(failure).getByText(`„Milch kaufen“: ${SERVER_FAILURE}`)).toBeTruthy();
		const details = within(failure).getByRole('button', { name: /^Details/ });
		await fireEvent.click(details);
		expect(details.getAttribute('aria-expanded')).toBe('true');
	});
});

describe('columns of the inbox (ADR-0030, package SP-5)', () => {
	useResizeObserverStub();

	afterEach(() => {
		localStorage.clear();
	});

	const marks = () =>
		screen.getAllByRole('columnheader').map((header) => header.getAttribute('data-col'));

	// 640 px instead of 600 since the actions hold the menu "•••" (2rem more, plan aktionsmenues, AM-4).
	it('lets the arrival date and "Quelle" give way at 640 px; selection, title and actions stay', async () => {
		setup();
		await table();

		resize(screen.getByRole('table').parentElement as HTMLElement, 640);
		await tick();

		expect(marks()).toEqual(['select', 'kind', 'title', 'source-date', 'actions']);
		expect(screen.getByRole('table').querySelectorAll('colgroup > col')).toHaveLength(5);
		expect(screen.getByRole('table').querySelector('caption')?.textContent).toMatch(
			/Weitere Spalten im Panel$/
		);
	});

	// Since EG-1 the view "Verworfen" has the selection too ("Wiederherstellen (n)"); "Verknüpft" and
	// "Alle" have none ("Alle" is checked above).
	it('has no selection column for linked entries', async () => {
		setup({ query: { source: null, state: 'converted' } });
		await table();

		expect(marks()).toEqual(['kind', 'title', 'source', 'source-date', 'arrival', 'actions']);
	});

	it('has the selection column in the view "Verworfen" (EG-1)', async () => {
		setup({ query: { source: null, state: 'discarded' } });
		await table();

		expect(marks()).toEqual([
			'select',
			'kind',
			'title',
			'source',
			'source-date',
			'arrival',
			'actions'
		]);
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
		// "Zielprojekt" (ADR-0049) is off by default and stays so.
		expect(JSON.parse(localStorage.getItem('byl-columns-inbox') ?? '')).toEqual({
			v: 1,
			widths: { kind: 128 },
			hidden: ['target']
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

	it('shows the column "Zielprojekt" once switched on in the menu (ADR-0049)', async () => {
		localStorage.setItem(
			'byl-columns-inbox',
			JSON.stringify({ v: 1, widths: {}, hidden: [], shown: ['target'] })
		);
		setup({
			items: [
				item('item00000000005', { targetProjectId: HAUS.id, created: '2026-09-25 09:00:00.000Z' }),
				A
			],
			projects: [HAUS]
		});
		await table();
		expect(marks()).toContain('target');
		const cells = screen.getByRole('table').querySelectorAll<HTMLElement>('td[data-col="target"]');
		expect([...cells].map((cell) => cell.textContent?.trim())).toEqual([
			'Haus (HAUS)',
			'–kein Zielprojekt'
		]);
	});
});

const HAUS: Project = {
	id: 'haus00000000001',
	name: 'Haus',
	code: 'HAUS',
	archived: false,
	parentId: null,
	updated: '2026-10-01 10:00:00.000Z'
};
const GARTEN: Project = {
	id: 'garten000000001',
	name: 'Garten',
	code: 'GART',
	archived: false,
	parentId: HAUS.id,
	parent: { id: HAUS.id, name: 'Haus', code: 'HAUS' },
	updated: '2026-10-01 10:00:00.000Z'
};

describe('target project of the entries (ADR-0049)', () => {
	const WITH_TARGETS = [
		item('item00000000001', { title: 'Haus-Eintrag', targetProjectId: HAUS.id }),
		item('item00000000002', { title: 'Garten-Eintrag', targetProjectId: GARTEN.id }),
		item('item00000000003', { title: 'Ohne Ziel', targetProjectId: null })
	];
	const titles = () =>
		screen.getAllByRole('rowheader').map((header) => header.textContent?.trim() ?? '');

	it('offers filter and grouping only once the server knows the field', async () => {
		setup({ items: [item('item00000000001', { withoutTargetField: true })] });
		await table();
		expect(screen.queryByRole('button', { name: /^Zielprojekt:/ })).toBeNull();
		expect(screen.queryByRole('switch', { name: 'Nach Zielprojekt gruppieren' })).toBeNull();
	});

	it('filters the new entries by a project with its sub projects, or without a target', async () => {
		const first = setup({
			items: WITH_TARGETS,
			projects: [HAUS, GARTEN],
			query: { source: null, state: 'new', target: HAUS.id }
		});
		await table();
		expect(titles()).toEqual(['Garten-Eintrag', 'Haus-Eintrag']);
		expect(screen.getByRole('button', { name: /^Zielprojekt: Haus \(HAUS\)/ })).toBeTruthy();
		first.view.unmount();
		document.body.innerHTML = '';

		setup({
			items: WITH_TARGETS,
			projects: [HAUS, GARTEN],
			query: { source: null, state: 'new', target: 'ohne' }
		});
		await table();
		expect(titles()).toEqual(['Ohne Ziel']);
	});

	it('says that no entry matches and resets source and target together', async () => {
		setup({
			items: [WITH_TARGETS[2]!],
			projects: [HAUS, GARTEN],
			query: { source: null, state: 'new', target: HAUS.id }
		});
		await vi.waitFor(() =>
			expect(screen.getByText('Keine Einträge für diese Filter')).toBeTruthy()
		);
		await fireEvent.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
		expect(lastTarget()).not.toMatch(/zielprojekt/);
	});

	it('groups the rows by target project in the order of the tree, "Ohne Zielprojekt" last', async () => {
		setup({
			items: WITH_TARGETS,
			projects: [GARTEN, HAUS],
			query: { source: null, state: 'new', grouped: true }
		});
		await table();
		const groups = screen
			.getAllByRole('rowgroup')
			.filter((group) => group.tagName === 'TBODY')
			.map((group) => [
				within(group)
					.getAllByRole('rowheader')
					.map((header) => header.textContent?.trim() ?? '')
			]);
		expect(groups).toEqual([
			[['Haus (HAUS)1 Eintrag', 'Haus-Eintrag']],
			[['Haus › Garten (GART)1 Eintrag', 'Garten-Eintrag']],
			[['Ohne Zielprojekt1 Eintrag', 'Ohne Ziel']]
		]);
		expect(screen.getByRole('table').querySelector('caption')?.textContent).toMatch(
			/nach Zielprojekt gruppiert/
		);
		const toggle = screen.getByRole('switch', { name: 'Nach Zielprojekt gruppieren' });
		expect((toggle as HTMLInputElement).checked).toBe(true);
		await fireEvent.click(toggle);
		expect(lastTarget()).not.toMatch(/gruppe=/);
	});

	it('lets the server filter the handled entries by the target project', async () => {
		const { data } = setup({
			items: WITH_TARGETS,
			projects: [HAUS, GARTEN],
			query: { source: null, state: 'converted', target: HAUS.id }
		});
		await vi.waitFor(() => expect(data.listHandled).toHaveBeenCalled());
		expect(data.listHandled.mock.calls.at(-1)?.[2]).toMatchObject({
			target: { project: HAUS.id }
		});
	});
});
