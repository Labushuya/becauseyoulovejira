// Pure rules of the outbox (OF-2, ADR-0074 addendum OF-2): identifiers, the capability, the format
// of an action on the device, the plan of a change (send, keep, take in, drop), the overlay, the
// order and the dependencies, the time (48 hours, 7 days), the fields of a request and the verdict
// of every code of the server.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	AUTO_SEND_MS,
	BROKEN_CODE,
	CONFLICT_TEXTS,
	DEVICE_FUTURE_MS,
	KEEP_MS,
	OFFLINE_MESSAGES,
	OFFLINE_TEXTS,
	OP_LENGTH,
	OP_PATTERN,
	OUTBOX_MAX_ACTIONS,
	STALE_SENDING_MS,
	actionText,
	agedActions,
	backoffDelay,
	canCompleteAnyway,
	chainedStatus,
	changesSomething,
	checkDelay,
	checkWish,
	completionInstead,
	counterOf,
	deviceTimeText,
	dueOfServer,
	hasRoom,
	isFromTheFuture,
	mayHaveArrived,
	newOpId,
	nextToSend,
	nextWakeOf,
	overlayDoneToday,
	overlayDue,
	overlayStatus,
	parseAction,
	planCheckChange,
	planDueChange,
	planStatusChange,
	rebasedBehind,
	requestFields,
	sameAction,
	serverTimeText,
	supportsKind,
	ticketOf,
	toOfflineOps,
	verdictOf,
	type CheckChange,
	type DayPlanAction,
	type DueAction,
	type DueChange,
	type FailureFacts,
	type OutboxAction,
	type PlanContext,
	type StatusChange
} from './offline';

// 2026-10-20 14:30 in Berlin (CEST).
const NOW = Date.UTC(2026, 9, 20, 12, 30, 0);
const USER = 'user00000000001';
const FIRST = 'aaaaaaaaaaaaaaaaaaa1';
const SECOND = 'aaaaaaaaaaaaaaaaaaa2';
const THIRD = 'aaaaaaaaaaaaaaaaaaa3';
const FOURTH = 'aaaaaaaaaaaaaaaaaaa4';

function action(overrides: Partial<OutboxAction> = {}): OutboxAction {
	return {
		v: 1,
		op: FIRST,
		seq: 1,
		user: USER,
		scope: `u:${USER}`,
		kind: 'ticket.update',
		target: 'tick00000000001',
		dependsOn: [],
		payload: { status: 'done' },
		expected: { status: 'open' },
		key: 'HAUS-12',
		title: 'Müll rausbringen',
		createdAt: NOW - 60_000,
		state: 'queued',
		attempts: 0,
		nextAttemptAt: 0,
		...overrides
	};
}

function change(overrides: Partial<StatusChange> = {}): StatusChange {
	return {
		target: 'tick00000000001',
		key: 'HAUS-12',
		title: 'Müll rausbringen',
		scope: `u:${USER}`,
		base: 'open',
		status: 'done',
		...overrides
	};
}

const CONTEXT: PlanContext = {
	user: USER,
	op: 'bbbbbbbbbbbbbbbbbbb2',
	seq: 7,
	now: NOW,
	offline: false
};
const OFFLINE: PlanContext = { ...CONTEXT, offline: true };

function failure(overrides: Partial<FailureFacts>): FailureFacts {
	const message = 'Bitte die markierten Eingaben prüfen.';
	return { kind: 'validation', status: 400, message, fields: {}, ...overrides };
}

/** A refusal at one field. */
function at(field: string, code: string, params?: Record<string, unknown>): FailureFacts {
	return failure({ fields: { [field]: { code, message: 'Fremd.', ...(params && { params }) } } });
}

/** The source of a file without its comments. */
function code(file: string): string {
	return readFileSync(file, 'utf8')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/\/\/.*$/gm, '');
}

describe('identifier of an action (ADR-0074 §2)', () => {
	it('draws 20 characters a–z0–9 that the server takes', () => {
		const id = newOpId((bytes) => crypto.getRandomValues(bytes));
		expect(id).toMatch(/^[a-z0-9]{20}$/);
		expect(id).toHaveLength(OP_LENGTH);
		expect(OP_PATTERN.test(id)).toBe(true);
	});

	it('draws bytes of 252 and above again, so every character is equally likely', () => {
		let call = 0;
		const id = newOpId((bytes) => {
			call += 1;
			bytes.fill(call === 1 ? 255 : 1);
			return bytes;
		});
		expect(call).toBe(2);
		expect(id).toBe('b'.repeat(20));
	});

	it('uses crypto.getRandomValues and never randomUUID (no secure context over http)', () => {
		const offlineDir = join(import.meta.dirname, '..', 'offline');
		const sources = readdirSync(offlineDir).filter((file) => !file.includes('.test.'));
		const own = join(import.meta.dirname, 'offline.ts');
		const files = [own, ...sources.map((file) => join(offlineDir, file))];
		for (const file of files) expect(code(file), file).not.toMatch(/randomUUID/);
		expect(code(join(offlineDir, 'app-outbox.ts'))).toMatch(/crypto\.getRandomValues/);
	});
});

