// The corrections of OF-3b (ADR-0074 addendum OF-3b) on the scaffold of $lib/test/outbox-fake.ts, one
// test per finding of the review of OF-3, each red against the state of OF-3 (7003b14):
// - H1: "Verwerfen" with a later change of the same ticket takes back what that one leaves alone (the
//   mark of the day under a change of the status), and what stays once that one goes as well;
// - H2: "Rückgängig" while the change is under way counts, also when its request then gets no answer;
// - H3: after a discarded change met a conflict, the change behind it shows the change of someone else
//   as a conflict instead of overwriting it;
// - M2: a 403 or 404 of a discarded change that may have arrived stays to be seen;
// - M3: taking back a completion with "Unteraufgaben mit erledigen" opens the sub-tasks as well;
// - M4: taking back a completion on a day gone by can still open the ticket ("Trotzdem wieder öffnen");
// - M5: after 48 hours no button stays without an effect;
// - M6: "Rückgängig" never skips a take-back that is under way;
// - "Trotzdem erledigen" counts every compare-and-swap of the actions behind it.
// Round 2 (after the review of OF-3b, each red against 2a5a52e unless noted in the log): a take-back
// never expires (S1) and has no "Verwerfen" of its own (S2); H-1 a later change that expired keeps the
// fallback; H-2c "Rückgängig" after "Verwerfen" at every point; M-2 a sub-task with a change of its
// own; M-3 a 5xx keeps "may have arrived"; the low findings (unknown sub-tasks, start, storage after
// three rounds, "Abmelden und verwerfen", the probe of `#pure`); and what the scenario matrix of
// round 2 found (the mark of the day behind an expired change, the sub-tasks read again, a completion
// with sub-tasks that would have dropped a waiting change).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import { AUTO_SEND_MS, OFFLINE_TEXTS, canReopenAnyway, type KeptAction } from '$lib/domain/offline';
import {
	A,
	ALL_OPS,
	HeldStorage,
	NOW,
	STORAGE_FAILED,
	STORED_OP,
	entry,
	goOffline,
	goOnline,
	harness,
	settle,
	stored,
	ticket,
	type Harness
} from '$lib/test/outbox-fake';
import { MemoryOutboxStorage } from './outbox-storage';

const ITEM = 'item00000000001';
const C = 'tick00000000003';

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

async function ready(): Promise<Harness> {
	const h = harness({ support: ALL_OPS });
	await settle();
	return h;
}

/** The plan entry of A (a task) as the server has it. */
function planned() {
	return { item: entry(ITEM, A), ticket: ticket(A) };
}

/** The first attempt reaches the server, its answer gets lost; the connection is gone. */
async function lost(h: Harness, change: () => Promise<unknown>): Promise<KeptAction> {
	h.server.lose = 1;
	h.server.health = false;
	await change();
	await settle();
	return h.outbox.actions.at(-1) as KeptAction;
}

/** The first attempt leaves the device but never reaches the server; the connection is gone. */
async function unreached(h: Harness, change: () => Promise<unknown>): Promise<KeptAction> {
	h.server.reachable = false;
	h.server.health = false;
	await change();
	await settle();
	return h.outbox.actions.at(-1) as KeptAction;
}

/** "Rückgängig" of the last flag. */
function undoOf(h: Harness): () => void {
	const run = h.flags.show.mock.calls.at(-1)?.[0].action?.run;
	expect(run).toBeDefined();
	return () => run?.();
}

/** Lets the next request of `op` wait until the returned function is called. */
function hold(h: Harness, op: string, fail?: DataError): () => void {
	const base = h.send.getMockImplementation();
	let open = () => undefined as void;
	const gate = new Promise<void>((resolve) => (open = resolve));
	let held = false;
	h.send.mockImplementation(async (action, fields, signal) => {
		if (!held && fields.opId === op) {
			held = true;
			await gate;
			if (fail !== undefined) throw fail;
		}
		if (base === undefined) throw new Error('no fake server');
		return base(action, fields, signal);
	});
	return () => open();
}

function find(h: Harness, op: string): KeptAction | undefined {
	return h.outbox.actions.find((action) => action.op === op);
}

