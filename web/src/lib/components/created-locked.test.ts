// A ticket or an entry "＋" created that the server does not have yet (OF-4a round 2, ADR-0074 addendum
// OF-4a): it cannot be chosen for a bulk action, neither by its own box nor by "Alle auswählen", a
// range or a tap on its card (A2); what needs the server stays visible but locked with its reason,
// "gesperrt statt weg" (A6): in the table priority, project, tags and "Zuständig", in the panel and the
// full view the same fields, the title, the description and "Unteraufgabe hinzufügen". Status and due
// date stay editable.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedPathname } from '$app/types';
import type { InboxItem, InboxItemSummary } from '$lib/domain/inbox';
import { parseListQuery } from '$lib/domain/list-query';
import { PHONE_QUERY } from '$lib/domain/phone-layout';
import type { Ticket, TicketSummary } from '$lib/domain/ticket';
import { getMobileLayoutStore } from '$lib/mobile-layout.svelte';
import { BulkEditStore, type BulkEditData } from '$lib/stores/bulk-edit.svelte';
import { CatalogStore } from '$lib/stores/catalog.svelte';
import { FlagStore } from '$lib/stores/flags.svelte';
import { InboxStore, type InboxData } from '$lib/stores/inbox.svelte';
import {
	TicketDetailStore,
	type TicketDetailData,
	type TicketListSync
} from '$lib/stores/ticket-detail.svelte';
import {
	TicketListStore,
	type TicketListData,
	type TicketOverlay
} from '$lib/stores/ticket-list.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import EditableTitle from './EditableTitle.svelte';
import InboxTable from './InboxTable.svelte';
import TicketDescription from './TicketDescription.svelte';
import TicketFields from './TicketFields.svelte';
import TicketSubtasks from './TicketSubtasks.svelte';
import TicketTable from './TicketTable.svelte';

useOverlayStubs();

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: { url: new URL('http://localhost:3000/') }
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));

const SESSION = { ensureValid: () => true, logout: vi.fn() };
const REASON = 'Geht erst, wenn das Ticket übertragen ist.';
const CREATED_ID = 'aaaaaaaaaaaaaaa';
const CREATED_NAME = 'Neues Ticket „Zahnarzt anrufen“';

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
		created: `2026-09-0${n} 10:00:00.000Z`,
		updated: '2026-09-01 10:00:00.000Z',
		...overrides
	};
}

/** A ticket "＋" created as the outbox shows it: no key, between TASK-1 and TASK-2 by its age. */
const CREATED: Ticket = {
	...ticket(0),
	id: CREATED_ID,
	key: '',
	title: 'Zahnarzt anrufen',
	source: 'quick',
	created: '2026-09-01 12:00:00.000Z',
	updated: '2026-09-01 12:00:00.000Z',
	description: '',
	sourceItem: null
};

/** The outbox as the list sees it: one ticket "＋" created, nothing else kept. */
const OVERLAY: TicketOverlay = {
	apply: (entry) => entry,
	holds: () => false,
	isPending: (id) => id === CREATED_ID,
	createdTickets: () => [CREATED],
	isCreatedView: (entry) => entry === CREATED
};

let stopLayout: (() => void) | null = null;

function phone(): void {
	vi.stubGlobal('matchMedia', (media: string) => ({
		matches: media === PHONE_QUERY,
		media,
		addEventListener: () => undefined,
		removeEventListener: () => undefined
	}));
	stopLayout = getMobileLayoutStore().connect();
	getMobileLayoutStore().choose(true);
}

async function showTable(open: TicketSummary[]) {
	mocks.page.url = new URL('/', 'http://localhost:3000');
	const data: TicketListData = {
		listOpen: vi.fn(async () => open),
		listSubtasks: vi.fn(async () => []),
		searchOpen: vi.fn(async (): Promise<string[]> => []),
		setDone: vi.fn(),
		update: vi.fn()
	};
	const store = new TicketListStore(data, SESSION, { overlay: OVERLAY });
	const catalog = new CatalogStore(
		{ listProjects: vi.fn(async () => []), listTags: vi.fn(async () => []), createTag: vi.fn() },
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
	const search = createRawSnippet(() => ({
		render: () => '<div><input type="search" aria-label="Suche" /></div>'
	}));
	render(TicketTable, { props: { store, catalog, bulk, search } });
	await vi.advanceTimersByTimeAsync(0);
	await tick();
	return { store };
}

const rowOf = (id: string) =>
	document.querySelector<HTMLElement>(`[data-ticket-id="${id}"]`) as HTMLElement;
const box = (key: string) =>
	screen.getByRole<HTMLInputElement>('checkbox', { name: `${key} auswählen` });
const countText = () => screen.queryByRole('region', { name: /ausgewählt/ })?.textContent ?? '';

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
	vi.setSystemTime(Date.UTC(2026, 8, 24, 10));
	mocks.goto.mockClear();
});

