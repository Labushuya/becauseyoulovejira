// The outbox with a storage in memory, a fake server and fake timers (OF-2, ADR-0074 addendum
// OF-2): it works only with `offline_ops` and in the phone frame; a change with a connection goes
// at once with its identifier only; one without an answer is kept and sent later with the time of
// the device and the value before, in order and with the same identifier; every code of the
// server; 48 hours and 7 days; the account it belongs to; two tabs on one device.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import { AUTO_SEND_MS, KEEP_MS, OUTBOX_MAX_ACTIONS, type OutboxAction } from '$lib/domain/offline';
import type { Status } from '$lib/domain/status';
import type { Ticket } from '$lib/domain/ticket';
import type { FlagInput } from '$lib/stores/flags.svelte';
import { ConnectivityStore } from './connectivity.svelte';
import { OutboxFullError, OutboxStore, type OutboxChannel, type OutboxDeps } from './outbox.svelte';
import { MemoryOutboxStorage } from './outbox-storage';

// 2026-10-20 14:30 in Berlin (CEST).
const NOW = Date.UTC(2026, 9, 20, 12, 30, 0);
const USER = 'user00000000001';
const OTHER = 'user00000000002';
const OPS = { version: 1, kinds: ['ticket.update'] as const };
const SAVED_AT = '2026-10-20 12:31:00.000Z';
const FIRST_OP = 'aaaaaaaaaaaaaaaaaaaa';
const STORED_OP = 'zzzzzzzzzzzzzzzzzzz1';

function ticket(id: string, status: Status = 'open', updated = '2026-10-20 08:00:00.000Z'): Ticket {
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
		completedAt: status === 'done' ? SAVED_AT : null,
		created: '2026-10-01 08:00:00.000Z',
		updated,
		description: '',
		sourceItem: null
	};
}

const A = 'tick00000000001';
const B = 'tick00000000002';

/** Distinct identifiers: the n-th one is the n-th letter twenty times. */
function letters() {
	let call = 0;
	return (bytes: Uint8Array<ArrayBuffer>) => {
		bytes.fill(call++ % 26);
		return bytes;
	};
}

function stored(overrides: Partial<OutboxAction> = {}): OutboxAction {
	return {
		v: 1,
		op: STORED_OP,
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
		nextAttemptAt: 0,
		...overrides
	};
}

/** A refusal of the server at one field, as the data layer reports it. */
function refusal(field: string, code: string, params?: Record<string, unknown>): DataError {
	const fields = { [field]: { code, message: '', ...(params && { params }) } };
	return new DataError('validation', { status: 400, fields });
}

/** A channel between the tabs of one device. */
function channelPair(): [OutboxChannel, OutboxChannel] {
	const listeners: Array<Set<() => void>> = [new Set(), new Set()];
	const end = (mine: number): OutboxChannel => ({
		post: () => {
			for (const listener of listeners[1 - mine] ?? []) listener();
		},
		listen: (onmessage) => {
			listeners[mine]?.add(onmessage);
			return () => listeners[mine]?.delete(onmessage);
		}
	});
	return [end(0), end(1)];
}

interface Options {
	storage?: MemoryOutboxStorage;
	support?: typeof OPS | null;
	frame?: boolean;
	user?: string | null;
	tab?: string;
	channel?: OutboxChannel | null;
	exists?: () => Promise<boolean>;
}

function harness(options: Options = {}) {
	const storage = options.storage ?? new MemoryOutboxStorage();
	const server = { reachable: true };
	const connectivity = new ConnectivityStore(async () => server.reachable);
	const send = vi.fn<OutboxDeps['send']>(async (action) =>
		ticket(action.target, action.payload.status, SAVED_AT)
	);
	const get = vi.fn<OutboxDeps['get']>(async (id) =>
		ticket(id, 'waiting', '2026-10-20 12:10:00.000Z')
	);
	const outbox = new OutboxStore({
		storage,
		connectivity,
		send,
		get,
		tab: options.tab ?? 'tab-a',
		random: () => 0.5,
		fill: letters(),
		channel: options.channel ?? null,
		...(options.exists !== undefined && { exists: options.exists })
	});
	const flags = { show: vi.fn<(input: FlagInput) => string>(() => 'flag'), dismiss: vi.fn() };
	const sink = { upsert: vi.fn(), flags, sessionEnded: vi.fn(), childrenOf: vi.fn(() => [B]) };
	outbox.attach(options.user === undefined ? USER : options.user);
	outbox.setSupport(options.support === undefined ? OPS : options.support);
	// Since the package "Einschalten" the device has to agree as well (outbox-consent.test.ts).
	outbox.setConsent(true);
	outbox.setFrame(options.frame ?? true);
	const stop = outbox.connect(sink);
	return { outbox, storage, connectivity, server, send, get, sink, flags, stop };
}

