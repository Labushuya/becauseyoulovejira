// The outbox of OF-3 (ADR-0074 addendum OF-3) on the scaffold of OF-2b ($lib/test/outbox-fake.ts):
// the check mark of the day plan and its taking back and the due date without a connection (kept,
// laid over, marked, sent later with the time of the device and the state before), the rules of
// OF-2b for both (marked as sent before every attempt, a change after a send without an answer is an
// action of its own, taking back is a counter action, compare-and-swap, the account, no silent
// refusal), a check mark of a day gone by and a changed check mark refused for good, the worker
// after a first attempt that arrived (E1) and "Verwerfen" of a change that may have arrived (E2).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import {
	DAY_OVER_CODE,
	OFFLINE_TEXTS,
	isDayPlanAction,
	isDueAction,
	type DayPlanAction,
	type KeptAction
} from '$lib/domain/offline';
import {
	A,
	ALL_OPS,
	B,
	HeldStorage,
	NOW,
	OTHER,
	SAVED_AT,
	entry,
	goOffline,
	goOnline,
	harness,
	refusal,
	settle,
	ticket,
	type Harness
} from '$lib/test/outbox-fake';
import type { CheckAnswer } from './outbox.svelte';

const ITEM = 'item00000000001';
const CHECK = { kind: 'dayplan.check', mode: 'check' } as const;

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

/** An outbox with a server that takes every action of the first stage. */
async function ready(options: Parameters<typeof harness>[0] = {}): Promise<Harness> {
	const h = harness({ support: ALL_OPS, ...options });
	await settle();
	return h;
}

/** The plan entry of A (a task) as the server has it. */
function planned(doneToday = false, status: Parameters<typeof ticket>[1] = 'open') {
	return { item: entry(ITEM, A, doneToday), ticket: ticket(A, status) };
}

function onlyAction(h: Harness): KeptAction {
	expect(h.outbox.actions).toHaveLength(1);
	return h.outbox.actions[0] as KeptAction;
}

