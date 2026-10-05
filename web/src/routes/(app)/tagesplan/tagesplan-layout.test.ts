// Route test of the view "Tagesplan" (TP-1, ADR-0065): the layout loads the plan of the day of the
// address in the area of the tab, follows a change of the area (ADR-0059) and opens tickets next to the
// plan (DAY_PLAN_HOST). Navigation, page state, realtime and the data layer are fakes; the store of the
// plan is real.

import { render, screen, within } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { describe, expect, it, vi } from 'vitest';
import {
	fakeDayPlanData,
	fakeFlags,
	fakeTickets,
	planAnswer,
	planItem,
	planTicket
} from '$lib/test/day-plan-fake';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import Layout from './+layout.svelte';

const mocks = vi.hoisted(() => ({
	page: {
		url: new URL('http://localhost:3000/tagesplan?tag=2031-05-13'),
		params: {} as Record<string, string>,
		route: { id: '/(app)/tagesplan' }
	},
	data: null as unknown,
	tickets: null as unknown,
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
vi.mock('$lib/stores/day-plan.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	dayPlanData: () => mocks.data,
	dayPlanLive: () => ({
		items: vi.fn(async () => async () => undefined),
		plan: vi.fn(async () => async () => undefined),
		settings: vi.fn(async () => async () => undefined)
	})
}));

useOverlayStubs();

const A1 = 't000000000000a1';

describe('layout of /tagesplan', () => {
	it('loads the plan of the day of the address and follows a change of the area', async () => {
		const data = fakeDayPlanData(
			[planItem('item00000000001', A1, 0)],
			planAnswer({ date: '2031-05-13', editable: false })
		);
		const areaKey = new SvelteMap([['key', 'u:user00000000001']]);
		mocks.data = data;
		mocks.tickets = fakeTickets([planTicket(A1, { title: 'Steuer abgeben' })]);
		mocks.flags = fakeFlags().flags;
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
			expect(data.fetch).toHaveBeenCalledWith(
				{ scope: null, date: '2031-05-13' },
				expect.anything()
			)
		);
		await vi.waitFor(() =>
			expect(screen.getByRole('link', { name: 'Steuer abgeben' })).toBeTruthy()
		);
		const link = screen.getByRole('link', { name: 'Steuer abgeben' });
		expect(link.getAttribute('href')).toBe('/tagesplan/tickets/t000000000000a1?tag=2031-05-13');
		expect((mocks.tickets as { loadOpen: () => void }).loadOpen).toHaveBeenCalled();
		const nav = within(screen.getByRole('navigation', { name: 'Ansicht' }));
		expect(nav.getByRole('link', { name: 'Tagesplan' }).getAttribute('aria-current')).toBe('page');

		areaKey.set('key', 'h:house0000000001');
		await tick();
		await vi.waitFor(() => expect(data.fetch).toHaveBeenCalledTimes(2));
	});
});
