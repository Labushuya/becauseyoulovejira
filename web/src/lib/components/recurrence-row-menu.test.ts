// The menu "•••" of a row of the overview "Wiederholungen" (plan aktionsmenues, AM-4): "Regel
// öffnen", the oldest open ticket, "Pausieren" or "Fortsetzen" (no longer a symbol of its own) and
// "Löschen …" with the question of the panel, which closes the panel of the rule and hands the
// focus on. A right click and Shift+F10 open the menu (AM-3); the keys of the open tickets keep
// the menu of the browser. Real stores on fake data layers, the shared overlay stubs; page state
// and navigation are mocked.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecurrenceRule } from '$lib/domain/recurrence-rule';
import type { TicketSummary } from '$lib/domain/ticket';
import { CatalogStore } from '$lib/stores/catalog.svelte';
import { FlagStore } from '$lib/stores/flags.svelte';
import { RecurrenceStore, type RecurrenceData } from '$lib/stores/recurrence.svelte';
import { TicketListStore } from '$lib/stores/ticket-list.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import RecurrencesView from './RecurrencesView.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: { url: new URL('http://localhost:3000/wiederholungen') }
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));

useOverlayStubs();

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

const WASTE = rule();
const PLANTS = rule({ id: 'rule00000000002', title: 'Blumen', nextDue: '2099-10-01' });
const TAX = rule({ id: 'rule00000000003', title: 'Steuer', active: false, nextDue: '2099-01-01' });

function instance(id: string, key: string, ruleId: string, created: string): TicketSummary {
	return {
		id,
		key,
		title: 'Serie',
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
		created,
		updated: created
	};
}

const OPEN = [
	instance('ticket000000001', 'TASK-7', WASTE.id, T0),
	instance('ticket000000002', 'TASK-9', PLANTS.id, '2026-09-03 10:00:00.000Z'),
	instance('ticket000000003', 'TASK-8', PLANTS.id, '2026-09-02 10:00:00.000Z')
];