describe('a check mark of the day plan without a connection (OF-3, concept §8)', () => {
	it('is kept with one tap, laid over the entry and its ticket, marked, and sent once the connection is back', async () => {
		const h = await ready();
		const answers: (CheckAnswer | null)[] = [];
		h.outbox.watchChecks((answer) => answers.push(answer));
		await goOffline(h);
		const answer = await h.outbox.changeCheck(planned(), CHECK);
		expect(answer).toMatchObject({ kept: true, action: 'complete' });
		expect(answer.ticket).toMatchObject({ status: 'open', previousStatus: 'open' });
		expect(h.outbox.markOf(ITEM)).toBe('pending');
		expect(h.outbox.markOf(A)).toBe('pending');
		const row = h.outbox.checkRow(entry(ITEM, A), ticket(A));
		expect(row.doneToday).toBe(false);
		expect(row.ticket?.status).toBe('done');
		expect(h.outbox.apply(ticket(A)).status).toBe('done');
		expect(h.sendDayPlan).not.toHaveBeenCalled();

		await goOnline(h);
		expect(h.sendDayPlan).toHaveBeenCalledTimes(1);
		expect(h.sendDayPlan.mock.calls[0]?.[1]).toEqual({
			opId: h.server.sent[0],
			expected: { checked: false, status: 'open' },
			clientAt: new Date(NOW).toISOString()
		});
		expect(h.server.status.get(A)).toBe('done');
		expect(h.outbox.count).toBe(0);
		expect(answers).toHaveLength(1);
		expect(answers[0]?.ticket.status).toBe('done');
	});

	it('checks an ongoing project only for the day: the mark of the day, the ticket stays as it is', async () => {
		const h = await ready();
		await goOffline(h);
		const ongoing = { item: entry(ITEM, A), ticket: { ...ticket(A), kind: 'ongoing' as const } };
		const answer = await h.outbox.changeCheck(ongoing, CHECK);
		expect(answer.action).toBe('today');
		const row = h.outbox.checkRow(entry(ITEM, A), ongoing.ticket);
		expect(row.doneToday).toBe(true);
		expect(row.ticket?.status).toBe('open');
		expect(h.outbox.markOf(ITEM)).toBe('pending');
		expect(h.outbox.markOf(A)).toBeNull();
		await goOnline(h);
		expect(h.server.items.get(ITEM)?.doneToday).toBe(true);
		expect(h.server.status.get(A)).toBeUndefined();
	});

	it('"Rückgängig" of a kept check mark only drops it from the outbox', async () => {
		const h = await ready();
		await goOffline(h);
		const answer = await h.outbox.changeCheck(planned(), CHECK);
		const back = await h.outbox.changeCheck(planned(), {
			kind: 'dayplan.uncheck',
			action: answer.action,
			status: answer.ticket.previousStatus
		});
		expect(back.kept).toBe(true);
		expect(h.outbox.count).toBe(0);
		await goOnline(h);
		expect(h.sendDayPlan).not.toHaveBeenCalled();
	});

	it('takes the mark of the day back first when taking back names no action, like the server', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.changeCheck(planned(true), { kind: 'dayplan.uncheck' });
		const action = onlyAction(h) as DayPlanAction;
		expect(action.payload).toEqual({ action: 'today' });
		expect(action.expected).toEqual({ doneToday: true, status: 'open' });
		expect(h.outbox.checkRow(entry(ITEM, A, true), ticket(A)).doneToday).toBe(false);
	});

	it('goes at once with only its identifier while the connection stands, as today', async () => {
		const h = await ready();
		const answer = await h.outbox.changeCheck(planned(), CHECK);
		expect(answer.kept).toBeUndefined();
		expect(h.sendDayPlan.mock.calls[0]?.[1]).toEqual({ opId: h.server.sent[0] });
		expect(h.outbox.count).toBe(0);
	});

	it('shows a conflict when someone else reopened the ticket meanwhile, and overwrites nothing', async () => {
		const h = await ready();
		h.server.status.set(A, 'done');
		await goOffline(h);
		await h.outbox.changeCheck(planned(false, 'done'), {
			kind: 'dayplan.uncheck',
			action: 'complete',
			status: 'open'
		});
		// Someone else took the check mark off meanwhile and set "In Arbeit".
		h.server.status.set(A, 'in_progress');
		await goOnline(h);
		const action = onlyAction(h);
		expect(action.state).toBe('conflict');
		expect(action.outcome).toMatchObject({
			code: 'validation_ticket_conflict',
			actual: 'in_progress'
		});
		expect(h.server.status.get(A)).toBe('in_progress');
		expect(h.outbox.conflicts).toHaveLength(1);
	});
});

