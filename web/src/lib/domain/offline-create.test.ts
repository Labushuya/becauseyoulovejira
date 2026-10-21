// The pure rules of "＋" without a connection (OF-4a, ADR-0074 addendum OF-4a): the ID of the client,
// the form of a creation on the device, its plan, a change taken into it or waiting for it, the fields
// of its requests, its words and the ticket and the entry the views show until the server has them.

import { describe, expect, it } from 'vitest';
import {
	RECORD_ID_PATTERN,
	actionName,
	actionText,
	agedActions,
	createdItemOf,
	createdTicketOf,
	expectedOf,
	isBroken,
	keyLabel,
	newOpId,
	newRecordId,
	parseAction,
	planCreate,
	planTicketDue,
	planTicketStatus,
	requestFields,
	ticketName,
	verdictOf,
	withoutFieldOf,
	writesOf,
	type InboxCreateAction,
	type KeptAction,
	type TicketCreateAction
} from './offline';

const NOW = Date.UTC(2026, 9, 21, 12, 0, 0);
const USER = 'user00000000001';
const ID = 'abcdefghijklmno';
const PROJECT = 'proj00000000001';

function creation(overrides: Partial<TicketCreateAction> = {}): TicketCreateAction {
	return {
		v: 1,
		op: 'zzzzzzzzzzzzzzzzzzz1',
		seq: 1,
		user: USER,
		scope: `u:${USER}`,
		kind: 'ticket.create',
		target: ID,
		dependsOn: [],
		key: '',
		title: 'Zahnarzt anrufen',
		createdAt: NOW - 60_000,
		state: 'queued',
		attempts: 0,
		nextAttemptAt: 0,
		payload: {
			title: 'Zahnarzt anrufen',
			status: 'open',
			priority: 'medium',
			due: null,
			project: null,
			tags: [],
			household: ''
		},
		expected: {},
		...overrides
	};
}

function item(overrides: Partial<InboxCreateAction> = {}): InboxCreateAction {
	return {
		...creation(),
		kind: 'inbox.create',
		title: 'Milch kaufen',
		payload: {
			title: 'Milch kaufen',
			household: '',
			preset: { project: PROJECT, tags: [], priority: 'high' }
		},
		expected: {},
		...overrides
	};
}

const CONTEXT = { user: USER, op: 'zzzzzzzzzzzzzzzzzzz2', seq: 2, now: NOW, offline: true };
const CHANGE = { target: ID, key: '', title: 'Zahnarzt anrufen', scope: `u:${USER}` };

describe('the ID of the client (OF-4a, ADR-0074 §5)', () => {
	it('draws 15 characters a–z0–9 like PocketBase, only from getRandomValues', () => {
		const id = newRecordId((bytes) => crypto.getRandomValues(bytes));
		expect(id).toMatch(RECORD_ID_PATTERN);
		expect(id).toHaveLength(15);
	});

	it('draws a byte of 252 and above again, so every character is equally likely', () => {
		let call = 0;
		const id = newRecordId((bytes) => {
			// First round: only bytes the alphabet cannot take evenly, then 35 ("9").
			bytes.fill(call++ === 0 ? 252 : 35);
			return bytes;
		});
		expect(id).toBe('999999999999999');
		expect(call).toBe(2);
		// 252 = 7 × 36: below it every character comes from seven bytes.
		const counts = new Map<string, number>();
		for (let byte = 0; byte < 252; byte++) {
			const drawn = newRecordId((bytes) => bytes.fill(byte));
			counts.set(drawn[0] ?? '', (counts.get(drawn[0] ?? '') ?? 0) + 1);
		}
		expect(counts.size).toBe(36);
		expect(new Set(counts.values())).toEqual(new Set([7]));
	});

	it('keeps the identifier of an action as it was: 20 characters', () => {
		expect(newOpId((bytes) => bytes.fill(1))).toBe('bbbbbbbbbbbbbbbbbbbb');
	});
});

