// Route test of the overview "Wiederholungen" (E5 plan, T-6 and package 5): the table with the
// rule panel next to it under /wiederholungen/<id> and /wiederholungen/neu, creating, saving,
// pausing and deleting through the store with flags, and the ways back to the overview.
// Navigation, page state and the data layers are fakes; the stores are real.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecurrenceRule } from '$lib/domain/recurrence-rule';
import type { TicketSummary } from '$lib/domain/ticket';
import { CatalogStore } from '$lib/stores/catalog.svelte';
import { FlagStore } from '$lib/stores/flags.svelte';
import { RecurrenceStore, type RecurrenceData } from '$lib/stores/recurrence.svelte';
import { TicketListStore } from '$lib/stores/ticket-list.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import RecurrenceRouteHarness from '$lib/test/RecurrenceRouteHarness.svelte';

const T0 = '2026-09-01 10:00:00.000Z';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: {
		url: new URL('http://localhost:3000/wiederholungen'),
		params: {} as Record<string, string>,
		route: { id: '/(app)/wiederholungen' }
	},
	store: null as unknown,
	catalog: null as unknown,
	tickets: null as unknown,
	flags: null as unknown
}));

// The way back from a ticket (ADR-0054) and the question of the rule panel follow navigations.
vi.mock('$app/navigation', () => ({
	goto: mocks.goto,
	beforeNavigate: vi.fn(),
	afterNavigate: vi.fn()
}));
vi.mock('$app/state', () => ({ page: mocks.page }));
vi.mock('$lib/stores/recurrence.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getRecurrenceStore: () => mocks.store
}));
vi.mock('$lib/stores/catalog.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getCatalogStore: () => mocks.catalog
}));
vi.mock('$lib/stores/ticket-list.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getTicketListStore: () => mocks.tickets
}));
vi.mock('$lib/stores/flags.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getFlagStore: () => mocks.flags
}));
vi.mock('$lib/stores/inbox.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getInboxStore: () => ({ newCount: 0 })
}));

useOverlayStubs();

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

