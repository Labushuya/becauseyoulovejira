// The outbox and the answer of this device (package "Einschalten", ADR-0074 addendum "Zustimmung je
// Gerät"): new changes go through it only in the phone frame **and** after "Ja, merken"; before that
// it never creates the storage of the device. Changes already kept are sent in any case, also after
// "Nein", as outside of the frame.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutboxAction } from '$lib/domain/offline';
import type { Status } from '$lib/domain/status';
import type { Ticket } from '$lib/domain/ticket';
import type { FlagInput } from '$lib/stores/flags.svelte';
import { ConnectivityStore } from './connectivity.svelte';
import { OutboxStore, type OutboxDeps } from './outbox.svelte';
import { MemoryOutboxStorage, type OutboxStorage } from './outbox-storage';

const NOW = Date.UTC(2026, 9, 31, 12, 30, 0);
const USER = 'user00000000001';
const OPS = { version: 1, kinds: ['ticket.update'] as const };
const A = 'tick00000000001';
const B = 'tick00000000002';

function ticket(id: string, status: Status = 'open'): Ticket {
	return {
		id,
		key: `HAUS-${id.slice(-2)}`,
		title: `Ticket ${id.slice(-2)}`,
		status,
		priority: 'medium',
		due: null,
		projectId: null,
		tagIds: [],
		project: null,
		tags: [],
		recurring: false,
		source: null,
		scope: `u:${USER}`,
		completedAt: null,
		created: '2026-10-01 08:00:00.000Z',
		updated: '2026-10-31 08:00:00.000Z',
		description: '',
		sourceItem: null
	};
}

function stored(): OutboxAction {
	return {
		v: 1,
		op: 'zzzzzzzzzzzzzzzzzzz1',
		seq: 1,
		user: USER,
		scope: `u:${USER}`,
		kind: 'ticket.update',
		target: A,
		dependsOn: [],
		payload: { status: 'done' },
		expected: { status: 'open' },
		key: 'HAUS-01',
		title: 'Ticket 01',
		createdAt: NOW - 60_000,
		state: 'queued',
		attempts: 0,
		nextAttemptAt: 0
	};
}

/**
 * The storage of the device with every call written down: none means the database of the browser was
 * never opened, so never created (IdbOutboxStorage opens it on its first call).
 */
function watched(inner: MemoryOutboxStorage): { storage: OutboxStorage; calls: string[] } {
	const calls: string[] = [];
	function noted<T>(name: string, run: () => Promise<T>): Promise<T> {
		calls.push(name);
		return run();
	}
	const storage: OutboxStorage = {
		list: () => noted('list', () => inner.list()),
		put: (action) => noted('put', () => inner.put(action)),
		remove: (ops) => noted('remove', () => inner.remove(ops)),
		swap: (op, matches, next) => noted('swap', () => inner.swap(op, matches, next)),
		swapNoting: (op, matches, next, user, note) =>
			noted('swapNoting', () => inner.swapNoting(op, matches, next, user, note)),
		notices: (user, change) => noted('notices', () => inner.notices(user, change)),
		nextSeq: () => noted('nextSeq', () => inner.nextSeq()),
		lease: (tab, now, ms) => noted('lease', () => inner.lease(tab, now, ms)),
		release: (tab) => noted('release', () => inner.release(tab))
	};
	return { storage, calls };
}

function harness(options: {
	storage: OutboxStorage;
	exists: boolean | (() => Promise<boolean>);
	consent: boolean;
	frame?: boolean;
}) {
	const connectivity = new ConnectivityStore(async () => true);
	const send = vi.fn<OutboxDeps['send']>(async (action) =>
		ticket(action.target, action.payload.status)
	);
	const { exists } = options;
	const outbox = new OutboxStore({
		storage: options.storage,
		exists: typeof exists === 'function' ? exists : async () => exists,
		connectivity,
		send,
		get: async (id) => ticket(id),
		tab: 'tab-a',
		random: () => 0.5,
		channel: null
	});
	const flags = { show: vi.fn<(input: FlagInput) => string>(() => 'flag'), dismiss: vi.fn() };
	outbox.attach(USER);
	outbox.setSupport(OPS);
	outbox.setConsent(options.consent);
	outbox.setFrame(options.frame ?? true);
	const stop = outbox.connect({ upsert: vi.fn(), flags, sessionEnded: vi.fn() });
	return { outbox, send, stop };
}

async function settle() {
	await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('outbox: the answer of this device (Einschalten)', () => {
	it('is armed in the phone frame only after "Ja, merken"', async () => {
		const h = harness({ storage: new MemoryOutboxStorage(), exists: true, consent: true });
		await settle();
		expect(h.outbox.armed).toBe(true);
		expect(h.outbox.routes(A)).toBe(true);
		expect(h.outbox.watching).toBe(true);
		const answer = await h.outbox.changeStatus(ticket(A), { status: 'done' });
		expect(answer.status).toBe('done');
		expect(h.send.mock.calls[0]?.[1]).toEqual({ opId: expect.any(String) });
		h.stop();
	});

	it('takes no new change without the answer "yes" and never creates the storage of the device', async () => {
		const { storage, calls } = watched(new MemoryOutboxStorage());
		const h = harness({ storage, exists: false, consent: false });
		await settle();
		expect(h.outbox.armed).toBe(false);
		expect(h.outbox.routes(A)).toBe(false);
		expect(h.outbox.takes('ticket')).toBe(false);
		expect(h.outbox.watching).toBe(false);
		expect(calls).toEqual([]);
		h.stop();
	});

	it('arms once the device says "yes", and stops taking new changes after "no"', async () => {
		const { storage, calls } = watched(new MemoryOutboxStorage());
		const h = harness({ storage, exists: false, consent: false });
		await settle();
		expect(calls).toEqual([]);
		h.outbox.setConsent(true);
		await settle();
		expect(h.outbox.armed).toBe(true);
		expect(calls).toContain('list');
		h.outbox.setConsent(false);
		await settle();
		expect(h.outbox.armed).toBe(false);
		expect(h.outbox.routes(B)).toBe(false);
		expect(h.outbox.watching).toBe(false);
		h.stop();
	});

	// The question appears once the server answered; "Ja, merken" may come before the browser says
	// whether it has the storage (indexedDB.databases()).
	it('reads the device when "yes" comes while the browser still says whether it has the storage', async () => {
		let say: (there: boolean) => void = () => undefined;
		const exists = () =>
			new Promise<boolean>((resolve) => {
				say = resolve;
			});
		const { storage, calls } = watched(new MemoryOutboxStorage());
		const h = harness({ storage, exists, consent: false });
		await settle();
		h.outbox.setConsent(true);
		say(false);
		await settle();
		expect(calls).toContain('list');
		expect(h.outbox.armed).toBe(true);
		h.stop();
	});

	it('still sends the changes kept before, also after "Nein"', async () => {
		const storage = new MemoryOutboxStorage();
		await storage.put(stored());
		const h = harness({ storage, exists: true, consent: false });
		await settle();
		expect(h.outbox.armed).toBe(false);
		expect(h.send).toHaveBeenCalledTimes(1);
		expect(h.send.mock.calls[0]?.[0].target).toBe(A);
		expect(storage.entries.size).toBe(0);
		// A new change of another ticket goes the way of today.
		expect(h.outbox.routes(B)).toBe(false);
		h.stop();
	});
});