afterEach(() => {
	stopLayout?.();
	stopLayout = null;
	getMobileLayoutStore().choose(false);
	vi.unstubAllGlobals();
	vi.useRealTimers();
	document.body.innerHTML = '';
});

describe('the selection of the table without a ticket "＋" created (A2)', () => {
	it('has no box for it, keeps its cell, and leaves it out of "Alle auswählen"', async () => {
		await showTable([ticket(1), ticket(2)]);
		expect(screen.queryByRole('checkbox', { name: `${CREATED_NAME} auswählen` })).toBeNull();
		expect(rowOf(CREATED_ID).firstElementChild?.getAttribute('data-col')).toBe('select');
		await fireEvent.click(
			screen.getByRole('checkbox', { name: 'Alle angezeigten Tickets auswählen' })
		);
		expect(box('TASK-1').checked).toBe(true);
		expect(box('TASK-2').checked).toBe(true);
		expect(countText()).toContain('2 Tickets ausgewählt');
	});

	it('leaves it out of a range chosen with Shift', async () => {
		await showTable([ticket(1), ticket(2)]);
		// Newest first: TASK-2, the new ticket, TASK-1.
		await fireEvent.click(box('TASK-2'));
		const last = box('TASK-1');
		await fireEvent.pointerDown(last.closest('td') as HTMLElement, { shiftKey: true });
		await fireEvent.click(last);
		expect(countText()).toContain('2 Tickets ausgewählt');
	});
});

describe('the cells of a ticket "＋" created in the table (A6)', () => {
	it('locks priority, project and tags with the reason and keeps status and due date', async () => {
		await showTable([ticket(1)]);
		for (const name of [
			`Priorität von ${CREATED_NAME}: Mittel`,
			`Projekt von ${CREATED_NAME}: kein Projekt`,
			`Tags von ${CREATED_NAME}: keine`
		]) {
			const cell = screen.getByRole('button', { name });
			expect(cell.getAttribute('aria-disabled'), name).toBe('true');
			expect(cell.getAttribute('aria-haspopup'), name).toBeNull();
			const reason = document.getElementById(cell.getAttribute('aria-describedby') ?? '');
			expect(reason?.textContent, name).toBe(REASON);
		}
		const row = rowOf(CREATED_ID);
		for (const column of ['status', 'due']) {
			const cell = row.querySelector(`[data-col="${column}"] button`) as HTMLElement;
			expect(cell.getAttribute('aria-disabled'), column).toBeNull();
			expect(cell.getAttribute('aria-haspopup'), column).toBeTruthy();
		}
		// The cells of a ticket of the server stay as they were.
		expect(
			screen
				.getByRole('button', { name: 'Priorität von TASK-1: Mittel, ändern' })
				.getAttribute('aria-disabled')
		).toBeNull();
	});
});

describe('the cards of the phone frame with a ticket "＋" created (A2)', () => {
	it('has no box on its card, a tap does not choose it, and "Alle" leaves it out', async () => {
		phone();
		await showTable([ticket(1), ticket(2)]);
		const trigger = screen.getByRole('button', { name: 'Weitere Aktionen der Liste' });
		const menu = document.getElementById(
			trigger.getAttribute('aria-controls') ?? ''
		) as HTMLElement;
		await fireEvent.click(within(menu).getByRole('menuitem', { name: 'Auswählen', hidden: true }));
		await tick();
		expect(screen.queryByRole('checkbox', { name: `${CREATED_NAME} auswählen` })).toBeNull();
		await fireEvent.click(rowOf(CREATED_ID).querySelector('.meta') as HTMLElement);
		expect(countText()).toBe('');
		const bar = screen.getByRole('group', { name: 'Auswahl' });
		await fireEvent.click(
			within(bar).getByRole('checkbox', { name: 'Alle angezeigten Tickets auswählen' })
		);
		expect(countText()).toContain('2 Tickets ausgewählt');
	});
});

