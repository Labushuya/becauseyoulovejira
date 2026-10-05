// Component tests for the compact list of the open tickets of a project (ADR-0034, addendum
// "Offene Tickets in Projekten"; plan projekte-tickets): a named list with key and title as one
// link, status, priority and due date; at most ten, then "Alle N in Aufgaben öffnen"; a ticket
// opens in the remembered way in the projects (ADR-0054), with the state of the project view and
// the project panel it replaces; empty, loading and failed; the menu "•••" of the ticket rows with
// its context menu; the focus when the focused entry leaves; the own pins of the project first
// (ADR-0064). Page state is mocked; the open-mode, row-action and pin stores run for real on fakes.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TicketPin } from '$lib/domain/pins';
import type { Ticket, TicketSummary } from '$lib/domain/ticket';
import { FlagStore } from '$lib/stores/flags.svelte';
import { TicketOpenModeStore } from '$lib/stores/open-mode.svelte';
import { PinStore } from '$lib/stores/pins.svelte';
import { fakePins, pinOf } from '$lib/test/fake-pins';
import {
	TicketRowActionsStore,
	type TicketRowActionsData
} from '$lib/stores/ticket-row-actions.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import ProjectTicketListHarness from '$lib/test/ProjectTicketListHarness.svelte';
import { PROJECTS_HOST } from '$lib/ticket-host';
import source from './ProjectTicketList.svelte?raw';

const mocks = vi.hoisted(() => ({
	page: { url: new URL('http://localhost:3000/projekte?q=Haus') }
}));

vi.mock('$app/state', () => ({ page: mocks.page }));

useOverlayStubs();

const T0 = '2026-09-24 08:00:00.000Z';
const TODAY = '2026-10-01';
const HOUSE = { id: 'house0000000001', name: 'Haus' };
const SESSION = { ensureValid: () => true, logout: vi.fn() };

let sequence = 0;

function ticket(overrides: Partial<TicketSummary> = {}): TicketSummary {
	sequence += 1;
	return {
		id: `t${String(sequence).padStart(14, '0')}`,
		key: `HAUS-${sequence}`,
		title: `Ticket ${sequence}`,
		status: 'open',
		priority: 'medium',
		due: null,
		projectId: HOUSE.id,
		tagIds: [],
		project: null,
		tags: [],
		recurring: false,
		source: null,
		completedAt: null,
		created: T0,
		updated: T0,
		...overrides
	};
}

function show(props: Record<string, unknown> = {}) {
	return render(ProjectTicketListHarness, {
		props: { project: HOUSE, tickets: [], today: TODAY, host: PROJECTS_HOST, ...props }
	});
}

const list = (name = 'Offene Tickets von „Haus“') => screen.getByRole('list', { name });
const entries = (name?: string) => within(list(name)).getAllByRole('listitem');
const links = (name?: string) =>
	entries(name).map((entry) => entry.querySelector('a[data-row-link]') as HTMLAnchorElement);

afterEach(() => {
	document.body.innerHTML = '';
	mocks.page.url = new URL('http://localhost:3000/projekte?q=Haus');
});

describe('open tickets of a project: color (ADR-0052)', () => {
	it('shows the color of every ticket as a dot before the key, named after the title', () => {
		const own = ticket({ key: 'HAUS-1', title: 'Dach prüfen', color: 'gruen' });
		const inherited = ticket({ key: 'HAUS-2', title: 'Keller räumen' });
		show({ project: { ...HOUSE, color: 'blau' }, tickets: [own, inherited] });
		const [first, second] = links();
		expect(first?.querySelector('.color-mark.dot')?.getAttribute('title')).toBe('Farbe Grün');
		expect(first?.querySelector('.color-mark')?.getAttribute('aria-hidden')).toBe('true');
		// The name follows the title inside the link.
		const named = (link: HTMLElement | undefined) =>
			link?.querySelector('.title ~ .visually-hidden')?.textContent;
		expect(named(first)).toBe(', Farbe Grün');
		expect(second?.querySelector('.color-mark')?.getAttribute('title')).toBe(
			'Farbe Blau, vom Projekt „Haus“'
		);
		expect(named(second)).toBe(', Farbe Blau, vom Projekt „Haus“');
	});

	it('shows no dot without a color', () => {
		show({ tickets: [ticket({ key: 'HAUS-3', title: 'Ohne' })] });
		expect(links()[0]?.querySelector('.color-mark')).toBeNull();
	});
});

