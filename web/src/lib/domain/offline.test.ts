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
	chainedStatus,
	checkDelay,
	deviceTimeText,
	hasRoom,
	newOpId,
	nextToSend,
	nextWakeOf,
	overlayStatus,
	parseAction,
	planStatusChange,
	requestFields,
	serverTimeText,
	supportsKind,
	toOfflineOps,
	verdictOf,
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

	it('names what an action does and when, in the time of Berlin', () => {
		expect(actionText(action())).toBe('HAUS-12 erledigt');
		const working = action({ payload: { status: 'in_progress' } });
		expect(actionText(working)).toBe('HAUS-12 auf „In Arbeit“');
		expect(deviceTimeText(NOW - 27 * 60_000, NOW)).toBe('14:03');
		expect(deviceTimeText(NOW - 2 * 86_400_000, NOW)).toBe('18.10.2026 14:30');
		expect(serverTimeText('2026-10-20 12:10:00.000Z', NOW)).toBe('14:10');
		expect(serverTimeText('', NOW)).toBeNull();
	});

	it('says that only check marks and status are kept in this stage', () => {
		expect(OFFLINE_TEXTS.offline).toBe(
			'Keine Verbindung zu becauseyoulovejira. Abhaken und Status werden gemerkt und später übertragen.'
		);
		expect(OFFLINE_TEXTS.offlineWith(3)).toBe(
			'Keine Verbindung. 3 Änderungen sind gemerkt und werden übertragen, sobald die Verbindung zurück ist.'
		);
		expect(OFFLINE_TEXTS.logoutTitle(3)).toBe('Abmelden und 3 gemerkte Änderungen verwerfen?');
	});
});
