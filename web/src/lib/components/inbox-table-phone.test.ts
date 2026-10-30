// The inbox in the phone frame (MO-6, ADR-0073 addendum MO-6) in jsdom with the real store on fake
// data and a controlled matchMedia: cards instead of the table (title, a muted line with kind,
// source with its connection, the dates and the target project, "Umwandeln", "Verwerfen" and "•••"),
// a tap on a card opens the entry, "Verwerfen" with "Rückgängig" in the flag; the row of the view
// holds "Erfassen", "Filter (n)" and the menu of the list; the filter sheet holds the chips "Quelle"
// and "Zustand", "Zielprojekt" and the grouping, every choice a navigation; "Auswählen" with "Alle",
// the bulk actions and "Fertig"; the files after the list. The counter-checks: on a PC with the
// switch on and on a phone with the switch off the table stays as before. The layout itself (44 px,
// three lines of title, no sideways scrolling) is checked statically here and in a browser by
// tests/mobile/phone-frame.spec.mjs.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboxItemSummary } from '$lib/domain/inbox';
import type { InboxQuery } from '$lib/domain/inbox-query';
import { PHONE_QUERY } from '$lib/domain/phone-layout';
import type { Project } from '$lib/domain/project';
import { getMobileLayoutStore } from '$lib/mobile-layout.svelte';
import { ConnectionNamesStore } from '$lib/stores/connection-names.svelte';
import { FlagStore } from '$lib/stores/flags.svelte';
import { InboxStore, type InboxData } from '$lib/stores/inbox.svelte';
import { LiveHealth } from '$lib/stores/live-health.svelte';
import type { SyncAllStore } from '$lib/stores/sync-all.svelte';
import ConnectionNamesHarness from '$lib/test/ConnectionNamesHarness.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import InboxTable from './InboxTable.svelte';
import FlagGroup from './overlay/FlagGroup.svelte';

useOverlayStubs();

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
	channel: 'mail',
	kind: 'mail',
	connectionId: 'conn00000000003',
	sourceDate: '2026-09-24 08:30:00.000Z',
	created: '2026-09-25 08:00:00.000Z'
});
const C = item('item00000000003', {
	title: 'Artikel',
	channel: 'link',
	kind: 'link',
	created: '2026-09-25 07:30:00.000Z'
});

const HAUS: Project = {
	id: 'haus00000000001',
	name: 'Haus',
	code: 'HAUS',
	archived: false,
	parentId: null,
	updated: '2026-10-01 10:00:00.000Z'
};

let stop: (() => void) | null = null;

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

/** "Alle Kanäle jetzt abrufen" of the layout, faked; `offline`: without a connection (OF-3). */
function fakeSyncAll(offline = false) {
	return { running: false, status: '', offline, runAll: vi.fn(async () => undefined) };
}

const tools = createRawSnippet(() => ({
	render: () => '<div class="test-files">Dateien übernehmen</div>'
}));

