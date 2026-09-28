// Overview "Wiederholungen" (E5 plan, T-6 and package 5): section bar with the switch and "Neue
// Regel", the rules active first, the open ticket from the list store, the empty state, the
// neutral hint before the migration, a load error with "Erneut versuchen", pausing a row with a
// refusal as error flag, and the focus after closing a panel or deleting a rule. The stores are
// real on fake data layers; page state is mocked.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { RecurrenceRule } from '$lib/domain/recurrence-rule';
import type { TicketSummary } from '$lib/domain/ticket';
import { CatalogStore } from '$lib/stores/catalog.svelte';
import { FlagStore } from '$lib/stores/flags.svelte';
import { RecurrenceStore, type RecurrenceData } from '$lib/stores/recurrence.svelte';
import { TicketListStore } from '$lib/stores/ticket-list.svelte';
import RecurrencesView from './RecurrencesView.svelte';

const mocks = vi.hoisted(() => ({
	page: { url: new URL('http://localhost:3000/wiederholungen') }
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

const RULES = [
	rule({ id: 'rule00000000003', title: 'Steuer', active: false, nextDue: '2099-01-01' }),
	rule({ id: 'rule00000000002', title: 'Blumen', nextDue: '2099-10-01' }),
	rule()
];

function instance(ruleId: string): TicketSummary {
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
		recurrenceId: ruleId,
		source: null,
		completedAt: null,
		created: T0,
		updated: T0
	};
}

function fakeData(rules: RecurrenceRule[] | null, overrides: Partial<RecurrenceData> = {}) {
	return {
		listRules: vi.fn(async () => rules),
		createRule: vi.fn(),
		updateRule: vi.fn(),
		setActive: vi.fn(async (id: string, active: boolean) => ({
			...(RULES.find((entry) => entry.id === id) ?? rule({ id })),
			active,
			updated: '2026-09-02 10:00:00.000Z'
		})),
		deleteRule: vi.fn(async () => undefined),
		detachTicket: vi.fn(),
		...overrides
	} as RecurrenceData;
}

async function show(
	rules: RecurrenceRule[] | null = RULES,
	props: Partial<{ activeId: string | null; creating: boolean }> = {},
	data: Partial<RecurrenceData> = {}
) {
	const session = { ensureValid: () => true, logout: vi.fn() };
	const flags = new FlagStore();
	const fake = fakeData(rules, data);
	const store = new RecurrenceStore(fake, session, flags);
	await store.load();
	const tickets = new TicketListStore(
		{
			listOpen: async () => [instance('rule00000000001')],
			listDone: async (page: number) => ({ items: [], page, hasMore: false }),
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
	const all = { store, tickets, catalog, flags, activeId: null, creating: false, ...props };
	const view = render(RecurrencesView, { props: all });
	await tick();
	return { view, props: all, store, flags, fake };
}

const titles = () =>
	within(screen.getByRole('table'))
		.getAllByRole('rowheader')
		.map((cell) => cell.textContent?.trim());

beforeEach(() => {
	document.body.innerHTML = '';
});

describe('RecurrencesView', () => {
	it('shows the switch, "Neue Regel" and the rules active first, then by next ticket', async () => {
		await show();
		expect(screen.getByRole('heading', { level: 2, name: 'Wiederholungen' })).toBeTruthy();
		const nav = screen.getByRole('navigation', { name: 'Ansicht' });
		expect(
			within(nav).getByRole('link', { name: 'Wiederholungen' }).getAttribute('aria-current')
		).toBe('page');
		expect(screen.getByText('3 Regeln')).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Neue Regel' }).getAttribute('href')).toBe(
			'/wiederholungen/neu'
		);
		expect(titles()).toEqual(['Müll rausbringen', 'Blumen', 'Steuer']);
		expect(screen.getByRole('link', { name: 'TASK-7' }).getAttribute('href')).toBe(
			'/tickets/ticket000000001'
		);
	});

	it('offers "Regel anlegen" without rules', async () => {
		await show([]);
		expect(screen.getByRole('heading', { name: 'Noch keine Wiederholungen' })).toBeTruthy();
		expect(
			screen.getByText('Lege eine an oder wähle an einem Ticket „Wiederholen…“.')
		).toBeTruthy();
		// Plan "Wiederholungen verständlich machen": the help with the examples, also when empty.
		expect(
			screen.getByRole('link', { name: 'So funktionieren Wiederholungen' }).getAttribute('href')
		).toBe('/einstellungen/hilfe#wiederholungen');
		expect(screen.getByRole('link', { name: 'So funktioniert’s' }).getAttribute('href')).toBe(
			'/einstellungen/hilfe#wiederholungen'
		);
		expect(screen.getByRole('link', { name: 'Regel anlegen' }).getAttribute('href')).toBe(
			'/wiederholungen/neu'
		);
		expect(screen.queryByRole('table')).toBeNull();
	});

	it('says neutrally when the rules come before the migration and offers no "Neue Regel"', async () => {
		await show(null);
		const hint = screen.getByText(/Wiederholungen sind nach dem nächsten Neustart verfügbar/);
		expect(hint.closest('[role="status"]')).toBeTruthy();
		expect(screen.getByText(/stop\.bat, dann start\.bat/)).toBeTruthy();
		expect(screen.queryByRole('link', { name: 'Neue Regel' })).toBeNull();
		expect(document.querySelector('.alert-error')).toBeNull();
	});

	it('shows a load error with "Erneut versuchen"', async () => {
		const listRules = vi
			.fn<RecurrenceData['listRules']>()
			.mockRejectedValueOnce(new DataError('network'))
			.mockResolvedValueOnce(RULES);
		await show(RULES, {}, { listRules });
		const alert = screen.getByRole('alert');
		await fireEvent.click(within(alert).getByRole('button', { name: 'Erneut versuchen' }));
		await vi.waitFor(() => expect(titles()).toEqual(['Müll rausbringen', 'Blumen', 'Steuer']));
	});

	it('pauses a row with a success flag and reports a refusal as an error flag', async () => {
		const setActive = vi
			.fn<RecurrenceData['setActive']>()
			.mockResolvedValueOnce({ ...RULES[1]!, active: false, updated: '2026-09-02 10:00:00.000Z' })
			.mockRejectedValueOnce(
				new DataError('validation', {
					status: 400,
					fields: {
						project: { code: 'validation_project_archived', message: 'Das Projekt ist archiviert.' }
					}
				})
			);
		const { flags } = await show(RULES, {}, { setActive });

		await fireEvent.click(screen.getByRole('button', { name: 'Pausieren: Blumen' }));
		await vi.waitFor(() =>
			expect(flags.flags.map((flag) => flag.title)).toEqual(['Regel pausiert.'])
		);
		// Paused rules follow the active ones, again by their next ticket.
		expect(titles()).toEqual(['Müll rausbringen', 'Steuer', 'Blumen']);

		await fireEvent.click(screen.getByRole('button', { name: 'Fortsetzen: Steuer' }));
		await vi.waitFor(() => expect(flags.flags).toHaveLength(2));
		expect(flags.flags[0]).toMatchObject({
			tone: 'error',
			title: '„Steuer“ ließ sich nicht fortsetzen.',
			description: 'Das Projekt ist archiviert.'
		});
	});

	it('returns the focus to the row of the closed panel', async () => {
		const { view, props } = await show(RULES, { activeId: 'rule00000000001' });
		await view.rerender({ ...props, activeId: null });
		await vi.waitFor(() =>
			expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Müll rausbringen' }))
		);
	});

	it('hands the focus to the next row after deleting a rule, else to the heading', async () => {
		// Rows: Müll rausbringen, Blumen, Steuer (paused).
		const { view, props, store } = await show(RULES, { activeId: 'rule00000000002' });
		await store.deleteRule('rule00000000002');
		await view.rerender({ ...props, activeId: null });
		await vi.waitFor(() =>
			expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Steuer' }))
		);

		await view.rerender({ ...props, activeId: 'rule00000000003' });
		(document.activeElement as HTMLElement).blur();
		await store.deleteRule('rule00000000003');
		await view.rerender({ ...props, activeId: null });
		// "Steuer" was last: the rule before it takes the focus.
		await vi.waitFor(() =>
			expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Müll rausbringen' }))
		);

		await view.rerender({ ...props, activeId: 'rule00000000001' });
		(document.activeElement as HTMLElement).blur();
		await store.deleteRule('rule00000000001');
		await view.rerender({ ...props, activeId: null });
		await vi.waitFor(() =>
			expect(document.activeElement).toBe(
				screen.getByRole('heading', { level: 2, name: 'Wiederholungen' })
			)
		);
	});

	it('returns the focus to "Neue Regel" when its panel closes without a rule', async () => {
		const { view, props } = await show(RULES, { creating: true });
		await view.rerender({ ...props, creating: false });
		await vi.waitFor(() =>
			expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Neue Regel' }))
		);
	});
});