describe('a creation on the device (OF-4a)', () => {
	it('reads a creation of a ticket and of an entry back as it was kept', () => {
		const ticket = creation({
			payload: { ...creation().payload, project: PROJECT, tags: [PROJECT] }
		});
		expect(parseAction(JSON.parse(JSON.stringify(ticket)))).toEqual(ticket);
		const entry = item();
		expect(parseAction(JSON.parse(JSON.stringify(entry)))).toEqual(entry);
	});

	it('shows one of another form as not readable and never sends it', () => {
		const broken = [
			{ ...creation(), target: 'tmp-1' },
			{ ...creation(), payload: { ...creation().payload, title: '  ' } },
			{ ...creation(), payload: { ...creation().payload, title: 'x'.repeat(201) } },
			{ ...creation(), payload: { ...creation().payload, status: 'gone' } },
			{ ...creation(), payload: { ...creation().payload, tags: ['tag'] } },
			{ ...creation(), payload: { ...creation().payload, household: 'h:1' } },
			{ ...creation(), dependsOn: ['zzzzzzzzzzzzzzzzzzz9'] },
			{ ...creation(), undoes: 'zzzzzzzzzzzzzzzzzzz9' },
			{ ...item(), payload: { title: 'x', household: '', preset: { project: 'p', tags: [] } } }
		];
		for (const raw of broken) {
			const parsed = parseAction(JSON.parse(JSON.stringify(raw)));
			expect(parsed !== null && isBroken(parsed), JSON.stringify(raw)).toBe(true);
		}
	});

	it('takes part in no chain of a value: it names none before and writes none', () => {
		expect(expectedOf(creation()).size).toBe(0);
		expect(writesOf(creation()).size).toBe(0);
	});

	it('is sent at once with a connection and kept without one, depending on nothing', () => {
		const change = {
			kind: 'ticket.create' as const,
			target: ID,
			scope: `u:${USER}`,
			payload: creation().payload
		};
		const online = planCreate(change, { ...CONTEXT, offline: false });
		expect(online.kind).toBe('send');
		expect(online.kind === 'send' && online.action).toMatchObject({
			kind: 'ticket.create',
			target: ID,
			key: '',
			title: 'Zahnarzt anrufen',
			state: 'sending',
			sent: true,
			dependsOn: []
		});
		expect(planCreate(change, CONTEXT).kind).toBe('queue');
	});

	it('sends only its identifier first, later the time of the device, never a value before', () => {
		expect(requestFields(creation(), true)).toEqual({ opId: creation().op });
		expect(requestFields(creation(), false)).toEqual({
			opId: creation().op,
			clientAt: new Date(NOW - 60_000).toISOString()
		});
		expect(requestFields(creation({ late: true }), false)).toEqual({
			opId: creation().op,
			offline: true
		});
	});
});