describe('capability offline_ops (ADR-0074 §7)', () => {
	it('is missing without the field, with null and with another form', () => {
		expect(toOfflineOps(undefined)).toBeNull();
		expect(toOfflineOps(null)).toBeNull();
		expect(toOfflineOps({ version: 0, kinds: ['ticket.update'] })).toBeNull();
		expect(toOfflineOps({ version: 1 })).toBeNull();
		expect(toOfflineOps('1')).toBeNull();
	});

	it('names the actions it knows and supports the change of a ticket from version 1', () => {
		const ops = toOfflineOps({ version: 1, kinds: ['ticket.update', 'dayplan.check', 'other'] });
		expect(ops).toEqual({ version: 1, kinds: ['ticket.update', 'dayplan.check'] });
		expect(supportsKind(ops, 'ticket.update')).toBe(true);
		expect(supportsKind(ops, 'comment.create')).toBe(false);
		expect(supportsKind(null, 'ticket.update')).toBe(false);
	});
});

describe('an action on the device', () => {
	it('reads a stored action back as it was', () => {
		const kept = action({ completion: 'complete_children', children: ['tick9'], late: true });
		expect(parseAction(JSON.parse(JSON.stringify(kept)))).toEqual(kept);
	});

	it('shows an entry of another format as refused with "Verwerfen", never as one to send', () => {
		const broken = parseAction({ op: FIRST, user: USER, v: 2, kind: 'ticket.update' });
		expect(broken?.state).toBe('refused');
		expect(broken?.outcome?.code).toBe(BROKEN_CODE);
		expect(nextToSend(broken === null ? [] : [broken], NOW)).toBeNull();
	});

	it('drops an entry without an identifier or an account (it belongs to nobody)', () => {
		expect(parseAction({ op: 'short', user: USER })).toBeNull();
		expect(parseAction({ op: FIRST })).toBeNull();
		expect(parseAction(null)).toBeNull();
	});
});

describe('the plan of a change of the status (concept OF-0 §3.3)', () => {
	it('sends a change at once while the connection stands and nothing of the ticket waits', () => {
		const plan = planStatusChange([], change(), CONTEXT);
		expect(plan.kind).toBe('send');
		if (plan.kind !== 'send') return;
		expect(plan.action).toMatchObject({
			op: CONTEXT.op,
			seq: 7,
			state: 'sending',
			sendingSince: NOW,
			payload: { status: 'done' },
			expected: { status: 'open' },
			dependsOn: []
		});
	});

	it('keeps a change without a connection, and offline a change to the value there does nothing', () => {
		expect(planStatusChange([], change(), OFFLINE).kind).toBe('queue');
		expect(planStatusChange([], change({ status: 'open' }), OFFLINE).kind).toBe('none');
		// With a connection it goes as today, even to the same value.
		expect(planStatusChange([], change({ status: 'open' }), CONTEXT).kind).toBe('send');
	});

	it('takes a later change into one that waits: the value before of the first, the wish of the last', () => {
		const first = action({ payload: { status: 'in_progress' }, expected: { status: 'open' } });
		const plan = planStatusChange([first], change({ base: 'open', status: 'done' }), CONTEXT);
		expect(plan.kind).toBe('merge');
		if (plan.kind !== 'merge') return;
		expect(plan.action.op).toBe(first.op);
		expect(plan.action.payload).toEqual({ status: 'done' });
		expect(plan.action.expected).toEqual({ status: 'open' });
	});

	it('drops the waiting change when the wish is the value before again (checked, then opened)', () => {
		const plan = planStatusChange([action()], change({ status: 'open' }), CONTEXT);
		expect(plan).toEqual({ kind: 'cancel', op: FIRST });
	});

	it('lets a change wait behind one under way or one that waits for a decision, based on its wish', () => {
		for (const state of ['sending', 'conflict', 'refused', 'expired'] as const) {
			const plan = planStatusChange([action({ state })], change({ status: 'waiting' }), CONTEXT);
			expect(plan.kind, state).toBe('queue');
			if (plan.kind !== 'queue') continue;
			expect(plan.action.dependsOn).toEqual([FIRST]);
			expect(plan.action.expected).toEqual({ status: 'done' });
		}
		expect(chainedStatus('open', [])).toBe('open');
	});

	it('keeps the answer to the open sub-tasks only with a completion', () => {
		const along = change({ completion: 'complete_children', children: ['tick00000000002'] });
		const plan = planStatusChange([], along, OFFLINE);
		expect(plan.kind === 'queue' && plan.action.completion).toBe('complete_children');
		expect(plan.kind === 'queue' && plan.action.children).toEqual(['tick00000000002']);
		const forced = [action({ completion: 'force' })];
		const reopened = planStatusChange(forced, change({ status: 'waiting' }), CONTEXT);
		expect(reopened.kind === 'merge' && reopened.action.completion).toBeUndefined();
	});

	it('changes nothing for other tickets', () => {
		const plan = planStatusChange([action({ target: 'tick00000000002' })], change(), CONTEXT);
		expect(plan.kind).toBe('send');
	});
});

