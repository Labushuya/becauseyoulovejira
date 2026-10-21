// Corrections of the outbox (OF-2b, ADR-0074 addendum OF-2b), each shown first against the state of
// OF-2: a change after a send without an answer and taking such a change back (H1, H2) against a
// server that takes a change, loses the answer and answers a known identifier like `answerReplay`
// (the record as it is now, without comparing the content); the race of marking and taking in with
// a storage whose writes finish on command; nothing created without the capability (G1); outside
// of the frame only behind a waiting change (G2); the account of the client (G3); limits and the
// clock (G4); a failing storage (G6b); a change behind a discarded one (G6c). The scaffold (fake
// server, storages, harness) lives in $lib/test/outbox-fake.ts since OF-3, which reuses it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import {
	AUTO_SEND_MS,
	DEVICE_FUTURE_MS,
	OUTBOX_MAX_ACTIONS,
	STALE_SENDING_MS,
	type OutboxAction
} from '$lib/domain/offline';
import {
	A,
	B,
	CONFLICT,
	FailingStorage,
	HeldStorage,
	NEXT_OP,
	NOW,
	OPS,
	OTHER,
	STORAGE_FAILED,
	STORED_OP,
	channelPair,
	fakeServer,
	goOffline,
	goOnline,
	harness,
	settle,
	stored,
	ticket
} from '$lib/test/outbox-fake';
import type { OutboxChannel } from './outbox.svelte';
import { MemoryOutboxStorage } from './outbox-storage';

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('a change after a send without an answer (H1)', () => {
	it('becomes an action of its own with a new identifier, so the server ends on the last wish', async () => {
		const h = harness();
		await settle();
		// The server takes the first change, but its answer is lost, and the check fails too.
		h.server.lose = 1;
		h.server.health = false;
		const first = await h.outbox.changeStatus(ticket(A), { status: 'in_progress' });
		expect(first.status).toBe('in_progress');
		await settle();
		expect(h.outbox.offline).toBe(true);
		expect(h.server.status.get(A)).toBe('in_progress');
		const second = await h.outbox.changeStatus(ticket(A, 'in_progress'), { status: 'done' });
		expect(second.status).toBe('done');
		await goOnline(h);
		expect(h.server.status.get(A)).toBe('done');
		expect(new Set(h.server.sent).size).toBe(2);
		expect(h.outbox.count).toBe(0);
	});

	it('never takes a change into an action that is being marked for sending (race in one tab)', async () => {
		const storage = new HeldStorage();
		const h = harness({ storage });
		await settle();
		await goOffline(h);
		await h.outbox.changeStatus(ticket(A), { status: 'in_progress' });
		// The connection is back: the worker marks the kept change and waits for the storage.
		storage.holding = true;
		h.server.health = true;
		await h.connectivity.check();
		await settle();
		// Meanwhile the next change of the same ticket.
		const change = h.outbox.changeStatus(ticket(A, 'in_progress'), { status: 'done' });
		await settle();
		storage.open();
		await change;
		await settle();
		expect(h.server.status.get(A)).toBe('done');
		expect(new Set(h.server.sent).size).toBe(2);
		expect(h.outbox.count).toBe(0);
	});

	it('never takes a change into an action another tab marked before this one read the device again', async () => {
		const storage = new HeldStorage();
		await storage.put(stored({ payload: { status: 'in_progress' } }));
		const shared = fakeServer();
		const [one, two] = channelPair();
		// Tab A takes the lease and marks the kept change; tab B still holds the state before.
		storage.holding = true;
		const first = harness({ storage, tab: 'tab-a', channel: one, shared });
		await settle();
		const second = harness({ storage, tab: 'tab-b', channel: two, shared });
		await settle();
		const change = second.outbox.changeStatus(ticket(A, 'in_progress'), { status: 'done' });
		await settle();
		storage.open();
		await change;
		await settle();
		await vi.advanceTimersByTimeAsync(STALE_SENDING_MS);
		expect(shared.server.status.get(A)).toBe('done');
		expect(new Set(shared.server.sent).size).toBe(2);
		expect(first.outbox.count + second.outbox.count).toBe(0);
		expect(storage.entries.size).toBe(0);
	});
});

