// The day plan in the phone frame (MO-2, ADR-0073 addendum MO-2) in jsdom with the real store on a
// fake server and a controlled matchMedia: an entry is "Haken · Titel · •••" (the check mark in a
// target of its own, no arrows, no handle), "Nach oben"/"Nach unten" move one level deeper into
// "•••" with the same steps and announcement, the plan comes first and the suggestions and the pool
// ("Hinzufügen …") follow it folded; days before stay read-only. The counter-checks: on a PC with
// the switch on and on a phone with the switch off the view stays as before. The layout itself
// (44 px, the title in the rest of the row, no sideways scrolling) is checked statically here and
// in a browser by tests/mobile/phone-frame.spec.mjs. Since MO-6b (ADR-0073 addendum MO-6b): the
// short date in the head, the sections open for an empty plan, and the chevron that the rule of
// "Öffnen" for touch screens no longer hits, outside the frame as well.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DayPlanAnswer, DayPlanItem } from '$lib/data/day-plan';
import { PHONE_QUERY } from '$lib/domain/phone-layout';
import type { TicketSummary } from '$lib/domain/ticket';
import { getMobileLayoutStore } from '$lib/mobile-layout.svelte';
import { DayPlanStore } from '$lib/stores/day-plan.svelte';
import { DayPlanSortStore } from '$lib/stores/day-plan-sort.svelte';
import {
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

const A1 = 't000000000000a1';
const A2 = 't000000000000a2';
const A3 = 't000000000000a3';
const A4 = 't000000000000a4';

/** A plan of today with a task and an ongoing project; one ticket due today and one more open. */
function standardTickets(): TicketSummary[] {
	return [
		planTicket(A1, { title: 'Steuer abgeben' }),
		planTicket(A2, { title: 'Spanisch lernen', kind: 'ongoing' }),
		planTicket(A3, { title: 'Müll rausbringen', due: TODAY }),
		planTicket(A4, { title: 'Fenster putzen' })
	];
}

function standardItems(): DayPlanItem[] {
	return [planItem('item00000000001', A1, 0), planItem('item00000000002', A2, 1)];
}

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

afterEach(() => {
	stop?.();
	stop = null;
	getMobileLayoutStore().choose(false);
	vi.unstubAllGlobals();
	localStorage.clear();
	mocks.page.url = new URL('http://localhost:3000/tagesplan');
});

async function renderPlan({
	answer = planAnswer(),
	date = null,
	sorting = new DayPlanSortStore(),
	items = standardItems()
}: {
	answer?: DayPlanAnswer;
	date?: string | null;
	sorting?: DayPlanSortStore;
	items?: DayPlanItem[];
} = {}) {
	mocks.page.url = new URL(
		date === null ? '/tagesplan' : `/tagesplan?tag=${date}`,
		'http://localhost:3000'
	);
	const data = fakeDayPlanData(items, answer, [A2]);
	const store = new DayPlanStore(data, fakeTickets(standardTickets()), fakeSession(), {
		flags: fakeFlags().flags,
		scope: () => answer.scope,
		viewer: () => null,
		sorting
	});
	store.show(date);
	await vi.waitFor(() => expect(store.state).toBe('ready'));
	render(TicketHostHarness, {
		props: { host: DAY_PLAN_HOST, component: DayPlanView, props: { store } }
	});
	await tick();
	return { store, data };
}

const entry = (key: string) => screen.getByText(key).closest('li') as HTMLElement;
const entryKeys = () =>
	[...document.querySelectorAll('[data-item-id] .key')].map((node) => node.textContent);
/** The visible parts of an entry, by their classes, without text for screen readers only. */
const partsOf = (key: string) =>
	[...entry(key).children]
		.filter((child) => !child.classList.contains('visually-hidden'))
		.map((child) => child.classList[0]);

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

const status = () => screen.getByRole('status', { hidden: true }).textContent ?? '';
const follows = (first: Element, second: Element) =>
	(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

describe('the day plan in the phone frame (MO-2)', () => {
	it('keeps only the hidden heading in the bar of the view, which takes no room (SectionBar, MO-3)', async () => {
		useWindow(true, true);
		await renderPlan();
		const heading = screen.getByRole('heading', { level: 2, name: 'Tagesplan' });
		expect(heading.classList.contains('visually-hidden')).toBe(true);
		expect(heading.closest('.section-bar')?.classList.contains('bare')).toBe(true);
	});

	it('shows each entry as "Haken · Titel · •••": the check mark in a target of its own, no arrows, no handle', async () => {
		useWindow(true, true);
		const { data } = await renderPlan();
		for (const key of ['TASK-a1', 'TASK-a2']) {
			expect(partsOf(key)).toEqual(['check-target', 'title-cell', 'actions']);
			expect(within(entry(key)).queryByRole('button', { name: `${key} nach oben` })).toBeNull();
			expect(within(entry(key)).queryByRole('button', { name: `${key} nach unten` })).toBeNull();
			expect(entry(key).querySelector('.handle')).toBeNull();
		}
		// The target is the label of the check mark; the name stays the one of the box.
		const check = screen.getByRole('checkbox', { name: 'TASK-a1 erledigt' });
		const target = check.closest('label') as HTMLElement;
		expect(target.classList.contains('check-target')).toBe(true);
		expect(target.textContent?.trim()).toBe('');
		// One tap on the target completes the task.
		await fireEvent.click(target);
		await vi.waitFor(() =>
			expect(data.check).toHaveBeenCalledWith('item00000000001', 'check', null)
		);
		expect(
			within(entry('TASK-a1')).getByRole('link', { name: 'Steuer abgeben' }).getAttribute('href')
		).toBe('/tagesplan/tickets/t000000000000a1');
	});

	it('moves through "•••" with "Nach oben" and "Nach unten", locked at the ends, and says so', async () => {
		useWindow(true, true);
		const { data } = await renderPlan();
		const first = menuOf('TASK-a1');
		expect(first.entries()).toEqual([
			'Nur für heute abhaken',
			'Auf morgen schieben',
			'Als laufendes Vorhaben markieren',
			'Nach oben',
			'Nach unten',
			'Entfernen',
			'Schließen'
		]);
		expect(first.entry('Nach oben').getAttribute('aria-disabled')).toBe('true');
		expect(first.entry('Nach unten').getAttribute('aria-disabled')).toBeNull();
		expect(menuOf('TASK-a2').entry('Nach unten').getAttribute('aria-disabled')).toBe('true');
		expect(menuOf('TASK-a2').entry('Nach oben').getAttribute('aria-disabled')).toBeNull();

		// A locked entry does nothing.
		await choose('TASK-a1', 'Nach oben');
		expect(data.move).not.toHaveBeenCalled();

		await choose('TASK-a1', 'Nach unten');
		await vi.waitFor(() => expect(data.move).toHaveBeenCalledWith('item00000000001', 1));
		await vi.waitFor(() => expect(entryKeys()).toEqual(['TASK-a2', 'TASK-a1']));
		expect(status()).toContain('TASK-a1 steht jetzt an Stelle 2 von 2.');
		// The focus stays on "•••" of the entry that moved.
		expect(document.activeElement).toBe(menuOf('TASK-a1').trigger);
	});

	it('keeps Alt+arrow for a keyboard in the frame', async () => {
		useWindow(true, true);
		const { data } = await renderPlan();
		const check = screen.getByRole('checkbox', { name: 'TASK-a2 für heute erledigt' });
		check.focus();
		await fireEvent.keyDown(check, { key: 'ArrowUp', altKey: true });
		await vi.waitFor(() => expect(data.move).toHaveBeenCalledWith('item00000000002', 0));
		await vi.waitFor(() => expect(entryKeys()).toEqual(['TASK-a2', 'TASK-a1']));
	});

	it('offers no moving in a sorted plan, also not in "•••"', async () => {
		useWindow(true, true);
		const sorting = new DayPlanSortStore();
		sorting.choose({ key: 'priority', direction: 'descending' });
		await renderPlan({ sorting });
		expect(menuOf('TASK-a1').entries()).not.toContain('Nach oben');
		expect(menuOf('TASK-a1').entries()).not.toContain('Nach unten');
	});

	it('puts the plan first; the suggestions follow it folded with their number, the pool folded as "Hinzufügen …"', async () => {
		useWindow(true, true);
		const { data } = await renderPlan();
		const plan = screen.getByRole('heading', { name: 'Plan' });
		const suggestions = screen.getByRole('button', { name: /^Vorschläge/ });
		expect(follows(plan, suggestions)).toBe(true);
		expect(suggestions.getAttribute('aria-expanded')).toBe('false');
		expect(suggestions.textContent).toContain('(1 Vorschlag)');
		const list = document.getElementById(suggestions.getAttribute('aria-controls') ?? '');
		expect(list?.hidden).toBe(true);
		await fireEvent.click(suggestions);
		expect(list?.hidden).toBe(false);
		expect(screen.getByText('– heute fällig')).toBeTruthy();

		// The pool: the section "Hinzufügen …" after the suggestions, folded, the same search and "+".
		expect(screen.queryByRole('heading', { name: 'Pool' })).toBeNull();
		const add = screen.getByRole('button', { name: 'Hinzufügen …' });
		expect(follows(suggestions, add)).toBe(true);
		expect(add.closest('h3')).not.toBeNull();
		expect(add.getAttribute('aria-expanded')).toBe('false');
		const body = document.getElementById(add.getAttribute('aria-controls') ?? '') as HTMLElement;
		expect(body.hidden).toBe(true);
		await fireEvent.click(add);
		expect(add.getAttribute('aria-expanded')).toBe('true');
		expect(body.hidden).toBe(false);
		const pool = within(screen.getByRole('region', { name: 'Hinzufügen …' }));
		expect(pool.getByText(/Mit „\+“ in den Plan aufnehmen\./)).toBeTruthy();
		expect(pool.queryByText(/ziehen/)).toBeNull();
		const tickets = pool.getAllByRole('listitem');
		expect(tickets.map((item) => item.querySelector('.key')?.textContent)).toEqual([
			'TASK-a3',
			'TASK-a4'
		]);
		// Nothing is dragged on a phone; a long press stays the browser's.
		for (const ticket of tickets) expect(ticket.getAttribute('draggable')).toBeNull();
		await fireEvent.input(pool.getByRole('searchbox', { name: 'Pool durchsuchen' }), {
			target: { value: 'fenster' }
		});
		await fireEvent.click(pool.getByRole('button', { name: 'TASK-a4 zum Tagesplan' }));
		await vi.waitFor(() =>
			expect(data.add).toHaveBeenCalledWith({ ticket: A4, scope: 'u:user00000000001', date: TODAY })
		);
		await vi.waitFor(() => expect(entryKeys()).toEqual(['TASK-a1', 'TASK-a2', 'TASK-a4']));
	});

	it('says how to add without dragging when nothing is planned', async () => {
		useWindow(true, true);
		const answer = planAnswer();
		const data = fakeDayPlanData([], answer, []);
		const store = new DayPlanStore(data, fakeTickets(standardTickets()), fakeSession(), {
			flags: fakeFlags().flags,
			scope: () => answer.scope,
			viewer: () => null,
			sorting: new DayPlanSortStore()
		});
		store.show(null);
		await vi.waitFor(() => expect(store.state).toBe('ready'));
		render(TicketHostHarness, {
			props: { host: DAY_PLAN_HOST, component: DayPlanView, props: { store } }
		});
		await tick();
		expect(screen.getByText('Noch nichts geplant')).toBeTruthy();
		expect(
			screen.getByText('Vorschläge übernehmen oder unter „Hinzufügen …“ mit „+“ aufnehmen.')
		).toBeTruthy();
	});

	it('keeps a day before read-only: no check mark to change, no menu, no pool, no suggestions', async () => {
		useWindow(true, true);
		await renderPlan({
			date: '2031-05-12',
			answer: planAnswer({ date: '2031-05-12', editable: false })
		});
		expect(screen.getByText('Vergangene Tage sind schreibgeschützt.')).toBeTruthy();
		const check = screen.getByRole<HTMLInputElement>('checkbox', { name: 'TASK-a1 erledigt' });
		expect(check.disabled).toBe(true);
		expect(screen.queryByRole('button', { name: /^Weitere Aktionen für / })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Hinzufügen …' })).toBeNull();
		expect(screen.queryByRole('button', { name: /^Vorschläge/ })).toBeNull();
	});
});

describe('the day plan outside the phone frame stays as before (MO-2)', () => {
	it.each([
		['a PC with the switch on', false, true],
		['a phone with the switch off', true, false]
	])(
		'shows arrows and handle in the row, the suggestions open before the plan and the pool on %s',
		async (_name, narrow, enabled) => {
			useWindow(narrow, enabled);
			await renderPlan();
			expect(partsOf('TASK-a1')).toEqual(['handle', 'check', 'title-cell', 'actions']);
			expect(
				within(entry('TASK-a1')).getByRole('button', { name: 'TASK-a1 nach oben' })
			).toBeTruthy();
			expect(document.querySelector('.check-target')).toBeNull();
			expect(menuOf('TASK-a1').entries()).toEqual([
				'Nur für heute abhaken',
				'Auf morgen schieben',
				'Als laufendes Vorhaben markieren',
				'Entfernen'
			]);
			const suggestions = screen.getByRole('button', { name: /^Vorschläge/ });
			expect(suggestions.getAttribute('aria-expanded')).toBe('true');
			expect(follows(suggestions, screen.getByRole('heading', { name: 'Plan' }))).toBe(true);
			const pool = screen.getByRole('heading', { name: 'Pool' });
			expect(pool.querySelector('button')).toBeNull();
			expect(screen.queryByRole('button', { name: 'Hinzufügen …' })).toBeNull();
			expect(screen.getByText(/Mit „\+“ aufnehmen oder auf den Plan ziehen\./)).toBeTruthy();
			const tickets = within(pool.closest('section') as HTMLElement).getAllByRole('listitem');
			for (const ticket of tickets) expect(ticket.getAttribute('draggable')).toBe('true');
		}
	);
});

const TOMORROW = '2031-05-15';
const suggestionsButton = () => screen.getByRole('button', { name: /^Vorschläge/ });
const addButton = () => screen.getByRole('button', { name: 'Hinzufügen …' });
const shownPart = (button: HTMLElement) =>
	document.getElementById(button.getAttribute('aria-controls') ?? '') as HTMLElement;

/** Loads the shown day again as a change of the area does, and waits until it stands. */
async function loadAgain(store: DayPlanStore) {
	store.rescope();
	expect(store.state).toBe('loading');
	await vi.waitFor(() => expect(store.state).toBe('ready'));
	await tick();
}

describe('the head and an empty plan in the phone frame (MO-6b)', () => {
	it('names the day short in the head and keeps the whole date for screen readers', async () => {
		useWindow(true, true);
		await renderPlan();
		const heading = screen.getByRole('heading', { name: 'Heute, Mittwoch, 14. Mai 2031' });
		expect(heading.querySelector('[aria-hidden="true"]')?.textContent).toBe('Heute, Mi., 14. Mai');
		expect(heading.querySelector('.visually-hidden')?.textContent).toBe(
			'Heute, Mittwoch, 14. Mai 2031'
		);
		// The announcement of another day reads the whole date as well.
		expect(heading.getAttribute('aria-live')).toBe('polite');
		cleanup();

		await renderPlan({ date: TOMORROW, answer: planAnswer({ date: TOMORROW }) });
		const tomorrow = screen.getByRole('heading', { name: 'Morgen, Donnerstag, 15. Mai 2031' });
		expect(tomorrow.querySelector('[aria-hidden="true"]')?.textContent).toBe(
			'Morgen, Do., 15. Mai'
		);
	});

	it('starts with the suggestions and "Hinzufügen …" open when the plan is empty; a first entry folds nothing', async () => {
		useWindow(true, true);
		const { data } = await renderPlan({ items: [] });
		expect(screen.getByText('Noch nichts geplant')).toBeTruthy();
		// The plan still comes first, then the suggestions and the pool, now open.
		expect(follows(screen.getByRole('heading', { name: 'Plan' }), suggestionsButton())).toBe(true);
		expect(suggestionsButton().getAttribute('aria-expanded')).toBe('true');
		expect(shownPart(suggestionsButton()).hidden).toBe(false);
		expect(screen.getByText('– heute fällig')).toBeTruthy();
		expect(addButton().getAttribute('aria-expanded')).toBe('true');
		expect(shownPart(addButton()).hidden).toBe(false);

		const pool = within(screen.getByRole('region', { name: 'Hinzufügen …' }));
		await fireEvent.click(pool.getByRole('button', { name: 'TASK-a4 zum Tagesplan' }));
		await vi.waitFor(() => expect(data.add).toHaveBeenCalled());
		await vi.waitFor(() => expect(entryKeys()).toEqual(['TASK-a4']));
		expect(suggestionsButton().getAttribute('aria-expanded')).toBe('true');
		expect(addButton().getAttribute('aria-expanded')).toBe('true');

		// Folding stays the choice of the user.
		await fireEvent.click(addButton());
		await fireEvent.click(suggestionsButton());
		expect(addButton().getAttribute('aria-expanded')).toBe('false');
		expect(suggestionsButton().getAttribute('aria-expanded')).toBe('false');
	});

	it('opens them when an empty day loads, also after folding; a day with entries starts folded', async () => {
		useWindow(true, true);
		const { store } = await renderPlan({ items: [] });
		await fireEvent.click(addButton());
		await fireEvent.click(suggestionsButton());
		expect(addButton().getAttribute('aria-expanded')).toBe('false');
		await loadAgain(store);
		expect(addButton().getAttribute('aria-expanded')).toBe('true');
		expect(suggestionsButton().getAttribute('aria-expanded')).toBe('true');
		cleanup();

		// With entries the sections start folded (MO-2); an empty day loaded later opens the pool,
		// the suggestions belong to today only.
		const planned = await renderPlan();
		expect(addButton().getAttribute('aria-expanded')).toBe('false');
		expect(suggestionsButton().getAttribute('aria-expanded')).toBe('false');
		planned.data.fetch.mockResolvedValueOnce({
			kind: 'ok',
			value: planAnswer({ date: TOMORROW, plan: null })
		});
		planned.store.show(TOMORROW);
		await vi.waitFor(() => expect(planned.store.state).toBe('ready'));
		await tick();
		expect(entryKeys()).toEqual([]);
		expect(addButton().getAttribute('aria-expanded')).toBe('true');
		expect(screen.queryByRole('button', { name: /^Vorschläge/ })).toBeNull();
	});
});

describe('the head and an empty plan outside the phone frame stay as before (MO-6b)', () => {
	it.each([
		['a PC with the switch on', false, true],
		['a phone with the switch off', true, false]
	])(
		'shows the whole date, the suggestions open as the user leaves them and the pool on %s',
		async (_name, narrow, enabled) => {
			useWindow(narrow, enabled);
			const { store } = await renderPlan({ items: [] });
			const heading = screen.getByRole('heading', { name: 'Heute, Mittwoch, 14. Mai 2031' });
			expect(heading.textContent?.trim()).toBe('Heute, Mittwoch, 14. Mai 2031');
			expect(heading.querySelector('[aria-hidden="true"], .visually-hidden')).toBeNull();
			expect(suggestionsButton().getAttribute('aria-expanded')).toBe('true');
			expect(screen.getByRole('heading', { name: 'Pool' })).toBeTruthy();
			expect(screen.queryByRole('button', { name: 'Hinzufügen …' })).toBeNull();
			// Folded by the user, the suggestions stay folded when the day loads again, as before.
			await fireEvent.click(suggestionsButton());
			await loadAgain(store);
			expect(suggestionsButton().getAttribute('aria-expanded')).toBe('false');
		}
	);
});

describe('the chevron of the suggestions on touch screens (MO-6b)', () => {
	const source = readFileSync(join(import.meta.dirname, 'DayPlanSuggestions.svelte'), 'utf8');

	/** Every selector of the rules for touch screens, `@media (pointer: coarse)`. */
	function touchSelectors(): string[] {
		const start = source.indexOf('@media (pointer: coarse) {');
		expect(start).toBeGreaterThan(-1);
		const block = source.slice(source.indexOf('{', start) + 1, source.indexOf('\n\t}', start));
		return [...block.matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap((match) =>
			(match[1] ?? '').split(',').map((selector) => selector.trim())
		);
	}

	it.each([
		['a PC with the switch on', false, true],
		['a phone with the switch off', true, false],
		['the phone frame', true, true]
	])(
		'turns the open chevron without the rule of "Öffnen" for touch screens on %s',
		async (_name, narrow, enabled) => {
			useWindow(narrow, enabled);
			await renderPlan();
			if (suggestionsButton().getAttribute('aria-expanded') !== 'true') {
				await fireEvent.click(suggestionsButton());
			}
			const chevron = suggestionsButton().querySelector('svg') as SVGElement;
			// Open, the chevron is turned by its class "open".
			expect(chevron.classList.contains('chevron')).toBe(true);
			expect(chevron.classList.contains('open')).toBe(true);
			const selectors = touchSelectors();
			expect(selectors).toEqual(['.choice', '.disclosure', '.open-ticket', '.open-ticket']);
			expect(selectors.filter((selector) => chevron.matches(selector))).toEqual([]);
			// "Öffnen" keeps its 44 px on touch screens.
			expect(screen.getByRole('link', { name: 'TASK-a3 öffnen' }).matches('.open-ticket')).toBe(
				true
			);
		}
	);
});

describe('styles of the day plan in the phone frame (MO-2)', () => {
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
		const head = `${FRAME} ${selector} {`;
		const at = block.indexOf(head);
		expect(at, `${file}: ${selector}`).toBeGreaterThan(-1);
		return block.slice(at + head.length, block.indexOf('}', at));
	}

	it('gives the check mark of an entry a target of 44 px and the title the rest of the row', () => {
		expect(rule('DayPlanList.svelte', '.entry')).toMatch(
			/display: grid;\s*grid-template-columns: auto minmax\(0, 1fr\) auto;/
		);
		const target = rule('DayPlanList.svelte', '.check-target');
		expect(target).toMatch(/min-width: var\(--control-height-touch\);/);
		expect(target).toMatch(/min-height: var\(--control-height-touch\);/);
		expect(rule('DayPlanList.svelte', '.title-cell')).toMatch(/grid-column: 2;/);
		// The initials of a household below the title, not beside it.
		expect(rule('DayPlanList.svelte', '.people')).toMatch(/grid-row: 2;\s*grid-column: 2;/);
		expect(rule('DayPlanList.svelte', '.actions')).toMatch(/grid-column: 3;/);
	});

	it('gives the folding headings and "Sortierung" 44 px, the chevron its own size and the head of the day the room of the hidden bar', () => {
		expect(rule('DayPlanSuggestions.svelte', '.disclosure')).toMatch(
			/min-height: var\(--control-height-touch\);/
		);
		// The turned chevron carries "open"; since MO-6b the rule of touch screens names "Öffnen" by a
		// class of its own, so the chevron keeps its size without a rule of the frame.
		expect(read('DayPlanSuggestions.svelte')).toMatch(
			/@media \(pointer: coarse\)[\s\S]*\.open-ticket \{/
		);
		expect(frameBlock(read('DayPlanSuggestions.svelte'))).not.toMatch(/\.chevron/);
		// The bar of the view holds only its hidden heading in the frame and takes no room (since MO-3
		// the rule of the bar itself for every view without controls in the frame, see below).
		expect(rule('../SectionBar.svelte', '.section-bar.bare')).toMatch(/position: absolute;/);
		expect(rule('DayPlanPool.svelte', '.disclosure')).toMatch(
			/min-height: var\(--control-height-touch\);/
		);
		expect(rule('DayPlanSort.svelte', '.sort-menu :global(.toggle)')).toMatch(
			/min-height: var\(--control-height-touch\);/
		);
		expect(rule('DayPlanView.svelte', '.day-nav')).toMatch(/flex: 1 1 100%;\s*min-width: 0;/);
		expect(rule('DayPlanView.svelte', '.day-title')).toMatch(/flex: 1;\s*min-width: 0;/);
	});
});
