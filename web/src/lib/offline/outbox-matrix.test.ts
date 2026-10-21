// The scenario matrix of "Verwerfen" (OF-3b, ADR-0074 addendum OF-3b and its round 2): small runs on
// one ticket, its due date, the mark of the day of one entry and up to three sub-tasks (two the views
// showed, one never seen). Each change is made without a connection or, in the class "direkt", with
// one; it is sent in a short return of the connection with its answer lost, without reaching the
// server, or with a 5xx, or kept; "Verwerfen" comes before, while or after it is sent, "Rückgängig"
// right after "Verwerfen" or once the take-back was sent, answered, met a conflict or a 503; the value
// may be set anew after "Verwerfen", someone else may change a value in the middle of a chain, the
// clock may pass 48 hours with the decisions "Trotzdem übertragen" and "Verwerfen" for every change of
// the user that waits for one. Then the connection comes back with a success, a change of someone
// else, one answer 404, one refusal or one 503, and everything goes that can. Afterwards hold:
// - I1: every value has the wish of the last change the user kept for it (the value before without
//   one; a change that dropped a waiting one writes nothing of its own, a change taken into another
//   carries only what that one still changes), or someone else set it after the last own change that
//   writes the will; a value a conflict, a refusal or a waiting decision touches (also through the
//   changes waiting behind it) is left out, only that value;
// - I2: no change of the outbox overwrites a value someone else set without a conflict, unless the
//   view showed that value and the user changed it; the limit M1 counts where the value of someone
//   else is the wish of a discarded own change that may have arrived, or where the server took an own
//   request with that very wish without a change; a first attempt with a connection has no value
//   before (OF-2 §2);
// - I3: no change whose request the server took leaves the outbox without a word after any refusal
//   while its value contradicts the will;
// - I4: after "Rückgängig" every value it brought back has the will of before "Verwerfen" (or a
//   visible conflict), and every "Verwerfen" of a change of the user offers "Rückgängig";
// - no hang: with the connection back, only changes that visibly wait for a decision stay (conflict,
//   refusal, a change of the user older than 48 hours) and the ones waiting behind them.
// The oracle is independent of the code it checks: it keeps what the user did and the values of the
// fake server and reads of the outbox only what the dialog shows (state, what an action changes, what
// it waits for) and the flags; every run starts the real outbox, its worker, the storage of the tests
// and `verdictOf` against the fake server of $lib/test/outbox-fake.ts. The base class has every run of
// one change and drawn runs of two and three; the classes of round 2 are drawn, all with fixed seeds.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DayPlanItem } from '$lib/data/day-plan';
import { DataError } from '$lib/data/errors';
import type { CalendarDate } from '$lib/domain/berlin-date';
import { AUTO_SEND_MS, type KeptAction, type OutboxFields } from '$lib/domain/offline';
import type { Status } from '$lib/domain/status';
import type { Ticket, TicketSummary } from '$lib/domain/ticket';
import {
	A,
	ALL_OPS,
	NOW,
	entry,
	harness,
	refusal,
	settle,
	ticket,
	type Harness
} from '$lib/test/outbox-fake';
import type { CheckAnswer } from './outbox.svelte';

const ITEM = 'item00000000001';
/** Sub-tasks of A: the views showed C1 and C2, never C3 (its status before is unknown). */
const C1 = 'tick00000000011';
const C2 = 'tick00000000012';
const C3 = 'tick00000000013';
const D1: CalendarDate = '2026-10-22';
/** Values someone else sets: never one the user picks, so a conflict is a real one. */
const FOREIGN = { status: 'waiting' as Status, due: '2026-11-30' as CalendarDate };
/** A piece of the words of the flag about sub-tasks whose status before is unknown (round 2). */
const BLIND_HINT = 'Status vorher ist unbekannt';

type Kind = 'prog' | 'done' | 'mark' | 'due' | 'plan' | 'kids1' | 'kids2' | 'kidsBlind' | 'kid';
type Send = 'offline' | 'lost' | 'unreached' | 'direct' | 'directLost' | 'server5xx' | 'lost5xx';
type Discard = 'none' | 'before' | 'during' | 'after';
type Undo = 'none' | 'now' | 'sent' | 'answered' | 'conflict' | 'server';
type Answer = 'success' | 'conflict' | 'missing' | 'refused' | 'server';
type Feature = 'status' | 'due' | 'mark' | 'c1' | 'c2' | 'c3';
type OwnFeature = 'status' | 'due' | 'mark';
type Decision = 'send' | 'discard';
type Value = Status | CalendarDate | boolean | null;
type Values = Record<Feature, Value>;
type Cls =
	| 'basis'
	| '48 Stunden'
	| 'Rückgängig'
	| 'neu setzen'
	| '5xx'
	| 'direkt'
	| 'Unteraufgaben'
	| 'fremd in der Kette';