describe('a due date without a connection (OF-3, concept §8)', () => {
	it('is kept, laid over the ticket, marked, and sent later with the due date before in the form of the history', async () => {
		const h = await ready();
		await goOffline(h);
		const shown = await h.outbox.changeDue(ticket(A), '2026-10-22');
		expect(shown.due).toBe('2026-10-22');
		expect(h.outbox.markOf(A)).toBe('pending');
		expect(h.outbox.apply(ticket(A)).due).toBe('2026-10-22');
		expect(h.sendDue).not.toHaveBeenCalled();
		await goOnline(h);
		expect(h.sendDue.mock.calls[0]?.[1]).toEqual({
			opId: h.server.sent[0],
			expected: { due: '' },
			clientAt: new Date(NOW).toISOString()
		});
		expect(h.server.due.get(A)).toBe('2026-10-22');
		expect(h.outbox.count).toBe(0);
	});

	it('takes a later due date into a waiting one and drops it when it is the one before again', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.changeDue(ticket(A, 'open', undefined, '2026-10-20'), '2026-10-22');
		await h.outbox.changeDue(ticket(A, 'open', undefined, '2026-10-20'), '2026-10-24');
		const action = onlyAction(h);
		expect(action.payload).toEqual({ due: '2026-10-24' });
		expect(action.expected).toEqual({ due: '2026-10-20' });
		await h.outbox.changeDue(ticket(A, 'open', undefined, '2026-10-20'), '2026-10-20');
		expect(h.outbox.count).toBe(0);
	});

	it('shows a conflict when someone else changed the due date, and "Meine Änderung übernehmen" sends it on the new state', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.changeDue(ticket(A), '2026-10-22');
		h.server.due.set(A, '2026-10-25');
		await goOnline(h);
		const action = onlyAction(h);
		expect(action.state).toBe('conflict');
		expect(action.outcome?.actual).toBe('2026-10-25 00:00:00.000Z');
		expect(h.server.due.get(A)).toBe('2026-10-25');
		await h.outbox.takeMine(action.op);
		await settle();
		expect(h.sendDue.mock.calls.at(-1)?.[1]).toMatchObject({
			expected: { due: '2026-10-25 00:00:00.000Z' }
		});
		expect(h.server.due.get(A)).toBe('2026-10-22');
		expect(h.outbox.count).toBe(0);
	});
});

describe('the rules of OF-2b for the new kinds (OF-3)', () => {
	it('marks a due date and a check mark as sent before every attempt', async () => {
		const h = await ready();
		const marks: unknown[] = [];
		const look = (op: string) =>
			marks.push((h.storage.entries.get(op) as { sent?: unknown })?.sent);
		h.sendDue.mockImplementationOnce(async (action, fields) => {
			look(fields.opId);
			throw new DataError('network');
		});
		h.sendDayPlan.mockImplementationOnce(async (action, fields) => {
			look(fields.opId);
			throw new DataError('network');
		});
		await h.outbox.changeDue(ticket(A), '2026-10-22');
		await h.outbox.changeCheck({ item: entry(ITEM, B), ticket: ticket(B) }, CHECK);
		expect(marks).toEqual([true, true]);
		await goOnline(h);
		for (const action of h.storage.entries.values()) expect(action).toMatchObject({ sent: true });
	});

	it('makes a later due date after a send without an answer an action of its own, so the server ends on it', async () => {
		const h = await ready();
		h.server.lose = 1;
		h.server.health = false;
		await h.outbox.changeDue(ticket(A), '2026-10-22');
		await settle();
		expect(h.server.due.get(A)).toBe('2026-10-22');
		await h.outbox.changeDue(ticket(A), '2026-10-24');
		expect(h.outbox.actions.map((action) => action.payload)).toEqual([
			{ due: '2026-10-22' },
			{ due: '2026-10-24' }
		]);
		await goOnline(h);
		expect(h.server.due.get(A)).toBe('2026-10-24');
		expect(new Set(h.server.sent).size).toBe(2);
	});

	it('takes a check mark sent without an answer back with a counter action', async () => {
		const h = await ready();
		h.server.lose = 1;
		h.server.health = false;
		await h.outbox.changeCheck(planned(), CHECK);
		await settle();
		expect(h.server.status.get(A)).toBe('done');
		await h.outbox.changeCheck(planned(), {
			kind: 'dayplan.uncheck',
			action: 'complete',
			status: 'open'
		});
		const [first, counter] = h.outbox.actions as DayPlanAction[];
		expect(counter?.dependsOn).toEqual([first?.op]);
		expect(counter?.expected).toEqual({ doneToday: false, status: 'done' });
		await goOnline(h);
		expect(h.server.status.get(A)).toBe('open');
		expect(new Set(h.server.sent).size).toBe(2);
	});

	it('never drops a check mark that is being marked for sending: its taking back waits for it (race in one tab)', async () => {
		const storage = new HeldStorage();
		const h = await ready({ storage });
		await goOffline(h);
		await h.outbox.changeCheck(planned(), CHECK);
		storage.holding = true;
		h.server.health = true;
		await h.connectivity.check();
		await settle();
		const back = h.outbox.changeCheck(planned(), {
			kind: 'dayplan.uncheck',
			action: 'complete',
			status: 'open'
		});
		await settle();
		storage.open();
		await back;
		await settle();
		expect(h.server.status.get(A)).toBe('open');
		expect(new Set(h.server.sent).size).toBe(2);
		expect(h.outbox.count).toBe(0);
	});

	it('sends neither a due date nor a check mark while the client is signed in with another account', async () => {
		const h = await ready({ account: () => OTHER });
		const due = h.outbox.changeDue(ticket(A), '2026-10-22');
		await expect(due).rejects.toMatchObject({ kind: 'session' });
		const check = h.outbox.changeCheck(planned(), CHECK);
		await expect(check).rejects.toMatchObject({ kind: 'session' });
		expect(h.sendDue).not.toHaveBeenCalled();
		expect(h.sendDayPlan).not.toHaveBeenCalled();
	});

	it('shows a refusal of a check mark and never sends it again', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.changeCheck(planned(), CHECK);
		h.sendDayPlan.mockRejectedValueOnce(new DataError('not_found', { status: 404 }));
		await goOnline(h);
		expect(h.outbox.refusals).toHaveLength(1);
		await h.outbox.retry();
		await settle();
		expect(h.sendDayPlan).toHaveBeenCalledTimes(1);
	});

	it('goes the way of today while the server does not take the check marks of the day plan', async () => {
		const h = await ready({ support: { version: 1, kinds: ['ticket.update'] } });
		expect(h.outbox.routes(A, 'check')).toBe(false);
		expect(h.outbox.routes(A, 'due')).toBe(true);
		expect(h.outbox.routes(A)).toBe(true);
	});
});

