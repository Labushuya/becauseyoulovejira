// The scenario matrix of the outbox, class "Anlegen" (OF-4a, ADR-0074 addendum OF-4a; its own file since
// round 2 of OF-4b, K-6): "＋" as a ticket or into the inbox, with or without a connection, its request
// lost, not reached, answered with a 5xx; changes of the ticket before and after the creation left the
// device; "Verwerfen" before, while and after it may have left the device or after the changes, with or
// without "Rückgängig"; someone else changing the status before a waiting change of the new ticket is
// sent; then the connection back with a success, a refusal of the hook (with "Ohne Projekt anlegen",
// "Verwerfen" or no decision), a 503 or the record no longer to be seen. Checked, by the oracle's own
// bookkeeping of what the user did and of every request: C1 at most one record per creation (one number
// of the counter); C2 a creation the user keeps that the server does not have stands with its whole
// title; C3 a discarded creation that is there anyway is named by a notice with a link, and no notice
// names one that is not; C4 a discarded creation that never left the device never reaches the server,
// and no discarded creation is sent again; I1 the values the user wants of a kept ticket, unless a
// decision touching them is to be seen; I2 no change overwrites what someone else set; I4 after
// "Rückgängig" the creation stands once more; no hang.
// The oracle is independent of the code it checks: it keeps what the user did and every request and
// reads of the outbox only what the dialog, the views and the notices show. Every run starts the real
// outbox, its worker and the storage of the tests against the fake server of $lib/test/outbox-fake.ts,
// which creates as the hooks do; the shared helpers are in $lib/test/outbox-matrix.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { CalendarDate } from '$lib/domain/berlin-date';
import type { KeptAction } from '$lib/domain/offline';
import type { Status } from '$lib/domain/status';
import type { Ticket, TicketSummary } from '$lib/domain/ticket';
import { ALL_OPS, NOW, harness, settle } from '$lib/test/outbox-fake';
import {
	CHECKS,
	D1,
	FOREIGN,
	decides,
	drain,
	pick,
	seeded,
	times,
	type Outcome
} from '$lib/test/outbox-matrix';

/**
 * How the creation is made and goes: kept, its first request lost, not reached, 5xx, or direct; since
 * round 2 (A1) also direct with a 5xx after the server took it (`direct5xx`).
 */
type CreateSend =
	| 'offline'
	| 'lost'
	| 'unreached'
	| 'server5xx'
	| 'lost5xx'
	| 'direct'
	| 'directLost'
	| 'direct5xx';

/** The first attempt of the creation goes at once with a connection. */
function isDirect(send: CreateSend): boolean {
	return send === 'direct' || send === 'directLost' || send === 'direct5xx';
}
type CreateDiscard = 'none' | 'before' | 'during' | 'after' | 'late';
type CreateAnswer = 'success' | 'refused' | 'server' | 'hidden';
type CreateChoice = 'without' | 'discard' | 'none';

interface CreateScenario {
	record: 'ticket' | 'inbox';
	send: CreateSend;
	/** Changes of the new ticket: before its creation is sent, or after it left the device. */
	changes: { kind: 'prog' | 'done' | 'due'; when: 'before' | 'after' }[];
	discard: CreateDiscard;
	undo: boolean;
	/** Someone else sets the status right before the first change of the new ticket is sent. */
	foreign: boolean;
	answer: CreateAnswer;
	choice: CreateChoice;
}

const CREATED_TITLE = 'Neue Aufgabe vom Handy';
const CREATED_PROJECT = 'proj00000000001';
/** The ID the outbox draws first in a run (`letters()`): the one of the creation. */
const ID_OF_CREATED = 'aaaaaaaaaaaaaaa';