describe('an action that may have left the device (OF-2b, H1 and H2)', () => {
	it('is marked as sent before a change goes at once', () => {
		const plan = planStatusChange([], change(), CONTEXT);
		expect(plan.kind === 'send' && plan.action.sent).toBe(true);
		expect(planStatusChange([], change(), OFFLINE)).toMatchObject({ action: { state: 'queued' } });
		const queued = planStatusChange([], change(), OFFLINE);
		expect(queued.kind === 'queue' && queued.action.sent).toBeUndefined();
	});

	it('is never taken into a later change: that one waits for it, based on its wish', () => {
		const sent = action({ sent: true, payload: { status: 'in_progress' } });
		const plan = planStatusChange([sent], change({ status: 'done' }), OFFLINE);
		expect(plan.kind).toBe('queue');
		if (plan.kind !== 'queue') return;
		expect(plan.action.op).toBe(OFFLINE.op);
		expect(plan.action.dependsOn).toEqual([FIRST]);
		expect(plan.action.expected).toEqual({ status: 'in_progress' });
		expect(plan.action.payload).toEqual({ status: 'done' });
	});

	it('is not dropped when the wish is the value before again: a counter action goes', () => {
		const sent = action({ sent: true });
		const plan = planStatusChange([sent], change({ status: 'open' }), CONTEXT);
		expect(plan.kind).toBe('queue');
		if (plan.kind !== 'queue') return;
		expect(plan.action).toMatchObject({
			dependsOn: [FIRST],
			expected: { status: 'done' },
			payload: { status: 'open' }
		});
	});

	it('keeps its mark on the device', () => {
		const sent = action({ sent: true });
		expect(parseAction(JSON.parse(JSON.stringify(sent)))).toEqual(sent);
		expect(parseAction({ ...sent, sent: 'yes' })).not.toHaveProperty('sent');
	});

	it('is compared with the device whatever the order of the keys', () => {
		const known = action({ completion: 'complete_children', children: ['tick9'] });
		const reordered = Object.fromEntries(Object.entries(known).reverse());
		expect(sameAction(reordered, known)).toBe(true);
		expect(sameAction({ ...known, state: 'sending' }, known)).toBe(false);
		expect(sameAction(undefined, known)).toBe(false);
	});
});

describe('a change behind a discarded one (OF-2b, G6c)', () => {
	it('is based on the given state of the server, only right behind it and not while under way', () => {
		const first = action({ state: 'conflict' });
		const behind = action({ op: SECOND, seq: 2, dependsOn: [FIRST], expected: { status: 'done' } });
		const further = action({ op: THIRD, seq: 3, dependsOn: [FIRST, SECOND] });
		const sending = action({ op: FOURTH, seq: 4, dependsOn: [FIRST], state: 'sending' });
		const rebased = rebasedBehind([first, behind, further, sending], FIRST, 'waiting');
		expect(rebased.map((entry) => [entry.op, entry.expected])).toEqual([
			[SECOND, { status: 'waiting' }]
		]);
		expect(rebasedBehind([behind], FIRST, 'done')).toEqual([]);
	});
});

describe('the overlay of the display (concept OF-0 §3.5)', () => {
	const ticket = { id: 'tick00000000001', status: 'open' as const, completedAt: null };

	it('shows the wish of a waiting action, with a completion time of the device', () => {
		const shown = overlayStatus(ticket, [action()]);
		expect(shown.status).toBe('done');
		expect(shown.completedAt).toBe('2026-10-20 12:29:00.000Z');
		expect(overlayStatus(ticket, [action({ state: 'sending' })]).status).toBe('done');
	});

	it('lays nothing over the ticket for an action that waits for a decision, and keeps the object', () => {
		for (const state of ['conflict', 'refused', 'expired'] as const) {
			expect(overlayStatus(ticket, [action({ state })])).toBe(ticket);
		}
		expect(overlayStatus(ticket, [])).toBe(ticket);
	});

	it('takes the sub-tasks of a completion with "Unteraufgaben mit erledigen" along', () => {
		const child = { id: 'tick00000000002', status: 'open' as const, completedAt: null };
		const along = action({ completion: 'complete_children', children: [child.id] });
		const forced = action({ completion: 'force', children: [child.id] });
		expect(overlayStatus(child, [along]).status).toBe('done');
		expect(overlayStatus(child, [forced]).status).toBe('open');
	});

	it('reopens with the last wish and clears the time of the completion', () => {
		const completedAt = '2026-10-19 08:00:00.000Z';
		const done = { id: 'tick00000000001', status: 'done' as const, completedAt };
		const reopen = action({ payload: { status: 'open' }, expected: { status: 'done' } });
		const shown = overlayStatus(done, [reopen]);
		expect(shown).toEqual({ ...done, status: 'open', completedAt: null });
	});
});