describe('"Verwerfen" with a later change of the same ticket (H1)', () => {
	it('takes the mark of the day back when only the status changed after it (H1a)', async () => {
		const h = await ready();
		const mark = await lost(h, () =>
			h.outbox.changeCheck(planned(), { kind: 'dayplan.check', mode: 'today' })
		);
		expect(h.server.items.get(ITEM)?.doneToday).toBe(true);
		await h.outbox.changeStatus(h.outbox.apply(ticket(A)), { status: 'in_progress' });
		await h.outbox.discard(mark.op);
		await goOnline(h);
		expect(h.server.items.get(ITEM)?.doneToday).toBe(false);
		expect(h.server.status.get(A)).toBe('in_progress');
		expect(h.outbox.count).toBe(0);
	});

	it('takes the first change back once the later one is discarded as well (H1b)', async () => {
		const h = await ready();
		const first = await lost(h, () => h.outbox.changeStatus(ticket(A), { status: 'done' }));
		await h.outbox.changeStatus(h.outbox.apply(ticket(A)), { status: 'in_progress' });
		const later = h.outbox.actions.at(-1) as KeptAction;
		await h.outbox.discard(first.op);
		await h.outbox.discard(later.op);
		await goOnline(h);
		expect(h.server.status.get(A)).toBe('open');
		expect(h.outbox.count).toBe(0);
	});
});

describe('"Rückgängig" while the change is under way (H2)', () => {
	it('counts when the server then answers with a conflict: it shows, nothing goes without a word', async () => {
		const h = await ready();
		const original = await unreached(h, () => h.outbox.changeStatus(ticket(A), { status: 'done' }));
		await h.outbox.discard(original.op);
		const undo = undoOf(h);
		h.server.status.set(A, 'waiting');
		const open = hold(h, original.op);
		await goOnline(h);
		expect(find(h, original.op)?.state).toBe('sending');
		undo();
		await settle();
		open();
		await settle();
		expect(h.outbox.conflicts.map((action) => action.op)).toEqual([original.op]);
		expect(find(h, original.op)?.discarded).toBeUndefined();
		expect(h.server.status.get(A)).toBe('waiting');
	});

	it('counts when the request then gets no answer: "discarded" is not written back', async () => {
		const h = await ready();
		const original = await unreached(h, () => h.outbox.changeStatus(ticket(A), { status: 'done' }));
		await h.outbox.discard(original.op);
		const undo = undoOf(h);
		const open = hold(h, original.op, new DataError('network'));
		await goOnline(h);
		undo();
		await settle();
		h.server.health = false;
		open();
		await settle();
		expect(find(h, original.op)?.discarded).toBeUndefined();
		// Someone else changes the status meanwhile: a later answer shows it, never drops it.
		h.server.status.set(A, 'waiting');
		await goOnline(h);
		expect(h.outbox.conflicts.map((action) => action.op)).toEqual([original.op]);
		expect(h.server.status.get(A)).toBe('waiting');
	});
});

describe('a conflict of a discarded change (H3)', () => {
	it('bases the change behind it on the value before, so a change of someone else shows as a conflict', async () => {
		const h = await ready();
		const first = await unreached(h, () => h.outbox.changeStatus(ticket(A), { status: 'done' }));
		await h.outbox.changeStatus(h.outbox.apply(ticket(A)), { status: 'in_progress' });
		const later = h.outbox.actions.at(-1) as KeptAction;
		await h.outbox.discard(first.op);
		h.server.status.set(A, 'waiting');
		await goOnline(h);
		expect(h.server.status.get(A)).toBe('waiting');
		expect(h.outbox.conflicts.map((action) => action.op)).toEqual([later.op]);
		expect(h.outbox.conflicts[0]?.outcome?.actual).toBe('waiting');
	});
});

describe('403 and 404 of a discarded change that may have arrived (M2)', () => {
	it('shows a refusal that names it, and "Verwerfen" then lets it go with its take-back', async () => {
		const h = await ready();
		const original = await lost(h, () => h.outbox.changeStatus(ticket(A), { status: 'done' }));
		await h.outbox.discard(original.op);
		h.send.mockRejectedValueOnce(new DataError('not_found', { status: 404 }));
		await goOnline(h);
		const refused = h.outbox.refusals;
		expect(refused.map((action) => action.op)).toEqual([original.op]);
		expect(refused[0]).toMatchObject({ discarded: true, outcome: { code: 'not_found' } });
		expect(h.server.status.get(A)).toBe('done');
		await h.outbox.discard(original.op);
		expect(h.outbox.count).toBe(0);
	});
});