async function show(props: { activeId?: string | null } = {}, data: Partial<RecurrenceData> = {}) {
	const session = { ensureValid: () => true, logout: vi.fn() };
	const flags = new FlagStore();
	const fake = {
		listRules: vi.fn(async () => [WASTE, PLANTS, TAX]),
		createRule: vi.fn(),
		updateRule: vi.fn(),
		setActive: vi.fn(async (id: string, active: boolean) => ({
			...[WASTE, PLANTS, TAX].find((entry) => entry.id === id)!,
			active,
			updated: '2026-09-02 10:00:00.000Z'
		})),
		deleteRule: vi.fn(async () => undefined),
		detachTicket: vi.fn(),
		...data
	} as RecurrenceData;
	const store = new RecurrenceStore(fake, session, flags);
	await store.load();
	const tickets = new TicketListStore(
		{
			listOpen: async () => OPEN,
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
	render(RecurrencesView, {
		props: { store, tickets, catalog, flags, activeId: props.activeId ?? null, creating: false }
	});
	await tick();
	return { store, flags, fake };
}

function menuButton(title: string): HTMLElement {
	return screen.getByRole('button', { name: `Weitere Aktionen für „${title}“` });
}

function menuOf(button: HTMLElement): HTMLElement {
	return document.getElementById(button.getAttribute('aria-controls') ?? '') as HTMLElement;
}

function labels(title: string): (string | undefined)[] {
	return within(menuOf(menuButton(title)))
		.getAllByRole('menuitem', { hidden: true })
		.map((entry) => entry.textContent?.trim());
}

function entry(title: string, name: string): HTMLElement {
	return within(menuOf(menuButton(title))).getByRole('menuitem', { name, hidden: true });
}

const isOpen = (title: string) => menuButton(title).getAttribute('aria-expanded') === 'true';

beforeEach(() => {
	mocks.goto.mockClear();
});

afterEach(() => {
	document.body.innerHTML = '';
});

describe('menu "•••" of a row of the rules (AM-4)', () => {
	it('offers the rule, its oldest open ticket, pausing or resuming and deleting', async () => {
		await show();
		expect(labels('Müll rausbringen')).toEqual([
			'Regel öffnen',
			'Zum offenen Ticket TASK-7',
			'Pausieren',
			'Löschen …'
		]);
		expect(entry('Müll rausbringen', 'Regel öffnen').getAttribute('href')).toBe(
			`/wiederholungen/${WASTE.id}`
		);
		expect(entry('Müll rausbringen', 'Zum offenen Ticket TASK-7').getAttribute('href')).toBe(
			'/tickets/ticket000000001'
		);
		// Several open tickets: the oldest one, named as such.
		expect(labels('Blumen')).toEqual([
			'Regel öffnen',
			'Zum ältesten offenen Ticket TASK-8',
			'Pausieren',
			'Löschen …'
		]);
		expect(labels('Steuer')).toEqual(['Regel öffnen', 'Fortsetzen', 'Löschen …']);
		expect(entry('Steuer', 'Löschen …').getAttribute('aria-haspopup')).toBe('dialog');
		expect(menuButton('Steuer').classList.contains('row-menu')).toBe(true);
	});

	it('pauses a rule from its menu with the flag of the store', async () => {
		const { fake, flags } = await show();
		await fireEvent.click(entry('Blumen', 'Pausieren'));

		await vi.waitFor(() => expect(fake.setActive).toHaveBeenCalledWith(PLANTS.id, false));
		await vi.waitFor(() =>
			expect(flags.flags.map((flag) => flag.title)).toEqual(['Regel pausiert.'])
		);
	});

	it('asks before deleting, names the open tickets and hands the focus to the next row', async () => {
		const { fake } = await show();
		await fireEvent.click(entry('Blumen', 'Löschen …'));
		await tick();

		const dialog = screen.getByRole('dialog', { name: 'Regel löschen?' });
		expect(dialog.textContent).toContain(
			'Bestehende Tickets bleiben erhalten. „Blumen“ erzeugt danach keine Tickets mehr; TASK-8, TASK-9 bleiben als normale Tickets offen.'
		);
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Löschen' }));

		await vi.waitFor(() => expect(fake.deleteRule).toHaveBeenCalledWith(PLANTS.id));
		await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
		await vi.waitFor(() =>
			expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Steuer' }))
		);
		expect(mocks.goto).not.toHaveBeenCalled();
	});

	it('closes the panel of a rule deleted from its row', async () => {
		await show({ activeId: TAX.id });
		await fireEvent.click(entry('Steuer', 'Löschen …'));
		await tick();
		const dialog = screen.getByRole('dialog', { name: 'Regel löschen?' });
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Löschen' }));

		await vi.waitFor(() => expect(mocks.goto).toHaveBeenCalledWith('/wiederholungen'));
	});

	it('opens the menu with a right click and Shift+F10; the keys of the tickets keep the browser menu', async () => {
		await show();
		const row = screen.getByRole('link', { name: 'Müll rausbringen' }).closest('tr') as HTMLElement;
		const state = row.querySelector('[data-col="state"]') as HTMLElement;

		expect(await fireEvent.contextMenu(state, { button: 2, clientX: 400, clientY: 120 })).toBe(
			false
		);
		await tick();
		expect(isOpen('Müll rausbringen')).toBe(true);
		expect(menuOf(menuButton('Müll rausbringen')).style.left).toBe('400px');
		await fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });

		const key = within(row).getByRole('link', { name: 'TASK-7' });
		expect(await fireEvent.contextMenu(key, { button: 2 })).toBe(true);

		const title = within(row).getByRole('link', { name: 'Müll rausbringen' });
		title.focus();
		expect(await fireEvent.keyDown(title, { key: 'F10', shiftKey: true })).toBe(false);
		await tick();
		expect(document.activeElement?.textContent?.trim()).toBe('Regel öffnen');
		await fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
		expect(document.activeElement).toBe(title);
	});
});
