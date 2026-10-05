// Route test of the view "Erledigte" (ER-1, ADR-0066): the layout loads the done tickets of the area
// of the tab with the filters of the address, follows a change of the area (ADR-0059), loads the
// open tickets for the questions of the menu and opens tickets next to the view (DONE_HOST).
// Navigation, page state, realtime and the data layer are fakes; the store of the view is real.

import { render, screen, within } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { describe, expect, it, vi } from 'vitest';
import { CatalogStore } from '$lib/stores/catalog.svelte';
import { FlagStore } from '$lib/stores/flags.svelte';
import { doneTicket, fakeDoneData } from '$lib/test/done-list-fake';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import Layout from './+layout.svelte';

const mocks = vi.hoisted(() => ({
	page: {
		url: new URL('http://localhost:3000/erledigt?q=Miete&charm=auto'),
		params: {} as Record<string, string>,
		route: { id: '/(app)/erledigt' }
	},
	data: null as unknown,
	tickets: null as unknown,
	catalog: null as unknown,
	flags: null as unknown,
	area: null as unknown
}));

vi.mock('$app/navigation', () => ({
	goto: vi.fn(async () => undefined),
	beforeNavigate: vi.fn(),
	afterNavigate: vi.fn()
}));
vi.mock('$app/state', () => ({ page: mocks.page }));
vi.mock('$lib/auth.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	auth: { userId: 'user00000000001', ensureValid: () => true, logout: vi.fn() }
}));
vi.mock('$lib/stores/ticket-list.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getTicketListStore: () => mocks.tickets
}));
vi.mock('$lib/stores/catalog.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getCatalogStore: () => mocks.catalog
}));
vi.mock('$lib/stores/flags.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getFlagStore: () => mocks.flags
}));
vi.mock('$lib/stores/inbox.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getInboxStore: () => ({ newCount: 0 })
}));
vi.mock('$lib/stores/area.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	findAreaStore: () => mocks.area
}));
vi.mock('$lib/stores/realtime', async (importOriginal) => ({
	...(await importOriginal<object>()),
	liveSource: () => ({
		tickets: vi.fn(async () => async () => undefined),
		reconnected: vi.fn(async () => async () => undefined)
	})
}));
vi.mock('$lib/stores/done-list.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	doneListData: () => mocks.data
}));

useOverlayStubs();

describe('layout of /erledigt', () => {
	it('loads the done tickets of the area with the filters of the address and follows the area', async () => {
		const ticket = doneTicket('2026-10-05 08:00:00.000Z', {
			title: 'Miete überwiesen',
			charm: 'auto'
		});
		const data = fakeDoneData([[ticket]], 1);
		const areaKey = new SvelteMap([['key', 'u:user00000000001']]);
		mocks.data = data;
		mocks.tickets = {
			today: '2026-10-07',
			newInProjects: 0,
			loadOpen: vi.fn(),
			find: () => null,
			progressOf: () => ({ done: 0, total: 0 }),
			upsert: vi.fn()
		};
		mocks.catalog = new CatalogStore(
			{ listProjects: vi.fn(async () => []), listTags: vi.fn(async () => []), createTag: vi.fn() },
			{ ensureValid: () => true, logout: vi.fn() }
		);
		mocks.flags = new FlagStore();
		mocks.area = {
			get key() {
				return areaKey.get('key');
			},
			visible: false,
			active: 'private',
			household: null,
			select: vi.fn()
		};
		render(Layout, {
			props: { children: createRawSnippet(() => ({ render: () => '<span></span>' })) }
		});

		await vi.waitFor(() =>
			expect(data.list).toHaveBeenCalledWith(1, {
				signal: expect.any(AbortSignal),
				filter: {
					query: {
						search: 'Miete',
						project: null,
						subProjects: true,
						tag: null,
						charm: 'auto',
						assignee: null
					}
				}
			})
		);
		const link = await screen.findByRole('link', { name: /Miete überwiesen/ });
		expect(link.getAttribute('href')).toBe(`/erledigt/tickets/${ticket.id}?q=Miete&charm=auto`);
		expect((mocks.tickets as { loadOpen: () => void }).loadOpen).toHaveBeenCalled();
		const nav = within(screen.getByRole('navigation', { name: 'Ansicht' }));
		expect(nav.getByRole('link', { name: 'Erledigte' }).getAttribute('aria-current')).toBe('page');
		// Monday of the week of the list clock (Wednesday, 7 October 2026).
		expect(screen.getByRole('heading', { level: 3, name: /^Diese Woche/ })).toBeTruthy();

		areaKey.set('key', 'h:house0000000001');
		await tick();
		await vi.waitFor(() => expect(data.list).toHaveBeenCalledTimes(2));
	});
});