describe('a completion with "Unteraufgaben mit erledigen" (M3)', () => {
	it('opens the sub-tasks it took along with their status before, like "Rückgängig" online', async () => {
		const h = await ready();
		// The list showed the sub-task in progress; only its ID and that status are kept.
		h.outbox.apply(ticket(C, 'in_progress'));
		const completion = await lost(h, () =>
			h.outbox.changeStatus(ticket(A), {
				status: 'done',
				completion: 'complete_children',
				children: [C]
			})
		);
		expect(completion).toMatchObject({ children: [C], childrenBefore: ['in_progress'] });
		expect(h.server.status.get(C)).toBe('done');
		await h.outbox.discard(completion.op);
		const child = h.outbox.actions.find((action) => action.target === C);
		expect(child).toMatchObject({ key: 'HAUS-03', title: '', payload: { status: 'in_progress' } });
		await goOnline(h);
		expect(h.server.status.get(A)).toBe('open');
		expect(h.server.status.get(C)).toBe('in_progress');
		expect(h.outbox.count).toBe(0);
	});
});

describe('taking back a completion on a day gone by (M4)', () => {
	it('offers to open the ticket again over the normal way, only on a click', async () => {
		const h = await ready();
		const check = await lost(h, () =>
			h.outbox.changeCheck(planned(), { kind: 'dayplan.check', mode: 'check' })
		);
		expect(h.server.status.get(A)).toBe('done');
		await h.outbox.discard(check.op);
		h.server.dayOver = true;
		await goOnline(h);
		const [refused] = h.outbox.refusals;
		expect(refused?.kind).toBe('dayplan.uncheck');
		expect(refused !== undefined && canReopenAnyway(refused)).toBe(true);
		expect(h.server.status.get(A)).toBe('done');
		await h.outbox.reopenAnyway(refused?.op ?? '');
		await settle();
		expect(h.send.mock.calls.at(-1)?.[0]).toMatchObject({ target: A, payload: { status: 'open' } });
		expect(h.server.status.get(A)).toBe('open');
		expect(h.outbox.count).toBe(0);
	});
});

describe('after 48 hours (M5)', () => {
	it('leaves no discarded change waiting for a decision, and sends the take-back on its own (round 2, S1)', async () => {
		const h = await ready();
		const original = await lost(h, () => h.outbox.changeStatus(ticket(A), { status: 'done' }));
		await h.outbox.discard(original.op);
		vi.setSystemTime(NOW + AUTO_SEND_MS + 60_000);
		await goOnline(h);
		expect(h.outbox.expired).toEqual([]);
		expect(h.server.status.get(A)).toBe('open');
		expect(h.outbox.count).toBe(0);
	});

	it('offers no "Verwerfen" of a take-back that waits; setting the value anew decides instead (round 2, S2)', async () => {
		const h = await ready();
		const original = await lost(h, () => h.outbox.changeStatus(ticket(A), { status: 'done' }));
		await h.outbox.discard(original.op);
		const takeBack = h.outbox.actions.find((action) => action.undoes === original.op);
		const flags = h.flags.show.mock.calls.length;
		const before = JSON.stringify(h.outbox.actions);
		await h.outbox.discard(takeBack?.op ?? '');
		expect(JSON.stringify(h.outbox.actions)).toBe(before);
		expect(h.flags.show.mock.calls.length).toBe(flags);
		await h.outbox.changeStatus(h.outbox.apply(ticket(A)), { status: 'done' });
		expect(h.outbox.actions.some((action) => action.undoes !== undefined)).toBe(false);
		await goOnline(h);
		expect(h.server.status.get(A)).toBe('done');
		expect(h.outbox.count).toBe(0);
	});
});

describe('"Rückgängig" while the take-back is under way (M6)', () => {
	it('takes the take-back back in turn instead of skipping it', async () => {
		const h = await ready();
		const original = await lost(h, () => h.outbox.changeStatus(ticket(A), { status: 'done' }));
		await h.outbox.discard(original.op);
		const undo = undoOf(h);
		const takeBack = h.outbox.actions.find((action) => action.undoes === original.op);
		const open = hold(h, takeBack?.op ?? '');
		await goOnline(h);
		expect(find(h, original.op)).toBeUndefined();
		expect(find(h, takeBack?.op ?? '')?.state).toBe('sending');
		undo();
		await settle();
		open();
		await settle();
		expect(h.server.status.get(A)).toBe('done');
		expect(h.outbox.count).toBe(0);
	});
});