interface Step {
	kind: Kind;
	send: Send;
	discard: Discard;
	undo: Undo;
	/** After "Verwerfen" the user sets the same value anew. */
	again: boolean;
	/** Someone else changes this value after the step. */
	foreign: OwnFeature | null;
}

interface Scenario {
	cls: Cls;
	steps: Step[];
	answer: Answer;
	/** The value someone else changes for `conflict`. */
	foreign: OwnFeature;
	/** The clock passes 48 hours; the decisions for the changes of the user that wait for one. */
	clock: Decision[] | null;
}

const FEATURES: readonly Feature[] = ['status', 'due', 'mark', 'c1', 'c2', 'c3'];
const BASE_KINDS: readonly Kind[] = ['prog', 'done', 'mark', 'due', 'plan'];
const KID_KINDS: readonly Kind[] = ['kids1', 'kids2', 'kidsBlind', 'kid', 'done', 'prog'];
const BASE_ANSWERS: readonly Answer[] = ['success', 'conflict', 'missing'];
const ALL_ANSWERS: readonly Answer[] = ['success', 'conflict', 'missing', 'refused', 'server'];
const CHECKS = ['i1', 'i2', 'i3', 'i4', 'hang'] as const;

function step(way: Partial<Step> & { kind: Kind; send: Send }): Step {
	return { discard: 'none', undo: 'none', again: false, foreign: null, ...way };
}

/** Every way of one change of the base class: kept (discarded before or not), or sent. */
const WAYS: readonly Omit<Step, 'kind'>[] = [
	{ send: 'offline', discard: 'none', undo: 'none', again: false, foreign: null },
	{ send: 'offline', discard: 'before', undo: 'none', again: false, foreign: null },
	{ send: 'offline', discard: 'before', undo: 'now', again: false, foreign: null },
	...(['lost', 'unreached'] as const).flatMap((send) =>
		(
			[
				['none', 'none'],
				['during', 'none'],
				['during', 'now'],
				['after', 'none'],
				['after', 'now']
			] as const
		).map(([discard, undo]) => ({ send, discard, undo, again: false, foreign: null }))
	)
];

function ownFeatureOf(kind: Kind): OwnFeature {
	if (kind === 'mark') return 'mark';
	if (kind === 'due') return 'due';
	return 'status';
}