describe('open tickets of a project: charm (ADR-0062)', () => {
	it('shows the charm before the title, named after it inside the link', () => {
		show({
			tickets: [
				ticket({ key: 'HAUS-1', title: 'Rasen mähen', charm: 'garten' }),
				ticket({ key: 'HAUS-2', title: 'Ohne' })
			]
		});
		const [first, second] = links();
		const mark = first?.querySelector<HTMLElement>('.title .charm-mark');
		expect(mark?.getAttribute('title')).toBe('Charm: Garten');
		expect(mark?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
		expect(first?.querySelector('.title')?.textContent?.trim()).toBe('Rasen mähen');
		expect(
			[...(first?.querySelectorAll('.title ~ .visually-hidden') ?? [])].map(
				(hidden) => hidden.textContent
			)
		).toEqual([', Charm: Garten']);
		expect(second?.querySelector('.charm-mark')).toBeNull();
	});
});

describe('open tickets of a project', () => {
	it('lists key and title as one link, status, priority and due date of every ticket', () => {
		const first = ticket({
			key: 'HAUS-1',
			title: 'Dach prüfen',
			status: 'in_progress',
			priority: 'high',
			due: '2026-10-02'
		});
		const second = ticket({ key: 'HAUS-2', title: 'Keller', status: 'backlog' });
		show({ tickets: [first, second] });

		expect(entries()).toHaveLength(2);
		const [one, two] = entries();
		expect(within(one!).getByRole('link', { name: 'HAUS-1 Dach prüfen' })).toBeTruthy();
		const text = one!.textContent?.replace(/\s+/g, ' ');
		expect(text).toContain('Status: In Arbeit');
		expect(text).toContain('Priorität: Hoch');
		expect(text).toContain('Fällig: morgen');
		expect(within(one!).getByText('morgen').closest('time')?.getAttribute('datetime')).toBe(
			'2026-10-02'
		);
		expect(two!.textContent).toContain('Backlog');
		// Without a due date the label says so, without "Fällig:" in front.
		expect(two!.textContent).toContain('keine Fälligkeit');
		expect(two!.textContent).not.toContain('Fällig:');
		// No editing, no selection: no fields, no check boxes.
		expect(list().querySelector('input, select, textarea')).toBeNull();
	});

	it('shows at most ten and links to all of them in "Aufgaben"', () => {
		const many = Array.from({ length: 12 }, () => ticket());
		show({ tickets: many });

		expect(entries()).toHaveLength(10);
		expect(links()[0]?.textContent).toContain(many[0]!.key);
		const all = screen.getByRole('link', { name: 'Alle 12 in Aufgaben öffnen' });
		expect(all.getAttribute('href')).toBe(`/?projekt=${HOUSE.id}`);
	});

	it('names only the own tickets of a parent and leaves its sub projects out of the link', () => {
		show({ tickets: Array.from({ length: 11 }, () => ticket()), ownOnly: true });

		expect(entries('Offene Tickets direkt in „Haus“')).toHaveLength(10);
		expect(
			screen.getByRole('link', { name: 'Alle 11 in Aufgaben öffnen' }).getAttribute('href')
		).toBe(`/?projekt=${HOUSE.id}&unterprojekte=0`);
	});

	it('has no link to all tickets while all of them are shown', () => {
		show({ tickets: Array.from({ length: 10 }, () => ticket()) });
		expect(entries()).toHaveLength(10);
		expect(screen.queryByRole('link', { name: /in Aufgaben öffnen/ })).toBeNull();
	});

	it('opens a ticket in the remembered way in the projects, with the state of the view', async () => {
		const item = ticket();
		const openMode = new TicketOpenModeStore(null);
		show({ tickets: [item], openMode });

		// The search of the project view ("q") stays the search of the projects (ADR-0054).
		expect(links()[0]?.getAttribute('href')).toBe(`/projekte/tickets/${item.id}?q=Haus`);
		expect(links()[0]?.getAttribute('data-ticket-link')).toBe(item.id);
		openMode.choose('full');
		await tick();
		expect(links()[0]?.getAttribute('href')).toBe(`/projekte/tickets/${item.id}/voll?q=Haus`);
	});

	it('names the project panel it replaces as the way back (von)', () => {
		mocks.page.url = new URL(`http://localhost:3000/projekte/${HOUSE.id}?q=Haus`);
		const item = ticket();
		show({ tickets: [item] });
		expect(links()[0]?.getAttribute('href')).toBe(
			`/projekte/tickets/${item.id}?q=Haus&von=${HOUSE.id}`
		);
	});

	it('opens in the panel outside the (app) layout', () => {
		const item = ticket();
		show({ tickets: [item] });
		expect(links()[0]?.getAttribute('href')).toBe(`/projekte/tickets/${item.id}?q=Haus`);
	});

	it('says when there are none, while loading and when loading failed', async () => {
		const view = show();
		expect(screen.getByRole('heading', { level: 3, name: 'Keine offenen Tickets' })).toBeTruthy();
		expect(screen.queryByRole('list')).toBeNull();

		await view.rerender({
			project: HOUSE,
			tickets: [],
			today: TODAY,
			ownOnly: true,
			headingLevel: 4
		});
		expect(
			screen.getByRole('heading', { level: 4, name: 'Keine offenen Tickets direkt in „Haus“' })
		).toBeTruthy();

		await view.rerender({ project: HOUSE, tickets: [], today: TODAY, loading: true });
		expect(screen.getByRole('status').textContent).toBe('Offene Tickets werden geladen …');
		expect(screen.queryByRole('heading')).toBeNull();

		await view.rerender({ project: HOUSE, tickets: [ticket()], today: TODAY, error: 'Kaputt.' });
		expect(screen.getByText('Kaputt.').closest('.alert-error')).toBeTruthy();
		expect(screen.queryByRole('list')).toBeNull();
	});

	it('names a long title on hover; the line clamp may cut it', () => {
		const long = 'Sehr langer Titel '.repeat(5).trim();
		show({ tickets: [ticket({ title: long }), ticket({ title: 'Kurz' })] });
		expect(links()[0]?.getAttribute('title')).toBe(long);
		expect(links()[1]?.hasAttribute('title')).toBe(false);
	});

	it('gives every key the room of the longest shown key, so none is cut off (KN-1)', async () => {
		const pinned = ticket({ key: 'HAUS-1000000' });
		const pins = new PinStore(fakePins([pinOf(pinned.id, 1)]).data, SESSION);
		await pins.load();
		show({ tickets: [ticket({ key: 'HAUS-9' }), pinned, ticket({ key: 'HAUS-10000' })], pins });
		await tick();
		const lists = screen.getAllByRole('list');
		// Both lists, the pinned and the others, share the place of the key: 12 ch.
		expect(lists.map((element) => element.style.getPropertyValue('--key-chars'))).toEqual([
			'12',
			'12'
		]);
		expect(links().map((link) => link.querySelector('.key')?.textContent)).toEqual([
			'HAUS-9',
			'HAUS-10000'
		]);
		document.body.innerHTML = '';
		show({ tickets: [ticket({ key: 'HAUS-9' })], pins: null });
		expect(list().style.getPropertyValue('--key-chars')).toBe('6');
	});

	it('lets the key grow with its number instead of cutting it off (KN-1)', () => {
		const style = /<style>([\s\S]*?)<\/style>/.exec(source)?.[1] ?? '';
		const rule = /\n\t\.key \{([^}]*)\}/.exec(style)?.[1] ?? '';
		expect(rule).toContain('min-width: max(5.5rem, calc(var(--key-chars, 0) * 1ch));');
		expect(rule).toContain('white-space: nowrap;');
		expect(rule).not.toMatch(/overflow|text-overflow|(^|[^-])width:/);
	});
});