/** The first request of `op` fails with `failure` before it reaches the server. */
function failOnce(h: Harness, op: string, failure: DataError): void {
	const base = h.send.getMockImplementation();
	let failed = false;
	h.send.mockImplementation(async (action, fields, signal) => {
		if (!failed && fields.opId === op) {
			failed = true;
			throw failure;
		}
		if (base === undefined) throw new Error('no fake server');
		return base(action, fields, signal);
	});
}

describe('a later change that expired (round 2, H-1)', () => {
	it('takes the discarded change that arrived back once the later one is discarded after 48 hours', async () => {
		const h = await ready();
		const first = await lost(h, () => h.outbox.changeStatus(ticket(A), { status: 'done' }));
		await h.outbox.changeStatus(h.outbox.apply(ticket(A)), { status: 'in_progress' });
		const later = h.outbox.actions.at(-1) as KeptAction;
		await h.outbox.discard(first.op);
		vi.setSystemTime(NOW + AUTO_SEND_MS + 60_000);
		await goOnline(h);
		expect(h.outbox.expired.map((action) => action.op)).toEqual([later.op]);
		expect(h.server.status.get(A)).toBe('done');
		await h.outbox.discard(later.op);
		await settle();
		expect(h.server.status.get(A)).toBe('open');
		expect(h.outbox.count).toBe(0);
	});
});

describe('"Rückgängig" after "Verwerfen" leads back to the wish (round 2, H-2c)', () => {
	async function discarded(h: Harness) {
		const original = await lost(h, () => h.outbox.changeStatus(ticket(A), { status: 'done' }));
		await h.outbox.discard(original.op);
		const takeBack = h.outbox.actions.find((action) => action.undoes === original.op);
		return { original, takeBack: takeBack as KeptAction, undo: undoOf(h) };
	}

	it('(a) right after "Verwerfen"', async () => {
		const h = await ready();
		const { undo } = await discarded(h);
		undo();
		await settle();
		await goOnline(h);
		expect(h.server.status.get(A)).toBe('done');
		expect(h.outbox.count).toBe(0);
	});

	it('(b) once the take-back was sent and got no answer', async () => {
		const h = await ready();
		const { takeBack, undo } = await discarded(h);
		h.server.lose = 1;
		await goOnline(h);
		expect(find(h, takeBack.op)).toMatchObject({ sent: true, unanswered: true });
		expect(h.server.status.get(A)).toBe('open');
		await goOffline(h);
		undo();
		await settle();
		await goOnline(h);
		expect(h.server.status.get(A)).toBe('done');
		expect(h.outbox.count).toBe(0);
	});

	it('(c) once the take-back arrived', async () => {
		const h = await ready();
		const { undo } = await discarded(h);
		await goOnline(h);
		expect(h.server.status.get(A)).toBe('open');
		expect(h.outbox.count).toBe(0);
		undo();
		await settle();
		expect(h.server.status.get(A)).toBe('done');
		expect(h.outbox.count).toBe(0);
	});

	it('(d) after a 503 for the take-back', async () => {
		const h = await ready();
		const { takeBack, undo } = await discarded(h);
		failOnce(h, takeBack.op, new DataError('server', { status: 503 }));
		await goOnline(h);
		expect(find(h, takeBack.op)).toMatchObject({ state: 'queued', attempts: 1 });
		undo();
		await settle();
		await vi.advanceTimersByTimeAsync(3_000);
		expect(h.server.status.get(A)).toBe('done');
		expect(h.outbox.count).toBe(0);
	});

	it('(e) once the take-back met a conflict: the wish comes back and shows the conflict', async () => {
		const h = await ready();
		const { takeBack, undo } = await discarded(h);
		h.server.status.set(A, 'waiting');
		await goOnline(h);
		expect(h.outbox.conflicts.map((action) => action.op)).toEqual([takeBack.op]);
		undo();
		await settle();
		const [conflict] = h.outbox.conflicts;
		expect(h.outbox.count).toBe(1);
		expect(conflict).toMatchObject({ payload: { status: 'done' }, outcome: { actual: 'waiting' } });
		expect(conflict?.undoes).toBeUndefined();
		expect(h.server.status.get(A)).toBe('waiting');
	});
});

