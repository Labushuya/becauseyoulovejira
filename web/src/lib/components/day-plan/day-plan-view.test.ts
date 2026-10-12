// The page "Tagesplan" (TP-1, ADR-0065) in jsdom with the real store on a fake server: the head with
// day, progress, the hint at the other area and the navigation over days; the suggestions with their
// reasons, "Übernehmen" and "Alle übernehmen"; the plan with its check marks per kind, the badge
// "Vorhaben", the menus, the order by buttons, by Alt+arrow and by dragging; the pool with its search,
// "+" and dragging into the plan; "Vorhaben abschließen …" and the question about open sub-tasks; days
// before read-only; the layout on a phone (44 px, the pool below the plan).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { DayPlanAnswer, DayPlanItem } from '$lib/data/day-plan';
import type { TicketSummary } from '$lib/domain/ticket';
import type { AreaStore } from '$lib/stores/area.svelte';
import { DayPlanStore } from '$lib/stores/day-plan.svelte';
import {
	SELF,
	TODAY,
	fakeDayPlanData,
	fakeFlags,
	fakeSession,
	fakeTickets,
	planAnswer,
	planItem,
	planTicket
} from '$lib/test/day-plan-fake';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import TicketHostHarness from '$lib/test/TicketHostHarness.svelte';
import { DAY_PLAN_HOST } from '$lib/ticket-host';
import { DRAG_ITEM, DRAG_TICKET } from './DayPlanList.svelte';
import DayPlanView from './DayPlanView.svelte';

useOverlayStubs();

const mocks = vi.hoisted(() => ({
	page: {
		url: new URL('http://localhost:3000/tagesplan'),
		params: {} as Record<string, string>,
		route: { id: '/(app)/tagesplan' }
	}
}));

vi.mock('$app/state', () => ({ page: mocks.page }));
vi.mock('$lib/auth.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	auth: { userId: 'user00000000001' }
}));
vi.mock('$lib/stores/people.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	findPeople: () => ({
		nameOf: (id: string) =>
			({ user00000000001: 'Anna Beispiel', user00000000002: 'Bert Beispiel' })[id] ?? null
	})
}));
// The members of the household as the directory of the layout gives them (E7-5, ADR-0068).
vi.mock('$lib/stores/assignees.svelte', async (importOriginal) => {
	const original = await importOriginal<typeof import('$lib/stores/assignees.svelte')>();
	const members = [
		{ id: 'user00000000001', name: 'Anna Beispiel', self: true },
		{ id: 'user00000000002', name: 'Bert Beispiel', self: false }
	];
	return {
		...original,
		findAssignees: () => original.fixedAssignees(members, 'user00000000001')
	};
});

const A1 = 't000000000000a1';
const A2 = 't000000000000a2';
const A3 = 't000000000000a3';
const A4 = 't000000000000a4';

/** A plan of today with a task and an ongoing project, and two more open tickets in the pool. */
function standardTickets(): TicketSummary[] {
	return [
		planTicket(A1, { title: 'Steuer abgeben', status: 'in_progress' }),
		planTicket(A2, { title: 'Spanisch lernen', kind: 'ongoing' }),
		planTicket(A3, { title: 'Müll rausbringen', due: TODAY }),
		planTicket(A4, { title: 'Fenster putzen' })
	];
}

function standardItems(): DayPlanItem[] {
	return [
		planItem('item00000000001', A1, 0),
		planItem('item00000000002', A2, 1, { origin: 'ongoing', addedBy: '' })
	];
}

interface Setup {
	tickets?: TicketSummary[];
	items?: DayPlanItem[];
	answer?: DayPlanAnswer;
	date?: string | null;
	area?: AreaStore | null;
	ongoing?: string[];
	/** The account that looks at the plan (source "Mir zugewiesen", ADR-0068 §8). */
	viewer?: string | null;
}

async function renderPlan({
	tickets = standardTickets(),
	items = standardItems(),
	answer = planAnswer(),
	date = null,
	area = null,
	ongoing = [A2],
	viewer = null
}: Setup = {}) {
	mocks.page.url = new URL(
		date === null ? '/tagesplan' : `/tagesplan?tag=${date}`,
		'http://localhost:3000'
	);
	const list = fakeTickets(tickets);
	const data = fakeDayPlanData(items, answer, ongoing);
	const { flags, last } = fakeFlags();
	const store = new DayPlanStore(data, list, fakeSession(), {
		flags,
		scope: () => answer.scope,
		viewer: () => viewer
	});
	store.show(date);
	await vi.waitFor(() => expect(store.state).toBe('ready'));
	render(TicketHostHarness, {
		props: { host: DAY_PLAN_HOST, component: DayPlanView, props: { store, area } }
	});
	await tick();
	return { store, data, list, last };
}

const entry = (key: string) => screen.getByText(key).closest('li') as HTMLElement;
const entryKeys = () =>
	[...document.querySelectorAll('[data-item-id] .key')].map((node) => node.textContent);

/** The menu "•••" of an entry and its entries. */
function menuOf(key: string) {
	const trigger = within(entry(key)).getByRole('button', { name: `Weitere Aktionen für ${key}` });
	const menu = document.getElementById(trigger.getAttribute('aria-controls') ?? '') as HTMLElement;
	return {
		trigger,
		entries: () =>
			within(menu)
				.getAllByRole('menuitem', { hidden: true })
				.map((item) => item.textContent?.trim()),
		entry: (name: string) => within(menu).getByRole('menuitem', { name, hidden: true })
	};
}

async function choose(key: string, name: string) {
	const menu = menuOf(key);
	menu.trigger.focus();
	await fireEvent.click(menu.trigger);
	await tick();
	await fireEvent.click(menu.entry(name));
	await tick();
}

/** A DataTransfer for the drag events of jsdom. */
function transfer() {
	const values = new Map<string, string>();
	return {
		get types() {
			return [...values.keys()];
		},
		setData: vi.fn((type: string, value: string) => void values.set(type, value)),
		getData: (type: string) => values.get(type) ?? '',
		setDragImage: vi.fn(),
		effectAllowed: 'all',
		dropEffect: 'none'
	};
}

/**
 * A drag event at `clientY` (jsdom has no DragEvent, and testing-library would leave the position
 * out): a mouse event with the DataTransfer of the test.
 */
async function drag(
	target: Element,
	type: 'dragover' | 'drop',
	dataTransfer: object,
	clientY: number
) {
	const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY });
	Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
	target.dispatchEvent(event);
	await tick();
}

/** Gives the entries of the plan boxes of 40 px from the top, as a browser lays them out. */
function layoutEntries() {
	document.querySelectorAll<HTMLElement>('[data-item-id]').forEach((node, index) => {
		node.getBoundingClientRect = () => ({ top: index * 40, height: 40 }) as DOMRect;
	});
}

afterEach(() => {
	mocks.page.url = new URL('http://localhost:3000/tagesplan');
});