describe('menu "•••" of an open ticket', () => {
	function rowActions(data: Partial<TicketRowActionsData> = {}) {
		const flags = new FlagStore();
		const list = { remove: vi.fn(), announce: vi.fn() };
		const fake: TicketRowActionsData = {
			get: vi.fn(async (): Promise<Ticket> => ({ ...ticket(), description: '', sourceItem: null })),
			sources: vi.fn(async () => []),
			commentCount: vi.fn(async () => 0),
			delete: vi.fn(async () => null),
			...data
		};
		return { store: new TicketRowActionsStore(fake, SESSION, list, null, flags), fake };
	}

	const menuButton = (key: string) =>
		screen.getByRole('button', { name: `Weitere Aktionen für ${key}` });
	const menuOf = (button: HTMLElement) =>
		document.getElementById(button.getAttribute('aria-controls') ?? '') as HTMLElement;

	it('ends every entry with the menu of the ticket rows, its links stay in the projects', () => {
		const item = ticket({ key: 'HAUS-7' });
		const { store } = rowActions();
		show({ tickets: [item], rowActions: store, duplicates: true });

		const button = menuButton('HAUS-7');
		expect(button.classList.contains('row-menu')).toBe(true);
		const items = within(menuOf(button)).getAllByRole('menuitem', { hidden: true });
		expect(items.map((entry) => entry.textContent?.trim())).toEqual([
			'Im Seitenpanel öffnen',
			'In Vollansicht öffnen',
			'Link kopieren',
			'Duplizieren …',
			'In den Papierkorb …'
		]);
		expect(items[0]?.getAttribute('href')).toBe(`/projekte/tickets/${item.id}?q=Haus`);
		expect(items[1]?.getAttribute('href')).toBe(`/projekte/tickets/${item.id}/voll?q=Haus`);
	});

	it('leaves out "Duplizieren …" without its store and has no menu without the row actions', () => {
		const { store } = rowActions();
		const view = show({ tickets: [ticket({ key: 'HAUS-8' })], rowActions: store });
		const items = within(menuOf(menuButton('HAUS-8'))).getAllByRole('menuitem', { hidden: true });
		expect(items.map((entry) => entry.textContent?.trim())).not.toContain('Duplizieren …');
		view.unmount();

		show({ tickets: [ticket({ key: 'HAUS-9' })] });
		expect(screen.queryByRole('button', { name: /Weitere Aktionen/ })).toBeNull();
		expect(entries()[0]?.hasAttribute('data-menu-row')).toBe(false);
	});

	it('asks the store for the question and waits while it loads', async () => {
		let release: () => void = () => undefined;
		const { store, fake } = rowActions({
			sources: vi.fn(() => new Promise<never[]>((resolve) => (release = () => resolve([]))))
		});
		const item = ticket({ key: 'HAUS-10' });
		show({ tickets: [item], rowActions: store });

		const button = menuButton('HAUS-10');
		button.focus();
		await fireEvent.click(button);
		await fireEvent.click(
			within(menuOf(button)).getByRole('menuitem', { name: 'In den Papierkorb …', hidden: true })
		);
		await tick();
		expect(fake.sources).toHaveBeenCalledWith(item.id);
		expect(button.closest('.menu')?.getAttribute('aria-busy')).toBe('true');
		release();
		await vi.waitFor(() => expect(store.dialog?.kind).toBe('delete'));
		expect(button.closest('.menu')?.hasAttribute('aria-busy')).toBe(false);
	});

	it('opens with a right click on the entry, the browser keeps its menu on other links', async () => {
		const { store } = rowActions();
		show({ tickets: Array.from({ length: 11 }, () => ticket()), rowActions: store });
		const first = links()[0]!;
		const key = first.querySelector('.key')?.textContent ?? '';

		const kept = await fireEvent.contextMenu(first, { button: 2, clientX: 40, clientY: 30 });
		await tick();
		expect(kept).toBe(false);
		expect(menuButton(key).getAttribute('aria-expanded')).toBe('true');

		const all = screen.getByRole('link', { name: 'Alle 11 in Aufgaben öffnen' });
		expect(await fireEvent.contextMenu(all, { button: 2 })).toBe(true);
	});
});

