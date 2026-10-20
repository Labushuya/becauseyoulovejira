// The shells of the data access (OF-2): without the outbox (no `offline_ops`, no phone frame) every
// call goes to the data layer with exactly the same arguments as before; with it only a change of
// the status goes through the outbox, everything else as before.

import { describe, expect, it, vi } from 'vitest';
import type { Ticket, TicketSummary } from '$lib/domain/ticket';
import type { TicketDetailData } from '$lib/stores/ticket-detail.svelte';
import type { TicketListData } from '$lib/stores/ticket-list.svelte';
import {
	isStatusPatch,
	offlineTicketDetailData,
	offlineTicketListData,
	type OutboxRoute
} from './offline-data';

type FakeRoute = OutboxRoute & { changeStatus: ReturnType<typeof vi.fn> };

const SUMMARY = {
	id: 'tick00000000001',
	key: 'HAUS-12',
	title: 'Müll rausbringen',
	status: 'open',
	priority: 'medium',
	due: null,
	projectId: null,
	tagIds: [],
	project: null,
	tags: [],
	recurring: false,
	source: null,
	completedAt: null,
	created: '2026-10-01 08:00:00.000Z',
	updated: '2026-10-20 08:00:00.000Z'
} satisfies TicketSummary;
const TICKET: Ticket = { ...SUMMARY, description: 'Text', sourceItem: null };

function listBase() {
	return {
		listOpen: vi.fn(async () => [SUMMARY]),
		searchOpen: vi.fn(async () => []),
		setDone: vi.fn(async () => ({ ...SUMMARY, status: 'done' as const })),
		update: vi.fn(async () => SUMMARY)
	} satisfies TicketListData;
}

function detailBase() {
	return {
		get: vi.fn(async () => TICKET),
		update: vi.fn(async () => TICKET),
		create: vi.fn(async () => TICKET),
		delete: vi.fn(async () => null)
	} satisfies TicketDetailData;
}

function outbox(routes: boolean): FakeRoute {
	return {
		routes: vi.fn(() => routes),
		current: vi.fn(() => null),
		changeStatus: vi.fn(async (ticket: TicketSummary) => ({ ...ticket, status: 'done' }))
	} as unknown as FakeRoute;
}

describe('without the outbox (no offline_ops, no phone frame)', () => {
	it('sends the check mark and every update with the arguments of today', async () => {
		const base = listBase();
		const box = outbox(false);
		const data = offlineTicketListData(base, box, () => SUMMARY);
		await data.setDone(SUMMARY.id, true, 'force');
		await data.update(SUMMARY.id, { status: 'waiting' });
		await data.update(SUMMARY.id, { due: '2026-10-21' }, { expectedUpdated: SUMMARY.updated });
		expect(base.setDone).toHaveBeenCalledWith(SUMMARY.id, true, 'force');
		expect(base.update.mock.calls).toEqual([
			[SUMMARY.id, { status: 'waiting' }, undefined],
			[SUMMARY.id, { due: '2026-10-21' }, { expectedUpdated: SUMMARY.updated }]
		]);
		expect(box.changeStatus).not.toHaveBeenCalled();
	});

	it('keeps the panel the way of today', async () => {
		const base = detailBase();
		const box = outbox(false);
		const data = offlineTicketDetailData(base, box, () => TICKET);
		const options = { completion: 'force' as const };
		await data.update(TICKET.id, { status: 'done' }, options);
		expect(base.update).toHaveBeenCalledWith(TICKET.id, { status: 'done' }, options);
		expect(box.changeStatus).not.toHaveBeenCalled();
		expect(data.get).toBe(base.get);
	});
});

describe('with the outbox', () => {
	it('sends the check mark, a status of a cell and its "Rückgängig" through the outbox', async () => {
		const base = listBase();
		const box = outbox(true);
		const children = () => ['tick00000000002'];
		const data = offlineTicketListData(base, box, () => SUMMARY, children);
		await data.setDone(SUMMARY.id, true, 'complete_children');
		await data.setDone(SUMMARY.id, false);
		await data.update(SUMMARY.id, { status: 'waiting' });
		expect(box.changeStatus.mock.calls.map((call) => call[1])).toEqual([
			{ status: 'done', completion: 'complete_children', children: ['tick00000000002'] },
			{ status: 'open' },
			{ status: 'waiting' }
		]);
		expect(base.setDone).not.toHaveBeenCalled();
		expect(base.update).not.toHaveBeenCalled();
	});

	it('keeps every other change and a ticket it does not know the way of today', async () => {
		const base = listBase();
		const box = outbox(true);
		const data = offlineTicketListData(base, box, () => null);
		await data.setDone(SUMMARY.id, true);
		await data.update(SUMMARY.id, { priority: 'high' });
		await data.update(SUMMARY.id, { status: 'open', detachSeries: true });
		expect(base.setDone).toHaveBeenCalledTimes(1);
		expect(base.update).toHaveBeenCalledTimes(2);
		expect(box.changeStatus).not.toHaveBeenCalled();
	});

	it('takes the status of the panel and the full view, with the ticket they show', async () => {
		const base = detailBase();
		const box = outbox(true);
		const data = offlineTicketDetailData(base, box, () => TICKET);
		await data.update(TICKET.id, { status: 'done' }, { completion: 'force' });
		await data.update(TICKET.id, { description: 'Neu' }, { expectedUpdated: TICKET.updated });
		expect(box.changeStatus).toHaveBeenCalledWith(TICKET, { status: 'done', completion: 'force' });
		expect(base.update).toHaveBeenCalledTimes(1);
	});

	it('names only a plain status as a change of the outbox', () => {
		expect(isStatusPatch({ status: 'done' })).toBe(true);
		expect(isStatusPatch({ status: 'done' }, { completion: 'force' })).toBe(true);
		expect(isStatusPatch({ status: 'done', priority: 'high' })).toBe(false);
		expect(isStatusPatch({ status: 'done' }, { expectedUpdated: 'x' })).toBe(false);
		expect(isStatusPatch({ title: 'x' })).toBe(false);
	});
});