describe('taking back a change sent without an answer (H2)', () => {
	it('becomes a counter action with a new identifier, based on the sent wish', async () => {
		const h = harness();
		await settle();
		h.server.lose = 1;
		h.server.health = false;
		await h.outbox.changeStatus(ticket(A), { status: 'done' });
		await settle();
		expect(h.server.status.get(A)).toBe('done');
		const back = await h.outbox.changeStatus(ticket(A, 'done'), { status: 'open' });
		expect(back.status).toBe('open');
		await goOnline(h);
		expect(h.server.status.get(A)).toBe('open');
		const ops = [...new Set(h.server.sent)];
		expect(ops).toHaveLength(2);
		const counter = h.send.mock.calls.find((call) => call[1].opId === ops[1]);
		expect(counter?.[1]).toMatchObject({ expected: { status: 'done' } });
		expect(counter?.[0].payload).toEqual({ status: 'open' });
	});

	it('still only drops a kept change that never left the device', async () => {
		const h = harness();
		await settle();
		await goOffline(h);
		await h.outbox.changeStatus(ticket(A), { status: 'done' });
		await h.outbox.changeStatus(ticket(A, 'done'), { status: 'open' });
		expect(h.outbox.count).toBe(0);
		await goOnline(h);
		expect(h.send).not.toHaveBeenCalled();
	});
});

describe('without the capability (G1)', () => {
	it('asks for the identifier of the tab and opens the channel only on its first watch', async () => {
		const tab = vi.fn(() => 'tab-x');
		const channel = vi.fn((): OutboxChannel | null => null);
		const h = harness({ support: null, tab, channel });
		await settle();
		expect(h.outbox.watching).toBe(false);
		expect(tab).not.toHaveBeenCalled();
		expect(channel).not.toHaveBeenCalled();
		h.outbox.setSupport(OPS);
		await settle();
		expect(h.outbox.watching).toBe(true);
		expect(tab).toHaveBeenCalledTimes(1);
		expect(channel).toHaveBeenCalledTimes(1);
	});
});

describe('outside of the frame (G2)', () => {
	it('goes the way of before OF-2 behind a change that waits for a decision', async () => {
		const storage = new MemoryOutboxStorage();
		await storage.put(stored({ state: 'conflict', outcome: CONFLICT }));
		const h = harness({ storage, frame: false });
		await settle();
		expect(h.outbox.watching).toBe(true);
		expect(h.outbox.routes(A)).toBe(false);
	});

	it('keeps the order behind a change that waits to be sent', async () => {
		const storage = new MemoryOutboxStorage();
		await storage.put(stored({ nextAttemptAt: NOW + 60_000 }));
		const h = harness({ storage, frame: false });
		await settle();
		expect(h.outbox.routes(A)).toBe(true);
		expect(h.outbox.routes(B)).toBe(false);
	});
});

describe('the account (G3)', () => {
	it('sends nothing while the client is signed in with another account, neither kept nor at once', async () => {
		const storage = new MemoryOutboxStorage();
		await storage.put(stored());
		const h = harness({ storage, account: () => OTHER });
		await settle();
		expect(h.send).not.toHaveBeenCalled();
		expect(storage.entries.size).toBe(1);
		const change = h.outbox.changeStatus(ticket(B), { status: 'done' });
		await expect(change).rejects.toMatchObject({ kind: 'session' });
		expect(h.send).not.toHaveBeenCalled();
	});

	it('"Abmelden" reads the changes of the account from the device when the tab never read it', async () => {
		const storage = new MemoryOutboxStorage();
		await storage.put(stored());
		await storage.put(stored({ op: NEXT_OP, seq: 2, target: B }));
		await storage.put(stored({ op: 'zzzzzzzzzzzzzzzzzzz3', seq: 3, user: OTHER }));
		const h = harness({ storage, support: null });
		await settle();
		expect(h.outbox.count).toBe(0);
		expect(h.outbox.readsOnSignOut).toBe(true);
		expect(await h.outbox.keptOfAccount()).toBe(2);
		await h.outbox.clearUser();
		expect([...storage.entries.keys()]).toEqual(['zzzzzzzzzzzzzzzzzzz3']);
	});
});