describe('order, dependencies and waking up (concept OF-0 §3.3, §3.9)', () => {
	it('sends in the order of the device, one after another', () => {
		const later = action({ op: SECOND, seq: 2, target: 'tick00000000002' });
		expect(nextToSend([later, action()], NOW)?.op).toBe(FIRST);
	});

	it('waits for what an action depends on, and for its time after an error of the server', () => {
		const first = action({ state: 'conflict' });
		const second = action({ op: SECOND, seq: 2, dependsOn: [FIRST] });
		expect(nextToSend([first, second], NOW)).toBeNull();
		expect(nextToSend([second], NOW)?.op).toBe(SECOND);
		const later = action({ nextAttemptAt: NOW + 5000 });
		expect(nextToSend([later], NOW)).toBeNull();
		expect(nextWakeOf([later], NOW)).toBe(NOW + 5000);
	});

	it('takes an action again whose sender died, after the time of a request', () => {
		const sending = action({ state: 'sending', sendingSince: NOW - 1000 });
		const free = NOW - 1000 + STALE_SENDING_MS;
		expect(nextToSend([sending], NOW)).toBeNull();
		expect(nextWakeOf([sending], NOW)).toBe(free);
		expect(nextToSend([sending], free)?.op).toBe(FIRST);
	});
});

describe('the time (decision of the user 2)', () => {
	it('sends on its own up to 48 hours, then waits for a decision, and drops after 7 days', () => {
		const young = action({ op: FIRST, createdAt: NOW - AUTO_SEND_MS + 1 });
		const old = action({ op: SECOND, createdAt: NOW - AUTO_SEND_MS });
		const late = action({ op: THIRD, createdAt: NOW - AUTO_SEND_MS, late: true });
		const gone = action({ op: FOURTH, createdAt: NOW - KEEP_MS, state: 'conflict' });
		const aged = agedActions([young, old, late, gone], NOW);
		expect(aged).toEqual({ expire: [SECOND], drop: [FOURTH] });
	});

	it('lets a change from the future wait for a decision, never sent or deleted on its own (OF-2b, G4)', () => {
		const ahead = NOW + DEVICE_FUTURE_MS + 1;
		const kept = action({ op: FIRST, createdAt: ahead });
		const marked = action({ op: SECOND, state: 'sending', sendingSince: ahead });
		const close = action({ op: THIRD, createdAt: NOW + DEVICE_FUTURE_MS });
		const decided = action({ op: FOURTH, createdAt: ahead, late: true });
		expect(isFromTheFuture(kept, NOW)).toBe(true);
		expect(isFromTheFuture(marked, NOW)).toBe(true);
		expect(isFromTheFuture(close, NOW)).toBe(false);
		expect(isFromTheFuture(decided, NOW)).toBe(false);
		expect(agedActions([kept, marked, close, decided], NOW)).toEqual({
			expire: [FIRST, SECOND],
			drop: []
		});
	});

	it('lets an orphaned action "sending" age, but not one under way (OF-2b, G4)', () => {
		const old = NOW - AUTO_SEND_MS;
		const orphan = action({ op: FIRST, state: 'sending', sendingSince: old, createdAt: old });
		const underway = action({ op: SECOND, state: 'sending', sendingSince: NOW, createdAt: old });
		expect(agedActions([orphan, underway], NOW)).toEqual({ expire: [FIRST], drop: [] });
	});

	it('waits 2, 5, 10, 30 and 60 s after errors of the server, with a spread of ±20 %', () => {
		const middle = [1, 2, 3, 4, 5, 9].map((attempt) => backoffDelay(attempt, () => 0.5));
		expect(middle).toEqual([2000, 5000, 10000, 30000, 60000, 60000]);
		expect(backoffDelay(1, () => 0)).toBe(1600);
		expect(backoffDelay(1, () => 1)).toBe(2400);
		const checks = [1, 2, 3, 4, 5, 6].map(checkDelay);
		expect(checks).toEqual([2000, 5000, 10000, 30000, 60000, 60000]);
	});
});

describe('the fields of a request (ADR-0074 §2 to §4)', () => {
	it('sends only the identifier on the first attempt, so a change with a connection stays as today', () => {
		expect(requestFields(action(), true)).toEqual({ opId: FIRST });
	});

	it('sends the time of the device and the value before on every later attempt', () => {
		expect(requestFields(action(), false)).toEqual({
			opId: FIRST,
			expected: { status: 'open' },
			clientAt: '2026-10-20T12:29:00.000Z'
		});
	});

	it('marks "Trotzdem übertragen" after 48 hours as offline without the time', () => {
		expect(requestFields(action({ late: true }), false)).toEqual({
			opId: FIRST,
			expected: { status: 'open' },
			offline: true
		});
	});
});