describe('head of the day plan', () => {
	it('names the day, the progress and the way to the day before and after', async () => {
		await renderPlan({
			items: [planItem('item00000000001', A1, 0, { doneToday: true }), ...standardItems().slice(1)]
		});
		expect(screen.getByRole('heading', { level: 2, name: 'Tagesplan' })).toBeTruthy();
		expect(screen.getByRole('heading', { name: 'Heute, Mittwoch, 14. Mai 2031' })).toBeTruthy();
		expect(screen.getByText('1/2 erledigt').getAttribute('aria-hidden')).toBe('true');
		expect(screen.getByText('1 von 2 Einträgen erledigt')).toBeTruthy();
		const nav = within(screen.getByRole('navigation', { name: 'Tag des Plans' }));
		expect(nav.getByRole('link', { name: 'Vortag' }).getAttribute('href')).toBe(
			'/tagesplan?tag=2031-05-13'
		);
		expect(nav.getByRole('link', { name: 'Folgetag' }).getAttribute('href')).toBe(
			'/tagesplan?tag=2031-05-15'
		);
		expect(nav.queryByRole('link', { name: 'Heute' })).toBeNull();
		const view = within(screen.getByRole('navigation', { name: 'Ansicht' }));
		expect(view.getByRole('link', { name: 'Tagesplan' }).getAttribute('aria-current')).toBe('page');
	});

	it('plans tomorrow with no further day, and goes back to today', async () => {
		await renderPlan({
			date: '2031-05-15',
			items: [],
			answer: planAnswer({
				date: '2031-05-15',
				plan: {
					id: 'plan00000000002',
					date: '2031-05-15',
					scope: 'u:user00000000001',
					dismissed: []
				}
			})
		});
		expect(screen.getByRole('heading', { name: 'Morgen, Donnerstag, 15. Mai 2031' })).toBeTruthy();
		const nav = within(screen.getByRole('navigation', { name: 'Tag des Plans' }));
		expect(nav.queryByRole('link', { name: 'Folgetag' })).toBeNull();
		expect(nav.getByRole('link', { name: 'Heute' }).getAttribute('href')).toBe('/tagesplan');
		expect(nav.getByRole('link', { name: 'Vortag' }).getAttribute('href')).toBe(
			'/tagesplan?tag=2031-05-14'
		);
		// Suggestions are for today only; the pool is there to plan.
		expect(screen.queryByRole('button', { name: /Vorschläge/ })).toBeNull();
		expect(screen.getByRole('heading', { name: 'Pool' })).toBeTruthy();
		expect(screen.getByText('Noch nichts geplant')).toBeTruthy();
	});

	it('keeps a day before read-only: no check mark to change, no menu, no pool, no suggestions', async () => {
		await renderPlan({
			date: '2031-05-12',
			answer: planAnswer({ date: '2031-05-12', editable: false })
		});
		expect(screen.getByText('Vergangene Tage sind schreibgeschützt.')).toBeTruthy();
		const check = screen.getByRole<HTMLInputElement>('checkbox', { name: 'TASK-a1 erledigt' });
		expect(check.disabled).toBe(true);
		expect(screen.queryByRole('button', { name: /Weitere Aktionen/ })).toBeNull();
		expect(screen.queryByRole('heading', { name: 'Pool' })).toBeNull();
		expect(screen.queryByRole('button', { name: /Vorschläge/ })).toBeNull();
		expect(document.querySelector('[draggable="true"]')).toBeNull();
	});

	it('hints at the plan of the other area with the way to switch, never its content', async () => {
		const select = vi.fn();
		const area = {
			visible: true,
			active: 'private',
			household: { id: 'house0000000001', name: 'Haus Beispiel' },
			select
		} as unknown as AreaStore;
		await renderPlan({
			area,
			answer: planAnswer({ other: { scope: 'h:house0000000001', count: 3, done: 1 } })
		});
		expect(screen.getByText('Im Haushalt: 3 Einträge für heute')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Zum Haushalt Haus Beispiel' }));
		expect(select).toHaveBeenCalledWith('household');
	});

	it('says that the day plan comes with the next restart', async () => {
		const list = fakeTickets([]);
		const data = fakeDayPlanData();
		data.fetch.mockResolvedValueOnce({ kind: 'missing' } as never);
		const store = new DayPlanStore(data, list, fakeSession());
		store.show(null);
		await vi.waitFor(() => expect(store.state).toBe('missing'));
		render(DayPlanView, { props: { store } });
		expect(screen.getByText(/nach dem nächsten Neustart verfügbar/)).toBeTruthy();
	});
});

describe('suggestions', () => {
	it('lists the suggestions with their reasons, adopts chosen ones and all', async () => {
		const { data } = await renderPlan({
			tickets: [
				...standardTickets(),
				planTicket('t000000000000a5', { title: 'Arzt anrufen', due: '2031-05-11' })
			]
		});
		const toggle = screen.getByRole('button', { name: /^Vorschläge/ });
		expect(toggle.getAttribute('aria-expanded')).toBe('true');
		expect(toggle.textContent).toContain('(2 Vorschläge)');
		expect(screen.getByText('– heute fällig')).toBeTruthy();
		expect(screen.getByText('– überfällig seit 11.05.')).toBeTruthy();
		// A ticket in the plan is no suggestion, though it is "in Arbeit".
		expect(screen.queryByText('– in Arbeit')).toBeNull();
		const adopt = screen.getByRole('button', { name: 'Übernehmen' });
		expect(adopt.getAttribute('aria-disabled')).toBe('true');
		await fireEvent.click(screen.getByRole('checkbox', { name: /Müll rausbringen/ }));
		await fireEvent.click(screen.getByRole('button', { name: 'Übernehmen (1)' }));
		await vi.waitFor(() => expect(data.adopt).toHaveBeenCalledWith('u:user00000000001', [A3]));
		await vi.waitFor(() => expect(entryKeys()).toContain('TASK-a3'));
		await fireEvent.click(screen.getByRole('button', { name: 'Alle übernehmen' }));
		await vi.waitFor(() =>
			expect(data.adopt).toHaveBeenLastCalledWith('u:user00000000001', ['t000000000000a5'])
		);
		await vi.waitFor(() => expect(screen.getByText('Keine Vorschläge für heute.')).toBeTruthy());
	});

	it('folds and unfolds with its heading', async () => {
		await renderPlan();
		const toggle = screen.getByRole('button', { name: /^Vorschläge/ });
		const list = document.getElementById(toggle.getAttribute('aria-controls') ?? '') as HTMLElement;
		await fireEvent.click(toggle);
		expect(toggle.getAttribute('aria-expanded')).toBe('false');
		expect(list.hidden).toBe(true);
		await fireEvent.click(toggle);
		expect(list.hidden).toBe(false);
	});

	it('sets the mode of a source of the area', async () => {
		const { data } = await renderPlan();
		const select = screen.getByRole<HTMLSelectElement>('combobox', {
			name: 'In Arbeit',
			hidden: true
		});
		expect(select.value).toBe('suggest');
		await fireEvent.change(select, { target: { value: 'off' } });
		await vi.waitFor(() =>
			expect(data.saveSettings).toHaveBeenCalledWith('u:user00000000001', { in_progress: 'off' })
		);
		expect(screen.getByText(/Gilt für deinen privaten Tagesplan/, { exact: false })).toBeTruthy();
	});
});

describe('entries of the plan', () => {
	it('names the check mark by the kind and shows the badge "Vorhaben"', async () => {
		await renderPlan();
		expect(screen.getByRole('checkbox', { name: 'TASK-a1 erledigt' })).toBeTruthy();
		expect(screen.getByRole('checkbox', { name: 'TASK-a2 für heute erledigt' })).toBeTruthy();
		expect(
			within(entry('TASK-a2')).getByText('Vorhaben').closest('.kind-badge')?.getAttribute('title')
		).toBe('Laufendes Vorhaben');
		expect(within(entry('TASK-a1')).queryByText('Vorhaben')).toBeNull();
		const link = within(entry('TASK-a1')).getByRole('link', { name: 'Steuer abgeben' });
		expect(link.getAttribute('href')).toBe('/tagesplan/tickets/t000000000000a1');
	});

	it('completes a task with its check mark and checks an ongoing project for the day only', async () => {
		const { data, last } = await renderPlan();
		await fireEvent.click(screen.getByRole('checkbox', { name: 'TASK-a1 erledigt' }));
		await vi.waitFor(() =>
			expect(data.check).toHaveBeenCalledWith('item00000000001', 'check', null)
		);
		await vi.waitFor(() => expect(last()?.title).toBe('TASK-a1 erledigt.'));
		await vi.waitFor(() =>
			expect(
				screen.getByRole<HTMLInputElement>('checkbox', { name: 'TASK-a1 erledigt' }).checked
			).toBe(true)
		);
		await fireEvent.click(screen.getByRole('checkbox', { name: 'TASK-a2 für heute erledigt' }));
		await vi.waitFor(() => expect(last()?.title).toBe('TASK-a2 für heute abgehakt.'));
		expect(screen.getByText('2/2 erledigt')).toBeTruthy();
	});

	it('offers the other way and the kind in the menu of each entry', async () => {
		await renderPlan();
		expect(menuOf('TASK-a1').entries()).toEqual([
			'Nur für heute abhaken',
			'Auf morgen schieben',
			'Als laufendes Vorhaben markieren',
			'Entfernen'
		]);
		expect(menuOf('TASK-a2').entries()).toEqual([
			'Vorhaben abschließen …',
			'Auf morgen schieben',
			'Als Aufgabe markieren',
			'Entfernen'
		]);
	});

	it('runs "Nur für heute abhaken", "Auf morgen schieben", the kind and "Entfernen"', async () => {
		const { data } = await renderPlan();
		await choose('TASK-a1', 'Nur für heute abhaken');
		await vi.waitFor(() =>
			expect(data.check).toHaveBeenCalledWith('item00000000001', 'today', null)
		);
		await choose('TASK-a1', 'Als laufendes Vorhaben markieren');
		await vi.waitFor(() => expect(data.setKind).toHaveBeenCalledWith(A1, 'ongoing'));
		await choose('TASK-a2', 'Auf morgen schieben');
		await vi.waitFor(() => expect(data.tomorrow).toHaveBeenCalledWith('item00000000002'));
		await vi.waitFor(() => expect(entryKeys()).toEqual(['TASK-a1']));
		await choose('TASK-a1', 'Entfernen');
		await vi.waitFor(() => expect(data.remove).toHaveBeenCalledWith('item00000000001'));
		await vi.waitFor(() => expect(screen.getByText('Noch nichts geplant')).toBeTruthy());
	});

	it('asks before "Vorhaben abschließen" and completes the project only then', async () => {
		const { data } = await renderPlan();
		await choose('TASK-a2', 'Vorhaben abschließen …');
		const dialog = await screen.findByRole('dialog', { name: 'TASK-a2 abschließen?' });
		expect(within(dialog).getByText(/Spanisch lernen/)).toBeTruthy();
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
		expect(data.check).not.toHaveBeenCalled();
		await choose('TASK-a2', 'Vorhaben abschließen …');
		await fireEvent.click(
			within(await screen.findByRole('dialog', { name: 'TASK-a2 abschließen?' })).getByRole(
				'button',
				{
					name: 'Abschließen'
				}
			)
		);
		await vi.waitFor(() =>
			expect(data.check).toHaveBeenCalledWith('item00000000002', 'complete', null)
		);
	});

	it('asks about open blocking sub-tasks like the list', async () => {
		const { data } = await renderPlan();
		data.check.mockRejectedValueOnce(
			new DataError('validation', {
				status: 400,
				fields: {
					status: {
						code: 'validation_parent_open_children',
						message: 'x',
						params: { count: 1, keys: ['TASK-9'] }
					}
				}
			})
		);
		await fireEvent.click(screen.getByRole('checkbox', { name: 'TASK-a1 erledigt' }));
		const dialog = await screen.findByRole('dialog', { name: 'TASK-a1 erledigen?' });
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Erledigen' }));
		await vi.waitFor(() =>
			expect(data.check).toHaveBeenLastCalledWith('item00000000001', 'check', 'complete_children')
		);
	});

	it('shows in a household who added and who checked an entry, as initials with the names', async () => {
		const shared = planAnswer({
			scope: 'h:house0000000001',
			plan: { id: 'plan00000000001', date: TODAY, scope: 'h:house0000000001', dismissed: [] }
		});
		await renderPlan({
			answer: shared,
			items: [
				planItem('item00000000001', A1, 0, {
					addedBy: SELF,
					doneToday: true,
					checkedBy: 'user00000000002'
				})
			]
		});
		const people = entry('TASK-a1').querySelector('.people') as HTMLElement;
		expect(people.getAttribute('title')).toBe('Hinzugefügt von Du, abgehakt von Bert Beispiel');
		expect(people.textContent).toContain('✓ BB');
	});
});

describe('"Zuständig" in the day plan (E7-5, ADR-0068 §8)', () => {
	const HOUSE = 'h:house0000000001';
	const shared = () =>
		planAnswer({
			scope: HOUSE,
			plan: { id: 'plan00000000001', date: TODAY, scope: HOUSE, dismissed: [] }
		});

	it('shows the initials of the assignee at the entries of the shared plan', async () => {
		await renderPlan({
			answer: shared(),
			tickets: [
				planTicket(A1, { title: 'Steuer abgeben', assignee: 'user00000000002' }),
				planTicket(A3, { title: 'Müll rausbringen' })
			],
			items: [planItem('item00000000001', A1, 0), planItem('item00000000003', A3, 1)]
		});
		const badge = entry('TASK-a1').querySelector('.assignee-badge');
		expect(badge?.getAttribute('title')).toBe('Zuständig: Bert Beispiel');
		expect(badge?.querySelector('.initials')?.textContent).toBe('BB');
		expect(entry('TASK-a3').querySelector('.assignee-badge')).toBeNull();
	});

	it('shows no initials in the private plan', async () => {
		await renderPlan({
			tickets: [planTicket(A1, { title: 'Steuer abgeben', assignee: 'user00000000002' })],
			items: [planItem('item00000000001', A1, 0)]
		});
		expect(entry('TASK-a1').querySelector('.assignee-badge')).toBeNull();
	});

	it('suggests what is given to the account that looks at the plan, with its reason', async () => {
		await renderPlan({
			answer: shared(),
			viewer: SELF,
			items: [],
			tickets: [
				planTicket(A1, { title: 'Steuer abgeben', assignee: SELF }),
				planTicket(A4, { title: 'Fenster putzen', assignee: 'user00000000002' })
			]
		});
		const toggle = screen.getByRole('button', { name: /^Vorschläge/ });
		expect(toggle.textContent).toContain('(1 Vorschlag)');
		expect(screen.getByText('– dir zugewiesen')).toBeTruthy();
		expect(screen.getByRole('checkbox', { name: /Steuer abgeben/ })).toBeTruthy();
		expect(screen.queryByRole('checkbox', { name: /Fenster putzen/ })).toBeNull();
	});

	it('offers the source "Mir zugewiesen" only in the household', async () => {
		await renderPlan({ answer: shared(), viewer: SELF });
		expect(
			screen.getByRole<HTMLSelectElement>('combobox', { name: 'Mir zugewiesen', hidden: true })
				.value
		).toBe('suggest');

		document.body.innerHTML = '';
		await renderPlan({ viewer: SELF });
		expect(screen.queryByRole('combobox', { name: 'Mir zugewiesen', hidden: true })).toBeNull();
	});
});

describe('order of the plan', () => {
	it('moves with "nach oben" and "nach unten", the first and last locked', async () => {
		const { data } = await renderPlan();
		const up = within(entry('TASK-a1')).getByRole('button', { name: 'TASK-a1 nach oben' });
		expect(up.getAttribute('aria-disabled')).toBe('true');
		expect(
			within(entry('TASK-a2'))
				.getByRole('button', { name: 'TASK-a2 nach unten' })
				.getAttribute('aria-disabled')
		).toBe('true');
		await fireEvent.click(
			within(entry('TASK-a1')).getByRole('button', { name: 'TASK-a1 nach unten' })
		);
		await vi.waitFor(() => expect(data.move).toHaveBeenCalledWith('item00000000001', 1));
		await vi.waitFor(() => expect(entryKeys()).toEqual(['TASK-a2', 'TASK-a1']));
		expect(screen.getByRole('status', { hidden: true }).textContent).toContain(
			'TASK-a1 steht jetzt an Stelle 2 von 2.'
		);
	});

	it('moves with Alt+arrow from any control of the entry and keeps the focus there', async () => {
		const { data } = await renderPlan();
		const check = screen.getByRole('checkbox', { name: 'TASK-a2 für heute erledigt' });
		check.focus();
		await fireEvent.keyDown(check, { key: 'ArrowUp', altKey: true });
		await vi.waitFor(() => expect(data.move).toHaveBeenCalledWith('item00000000002', 0));
		await vi.waitFor(() => expect(entryKeys()).toEqual(['TASK-a2', 'TASK-a1']));
		expect(document.activeElement).toBe(
			screen.getByRole('checkbox', { name: 'TASK-a2 für heute erledigt' })
		);
		await fireEvent.keyDown(check, { key: 'ArrowUp' });
		expect(data.move).toHaveBeenCalledTimes(1);
	});

	it('moves an entry by dragging it at its handle', async () => {
		const { data } = await renderPlan();
		layoutEntries();
		const dataTransfer = transfer();
		const handle = entry('TASK-a2').querySelector('.handle') as HTMLElement;
		expect(handle.getAttribute('draggable')).toBe('true');
		await fireEvent.dragStart(handle, { dataTransfer });
		expect(dataTransfer.setData).toHaveBeenCalledWith(DRAG_ITEM, 'item00000000002');
		const plan = screen.getByRole('group', { name: 'Einträge des Plans' });
		await drag(plan, 'dragover', dataTransfer, 5);
		expect(entry('TASK-a1').classList.contains('drop-before')).toBe(true);
		await drag(plan, 'drop', dataTransfer, 5);
		await vi.waitFor(() => expect(data.move).toHaveBeenCalledWith('item00000000002', 0));
		expect(entry('TASK-a1').classList.contains('drop-before')).toBe(false);
	});
});

describe('pool', () => {
	it('lists the open tickets outside the plan with a search and "+"', async () => {
		const { data } = await renderPlan();
		const pool = within(
			screen.getByRole('heading', { name: 'Pool' }).closest('section') as HTMLElement
		);
		expect(
			pool.getAllByRole('listitem').map((item) => item.querySelector('.key')?.textContent)
		).toEqual(['TASK-a3', 'TASK-a4']);
		await fireEvent.input(pool.getByRole('searchbox', { name: 'Pool durchsuchen' }), {
			target: { value: 'fenster' }
		});
		expect(
			pool.getAllByRole('listitem').map((item) => item.querySelector('.key')?.textContent)
		).toEqual(['TASK-a4']);
		await fireEvent.click(pool.getByRole('button', { name: 'TASK-a4 zum Tagesplan' }));
		await vi.waitFor(() =>
			expect(data.add).toHaveBeenCalledWith({ ticket: A4, scope: 'u:user00000000001', date: TODAY })
		);
		await vi.waitFor(() => expect(entryKeys()).toEqual(['TASK-a1', 'TASK-a2', 'TASK-a4']));
		await vi.waitFor(() => expect(pool.getByText('Kein Ticket passt zu „fenster“.')).toBeTruthy());
	});

	it('drops a ticket of the pool at a place of the plan', async () => {
		const { data } = await renderPlan();
		layoutEntries();
		const dataTransfer = transfer();
		const ticket = document.querySelector('[data-pool-ticket="t000000000000a3"]') as HTMLElement;
		expect(ticket.getAttribute('draggable')).toBe('true');
		await fireEvent.dragStart(ticket, { dataTransfer });
		expect(dataTransfer.setData).toHaveBeenCalledWith(DRAG_TICKET, A3);
		const plan = screen.getByRole('group', { name: 'Einträge des Plans' });
		await drag(plan, 'dragover', dataTransfer, 45);
		expect(entry('TASK-a2').classList.contains('drop-before')).toBe(true);
		await drag(plan, 'drop', dataTransfer, 45);
		await vi.waitFor(() =>
			expect(data.add).toHaveBeenCalledWith({
				ticket: A3,
				scope: 'u:user00000000001',
				date: TODAY,
				index: 1
			})
		);
	});
});

describe('sub-tasks with their parent (TP-2)', () => {
	const PARENT = 't000000000000p1';
	const IN_PLAN = 't000000000000s1';
	const IN_POOL = 't000000000000s2';
	const DUE = 't000000000000s3';
	const parentRef = { id: PARENT, key: 'HAUS-7', title: 'Wochenputz' };
	const parentHref = `/tagesplan/tickets/${PARENT}`;

	/** A normal ticket and a parent with three sub-tasks: one in the plan, one due today, one more. */
	function subtaskTickets(): TicketSummary[] {
		const sub = { parentId: PARENT, parentRef };
		return [
			planTicket(A1, { title: 'Steuer abgeben' }),
			planTicket(PARENT, { key: 'HAUS-7', title: 'Wochenputz' }),
			planTicket(IN_PLAN, { key: 'HAUS-8', title: 'Fenster putzen', ...sub }),
			planTicket(IN_POOL, { key: 'HAUS-9', title: 'Bad putzen', ...sub }),
			planTicket(DUE, { key: 'HAUS-10', title: 'Böden wischen', due: TODAY, ...sub })
		];
	}

	const subtaskItems = () => [
		planItem('item00000000001', A1, 0),
		planItem('item00000000002', IN_PLAN, 1)
	];

	/** The line of context of a sub-task within `root`: its visible text, link and hidden text. */
	function contextIn(root: Element) {
		const line = root.querySelector<HTMLElement>('[data-subtask-path]');
		if (line === null) return null;
		const visible = line.cloneNode(true) as HTMLElement;
		for (const hidden of visible.querySelectorAll('.visually-hidden')) hidden.remove();
		return {
			line,
			visible: visible.textContent?.replace(/\s+/g, ' ').trim(),
			hidden: line.querySelector('.visually-hidden')?.textContent,
			link: within(line).queryByRole('link'),
			tooltip: line.querySelector('.path-title')?.getAttribute('title')
		};
	}

	const pool = () =>
		screen.getByRole('heading', { name: 'Pool' }).closest('section') as HTMLElement;

	it('names the parent above the title of a sub-task in the plan; its key opens it', async () => {
		await renderPlan({ tickets: subtaskTickets(), items: subtaskItems(), ongoing: [] });

		const sub = entry('HAUS-8');
		const context = contextIn(sub)!;
		expect(context.visible).toBe('HAUS-7 › Wochenputz');
		expect(context.hidden).toBe('Unteraufgabe von HAUS-7 Wochenputz:');
		expect(context.tooltip).toBe('Wochenputz');
		// The key opens the parent next to the plan, as the title links open their tickets.
		expect(context.link?.textContent).toBe('HAUS-7');
		expect(context.link?.getAttribute('href')).toBe(parentHref);
		expect(context.link?.getAttribute('data-ticket-link')).toBe(PARENT);
		const title = within(sub).getByRole('link', { name: 'Fenster putzen' });
		expect(title.getAttribute('href')).toBe(`/tagesplan/tickets/${IN_PLAN}`);
		// Above the title: first in the cell of the title, before the key and title of the sub-task.
		expect(context.line.parentElement?.firstElementChild).toBe(context.line);
		expect(
			context.line.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
		// The rest of the entry stays as it was; a ticket without a parent has no line.
		expect(screen.getByRole('checkbox', { name: 'HAUS-8 erledigt' })).toBeTruthy();
		expect(contextIn(entry('TASK-a1'))).toBeNull();
		// No grouping by parent: the order of the plan stays (E2).
		expect(entryKeys()).toEqual(['TASK-a1', 'HAUS-8']);
	});

	it('names the parent of a sub-task in the pool whose parent is in the plan, and nothing at the parent', async () => {
		await renderPlan({
			tickets: subtaskTickets(),
			items: [...subtaskItems(), planItem('item00000000003', PARENT, 2)],
			ongoing: []
		});

		// The parent is in the plan, so its sub-tasks stand alone in the pool (TP-3).
		expect(
			within(pool())
				.getAllByRole('listitem')
				.map((item) => item.querySelector('.key')?.textContent)
		).toEqual(['HAUS-9', 'HAUS-10']);
		const sub = pool().querySelector(`[data-pool-ticket="${IN_POOL}"]`) as HTMLElement;
		const context = contextIn(sub)!;
		expect(context.visible).toBe('HAUS-7 › Wochenputz');
		expect(context.hidden).toBe('Unteraufgabe von HAUS-7 Wochenputz:');
		expect(context.link?.getAttribute('href')).toBe(parentHref);
		expect(sub.classList.contains('nested')).toBe(false);
		expect(within(sub).getByRole('button', { name: 'HAUS-9 zum Tagesplan' })).toBeTruthy();
		expect(contextIn(document.querySelector('[data-item-id="item00000000003"]')!)).toBeNull();
	});

	it('names the parent of a suggested sub-task outside the name of its check box', async () => {
		const { data } = await renderPlan({
			tickets: subtaskTickets(),
			items: subtaskItems(),
			ongoing: []
		});

		const box = screen.getByRole('checkbox', {
			name: (name) => name.startsWith('HAUS-10 Böden wischen') && !name.includes('HAUS-7')
		});
		const row = box.closest('li') as HTMLElement;
		const context = contextIn(row)!;
		expect(context.visible).toBe('HAUS-7 › Wochenputz');
		expect(context.hidden).toBe('Unteraufgabe von HAUS-7 Wochenputz:');
		expect(context.link?.getAttribute('href')).toBe(parentHref);
		expect(context.line.closest('label')).toBeNull();
		// Suggestions may hold sub-tasks: adopted like any other ticket, at the end of the plan (E2).
		await fireEvent.click(box);
		await fireEvent.click(screen.getByRole('button', { name: 'Übernehmen (1)' }));
		await vi.waitFor(() => expect(data.adopt).toHaveBeenCalledWith('u:user00000000001', [DUE]));
		await vi.waitFor(() => expect(entryKeys()).toEqual(['TASK-a1', 'HAUS-8', 'HAUS-10']));
		expect(contextIn(entry('HAUS-10'))?.visible).toBe('HAUS-7 › Wochenputz');
	});

	it('follows a renamed parent live', async () => {
		const { list } = await renderPlan({
			tickets: subtaskTickets(),
			items: subtaskItems(),
			ongoing: []
		});

		list.map.set(PARENT, planTicket(PARENT, { key: 'HAUS-7', title: 'Frühjahrsputz' }));
		await tick();
		expect(contextIn(entry('HAUS-8'))?.visible).toBe('HAUS-7 › Frühjahrsputz');
		expect(contextIn(entry('HAUS-8'))?.hidden).toBe('Unteraufgabe von HAUS-7 Frühjahrsputz:');
	});

	it('shows "…" without a link for an unknown parent and the loaded one outside the list', async () => {
		const GONE = 't000000000000g1';
		const MOVED = 't000000000000p2';
		await renderPlan({
			tickets: [
				planTicket(A1, { title: 'Steuer abgeben' }),
				planTicket(IN_PLAN, {
					key: 'HAUS-8',
					title: 'Fenster putzen',
					parentId: GONE,
					parentRef: null
				}),
				planTicket(IN_POOL, {
					key: 'HAUS-9',
					title: 'Bad putzen',
					parentId: MOVED,
					parentRef: { id: MOVED, key: 'HAUS-3', title: 'Umzug' }
				})
			],
			items: subtaskItems(),
			ongoing: []
		});

		const unknown = contextIn(entry('HAUS-8'))!;
		expect(unknown.visible).toBe('… ›');
		expect(unknown.hidden).toBe('Unteraufgabe von …:');
		expect(unknown.link).toBeNull();
		// Nothing else breaks: the entry opens, checks and moves as before.
		expect(within(entry('HAUS-8')).getByRole('link', { name: 'Fenster putzen' })).toBeTruthy();
		expect(screen.getByRole('checkbox', { name: 'HAUS-8 erledigt' })).toBeTruthy();
		expect(within(entry('HAUS-8')).getByRole('button', { name: 'HAUS-8 nach oben' })).toBeTruthy();
		// A parent outside the open tickets of the list (done, say) comes with the sub-task.
		const loaded = contextIn(pool().querySelector(`[data-pool-ticket="${IN_POOL}"]`)!)!;
		expect(loaded.visible).toBe('HAUS-3 › Umzug');
		expect(loaded.link?.getAttribute('href')).toBe(`/tagesplan/tickets/${MOVED}`);
	});

	it('gives the line a row of its own that may shrink, so nothing scrolls sideways', () => {
		const read = (name: string) => readFileSync(join(import.meta.dirname, name), 'utf8');
		// Plan and pool: the line stands first in the cell of the title, a wrapping row that shrinks.
		for (const file of ['DayPlanList.svelte', 'DayPlanPool.svelte']) {
			expect(read(file), file).toMatch(
				/\.title-cell\s*\{[^}]*flex: 1;[^}]*flex-wrap: wrap;[^}]*min-width: 0;/
			);
		}
		// Suggestions: the row wraps, the line takes all of it, in line with the title.
		const suggestions = read('DayPlanSuggestions.svelte');
		expect(suggestions).toMatch(/\.suggestion\s*\{[^}]*flex-wrap: wrap;[^}]*min-width: 0;/);
		expect(suggestions).toMatch(
			/\.parent-line\s*\{[^}]*flex: 1 1 100%;[^}]*min-width: 0;[^}]*padding-left: 1\.5rem;/
		);
	});
});