function instance(): TicketSummary {
	return {
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
}

/** Route IDs of the children: a rule, "Neue Regel", a ticket and its full view (ADR-0054). */
const CHILD_ROUTES = {
	neu: '/(app)/wiederholungen/neu',
	rule: '/(app)/wiederholungen/[id]',
	ticket: '/(app)/wiederholungen/tickets/[id]',
	full: '/(app)/wiederholungen/tickets/[id]/voll'
} as const;

async function show(
	path: string,
	child: keyof typeof CHILD_ROUTES | null = null,
	rules: RecurrenceRule[] | null = [rule()]
) {
	const url = new URL(path, 'http://localhost:3000');
	mocks.page.url = url;
	const id = /^\/wiederholungen\/(?:tickets\/)?([a-z0-9]{15})(?:\/voll)?$/.exec(url.pathname)?.[1];
	mocks.page.params = id ? { id } : {};
	mocks.page.route = { id: child === null ? '/(app)/wiederholungen' : CHILD_ROUTES[child] };
	const session = { ensureValid: () => true, logout: vi.fn() };
	const flags = new FlagStore();
	const data = {
		listRules: vi.fn(async () => rules),
		createRule: vi.fn<RecurrenceData['createRule']>(async (draft) =>
			rule({ id: 'rule00000000009', title: draft.title, weekdays: [...draft.weekdays] as never })
		),
		updateRule: vi.fn<RecurrenceData['updateRule']>(async (ruleId, patch) =>
			rule({
				id: ruleId,
				title: patch.title ?? 'Müll rausbringen',
				updated: '2026-09-02 10:00:00.000Z'
			})
		),
		setActive: vi.fn<RecurrenceData['setActive']>(async (ruleId, active) =>
			rule({ id: ruleId, active, updated: '2026-09-02 10:00:00.000Z' })
		),
		deleteRule: vi.fn<RecurrenceData['deleteRule']>(async () => undefined),
		detachTicket: vi.fn<RecurrenceData['detachTicket']>()
	} satisfies RecurrenceData;
	const store = new RecurrenceStore(data, session, flags);
	await store.load();
	const tickets = new TicketListStore(
		{
			listOpen: async () => [instance()],
			searchOpen: vi.fn(async (): Promise<string[]> => []),
			setDone: vi.fn(),
			update: vi.fn()
		},
		session
	);
	const catalog = new CatalogStore(
		{ listProjects: async () => [], listTags: async () => [], createTag: vi.fn() },
		session
	);
	await catalog.load();
	mocks.store = store;
	mocks.tickets = tickets;
	mocks.catalog = catalog;
	mocks.flags = flags;
	render(RecurrenceRouteHarness, { props: { child } });
	await vi.waitFor(() => expect(tickets.openState).toBe('ready'));
	await tick();
	return { data, flags, store };
}

const flagTitles = (flags: FlagStore) => flags.flags.map((flag) => flag.title);

beforeEach(() => {
	mocks.goto.mockClear();
	document.body.innerHTML = '';
});

describe('route /wiederholungen', () => {
	it('shows the table without a panel', async () => {
		await show('/wiederholungen');
		expect(screen.getByRole('heading', { level: 2, name: 'Wiederholungen' })).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Müll rausbringen' }).getAttribute('href')).toBe(
			'/wiederholungen/rule00000000001'
		);
		expect(screen.queryByRole('complementary')).toBeNull();
	});

	it('opens the panel of a rule next to the table and closes it back to the overview', async () => {
		await show('/wiederholungen/rule00000000001', 'rule');
		const panel = screen.getByRole('complementary', { name: 'Müll rausbringen' });
		expect(
			screen.getByRole('link', { name: 'Müll rausbringen' }).getAttribute('aria-current')
		).toBe('page');
		expect(within(panel).getByRole('link', { name: 'TASK-7' })).toBeTruthy();
		expect(document.title).toBe('Müll rausbringen · Wiederholungen · becauseyoulovejira');

		await fireEvent.click(within(panel).getByRole('button', { name: 'Panel schließen' }));
		expect(mocks.goto).toHaveBeenCalledWith('/wiederholungen');
	});

	it('saves the template and pauses the rule with flags', async () => {
		const { data, flags } = await show('/wiederholungen/rule00000000001', 'rule');
		const panel = screen.getByRole('complementary');
		await fireEvent.input(within(panel).getByLabelText('Titel'), {
			target: { value: 'Müll (gelb)' }
		});
		await fireEvent.click(within(panel).getByRole('button', { name: 'Speichern' }));
		await vi.waitFor(() => expect(flagTitles(flags)).toEqual(['Regel gespeichert.']));
		// The color of the template goes along once the server knows it (ADR-0052).
		expect(data.updateRule).toHaveBeenCalledWith('rule00000000001', {
			title: 'Müll (gelb)',
			description: '',
			project: null,
			tags: [],
			priority: 'medium',
			color: null
		});

		await fireEvent.click(within(panel).getByRole('button', { name: 'Pausieren' }));
		await vi.waitFor(() =>
			expect(flagTitles(flags)).toEqual(['Regel pausiert.', 'Regel gespeichert.'])
		);
		expect(within(panel).getByText('Pausiert')).toBeTruthy();
	});

	it('deletes the rule after the question and goes back to the overview', async () => {
		const { data, flags, store } = await show('/wiederholungen/rule00000000001', 'rule');
		await fireEvent.click(screen.getByRole('button', { name: 'Löschen …' }));
		const question = screen.getByRole('dialog', { name: 'Regel löschen?' });
		await fireEvent.click(within(question).getByRole('button', { name: 'Löschen' }));
		await vi.waitFor(() => expect(mocks.goto).toHaveBeenCalledWith('/wiederholungen'));
		expect(data.deleteRule).toHaveBeenCalledWith('rule00000000001');
		expect(store.rules).toEqual([]);
		expect(flagTitles(flags)).toEqual(['Regel gelöscht. Die Tickets bleiben erhalten.']);
		// Until the navigation the panel keeps the rule instead of "nicht gefunden".
		expect(screen.queryByText('Regel nicht gefunden')).toBeNull();
	});

	it('creates a rule under /wiederholungen/neu and switches to its panel in place', async () => {
		const { data, flags } = await show('/wiederholungen/neu', 'neu');
		const panel = screen.getByRole('complementary', { name: 'Neue Regel' });
		await fireEvent.input(within(panel).getByLabelText('Titel'), {
			target: { value: 'Blumen gießen' }
		});
		await fireEvent.click(within(panel).getByRole('button', { name: 'Anlegen' }));
		await vi.waitFor(() =>
			expect(mocks.goto).toHaveBeenCalledWith('/wiederholungen/rule00000000009', {
				replaceState: true
			})
		);
		expect(data.createRule).toHaveBeenCalledWith(
			expect.objectContaining({ title: 'Blumen gießen', mode: 'calendar', lead_days: 3 }),
			null
		);
		expect(flagTitles(flags)[0]).toMatch(/^Wiederholung angelegt: jeden /);
	});

	it('says that an unknown rule is not found', async () => {
		await show('/wiederholungen/rule00000000099', 'rule');
		expect(screen.getByRole('heading', { level: 2, name: 'Regel nicht gefunden' })).toBeTruthy();
	});

	it('explains neutrally before the migration, also in "Neue Regel"', async () => {
		await show('/wiederholungen/neu', 'neu', null);
		const panel = screen.getByRole('complementary', { name: 'Neue Regel' });
		expect(
			within(panel).getByText(/Wiederholungen sind nach dem nächsten Neustart verfügbar/)
		).toBeTruthy();
		expect(within(panel).queryByRole('button', { name: 'Anlegen' })).toBeNull();
	});
});