/** `count` drawn runs of the class "Anlegen", from a source of their own (OF-4a). */
function createScenarios(count: number, seed: number): CreateScenario[] {
	const random = seeded(seed + 4);
	const sends: readonly CreateSend[] = [
		'offline',
		'lost',
		'unreached',
		'server5xx',
		'lost5xx',
		'direct',
		'directLost',
		'direct5xx'
	];
	return times(count, (): CreateScenario => {
		const record = random() < 0.25 ? 'inbox' : 'ticket';
		const send = pick(random, sends);
		const changes =
			record === 'inbox'
				? []
				: times(Math.floor(random() * 3), () => ({
						kind: pick(random, ['prog', 'done', 'due'] as const),
						when: pick(random, ['before', 'after'] as const)
					}));
		let discard = pick(random, ['none', 'none', 'before', 'during', 'after', 'late'] as const);
		if (send === 'offline' && (discard === 'during' || discard === 'after')) discard = 'before';
		if (isDirect(send)) {
			if (discard === 'before' || discard === 'during') discard = 'after';
		}
		return {
			record,
			send,
			changes,
			discard,
			undo: discard !== 'none' && random() < 0.35,
			foreign: record === 'ticket' && random() < 0.25,
			answer: pick(random, ['success', 'success', 'refused', 'server', 'hidden'] as const),
			choice: pick(random, ['without', 'discard', 'none'] as const)
		};
	});
}

function describeCreate(scenario: CreateScenario): string {
	const changes = scenario.changes.map((change) => `${change.kind}/${change.when}`).join(',');
	return [
		`Anlegen: ${scenario.record}/${scenario.send}`,
		changes === '' ? '' : ` [${changes}]`,
		scenario.discard === 'none' ? '' : ` verwerfen:${scenario.discard}`,
		scenario.undo ? '+undo' : '',
		scenario.foreign ? ' +fremd' : '',
		` ⇒ ${scenario.answer}`,
		scenario.answer === 'refused' ? `/${scenario.choice}` : ''
	].join('');
}

/**
 * One run of the class "Anlegen" against the real outbox and the fake server, which creates as the
 * hooks do. The oracle keeps what the user did and every request and reads of the outbox only what
 * the dialog, the views and the notices show.
 */
