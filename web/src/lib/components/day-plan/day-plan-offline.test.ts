// The page "Tagesplan" with the outbox (OF-3, ADR-0074 addendum OF-3) in jsdom: without a connection a
// tap on the check mark of an entry shows it checked at once, and the entry carries the mark "Noch
// nicht übertragen" after its key; once sent, the mark goes. The real store on the shell of a real
// outbox over the fake server of $lib/test/outbox-fake.ts.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { offlineDayPlanData } from '$lib/offline/offline-data';
import { DayPlanStore } from '$lib/stores/day-plan.svelte';
import type { LiveSource } from '$lib/stores/realtime';
import {
	fakeDayPlanData,
	fakeFlags,
	fakeSession,
	fakeTickets,
	planAnswer,
	planItem,
	planTicket
} from '$lib/test/day-plan-fake';
import { ALL_OPS, NOW, goOffline, goOnline, harness, settle } from '$lib/test/outbox-fake';
import OutboxHostHarness from '$lib/test/OutboxHostHarness.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
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
const I1 = 'item00000000001';

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('an entry of the day plan without a connection (OF-3)', () => {
	it('is checked with one tap and marked as not sent yet, until it is sent', async () => {
		const h = harness({ support: ALL_OPS });
		await settle();
		const answer = planAnswer();
		const base = fakeDayPlanData([planItem(I1, A1, 0)], answer);
		const store: DayPlanStore = new DayPlanStore(
			offlineDayPlanData(base, h.outbox, (id) => store.entryOf(id)),
			fakeTickets([planTicket(A1, { title: 'Steuer abgeben' })]),
			fakeSession(),
			{ flags: fakeFlags().flags, scope: () => answer.scope, overlay: h.outbox }
		);
		// Connected like the layout of /tagesplan, with realtime that brings nothing.
		const quiet = async () => async () => undefined;
		const tickets = { tickets: quiet, reconnected: quiet } as unknown as LiveSource;
		store.connect(tickets, { items: quiet, plan: quiet, settings: quiet });
		store.show(null);
		await vi.waitFor(() => expect(store.state).toBe('ready'));
		render(OutboxHostHarness, {
			props: { outbox: h.outbox, host: DAY_PLAN_HOST, component: DayPlanView, props: { store } }
		});
		await tick();
		await goOffline(h);

		const row = screen.getByText('Steuer abgeben').closest('li') as HTMLElement;
		const box = within(row).getByRole('checkbox', { name: 'TASK-a1 erledigt' }) as HTMLInputElement;
		expect(box.checked).toBe(false);
		await fireEvent.click(box);
		await settle();
		await tick();
		expect(box.checked).toBe(true);
		expect(base.check).not.toHaveBeenCalled();
		expect(within(row).getByTitle('Noch nicht übertragen')).toBeTruthy();
		expect(row.querySelector('.key')?.textContent).toBe('TASK-a1, Noch nicht übertragen');

		await goOnline(h);
		await tick();
		expect(h.sendDayPlan).toHaveBeenCalledTimes(1);
		expect(within(row).queryByTitle('Noch nicht übertragen')).toBeNull();
		expect(box.checked).toBe(true);
	});
});