describe('limits and the clock (G4)', () => {
	async function fullStorage(last?: OutboxAction) {
		const storage = new MemoryOutboxStorage();
		const count = last === undefined ? OUTBOX_MAX_ACTIONS : OUTBOX_MAX_ACTIONS - 1;
		for (let index = 0; index < count; index++) {
			const number = String(index).padStart(11, '0');
			await storage.put(
				stored({ op: `op${number}0000000`, seq: index, target: `tick${number}`, state: 'conflict' })
			);
		}
		if (last !== undefined) await storage.put(last);
		return storage;
	}

	it('sends a change at once without keeping it when the device is full and the connection stands', async () => {
		const storage = await fullStorage();
		const h = harness({ storage });
		await settle();
		const answer = await h.outbox.changeStatus(ticket('tick99999999999'), { status: 'done' });
		expect(answer.status).toBe('done');
		expect(h.send).toHaveBeenCalledTimes(1);
		expect(storage.entries.size).toBe(OUTBOX_MAX_ACTIONS);
	});

	it('takes a change into a waiting one also when the device is full', async () => {
		const waiting = stored({ op: NEXT_OP, seq: 999, nextAttemptAt: NOW + 60_000 });
		const storage = await fullStorage(waiting);
		const h = harness({ storage });
		await settle();
		await goOffline(h);
		const shown = await h.outbox.changeStatus(ticket(A), { status: 'in_progress' });
		expect(shown.status).toBe('in_progress');
		expect(storage.entries.size).toBe(OUTBOX_MAX_ACTIONS);
		expect(h.outbox.actions.find((action) => action.op === NEXT_OP)?.payload).toEqual({
			status: 'in_progress'
		});
	});

	it('treats a change from the future like an old one: no sending, a decision, and "Verwerfen" works', async () => {
		const storage = new MemoryOutboxStorage();
		await storage.put(stored({ createdAt: NOW + DEVICE_FUTURE_MS + 1 }));
		await storage.put(
			stored({
				op: NEXT_OP,
				seq: 2,
				target: B,
				state: 'sending',
				sendingSince: NOW + DEVICE_FUTURE_MS + 1
			})
		);
		const h = harness({ storage });
		await settle();
		expect(h.send).not.toHaveBeenCalled();
		expect(h.outbox.expired.map((action) => action.op)).toEqual([STORED_OP, NEXT_OP]);
		expect(h.outbox.expired.map((action) => action.outcome?.code)).toEqual(['clock', 'clock']);
		await h.outbox.discard(STORED_OP);
		await h.outbox.discard(NEXT_OP);
		expect(h.outbox.count).toBe(0);
		expect(storage.entries.size).toBe(0);
	});

	it('lets an orphaned change "sending" age as well', async () => {
		const storage = new MemoryOutboxStorage();
		const old = NOW - AUTO_SEND_MS - 1;
		await storage.put(stored({ state: 'sending', sendingSince: old, createdAt: old }));
		const h = harness({ storage });
		await settle();
		expect(h.send).not.toHaveBeenCalled();
		expect(h.outbox.expired.map((action) => action.op)).toEqual([STORED_OP]);
	});
});

describe('a failing storage of the device (G6b)', () => {
	it('shows an error flag instead of an uncaught rejection while sending', async () => {
		const storage = new FailingStorage();
		await storage.put(stored());
		storage.failing = true;
		const h = harness({ storage });
		await settle();
		expect(h.flags.show).toHaveBeenCalledWith(
			expect.objectContaining({ tone: 'error', title: STORAGE_FAILED })
		);
	});

	it('shows an error flag on "Verwerfen" and resolves', async () => {
		const storage = new FailingStorage();
		await storage.put(stored({ state: 'conflict', outcome: CONFLICT }));
		const h = harness({ storage });
		await settle();
		storage.failing = true;
		await expect(h.outbox.discard(STORED_OP)).resolves.toBeUndefined();
		expect(h.flags.show).toHaveBeenCalledWith(
			expect.objectContaining({ tone: 'error', title: STORAGE_FAILED })
		);
	});
});

describe('a change behind a discarded one (G6c)', () => {
	it('is based on the last known state of the server once the conflict before it is discarded', async () => {
		const storage = new MemoryOutboxStorage();
		await storage.put(stored({ state: 'conflict', outcome: CONFLICT }));
		await storage.put(
			stored({
				op: NEXT_OP,
				seq: 2,
				dependsOn: [STORED_OP],
				payload: { status: 'in_progress' },
				expected: { status: 'done' }
			})
		);
		const h = harness({ storage });
		await settle();
		expect(h.send).not.toHaveBeenCalled();
		h.server.status.set(A, 'waiting');
		await h.outbox.discard(STORED_OP);
		await settle();
		expect(h.send).toHaveBeenCalledTimes(1);
		expect(h.send.mock.calls[0]?.[1]).toMatchObject({
			opId: NEXT_OP,
			expected: { status: 'waiting' }
		});
		expect(h.server.status.get(A)).toBe('in_progress');
	});

	it('is based on the ticket as the server sent it after a refusal', async () => {
		const h = harness();
		await settle();
		await goOffline(h);
		await h.outbox.changeStatus(ticket(A), { status: 'done' });
		h.server.status.set(A, 'waiting');
		h.send.mockRejectedValueOnce(new DataError('forbidden', { status: 403 }));
		await goOnline(h);
		const refused = h.outbox.refusals[0]?.op ?? '';
		await goOffline(h);
		await h.outbox.changeStatus(ticket(A, 'waiting'), { status: 'in_progress' });
		const behind = h.outbox.waiting[0];
		expect(behind?.expected).toEqual({ status: 'done' });
		await h.outbox.discard(refused);
		await goOnline(h);
		const last = h.send.mock.calls.at(-1);
		expect(last?.[1]).toMatchObject({ opId: behind?.op, expected: { status: 'waiting' } });
		expect(h.server.status.get(A)).toBe('in_progress');
	});
});