describe('a sub-task with a change of its own (round 2, M-2)', () => {
	it('takes the completion back without a conflict against the own change of the sub-task', async () => {
		const h = await ready();
		h.outbox.apply(ticket(C));
		const completion = await lost(h, () =>
			h.outbox.changeStatus(ticket(A), {
				status: 'done',
				completion: 'complete_children',
				children: [C]
			})
		);
		await h.outbox.changeStatus(h.outbox.apply(ticket(C)), { status: 'in_progress' });
		await h.outbox.discard(completion.op);
		await goOnline(h);
		expect(h.server.status.get(A)).toBe('open');
		expect(h.server.status.get(C)).toBe('in_progress');
		expect(h.outbox.conflicts).toEqual([]);
		expect(h.outbox.count).toBe(0);
	});
});

describe('a 5xx after a request without an answer (round 2, M-3)', () => {
	it('keeps "may have arrived", so "Verwerfen" takes the change back', async () => {
		const h = await ready();
		const original = await lost(h, () => h.outbox.changeStatus(ticket(A), { status: 'done' }));
		failOnce(h, original.op, new DataError('server', { status: 503 }));
		await goOnline(h);
		expect(find(h, original.op)).toMatchObject({ attempts: 1, unanswered: true });
		await goOffline(h);
		await h.outbox.discard(original.op);
		await goOnline(h);
		await vi.advanceTimersByTimeAsync(3_000);
		expect(h.server.status.get(A)).toBe('open');
		expect(h.outbox.count).toBe(0);
	});
});

describe('found by the scenario matrix of round 2', () => {
	it('keeps the take-back of the mark of the day when a later change older than 48 hours is discarded', async () => {
		const h = await ready();
		const mark = await unreached(h, () =>
			h.outbox.changeCheck(planned(), { kind: 'dayplan.check', mode: 'today' })
		);
		await h.outbox.changeCheck(
			{ item: entry(ITEM, A, true), ticket: ticket(A) },
			{ kind: 'dayplan.check', mode: 'check' }
		);
		const later = h.outbox.actions.at(-1) as KeptAction;
		await h.outbox.discard(mark.op);
		vi.setSystemTime(NOW + AUTO_SEND_MS + 60_000);
		await goOnline(h);
		expect(h.server.items.get(ITEM)?.doneToday).toBe(true);
		expect(h.outbox.expired.map((action) => action.op)).toEqual([later.op]);
		await h.outbox.discard(later.op);
		await settle();
		expect(h.server.items.get(ITEM)?.doneToday).toBe(false);
		expect(h.outbox.count).toBe(0);
	});

	it('reads the sub-tasks again once a completion that took them along arrived', async () => {
		const h = await ready();
		h.outbox.apply(ticket(C));
		await unreached(h, () =>
			h.outbox.changeStatus(ticket(A), {
				status: 'done',
				completion: 'complete_children',
				children: [C]
			})
		);
		await goOnline(h);
		expect(h.get).toHaveBeenCalledWith(C);
		expect(h.outbox.current(C)?.status).toBe('done');
	});

	it('takes a completion with its sub-tasks into a waiting change instead of dropping that one', async () => {
		const h = await ready();
		h.outbox.apply(ticket(C));
		await goOffline(h);
		await h.outbox.changeStatus(ticket(A), { status: 'done' });
		await goOnline(h);
		await goOffline(h);
		// "In Arbeit", then "erledigt" with the sub-task: the status is the one before, the sub-task not.
		await h.outbox.changeStatus(h.outbox.apply(ticket(A, 'done')), { status: 'in_progress' });
		await h.outbox.changeStatus(h.outbox.apply(ticket(A, 'done')), {
			status: 'done',
			completion: 'complete_children',
			children: [C]
		});
		expect(h.outbox.actions).toMatchObject([{ completion: 'complete_children', children: [C] }]);
		await goOnline(h);
		expect(h.server.status.get(A)).toBe('done');
		expect(h.server.status.get(C)).toBe('done');
	});
});

