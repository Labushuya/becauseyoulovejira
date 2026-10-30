// "Wiederholungen" in the phone frame (MO-7b, ADR-0073 addendum MO-7b) in jsdom with the real stores
// on fake data and a controlled matchMedia: cards instead of the table (the title with its charm, a
// muted line with the state, the rhythm, the next ticket, the open tickets and the project, "•••"), a
// tap on a card opens the rule as a page; the row of the view holds "Neue Regel" and "So
// funktioniert’s". The rule as a page: the arrow back after its way, also with typed input after the
// question, the actions of the head in "•••", no hint on keys. The counter-checks: on a PC with the
// switch on and on a phone with the switch off the table stays as before.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedPathname } from '$app/types';
import type { RecurrenceRule } from '$lib/domain/recurrence-rule';
import { PHONE_QUERY } from '$lib/domain/phone-layout';
import type { TicketSummary } from '$lib/domain/ticket';
import { getMobileLayoutStore } from '$lib/mobile-layout.svelte';
import { CatalogStore } from '$lib/stores/catalog.svelte';
import type { EditResult } from '$lib/stores/catalog-editor';
import { FlagStore } from '$lib/stores/flags.svelte';
import { RecurrenceStore, type RecurrenceData } from '$lib/stores/recurrence.svelte';
import { TicketListStore } from '$lib/stores/ticket-list.svelte';
import { PC_CONTEXT, useContext } from '$lib/test/context';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import RecurrencePanel from './RecurrencePanel.svelte';
import RecurrencesView from './RecurrencesView.svelte';

useOverlayStubs();

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	guards: [] as unknown[],
	page: { url: new URL('http://localhost:3000/wiederholungen') }
}));

vi.mock('$app/navigation', () => ({
	goto: mocks.goto,
	beforeNavigate: (guard: unknown) => mocks.guards.push(guard)
}));
vi.mock('$app/state', () => ({ page: mocks.page }));

const T0 = '2026-09-01 10:00:00.000Z';

function rule(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
	return {
		id: 'rule00000000001',
		title: 'Müll rausbringen',
		description: '',
		projectId: null,
		tagIds: [],
		priority: 'medium',
		mode: 'calendar',
		freq: 'weekly',
		interval: 1,
		weekdays: ['MO'],
		monthDay: null,
		anchor: '2026-09-07',
		leadDays: 3,
		nextDue: '2099-09-28',
		lastGeneratedAt: null,
		active: true,
		lastHint: '',
		created: T0,
		updated: T0,
		...overrides
	};
}

const RULES = [rule(), rule({ id: 'rule00000000003', title: 'Steuer', active: false })];

