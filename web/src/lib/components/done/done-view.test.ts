// Component tests of the view "Erledigte" (ER-1, ADR-0066): the section bar with the number and
// the navigation, the groups by the day of completion as sections with a list, the entries with
// charm, badge "Vorhaben", project and time, the menu "•••" of every ticket row with "Wieder öffnen",
// "Mehr laden" and the end of the list in view, the filters in the address and the empty states.
// Store and catalog run for real on fake data layers; navigation, page state, the popover API and
// IntersectionObserver are stand-ins.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseDoneQuery } from '$lib/domain/done-view';
import type { Project } from '$lib/domain/project';
import type { TicketSummary } from '$lib/domain/ticket';
import { CatalogStore } from '$lib/stores/catalog.svelte';
import { DoneListStore } from '$lib/stores/done-list.svelte';
import { FlagStore } from '$lib/stores/flags.svelte';
import { TicketRowActionsStore } from '$lib/stores/ticket-row-actions.svelte';
import { doneTicket, fakeDoneData } from '$lib/test/done-list-fake';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import TicketHostHarness from '$lib/test/TicketHostHarness.svelte';
import { DONE_HOST } from '$lib/ticket-host';
import DoneView from './DoneView.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: { url: new URL('http://localhost:3000/erledigt') }
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));

useOverlayStubs();

const SESSION = { ensureValid: () => true, logout: vi.fn() };
const TODAY = '2026-10-07';
/** The no-break space after "Erledigt:" (&nbsp;). */
const NBSP = String.fromCharCode(160);
const HOUSE: Project = {
	id: 'proj00000000001',
	name: 'Haus',
	code: 'HAUS',
	archived: false,
	updated: '2026-09-01 10:00:00.000Z'
};

/** Fake IntersectionObserver; `show()` reports the end of the list as in view. */
function stubIntersection() {
	const observers: { callback: IntersectionObserverCallback; disconnected: boolean }[] = [];
	vi.stubGlobal(
		'IntersectionObserver',
		class {
			entry: { callback: IntersectionObserverCallback; disconnected: boolean };
			constructor(callback: IntersectionObserverCallback) {
				this.entry = { callback, disconnected: false };
				observers.push(this.entry);
			}
			observe() {}
			disconnect() {
				this.entry.disconnected = true;
			}
		}
	);
	return {
		show() {
			for (const observer of observers.filter((entry) => !entry.disconnected)) {
				observer.callback(
					[{ isIntersecting: true } as IntersectionObserverEntry],
					{} as IntersectionObserver
				);
			}
		}
	};
}

async function showView(
	data: ReturnType<typeof fakeDoneData>,
	path = '/erledigt',
	{ menu = true }: { menu?: boolean } = {}
) {
	mocks.page.url = new URL(path, 'http://localhost:3000');
	const flags = new FlagStore();
	const store = new DoneListStore(data, SESSION, { today: () => TODAY, flags });
	const catalog = new CatalogStore(
		{
			listProjects: vi.fn(async () => [HOUSE]),
			listTags: vi.fn(async () => []),
			createTag: vi.fn()
		},
		SESSION
	);
	await catalog.load();
	const rowActions = menu
		? new TicketRowActionsStore(
				{
					get: vi.fn(),
					sources: vi.fn(async () => []),
					commentCount: vi.fn(async () => 0),
					delete: vi.fn(async () => null)
				},
				SESSION,
				{ remove: vi.fn(), announce: vi.fn() },
				null,
				flags
			)
		: null;
	store.show(parseDoneQuery(mocks.page.url.searchParams));
	render(TicketHostHarness, {
		props: { host: DONE_HOST, component: DoneView, props: { store, catalog, rowActions } }
	});
	await vi.advanceTimersByTimeAsync(0);
	return { store, catalog, flags };
}

function groupNames(): string[] {
	return screen
		.getAllByRole('heading', { level: 3 })
		.map((heading) => (heading.firstChild?.textContent ?? '').trim());
}