describe('route /wiederholungen: tickets in the rules (ADR-0054)', () => {
	const RULE = 'rule00000000001';
	const TICKET = 'ticket000000001';
	const ruleLink = () => screen.getByRole('link', { name: 'Müll rausbringen' });

	it('opens the open tickets of the table and of the rule panel in the rules', async () => {
		await show(`/wiederholungen/${RULE}`, 'rule');
		const panel = screen.getByRole('complementary', { name: 'Müll rausbringen' });
		expect(
			within(panel)
				.getByRole('link', { name: /TASK-7/ })
				.getAttribute('href')
		).toBe(`/wiederholungen/tickets/${TICKET}?von=${RULE}`);
		const table = screen.getByRole('table');
		const key = within(table).getByRole('link', { name: 'TASK-7' });
		expect(key.getAttribute('href')).toBe(`/wiederholungen/tickets/${TICKET}?von=${RULE}`);
		// The link names its ticket for the way back (KX-2).
		expect(key.getAttribute('data-ticket-link')).toBe(TICKET);
	});

	it('opens a ticket of the table without a rule panel as a deep link', async () => {
		await show('/wiederholungen');
		const table = screen.getByRole('table');
		expect(within(table).getByRole('link', { name: 'TASK-7' }).getAttribute('href')).toBe(
			`/wiederholungen/tickets/${TICKET}`
		);
	});

	it('shows a ticket instead of the rule panel and marks the rule it came from', async () => {
		await show(`/wiederholungen/tickets/${TICKET}?von=${RULE}`, 'ticket');
		expect(screen.getByRole('complementary', { name: 'Panel des Tickets' })).toBeTruthy();
		expect(screen.queryByRole('complementary', { name: 'Müll rausbringen' })).toBeNull();
		expect((document.querySelector('.view') as HTMLElement).dataset.panelMode).toBe('embedded');
		expect(ruleLink().getAttribute('aria-current')).toBe('page');
	});

	it('marks no rule for a deep link', async () => {
		await show(`/wiederholungen/tickets/${TICKET}`, 'ticket');
		expect(ruleLink().hasAttribute('aria-current')).toBe(false);
	});

	it('has no panel column while the full view of a ticket is shown (ADR-0036 §1)', async () => {
		await show(`/wiederholungen/tickets/${TICKET}/voll?von=${RULE}`, 'full');
		expect(document.querySelector('.view')?.hasAttribute('data-panel-mode')).toBe(false);
		expect(ruleLink().getAttribute('aria-current')).toBe('page');
	});
});