describe('a change of a ticket "＋" created (OF-4a, concept §3.3)', () => {
	it('goes into the creation while that never left the device', () => {
		const plan = planTicketStatus(
			[creation()],
			{ ...CHANGE, base: 'open', status: 'in_progress' },
			CONTEXT
		);
		expect(plan).toMatchObject({
			kind: 'merge',
			action: { op: creation().op, payload: { status: 'in_progress' } }
		});
		const due = planTicketDue([creation()], { ...CHANGE, base: null, due: '2026-10-22' }, CONTEXT);
		expect(due).toMatchObject({ kind: 'merge', action: { payload: { due: '2026-10-22' } } });
	});

	it('waits for a creation that left the device, based on what it creates', () => {
		const sent = creation({ sent: true, unanswered: true });
		const plan = planTicketStatus(
			[sent],
			{ ...CHANGE, base: 'open', status: 'done' },
			{
				...CONTEXT,
				offline: false
			}
		);
		expect(plan).toMatchObject({
			kind: 'queue',
			action: { dependsOn: [sent.op], expected: { status: 'open' }, payload: { status: 'done' } }
		});
		const due = planTicketDue(
			[sent],
			{ ...CHANGE, base: null, due: '2026-10-22' },
			{
				...CONTEXT,
				offline: false
			}
		);
		expect(due).toMatchObject({
			kind: 'queue',
			action: { dependsOn: [sent.op], expected: { due: null } }
		});
	});

	it('plans a change of a ticket under the ID of a discarded creation like any other: neither into it nor behind it', () => {
		const discarded = creation({ sent: true, discarded: true });
		const change = { ...CHANGE, key: 'TASK-1', base: 'open' as const, status: 'done' as const };
		const plan = planTicketStatus([discarded], change, CONTEXT);
		expect(plan).toMatchObject({
			kind: 'queue',
			action: { kind: 'ticket.update', dependsOn: [], expected: { status: 'open' } }
		});
		const due = planTicketDue([discarded], { ...CHANGE, base: null, due: '2026-10-22' }, CONTEXT);
		expect(due).toMatchObject({ kind: 'queue', action: { dependsOn: [] } });
	});

	it('never lets a discarded creation that may have arrived expire: it is only looked up', () => {
		const old = NOW + 49 * 60 * 60 * 1000;
		const waiting = creation();
		const looked = creation({ op: 'zzzzzzzzzzzzzzzzzzz3', discarded: true, unanswered: true });
		expect(agedActions([waiting, looked], old)).toEqual({ expire: [waiting.op], drop: [] });
	});
});

describe('words and views of a creation (OF-4a, concept §2.3)', () => {
	it('names it by its title and shows "Neu" in the place of the key', () => {
		expect(actionText(creation())).toBe('Neues Ticket „Zahnarzt anrufen“');
		expect(actionText(item())).toBe('Neuer Eingangseintrag „Milch kaufen“');
		expect(actionName(creation())).toBe('Neues Ticket „Zahnarzt anrufen“');
		expect(keyLabel('')).toBe('Neu');
		expect(keyLabel('HAUS-12')).toBe('HAUS-12');
		expect(ticketName({ key: '', title: 'Zahnarzt anrufen' })).toBe(
			'Neues Ticket „Zahnarzt anrufen“'
		);
		expect(ticketName({ key: 'HAUS-12', title: 'x' })).toBe('HAUS-12');
	});

	it('shows the ticket with its ID, without a key, with the values of the line', () => {
		const ticket = createdTicketOf(
			creation({ payload: { ...creation().payload, status: 'done', project: PROJECT } })
		);
		expect(ticket).toMatchObject({
			id: ID,
			key: '',
			title: 'Zahnarzt anrufen',
			status: 'done',
			projectId: PROJECT,
			source: 'quick',
			owner: USER,
			description: ''
		});
		expect(ticket.completedAt).not.toBeNull();
	});

	it('shows the entry of the inbox with its preset', () => {
		expect(createdItemOf(item())).toMatchObject({
			id: ID,
			channel: 'quick',
			kind: 'todo',
			state: 'new',
			title: 'Milch kaufen',
			sourceMeta: { preset: { project: PROJECT, priority: 'high' } }
		});
	});

	it('offers "Ohne Projekt anlegen" only for a refusal at the project of one that has a project', () => {
		const failure = {
			kind: 'validation' as const,
			status: 400,
			message: '',
			fields: { project: { code: 'validation_project_archived', message: 'Archiviert.' } }
		};
		const verdict = verdictOf(failure);
		expect(verdict).toMatchObject({ result: 'refused', outcome: { field: 'project' } });
		const outcome = verdict.result === 'refused' ? verdict.outcome : undefined;
		const refused: KeptAction = creation({
			state: 'refused',
			payload: { ...creation().payload, project: PROJECT },
			...(outcome !== undefined && { outcome })
		});
		expect(withoutFieldOf(refused)).toBe('project');
		expect(withoutFieldOf({ ...refused, payload: { ...creation().payload } })).toBeNull();
		expect(withoutFieldOf({ ...refused, state: 'queued' })).toBeNull();
	});
});