async function runCreate(scenario: CreateScenario): Promise<Outcome> {
	vi.setSystemTime(NOW);
	const h = harness({ support: ALL_OPS });
	h.server.strict = true;
	await settle();
	const outcome: Outcome = { i1: [], i2: [], i3: [], i4: [], hang: [] };
	const c: string[] = [];
	const isTicket = scenario.record === 'ticket';

	/** Every request: its identifier, in order. */
	const requests: string[] = [];
	const firstMode = new Map<string, CreateSend>();
	const secondFails = new Set<string>();
	let during: string | null = null;
	let finalServer = false;
	let foreignPending = scenario.foreign;
	let foreignSet = false;
	/** What the user wants: the record, and of a ticket its status and due date. */
	let wantRecord = true;
	let undone = false;
	const will: { status: Status; due: CalendarDate | null } = { status: 'open', due: null };
	let creationOp: string | null = null;
	/** Requests of the creation once the user discarded it (and no "Rückgängig" since). */
	let discardedAt: number | null = null;
	let leftBeforeDiscard = true;
	let pendingUndo: (() => void) | null = null;
	/** The record of the server as the views know it (its answer, the sink). */
	let known: Ticket | null = null;
	h.sink.upsert.mockImplementation((shown: TicketSummary) => {
		known = { ...(known ?? (shown as Ticket)), ...(shown as Ticket) };
	});

	async function discardNow(op: string): Promise<void> {
		const count = h.flags.show.mock.calls.length;
		leftBeforeDiscard = requests.includes(op);
		await h.outbox.discard(op);
		wantRecord = false;
		discardedAt = requests.length;
		const run = h.flags.show.mock.calls
			.slice(count)
			.map((call) => call[0])
			.find((flag) => flag.action?.label === 'Rückgängig')?.action?.run;
		if (run === undefined) outcome.i4.push('„Verwerfen“ ohne „Rückgängig“');
		pendingUndo = run ?? null;
	}

	async function undoNow(): Promise<void> {
		const run = pendingUndo;
		pendingUndo = null;
		if (run === null) return;
		run();
		await settle();
		wantRecord = true;
		undone = true;
		discardedAt = null;
	}

	async function watched<T>(op: string, create: boolean, request: () => Promise<T>): Promise<T> {
		requests.push(op);
		if (create && finalServer && !h.server.applied.has(op)) {
			finalServer = false;
			throw new DataError('server', { status: 503 });
		}
		const mode = firstMode.get(op);
		if (mode !== undefined) firstMode.delete(op);
		else if (secondFails.delete(op)) throw new DataError('server', { status: 503 });
		if (mode !== undefined && during === op) {
			during = null;
			await discardNow(op);
			if (scenario.undo) await undoNow();
		}
		if (mode === 'unreached') throw new DataError('network');
		if (mode === 'server5xx') throw new DataError('server', { status: 503 });
		// A change of a ticket the user discarded never goes (C4: its changes went with it).
		if (!create && discardedAt !== null)
			c.push('C4 Änderung eines verworfenen neuen Tickets gesendet');
		if (!create && foreignPending) {
			foreignPending = false;
			if (h.server.records.has(ID_OF_CREATED)) {
				h.server.status.set(ID_OF_CREATED, FOREIGN.status);
				foreignSet = true;
			}
		}
		const answer = await request();
		if (mode === 'lost' || mode === 'directLost') throw new DataError('network');
		if (mode === 'lost5xx' || mode === 'direct5xx') throw new DataError('server', { status: 503 });
		return answer;
	}
	const base = {
		create: h.sendCreate.getMockImplementation(),
		item: h.sendItem.getMockImplementation(),
		send: h.send.getMockImplementation(),
		due: h.sendDue.getMockImplementation()
	};
	if (!base.create || !base.item || !base.send || !base.due) throw new Error('No ways.');
	const { create, item, send, due } = base;
	h.sendCreate.mockImplementation((action, fields, signal) =>
		watched(fields.opId, true, () => create(action, fields, signal))
	);
	h.sendItem.mockImplementation((action, fields, signal) =>
		watched(fields.opId, true, () => item(action, fields, signal))
	);
	h.send.mockImplementation((action, fields, signal) =>
		watched(fields.opId, false, () => send(action, fields, signal))
	);
	h.sendDue.mockImplementation((action, fields, signal) =>
		watched(fields.opId, false, () => due(action, fields, signal))
	);

	async function offline() {
		h.server.health = false;
		await h.connectivity.check();
	}
	async function online() {
		h.server.health = true;
		h.server.reachable = true;
		await h.connectivity.check();
		await settle();
	}
	async function window() {
		await online();
		await offline();
		await settle();
	}
	const present = () => creationOp !== null && h.outbox.actions.some((a) => a.op === creationOp);

	/** A change of the new ticket as the views make it, from what they show. */
	async function change(kind: 'prog' | 'done' | 'due'): Promise<void> {
		if (!wantRecord) return;
		const view: TicketSummary | null = h.outbox.createdTicket(ID_OF_CREATED) ?? known;
		if (view === null) return;
		const shown = h.outbox.apply(view);
		if (kind === 'due') {
			const next = shown.due === D1 ? null : D1;
			await h.outbox.changeDue(shown, next);
			will.due = next;
		} else {
			const status: Status = kind === 'prog' ? 'in_progress' : 'done';
			if (shown.status === status) return;
			await h.outbox.changeStatus(shown, { status });
			will.status = status;
		}
		await settle();
	}

	const direct = isDirect(scenario.send);
	if (direct) await online();
	else await offline();
	const firstSend = scenario.send;
	if (firstSend === 'directLost' || firstSend === 'direct5xx') {
		// The first request of the creation is its first attempt: its answer gets lost, or a proxy
		// answers with a 5xx after the server took it (round 2, A1).
		h.sendCreate.mockImplementationOnce((action, fields, signal) => {
			firstMode.set(fields.opId, firstSend);
			return watched(fields.opId, true, () => create(action, fields, signal));
		});
		h.sendItem.mockImplementationOnce((action, fields, signal) => {
			firstMode.set(fields.opId, firstSend);
			return watched(fields.opId, true, () => item(action, fields, signal));
		});
	}
	const draft = {
		title: CREATED_TITLE,
		description: '',
		status: 'open' as const,
		priority: 'medium' as const,
		due: null,
		project: CREATED_PROJECT,
		tags: []
	};
	const before = new Set(h.outbox.actions.map((action) => action.op));
	try {
		if (isTicket) {
			const created = await h.outbox.createTicket(draft);
			if (!created.kept) known = created.value;
		} else {
			await h.outbox.createItem({
				title: CREATED_TITLE,
				project: CREATED_PROJECT,
				tags: [],
				priority: null
			});
		}
	} catch (error) {
		c.push(`C3 „＋“ scheiterte: ${String(error)}`);
	}
	await settle();
	creationOp = h.outbox.actions.find((action) => !before.has(action.op))?.op ?? requests[0] ?? null;
	if (direct) await offline();

	for (const entry of scenario.changes.filter((change) => change.when === 'before')) {
		await change(entry.kind);
	}
	if (scenario.discard === 'before' && present() && creationOp !== null) {
		await discardNow(creationOp);
		if (scenario.undo) await undoNow();
	}
	if (!direct && scenario.send !== 'offline' && creationOp !== null && present()) {
		firstMode.set(creationOp, scenario.send);
		if (scenario.discard === 'during') during = creationOp;
		await window();
		if (scenario.send === 'lost5xx') {
			secondFails.add(creationOp);
			await window();
			secondFails.delete(creationOp);
		}
		firstMode.delete(creationOp);
		during = null;
	}
	if (scenario.discard === 'after' && present() && creationOp !== null) {
		await discardNow(creationOp);
		if (scenario.undo) await undoNow();
	}
	for (const entry of scenario.changes.filter((change) => change.when === 'after')) {
		await change(entry.kind);
	}
	if (scenario.discard === 'late' && present() && creationOp !== null) {
		await discardNow(creationOp);
		if (scenario.undo) await undoNow();
	}

	// The connection comes back with the answer of the scenario.
	if (scenario.answer === 'refused') {
		h.server.refuseCreate = { field: 'project', code: 'validation_project_archived' };
		h.server.refuseItem = true;
	} else if (scenario.answer === 'server') finalServer = true;
	else if (scenario.answer === 'hidden' && h.server.records.has(ID_OF_CREATED)) {
		h.server.hidden.add(ID_OF_CREATED);
		wantRecord = false;
	}
	// Over 5 minutes at most (round 2, A5): a lookup that does not find a discarded creation is final
	// only 5 minutes after its last request, so the second lookup comes within the drain; it ends once
	// the outbox rests (K-6).
	await online();
	await drain(h, 6);
	finalServer = false;
	const refused = h.outbox.actions.find(
		(action) => action.op === creationOp && action.state === 'refused'
	);
	if (refused !== undefined && scenario.choice === 'without' && isTicket) {
		await h.outbox.createWithout(refused.op, 'project');
		await drain(h, 6);
	} else if (refused !== undefined && scenario.choice === 'discard') {
		await discardNow(refused.op);
		await drain(h, 6);
	}

	// The checks, by the oracle's own bookkeeping.
	const op = creationOp;
	const records = [...h.server.records.entries()].filter(
		([, record]) => record.title === CREATED_TITLE
	);
	const exists = records.length > 0 && !h.server.hidden.has(ID_OF_CREATED);
	const actions = h.outbox.actions;
	const kept = actions.find((action) => action.op === op);
	if (records.length > 1 || h.server.counter > 1) c.push(`C1 ${records.length} Datensätze`);
	if (op !== null && wantRecord && !exists) {
		const title = kept?.title;
		if (kept === undefined || kept.state !== 'refused' || title !== CREATED_TITLE) {
			c.push(`C2 Text nicht sichtbar (${kept?.state ?? 'weg'})`);
		}
	}
	const notices = h.outbox.notices;
	const named = notices.some(
		(notice) =>
			(notice.text.includes('wurde schon angelegt') ||
				notice.text.includes('liegt schon im Eingang')) &&
			notice.link?.id === ID_OF_CREATED
	);
	if (op !== null && !wantRecord && !undone && exists && scenario.answer !== 'hidden' && !named) {
		c.push('C3 verworfen, aber angelegt und kein Hinweis');
	}
	if (named && !exists && scenario.answer !== 'hidden')
		c.push('C3 falscher Hinweis „schon angelegt“');
	if (op !== null && discardedAt !== null && !undone) {
		if (!leftBeforeDiscard && requests.includes(op)) c.push('C4 nie gesendet, doch beim Server');
		if (requests.slice(discardedAt).includes(op)) c.push('C4 verworfen und erneut gesendet');
	}
	const blocked = (action: KeptAction) =>
		action.dependsOn.some((dep) => {
			const other = actions.find((entry) => entry.op === dep);
			return other !== undefined && decides(other);
		});
	const suspended = actions.some(
		(action) => action.op !== op && (decides(action) || blocked(action))
	);
	if (isTicket && wantRecord && exists && !suspended) {
		const status = h.server.status.get(ID_OF_CREATED);
		const dueNow = h.server.due.get(ID_OF_CREATED) ?? null;
		if (!foreignSet && status !== will.status)
			outcome.i1.push(`status: ${status} statt ${will.status}`);
		if (dueNow !== will.due) outcome.i1.push(`due: ${String(dueNow)} statt ${String(will.due)}`);
	}
	if (foreignSet && h.server.status.get(ID_OF_CREATED) !== FOREIGN.status) {
		outcome.i2.push(`status: ${String(h.server.status.get(ID_OF_CREATED))} überschrieben`);
	}
	if (undone && wantRecord && !exists && kept?.state !== 'refused') {
		outcome.i4.push('nach „Rückgängig“ nicht angelegt');
	}
	for (const action of actions) {
		if (decides(action) || blocked(action)) continue;
		outcome.hang.push(
			`${action.kind} ${action.state}${action.discarded === true ? ' verworfen' : ''}`
		);
	}
	outcome.i3.push(...c);
	h.stop();
	return outcome;
}