describe('focus when an entry leaves', () => {
	it('goes to the entry now at its place, else to the owner', async () => {
		const [one, two, three] = [ticket(), ticket(), ticket()];
		const returnFocus = vi.fn(() => document.getElementById('back'));
		const back = document.createElement('button');
		back.id = 'back';
		document.body.append(back);
		const props = { project: HOUSE, today: TODAY, returnFocus };
		const view = show({ ...props, tickets: [one, two, three] });

		links()[1]!.focus();
		// Done or moved to the trash in another tab: realtime takes it out of the list.
		await view.rerender({ ...props, tickets: [one!, three!] });
		await tick();
		expect(document.activeElement).toBe(links()[1]);
		expect(document.activeElement?.textContent).toContain(three!.key);

		links()[1]!.focus();
		await view.rerender({ ...props, tickets: [one!] });
		await tick();
		expect(document.activeElement).toBe(links()[0]);

		await view.rerender({ ...props, tickets: [] });
		await tick();
		expect(returnFocus).toHaveBeenCalled();
		expect(document.activeElement).toBe(back);
	});

	it('leaves the focus alone when it is somewhere else', async () => {
		const [one, two] = [ticket(), ticket()];
		const outside = document.createElement('button');
		document.body.append(outside);
		const view = show({ tickets: [one, two] });
		outside.focus();

		await view.rerender({ project: HOUSE, today: TODAY, tickets: [two!] });
		await tick();
		expect(document.activeElement).toBe(outside);
	});
});