type Harness = ReturnType<typeof harness>;

async function settle() {
	await vi.advanceTimersByTimeAsync(0);
}

/** The connection goes: the next check of the server fails. */
async function goOffline(h: Harness) {
	h.server.reachable = false;
	await h.connectivity.check();
	expect(h.outbox.offline).toBe(true);
}

/** The connection comes back: the next check of the server answers. */
async function goOnline(h: Harness) {
	h.server.reachable = true;
	await h.connectivity.check();
	await settle();
}

/** The fields of the outbox in the n-th request. */
function fieldsOf(h: Harness, index: number) {
	return h.send.mock.calls[index]?.[1];
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('when the outbox works (ADR-0074 §7, addendum OF-2)', () => {
	it('does nothing without offline_ops: no storage, no watching, every change the way of today', async () => {
		const storage = new MemoryOutboxStorage();
		const list = vi.spyOn(storage, 'list');
		const h = harness({ storage, support: null });
		await settle();
		expect(h.outbox.armed).toBe(false);
		expect(h.outbox.routes(A)).toBe(false);
		expect(h.outbox.watching).toBe(false);
		expect(list).not.toHaveBeenCalled();
		expect(h.send).not.toHaveBeenCalled();
	});

	it('takes new changes only in the phone frame, but sends kept ones also outside of it', async () => {
		const storage = new MemoryOutboxStorage();
		await storage.put(stored());
		const h = harness({ storage, frame: false });
		await settle();
		expect(h.outbox.armed).toBe(false);
		expect(h.outbox.routes(B)).toBe(false);
		expect(h.send).toHaveBeenCalledTimes(1);
		expect(storage.entries.size).toBe(0);
	});

	it('does not create the storage outside of the frame when the device has none', async () => {
		const storage = new MemoryOutboxStorage();
		const list = vi.spyOn(storage, 'list');
		const h = harness({ storage, frame: false, exists: async () => false });
		await settle();
		expect(list).not.toHaveBeenCalled();
		expect(h.outbox.watching).toBe(false);
	});

	// NA-1 (C2-1 of the review of MO-7c2): outside of the frame (a PC, a wide window) the outbox watches
	// only while kept changes wait, and only then does it say "offline"; the calendar locks moving a due
	// date by it (kalender/+layout.svelte). Without kept changes it never says so there.
	it('says "offline" outside of the frame only while kept changes wait (NA-1, C2-1)', async () => {
		const storage = new MemoryOutboxStorage();
		await storage.put(stored());
		const h = harness({ storage, frame: false });
		h.server.reachable = false;
		h.send.mockRejectedValue(new DataError('network'));
		await settle();
		await h.connectivity.check();
		expect(h.outbox.armed).toBe(false);
		expect(h.outbox.count).toBe(1);
		expect(h.outbox.watching).toBe(true);
		expect(h.outbox.offline).toBe(true);

		const empty = harness({ frame: false });
		empty.server.reachable = false;
		await settle();
		await empty.connectivity.check();
		expect(empty.outbox.watching).toBe(false);
		expect(empty.outbox.offline).toBe(false);
		h.stop();
		empty.stop();
	});
});

describe('a change with a connection', () => {
	it('goes at once with its identifier only and leaves nothing behind', async () => {
		const h = harness();
		await settle();
		const answer = await h.outbox.changeStatus(ticket(A), { status: 'done' });
		expect(answer.status).toBe('done');
		expect(h.send).toHaveBeenCalledTimes(1);
		expect(fieldsOf(h, 0)).toEqual({ opId: FIRST_OP });
		expect(h.storage.entries.size).toBe(0);
		expect(h.outbox.isPending(A)).toBe(false);
	});

	it('throws a refusal of the server as today and keeps nothing', async () => {
		const h = harness();
		await settle();
		h.send.mockRejectedValueOnce(refusal('status', 'validation_recurrence_open_instance'));
		const change = h.outbox.changeStatus(ticket(A), { status: 'open' });
		await expect(change).rejects.toMatchObject({ kind: 'validation' });
		expect(h.storage.entries.size).toBe(0);
	});

	it('keeps the change when the answer does not come, and shows it at once as provisional', async () => {
		const h = harness();
		await settle();
		h.send.mockRejectedValueOnce(new DataError('network'));
		h.server.reachable = false;
		const shown = await h.outbox.changeStatus(ticket(A), { status: 'done' });
		expect(shown.status).toBe('done');
		expect(h.outbox.isPending(A)).toBe(true);
		expect([...h.storage.entries.values()]).toMatchObject([{ state: 'queued', target: A }]);
		await settle();
		expect(h.outbox.offline).toBe(true);
	});
});

describe('kept changes', () => {
	it('are sent without a word once the connection is back, with the time of the device and the value before', async () => {
		const h = harness();
		await settle();
		await goOffline(h);
		const shown = await h.outbox.changeStatus(ticket(A), { status: 'done' });
		expect(shown.status).toBe('done');
		expect(h.send).not.toHaveBeenCalled();
		await goOnline(h);
		expect(h.send).toHaveBeenCalledTimes(1);
		expect(fieldsOf(h, 0)).toEqual({
			opId: FIRST_OP,
			expected: { status: 'open' },
			clientAt: new Date(NOW).toISOString()
		});
		expect(h.storage.entries.size).toBe(0);
		const answer = expect.objectContaining({ id: A, status: 'done' });
		expect(h.sink.upsert).toHaveBeenCalledWith(answer);
		expect(h.flags.show).toHaveBeenCalledWith({ tone: 'success', title: '1 Änderung übertragen.' });
	});

	it('keep their identifier on every attempt, so the server writes once (no duplicate after a break)', async () => {
		const h = harness();
		await settle();
		h.send.mockRejectedValueOnce(new DataError('network'));
		h.server.reachable = false;
		await h.outbox.changeStatus(ticket(A), { status: 'done' });
		await settle();
		await goOnline(h);
		expect(h.send).toHaveBeenCalledTimes(2);
		expect(fieldsOf(h, 1)?.opId).toBe(fieldsOf(h, 0)?.opId);
	});

	it('take a later change of the same ticket in, and go when the value is the one before again', async () => {
		const h = harness();
		await settle();
		await goOffline(h);
		await h.outbox.changeStatus(ticket(A), { status: 'in_progress' });
		await h.outbox.changeStatus(ticket(A), { status: 'done' });
		const kept = [...h.storage.entries.values()];
		expect(kept).toMatchObject([{ payload: { status: 'done' }, expected: { status: 'open' } }]);
		const back = await h.outbox.changeStatus(ticket(A, 'done'), { status: 'open' });
		expect(back.status).toBe('open');
		expect(h.storage.entries.size).toBe(0);
		await goOnline(h);
		expect(h.send).not.toHaveBeenCalled();
	});

	it('go in the order they were made', async () => {
		const h = harness();
		await settle();
		await goOffline(h);
		await h.outbox.changeStatus(ticket(B), { status: 'done' });
		await h.outbox.changeStatus(ticket(A), { status: 'waiting' });
		await goOnline(h);
		expect(h.send.mock.calls.map((call) => call[0].target)).toEqual([B, A]);
		expect(h.flags.show).toHaveBeenCalledWith({
			tone: 'success',
			title: '2 Änderungen übertragen.'
		});
	});

	it('lie over the ticket for the stores and leave once sent', async () => {
		const h = harness();
		await settle();
		await goOffline(h);
		await h.outbox.changeStatus(ticket(A), { status: 'done' });
		expect(h.outbox.apply(ticket(A)).status).toBe('done');
		expect(h.outbox.holds(A)).toBe(true);
		expect(h.outbox.current(A)?.status).toBe('done');
		await goOnline(h);
		expect(h.outbox.apply(ticket(A)).status).toBe('open');
		expect(h.outbox.markOf(A)).toBeNull();
	});

	it('refuse more than the device may hold', async () => {
		const storage = new MemoryOutboxStorage();
		for (let index = 0; index < OUTBOX_MAX_ACTIONS; index++) {
			const number = String(index).padStart(11, '0');
			const action = stored({
				op: `op${number}0000000`,
				seq: index,
				target: `tick${number}`,
				state: 'conflict'
			});
			await storage.put(action);
		}
		const h = harness({ storage });
		await settle();
		await goOffline(h);
		const change = h.outbox.changeStatus(ticket('tick99999999999'), { status: 'done' });
		await expect(change).rejects.toBeInstanceOf(OutboxFullError);
	});
});

describe('answers of the server (concept OF-0 §3.7)', () => {
	async function keptOne(h: Harness, status: Status = 'done') {
		await settle();
		await goOffline(h);
		await h.outbox.changeStatus(ticket(A), { status });
	}

	it('count the identifier known to the server as arrived and read the ticket again', async () => {
		const h = harness();
		await keptOne(h);
		h.send.mockRejectedValueOnce(refusal('op_id', 'validation_op_applied'));
		await goOnline(h);
		expect(h.storage.entries.size).toBe(0);
		// Since OF-3b round 3 within the time limit of a request (R2-10).
		expect(h.get).toHaveBeenCalledWith(A, expect.any(AbortSignal));
		const now = expect.objectContaining({ id: A, status: 'waiting' });
		expect(h.sink.upsert).toHaveBeenCalledWith(now);
	});

	it('show a conflict instead of overwriting, and "Meine Änderung übernehmen" sends again based on the new value', async () => {
		const h = harness();
		await keptOne(h);
		const params = { expected: 'open', actual: 'waiting', updated: '2026-10-20 12:10:00.000Z' };
		h.send.mockRejectedValueOnce(refusal('status', 'validation_ticket_conflict', params));
		await goOnline(h);
		const conflicts = h.outbox.conflicts;
		expect(conflicts).toMatchObject([{ state: 'conflict', outcome: { actual: 'waiting' } }]);
		expect(h.outbox.markOf(A)).toBe('decision');
		// The ticket shows as the server has it now, nothing laid over it.
		expect(h.outbox.apply(ticket(A, 'waiting')).status).toBe('waiting');
		expect(h.sink.upsert).toHaveBeenCalledWith(expect.objectContaining({ status: 'waiting' }));
		await settle();
		expect(h.send).toHaveBeenCalledTimes(1);
		const op = conflicts[0]?.op ?? '';
		await h.outbox.takeMine(op);
		await settle();
		expect(h.send).toHaveBeenCalledTimes(2);
		expect(fieldsOf(h, 1)).toMatchObject({ opId: op, expected: { status: 'waiting' } });
		expect(h.outbox.count).toBe(0);
	});

	it('refuse a ticket that is gone for good; "Verwerfen" shows it as before and offers "Rückgängig"', async () => {
		const h = harness();
		await keptOne(h);
		h.send.mockRejectedValueOnce(new DataError('not_found', { status: 404 }));
		h.get.mockRejectedValueOnce(new DataError('not_found', { status: 404 }));
		await goOnline(h);
		expect(h.outbox.refusals).toHaveLength(1);
		await h.outbox.retry();
		await settle();
		expect(h.send).toHaveBeenCalledTimes(1);
		const op = h.outbox.refusals[0]?.op ?? '';
		await h.outbox.discard(op);
		expect(h.outbox.count).toBe(0);
		const before = expect.objectContaining({ id: A, status: 'open' });
		expect(h.sink.upsert).toHaveBeenCalledWith(before);
		const flag = h.flags.show.mock.calls.at(-1)?.[0];
		expect(flag?.title).toBe('HAUS-01 erledigt verworfen.');
		expect(flag?.action?.label).toBe('Rückgängig');
		flag?.action?.run();
		await settle();
		expect(h.outbox.refusals).toHaveLength(1);
	});

	it('ask the question about open sub-tasks and send again with the answer', async () => {
		const h = harness();
		await keptOne(h);
		const open = refusal('status', 'validation_parent_open_children', { count: 1 });
		h.send.mockRejectedValueOnce(open);
		await goOnline(h);
		const op = h.outbox.refusals[0]?.op ?? '';
		const outcome = { code: 'validation_parent_open_children', count: 1 };
		expect(h.outbox.refusals[0]?.outcome).toMatchObject(outcome);
		await h.outbox.answerChildren(op, 'complete_children');
		await settle();
		const action = h.send.mock.calls[1]?.[0];
		expect(action).toMatchObject({ completion: 'complete_children', children: [B] });
		expect(h.outbox.count).toBe(0);
	});

	it('wait for the sign-in with the same account after 401 and keep the change', async () => {
		const h = harness();
		await keptOne(h);
		h.send.mockRejectedValueOnce(new DataError('session', { status: 401 }));
		await goOnline(h);
		expect(h.sink.sessionEnded).toHaveBeenCalledTimes(1);
		expect([...h.storage.entries.values()]).toMatchObject([{ state: 'queued' }]);
	});

	it('try errors of the server again later and say so after five in a row', async () => {
		const h = harness();
		await keptOne(h);
		h.send.mockRejectedValue(new DataError('server', { status: 503 }));
		await goOnline(h);
		expect(h.send).toHaveBeenCalledTimes(1);
		for (const wait of [2000, 5000, 10000, 30000]) await vi.advanceTimersByTimeAsync(wait);
		expect(h.send).toHaveBeenCalledTimes(5);
		expect(h.outbox.failing).not.toBeNull();
		h.send.mockImplementation(async (action) =>
			ticket(action.target, action.payload.status, SAVED_AT)
		);
		await h.outbox.retry();
		await settle();
		expect(h.outbox.failing).toBeNull();
		expect(h.outbox.count).toBe(0);
	});
});

describe('the time (decision of the user 2)', () => {
	it('waits for a decision after 48 hours; "Trotzdem übertragen" sends without the time of the device', async () => {
		const storage = new MemoryOutboxStorage();
		await storage.put(stored({ createdAt: NOW - AUTO_SEND_MS - 1 }));
		const h = harness({ storage });
		await settle();
		expect(h.send).not.toHaveBeenCalled();
		expect(h.outbox.expired).toHaveLength(1);
		await h.outbox.sendAnyway(STORED_OP);
		await settle();
		const late = { opId: STORED_OP, expected: { status: 'open' }, offline: true };
		expect(fieldsOf(h, 0)).toEqual(late);
	});

	it('deletes a change older than 7 days at the start', async () => {
		const storage = new MemoryOutboxStorage();
		await storage.put(stored({ createdAt: NOW - KEEP_MS, state: 'conflict' }));
		const h = harness({ storage });
		await settle();
		expect(h.outbox.count).toBe(0);
		expect(storage.entries.size).toBe(0);
	});
});

describe('the account (decision of the user 4)', () => {
	it('deletes the changes of another account when this one signs in, and never sends them', async () => {
		const storage = new MemoryOutboxStorage();
		await storage.put(stored({ user: OTHER }));
		await storage.put(stored({ op: 'zzzzzzzzzzzzzzzzzzz2', seq: 2, target: B }));
		const h = harness({ storage, frame: false });
		await settle();
		expect([...storage.entries.keys()]).toEqual([]);
		expect(h.send.mock.calls.map((call) => call[0].user)).toEqual([USER]);
	});

	it('keeps them through an ended session and reads them again for the same account', async () => {
		const storage = new MemoryOutboxStorage();
		const h = harness({ storage });
		await settle();
		await goOffline(h);
		await h.outbox.changeStatus(ticket(A), { status: 'done' });
		h.stop();
		h.outbox.attach(null);
		expect(storage.entries.size).toBe(1);
		const again = harness({ storage });
		await settle();
		expect(again.send).toHaveBeenCalledTimes(1);
		expect(storage.entries.size).toBe(0);
	});

	it('"Abmelden und verwerfen" deletes every change of the account', async () => {
		const h = harness();
		await settle();
		await goOffline(h);
		await h.outbox.changeStatus(ticket(A), { status: 'done' });
		await h.outbox.changeStatus(ticket(B), { status: 'waiting' });
		await h.outbox.clearUser();
		expect(h.storage.entries.size).toBe(0);
		expect(h.outbox.count).toBe(0);
	});

	it('shows an entry it cannot read as refused, never sends it; one without a time goes like an old one', async () => {
		const storage = new MemoryOutboxStorage();
		const readable = 'zzzzzzzzzzzzzzzzzzz9';
		const timeless = 'zzzzzzzzzzzzzzzzzzz8';
		storage.entries.set(readable, { op: readable, user: USER, v: 3, createdAt: NOW - 1000 });
		storage.entries.set(timeless, { op: timeless, user: USER, v: 3 });
		storage.entries.set('nobody', { op: 'nobody' });
		const h = harness({ storage });
		await settle();
		expect(h.outbox.refusals).toMatchObject([{ op: readable, outcome: { code: 'broken' } }]);
		expect([...storage.entries.keys()]).toEqual([readable]);
		expect(h.send).not.toHaveBeenCalled();
	});
});

describe('two tabs of one device (concept OF-0 §3.9)', () => {
	it('send a kept change once: only the tab with the lease sends, the other reads the device again', async () => {
		const storage = new MemoryOutboxStorage();
		await storage.put(stored());
		const [one, two] = channelPair();
		const first = harness({ storage, tab: 'tab-a', channel: one });
		const second = harness({ storage, tab: 'tab-b', channel: two });
		await settle();
		expect(first.send.mock.calls.length + second.send.mock.calls.length).toBe(1);
		expect(storage.entries.size).toBe(0);
		expect(first.outbox.count).toBe(0);
		expect(second.outbox.count).toBe(0);
	});
});