const OPEN: TicketSummary = {
	id: 'ticket000000001',
	key: 'TASK-7',
	title: 'Müll rausbringen',
	status: 'open',
	priority: 'medium',
	due: '2099-09-21',
	projectId: null,
	tagIds: [],
	project: null,
	tags: [],
	recurring: true,
	recurrenceId: 'rule00000000001',
	source: null,
	completedAt: null,
	created: T0,
	updated: T0
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

async function show() {
	const session = { ensureValid: () => true, logout: vi.fn() };
	const flags = new FlagStore();
	const data = {
		listRules: vi.fn(async () => RULES),
		createRule: vi.fn(),
		updateRule: vi.fn(),
		setActive: vi.fn(),
		deleteRule: vi.fn(async () => undefined),
		detachTicket: vi.fn()
	} as unknown as RecurrenceData;
	const store = new RecurrenceStore(data, session, flags);
	await store.load();
	const tickets = new TicketListStore(
		{
			listOpen: async () => [OPEN],
			searchOpen: vi.fn(async (): Promise<string[]> => []),
			setDone: vi.fn(),
			update: vi.fn()
		},
		session
	);
	tickets.loadOpen();
	await vi.waitFor(() => expect(tickets.openState).toBe('ready'));
	const catalog = new CatalogStore(
		{ listProjects: async () => [], listTags: async () => [], createTag: vi.fn() },
		session
	);
	const view = render(RecurrencesView, { props: { store, tickets, catalog, flags } });
	await tick();
	return { view };
}

/** The card of a rule by its title. */
const card = (title: string) =>
	[...document.querySelectorAll<HTMLElement>('li[data-rule-row]')].find(
		(entry) => entry.querySelector('.card-title a')?.textContent?.trim() === title
	) as HTMLElement;

beforeEach(async () => {
	mocks.goto.mockClear();
	mocks.guards.length = 0;
	await useContext(PC_CONTEXT);
});

afterEach(() => {
	stop?.();
	stop = null;
	getMobileLayoutStore().choose(false);
	vi.unstubAllGlobals();
	localStorage.clear();
	document.body.innerHTML = '';
});

describe('"Wiederholungen" as cards in the phone frame (MO-7b)', () => {
	it('shows cards instead of the table: the title, a muted line with state, rhythm, next ticket, open tickets', async () => {
		useWindow(true, true);
		await show();

		expect(screen.queryByRole('table')).toBeNull();
		const rubbish = card('Müll rausbringen');
		const link = within(rubbish).getByRole('link', { name: 'Müll rausbringen' });
		expect(link.getAttribute('href')).toBe('/wiederholungen/rule00000000001');
		expect(link.hasAttribute('data-row-link')).toBe(true);
		const meta = rubbish.querySelector('.card-meta')?.textContent?.replace(/\s+/g, ' ') ?? '';
		expect(meta).toContain('Aktiv');
		expect(meta).toMatch(/Montag/);
		expect(meta).toMatch(/Nächstes Ticket/);
		// Without the host of the route (ADR-0054) the link of the list store leads to the ticket.
		expect(within(rubbish).getByRole('link', { name: 'TASK-7' }).getAttribute('href')).toBe(
			'/tickets/ticket000000001'
		);
		expect(card('Steuer').classList.contains('paused')).toBe(true);
		expect(card('Steuer').querySelector('.card-meta')?.textContent).toContain('Pausiert');
		const more = within(rubbish).getByRole('button', {
			name: 'Weitere Aktionen für „Müll rausbringen“'
		});
		expect(rubbish.hasAttribute('data-menu-row')).toBe(true);
		const menu = document.getElementById(more.getAttribute('aria-controls') ?? '') as HTMLElement;
		expect(
			within(menu)
				.getAllByRole('menuitem', { hidden: true })
				.map((entry) => entry.textContent?.trim())
		).toEqual(['Regel öffnen', 'Zum offenen Ticket TASK-7', 'Pausieren', 'Löschen …', 'Schließen']);
	});

	it('opens the rule with a tap on the card; the key of an open ticket keeps its own tap', async () => {
		useWindow(true, true);
		await show();
		await fireEvent.click(card('Steuer').querySelector('.card-meta') as HTMLElement);
		expect(mocks.goto).toHaveBeenCalledWith('/wiederholungen/rule00000000003');
		mocks.goto.mockClear();
		await fireEvent.click(within(card('Müll rausbringen')).getByRole('link', { name: 'TASK-7' }));
		expect(mocks.goto).not.toHaveBeenCalled();
	});

	it('shows the row of the view: "Neue Regel" and "So funktioniert’s"', async () => {
		useWindow(true, true);
		const { view } = await show();
		const row = view.container.querySelector('.phone-tools') as HTMLElement;
		expect(within(row).getByRole('link', { name: 'Neue Regel' }).getAttribute('href')).toBe(
			'/wiederholungen/neu'
		);
		expect(within(row).getByRole('link', { name: 'So funktioniert’s' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Spalten' })).toBeNull();
	});
});

describe('the rule as a page (MO-7b)', () => {
	function showPanel(onback = vi.fn()) {
		const current = rule();
		const props = {
			rule: current,
			today: '2026-09-25',
			projects: [],
			tags: [],
			projectById: () => null,
			openTickets: [],
			ticketHrefOf: (id: string) => `/tickets/${id}` as ResolvedPathname,
			oncreatetag: vi.fn(async () => ({ ok: false as const, message: null })),
			onsave: vi.fn(async (): Promise<EditResult<RecurrenceRule>> => ({
				ok: true,
				value: current
			})),
			ontoggle: vi.fn(),
			ondelete: vi.fn(async (): Promise<EditResult<void>> => ({ ok: true, value: undefined })),
			onclose: vi.fn(),
			backLabel: 'Zu den Wiederholungen',
			onback
		};
		render(RecurrencePanel, { props });
		return props;
	}

	it('names the arrow after its way back and goes back through it', async () => {
		useWindow(true, true);
		const props = showPanel();
		await fireEvent.click(screen.getByRole('button', { name: 'Zu den Wiederholungen' }));
		expect(props.onback).toHaveBeenCalledOnce();
		expect(props.onclose).not.toHaveBeenCalled();
	});

	it('asks before the arrow drops typed input, then goes back', async () => {
		useWindow(true, true);
		const props = showPanel();
		await fireEvent.input(screen.getByLabelText('Titel'), { target: { value: 'Müll und Papier' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Zu den Wiederholungen' }));
		await tick();
		const question = screen.getByRole('dialog', { name: 'Änderungen verwerfen?' });
		expect(props.onback).not.toHaveBeenCalled();
		await fireEvent.click(within(question).getByRole('button', { name: 'Verwerfen' }));
		expect(props.onback).toHaveBeenCalledOnce();
	});

	it('puts the actions of the head into "•••" and leaves out the hint on keys', () => {
		useWindow(true, true);
		showPanel();
		const page = screen.getByRole('complementary');
		const head = page.querySelector('header') as HTMLElement;
		expect(within(head).queryByRole('button', { name: 'Löschen …' })).toBeNull();
		const more = within(head).getByRole('button', { name: 'Weitere Aktionen' });
		const menu = document.getElementById(more.getAttribute('aria-controls') ?? '') as HTMLElement;
		expect(
			within(menu)
				.getAllByRole('menuitem', { hidden: true })
				.map((entry) => entry.textContent?.trim())
		).toEqual(['Löschen …', 'Schließen']);
		expect(page.textContent).not.toMatch(/Strg/);
	});
});

describe('"Wiederholungen" outside the phone frame stays the table (MO-7b)', () => {
	it.each([
		['a PC with the switch on', false, true],
		['a phone with the switch off', true, false]
	])('keeps the table and the bar of the PC on %s', async (_name, narrow, enabled) => {
		useWindow(narrow, enabled);
		await show();
		expect(screen.getByRole('table')).toBeTruthy();
		expect(document.querySelectorAll('li[data-rule-row]')).toHaveLength(0);
		expect(screen.getByRole('button', { name: 'Spalten' })).toBeTruthy();
	});
});