describe('the inbox with an entry "＋" put into it (A2)', () => {
	function entry(id: string, title: string): InboxItemSummary {
		return {
			id,
			channel: 'manual',
			kind: 'todo',
			title,
			sourceUrl: '',
			sourceRef: '',
			sourceDate: null,
			sourceMeta: {},
			original: '',
			state: 'new',
			ticketId: null,
			handledAt: null,
			created: '2026-09-25 08:00:00.000Z',
			updated: '2026-09-25 08:00:00.000Z'
		};
	}

	it('leaves it out of "Alle angezeigten Einträge auswählen"', async () => {
		mocks.page.url = new URL('http://localhost:3000/eingang');
		const created = { ...entry(CREATED_ID, 'Milch kaufen'), body: '' } as InboxItem;
		const data = {
			listNew: vi.fn(async () => [entry('item00000000001', 'Rechnung')])
		} as unknown as InboxData;
		const store = new InboxStore(data, SESSION, new FlagStore(), () => [], {
			createdItems: () => [created],
			createdItem: (id) => (id === CREATED_ID ? created : null),
			isCreatedView: (record) => record === created
		});
		store.activate({ source: null, state: 'new' });
		render(InboxTable, {
			props: { store, flags: new FlagStore(), openTickets: [], projects: [], onbulk: vi.fn() }
		});
		await vi.advanceTimersByTimeAsync(0);
		await screen.findByRole('table');
		expect(screen.queryByRole('checkbox', { name: 'Eintrag „Milch kaufen“ auswählen' })).toBeNull();
		await fireEvent.click(
			screen.getByRole('checkbox', { name: 'Alle angezeigten Einträge auswählen' })
		);
		expect(screen.getByRole('button', { name: 'Gesammelt umwandeln (1)' })).toBeTruthy();
	});
});

describe('the panel and the full view of a ticket "＋" created (A6)', () => {
	async function detail() {
		const data = {
			get: vi.fn(),
			update: vi.fn(),
			create: vi.fn(),
			delete: vi.fn()
		} satisfies TicketDetailData;
		const list = {
			find: () => null,
			upsert: vi.fn((summary: TicketSummary) => summary),
			completed: vi.fn(),
			remove: vi.fn(),
			announce: vi.fn(),
			subtasksOf: () => []
		} satisfies TicketListSync;
		const store = new TicketDetailStore(
			data,
			SESSION,
			list,
			null,
			undefined,
			undefined,
			undefined,
			{
				apply: (entry) => entry,
				isCreatedView: (entry) => entry === CREATED,
				createdTicket: (id) => (id === CREATED_ID ? CREATED : null)
			}
		);
		store.open(CREATED_ID);
		await vi.waitFor(() => expect(store.state).toBe('ready'));
		expect(store.created).toBe(true);
		expect(data.get).not.toHaveBeenCalled();
		return store;
	}

	function lockedWithReason(control: HTMLElement): void {
		expect(control.getAttribute('aria-disabled')).toBe('true');
		const reason = document.getElementById(control.getAttribute('aria-describedby') ?? '');
		expect(reason?.textContent).toBe(REASON);
	}

	it('locks priority, project and tags with the reason; status and due date stay', async () => {
		const store = await detail();
		const catalog = new CatalogStore(
			{ listProjects: vi.fn(async () => []), listTags: vi.fn(async () => []), createTag: vi.fn() },
			SESSION
		);
		void catalog.load();
		render(TicketFields, { props: { store, catalog, ticket: CREATED } });
		await tick();
		lockedWithReason(screen.getByRole('button', { name: 'Priorität: Mittel' }));
		lockedWithReason(screen.getByRole('button', { name: 'Projekt: kein Projekt' }));
		lockedWithReason(screen.getByRole('button', { name: 'Tags: keine' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Priorität: Mittel' }));
		expect(store.isSaving('priority')).toBe(false);
		expect(
			screen.getByRole('combobox', { name: 'Status' }).getAttribute('aria-disabled')
		).toBeNull();
		expect(screen.getByLabelText('Fälligkeit').getAttribute('aria-disabled')).toBeNull();
	});

	it('locks "Titel bearbeiten" and "Bearbeiten" of the description with the reason', async () => {
		const store = await detail();
		render(EditableTitle, { props: { store, headingId: 'heading' } });
		render(TicketDescription, { props: { store, ticket: CREATED } });
		await tick();
		const title = screen.getByRole('button', { name: 'Titel bearbeiten' });
		lockedWithReason(title);
		await fireEvent.click(title);
		expect(store.isEditing('title')).toBe(false);
		const description = screen.getByRole('button', { name: 'Bearbeiten: Beschreibung' });
		lockedWithReason(description);
		await fireEvent.click(description);
		expect(store.isEditing('description')).toBe(false);
	});

	it('locks "Unteraufgabe hinzufügen" with the reason', async () => {
		const data: TicketListData = {
			listOpen: vi.fn(async () => []),
			listSubtasks: vi.fn(async () => []),
			searchOpen: vi.fn(async (): Promise<string[]> => []),
			setDone: vi.fn(),
			update: vi.fn()
		};
		const list = new TicketListStore(data, SESSION, { overlay: OVERLAY });
		render(TicketSubtasks, {
			props: {
				ticket: CREATED,
				list,
				hrefOf: (id: string) => `/tickets/${id}` as ResolvedPathname
			}
		});
		await tick();
		const add = screen.getByRole('button', { name: 'Unteraufgabe hinzufügen' });
		lockedWithReason(add);
		await fireEvent.click(add);
		expect(screen.queryByRole('textbox', { name: 'Titel der Unteraufgabe' })).toBeNull();
	});
});
