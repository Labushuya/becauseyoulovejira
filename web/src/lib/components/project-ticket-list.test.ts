// Component tests for the compact list of the open tickets of a project (ADR-0034, addendum
// "Offene Tickets in Projekten"; plan projekte-tickets): a named list with key and title as one
// link, status, priority and due date; at most ten, then "Alle N in Aufgaben öffnen"; a ticket
// opens in the remembered way with the list of its project behind it; empty, loading and failed;
// the menu "•••" of the ticket rows with its context menu; the focus when the focused entry
// leaves. Page state is mocked; the open-mode and row-action stores run for real on fakes.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Ticket, TicketSummary } from '$lib/domain/ticket';
import { FlagStore } from '$lib/stores/flags.svelte';
import { TicketOpenModeStore } from '$lib/stores/open-mode.svelte';
import {
	TicketRowActionsStore,
	type TicketRowActionsData
} from '$lib/stores/ticket-row-actions.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import ProjectTicketListHarness from '$lib/test/ProjectTicketListHarness.svelte';

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
		props: { project: HOUSE, tickets: [], today: TODAY, ...props }
	});
}

const list = (name = 'Offene Tickets von „Haus“') => screen.getByRole('list', { name });
const entries = (name?: string) => within(list(name)).getAllByRole('listitem');
const links = (name?: string) =>
	entries(name).map((entry) => entry.querySelector('a[data-row-link]') as HTMLAnchorElement);

afterEach(() => {
	document.body.innerHTML = '';
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

	it('opens a ticket in the remembered way, with the tickets of the project behind it', async () => {
		const item = ticket();
		const openMode = new TicketOpenModeStore(null);
		show({ tickets: [item], openMode });

		// The search of the project view ("q") never reaches the list of the tickets.
		expect(links()[0]?.getAttribute('href')).toBe(`/tickets/${item.id}?projekt=${HOUSE.id}`);
		openMode.choose('full');
		await tick();
		expect(links()[0]?.getAttribute('href')).toBe(`/tickets/${item.id}/voll?projekt=${HOUSE.id}`);
	});

	it('opens in the panel outside the (app) layout', () => {
		const item = ticket();
		show({ tickets: [item] });
		expect(links()[0]?.getAttribute('href')).toBe(`/tickets/${item.id}?projekt=${HOUSE.id}`);
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

	it('ends every entry with the menu of the ticket rows, its links keep the project', () => {
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
		expect(items[0]?.getAttribute('href')).toBe(`/tickets/${item.id}?projekt=${HOUSE.id}`);
		expect(items[1]?.getAttribute('href')).toBe(`/tickets/${item.id}/voll?projekt=${HOUSE.id}`);
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