describe('the low findings of the review (round 2)', () => {
	it('takes back no sub-task whose status before is unknown and says so', async () => {
		const h = await ready();
		const completion = await lost(h, () =>
			h.outbox.changeStatus(ticket(A), {
				status: 'done',
				completion: 'complete_children',
				children: [C]
			})
		);
		expect(completion).toMatchObject({ children: [C], childrenBefore: [null] });
		await h.outbox.discard(completion.op);
		expect(h.flags.show.mock.calls.at(-1)?.[0].description).toContain(
			OFFLINE_TEXTS.childrenUnknown(1)
		);
		expect(h.outbox.actions.some((action) => action.target === C)).toBe(false);
		await goOnline(h);
		expect(h.server.status.get(A)).toBe('open');
		expect(h.outbox.count).toBe(0);
	});

	it('shows the flag of the storage when the device cannot be read at the start', async () => {
		const storage = new MemoryOutboxStorage();
		vi.spyOn(storage, 'list').mockRejectedValue(new DOMException('kaputt', 'UnknownError'));
		const h = harness({ storage, support: ALL_OPS });
		await settle();
		expect(h.outbox.armed).toBe(false);
		expect(h.flags.show).toHaveBeenCalledWith(
			expect.objectContaining({ tone: 'error', title: STORAGE_FAILED })
		);
	});

	it('names the storage, not the connection, when a change cannot be kept after three rounds', async () => {
		const h = await ready();
		await goOffline(h);
		vi.spyOn(h.storage, 'swap').mockResolvedValue(false);
		await expect(h.outbox.changeStatus(ticket(A), { status: 'done' })).rejects.toMatchObject({
			message: STORAGE_FAILED
		});
	});

	it('lets "Abmelden und verwerfen" wait for a step that writes the device', async () => {
		const storage = new HeldStorage();
		const h = harness({ storage, support: ALL_OPS });
		await settle();
		await goOffline(h);
		storage.holding = true;
		const change = h.outbox.changeStatus(ticket(A), { status: 'done' });
		await settle();
		const clear = h.outbox.clearUser();
		await settle();
		storage.open();
		await change;
		await clear;
		expect(storage.entries.size).toBe(0);
		expect(h.outbox.count).toBe(0);
	});

	it('numbers only the actions it makes: the probe sorts like the real run', async () => {
		// A change older than 48 hours whose request got no answer: "Verwerfen" lets it go where its
		// take-back holds whatever the server has, with exactly one new action.
		const storage = new MemoryOutboxStorage();
		const old = NOW - AUTO_SEND_MS - 60_000;
		await storage.put(stored({ sent: true, unanswered: true, createdAt: old }));
		const h = harness({ storage, support: ALL_OPS });
		await settle();
		await goOffline(h);
		expect(h.outbox.expired.map((action) => action.op)).toEqual([STORED_OP]);
		const numbers = vi.spyOn(storage, 'nextSeq');
		await h.outbox.discard(STORED_OP);
		expect(numbers).toHaveBeenCalledTimes(1);
		expect(h.outbox.actions).toMatchObject([
			{ undoes: STORED_OP, payload: { status: 'open' }, expected: { status: 'done' } }
		]);
	});
});

describe('"Trotzdem erledigen" (OF-3, low finding of the review)', () => {
	it('lets a change behind it wait for the completion also when another write changed it meanwhile', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.changeCheck(planned(), { kind: 'dayplan.check', mode: 'check' });
		await h.outbox.changeStatus(h.outbox.apply(ticket(A)), { status: 'waiting' });
		h.server.dayOver = true;
		await goOnline(h);
		const [refused, behind] = h.outbox.actions;
		expect(refused?.state).toBe('refused');
		// Another tab changes the action behind it exactly while it is rewired.
		const swap = h.storage.swap.bind(h.storage);
		let changed = false;
		vi.spyOn(h.storage, 'swap').mockImplementation(async (op, matches, next) => {
			if (!changed && op === behind?.op && next !== null) {
				changed = true;
				h.storage.entries.set(op, { ...behind, title: 'Anders' });
			}
			return swap(op, matches, next);
		});
		h.send.mockRejectedValueOnce(new DataError('server', { status: 503 }));
		await h.outbox.completeAnyway(refused?.op ?? '');
		await settle();
		expect(changed).toBe(true);
		expect(h.send.mock.calls.map((call) => call[0].payload.status)).toEqual(['done']);
		await vi.advanceTimersByTimeAsync(3_000);
		expect(h.send.mock.calls.map((call) => call[0].payload.status)).toEqual([
			'done',
			'done',
			'waiting'
		]);
		expect(h.server.status.get(A)).toBe('waiting');
	});
});