describe('sub-tasks below their parent (TP-3)', () => {
	const PARENT = 't000000000000p1';
	const S1 = 't000000000000s1';
	const S2 = 't000000000000s2';
	const S3 = 't000000000000s3';
	const DONE_SUB = 't000000000000s4';
	const OTHER = 't000000000000p2';
	const OTHER_SUB = 't000000000000s5';
	const parentRef = { id: PARENT, key: 'HAUS-7', title: 'Wochenputz' };

	/**
	 * In the order of the list: a sub-task before its parent, a normal ticket, the parent
	 * "Wochenputz" (in Arbeit) with three open sub-tasks (one due today) and a done one, and a second
	 * parent with one sub-task.
	 */
	function familyTickets(): TicketSummary[] {
		const sub = { parentId: PARENT, parentRef };
		return [
			planTicket(S2, { key: 'HAUS-9', title: 'Bad putzen', ...sub }),
			planTicket(A1, { title: 'Steuer abgeben' }),
			planTicket(PARENT, { key: 'HAUS-7', title: 'Wochenputz', status: 'in_progress' }),
			planTicket(S1, { key: 'HAUS-8', title: 'Fenster putzen', ...sub }),
			planTicket(S3, { key: 'HAUS-10', title: 'Böden wischen', due: TODAY, ...sub }),
			planTicket(DONE_SUB, { key: 'HAUS-11', title: 'Müll trennen', status: 'done', ...sub }),
			planTicket(OTHER, { key: 'HAUS-20', title: 'Umzug' }),
			planTicket(OTHER_SUB, {
				key: 'HAUS-21',
				title: 'Kisten packen',
				parentId: OTHER,
				parentRef: { id: OTHER, key: 'HAUS-20', title: 'Umzug' }
			})
		];
	}

	const pool = () =>
		screen.getByRole('heading', { name: 'Pool' }).closest('section') as HTMLElement;
	const poolItem = (id: string) =>
		pool().querySelector<HTMLElement>(`[data-pool-ticket="${id}"]`) as HTMLElement;
	const planEntry = (id: string) =>
		document.querySelector<HTMLElement>(`[data-item-id="${id}"]`) as HTMLElement;
	/** Keys of a list, indented ones with two blanks before. */
	const shapeOf = (items: Iterable<HTMLElement>) =>
		[...items].map(
			(item) =>
				`${item.classList.contains('nested') ? '  ' : ''}${item.querySelector('.key')?.textContent}`
		);
	const poolRows = () => shapeOf(pool().querySelectorAll<HTMLElement>('[data-pool-ticket]'));
	const planRows = () => shapeOf(document.querySelectorAll<HTMLElement>('[data-item-id]'));
	const suggestionRows = () => shapeOf(document.querySelectorAll<HTMLElement>('li.suggestion'));
	const searchFor = (value: string) =>
		fireEvent.input(within(pool()).getByRole('searchbox', { name: 'Pool durchsuchen' }), {
			target: { value }
		});
	const chipOf = (root: Element) =>
		root.querySelector('.progress-chip [aria-hidden="true"]')?.textContent ?? null;
	/** The visible line of context of a sub-task (TP-2), null without one. */
	function contextOf(root: Element): string | null {
		const line = root.querySelector<HTMLElement>('[data-subtask-path]');
		if (line === null) return null;
		const visible = line.cloneNode(true) as HTMLElement;
		for (const hidden of visible.querySelectorAll('.visually-hidden')) hidden.remove();
		return visible.textContent?.replace(/\s+/g, ' ').trim() ?? '';
	}
	/** Indented like a row of the table: the corner, the parent for screen readers, no line. */
	function expectIndented(root: Element, parentKey: string) {
		expect(root.classList.contains('nested')).toBe(true);
		expect(root.querySelector('.nest-icon')?.getAttribute('aria-hidden')).toBe('true');
		expect(root.querySelector('.title-cell, .choice')?.textContent).toContain(
			`Unteraufgabe von ${parentKey}:`
		);
		expect(root.querySelector('[data-subtask-path]')).toBeNull();
	}

	it('arranges the pool like "Aufgaben": the parent, directly below it its sub-tasks, with the chip', async () => {
		const { data } = await renderPlan({ tickets: familyTickets(), items: [], ongoing: [] });

		expect(poolRows()).toEqual([
			'TASK-a1',
			'HAUS-7',
			'  HAUS-9',
			'  HAUS-8',
			'  HAUS-10',
			'HAUS-20',
			'  HAUS-21'
		]);
		expectIndented(poolItem(S1), 'HAUS-7');
		expectIndented(poolItem(OTHER_SUB), 'HAUS-20');
		// The corner stands before the key, like before the title in the table.
		const corner = poolItem(S1).querySelector('.nest-icon') as Element;
		expect(
			corner.compareDocumentPosition(poolItem(S1).querySelector('.key')!) &
				Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
		// The chip of the table at each parent: done and all of its sub-tasks, the done one too.
		const chip = poolItem(PARENT).querySelector('.progress-chip');
		expect(chip?.getAttribute('title')).toBe('1 von 4 Unteraufgaben erledigt');
		expect(chipOf(poolItem(PARENT))).toBe('1/4');
		expect(chipOf(poolItem(OTHER))).toBe('0/1');
		expect(chipOf(poolItem(A1))).toBeNull();
		expect(chipOf(poolItem(S1))).toBeNull();
		// A sub-task still goes into the plan on its own, by "+" or by dragging.
		expect(poolItem(S1).getAttribute('draggable')).toBe('true');
		await fireEvent.click(
			within(poolItem(S1)).getByRole('button', { name: 'HAUS-8 zum Tagesplan' })
		);
		await vi.waitFor(() =>
			expect(data.add).toHaveBeenCalledWith({ ticket: S1, scope: 'u:user00000000001', date: TODAY })
		);
		await vi.waitFor(() => expect(planRows()).toEqual(['HAUS-8']));
		expect(poolRows()).toEqual([
			'TASK-a1',
			'HAUS-7',
			'  HAUS-9',
			'  HAUS-10',
			'HAUS-20',
			'  HAUS-21'
		]);
	});

	it('shows the first 60 tickets of the pool in whole blocks: a parent counts with its sub-tasks', async () => {
		const singles = Array.from({ length: 58 }, (_, index) =>
			planTicket(`t0000000000${String(index).padStart(4, '0')}`, { title: `Einzeln ${index}` })
		);
		const family = familyTickets().filter((ticket) => [PARENT, S1, S2, S3].includes(ticket.id));
		await renderPlan({ tickets: [...singles, ...family], items: [], ongoing: [] });

		// 58 single tickets and a block of four: the block would make 62 and stays out as a whole.
		expect(poolRows()).toHaveLength(58);
		expect(poolItem(PARENT)).toBeNull();
		expect(within(pool()).getByText('4 weitere – die Suche grenzt ein.')).toBeTruthy();
		await searchFor('wochenputz');
		expect(poolRows()).toEqual(['HAUS-7', '  HAUS-9', '  HAUS-8', '  HAUS-10']);
		expect(within(pool()).queryByText(/weitere – die Suche grenzt ein/)).toBeNull();
	});

	it('finds sub-tasks over key or title of their parent, the words spread over both', async () => {
		await renderPlan({ tickets: familyTickets(), items: [], ongoing: [] });

		const search = within(pool()).getByRole('searchbox', { name: 'Pool durchsuchen' });
		expect(search.getAttribute('placeholder')).toBe('Key, Titel oder Hauptticket');
		// A hit on the parent brings its open sub-tasks along: they match over the parent, too.
		await searchFor('wochenputz');
		expect(poolRows()).toEqual(['HAUS-7', '  HAUS-9', '  HAUS-8', '  HAUS-10']);
		await searchFor('haus-20');
		expect(poolRows()).toEqual(['HAUS-20', '  HAUS-21']);
		// Every word somewhere: only the sub-task has both, so it stands alone with its line.
		await searchFor('wochenputz fenster');
		expect(poolRows()).toEqual(['HAUS-8']);
		expect(contextOf(poolItem(S1))).toBe('HAUS-7 › Wochenputz');
		// Its own key and title find a sub-task as before.
		await searchFor('kisten');
		expect(poolRows()).toEqual(['HAUS-21']);
		await searchFor('haus-8');
		expect(poolRows()).toEqual(['HAUS-8']);
	});

	it('searches a renamed parent by its new title and never the fallback "…" of an unknown one', async () => {
		const ORPHAN = 't000000000000s9';
		const { list } = await renderPlan({
			tickets: [
				...familyTickets(),
				planTicket(ORPHAN, {
					key: 'HAUS-30',
					title: 'Waise',
					parentId: 't000000000000g1',
					parentRef: null
				})
			],
			items: [],
			ongoing: []
		});

		await searchFor('frühjahrsputz');
		expect(within(pool()).getByText('Kein Ticket passt zu „frühjahrsputz“.')).toBeTruthy();
		// Only the parent changes in the list; its sub-tasks are the same objects as before.
		list.map.set(
			PARENT,
			planTicket(PARENT, { key: 'HAUS-7', title: 'Frühjahrsputz', status: 'in_progress' })
		);
		await tick();
		expect(poolRows()).toEqual(['HAUS-7', '  HAUS-9', '  HAUS-8', '  HAUS-10']);
		await searchFor('wochenputz');
		expect(within(pool()).getByText('Kein Ticket passt zu „wochenputz“.')).toBeTruthy();
		await searchFor('…');
		expect(within(pool()).getByText('Kein Ticket passt zu „…“.')).toBeTruthy();
		await searchFor('waise');
		expect(poolRows()).toEqual(['HAUS-30']);
		expect(contextOf(poolItem(ORPHAN))).toBe('… ›');
	});

	it('arranges the suggestions; choosing a parent chooses none of its sub-tasks; adopts in that order', async () => {
		const { data } = await renderPlan({
			tickets: [...familyTickets(), planTicket(A3, { title: 'Müll rausbringen', due: TODAY })],
			items: [],
			ongoing: []
		});

		// By the rules: TASK-a3 and HAUS-10 due today, then HAUS-7 in Arbeit; shown like "Aufgaben".
		expect(suggestionRows()).toEqual(['TASK-a3', 'HAUS-7', '  HAUS-10']);
		const sub = screen.getByRole<HTMLInputElement>('checkbox', {
			name: /^Unteraufgabe von HAUS-7: HAUS-10 Böden wischen/
		});
		expectIndented(sub.closest('li') as HTMLElement, 'HAUS-7');
		const parent = screen.getByRole<HTMLInputElement>('checkbox', { name: /^HAUS-7 Wochenputz/ });
		expect(chipOf(parent.closest('li') as HTMLElement)).toBe('1/4');
		expect(chipOf(sub.closest('li') as HTMLElement)).toBeNull();
		await fireEvent.click(parent);
		expect(parent.checked).toBe(true);
		expect(sub.checked).toBe(false);
		expect(screen.getByRole('button', { name: 'Übernehmen (1)' })).toBeTruthy();
		// Chosen in another order, they go into the plan in the order shown.
		await fireEvent.click(sub);
		await fireEvent.click(screen.getByRole('checkbox', { name: /^TASK-a3 Müll rausbringen/ }));
		await fireEvent.click(screen.getByRole('button', { name: 'Übernehmen (3)' }));
		await vi.waitFor(() =>
			expect(data.adopt).toHaveBeenCalledWith('u:user00000000001', [A3, PARENT, S3])
		);
		await vi.waitFor(() => expect(planRows()).toEqual(['TASK-a3', 'HAUS-7', '  HAUS-10']));
	});

	it('keeps a suggested sub-task alone with its line when its parent is no suggestion', async () => {
		await renderPlan({
			tickets: familyTickets().map((ticket) =>
				ticket.id === PARENT ? { ...ticket, status: 'open' as const } : ticket
			),
			items: [],
			ongoing: []
		});

		expect(suggestionRows()).toEqual(['HAUS-10']);
		const row = document.querySelector('li.suggestion') as HTMLElement;
		expect(contextOf(row)).toBe('HAUS-7 › Wochenputz');
		expect(row.querySelector('.nest-icon')).toBeNull();
	});

	it('indents a sub-task in the plan below its parent or an indented sibling; order and moving stay', async () => {
		const { data } = await renderPlan({
			tickets: familyTickets(),
			items: [
				planItem('item00000000001', PARENT, 0),
				planItem('item00000000002', S1, 1),
				planItem('item00000000003', S2, 2),
				planItem('item00000000004', A1, 3),
				planItem('item00000000005', S3, 4)
			],
			ongoing: []
		});

		// The order of the plan stays; only the display follows it.
		expect(planRows()).toEqual(['HAUS-7', '  HAUS-8', '  HAUS-9', 'TASK-a1', 'HAUS-10']);
		expectIndented(planEntry('item00000000002'), 'HAUS-7');
		expectIndented(planEntry('item00000000003'), 'HAUS-7');
		// Away from its parent a sub-task names it above its title (TP-2).
		expect(contextOf(planEntry('item00000000005'))).toBe('HAUS-7 › Wochenputz');
		expect(chipOf(planEntry('item00000000001'))).toBe('1/4');
		expect(chipOf(planEntry('item00000000004'))).toBeNull();
		// Check mark, buttons and menu of an indented entry stay as they were.
		const sub = planEntry('item00000000002');
		expect(screen.getByRole('checkbox', { name: 'HAUS-8 erledigt' })).toBeTruthy();
		expect(within(sub).getByRole('button', { name: 'Weitere Aktionen für HAUS-8' })).toBeTruthy();
		// Moved up to its siblings, the sub-task is indented there; only its place is stored.
		await fireEvent.click(
			within(planEntry('item00000000005')).getByRole('button', { name: 'HAUS-10 nach oben' })
		);
		await vi.waitFor(() => expect(data.move).toHaveBeenCalledWith('item00000000005', 3));
		await vi.waitFor(() =>
			expect(planRows()).toEqual(['HAUS-7', '  HAUS-8', '  HAUS-9', '  HAUS-10', 'TASK-a1'])
		);
		// Dragged to the end, the parent leaves its sub-tasks: they stand alone with their line.
		layoutEntries();
		const dataTransfer = transfer();
		await fireEvent.dragStart(planEntry('item00000000001').querySelector('.handle') as Element, {
			dataTransfer
		});
		const plan = screen.getByRole('group', { name: 'Einträge des Plans' });
		await drag(plan, 'dragover', dataTransfer, 500);
		await drag(plan, 'drop', dataTransfer, 500);
		await vi.waitFor(() => expect(data.move).toHaveBeenCalledWith('item00000000001', 4));
		await vi.waitFor(() =>
			expect(planRows()).toEqual(['HAUS-8', 'HAUS-9', 'HAUS-10', 'TASK-a1', 'HAUS-7'])
		);
		expect(contextOf(planEntry('item00000000002'))).toBe('HAUS-7 › Wochenputz');
		expect(contextOf(planEntry('item00000000003'))).toBe('HAUS-7 › Wochenputz');
	});

	it('indents with a margin of the whole entry, so nothing scrolls sideways on a phone', () => {
		const read = (name: string) => readFileSync(join(import.meta.dirname, name), 'utf8');
		expect(read('DayPlanList.svelte')).toMatch(/\.entry\.nested\s*\{\s*margin-left: 1\.5rem;\s*\}/);
		expect(read('DayPlanPool.svelte')).toMatch(
			/\.ticket\.nested\s*\{\s*margin-left: 1\.5rem;\s*\}/
		);
		expect(read('DayPlanSuggestions.svelte')).toMatch(
			/\.suggestion\.nested\s*\{\s*padding-left: 1\.5rem;\s*\}/
		);
		// The entries are items of a grid of one column that is never wider than the list, and they
		// may shrink: indented ones stay inside its width.
		const lists: [file: string, list: string, item: string][] = [
			['DayPlanList.svelte', 'entries', 'entry'],
			['DayPlanPool.svelte', 'tickets', 'ticket'],
			['DayPlanSuggestions.svelte', 'list', 'suggestion']
		];
		for (const [file, list, item] of lists) {
			const source = read(file);
			expect(source, file).toMatch(
				new RegExp(
					`\\.${list}\\s*\\{\\s*display: grid;\\s*grid-template-columns: minmax\\(0, 1fr\\);`
				)
			);
			expect(source, file).toMatch(new RegExp(`\\.${item}\\s*\\{[^}]*min-width: 0;`));
		}
	});
});

describe('on a phone', () => {
	const read = (name: string) => readFileSync(join(import.meta.dirname, name), 'utf8');

	it('gives every target 44 px and puts the pool below the plan', () => {
		for (const file of [
			'DayPlanList.svelte',
			'DayPlanPool.svelte',
			'DayPlanView.svelte',
			'DayPlanSuggestions.svelte'
		]) {
			expect(read(file), file).toMatch(/@media \(pointer: coarse\)[\s\S]*--control-height-touch/);
		}
		// Side by side only from 60rem; below one column: the pool after the plan.
		expect(read('DayPlanView.svelte')).toMatch(
			/@media \(min-width: 60rem\)\s*\{\s*\.day-grid\.with-pool/
		);
		expect(read('DayPlanView.svelte')).toMatch(
			/\.day-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/
		);
		// Dragging is for the mouse; on a phone "+" and the buttons are the way.
		expect(read('DayPlanList.svelte')).toMatch(
			/@media \(pointer: coarse\)[\s\S]*\.handle\s*\{\s*display: none;/
		);
	});
});