/** Runs the class "Anlegen"; prints the numbers with BYL_MATRIX_REPORT=1 and returns the failures. */
async function checkCreate(runs: readonly CreateScenario[]): Promise<string[]> {
	const failures: string[] = [];
	const counts = { i1: 0, i2: 0, i3: 0, i4: 0, hang: 0 };
	for (const scenario of runs) {
		const outcome = await runCreate(scenario);
		const all: string[] = [];
		for (const name of CHECKS) {
			if (outcome[name].length > 0) counts[name] += 1;
			all.push(...outcome[name].map((entry) => `${name.toUpperCase()} ${entry}`));
		}
		if (all.length > 0) failures.push(`${describeCreate(scenario)}: ${all.join('; ')}`);
	}
	if (process.env.BYL_MATRIX_REPORT === '1') {
		const broken = CHECKS.map((name) => `${name.toUpperCase()} ${counts[name]}`).join(', ');
		const distinct = new Set(runs.map(describeCreate)).size;
		const lines = [
			`Anlegen: ${runs.length} Abläufe (${distinct} verschieden), verletzt: ${failures.length} (${broken}; C1 bis C4 unter I3)`,
			...failures.slice(0, 40)
		];
		process.stdout.write(`${lines.join('\n')}\n`);
	}
	return failures;
}

/**
 * Runs drawn of the class "Anlegen" (fixed seed). The file took 0.9 s on a developer machine (round 2 of
 * OF-4b, K-6; before, in one file with the other classes, the matrix took 8 s); every matrix file stays
 * under 10 s.
 */
const CREATE_RUNS = 1000;
const SEED = Number(process.env.BYL_MATRIX_SEED ?? 20261021);

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('the scenario matrix of "Verwerfen", class "Anlegen" (OF-4a)', () => {
	// BYL_MATRIX_CREATE_RUNS and BYL_MATRIX_SEED draw other runs, BYL_MATRIX_REPORT=1 prints the numbers.
	it(
		'keeps C1 to C4, I1, I2, I4 without hanging in the class "Anlegen" (OF-4a)',
		{ timeout: 60_000 },
		async () => {
			const count = Number(process.env.BYL_MATRIX_CREATE_RUNS ?? CREATE_RUNS);
			const failures = await checkCreate(createScenarios(count, SEED));
			expect(failures.slice(0, 10)).toEqual([]);
		}
	);
});
