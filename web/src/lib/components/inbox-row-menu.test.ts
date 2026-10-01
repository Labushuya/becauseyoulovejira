// The menu "•••" of a row of the inbox (plan aktionsmenues, AM-4): after the buttons of the triage,
// which stay, with the entries of its state: "Öffnen", "Umwandeln …", "Mit Ticket verknüpfen …"
// and "Verwerfen" for a new entry, "Wiederherstellen" for a discarded one, the ticket for a linked
// one, and "Originaldatei herunterladen" where there is one. A right click and Shift+F10 open it
// (AM-3) without touching the selection; other links of the row keep the menu of the browser.
// AM-5 adds "Link der Quelle öffnen" (https only, new tab), "Anderem Ticket zuordnen …" and
// "Lösen" for a linked entry that is not the main source of its ticket, and "Seiteninhalt sichern"
// for a web link of which only the address is stored. The stores are real with fake data, the
// shared overlay stubs; page state and navigation are mocked.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboxItemSummary } from '$lib/domain/inbox';
import type { InboxQuery } from '$lib/domain/inbox-query';
import type { TicketSummary } from '$lib/domain/ticket';
import { FlagStore } from '$lib/stores/flags.svelte';
import { InboxStore, type InboxData } from '$lib/stores/inbox.svelte';
import type { TicketPickerSource } from '$lib/stores/ticket-picker.svelte';
import { TicketSourcesStore, type TicketSourcesData } from '$lib/stores/ticket-sources.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import { fakePickerSource, pickerTicket } from '$lib/test/ticket-picker-fake';
import InboxTable from './InboxTable.svelte';
import FlagGroup from './overlay/FlagGroup.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: { url: new URL('http://localhost:3000/eingang') }
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));

useOverlayStubs();

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

const MILK = item('item00000000001', {
	title: 'Milch kaufen',
	created: '2026-09-25 07:00:00.000Z'
});
const BILL = item('item00000000002', {
	title: 'Rechnung September',
	channel: 'eml',
	kind: 'mail',
	original: 'rechnung.eml',
	created: '2026-09-25 08:00:00.000Z'
});
const DUPLICATE_OF = {
	id: 'tick00000000001',
	key: 'HAUS-4',
	title: 'Milch kaufen',
	status: 'open'
} as TicketSummary;

function setup(
	options: {
		query?: InboxQuery;
		fresh?: InboxItemSummary[];
		handled?: InboxItemSummary[];
		onlinkitem?: ((item: InboxItemSummary) => void) | null;
		tickets?: TicketSummary[];
		/** With the sources store of the layout (AM-5): moving and releasing a linked entry. */
		sources?: boolean;
		picker?: TicketPickerSource;
	} = {}
) {
	const data = {
		listNew: vi.fn<InboxData['listNew']>(async () => options.fresh ?? [MILK, BILL]),
		listHandled: vi.fn<InboxData['listHandled']>(async (_state, page) => ({
			items: options.handled ?? [],
			page,
			hasMore: false
		})),
		get: vi.fn<InboxData['get']>(async (id) => ({ ...item(id), body: '' })),
		create: vi.fn<InboxData['create']>(),
		discard: vi.fn<InboxData['discard']>(async (id) => ({
			...[MILK, BILL].find((entry) => entry.id === id)!,
			state: 'discarded',
			handledAt: '2026-09-25 09:00:00.000Z',
			updated: '2026-09-25 09:00:00.000Z'
		})),
		restore: vi.fn<InboxData['restore']>(async (id) =>
			item(id, { updated: '2026-09-25 10:00:00.000Z' })
		),
		assign: vi.fn<InboxData['assign']>(),
		originalUrl: vi.fn<InboxData['originalUrl']>(async () => null),
		importCalendar: vi.fn<InboxData['importCalendar']>(),
		savePage: vi.fn<InboxData['savePage']>()
	} satisfies InboxData;
	const flags = new FlagStore();
	const session = { ensureValid: () => true, logout: vi.fn() };
	const store = new InboxStore(data, session, flags);
	store.activate(options.query ?? { source: null, state: 'new' });
	const known = () => [...(options.fresh ?? [MILK, BILL]), ...(options.handled ?? [])];
	const sourcesData = {
		list: vi.fn<TicketSourcesData['list']>(async () => []),
		link: vi.fn<TicketSourcesData['link']>(async (id, ticketId) => ({
			...known().find((entry) => entry.id === id)!,
			ticketId,
			ticket: { id: ticketId, key: 'TASK-4', title: 'Zahlungen', primary: false },
			updated: '2026-09-25 11:00:00.000Z'
		})),
		release: vi.fn<TicketSourcesData['release']>(async (id) => ({
			...known().find((entry) => entry.id === id)!,
			state: 'new',
			ticketId: null,
			ticket: null,
			handledAt: null,
			updated: '2026-09-25 11:00:00.000Z'
		})),
		originalUrl: vi.fn<TicketSourcesData['originalUrl']>(async () => null)
	} satisfies TicketSourcesData;
	// As in the (app) layout: what the sources store changes goes to the inbox at once.
	const sources = options.sources
		? new TicketSourcesStore(sourcesData, session, flags, (entry) => store.upsert(entry))
		: undefined;
	const onlinkitem = options.onlinkitem === null ? undefined : (options.onlinkitem ?? vi.fn());
	render(InboxTable, {
		props: {
			store,
			flags,
			sources,
			picker: options.picker,
			openTickets: options.tickets ?? [],
			onbulk: vi.fn(),
			onlinkitem
		}
	});
	render(FlagGroup, { props: { store: flags } });
	return { store, data, onlinkitem, sourcesData };
}