async function setup(
	options: {
		items?: InboxItemSummary[];
		query?: InboxQuery;
		projects?: Project[];
		handled?: InboxItemSummary[];
		withNames?: boolean;
		/** The connection is missing (OF-3). */
		offline?: boolean;
	} = {}
) {
	const items = options.items ?? [A, B, C];
	const data = {
		listNew: vi.fn<InboxData['listNew']>(async () => items),
		listHandled: vi.fn<InboxData['listHandled']>(async (_state, page) => ({
			items: options.handled ?? [],
			page,
			hasMore: false
		})),
		get: vi.fn<InboxData['get']>(async (id) => ({ ...item(id), body: '' })),
		create: vi.fn<InboxData['create']>(),
		discard: vi.fn<InboxData['discard']>(async (id) => ({
			...items.find((entry) => entry.id === id)!,
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
	const projects = options.projects ?? [];
	const store = new InboxStore(
		data,
		{ ensureValid: () => true, logout: vi.fn() },
		flags,
		() => projects
	);
	store.activate(options.query ?? { source: null, state: 'new' });
	const onbulk = vi.fn();
	const onlink = vi.fn();
	const onlinkitem = vi.fn();
	const onclipboard = vi.fn();
	const syncAll = fakeSyncAll(options.offline);
	const props = {
		store,
		flags,
		openTickets: [],
		projects,
		onbulk,
		onlink,
		onlinkitem,
		onclipboard,
		syncAll: syncAll as unknown as SyncAllStore,
		offline: options.offline ?? false,
		tools
	};
	let view;
	if (options.withNames) {
		const names = new ConnectionNamesStore(
			{
				list: async () => [{ id: 'conn00000000003', label: 'Gmail Arbeit' }],
				subscribe: async () => async () => undefined,
				reconnected: async () => async () => undefined
			},
			{ ensureValid: () => true, logout: vi.fn() },
			{ health: new LiveHealth() }
		);
		await names.load();
		view = render(ConnectionNamesHarness, { props: { names, component: InboxTable, props } });
	} else {
		view = render(InboxTable, { props });
	}
	render(FlagGroup, { props: { store: flags } });
	await vi.waitFor(() => expect(store.state).toBe('ready'));
	await tick();
	return { store, data, flags, onbulk, onlink, onclipboard, syncAll, view };
}

/** The card of an entry by its title. */
const card = (title: string) =>
	[...document.querySelectorAll<HTMLElement>('li[data-item-id]')].find(
		(entry) => entry.querySelector('.card-title')?.textContent?.trim() === title
	) as HTMLElement;

/** The entries of the open menu of `trigger`. */
function menuOf(trigger: HTMLElement): HTMLElement {
	return document.getElementById(trigger.getAttribute('aria-controls') ?? '') as HTMLElement;
}

beforeEach(() => {
	mocks.goto.mockClear();
	mocks.page.url = new URL('http://localhost:3000/eingang');
});

afterEach(() => {
	stop?.();
	stop = null;
	getMobileLayoutStore().choose(false);
	vi.unstubAllGlobals();
	vi.useRealTimers();
	localStorage.clear();
	document.body.innerHTML = '';
});

describe('the inbox as cards in the phone frame (MO-6)', () => {
	it('shows cards instead of the table: the title, a muted line with kind, source and dates, and the main actions', async () => {
		useWindow(true, true);
		await setup({ withNames: true });

		expect(screen.queryByRole('table')).toBeNull();
		const cards = [...document.querySelectorAll<HTMLElement>('li[data-item-id]')];
		expect(cards.map((entry) => entry.querySelector('.card-title')?.textContent?.trim())).toEqual([
			'Rechnung September',
			'Artikel',
			'Milch kaufen'
		]);
		const mail = card('Rechnung September');
		const title = within(mail).getByRole('link', { name: 'Rechnung September' });
		expect(title.getAttribute('href')).toBe('/eingang/item00000000002');
		expect(title.hasAttribute('data-row-link')).toBe(true);
		const meta = mail.querySelector('.card-meta') as HTMLElement;
		expect([...meta.children].map((part) => part.textContent?.replace(/\s+/g, ' ').trim())).toEqual(
			['Mail', 'Postfach · Gmail Arbeit', 'Eingang 25.09.2026', 'Quelldatum 24.09.2026']
		);
		const convert = within(mail).getByRole('link', { name: 'Umwandeln: „Rechnung September“' });
		expect(convert.getAttribute('href')).toBe('/tickets/neu?aus=item00000000002');
		expect(convert.classList.contains('button-secondary')).toBe(true);
		expect(
			within(mail)
				.getByRole('button', { name: 'Verwerfen: „Rechnung September“' })
				.classList.contains('button-secondary')
		).toBe(true);
		const more = within(mail).getByRole('button', {
			name: 'Weitere Aktionen für „Rechnung September“'
		});
		expect(more.classList.contains('row-menu')).toBe(true);
		expect(mail.hasAttribute('data-menu-row')).toBe(true);
		// The menu of the card is the menu of the row.
		expect(
			within(menuOf(more))
				.getAllByRole('menuitem', { hidden: true })
				.map((entry) => entry.textContent?.trim())
		).toEqual(['Öffnen', 'Umwandeln …', 'Mit Ticket verknüpfen …', 'Verwerfen', 'Schließen']);
	});

	it('opens the entry with a tap on the card; its buttons and links keep their own taps', async () => {
		useWindow(true, true);
		mocks.page.url = new URL('http://localhost:3000/eingang?quelle=mail');
		const { data } = await setup({ query: { source: 'mail', state: 'new' } });

		await fireEvent.click(card('Rechnung September').querySelector('.card-meta') as HTMLElement);
		expect(mocks.goto).toHaveBeenCalledWith('/eingang/item00000000002?quelle=mail');

		mocks.goto.mockClear();
		await fireEvent.click(screen.getByRole('button', { name: 'Verwerfen: „Rechnung September“' }));
		await vi.waitFor(() => expect(data.discard).toHaveBeenCalledWith('item00000000002'));
		expect(mocks.goto).not.toHaveBeenCalled();
	});

	it('discards with one tap: the card leaves, the flag offers "Rückgängig", the focus goes to the next card', async () => {
		useWindow(true, true);
		const { data } = await setup();

		await fireEvent.click(screen.getByRole('button', { name: 'Verwerfen: „Artikel“' }));
		await vi.waitFor(() => expect(card('Artikel')).toBeUndefined());
		const flags = within(screen.getByRole('region', { name: 'Benachrichtigungen' }));
		const undo = await vi.waitFor(() => flags.getByRole('button', { name: 'Rückgängig' }));
		await vi.waitFor(() =>
			expect(document.activeElement).toBe(
				within(card('Milch kaufen')).getByRole('link', { name: 'Milch kaufen' })
			)
		);
		await fireEvent.click(undo);
		await vi.waitFor(() => expect(data.restore).toHaveBeenCalledWith('item00000000003'));
	});

	it('shows the chip of the ticket for a linked entry and "Wiederherstellen" for a discarded one, with the state above the cards', async () => {
		useWindow(true, true);
		mocks.page.url = new URL('http://localhost:3000/eingang?zustand=alle');
		await setup({
			query: { source: null, state: 'all' },
			handled: [
				item('item00000000007', {
					title: 'Verknüpft',
					state: 'converted',
					ticketId: 'tick00000000007',
					ticket: { id: 'tick00000000007', key: 'HAUS-12', title: 'Rechnung', primary: true },
					handledAt: '2026-09-26 10:00:00.000Z'
				}),
				item('item00000000008', {
					title: 'Verworfen',
					state: 'discarded',
					handledAt: '2026-09-26 11:00:00.000Z'
				})
			]
		});

		await vi.waitFor(() => expect(card('Verknüpft')).toBeDefined());
		const linked = card('Verknüpft');
		expect(linked.classList.contains('linked')).toBe(true);
		expect(
			within(linked)
				.getByRole('link', { name: 'Ticket HAUS-12 öffnen: „Verknüpft“' })
				.classList.contains('ticket-chip')
		).toBe(true);
		expect(
			within(card('Verworfen')).getByRole('button', { name: 'Wiederherstellen: „Verworfen“' })
		).toBeTruthy();
		expect(within(card('Verworfen')).queryByRole('button', { name: /^Verwerfen/ })).toBeNull();
		const caption = document.querySelector('.cards-caption') as HTMLElement;
		expect(caption.textContent?.trim()).toBe('Eingang · alle, neueste zuerst');
		expect(caption.classList.contains('visually-hidden')).toBe(false);
	});

	it('keeps the caption of the default view for screen readers only', async () => {
		useWindow(true, true);
		await setup();
		const caption = document.querySelector('.cards-caption') as HTMLElement;
		expect(caption.textContent?.trim()).toBe('Eingang · neu, neueste zuerst');
		expect(caption.classList.contains('visually-hidden')).toBe(true);
	});

	it('shows the row of the view: "Erfassen", "Filter" with the number of filters and the menu of the list', async () => {
		useWindow(true, true);
		mocks.page.url = new URL(
			'http://localhost:3000/eingang?quelle=mail&zielprojekt=haus00000000001'
		);
		const { view } = await setup({
			query: { source: 'mail', state: 'new', target: HAUS.id },
			projects: [HAUS],
			items: [item('item00000000002', { channel: 'mail', targetProjectId: HAUS.id })]
		});

		const row = view.container.querySelector('.phone-tools') as HTMLElement;
		expect(within(row).getByRole('link', { name: 'Erfassen' }).getAttribute('href')).toBe(
			'/eingang/neu?quelle=mail&zielprojekt=haus00000000001'
		);
		const filter = within(row).getByRole('button', { name: 'Filter, 2 aktiv' });
		expect(filter.getAttribute('aria-haspopup')).toBe('dialog');
		expect(within(row).getByRole('button', { name: 'Weitere Aktionen der Liste' })).toBeTruthy();
		// The chips, the bulk actions, "Spalten" and the files of the PC are not above the list.
		expect(screen.queryByRole('group', { name: 'Quelle' })).toBeNull();
		expect(screen.queryByRole('button', { name: /^Gesammelt umwandeln/ })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Spalten' })).toBeNull();
		expect(screen.queryByRole('checkbox', { name: /auswählen$/ })).toBeNull();
		expect(
			screen
				.getByRole('heading', { level: 2, name: 'Eingang' })
				.classList.contains('visually-hidden')
		).toBe(true);
		// The target project of an entry stands in its line.
		expect(document.querySelector('.card-meta')?.textContent).toContain('Zielprojekt Haus (HAUS)');
	});

	it('offers "Auswählen", "Aus Zwischenablage" and "Alle Kanäle jetzt abrufen" in the menu of the list', async () => {
		useWindow(true, true);
		const { onclipboard, syncAll } = await setup();

		const trigger = screen.getByRole('button', { name: 'Weitere Aktionen der Liste' });
		const menu = menuOf(trigger);
		expect(
			within(menu)
				.getAllByRole('menuitem', { hidden: true })
				.map((entry) => entry.textContent?.trim())
		).toEqual(['Auswählen', 'Aus Zwischenablage', 'Alle Kanäle jetzt abrufen', 'Schließen']);
		await fireEvent.click(
			within(menu).getByRole('menuitem', { name: 'Aus Zwischenablage', hidden: true })
		);
		expect(onclipboard).toHaveBeenCalledOnce();
		await fireEvent.click(
			within(menu).getByRole('menuitem', { name: 'Alle Kanäle jetzt abrufen', hidden: true })
		);
		expect(syncAll.runAll).toHaveBeenCalledOnce();
		// The status of the run has its own live region below the row.
		expect(document.querySelector('.sync-status')?.getAttribute('role')).toBe('status');
	});

	it('keeps "Alle Kanäle jetzt abrufen" in the menu without a connection, locked and saying why (OF-3)', async () => {
		useWindow(true, true);
		const { syncAll } = await setup({ offline: true });
		const menu = menuOf(screen.getByRole('button', { name: 'Weitere Aktionen der Liste' }));
		const entry = within(menu).getByRole('menuitem', {
			name: 'Alle Kanäle jetzt abrufen (nur mit Verbindung)',
			hidden: true
		});
		expect(entry.getAttribute('aria-disabled')).toBe('true');
		await fireEvent.click(entry);
		expect(syncAll.runAll).not.toHaveBeenCalled();
	});

	it('opens the filter sheet with "Quelle", "Zustand", "Zielprojekt" and the grouping; a choice navigates and the sheet stays', async () => {
		useWindow(true, true);
		await setup({
			projects: [HAUS],
			items: [A, item('item00000000002', { targetProjectId: HAUS.id })]
		});

		const button = screen.getByRole('button', { name: 'Filter' });
		button.focus();
		await fireEvent.click(button);
		await tick();
		const sheet = screen.getByRole('dialog', { name: 'Filter' });
		const source = within(sheet).getByRole('group', { name: 'Quelle' });
		const state = within(sheet).getByRole('group', { name: 'Zustand' });
		expect(within(sheet).getByRole('button', { name: /^Zielprojekt:/ })).toBeTruthy();
		expect(within(sheet).getByRole('switch', { name: 'Nach Zielprojekt gruppieren' })).toBeTruthy();
		// Nothing of the tickets: no "Gruppieren" and no "Sortieren nach".
		expect(within(sheet).queryByRole('group', { name: 'Sortieren nach' })).toBeNull();
		expect(within(sheet).queryByRole('group', { name: 'Gruppieren' })).toBeNull();
		expect(
			within(sheet).getByRole('button', { name: 'Zurücksetzen' }).getAttribute('aria-disabled')
		).toBe('true');

		await fireEvent.click(within(source).getByRole('radio', { name: 'Mail' }));
		expect(mocks.goto).toHaveBeenLastCalledWith('/eingang?quelle=mail', {
			keepFocus: true,
			noScroll: true
		});
		await fireEvent.click(within(state).getByRole('radio', { name: 'Verworfen' }));
		expect(mocks.goto).toHaveBeenLastCalledWith('/eingang?zustand=verworfen', {
			keepFocus: true,
			noScroll: true
		});
		expect(screen.getByRole('dialog', { name: 'Filter' })).toBeTruthy();

		await fireEvent.click(within(sheet).getByRole('button', { name: '2 Einträge anzeigen' }));
		await tick();
		expect(screen.queryByRole('dialog', { name: 'Filter' })).toBeNull();
		expect(document.activeElement).toBe(button);
	});

	it('resets source and target from the sheet and keeps state and grouping', async () => {
		useWindow(true, true);
		mocks.page.url = new URL(
			'http://localhost:3000/eingang?quelle=mail&zielprojekt=haus00000000001&gruppe=zielprojekt'
		);
		await setup({
			query: { source: 'mail', state: 'new', target: HAUS.id, grouped: true },
			projects: [HAUS],
			items: [item('item00000000002', { channel: 'mail', targetProjectId: HAUS.id })]
		});

		await fireEvent.click(screen.getByRole('button', { name: 'Filter, 2 aktiv' }));
		await tick();
		const sheet = screen.getByRole('dialog', { name: 'Filter' });
		await fireEvent.click(within(sheet).getByRole('button', { name: 'Zurücksetzen' }));
		expect(mocks.goto).toHaveBeenLastCalledWith('/eingang?gruppe=zielprojekt', {
			keepFocus: true,
			noScroll: true
		});
		expect(screen.getByRole('dialog', { name: 'Filter' })).toBeTruthy();
	});

	it('groups the cards by target project under the heads of the groups', async () => {
		useWindow(true, true);
		await setup({
			query: { source: null, state: 'new', grouped: true },
			projects: [HAUS],
			items: [
				item('item00000000001', { title: 'Haus-Eintrag', targetProjectId: HAUS.id }),
				item('item00000000003', { title: 'Ohne Ziel', targetProjectId: null })
			]
		});

		const heads = [...document.querySelectorAll('.card-head')].map((head) =>
			head.textContent?.trim()
		);
		expect(heads).toEqual(['Haus (HAUS)1 Eintrag', 'Ohne Zielprojekt1 Eintrag']);
		const first = document.querySelector('.card-section') as HTMLElement;
		expect(within(first).getByRole('link', { name: 'Haus-Eintrag' })).toBeTruthy();
		expect(document.querySelector('.cards-caption')?.textContent).toMatch(
			/nach Zielprojekt gruppiert/
		);
	});

	// MO-7b: the bulk actions and "Fertig" moved into the bar of the selection at the bottom, shared
	// with "Aufgaben" and "Papierkorb"; it stands from the start of "Auswählen", locked while nothing
	// is chosen.
	it('chooses with "Auswählen": a box on every new entry, a tap chooses, "Alle", the bulk actions and "Fertig"', async () => {
		useWindow(true, true);
		const { onbulk, onlink, view } = await setup();
		expect(screen.queryByRole('checkbox', { name: 'Eintrag „Artikel“ auswählen' })).toBeNull();

		const menu = menuOf(screen.getByRole('button', { name: 'Weitere Aktionen der Liste' }));
		await fireEvent.click(within(menu).getByRole('menuitem', { name: 'Auswählen', hidden: true }));
		await tick();
		const bar = screen.getByRole('group', { name: 'Auswahl' });
		expect(within(bar).queryByRole('button', { name: /^Gesammelt umwandeln/ })).toBeNull();
		expect(within(bar).queryByRole('button', { name: 'Fertig' })).toBeNull();
		const empty = screen.getByRole('region', { name: '0 Einträge ausgewählt' });
		const locked = within(empty).getByRole('button', { name: 'Aktionen' });
		expect(locked.getAttribute('aria-disabled')).toBe('true');
		expect(
			document.getElementById(locked.getAttribute('aria-describedby') ?? '')?.textContent
		).toBe('Erst Einträge auswählen.');
		const list = view.container.querySelector('.card-list') as HTMLElement;
		expect(list.compareDocumentPosition(empty) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		const box = (title: string) =>
			screen.getByRole<HTMLInputElement>('checkbox', { name: `Eintrag „${title}“ auswählen` });
		expect(box('Artikel').closest('label')?.classList.contains('check-target')).toBe(true);

		// A tap on the card chooses it instead of opening the entry.
		await fireEvent.click(card('Artikel').querySelector('.card-meta') as HTMLElement);
		expect(box('Artikel').checked).toBe(true);
		expect(mocks.goto).not.toHaveBeenCalled();
		expect(card('Artikel').classList.contains('chosen')).toBe(true);
		const chosen = screen.getByRole('region', { name: '1 Eintrag ausgewählt' });
		await fireEvent.click(within(chosen).getByRole('button', { name: 'Aktionen' }));
		await tick();
		const actions = within(chosen).getByRole('group', { name: 'Sammelaktionen' });
		await fireEvent.click(within(actions).getByRole('button', { name: 'Gesammelt umwandeln (1)' }));
		expect(onbulk).toHaveBeenCalledOnce();
		await fireEvent.click(
			within(actions).getByRole('button', { name: 'Mit Ticket verknüpfen … (1)' })
		);
		expect(onlink).toHaveBeenCalledOnce();

		const all = within(bar).getByRole<HTMLInputElement>('checkbox', {
			name: 'Alle angezeigten Einträge auswählen'
		});
		await fireEvent.click(all);
		expect(
			['Rechnung September', 'Artikel', 'Milch kaufen'].every((title) => box(title).checked)
		).toBe(true);

		await fireEvent.click(
			within(screen.getByRole('region', { name: '3 Einträge ausgewählt' })).getByRole('button', {
				name: 'Fertig'
			})
		);
		expect(screen.queryByRole('group', { name: 'Auswahl' })).toBeNull();
		expect(screen.queryByRole('region', { name: /ausgewählt$/ })).toBeNull();
		expect(screen.queryByRole('checkbox', { name: /auswählen$/ })).toBeNull();
	});

	it('puts the files after the list', async () => {
		useWindow(true, true);
		const { view } = await setup();
		const files = view.container.querySelector('.test-files') as HTMLElement;
		const list = view.container.querySelector('.card-list') as HTMLElement;
		expect(files).not.toBeNull();
		expect(list.compareDocumentPosition(files) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});
});

// EG-1 (ADR-0014 addendum EG-1): "Verwerfen (n)" and "Wiederherstellen (n)" in the bar of the
// selection at the bottom, with the progress and the result in the same bar.
describe('several entries at once in the phone frame (EG-1)', () => {
	const GONE = [
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

	/** "Auswählen" from the menu of the list, then a tap on each card of `titles`. */
	async function choose(...titles: string[]) {
		const menu = menuOf(screen.getByRole('button', { name: 'Weitere Aktionen der Liste' }));
		await fireEvent.click(within(menu).getByRole('menuitem', { name: 'Auswählen', hidden: true }));
		await tick();
		for (const title of titles) {
			await fireEvent.click(card(title).querySelector('.card-meta') as HTMLElement);
		}
	}

	/** "Aktionen" of the bar at the bottom, opened; returns the group of the bulk actions. */
	async function actionsOf(region: HTMLElement): Promise<HTMLElement> {
		await fireEvent.click(within(region).getByRole('button', { name: 'Aktionen' }));
		await tick();
		return within(region).getByRole('group', { name: 'Sammelaktionen' });
	}

	it('discards the chosen entries with "Verwerfen (n)" behind "Aktionen"; "Rückgängig" brings them back, the focus stays in the bar', async () => {
		useWindow(true, true);
		const { data } = await setup();
		await choose('Artikel', 'Milch kaufen');
		const region = screen.getByRole('region', { name: '2 Einträge ausgewählt' });
		const actions = await actionsOf(region);
		await fireEvent.click(within(actions).getByRole('button', { name: 'Verwerfen (2)' }));
		await vi.waitFor(() => expect(data.discard.mock.calls).toEqual([[C.id], [A.id]]));
		await vi.waitFor(() => expect(card('Artikel')).toBeUndefined());
		expect(card('Milch kaufen')).toBeUndefined();
		const flags = within(screen.getByRole('region', { name: 'Benachrichtigungen' }));
		await vi.waitFor(() =>
			expect(flags.getByRole('listitem').textContent).toContain('2 Einträge verworfen.')
		);
		// "Auswählen" goes on with the bar; the focus went back into it, on "Aktionen".
		const after = screen.getByRole('region', { name: '0 Einträge ausgewählt' });
		await vi.waitFor(() =>
			expect(document.activeElement).toBe(within(after).getByRole('button', { name: 'Aktionen' }))
		);

		await fireEvent.click(flags.getByRole('button', { name: 'Rückgängig' }));
		await vi.waitFor(() => expect(data.restore.mock.calls).toEqual([[C.id], [A.id]]));
		// Both cards are back (the fake answers with its own titles).
		await vi.waitFor(() =>
			expect(
				[...document.querySelectorAll<HTMLElement>('li[data-item-id]')].map(
					(entry) => entry.dataset.itemId
				)
			).toEqual(expect.arrayContaining([C.id, A.id]))
		);
	});

	it('restores the chosen entries with "Wiederherstellen (n)" in the view "Verworfen"', async () => {
		useWindow(true, true);
		mocks.page.url = new URL('http://localhost:3000/eingang?zustand=verworfen');
		const { data } = await setup({ query: { source: null, state: 'discarded' }, handled: GONE });
		await vi.waitFor(() => expect(card('Alt eins')).toBeDefined());
		await choose('Alt eins', 'Alt zwei');
		const actions = await actionsOf(screen.getByRole('region', { name: '2 Einträge ausgewählt' }));
		expect(
			within(actions)
				.getAllByRole('button')
				.map((button) => button.textContent?.trim())
		).toEqual(['Wiederherstellen (2)']);
		await fireEvent.click(within(actions).getByRole('button', { name: 'Wiederherstellen (2)' }));
		await vi.waitFor(() =>
			expect(data.restore.mock.calls).toEqual([['item00000000007'], ['item00000000008']])
		);
		await vi.waitFor(() => expect(card('Alt eins')).toBeUndefined());
		await vi.waitFor(() =>
			expect(
				within(screen.getByRole('region', { name: 'Benachrichtigungen' })).getByRole('listitem')
					.textContent
			).toContain('2 Einträge wiederhergestellt.')
		);
	});

	it('keeps "Wiederherstellen (n)" without a connection, locked, and names why on a tap or Enter', async () => {
		useWindow(true, true);
		mocks.page.url = new URL('http://localhost:3000/eingang?zustand=verworfen');
		const { data, flags } = await setup({
			query: { source: null, state: 'discarded' },
			handled: GONE,
			offline: true
		});
		await vi.waitFor(() => expect(card('Alt eins')).toBeDefined());
		await choose('Alt eins');
		const actions = await actionsOf(screen.getByRole('region', { name: '1 Eintrag ausgewählt' }));
		const button = within(actions).getByRole('button', { name: 'Wiederherstellen (1)' });
		expect(button.getAttribute('aria-disabled')).toBe('true');
		expect(button.hasAttribute('disabled')).toBe(false);
		expect(
			document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent
		).toBe('Nur mit Verbindung');
		await fireEvent.click(button);
		expect(data.restore).not.toHaveBeenCalled();
		expect(flags.flags.map((flag) => [flag.tone, flag.title])).toEqual([
			['info', '„Wiederherstellen (1)“ geht nur mit Verbindung.']
		]);
	});

	// MO-7c1: the other bulk actions of the view "Neu" behind "Aktionen" are locked the same way.
	it('locks "Gesammelt umwandeln (n)" and "Mit Ticket verknüpfen … (n)" without a connection as well (MO-7c1)', async () => {
		useWindow(true, true);
		const { onbulk, onlink, flags } = await setup({ offline: true });
		await choose('Artikel');
		const actions = await actionsOf(screen.getByRole('region', { name: '1 Eintrag ausgewählt' }));
		for (const name of [
			'Gesammelt umwandeln (1)',
			'Mit Ticket verknüpfen … (1)',
			'Verwerfen (1)'
		]) {
			const button = within(actions).getByRole('button', { name });
			expect(button.getAttribute('aria-disabled'), name).toBe('true');
			expect(button.hasAttribute('disabled'), name).toBe(false);
			expect(
				document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent,
				name
			).toBe('Nur mit Verbindung');
			await fireEvent.click(button);
		}
		expect(onbulk).not.toHaveBeenCalled();
		expect(onlink).not.toHaveBeenCalled();
		expect(flags.flags.map((flag) => [flag.tone, flag.title])).toEqual([
			['info', '„Verwerfen (1)“ geht nur mit Verbindung.'],
			['info', '„Mit Ticket verknüpfen … (1)“ geht nur mit Verbindung.'],
			['info', '„Gesammelt umwandeln (1)“ geht nur mit Verbindung.']
		]);
	});

	// Round 2 of EG-1 (review E-1).
	it('ends "Auswählen" and empties the selection when another view is chosen (E-1)', async () => {
		useWindow(true, true);
		const { store } = await setup({ handled: GONE });
		await choose('Artikel');
		expect(screen.getByRole('region', { name: '1 Eintrag ausgewählt' })).toBeTruthy();
		store.activate({ source: null, state: 'discarded' });
		await vi.waitFor(() => expect(card('Alt eins')).toBeDefined());
		// "Auswählen" ended with the view: no boxes on the discarded cards and no bar.
		expect(card('Alt eins').querySelector('input[type="checkbox"]')).toBeNull();
		expect(screen.queryByRole('region', { name: /ausgewählt$/ })).toBeNull();
		store.activate({ source: null, state: 'new' });
		await vi.waitFor(() => expect(card('Artikel')).toBeDefined());
		expect(card('Artikel').querySelector('input[type="checkbox"]')).toBeNull();
		expect(screen.queryByRole('region', { name: /ausgewählt$/ })).toBeNull();
	});
});

describe('the inbox outside the phone frame stays the table (MO-6)', () => {
	it.each([
		['a PC with the switch on', false, true],
		['a phone with the switch off', true, false]
	])('keeps the table, the chips and the bar of the PC on %s', async (_name, narrow, enabled) => {
		useWindow(narrow, enabled);
		const { view } = await setup();

		expect(await screen.findByRole('table')).toBeTruthy();
		expect(document.querySelectorAll('li[data-item-id]')).toHaveLength(0);
		expect(screen.getByRole('group', { name: 'Quelle' })).toBeTruthy();
		expect(screen.getByRole('group', { name: 'Zustand' })).toBeTruthy();
		expect(screen.getByRole('button', { name: /^Gesammelt umwandeln/ })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Aus Zwischenablage' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Spalten' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: /^Filter/ })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Weitere Aktionen der Liste' })).toBeNull();
		expect(view.container.querySelector('.sync-status')).toBeNull();
		// The files stand right below the chips, before the table.
		const files = view.container.querySelector('.test-files') as HTMLElement;
		const table = screen.getByRole('table');
		expect(files.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(
			screen
				.getByRole('heading', { level: 2, name: 'Eingang' })
				.classList.contains('visually-hidden')
		).toBe(false);
	});
});

describe('styles of the inbox in the phone frame (MO-6)', () => {
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
		const head = `${FRAME} ${selector}`;
		const at =
			block.indexOf(`${head} {`) > -1 ? block.indexOf(`${head} {`) : block.indexOf(`${head},`);
		expect(at, `${file}: ${selector}`).toBeGreaterThan(-1);
		return block.slice(block.indexOf('{', at) + 1, block.indexOf('}', at));
	}

	it('gives the title up to three lines, lets long words wrap and the targets 44 px', () => {
		expect(rule('InboxTable.svelte', '.card-title')).toMatch(
			/overflow-wrap: anywhere;[\s\S]*-webkit-line-clamp: 3;\s*line-clamp: 3;/
		);
		expect(rule('InboxTable.svelte', '.card-meta')).toMatch(
			/flex-wrap: wrap;[\s\S]*overflow-wrap: anywhere;/
		);
		const target = rule('InboxTable.svelte', '.check-target');
		expect(target).toMatch(/min-width: var\(--control-height-touch\);/);
		expect(target).toMatch(/min-height: var\(--control-height-touch\);/);
		for (const selector of ['.bulk', '.more', '.duplicate .text-button']) {
			expect(rule('InboxTable.svelte', selector), selector).toMatch(
				/min-height: var\(--control-height-touch\);/
			);
		}
		expect(rule('InboxTable.svelte', '.sheet-filters :global(.toggle)')).toMatch(
			/min-height: var\(--control-height-touch\);/
		);
		expect(rule('InboxTable.svelte', '.card-actions .ticket-chip')).toMatch(
			/min-height: var\(--control-height-touch\);/
		);
		expect(rule('FilterButton.svelte', '.filter-open.active')).toMatch(
			/background: var\(--color-brand-soft-bg\);/
		);
	});

	it('has no rules for the cards outside the block of the frame', () => {
		const source = read('InboxTable.svelte');
		const outside = source.replace(frameBlock(source), '');
		for (const name of [
			'.inbox-card',
			'.card-title',
			'.card-meta',
			'.check-target',
			'.sheet-filters'
		]) {
			expect(outside.includes(`${name} {`), name).toBe(false);
		}
	});
});