describe('a check mark of a day gone by (OF-3, ADR-0074 §8, decision of the user 3)', () => {
	it('is refused for good, never sent again, and a task can be completed over the normal way', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.changeCheck(planned(), CHECK);
		h.server.dayOver = true;
		await goOnline(h);
		const refused = onlyAction(h);
		expect(refused.state).toBe('refused');
		expect(refused.outcome).toEqual({ code: DAY_OVER_CODE, message: OFFLINE_TEXTS.dayOver });
		await h.outbox.retry();
		await settle();
		expect(h.sendDayPlan).toHaveBeenCalledTimes(1);

		await h.outbox.completeAnyway(refused.op);
		await settle();
		expect(h.send).toHaveBeenCalledTimes(1);
		expect(h.send.mock.calls[0]?.[0]).toMatchObject({ target: A, payload: { status: 'done' } });
		expect(h.send.mock.calls[0]?.[1]).toMatchObject({ expected: { status: 'open' } });
		expect(h.server.status.get(A)).toBe('done');
		expect(h.server.items.get(ITEM)).toBeUndefined();
		expect(h.outbox.count).toBe(0);
	});

	it('lets the check mark of an ongoing project lapse: no completion, only "Verwerfen"', async () => {
		const h = await ready();
		await goOffline(h);
		const ongoing = { item: entry(ITEM, A), ticket: { ...ticket(A), kind: 'ongoing' as const } };
		await h.outbox.changeCheck(ongoing, CHECK);
		h.server.dayOver = true;
		await goOnline(h);
		const refused = onlyAction(h);
		await h.outbox.completeAnyway(refused.op);
		await settle();
		expect(h.send).not.toHaveBeenCalled();
		expect(onlyAction(h).state).toBe('refused');
	});

	it('lets a change of the same ticket behind it wait for the completion instead', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.changeCheck(planned(), CHECK);
		await h.outbox.changeDue(ticket(A), '2026-10-22');
		await h.outbox.changeStatus(h.outbox.apply(ticket(A)), { status: 'waiting' });
		h.server.dayOver = true;
		await goOnline(h);
		// The due date is a chain of its own and arrived; the status waits for the check mark.
		expect(h.server.due.get(A)).toBe('2026-10-22');
		expect(h.outbox.actions.some((action) => isDueAction(action))).toBe(false);
		const [refused, behind] = h.outbox.actions;
		expect(refused?.state).toBe('refused');
		expect(behind?.dependsOn).toEqual([refused?.op]);
		expect(h.send).not.toHaveBeenCalled();
		await h.outbox.completeAnyway(refused?.op ?? '');
		await settle();
		expect(h.send.mock.calls.map((call) => call[0].payload.status)).toEqual(['done', 'waiting']);
		expect(h.server.status.get(A)).toBe('waiting');
	});

	it('refuses a changed check mark for good as well', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.changeCheck(planned(), CHECK);
		const fields = {
			checked: { code: 'validation_dayplan_conflict', message: '' },
			status: {
				code: 'validation_ticket_conflict',
				message: '',
				params: { actual: 'waiting' }
			}
		};
		h.sendDayPlan.mockRejectedValueOnce(new DataError('validation', { status: 400, fields }));
		await goOnline(h);
		const action = onlyAction(h);
		expect(action.state).toBe('refused');
		expect(action.outcome?.code).toBe('validation_dayplan_conflict');
		await h.outbox.retry();
		await settle();
		expect(h.sendDayPlan).toHaveBeenCalledTimes(1);
	});
});