async function rowOf(title: string): Promise<HTMLElement> {
	const link = await screen.findByRole('link', { name: title });
	return link.closest('tr') as HTMLElement;
}

function menuButton(title: string): HTMLElement {
	return screen.getByRole('button', { name: `Weitere Aktionen für „${title}“` });
}

function menuOf(button: HTMLElement): HTMLElement {
	return document.getElementById(button.getAttribute('aria-controls') ?? '') as HTMLElement;
}

function entries(title: string): HTMLElement[] {
	return within(menuOf(menuButton(title))).getAllByRole('menuitem', { hidden: true });
}

const labels = (title: string) => entries(title).map((entry) => entry.textContent?.trim());

function entry(title: string, name: string): HTMLElement {
	return within(menuOf(menuButton(title))).getByRole('menuitem', { name, hidden: true });
}

const isOpen = (title: string) => menuButton(title).getAttribute('aria-expanded') === 'true';

beforeEach(() => {
	mocks.goto.mockClear();
	mocks.page.url = new URL('http://localhost:3000/eingang');
});

afterEach(() => {
	document.body.innerHTML = '';
});

describe('menu "•••" of a row of the inbox (AM-4)', () => {
	it('keeps the buttons of the triage and ends the actions with "•••"', async () => {
		setup();
		const actions = (await rowOf('Milch kaufen')).querySelector(
			'[data-col="actions"]'
		) as HTMLElement;
		const controls = [...actions.querySelectorAll('a, button')].filter(
			(control) => control.closest('[popover]') === null
		);
		expect(controls.map((control) => control.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
			'Umwandeln: „Milch kaufen“',
			'Verwerfen: „Milch kaufen“',
			''
		]);
		expect(controls.at(-1)).toBe(menuButton('Milch kaufen'));
		expect(menuButton('Milch kaufen').getAttribute('title')).toBe('Weitere Aktionen');
		expect(menuButton('Milch kaufen').classList.contains('row-menu')).toBe(true);
		expect(menuOf(menuButton('Milch kaufen')).getAttribute('aria-label')).toBe(
			'Weitere Aktionen für „Milch kaufen“'
		);
	});

	it('offers the entries of a new entry, with the original file only where there is one', async () => {
		setup();
		await rowOf('Milch kaufen');
		expect(labels('Milch kaufen')).toEqual([
			'Öffnen',
			'Umwandeln …',
			'Mit Ticket verknüpfen …',
			'Verwerfen'
		]);
		expect(entry('Milch kaufen', 'Öffnen').getAttribute('href')).toBe('/eingang/item00000000001');
		expect(entry('Milch kaufen', 'Umwandeln …').getAttribute('href')).toBe(
			'/tickets/neu?aus=item00000000001'
		);
		expect(entry('Milch kaufen', 'Mit Ticket verknüpfen …').getAttribute('aria-haspopup')).toBe(
			'dialog'
		);
		expect(labels('Rechnung September')).toEqual([
			'Öffnen',
			'Umwandeln …',
			'Mit Ticket verknüpfen …',
			'Verwerfen',
			'Originaldatei herunterladen'
		]);
	});

	it('has no "Mit Ticket verknüpfen …" without its handler', async () => {
		setup({ onlinkitem: null });
		await rowOf('Milch kaufen');
		expect(labels('Milch kaufen')).toEqual(['Öffnen', 'Umwandeln …', 'Verwerfen']);
	});

	it('offers "Wiederherstellen" for a discarded entry and the ticket for a linked one', async () => {
		setup({
			query: { source: null, state: 'all' },
			handled: [
				item('item00000000008', {
					title: 'Weg',
					state: 'discarded',
					handledAt: '2026-09-20 10:00:00.000Z'
				}),
				item('item00000000009', {
					title: 'Alt',
					state: 'converted',
					handledAt: '2026-09-20 10:00:00.000Z',
					ticketId: 'tick00000000009',
					ticket: { id: 'tick00000000009', key: 'HAUS-9', title: 'Steuer', primary: false }
				})
			]
		});
		await rowOf('Weg');
		expect(labels('Weg')).toEqual(['Öffnen', 'Wiederherstellen']);
		expect(labels('Alt')).toEqual(['Öffnen', 'Ticket HAUS-9 öffnen']);
		expect(entry('Alt', 'Ticket HAUS-9 öffnen').getAttribute('href')).toBe(
			'/tickets/tick00000000009'
		);
	});

	it('runs the entries like the buttons of the row and the panel', async () => {
		const { data, onlinkitem } = setup();
		await rowOf('Milch kaufen');

		await fireEvent.click(entry('Milch kaufen', 'Mit Ticket verknüpfen …'));
		expect(onlinkitem).toHaveBeenCalledExactlyOnceWith(MILK);

		await fireEvent.click(entry('Rechnung September', 'Originaldatei herunterladen'));
		await vi.waitFor(() =>
			expect(data.originalUrl).toHaveBeenCalledWith(
				expect.objectContaining({ id: BILL.id, original: 'rechnung.eml' })
			)
		);
		// Without a file the reason comes as an error flag, as for every failed row action.
		const flags = within(screen.getByRole('region', { name: 'Benachrichtigungen' }));
		await vi.waitFor(() =>
			expect(flags.getAllByText('Zu diesem Eintrag gibt es keine Datei.').length).toBeGreaterThan(0)
		);

		await fireEvent.click(entry('Milch kaufen', 'Verwerfen'));
		await vi.waitFor(() => expect(data.discard).toHaveBeenCalledWith(MILK.id));
		await vi.waitFor(() => expect(screen.queryByRole('link', { name: 'Milch kaufen' })).toBeNull());
	});

	it('opens the menu with a right click at the pointer and leaves the selection alone', async () => {
		setup();
		const row = await rowOf('Milch kaufen');
		const kind = row.querySelector('[data-col="kind"]') as HTMLElement;

		expect(await fireEvent.contextMenu(kind, { button: 2, clientX: 160, clientY: 90 })).toBe(false);
		await tick();

		expect(isOpen('Milch kaufen')).toBe(true);
		expect(menuOf(menuButton('Milch kaufen')).style.top).toBe('90px');
		expect(menuOf(menuButton('Milch kaufen')).style.left).toBe('160px');
		const select = screen.getByRole<HTMLInputElement>('checkbox', {
			name: 'Eintrag „Milch kaufen“ auswählen'
		});
		await fireEvent.contextMenu(select, { button: 2 });
		expect(select.checked).toBe(false);
		expect(mocks.goto).not.toHaveBeenCalled();
	});

	it('keeps the menu of the browser on the other links of a row', async () => {
		setup({ tickets: [DUPLICATE_OF] });
		const row = await rowOf('Milch kaufen');
		const convert = within(row).getByRole('link', { name: 'Umwandeln: „Milch kaufen“' });
		const duplicate = within(row).getByRole('link', { name: 'HAUS-4' });

		expect(await fireEvent.contextMenu(convert, { button: 2 })).toBe(true);
		expect(await fireEvent.contextMenu(duplicate, { button: 2 })).toBe(true);
		expect(isOpen('Milch kaufen')).toBe(false);
		// The title opens the entry itself: its right click gets the menu of the row.
		const title = within(row).getByRole('link', { name: 'Milch kaufen' });
		expect(await fireEvent.contextMenu(title, { button: 2 })).toBe(false);
	});

	it('opens it with Shift+F10 on the title and gives the focus back with Escape', async () => {
		setup();
		const title = within(await rowOf('Rechnung September')).getByRole('link', {
			name: 'Rechnung September'
		});
		title.focus();

		expect(await fireEvent.keyDown(title, { key: 'F10', shiftKey: true })).toBe(false);
		await tick();
		expect(isOpen('Rechnung September')).toBe(true);
		expect(document.activeElement?.textContent?.trim()).toBe('Öffnen');

		await fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
		expect(document.activeElement).toBe(title);
	});
});