describe('the verdict of an answer (concept OF-0 §3.7, ADR-0074 §6)', () => {
	it('counts an identifier the server knows as arrived', () => {
		const params = { record: 'tick00000000001', kind: 'ticket.update' };
		expect(verdictOf(at('op_id', 'validation_op_applied', params))).toEqual({ result: 'arrived' });
	});

	it('turns a conflict at the status into a decision with the value of the server and its time', () => {
		const updated = '2026-10-20 12:10:00.000Z';
		const params = { expected: 'open', actual: 'waiting', updated };
		const verdict = verdictOf(at('status', 'validation_ticket_conflict', params));
		expect(verdict).toEqual({
			result: 'conflict',
			outcome: {
				code: 'validation_ticket_conflict',
				message: CONFLICT_TEXTS.status,
				actual: 'waiting',
				updated
			}
		});
	});

	it('refuses the other codes of the outbox for good, with the words of the hook', () => {
		const codes = [
			['op_id', 'validation_op_invalid'],
			['op_id', 'validation_op_reused'],
			['expected', 'validation_expected_invalid'],
			['checked', 'validation_dayplan_conflict']
		] as const;
		for (const [field, code] of codes) {
			const outcome = { code, message: OFFLINE_MESSAGES[code] };
			expect(verdictOf(at(field, code)), code).toEqual({ result: 'refused', outcome });
		}
	});

	it('keeps the question about open sub-tasks with their number', () => {
		const verdict = verdictOf(at('status', 'validation_parent_open_children', { count: 2 }));
		expect(verdict).toEqual({
			result: 'refused',
			outcome: { code: 'validation_parent_open_children', message: 'Fremd.', count: 2 }
		});
	});

	it('refuses a ticket that is gone or no longer visible, never tried again', () => {
		const gone = failure({ kind: 'not_found', status: 404, message: 'Nicht gefunden.' });
		const outcome = { code: 'not_found', message: 'Nicht gefunden.' };
		expect(verdictOf(gone)).toEqual({ result: 'refused', outcome });
		const forbidden = failure({ kind: 'forbidden', status: 403, message: 'Keine Berechtigung.' });
		expect(verdictOf(forbidden).result).toBe('refused');
		expect(verdictOf(failure({ kind: 'server', status: 400 })).result).toBe('refused');
	});

	it('waits for the sign-in on 401, for the connection without an answer, and tries 5xx again later', () => {
		expect(verdictOf(failure({ kind: 'session', status: 401 }))).toEqual({ result: 'session' });
		expect(verdictOf(failure({ kind: 'network', status: 0 }))).toEqual({ result: 'network' });
		expect(verdictOf(failure({ kind: 'aborted', status: 0 }))).toEqual({ result: 'network' });
		expect(verdictOf(failure({ kind: 'server', status: 503 }))).toEqual({ result: 'server' });
	});
});

describe('limits and words', () => {
	it('holds at most 200 actions', () => {
		const opOf = (index: number) => `op${String(index).padStart(18, '0')}`;
		const many = Array.from({ length: OUTBOX_MAX_ACTIONS - 1 }, (_, index) =>
			action({ op: opOf(index) })
		);
		const next = action({ op: 'cccccccccccccccccccc' });
		expect(hasRoom(many, next)).toBe(true);
		expect(hasRoom([...many, action({ op: 'dddddddddddddddddddd' })], next)).toBe(false);
	});

	it('counts taking a change into an action as no action more (OF-2b, G4)', () => {
		const opOf = (index: number) => `op${String(index).padStart(18, '0')}`;
		const full = Array.from({ length: OUTBOX_MAX_ACTIONS }, (_, index) =>
			action({ op: opOf(index) })
		);
		const merged = action({ op: opOf(7), payload: { status: 'waiting' } });
		expect(hasRoom(full, merged)).toBe(true);
		expect(hasRoom(full, action({ op: 'cccccccccccccccccccc' }))).toBe(false);
	});

	it('names what an action does and when, in the time of Berlin', () => {
		expect(actionText(action())).toBe('HAUS-12 erledigt');
		const working = action({ payload: { status: 'in_progress' } });
		expect(actionText(working)).toBe('HAUS-12 auf „In Arbeit“');
		expect(deviceTimeText(NOW - 27 * 60_000, NOW)).toBe('14:03');
		expect(deviceTimeText(NOW - 2 * 86_400_000, NOW)).toBe('18.10.2026 14:30');
		expect(serverTimeText('2026-10-20 12:10:00.000Z', NOW)).toBe('14:10');
		expect(serverTimeText('', NOW)).toBeNull();
	});

	it('says what is kept in this stage: check marks, status, the day plan and the due date (OF-3)', () => {
		expect(OFFLINE_TEXTS.offline).toBe(
			'Keine Verbindung zu becauseyoulovejira. Abhaken, Status, Tagesplan und Fälligkeit werden gemerkt und später übertragen.'
		);
		expect(OFFLINE_TEXTS.offlineWith(3)).toBe(
			'Keine Verbindung. 3 Änderungen sind gemerkt und werden übertragen, sobald die Verbindung zurück ist.'
		);
		expect(OFFLINE_TEXTS.logoutTitle(3)).toBe('Abmelden und 3 gemerkte Änderungen verwerfen?');
	});
});

// --- OF-3: the due date and the check marks of the day plan --------------------------------------

const TICKET = 'tick00000000001';
const ITEM = 'item00000000001';

function dueAction(overrides: Partial<DueAction> = {}): DueAction {
	return {
		v: 1,
		op: FIRST,
		seq: 1,
		user: USER,
		scope: `u:${USER}`,
		kind: 'ticket.update',
		target: TICKET,
		dependsOn: [],
		payload: { due: '2026-10-22' },
		expected: { due: null },
		key: 'HAUS-12',
		title: 'Müll rausbringen',
		createdAt: NOW - 60_000,
		state: 'queued',
		attempts: 0,
		nextAttemptAt: 0,
		...overrides
	};
}

