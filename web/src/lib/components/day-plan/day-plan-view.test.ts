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
}

async function renderPlan({
	tickets = standardTickets(),
	items = standardItems(),
	answer = planAnswer(),
	date = null,
	area = null,
	ongoing = [A2]
}: Setup = {}) {
	mocks.page.url = new URL(
		date === null ? '/tagesplan' : `/tagesplan?tag=${date}`,
		'http://localhost:3000'
	);
	const list = fakeTickets(tickets);
	const data = fakeDayPlanData(items, answer, ongoing);
	const { flags, last } = fakeFlags();
	const store = new DayPlanStore(data, list, fakeSession(), { flags, scope: () => answer.scope });
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