describe('menu "•••" of a row of the inbox: sources and copies (AM-5)', () => {
	const HANDLED = '2026-09-20 10:00:00.000Z';
	/** A web link of which only the address is stored, with an https address. */
	const PAGE = item('item00000000003', {
		title: 'Artikel lesen',
		channel: 'link',
		kind: 'link',
		sourceUrl: 'https://example.com/artikel'
	});
	/** The same with an http address: no link in the menu (ExternalLink takes https only). */
	const PLAIN = item('item00000000004', {
		title: 'Alte Seite',
		channel: 'link',
		kind: 'link',
		sourceUrl: 'http://example.com/alt'
	});
	/** Linked to HAUS-12, not its main source; its page is saved already. */
	const LINKED = item('item00000000005', {
		title: 'Beleg',
		channel: 'link',
		kind: 'link',
		sourceUrl: 'https://example.com/beleg',
		original: 'seite.html',
		state: 'converted',
		ticketId: 'tick00000000012',
		ticket: { id: 'tick00000000012', key: 'HAUS-12', title: 'Steuer 2025', primary: false },
		handledAt: HANDLED
	});
	/** The main source of HAUS-13: it stays with its ticket. */
	const MAIN = item('item00000000006', {
		title: 'Stromrechnung',
		channel: 'eml',
		kind: 'mail',
		original: 'strom.eml',
		state: 'converted',
		ticketId: 'tick00000000013',
		ticket: { id: 'tick00000000013', key: 'HAUS-13', title: 'Strom', primary: true },
		handledAt: '2026-09-21 10:00:00.000Z'
	});
	/** Linked, but its ticket was not loaded: whether it is the main source is unknown. */
	const UNKNOWN = item('item00000000007', {
		title: 'Notiz',
		state: 'converted',
		ticketId: 'tick00000000014',
		ticket: null,
		handledAt: HANDLED
	});
	const DROPPED = item('item00000000008', {
		title: 'Weg',
		channel: 'link',
		kind: 'link',
		sourceUrl: 'https://example.com/weg',
		state: 'discarded',
		handledAt: HANDLED
	});
	const LINK_ENTRY = 'Link der Quelle öffnen (öffnet in neuem Tab)';

	/** The entries of a menu in order, "—" for a line. */
	function structure(title: string): string[] {
		return [...menuOf(menuButton(title)).children].map((child) =>
			child.getAttribute('role') === 'separator' ? '—' : (child.textContent?.trim() ?? '')
		);
	}

	const flagTexts = () => within(screen.getByRole('region', { name: 'Benachrichtigungen' }));

	it('offers the entries of each state; the main source keeps its ticket', async () => {
		setup({
			query: { source: null, state: 'all' },
			handled: [MILK, PAGE, PLAIN, LINKED, MAIN, UNKNOWN, DROPPED],
			sources: true
		});
		await rowOf('Beleg');

		expect(structure('Artikel lesen')).toEqual([
			'Öffnen',
			LINK_ENTRY,
			'—',
			'Umwandeln …',
			'Mit Ticket verknüpfen …',
			'Verwerfen',
			'—',
			'Seiteninhalt sichern'
		]);
		// An http address and no address at all: no link of the source.
		expect(structure('Alte Seite')).toEqual([
			'Öffnen',
			'—',
			'Umwandeln …',
			'Mit Ticket verknüpfen …',
			'Verwerfen',
			'—',
			'Seiteninhalt sichern'
		]);
		expect(structure('Milch kaufen')).toEqual([
			'Öffnen',
			'—',
			'Umwandeln …',
			'Mit Ticket verknüpfen …',
			'Verwerfen'
		]);
		expect(structure('Beleg')).toEqual([
			'Öffnen',
			LINK_ENTRY,
			'—',
			'Ticket HAUS-12 öffnen',
			'Anderem Ticket zuordnen …',
			'Lösen',
			'—',
			'Originaldatei herunterladen'
		]);
		expect(entry('Beleg', 'Anderem Ticket zuordnen …').getAttribute('aria-haspopup')).toBe(
			'dialog'
		);
		expect(entry('Beleg', 'Lösen').hasAttribute('aria-haspopup')).toBe(false);
		// The main source and an entry whose ticket is unknown neither move nor leave.
		expect(structure('Stromrechnung')).toEqual([
			'Öffnen',
			'—',
			'Ticket HAUS-13 öffnen',
			'—',
			'Originaldatei herunterladen'
		]);
		expect(structure('Notiz')).toEqual(['Öffnen', '—', 'Ticket öffnen']);
		expect(structure('Weg')).toEqual([
			'Öffnen',
			LINK_ENTRY,
			'—',
			'Wiederherstellen',
			'—',
			'Seiteninhalt sichern'
		]);
	});

	it('offers neither moving nor releasing without the sources store', async () => {
		setup({ query: { source: null, state: 'converted' }, handled: [LINKED] });
		await rowOf('Beleg');
		expect(structure('Beleg')).toEqual([
			'Öffnen',
			LINK_ENTRY,
			'—',
			'Ticket HAUS-12 öffnen',
			'—',
			'Originaldatei herunterladen'
		]);
	});

	it('opens the link of the source in a new tab, by the rules of ExternalLink', async () => {
		setup({ fresh: [PAGE] });
		await rowOf('Artikel lesen');
		const link = within(menuOf(menuButton('Artikel lesen'))).getByRole('menuitem', {
			name: /^Link der Quelle öffnen/,
			hidden: true
		});

		expect(link.tagName).toBe('A');
		// The hidden part of the name says where it opens, as ExternalLink does, with its own space
		// (ADR-0026, addendum of 2026-10-01).
		expect(link.textContent).toBe(LINK_ENTRY);
		expect(link.querySelector('.visually-hidden')?.textContent).toBe('(öffnet in neuem Tab)');
		expect(link.getAttribute('href')).toBe('https://example.com/artikel');
		expect(link.getAttribute('target')).toBe('_blank');
		expect(link.getAttribute('rel')).toBe('noopener noreferrer');
		expect(link.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
		// A real link in the open menu: the browser keeps its menu there ("Link kopieren" …).
		expect(await fireEvent.contextMenu(link, { button: 2 })).toBe(true);
	});

	it('releases a linked entry like the panel; the focus goes to the next row', async () => {
		const { sourcesData } = setup({
			query: { source: null, state: 'converted' },
			handled: [MAIN, LINKED],
			sources: true
		});
		await rowOf('Beleg');

		await fireEvent.click(entry('Beleg', 'Lösen'));
		await vi.waitFor(() => expect(sourcesData.release).toHaveBeenCalledWith(LINKED.id));
		await vi.waitFor(() => expect(screen.queryByRole('link', { name: 'Beleg' })).toBeNull());
		expect(flagTexts().getAllByText('„Beleg“ ist wieder im Eingang.').length).toBeGreaterThan(0);
		await vi.waitFor(() =>
			expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Stromrechnung' }))
		);
	});

	it('moves a linked entry with the dialog of the panel; the focus returns to "•••"', async () => {
		const picker = fakePickerSource({
			open: [
				pickerTicket({ id: 'tick00000000012', key: 'HAUS-12', title: 'Steuer 2025' }),
				pickerTicket({ id: 'tick00000000004', key: 'TASK-4', title: 'Zahlungen' })
			]
		}).source;
		const { sourcesData } = setup({
			query: { source: null, state: 'converted' },
			handled: [LINKED],
			sources: true,
			picker
		});
		await rowOf('Beleg');

		await fireEvent.click(entry('Beleg', 'Anderem Ticket zuordnen …'));
		await tick();
		const dialog = screen.getByRole('dialog', { name: 'Anderem Ticket zuordnen' });
		expect(screen.getAllByRole('dialog')).toHaveLength(1);
		expect(within(dialog).getByText(/„Beleg“ gehört zu HAUS-12 und wechselt direkt/)).toBeTruthy();
		const input = within(dialog).getByRole('combobox', { name: 'Neues Ticket' });
		await fireEvent.focus(input);
		await vi.waitFor(() => expect(input.getAttribute('aria-expanded')).toBe('true'));
		await fireEvent.keyDown(input, { key: 'Enter' });
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Zuordnen' }));

		await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
		expect(sourcesData.link).toHaveBeenCalledWith(LINKED.id, 'tick00000000004');
		expect(flagTexts().getAllByText('„Beleg“ gehört jetzt zu TASK-4.').length).toBeGreaterThan(0);
		expect(screen.getByRole('link', { name: 'Ticket TASK-4 öffnen: „Beleg“' })).toBeTruthy();
		await vi.waitFor(() => expect(document.activeElement).toBe(menuButton('Beleg')));
	});

	it('saves the page of a web link like the panel; a refusal becomes an error flag', async () => {
		const { data } = setup({ fresh: [PAGE] });
		const row = await rowOf('Artikel lesen');
		const cell = row.querySelector('[data-col="actions"]') as HTMLElement;
		let finish: (outcome: Awaited<ReturnType<InboxData['savePage']>>) => void = () => undefined;
		data.savePage.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				})
		);

		await fireEvent.click(entry('Artikel lesen', 'Seiteninhalt sichern'));
		await vi.waitFor(() => expect(data.savePage).toHaveBeenCalledWith(PAGE.id));
		// While the server fetches the page, the entry and its cell wait.
		expect(entry('Artikel lesen', 'Seiteninhalt sichern').getAttribute('aria-busy')).toBe('true');
		expect(cell.getAttribute('aria-busy')).toBe('true');
		finish({ kind: 'saved', title: 'Artikel', size: 2048, truncated: false });
		await vi.waitFor(() =>
			expect(
				flagTexts().getAllByText('Seite von „Artikel lesen“ gesichert.').length
			).toBeGreaterThan(0)
		);
		expect(cell.hasAttribute('aria-busy')).toBe(false);

		data.savePage.mockResolvedValueOnce({
			kind: 'refused',
			message: 'Lokale, private und interne Adressen werden nicht abgerufen.'
		});
		await fireEvent.click(entry('Artikel lesen', 'Seiteninhalt sichern'));
		await vi.waitFor(() =>
			expect(
				flagTexts().getAllByText(
					'Seite von „Artikel lesen“ ließ sich nicht sichern: Lokale, private und interne Adressen werden nicht abgerufen.'
				).length
			).toBeGreaterThan(0)
		);
	});
});