function planCheck(overrides: Partial<DayPlanAction> = {}): DayPlanAction {
	return {
		v: 1,
		op: FIRST,
		seq: 1,
		user: USER,
		scope: `u:${USER}`,
		kind: 'dayplan.check',
		target: ITEM,
		ticket: TICKET,
		ticketKind: 'task',
		dependsOn: [],
		payload: { action: 'complete', mode: 'check' },
		expected: { doneToday: false, status: 'open' },
		key: 'HAUS-12',
		title: 'Müll rausbringen',
		createdAt: NOW - 60_000,
		state: 'queued',
		attempts: 0,
		nextAttemptAt: 0,
		...overrides
	};
}

function dueChange(overrides: Partial<DueChange> = {}): DueChange {
	return {
		target: TICKET,
		key: 'HAUS-12',
		title: 'Müll rausbringen',
		scope: `u:${USER}`,
		base: null,
		due: '2026-10-22',
		...overrides
	};
}

function checkChange(overrides: Partial<CheckChange> = {}): CheckChange {
	return {
		kind: 'dayplan.check',
		target: ITEM,
		ticket: TICKET,
		ticketKind: 'task',
		key: 'HAUS-12',
		title: 'Müll rausbringen',
		scope: `u:${USER}`,
		base: { doneToday: false, status: 'open' },
		mode: 'check',
		...overrides
	};
}

describe('a change of the due date (OF-3)', () => {
	it('reads a kept due date back as it was, and one of another form as refused', () => {
		const kept = dueAction({ sent: true, unanswered: true, discarded: true });
		expect(parseAction(JSON.parse(JSON.stringify(kept)))).toEqual(kept);
		const german = parseAction({ ...kept, payload: { due: '22.10.2026' } });
		expect(german?.outcome?.code).toBe(BROKEN_CODE);
		expect(parseAction({ ...kept, payload: {} })?.outcome?.code).toBe(BROKEN_CODE);
	});

	it('goes at once with a connection, is kept without one and does nothing offline for the same date', () => {
		const plan = planDueChange([], dueChange(), CONTEXT);
		expect(plan).toMatchObject({
			kind: 'send',
			action: {
				state: 'sending',
				sent: true,
				payload: { due: '2026-10-22' },
				expected: { due: null }
			}
		});
		expect(planDueChange([], dueChange(), OFFLINE).kind).toBe('queue');
		expect(planDueChange([], dueChange({ due: null }), OFFLINE).kind).toBe('none');
	});

	it('takes a later date into a waiting one, drops it on the date before, and waits behind a sent one', () => {
		const waiting = dueAction();
		const merged = planDueChange([waiting], dueChange({ due: '2026-10-24' }), OFFLINE);
		expect(merged).toMatchObject({
			kind: 'merge',
			action: { op: FIRST, payload: { due: '2026-10-24' }, expected: { due: null } }
		});
		const cancel = planDueChange([waiting], dueChange({ due: null }), OFFLINE);
		expect(cancel).toEqual({ kind: 'cancel', op: FIRST });
		const behind = planDueChange([dueAction({ sent: true })], dueChange({ due: null }), OFFLINE);
		expect(behind).toMatchObject({
			kind: 'queue',
			action: { dependsOn: [FIRST], expected: { due: '2026-10-22' }, payload: { due: null } }
		});
		// A status of the same ticket is another chain.
		expect(planStatusChange([waiting], change(), CONTEXT).kind).toBe('send');
	});

	it('lays the waiting date over the ticket, none of one that waits for a decision', () => {
		const ticket = { id: TICKET, due: null };
		expect(overlayDue(ticket, [dueAction()]).due).toBe('2026-10-22');
		expect(overlayDue(ticket, [dueAction({ state: 'conflict' })])).toBe(ticket);
		expect(overlayDue(ticket, [action()])).toBe(ticket);
	});

	it('sends the date before in the form of the history, and names the change in words', () => {
		expect(requestFields(dueAction(), true)).toEqual({ opId: FIRST });
		expect(requestFields(dueAction({ expected: { due: '2026-10-20' } }), false)).toEqual({
			opId: FIRST,
			expected: { due: '2026-10-20 00:00:00.000Z' },
			clientAt: '2026-10-20T12:29:00.000Z'
		});
		expect(requestFields(dueAction(), false).expected).toEqual({ due: '' });
		expect(actionText(dueAction())).toBe('HAUS-12 fällig am 22.10.2026');
		const cleared = dueAction({ payload: { due: null } });
		expect(actionText(cleared)).toBe('HAUS-12 ohne Fälligkeit');
		expect(dueOfServer('2026-10-25 00:00:00.000Z')).toBe('2026-10-25');
		expect(dueOfServer('')).toBeNull();
		expect(dueOfServer('morgen')).toBeUndefined();
	});
});