describe('open tickets of a project: the own pins (ADR-0064)', () => {
	async function pinsOver(pinned: TicketPin[]) {
		const fake = fakePins(pinned);
		const pins = new PinStore(fake.data, SESSION);
		await pins.load();
		return { fake, pins };
	}

	const PINNED = 'Angeheftet in „Haus“';
	const keysOf = (name?: string) =>
		entries(name).map((entry) => entry.querySelector('.key')?.textContent);

	it('lists the pins of the project first, oldest on top, outside the limit and not again below', async () => {
		const tickets = [ticket(), ticket(), ticket(), ticket()];
		const [one, two, , four] = tickets;
		// Four was pinned before two; the pin of a ticket of another project does not show here.
		const { pins } = await pinsOver([
			pinOf(two!.id, 20),
			pinOf(four!.id, 10),
			pinOf('other0000000001', 5)
		]);
		show({ tickets, pins, limit: 1 });

		expect(keysOf(PINNED)).toEqual([four!.key, two!.key]);
		expect(keysOf()).toEqual([one!.key]);
		// The rest is behind the link, which counts every open ticket of the project.
		expect(screen.getByRole('link', { name: 'Alle 4 in Aufgaben öffnen' })).toBeTruthy();
		// The label "Angeheftet" is for the eye; the list names itself.
		expect(document.querySelector('.pinned-label')?.getAttribute('aria-hidden')).toBe('true');
		for (const entry of entries(PINNED)) {
			expect(
				within(entry)
					.getByRole('button', { name: /anheften$/ })
					.getAttribute('aria-pressed')
			).toBe('true');
		}
	});

	it('pins with the toggle of an entry; the entry moves up and keeps the focus', async () => {
		const [one, two] = [ticket(), ticket()];
		const { pins, fake } = await pinsOver([]);
		show({ tickets: [one, two], pins });
		expect(screen.queryByRole('list', { name: PINNED })).toBeNull();

		const button = within(list()).getByRole('button', { name: `${two!.key} anheften` });
		expect(button.getAttribute('aria-pressed')).toBe('false');
		button.focus();
		await fireEvent.click(button);
		await vi.waitFor(() => expect(screen.getByRole('list', { name: PINNED })).toBeTruthy());
		await tick();

		expect(fake.data.pin).toHaveBeenCalledWith(two!.id);
		expect(keysOf(PINNED)).toEqual([two!.key]);
		expect(keysOf()).toEqual([one!.key]);
		const moved = within(screen.getByRole('list', { name: PINNED })).getByRole('button', {
			name: `${two!.key} anheften`
		});
		expect(moved.getAttribute('aria-pressed')).toBe('true');
		expect(document.activeElement).toBe(moved);
	});

	it('shows the empty state only without any open ticket, and every ticket pinned is no empty list', async () => {
		const only = ticket();
		const { pins } = await pinsOver([pinOf(only.id, 10)]);
		show({ tickets: [only], pins });
		expect(keysOf(PINNED)).toEqual([only.key]);
		expect(screen.queryByRole('list', { name: 'Offene Tickets von „Haus“' })).toBeNull();
		expect(screen.queryByText('Keine offenen Tickets')).toBeNull();
	});

	it('shows neither a section nor a toggle without the pins', () => {
		show({ tickets: [ticket()], pins: null });
		expect(screen.queryByRole('button', { name: /anheften$/ })).toBeNull();
		expect(screen.queryByRole('list', { name: PINNED })).toBeNull();
	});
});