/** A small random source with a fixed seed (mulberry32), so the drawn runs are always the same. */
function seeded(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function pick<T>(random: () => number, list: readonly T[]): T {
	return list[Math.floor(random() * list.length)] as T;
}

function times<T>(count: number, make: () => T): T[] {
	return Array.from({ length: count }, make);
}

/** All one-change runs of the base class, and `count` drawn runs of two and of three changes each. */
function baseScenarios(count: number, seed: number): Scenario[] {
	const all: Scenario[] = [];
	for (const kind of BASE_KINDS) {
		for (const way of WAYS) {
			for (const answer of BASE_ANSWERS) {
				const steps = [{ kind, ...way }];
				all.push({ cls: 'basis', steps, answer, foreign: ownFeatureOf(kind), clock: null });
			}
		}
	}
	const random = seeded(seed);
	for (const length of [2, 3]) {
		for (let index = 0; index < count; index++) {
			const steps = times(length, () => ({
				kind: pick(random, BASE_KINDS),
				...pick(random, WAYS)
			}));
			const answer = pick(random, BASE_ANSWERS);
			const foreign = ownFeatureOf(pick(random, steps).kind);
			all.push({ cls: 'basis', steps, answer, foreign, clock: null });
		}
	}
	return all;
}

/** A way of one change from the lists; "Rückgängig" only after "Verwerfen". */
function wayOf(
	random: () => number,
	sends: readonly Send[],
	discards: readonly Discard[],
	undos: readonly Undo[]
): Omit<Step, 'kind'> {
	const send = pick(random, sends);
	let discard = pick(random, discards);
	if (send === 'offline' && (discard === 'during' || discard === 'after')) discard = 'before';
	if ((send === 'direct' || send === 'directLost') && discard !== 'none') discard = 'after';
	const undo = discard === 'none' ? 'none' : pick(random, undos);
	return { send, discard, undo, again: false, foreign: null };
}

function baseStep(random: () => number): Step {
	const way = wayOf(
		random,
		['offline', 'lost', 'unreached'],
		['none', 'before', 'during', 'after'],
		['none', 'now']
	);
	return { kind: pick(random, BASE_KINDS), ...way };
}

/** The classes of round 2: how one drawn run of each looks. */
const CLASSES: Readonly<Record<Exclude<Cls, 'basis'>, (random: () => number) => Step[]>> = {
	'48 Stunden': (random) =>
		times(1 + Math.floor(random() * 3), () => ({
			kind: pick(random, BASE_KINDS),
			...wayOf(
				random,
				['offline', 'lost', 'unreached'],
				['none', 'before', 'after'],
				['none', 'now']
			)
		})),
	Rückgängig: (random) => [
		step({
			kind: pick(random, BASE_KINDS),
			send: pick(random, ['lost', 'unreached'] as const),
			discard: 'after',
			undo: pick(random, ['now', 'sent', 'answered', 'conflict', 'server'] as const)
		}),
		...(random() < 0.5 ? [baseStep(random)] : [])
	],
	'neu setzen': (random) => [
		{
			kind: pick(random, BASE_KINDS),
			...wayOf(random, ['offline', 'lost', 'unreached'], ['before', 'after'], ['none']),
			again: true
		},
		...(random() < 0.5 ? [baseStep(random)] : [])
	],
	'5xx': (random) =>
		times(1 + Math.floor(random() * 2), () => ({
			kind: pick(random, BASE_KINDS),
			...wayOf(random, ['server5xx', 'lost5xx', 'lost'], ['none', 'after'], ['none', 'now'])
		})),
	direkt: (random) =>
		times(1 + Math.floor(random() * 2), () => ({
			kind: pick(random, BASE_KINDS),
			...wayOf(
				random,
				['direct', 'directLost', 'offline', 'lost'],
				['none', 'before', 'after'],
				['none', 'now']
			)
		})),
	Unteraufgaben: (random) =>
		times(1 + Math.floor(random() * 3), () => {
			const kind = pick(random, KID_KINDS);
			// A completion with its sub-tasks is sent each time: a later change of the status would
			// otherwise be taken into it and drop the sub-tasks (OF-2, the last wish counts).
			const sends: readonly Send[] = kind.startsWith('kids')
				? ['lost', 'unreached']
				: ['offline', 'lost', 'unreached'];
			const way = wayOf(random, sends, ['none', 'before', 'during', 'after'], ['none', 'now']);
			return { kind, ...way };
		}),
	'fremd in der Kette': (random) => {
		const steps = times(2 + Math.floor(random() * 2), () => baseStep(random));
		const at = Math.floor(random() * (steps.length - 1));
		const foreign = pick(random, ['status', 'due', 'mark'] as const);
		return steps.map((entry, index) => (index === at ? { ...entry, foreign } : entry));
	}
};

/** `count` drawn runs of every class of round 2. */
function classScenarios(count: number, seed: number): Scenario[] {
	const random = seeded(seed + 1);
	const all: Scenario[] = [];
	type Make = (random: () => number) => Step[];
	for (const [cls, make] of Object.entries(CLASSES) as [Exclude<Cls, 'basis'>, Make][]) {
		for (let index = 0; index < count; index++) {
			const steps = make(random);
			const answer = pick(random, ALL_ANSWERS);
			const foreign = ownFeatureOf(pick(random, steps).kind);
			const clock =
				cls === '48 Stunden' ? times(3, () => pick(random, ['send', 'discard'] as const)) : null;
			all.push({ cls, steps, answer, foreign, clock });
		}
	}
	return all;
}

interface Intent {
	feature: Feature;
	value: Value;
	/** The action the wish lives in; null when the change dropped one (back to the value before). */
	op: string | null;
	discarded: boolean;
	/** "Rückgängig" brought it back. */
	undone: boolean;
	/** A later change was taken into its action, which no longer changes this value, or dropped it. */
	superseded: boolean;
	/** It dropped a waiting action (back to the value before): no write of its own. */
	cancel: boolean;
	/** When the user made it, among the changes of someone else. */
	at: number;
}

interface Outcome {
	i1: string[];
	i2: string[];
	i3: string[];
	i4: string[];
	hang: string[];
}

function featureOfTicket(id: string): Feature | null {
	if (id === A) return 'status';
	if (id === C1) return 'c1';
	if (id === C2) return 'c2';
	if (id === C3) return 'c3';
	return null;
}

/** What a stored action changes, as the dialog names it: the ticket, the entry, the sub-tasks. */
function touched(action: KeptAction): Feature[] {
	const found = new Set<Feature>();
	const add = (feature: Feature | null) => {
		if (feature !== null) found.add(feature);
	};
	if (action.kind === 'ticket.update') {
		add('due' in action.payload ? 'due' : featureOfTicket(action.target));
	} else {
		add(featureOfTicket(action.ticket));
		add('mark');
	}
	const children = (action as { children?: readonly string[] }).children ?? [];
	for (const child of children) add(featureOfTicket(child));
	return [...found];
}

/** The value an action is for: the status or due date of its ticket, or the mark of the day. */
function mainFeatureOf(action: KeptAction): Feature | null {
	if (action.kind === 'ticket.update') {
		return 'due' in action.payload ? 'due' : featureOfTicket(action.target);
	}
	return action.payload.action === 'today' ? 'mark' : featureOfTicket(action.ticket);
}

/** The value of A a take-back is for, for a change of someone else just before it is sent. */
function mainOf(action: KeptAction): OwnFeature {
	const main = mainFeatureOf(action);
	return main === 'due' || main === 'mark' ? main : 'status';
}

function serverValues(h: Harness): Values {
	return {
		status: h.server.status.get(A) ?? 'open',
		due: h.server.due.get(A) ?? null,
		mark: h.server.items.get(ITEM)?.doneToday ?? false,
		c1: h.server.status.get(C1) ?? 'open',
		c2: h.server.status.get(C2) ?? 'open',
		c3: h.server.status.get(C3) ?? 'open'
	};
}

/** Runs one scenario against the real outbox and the fake server and checks I1 to I4 and no hang. */
async function run(scenario: Scenario): Promise<Outcome> {
	vi.setSystemTime(NOW);
	const h = harness({ support: ALL_OPS });
	h.server.items.set(ITEM, { ticket: A, doneToday: false });
	await settle();
	const initial = serverValues(h);
	const outcome: Outcome = { i1: [], i2: [], i3: [], i4: [], hang: [] };
	let tick = 0;

	// What the client knows of the server: the tickets the outbox shows, the entry of its answers. The
	// views showed the sub-tasks C1 and C2, so their status before is known; C3 never.
	const known = new Map<string, Ticket>([A, C1, C2, C3].map((id) => [id, ticket(id)]));
	let knownItem: DayPlanItem = entry(ITEM, A, false);
	h.sink.upsert.mockImplementation((shown: TicketSummary) => {
		const before = known.get(shown.id);
		if (before !== undefined) known.set(shown.id, { ...before, ...shown });
	});
	h.outbox.watchChecks((answer: CheckAnswer | null) => {
		const item = h.server.items.get(ITEM);
		knownItem =
			answer === null ? entry(ITEM, A, item?.doneToday ?? false) : { ...answer.item, ticket: null };
	});
	h.outbox.apply(ticket(C1));
	h.outbox.apply(ticket(C2));
	const knownTicket = (id: string) => known.get(id) ?? ticket(id);

	const intents: Intent[] = [];
	const firstMode = new Map<string, Send>();
	const secondFails = new Set<string>();
	let during: { op: string; undo: Undo } | null = null;
	let pendingUndo: (() => Promise<void>) | null = null;
	let takeBackHook: Undo | null = null;
	let finalMode: Answer | null = null;
	/** Identifiers with a request that got no answer: from the view of the client they may have arrived. */
	const maybeArrived = new Set<string>();
	/** Identifiers refused by the server, with the values their action changes. */
	const refused = new Map<string, Feature[]>();
	/** Values someone else set that no write changed since, and when someone else set each last. */
	const foreignActive = new Map<Feature, Value>();
	const foreignAt = new Map<Feature, { value: Value; at: number }>();
	let blindHint = false;

	function changeByOthers(feature: OwnFeature): void {
		let value: Value;
		if (feature === 'due') {
			value = FOREIGN.due;
			h.server.due.set(A, FOREIGN.due);
		} else if (feature === 'mark') {
			const item = h.server.items.get(ITEM) ?? { ticket: A, doneToday: false };
			value = !item.doneToday;
			h.server.items.set(ITEM, { ...item, doneToday: value });
		} else {
			value = FOREIGN.status;
			h.server.status.set(A, FOREIGN.status);
		}
		foreignActive.set(feature, value);
		foreignAt.set(feature, { value, at: tick++ });
	}

	/** M1: someone else set the very wish of a discarded own change that may have arrived. */
	const isLimitM1 = (feature: Feature, value: Value) =>
		intents.some(
			(intent) =>
				intent.feature === feature &&
				intent.value === value &&
				intent.discarded &&
				intent.op !== null &&
				maybeArrived.has(intent.op)
		);

	/**
	 * The writes of a request (I2). A first attempt with a connection names no value before (OF-2 §2).
	 * The limit M1 counts where the value of someone else is the wish of a discarded own change that
	 * may have arrived; and, the same limit of the server, where the server took an own request without
	 * a change because someone else had set its very wish: it cannot tell this from the request
	 * arriving (it takes the wish without a conflict), so from then on the value counts as the own one.
	 */
	function noteWrites(action: KeptAction, before: Values, fields: OutboxFields, ok: boolean): void {
		const after = serverValues(h);
		for (const feature of FEATURES) {
			if (before[feature] === after[feature]) continue;
			const limit = fields.expected === undefined || isLimitM1(feature, before[feature]);
			if (foreignActive.has(feature) && !limit) {
				outcome.i2.push(`${feature}: ${String(before[feature])} → ${String(after[feature])}`);
			}
			foreignActive.delete(feature);
		}
		const main = mainFeatureOf(action);
		if (ok && main !== null && before[main] === after[main]) foreignActive.delete(main);
	}

	// The requests: the first one of an identifier in its step may be lost, not reach the server or
	// get a 503, "Verwerfen" may come while it is under way, the first request of a take-back may meet
	// a change of someone else, a 503 or a lost answer; the first one after the return may be refused.
	async function watched<T>(
		action: KeptAction,
		fields: OutboxFields,
		request: () => Promise<T>
	): Promise<T> {
		const op = fields.opId;
		if (finalMode === 'missing') {
			finalMode = null;
			refused.set(op, touched(action));
			throw new DataError('not_found', { status: 404 });
		}
		if (finalMode === 'server') {
			finalMode = null;
			throw new DataError('server', { status: 503 });
		}
		if (finalMode === 'refused' && !h.server.applied.has(op)) {
			// After the lookup of the identifier: a request the server took is answered like the first.
			finalMode = null;
			refused.set(op, touched(action));
			throw refusal('status', 'validation_invalid');
		}
		let lose = false;
		if (takeBackHook !== null && action.undoes !== undefined) {
			const hook = takeBackHook;
			takeBackHook = null;
			if (hook === 'server') throw new DataError('server', { status: 503 });
			if (hook === 'conflict') changeByOthers(mainOf(action));
			lose = hook === 'sent';
		}
		const mode = firstMode.get(op);
		if (mode !== undefined) firstMode.delete(op);
		else if (secondFails.delete(op)) throw new DataError('server', { status: 503 });
		if (mode !== undefined && during?.op === op) {
			const note = during;
			during = null;
			const undo = await discardWithUndo(op);
			pendingUndo = note.undo === 'none' ? null : await undoOrDead(undo);
		}
		if (mode === 'unreached') {
			maybeArrived.add(op);
			throw new DataError('network');
		}
		if (mode === 'server5xx') throw new DataError('server', { status: 503 });
		const before = serverValues(h);
		let answer: T;
		try {
			answer = await request();
		} catch (error) {
			// The fake server loses an answer only after it took the request.
			const lost = error instanceof DataError && error.kind === 'network';
			if (lost) maybeArrived.add(op);
			noteWrites(action, before, fields, lost);
			throw error;
		}
		noteWrites(action, before, fields, true);
		if (lose || mode === 'lost' || mode === 'lost5xx') {
			maybeArrived.add(op);
			throw new DataError('network');
		}
		return answer;
	}
	const send = h.send.getMockImplementation();
	const sendDue = h.sendDue.getMockImplementation();
	const sendDayPlan = h.sendDayPlan.getMockImplementation();
	if (send === undefined || sendDue === undefined || sendDayPlan === undefined) {
		throw new Error('The fake server has no ways.');
	}
	h.send.mockImplementation((action, fields, signal) =>
		watched(action, fields, () => send(action, fields, signal))
	);
	h.sendDue.mockImplementation((action, fields, signal) =>
		watched(action, fields, () => sendDue(action, fields, signal))
	);
	h.sendDayPlan.mockImplementation((action, fields, signal) =>
		watched(action, fields, () => sendDayPlan(action, fields, signal))
	);

	/** "Rückgängig" when it was offered, else a dead button (I4). */
	async function undoOrDead(
		undo: (() => Promise<void>) | null
	): Promise<(() => Promise<void>) | null> {
		if (undo === null) outcome.i4.push('„Verwerfen“ ohne „Rückgängig“');
		return undo;
	}

	/** "Verwerfen" of an action; resolves to the "Rückgängig" of its flag, if it offered one. */
	async function discardWithUndo(op: string): Promise<(() => Promise<void>) | null> {
		const count = h.flags.show.mock.calls.length;
		await h.outbox.discard(op);
		for (const intent of intents) if (intent.op === op) intent.discarded = true;
		const flags = h.flags.show.mock.calls.slice(count).map((call) => call[0]);
		if (flags.some((flag) => flag.description?.includes(BLIND_HINT) === true)) blindHint = true;
		const run = flags.find((flag) => flag.action?.label === 'Rückgängig')?.action?.run;
		if (run === undefined) return null;
		return async () => {
			const before = new Set(h.outbox.actions.map((action) => action.op));
			run();
			await settle();
			for (const intent of intents) {
				if (intent.op !== op) continue;
				intent.discarded = false;
				intent.undone = true;
			}
			// The wish may come back as a new change of the user: it lives there from now on.
			for (const action of h.outbox.actions) {
				if (before.has(action.op) || action.undoes !== undefined) continue;
				const features = touched(action);
				for (const intent of intents) {
					if (intent.op === op && features.includes(intent.feature)) intent.op = action.op;
				}
			}
		};
	}

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

	/** A short return of the connection. */
	async function window() {
		await online();
		await offline();
		await settle();
	}

	const userActions = () =>
		new Map(
			h.outbox.actions
				.filter((action) => action.undoes === undefined)
				.map((action) => [action.op, JSON.stringify(action)])
		);

	type Made = { feature: Feature; value: Value }[];

	/** One change as the views make it, from what they show. */
	async function perform(kind: Kind): Promise<Made | null> {
		const shown = h.outbox.apply(knownTicket(A));
		const row = h.outbox.checkRow(knownItem, knownTicket(A));
		const plan = { item: knownItem, ticket: knownTicket(A) };
		if (kind === 'prog' || kind === 'done') {
			const status: Status = kind === 'prog' ? 'in_progress' : 'done';
			if (shown.status === status) return null;
			await h.outbox.changeStatus(shown, { status });
			return [{ feature: 'status', value: status }];
		}
		if (kind === 'kids1' || kind === 'kids2' || kind === 'kidsBlind') {
			if (shown.status === 'done') return null;
			const children = kind === 'kids1' ? [C1] : kind === 'kids2' ? [C1, C2] : [C1, C3];
			const request = {
				status: 'done' as const,
				completion: 'complete_children' as const,
				children
			};
			await h.outbox.changeStatus(shown, request);
			const along = children.map((id) => ({
				feature: featureOfTicket(id) as Feature,
				value: 'done' as Value
			}));
			return [{ feature: 'status', value: 'done' }, ...along];
		}
		if (kind === 'kid') {
			const child = h.outbox.apply(knownTicket(C1));
			const status: Status = child.status === 'in_progress' ? 'open' : 'in_progress';
			await h.outbox.changeStatus(child, { status });
			return [{ feature: 'c1', value: status }];
		}
		if (kind === 'due') {
			const due = shown.due === D1 ? null : D1;
			await h.outbox.changeDue(shown, due);
			return [{ feature: 'due', value: due }];
		}
		if (kind === 'mark') {
			// "Nur für heute abhaken" stands only at an entry that is not done (DayPlanList).
			if (row.doneToday) {
				await h.outbox.changeCheck(plan, { kind: 'dayplan.uncheck', action: 'today' });
			} else if (row.ticket?.status === 'done') {
				return null;
			} else {
				await h.outbox.changeCheck(plan, { kind: 'dayplan.check', mode: 'today' });
			}
			return [{ feature: 'mark', value: !row.doneToday }];
		}
		const done = row.ticket?.status === 'done';
		if (done) {
			await h.outbox.changeCheck(plan, {
				kind: 'dayplan.uncheck',
				action: 'complete',
				status: 'open'
			});
		} else {
			await h.outbox.changeCheck(plan, { kind: 'dayplan.check', mode: 'check' });
		}
		return [{ feature: 'status', value: done ? 'open' : 'done' }];
	}

	/** What the views show of a value, the waiting changes laid over it. */
	function shownValue(feature: Feature): Value {
		const main = h.outbox.apply(knownTicket(A));
		if (feature === 'due') return main.due;
		if (feature === 'mark') return h.outbox.checkRow(knownItem, knownTicket(A)).doneToday;
		if (feature === 'status') return main.status;
		const id = feature === 'c1' ? C1 : feature === 'c2' ? C2 : C3;
		return h.outbox.apply(knownTicket(id)).status;
	}

	/** Makes a change and notes its wishes with the action they live in. */
	async function change(kind: Kind): Promise<string | null | undefined> {
		const before = userActions();
		const seen = new Map(FEATURES.map((feature) => [feature, shownValue(feature)]));
		const made = await perform(kind);
		await settle();
		if (made === null) return undefined;
		// A value of someone else the view showed: the user changed it knowingly.
		for (const wish of made) {
			const foreign = foreignActive.get(wish.feature);
			if (foreign !== undefined && seen.get(wish.feature) === foreign) {
				foreignActive.delete(wish.feature);
			}
		}
		const after = userActions();
		const created = [...after.keys()].find((op) => !before.has(op));
		const merged = [...after.keys()].find(
			(op) => before.has(op) && before.get(op) !== after.get(op)
		);
		const dropped = [...before.keys()].find((op) => !after.has(op));
		const op = created ?? merged ?? null;
		if (created === undefined && merged !== undefined) {
			// Taken into a waiting action: it carries only what that action still changes.
			const action = h.outbox.actions.find((entry) => entry.op === merged);
			const still = action === undefined ? [] : touched(action);
			for (const intent of intents) {
				if (intent.op === merged && !still.includes(intent.feature)) intent.superseded = true;
			}
		}
		// Without a connection only a change of the user drops an action of the user.
		const cancel = op === null && dropped !== undefined && !h.server.health;
		if (cancel) for (const intent of intents) if (intent.op === dropped) intent.superseded = true;
		for (const wish of made) {
			const fresh = { op, discarded: false, undone: false, superseded: false, cancel, at: tick++ };
			intents.push({ ...wish, ...fresh });
		}
		return op;
	}

	/** "Rückgängig" at its point: right away, or once the take-back was sent, answered, and so on. */
	async function undoAt(timing: Undo, undo: (() => Promise<void>) | null): Promise<void> {
		if (timing === 'none') return;
		const run = await undoOrDead(undo);
		if (run === null) return;
		if (timing !== 'now') {
			takeBackHook = timing;
			await window();
			takeBackHook = null;
		}
		await run();
	}

	await offline();
	for (const entry of scenario.steps) {
		const direct = entry.send === 'direct' || entry.send === 'directLost';
		if (direct) {
			await online();
			if (entry.send === 'directLost') h.server.lose = 1;
		}
		const op = await change(entry.kind);
		h.server.lose = 0;
		const present = () => h.outbox.actions.some((action) => action.op === op);
		if (direct) {
			await offline();
			if (!present()) {
				// The answer came: the view shows the ticket and the entry as the server has them.
				known.set(A, { ...knownTicket(A), ...serverTicket(h, A) });
				known.set(C1, { ...knownTicket(C1), ...serverTicket(h, C1) });
				knownItem = serverEntry(h);
			}
		}
		if (typeof op === 'string') {
			if (entry.discard === 'before' && present()) {
				const undo = await discardWithUndo(op);
				await settle();
				await undoAt(entry.undo, undo);
			} else if (!direct && entry.send !== 'offline') {
				firstMode.set(op, entry.send);
				if (entry.discard === 'during') during = { op, undo: entry.undo };
				await window();
				if (entry.send === 'lost5xx') {
					secondFails.add(op);
					await window();
					secondFails.delete(op);
				}
				firstMode.delete(op);
				during = null;
			}
			if (entry.discard === 'after' && present()) {
				const undo = await discardWithUndo(op);
				await settle();
				await undoAt(entry.undo, undo);
			} else if (pendingUndo !== null) {
				const undo: () => Promise<void> = pendingUndo;
				pendingUndo = null;
				await undo();
			}
			if (entry.again) await change(entry.kind);
		}
		await settle();
		if (entry.foreign !== null) changeByOthers(entry.foreign);
	}

	if (scenario.clock !== null) vi.setSystemTime(NOW + AUTO_SEND_MS + 60_000);
	if (scenario.answer === 'conflict') changeByOthers(scenario.foreign);
	else if (scenario.answer !== 'success') finalMode = scenario.answer;
	const drain = async () => {
		for (let round = 0; round < 4; round++) await vi.advanceTimersByTimeAsync(61_000);
	};
	await online();
	await drain();
	if (scenario.clock !== null) {
		let index = 0;
		for (const action of [...h.outbox.actions]) {
			if (action.state !== 'expired' || action.undoes !== undefined) continue;
			const decision = scenario.clock[index++ % scenario.clock.length];
			if (decision === 'send') await h.outbox.sendAnyway(action.op);
			else await discardWithUndo(action.op);
		}
		await drain();
	}
	finalMode = null;

	// The checks on the values of the server and on what the dialog shows.
	const server = serverValues(h);
	const actions = h.outbox.actions;
	const byOp = new Map(actions.map((action) => [action.op, action]));
	const decides = (action: KeptAction) =>
		action.state === 'conflict' || action.state === 'refused' || action.state === 'expired';
	const blocked = (action: KeptAction, depth = 0): boolean =>
		depth < 12 &&
		action.dependsOn.some((op) => {
			const before = byOp.get(op);
			return before !== undefined && (decides(before) || blocked(before, depth + 1));
		});
	const suspended = new Set<Feature>();
	for (const action of actions) {
		if (decides(action) || blocked(action))
			for (const feature of touched(action)) suspended.add(feature);
	}
	if (blindHint) suspended.add('c3');
	/** The wishes the user keeps for a value, in their order. */
	const keptOf = (feature: Feature): Intent[] =>
		intents.filter(
			(intent) => intent.feature === feature && !intent.discarded && !intent.superseded
		);
	const willOf = (feature: Feature): Value => keptOf(feature).at(-1)?.value ?? initial[feature];
	// The value of the server holds the will, or someone else set it after the last own change that
	// writes the will (after the start without one), or a decision touching it is to be seen.
	const holds = (feature: Feature): boolean => {
		if (suspended.has(feature) || server[feature] === willOf(feature)) return true;
		const foreign = foreignAt.get(feature);
		const source =
			keptOf(feature)
				.filter((intent) => !intent.cancel)
				.at(-1)?.at ?? -1;
		return foreign !== undefined && foreign.at > source && server[feature] === foreign.value;
	};
	const text = (feature: Feature) =>
		`${feature}: Server ${String(server[feature])}, gewollt ${String(willOf(feature))}`;
	for (const feature of FEATURES) if (!holds(feature)) outcome.i1.push(text(feature));
	for (const [op, features] of refused) {
		if (byOp.has(op) || !h.server.applied.has(op)) continue;
		for (const feature of features) if (!holds(feature)) outcome.i3.push(`${op} ${text(feature)}`);
	}
	const undone = new Set(intents.filter((intent) => intent.undone).map((intent) => intent.feature));
	for (const feature of undone) if (!holds(feature)) outcome.i4.push(text(feature));
	for (const action of actions) {
		if (action.state === 'conflict' || action.state === 'refused') continue;
		if (action.state === 'expired' && action.undoes === undefined) continue;
		if (action.state !== 'expired' && blocked(action)) continue;
		const what = action.undoes === undefined ? 'Änderung' : 'Rücknahme';
		outcome.hang.push(`${what} ${action.state}${action.discarded === true ? ' verworfen' : ''}`);
	}
	h.stop();
	return outcome;
}

/** The ticket as the server has it now, the way an answer brings it. */
function serverTicket(h: Harness, id: string): Partial<Ticket> {
	return { status: h.server.status.get(id) ?? 'open', due: h.server.due.get(id) ?? null };
}

/** The entry of the day plan as the server has it now. */
function serverEntry(h: Harness): DayPlanItem {
	return entry(ITEM, A, h.server.items.get(ITEM)?.doneToday ?? false);
}

function describeScenario(scenario: Scenario): string {
	const steps = scenario.steps
		.map((entry) => {
			const undo = entry.undo === 'none' ? '' : `+undo:${entry.undo}`;
			const again = entry.again ? '+neu' : '';
			const foreign = entry.foreign === null ? '' : `+fremd:${entry.foreign}`;
			return `${entry.kind}/${entry.send}/${entry.discard}${undo}${again}${foreign}`;
		})
		.join(' → ');
	const foreign = scenario.answer === 'conflict' ? `(${scenario.foreign})` : '';
	const clock = scenario.clock === null ? '' : ` [48 h: ${scenario.clock.join(',')}]`;
	return `${scenario.cls}: ${steps} ⇒ ${scenario.answer}${foreign}${clock}`;
}

/** How many of the possible runs of each length the drawn ones of the base class cover. */
function baseCoverage(runs: readonly Scenario[]): string {
	return [1, 2, 3]
		.map((length) => {
			const distinct = new Set(
				runs.filter((entry) => entry.steps.length === length).map(describeScenario)
			);
			const possible = (BASE_KINDS.length * WAYS.length) ** length * BASE_ANSWERS.length;
			return `${length}: ${distinct.size} von ${possible}`;
		})
		.join(', ');
}

/** Runs and distinct runs per class. */
function classCoverage(runs: readonly Scenario[]): string {
	const classes = [...new Set(runs.map((entry) => entry.cls))];
	return classes
		.map((cls) => {
			const own = runs.filter((entry) => entry.cls === cls);
			return `${cls} ${own.length} (${new Set(own.map(describeScenario)).size} verschieden)`;
		})
		.join(', ');
}

/** Runs every scenario; prints the numbers with BYL_MATRIX_REPORT=1 and returns the failures. */
async function check(runs: readonly Scenario[], coverage: string): Promise<string[]> {
	const failures: string[] = [];
	const counts = { i1: 0, i2: 0, i3: 0, i4: 0, hang: 0 };
	for (const scenario of runs) {
		const outcome = await run(scenario);
		const all: string[] = [];
		for (const name of CHECKS) {
			if (outcome[name].length > 0) counts[name] += 1;
			all.push(...outcome[name].map((entry) => `${name.toUpperCase()} ${entry}`));
		}
		if (all.length > 0) failures.push(`${describeScenario(scenario)}: ${all.join('; ')}`);
	}
	if (process.env.BYL_MATRIX_REPORT === '1') {
		const broken = CHECKS.map((name) => `${name.toUpperCase()} ${counts[name]}`).join(', ');
		const lines = [
			`Matrix: ${runs.length} Abläufe, verletzt: ${failures.length} (${broken})`,
			`Abdeckung: ${coverage}`,
			...failures.slice(0, 40)
		];
		process.stdout.write(`${lines.join('\n')}\n`);
	}
	return failures;
}

/** Runs per length drawn in the base class in addition to all one-change runs (fixed seed). */
const DRAWN = 1000;
/** Runs drawn per class of round 2 (fixed seed); together the matrix stays under 15 s. */
const CLASS_RUNS = 250;
const SEED = Number(process.env.BYL_MATRIX_SEED ?? 20261021);

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('the scenario matrix of "Verwerfen" (OF-3b)', () => {
	// BYL_MATRIX_RUNS, BYL_MATRIX_CLASS_RUNS and BYL_MATRIX_SEED draw other runs, BYL_MATRIX_REPORT=1
	// prints the numbers.
	it('keeps I1 to I4 without hanging in every run', { timeout: 60_000 }, async () => {
		const runs = baseScenarios(Number(process.env.BYL_MATRIX_RUNS ?? DRAWN), SEED);
		const failures = await check(runs, baseCoverage(runs));
		expect(failures.slice(0, 10)).toEqual([]);
	});

	it('keeps I1 to I4 without hanging in the classes of round 2', { timeout: 60_000 }, async () => {
		const count = Number(process.env.BYL_MATRIX_CLASS_RUNS ?? CLASS_RUNS);
		const runs = classScenarios(count, SEED);
		const failures = await check(runs, classCoverage(runs));
		expect(failures.slice(0, 10)).toEqual([]);
	});
});