describe('a check mark of the day plan (OF-3)', () => {
	it('reads a kept check mark back as it was, and one without its ticket as refused', () => {
		const kept = planCheck({
			completion: 'complete_children',
			children: ['tick9'],
			undoes: SECOND
		});
		expect(parseAction(JSON.parse(JSON.stringify(kept)))).toEqual(kept);
		const back = planCheck({
			kind: 'dayplan.uncheck',
			payload: { action: 'complete', status: 'waiting' }
		});
		expect(parseAction(JSON.parse(JSON.stringify(back)))).toEqual(back);
		expect(parseAction({ ...kept, ticket: '' })?.outcome?.code).toBe(BROKEN_CODE);
		const modeless = parseAction({ ...kept, payload: { action: 'complete' } });
		expect(modeless?.outcome?.code).toBe(BROKEN_CODE);
		expect(ticketOf(kept)).toBe(TICKET);
		expect(ticketOf(action())).toBe('tick00000000001');
	});

	it('sets what the server sets: the mark of the day, the completion, and back', () => {
		const base = { doneToday: false, status: 'open' as const };
		const today = planCheck({ payload: { action: 'today', mode: 'today' } });
		expect(checkWish(planCheck())).toEqual({ doneToday: false, status: 'done' });
		expect(checkWish(today)).toEqual({ doneToday: true, status: 'open' });
		const done = { doneToday: true, status: 'done' as const };
		const back = { kind: 'dayplan.uncheck' as const, expected: done };
		const clear = checkWish({ ...back, payload: { action: 'today' } });
		expect(clear).toEqual({ doneToday: false, status: 'done' });
		const reopen = checkWish({ ...back, payload: { action: 'complete', status: 'waiting' } });
		expect(reopen).toEqual({ doneToday: true, status: 'waiting' });
		// Taking back a completion of a ticket that is not done leaves its status alone.
		const open = { kind: 'dayplan.uncheck' as const, expected: base };
		expect(checkWish({ ...open, payload: { action: 'complete' } })).toEqual(base);
	});

	it('goes at once with a connection, with the state before; offline it is kept', () => {
		const plan = planCheckChange([], checkChange(), CONTEXT);
		expect(plan).toMatchObject({
			kind: 'send',
			action: {
				kind: 'dayplan.check',
				target: ITEM,
				ticket: TICKET,
				payload: { action: 'complete', mode: 'check' },
				expected: { doneToday: false, status: 'open' },
				sent: true
			}
		});
		const ongoing = planCheckChange([], checkChange({ ticketKind: 'ongoing' }), OFFLINE);
		expect(ongoing).toMatchObject({ kind: 'queue', action: { payload: { action: 'today' } } });
	});

	it('cancels a kept check mark that is taken back before it left the device', () => {
		const back = checkChange({ kind: 'dayplan.uncheck', action: 'complete', status: 'open' });
		expect(planCheckChange([planCheck()], back, OFFLINE)).toEqual({ kind: 'cancel', op: FIRST });
		// Once it may have left, taking back is a counter action based on its wish.
		const counter = planCheckChange([planCheck({ sent: true })], back, OFFLINE);
		expect(counter).toMatchObject({
			kind: 'queue',
			action: { dependsOn: [FIRST], expected: { doneToday: false, status: 'done' } }
		});
	});

	it('takes the mark of the day back first without an action, and waits behind a status of its ticket', () => {
		const marked = { doneToday: true, status: 'open' as const };
		const back = checkChange({ kind: 'dayplan.uncheck', base: marked });
		const clear = planCheckChange([], back, OFFLINE);
		expect(clear).toMatchObject({ action: { payload: { action: 'today' } } });
		const status = action({ payload: { status: 'waiting' }, expected: { status: 'open' } });
		const behind = planCheckChange([status], checkChange(), OFFLINE);
		expect(behind).toMatchObject({
			kind: 'queue',
			action: { dependsOn: [FIRST], expected: { doneToday: false, status: 'waiting' } }
		});
		// A status after a waiting check mark waits behind it, based on "done".
		const after = planStatusChange([planCheck()], change({ status: 'in_progress' }), OFFLINE);
		expect(after).toMatchObject({
			kind: 'queue',
			action: { dependsOn: [FIRST], expected: { status: 'done' } }
		});
		expect(chainedStatus('open', [planCheck()])).toBe('done');
	});

	it('lays the check mark over the entry and its ticket and sends the state before as { checked, status }', () => {
		const ticket = { id: TICKET, status: 'open' as const, completedAt: null };
		const today = planCheck({ payload: { action: 'today', mode: 'today' } });
		const entry = { id: ITEM, doneToday: false };
		expect(overlayStatus(ticket, [planCheck()]).status).toBe('done');
		expect(overlayStatus(ticket, [today])).toBe(ticket);
		expect(overlayDoneToday(entry, [today])).toBe(true);
		expect(overlayDoneToday(entry, [planCheck({ state: 'refused' })])).toBe(false);
		const marked = planCheck({ expected: { doneToday: true, status: 'open' } });
		expect(requestFields(marked, false)).toEqual({
			opId: FIRST,
			expected: { checked: true, status: 'open' },
			clientAt: '2026-10-20T12:29:00.000Z'
		});
		expect(actionText(planCheck())).toBe('HAUS-12 im Tagesplan erledigt');
		expect(actionText(today)).toBe('HAUS-12 im Tagesplan für heute abgehakt');
		const back = planCheck({ kind: 'dayplan.uncheck', payload: { action: 'today' } });
		expect(actionText(back)).toBe('HAUS-12 im Tagesplan wieder offen');
	});
});