function entryLinks(): HTMLAnchorElement[] {
	return [...document.querySelectorAll<HTMLAnchorElement>('a[data-row-link]')];
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
	vi.setSystemTime(Date.UTC(2026, 9, 7, 10));
	mocks.goto.mockClear();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

describe('view "Erledigte"', () => {
	it('names its number, stands as current in the navigation and groups by the day of completion', async () => {
		const tickets: TicketSummary[] = [
			doneTicket('2026-10-07 08:00:00.000Z', { title: 'Steuer' }),
			doneTicket('2026-10-06 20:00:00.000Z', { title: 'Garten' }),
			doneTicket('2026-10-05 09:00:00.000Z'),
			doneTicket('2026-09-15 09:00:00.000Z', { title: 'Alt' })
		];
		await showView(fakeDoneData([tickets], 12));

		const heading = screen.getByRole('heading', { level: 2, name: 'Erledigte' });
		expect(heading.closest('.section-bar')?.textContent).toMatch(/12/);
		expect(screen.getByText('12 erledigte Tickets')).toBeTruthy();
		const nav = within(screen.getByRole('navigation', { name: 'Ansicht' }));
		expect(nav.getByRole('link', { name: 'Erledigte' }).getAttribute('aria-current')).toBe('page');

		expect(groupNames()).toEqual(['Heute', 'Gestern', 'Diese Woche', 'September 2026']);
		const today = screen.getByRole('region', { name: 'Heute, 1 erledigtes Ticket' });
		expect(within(today).getByRole('list')).toBeTruthy();
		expect(within(today).getByRole('link', { name: /Steuer/ })).toBeTruthy();
		// Newest first, the time of day for today and yesterday, the date before.
		expect(entryLinks().map((link) => link.querySelector('.title')?.textContent)).toEqual([
			'Steuer',
			'Garten',
			tickets[2]?.title,
			'Alt'
		]);
		const times = [...document.querySelectorAll('time')].map((time) => time.textContent);
		expect(times).toEqual(['10:00', '22:00', '05.10.2026', '15.09.2026']);
		// The full time for screen readers (the visible one is aria-hidden).
		expect(screen.getAllByText(/^Erledigt:\s/)[0]?.textContent?.replaceAll(NBSP, ' ')).toBe(
			'Erledigt: 07.10.2026 10:00'
		);
	});

	it('shows charm, badge "Vorhaben" and project like the other lists, and opens next to the view', async () => {
		const ongoing = doneTicket('2026-10-07 08:00:00.000Z', {
			title: 'Umzug',
			charm: 'auto',
			kind: 'ongoing',
			projectId: HOUSE.id
		});
		await showView(fakeDoneData([[ongoing]]), '/erledigt?q=Umzug');

		const link = screen.getByRole('link', { name: /Umzug/ });
		expect(link.getAttribute('href')).toBe(`/erledigt/tickets/${ongoing.id}?q=Umzug`);
		expect(link.textContent).toContain('Charm: Auto');
		const entry = link.closest('li') as HTMLElement;
		expect(within(entry).getByText('Vorhaben')).toBeTruthy();
		expect(within(entry).getByText('Haus')).toBeTruthy();
	});

	it('offers the menu of every ticket row with "Wieder öffnen" and lets the reopened ticket leave', async () => {
		const first = doneTicket('2026-10-07 08:00:00.000Z', { title: 'Erstes' });
		const second = doneTicket('2026-10-07 07:00:00.000Z', { title: 'Zweites' });
		const data = fakeDoneData([[first, second]]);
		const { flags } = await showView(data);

		const button = screen.getByRole('button', { name: `Weitere Aktionen für ${first.key}` });
		expect(button.closest('li')?.hasAttribute('data-menu-row')).toBe(true);
		const menu = document.getElementById(
			String(button.getAttribute('aria-controls'))
		) as HTMLElement;
		const entries = within(menu)
			.getAllByRole('menuitem', { hidden: true })
			.map((item) => item.textContent?.trim());
		expect(entries).toEqual([
			'Im Seitenpanel öffnen',
			'In Vollansicht öffnen',
			'Wieder öffnen',
			'Link kopieren',
			'In den Papierkorb …'
		]);
		expect(
			within(menu)
				.getByRole('menuitem', { name: 'Im Seitenpanel öffnen', hidden: true })
				.getAttribute('href')
		).toBe(`/erledigt/tickets/${first.id}`);

		entryLinks()[0]?.focus();
		await fireEvent.click(button);
		await fireEvent.click(
			within(menu).getByRole('menuitem', { name: 'Wieder öffnen', hidden: true })
		);
		await vi.advanceTimersByTimeAsync(0);
		await tick();

		expect(data.setDone).toHaveBeenCalledWith(first.id, false);
		expect(entryLinks().map((link) => link.querySelector('.title')?.textContent)).toEqual([
			'Zweites'
		]);
		expect(flags.flags[0]?.title).toBe(`${first.key} wieder offen.`);
		expect(flags.flags[0]?.action?.label).toBe('Rückgängig');
	});

	it('loads more with the button and moves the focus to the first new entry after the last page', async () => {
		const first = doneTicket('2026-10-07 08:00:00.000Z');
		const second = doneTicket('2026-09-01 08:00:00.000Z', { title: 'Später geladen' });
		const data = fakeDoneData([[first], [second]], 2);
		await showView(data);

		expect(screen.getByText('1 von 2 angezeigt')).toBeTruthy();
		const more = screen.getByRole('button', { name: 'Mehr laden' });
		more.focus();
		await fireEvent.click(more);
		await vi.advanceTimersByTimeAsync(0);
		await tick();

		expect(data.list).toHaveBeenLastCalledWith(2, expect.anything());
		expect(screen.queryByRole('button', { name: 'Mehr laden' })).toBeNull();
		expect(groupNames()).toEqual(['Heute', 'September 2026']);
		expect(document.activeElement).toBe(screen.getByRole('link', { name: /Später geladen/ }));
	});

	it('loads the next page when the end of the list comes into view', async () => {
		const intersection = stubIntersection();
		const data = fakeDoneData(
			[[doneTicket('2026-10-07 08:00:00.000Z')], [doneTicket('2026-10-01 08:00:00.000Z')]],
			2
		);
		await showView(data);
		expect(data.list).toHaveBeenCalledOnce();

		intersection.show();
		await vi.advanceTimersByTimeAsync(0);

		expect(data.list).toHaveBeenCalledTimes(2);
		expect(entryLinks()).toHaveLength(2);
	});

	it('writes the filters into the address: the search replaces the entry, a charm adds one', async () => {
		await showView(fakeDoneData([[doneTicket('2026-10-07 08:00:00.000Z')]]));

		const filters = within(screen.getByRole('region', { name: 'Filter' }));
		await fireEvent.input(filters.getByRole('searchbox', { name: 'Suche' }), {
			target: { value: 'Miete' }
		});
		expect(mocks.goto).toHaveBeenLastCalledWith('/erledigt?q=Miete', {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});

		await fireEvent.click(filters.getByRole('button', { name: /^Charm:/ }));
		await fireEvent.click(screen.getByRole('radio', { name: 'Auto', hidden: true }));
		expect(mocks.goto).toHaveBeenLastCalledWith('/erledigt?charm=auto', {
			keepFocus: true,
			noScroll: true
		});
		expect(
			filters.getByRole('button', { name: 'Zurücksetzen' }).getAttribute('aria-disabled')
		).toBe('true');
	});

	it('says when there is nothing done yet, and offers to reset filters that hide everything', async () => {
		await showView(fakeDoneData([[]], 0));
		expect(screen.getByRole('heading', { name: 'Noch keine erledigten Tickets' })).toBeTruthy();
		document.body.innerHTML = '';

		await showView(fakeDoneData([[]], 0), `/erledigt/tickets/abc123def456ghi?projekt=${HOUSE.id}`);
		expect(
			screen.getByRole('heading', { name: 'Keine erledigten Tickets für diese Filter' })
		).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
		expect(mocks.goto).toHaveBeenCalledWith('/erledigt/tickets/abc123def456ghi', {
			keepFocus: true,
			noScroll: true
		});
	});

	it('shows a failure of loading with "Erneut versuchen"', async () => {
		const data = fakeDoneData([[doneTicket('2026-10-07 08:00:00.000Z')]]);
		data.list.mockRejectedValueOnce(new Error('kaputt'));
		await showView(data, '/erledigt', { menu: false });

		expect(document.querySelector('.alert-error')).not.toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
		await vi.advanceTimersByTimeAsync(0);
		expect(entryLinks()).toHaveLength(1);
		expect(screen.queryByRole('button', { name: /Weitere Aktionen/ })).toBeNull();
	});
});
