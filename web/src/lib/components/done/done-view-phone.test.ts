// "Erledigte" in the phone frame (MO-7c1, ADR-0073 addendum MO-7c1; concept MO-0 §6 "Erledigte:
// Feinschliff") in jsdom with the real store on fake data and a controlled matchMedia: an entry is a
// card, a tap on it outside its buttons opens the ticket like the other cards (MO-3, MO-6, MO-7b); the
// rules of the frame give the entry and the filters targets of 44 px and the title its own line. The
// counter-checks: on a PC with the switch on and on a phone with the switch off a tap beside the link
// does nothing, as before. The layout itself (44 px, the share of the title, no sideways scrolling)
// is checked in a browser by tests/mobile/phone-frame.spec.mjs.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseDoneQuery } from '$lib/domain/done-view';
import { PHONE_QUERY } from '$lib/domain/phone-layout';
import { getMobileLayoutStore } from '$lib/mobile-layout.svelte';
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

async function showView() {
	const ticket = doneTicket('2026-10-07 08:00:00.000Z', { title: 'Steuer abgeben' });
	const flags = new FlagStore();
	const store = new DoneListStore(fakeDoneData([[ticket]], 1), SESSION, {
		today: () => TODAY,
		flags
	});
	const catalog = new CatalogStore(
		{ listProjects: vi.fn(async () => []), listTags: vi.fn(async () => []), createTag: vi.fn() },
		SESSION
	);
	await catalog.load();
	const rowActions = new TicketRowActionsStore(
		{
			get: vi.fn(async () => ({ ...ticket, description: '', sourceItem: null })),
			sources: vi.fn(async () => []),
			commentCount: vi.fn(async () => 0),
			delete: vi.fn(async () => null)
		},
		SESSION,
		{ remove: vi.fn(), announce: vi.fn() },
		null,
		flags
	);
	store.show(parseDoneQuery(mocks.page.url.searchParams));
	render(TicketHostHarness, {
		props: { host: DONE_HOST, component: DoneView, props: { store, catalog, rowActions } }
	});
	await vi.advanceTimersByTimeAsync(0);
	return { ticket };
}

/** The entry of a ticket. */
const entryOf = (id: string) =>
	document.querySelector<HTMLElement>(`li[data-ticket-id="${id}"]`) as HTMLElement;

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
	vi.setSystemTime(Date.UTC(2026, 9, 7, 10));
	mocks.goto.mockClear();
	mocks.page.url = new URL('http://localhost:3000/erledigt');
});

afterEach(() => {
	stop?.();
	stop = null;
	getMobileLayoutStore().choose(false);
	vi.unstubAllGlobals();
	vi.useRealTimers();
	localStorage.clear();
	document.body.innerHTML = '';
});

describe('"Erledigte" in the phone frame (MO-7c1)', () => {
	it('opens the ticket with a tap on its entry outside the buttons, like the other cards', async () => {
		useWindow(true, true);
		const { ticket } = await showView();
		const entry = entryOf(ticket.id);
		const link = within(entry).getByRole('link', { name: /Steuer abgeben/ });

		await fireEvent.click(entry.querySelector('.time-cell') as HTMLElement);
		expect(mocks.goto).toHaveBeenCalledOnce();
		expect(mocks.goto.mock.calls[0]).toEqual([link.getAttribute('href')]);

		// "•••" opens its menu and not the ticket.
		mocks.goto.mockClear();
		await fireEvent.click(
			within(entry).getByRole('button', { name: `Weitere Aktionen für ${ticket.key}` })
		);
		expect(mocks.goto).not.toHaveBeenCalled();
	});

	it.each([
		['a PC with the switch on', false, true],
		['a phone with the switch off', true, false]
	])(
		'opens nothing with a tap beside the link on %s, as before',
		async (_name, narrow, enabled) => {
			useWindow(narrow, enabled);
			const { ticket } = await showView();
			await fireEvent.click(entryOf(ticket.id).querySelector('.time-cell') as HTMLElement);
			expect(mocks.goto).not.toHaveBeenCalled();
			expect(screen.getByRole('heading', { level: 2, name: 'Erledigte' })).toBeTruthy();
		}
	);
});

describe('styles of "Erledigte" in the phone frame (MO-7c1)', () => {
	const read = (name: string) => readFileSync(join(import.meta.dirname, name), 'utf8');
	/** The rules of the frame of a component: from its block of the phone width on. */
	const frameOf = (name: string) => {
		const source = read(name);
		const start = source.indexOf('@media (max-width: 39.99rem) {');
		return start === -1 ? '' : source.slice(start);
	};

	it('gives the link of an entry 44 px and the title a line of its own below the key', () => {
		const frame = frameOf('DoneView.svelte');
		expect(frame).toMatch(
			/:global\(:root\[data-mobile-layout='on'\]\) \.link \{[^}]*flex: 1 1 100%;[^}]*flex-wrap: wrap;[^}]*min-height: var\(--control-height-touch\);/
		);
		// The title takes a line of its own over the whole width and up to three lines, like MO-3.
		expect(frame).toMatch(
			/:global\(:root\[data-mobile-layout='on'\]\) \.title \{\s*flex: 1 1 100%;\s*-webkit-line-clamp: 3;\s*line-clamp: 3;/
		);
	});

	it('gives the choices of the filters 44 px and the search the whole width', () => {
		const frame = frameOf('DoneFilterBar.svelte');
		expect(frame).toMatch(
			/:global\(:root\[data-mobile-layout='on'\]\) \.done-filters :global\(\.toggle\) \{\s*min-height: var\(--control-height-touch\);/
		);
		expect(frame).toMatch(
			/:global\(:root\[data-mobile-layout='on'\]\) \.done-filters \.search-field input\[type='search'\] \{\s*width: 100%;/
		);
	});
});