describe('after a first attempt that arrived (OF-3, rest of OF-2b 1)', () => {
	it('sends a change that waited behind it at once, without another occasion', async () => {
		const h = await ready();
		let release = () => undefined as void;
		h.send.mockImplementationOnce(async (action, fields) => {
			await new Promise<void>((resolve) => (release = resolve));
			h.server.status.set(action.target, action.payload.status);
			h.server.applied.add(fields.opId);
			return ticket(action.target, action.payload.status, SAVED_AT);
		});
		const first = h.outbox.changeStatus(ticket(A), { status: 'in_progress' });
		await settle();
		await h.outbox.changeStatus(ticket(A, 'in_progress'), { status: 'done' });
		await settle();
		expect(h.send).toHaveBeenCalledTimes(1);
		release();
		await first;
		await settle();
		expect(h.send).toHaveBeenCalledTimes(2);
		expect(h.server.status.get(A)).toBe('done');
		expect(h.outbox.count).toBe(0);
	});
});

describe('"Verwerfen" of a change that may have arrived (OF-3, rest of OF-2b 2)', () => {
	/** A change whose request reached the server, but whose answer got lost. */
	async function lostAnswer(h: Harness) {
		h.server.lose = 1;
		h.server.health = false;
		await h.outbox.changeStatus(ticket(A), { status: 'done' });
		await settle();
		return onlyAction(h);
	}

	it('keeps it to the end and takes it back behind it, honestly named in the flag', async () => {
		const h = await ready();
		const original = await lostAnswer(h);
		expect(original).toMatchObject({ sent: true, unanswered: true });
		await h.outbox.discard(original.op);
		const [kept, counter] = h.outbox.actions;
		expect(kept).toMatchObject({ op: original.op, discarded: true });
		expect(counter).toMatchObject({
			undoes: original.op,
			dependsOn: [original.op],
			payload: { status: 'open' },
			expected: { status: 'done' }
		});
		expect(h.flags.show).toHaveBeenLastCalledWith(
			expect.objectContaining({
				title: '„HAUS-01 erledigt“ wird zurückgenommen, sobald eine Verbindung besteht.',
				description: OFFLINE_TEXTS.takenBackHint
			})
		);
		await goOnline(h);
		expect(h.server.sent).toEqual([original.op, original.op, counter?.op]);
		expect(h.server.status.get(A)).toBe('open');
		expect(h.outbox.count).toBe(0);
	});

	it('brings a change to the end that never reached the server, and takes it back after it', async () => {
		const h = await ready();
		h.server.reachable = false;
		h.server.health = false;
		await h.outbox.changeStatus(ticket(A), { status: 'done' });
		await settle();
		const original = onlyAction(h);
		await h.outbox.discard(original.op);
		await goOnline(h);
		expect(h.server.status.get(A)).toBe('open');
		expect(h.outbox.count).toBe(0);
	});

	it('drops it and its counter action without a word when the server refuses it', async () => {
		const h = await ready();
		const original = await lostAnswer(h);
		await h.outbox.discard(original.op);
		// A refusal after the identifier was looked up (OF-3b: 403 and 404 come before it and show).
		h.send.mockRejectedValueOnce(refusal('status', 'validation_recurrence_open_instance'));
		await goOnline(h);
		expect(h.outbox.count).toBe(0);
		expect(h.outbox.refusals).toHaveLength(0);
		expect(h.outbox.conflicts).toHaveLength(0);
		expect(h.send).toHaveBeenCalledTimes(2);
	});

	it('overwrites no change made meanwhile: the counter action waits as a conflict', async () => {
		const h = await ready();
		const original = await lostAnswer(h);
		await h.outbox.discard(original.op);
		h.server.status.set(A, 'waiting');
		await goOnline(h);
		const counter = onlyAction(h);
		expect(counter.undoes).toBe(original.op);
		expect(counter.state).toBe('conflict');
		expect(h.server.status.get(A)).toBe('waiting');
	});

	it('only drops a change after an answer of the server, as before', async () => {
		const h = await ready();
		h.server.health = false;
		h.send.mockRejectedValueOnce(new DataError('network'));
		await h.outbox.changeStatus(ticket(A), { status: 'done' });
		await settle();
		h.send.mockRejectedValueOnce(new DataError('server', { status: 503 }));
		await goOnline(h);
		const answered = onlyAction(h);
		expect(answered.unanswered).toBeUndefined();
		await h.outbox.discard(answered.op);
		expect(h.outbox.count).toBe(0);
	});

	it('"Rückgängig" removes the counter action and the change goes on', async () => {
		const h = await ready();
		const original = await lostAnswer(h);
		await h.outbox.discard(original.op);
		const undo = h.flags.show.mock.calls.at(-1)?.[0].action;
		undo?.run();
		await settle();
		const kept = onlyAction(h);
		expect(kept.op).toBe(original.op);
		expect(kept.discarded).toBeUndefined();
		await goOnline(h);
		expect(h.server.status.get(A)).toBe('done');
		expect(h.outbox.count).toBe(0);
	});

	it('takes a due date and a check mark back with the value before', async () => {
		const h = await ready();
		// Both first attempts leave the device and get no answer; then the connection is known gone.
		h.server.reachable = false;
		await h.outbox.changeDue(ticket(A), '2026-10-22');
		await h.outbox.changeCheck({ item: entry(ITEM, B), ticket: ticket(B) }, CHECK);
		await settle();
		await goOffline(h);
		for (const action of [...h.outbox.actions]) await h.outbox.discard(action.op);
		const counters = h.outbox.actions.filter((action) => action.undoes !== undefined);
		expect(counters.map((action) => action.payload)).toEqual([
			{ due: null },
			{ action: 'complete', status: 'open' }
		]);
		expect(counters.map((action) => action.kind)).toEqual(['ticket.update', 'dayplan.uncheck']);
		expect(isDayPlanAction(counters[1] as KeptAction) && counters[1]?.expected).toEqual({
			doneToday: false,
			status: 'done'
		});
		await goOnline(h);
		expect(h.server.due.get(A)).toBeNull();
		expect(h.server.status.get(B)).toBe('open');
		expect(h.outbox.count).toBe(0);
	});
});