describe('the verdict for the day plan (OF-3)', () => {
	it('refuses a changed check mark for good, also next to a changed status', () => {
		const fields = {
			checked: { code: 'validation_dayplan_conflict', message: 'Fremd.' },
			status: {
				code: 'validation_ticket_conflict',
				message: 'Fremd.',
				params: { actual: 'waiting' }
			}
		};
		expect(verdictOf(failure({ fields }))).toEqual({
			result: 'refused',
			outcome: {
				code: 'validation_dayplan_conflict',
				message: OFFLINE_MESSAGES.validation_dayplan_conflict
			}
		});
	});

	it('refuses a check mark of a day gone by for good, in its own words', () => {
		expect(verdictOf(at('date', 'validation_dayplan_readonly'))).toEqual({
			result: 'refused',
			outcome: { code: 'validation_dayplan_readonly', message: OFFLINE_TEXTS.dayOver }
		});
		const over = 'Der Tag ist vorbei, der Plan dieses Tages bleibt unverändert.';
		expect(OFFLINE_TEXTS.dayOver).toBe(over);
		const question = 'Der Tag ist vorbei. HAUS-12 trotzdem erledigen?';
		expect(OFFLINE_TEXTS.dayOverDone('HAUS-12')).toBe(question);
	});

	it('lets only the completion of a task become the completion of its ticket', () => {
		const outcome = { code: 'validation_dayplan_readonly', message: '' };
		const over = { state: 'refused' as const, outcome };
		const today = { action: 'today', mode: 'today' } as const;
		expect(canCompleteAnyway(planCheck(over))).toBe(true);
		expect(canCompleteAnyway(planCheck({ ...over, ticketKind: 'ongoing' }))).toBe(false);
		expect(canCompleteAnyway(planCheck({ ...over, payload: today }))).toBe(false);
		const back = planCheck({ ...over, kind: 'dayplan.uncheck', payload: { action: 'complete' } });
		expect(canCompleteAnyway(back)).toBe(false);
		expect(canCompleteAnyway(planCheck({ state: 'refused' }))).toBe(false);
		const forced = planCheck({ ...over, completion: 'force', late: true });
		const instead = completionInstead(forced, SECOND);
		expect(instead).toMatchObject({
			op: SECOND,
			seq: 1,
			kind: 'ticket.update',
			target: TICKET,
			payload: { status: 'done' },
			expected: { status: 'open' },
			completion: 'force',
			createdAt: NOW - 60_000,
			state: 'queued',
			late: true
		});
		expect(instead).not.toHaveProperty('sent');
	});
});

describe('"Verwerfen" of a change that may have arrived (OF-3)', () => {
	it('counts only a waiting change whose last request got no answer', () => {
		const lost = { sent: true as const, unanswered: true as const };
		expect(mayHaveArrived(action(lost))).toBe(true);
		expect(mayHaveArrived(action({ ...lost, state: 'expired' }))).toBe(true);
		expect(mayHaveArrived(action({ sent: true }))).toBe(false);
		expect(mayHaveArrived(action({ ...lost, state: 'conflict' }))).toBe(false);
		expect(mayHaveArrived(action())).toBe(false);
	});

	it('takes back with the value before as the wish and the wish as the value before', () => {
		const context = { ...OFFLINE, op: THIRD };
		expect(counterOf(action(), context)).toMatchObject({
			op: THIRD,
			undoes: FIRST,
			dependsOn: [FIRST],
			payload: { status: 'open' },
			expected: { status: 'done' }
		});
		expect(counterOf(dueAction(), context)).toMatchObject({
			payload: { due: null },
			expected: { due: '2026-10-22' }
		});
		expect(counterOf(planCheck(), context)).toMatchObject({
			kind: 'dayplan.uncheck',
			payload: { action: 'complete', status: 'open' },
			expected: { doneToday: false, status: 'done' }
		});
		const today = planCheck({ payload: { action: 'today', mode: 'today' } });
		expect(counterOf(today, context)).toMatchObject({
			kind: 'dayplan.uncheck',
			payload: { action: 'today' },
			expected: { doneToday: true, status: 'open' }
		});
		const back = planCheck({
			kind: 'dayplan.uncheck',
			payload: { action: 'complete', status: 'waiting' },
			expected: { doneToday: false, status: 'done' }
		});
		expect(counterOf(back, context)).toMatchObject({
			kind: 'dayplan.check',
			payload: { action: 'complete', mode: 'complete' },
			expected: { doneToday: false, status: 'waiting' }
		});
		expect(changesSomething(action())).toBe(true);
		expect(changesSomething(action({ payload: { status: 'open' } }))).toBe(false);
		const counter = counterOf(dueAction(), context) as DueAction;
		const rebased = rebasedBehind([counter], FIRST, { due: '2026-10-30' });
		expect(rebased.map((entry) => entry.expected)).toEqual([{ due: '2026-10-30' }]);
	});
});
