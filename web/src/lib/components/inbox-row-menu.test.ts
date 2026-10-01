// The menu "•••" of a row of the inbox (plan aktionsmenues, AM-4): after the buttons of the triage,
// which stay, with the entries of its state: "Öffnen", "Umwandeln …", "Mit Ticket verknüpfen …"
// and "Verwerfen" for a new entry, "Wiederherstellen" for a discarded one, the ticket for a linked
// one, and "Originaldatei herunterladen" where there is one. A right click and Shift+F10 open it
// (AM-3) without touching the selection; other links of the row keep the menu of the browser. The
// store is real with fake data, the shared overlay stubs; page state and navigation are mocked.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboxItemSummary } from '$lib/domain/inbox';
import type { InboxQuery } from '$lib/domain/inbox-query';
import type { TicketSummary } from '$lib/domain/ticket';
import { FlagStore } from '$lib/stores/flags.svelte';
import { InboxStore, type InboxData } from '$lib/stores/inbox.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
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
		handled?: InboxItemSummary[];
		onlinkitem?: ((item: InboxItemSummary) => void) | null;
		tickets?: TicketSummary[];
	} = {}
) {
	const data = {
		listNew: vi.fn<InboxData['listNew']>(async () => [MILK, BILL]),
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
	const store = new InboxStore(data, { ensureValid: () => true, logout: vi.fn() }, flags);
	store.activate(options.query ?? { source: null, state: 'new' });
	const onlinkitem = options.onlinkitem === null ? undefined : (options.onlinkitem ?? vi.fn());
	render(InboxTable, {
		props: {
			store,
			flags,
			openTickets: options.tickets ?? [],
			onbulk: vi.fn(),
			onlinkitem
		}
	});
	render(FlagGroup, { props: { store: flags } });
	return { store, data, onlinkitem };
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
