// The scenario matrix of "Verwerfen" (OF-3b, ADR-0074 addendum OF-3b and its round 2): small runs on
// one ticket, its due date, the mark of the day of one entry and up to three sub-tasks (two the views
// showed, one never seen and in progress on the server). Each change is made without a connection or,
// in the class "direkt", with one; it is sent in a short return of the connection with its answer
// lost, without reaching the server, or with a 5xx, or kept; "Verwerfen" comes before, while or after
// it is sent, or for an earlier change after the later ones; "Rückgängig" right after "Verwerfen" or
// once the take-back was sent, answered, met a conflict or a 503; the value may be set anew after
// "Verwerfen", someone else may change a value in the middle of a chain, the clock may pass 48 hours
// with the decisions "Trotzdem übertragen" and "Verwerfen" for every change of the user that waits
// for one. Then the connection comes back with a success, a change of someone else, one answer 404,
// one refusal or one 503, and everything goes that can. Afterwards hold:
// - I1: every value has the wish of the last change the user kept for it (the value before without
//   one; a change that dropped a waiting one writes nothing of its own, a change taken into another
//   carries only what that one still changes), or someone else set it after the last own change that
//   writes the will, or, under the limit M1 before the chain and without a change the user keeps, it
//   has the value the views showed before the chain; a value a conflict, a refusal or a waiting
//   decision (also through the changes waiting behind it) touches is left out, only that value, and
//   so is a sub-task a notice names as not done while the user wants it done in the end (OF-3c);
// - I2: no change of the outbox overwrites a value someone else set without a conflict, unless the
//   view showed that value and the user changed it; the limit M1 counts where the value of someone
//   else is the wish of a discarded own change that may have arrived, or where the server took an own
//   request with that very wish without a change the first time (a repetition of the identifier takes
//   nothing over, round 3); only the first request of a change of the class "direkt" has no value
//   before (OF-2 §2), and the mark of the day of a done ticket is no value of its own (OF-3b §9);
// - I3: no change whose request the server took leaves the outbox without a word after any refusal
//   while its value contradicts the will; no notice names a sub-task as not done that is done or that
//   the user no longer wants done in the end (OF-3c, R3-4);
// - I4: after "Rückgängig" every value it brought back has the will of before "Verwerfen" (or a
//   visible conflict), and every "Verwerfen" of a change of the user offers "Rückgängig";
// - no hang: with the connection back, only changes that visibly wait for a decision stay (conflict,
//   refusal, a change of the user older than 48 hours) and the ones waiting behind them.
// The oracle is independent of the code it checks: it keeps what the user did and the values of the
// fake server and reads of the outbox only what the dialog shows (state, what an action changes, what
// it waits for), the flags and the notices; every run starts the real outbox, its worker, the storage
// of the tests and `verdictOf` against the fake server of $lib/test/outbox-fake.ts. The base class has
// every run of one change and drawn runs of two and three; the classes of round 2 are drawn, all with
// fixed seeds. Since round 3 the fake server completes sub-tasks like the hook (only blocking ones, on
// the step to "done"); the class "Unteraufgaben" keeps completions as well, may have A done before the
// chain or completed by someone else in it, and a sub-task the server did not complete counts for I1
// only where no notice names it (since OF-3c only while the user wants it done in the end). Since round
// 2 of OF-3c the class also has runs around a notice that stands: a later change of the sub-task
// without an answer, discarded, whose take-back arrives, and a later completion with its sub-tasks at
// its first attempt on a stale state (`noticeScenarios`); since round 3 someone else sets A "Erledigt"
// or "Wartet" there, drawn, so the first attempt also takes the notice along.
// Since round 2 of OF-4b (K-6) the class "Anlegen" of OF-4a is in outbox-matrix-create.test.ts and the
// class "Kommentare" of OF-4b in outbox-matrix-comments.test.ts; the helpers the three files share are
// in $lib/test/outbox-matrix.ts, and the drain ends once the outbox rests.

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
import {
	CHECKS,
	D1,
	FOREIGN,
	drain,
	pick,
	seeded,
	times,
	type Outcome
} from '$lib/test/outbox-matrix';
import type { CheckAnswer } from './outbox.svelte';

const ITEM = 'item00000000001';
/** Sub-tasks of A: the views showed C1 and C2, never C3 (its status before is unknown). */
const C1 = 'tick00000000011';
const C2 = 'tick00000000012';
const C3 = 'tick00000000013';
/** A piece of the words of the flag about sub-tasks whose status before is unknown (round 2). */
const BLIND_HINT = 'Status vorher ist unbekannt';

type Kind = 'prog' | 'done' | 'mark' | 'due' | 'plan' | 'kids1' | 'kids2' | 'kidsBlind' | 'kid';
/** `window`: sent in a short return of the connection and answered (OF-3c round 2). */
type Send =
	'offline' | 'lost' | 'unreached' | 'direct' | 'directLost' | 'server5xx' | 'lost5xx' | 'window';
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
	/** "Verwerfen" of the change of this step after all steps, while it is still kept. */
	lateDiscard: number | null;
	/** The sub-tasks of A with "blocks_parent" on the server: the hook completes only these (round 3). */
	blocking: readonly string[];
	/** Someone else completed A before the chain ("Trotzdem erledigen"); the views still show it open. */
	doneBefore: boolean;
	/** The status someone else sets: "Wartet", in the class "Unteraufgaben" also "Erledigt" (round 3). */
	foreignStatus: Status;
}

/** The server of every class but "Unteraufgaben": no blocking sub-task, nothing done before. */
const PLAIN = { blocking: [], doneBefore: false, foreignStatus: FOREIGN.status } as const;

const FEATURES: readonly Feature[] = ['status', 'due', 'mark', 'c1', 'c2', 'c3'];
const BASE_KINDS: readonly Kind[] = ['prog', 'done', 'mark', 'due', 'plan'];
const KID_KINDS: readonly Kind[] = ['kids1', 'kids2', 'kidsBlind', 'kid', 'done', 'prog'];
const BASE_ANSWERS: readonly Answer[] = ['success', 'conflict', 'missing'];
const ALL_ANSWERS: readonly Answer[] = ['success', 'conflict', 'missing', 'refused', 'server'];

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

/** All one-change runs of the base class, and `count` drawn runs of two and of three changes each. */
function baseScenarios(count: number, seed: number): Scenario[] {
	const all: Scenario[] = [];
	for (const kind of BASE_KINDS) {
		for (const way of WAYS) {
			for (const answer of BASE_ANSWERS) {
				const steps = [{ kind, ...way }];
				const foreign = ownFeatureOf(kind);
				all.push({
					cls: 'basis',
					steps,
					answer,
					foreign,
					clock: null,
					lateDiscard: null,
					...PLAIN
				});
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
			all.push({ cls: 'basis', steps, answer, foreign, clock: null, lateDiscard: null, ...PLAIN });
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
	Unteraufgaben: (random) => {
		// A completion, then a change of its sub-task of its own (M-2), discarded later.
		if (random() < 0.35) {
			const send = pick(random, ['offline', 'lost', 'unreached'] as const);
			return [
				step({ kind: pick(random, ['kids1', 'kids2', 'kidsBlind'] as const), send }),
				step({ kind: 'kid', send: pick(random, ['offline', 'lost'] as const) })
			];
		}
		// Since round 3 a completion with its sub-tasks is also kept (R2-1): a later change of the status
		// is taken into it and drops the sub-tasks (OF-2, the last wish counts), and one behind a waiting
		// change whose value before is "done" goes behind it.
		return times(1 + Math.floor(random() * 3), () => {
			const kind = pick(random, KID_KINDS);
			const sends: readonly Send[] = ['offline', 'lost', 'unreached'];
			const way = wayOf(random, sends, ['none', 'before', 'during', 'after'], ['none', 'now']);
			return { kind, ...way };
		});
	},
	'fremd in der Kette': (random) => {
		const steps = times(2 + Math.floor(random() * 2), () => baseStep(random));
		const at = Math.floor(random() * (steps.length - 1));
		const foreign = pick(random, ['status', 'due', 'mark'] as const);
		return steps.map((entry, index) => (index === at ? { ...entry, foreign } : entry));
	}
};

/**
 * The server of a run of the class "Unteraufgaben" (round 3, R2-1): C1 blocks A or nothing does (the
 * server never completes a sub-task the client did not name), A may be done before the chain, and
 * someone else may complete A in the middle of it. From a source of its own, so the other classes draw
 * what they drew before.
 */
function kidServer(extra: () => number, steps: Step[]): Pick<Scenario, keyof typeof PLAIN> {
	const blocking = extra() < 0.5 ? [C1] : [];
	const doneBefore = extra() < 0.25;
	const foreignStatus: Status = extra() < 0.5 ? 'done' : FOREIGN.status;
	if (extra() < 0.4) {
		const at = Math.floor(extra() * steps.length);
		steps.splice(at, 1, { ...(steps[at] as Step), foreign: 'status' });
	}
	return { blocking, doneBefore, foreignStatus };
}

/**
 * Runs of the class "Unteraufgaben" around a notice that stands (OF-3c round 2, C-1 and C-5): someone
 * else completed A before, so a completion with its sub-tasks that arrives in a short return of the
 * connection names C1 in a notice. Then either the user sets C1 anew, the request gets no answer or
 * does not reach the server, "Verwerfen" comes and its take-back arrives; or the user sets A in
 * progress, someone else completes A again unseen (or, since round 3, sets it "Wartet"), and a later
 * completion with the same sub-tasks arrives at its first attempt on that stale state (or makes the
 * step to "done" and takes C1 along). Only the same ones: a first direct attempt names
 * no sub-task it did not complete (limit of OF-3b round 3, "as today"). From a source of their own, so
 * every other run stays.
 */
function noticeScenarios(count: number, seed: number): Scenario[] {
	const random = seeded(seed + 3);
	const kids = ['kids1', 'kids2', 'kidsBlind'] as const;
	return times(count, (): Scenario => {
		const kind = pick(random, kids);
		const first = step({ kind, send: 'window' });
		const steps =
			random() < 0.5
				? [
						first,
						step({
							kind: 'kid',
							send: pick(random, ['lost', 'unreached'] as const),
							discard: pick(random, ['after', 'during'] as const),
							undo: pick(random, ['none', 'none', 'now'] as const)
						})
					]
				: [
						first,
						step({
							kind: 'prog',
							send: pick(random, ['window', 'direct'] as const),
							foreign: 'status'
						}),
						step({ kind, send: 'direct' })
					];
		return {
			cls: 'Unteraufgaben',
			steps,
			answer: pick(random, ALL_ANSWERS),
			foreign: 'status',
			clock: null,
			lateDiscard: null,
			blocking: [C1],
			doneBefore: true,
			// Someone else completes A again (a stale state) or sets it "Wartet": then the later completion
			// makes the step to "done", takes C1 along and the notice goes once C1 is read done (round 3,
			// C2-2: the positive way of the first attempt).
			foreignStatus: pick(random, ['done', FOREIGN.status] as const)
		};
	});
}

/** `count` drawn runs of every class of round 2, and the runs around a notice that stands. */
function classScenarios(count: number, seed: number): Scenario[] {
	const random = seeded(seed + 1);
	const extra = seeded(seed + 2);
	const all: Scenario[] = [];
	type Make = (random: () => number) => Step[];
	for (const [cls, make] of Object.entries(CLASSES) as [Exclude<Cls, 'basis'>, Make][]) {
		for (let index = 0; index < count; index++) {
			const steps = make(random);
			const answer = pick(random, ALL_ANSWERS);
			const foreign = ownFeatureOf(pick(random, steps).kind);
			const clock =
				cls === '48 Stunden' ? times(3, () => pick(random, ['send', 'discard'] as const)) : null;
			// "Verwerfen" of an earlier change after a later one: the first one, a completion first.
			const completion = steps.findIndex((entry) => entry.kind.startsWith('kids'));
			const early = completion >= 0 ? completion : 0;
			const late = (cls === '48 Stunden' || cls === 'Unteraufgaben') && early < steps.length - 1;
			const lateDiscard = late && random() < 0.6 ? early : null;
			const server = cls === 'Unteraufgaben' ? kidServer(extra, steps) : PLAIN;
			all.push({ cls, steps, answer, foreign, clock, lateDiscard, ...server });
		}
	}
	return [...all, ...noticeScenarios(Math.ceil(count * NOTICE_SHARE), seed)];
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
	} else if (action.kind === 'dayplan.check' || action.kind === 'dayplan.uncheck') {
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
	if (action.kind !== 'dayplan.check' && action.kind !== 'dayplan.uncheck') return null;
	return action.payload.action === 'today' ? 'mark' : featureOfTicket(action.ticket);
}

/** What an action asks for its main value, as the dialog names it (R2-4). */
function wishOf(action: KeptAction): Value {
	if (action.kind === 'ticket.update') {
		const payload = action.payload;
		return 'due' in payload ? payload.due : payload.status;
	}
	if (action.kind !== 'dayplan.check' && action.kind !== 'dayplan.uncheck') return null;
	if (action.payload.action === 'today') return action.kind === 'dayplan.check';
	return action.kind === 'dayplan.check' ? 'done' : (action.payload.status ?? 'open');
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
	// C3 is in progress on the server; the views never showed it, so a guess of its status is wrong.
	h.server.status.set(C3, 'in_progress');
	// The hook completes only blocking sub-tasks, on the step to "done" (round 3, R2-1).
	h.server.blocking.set(A, [...scenario.blocking]);
	if (scenario.doneBefore) h.server.status.set(A, 'done');
	await settle();
	const initial = serverValues(h);
	/** What the views showed before the chain: A open where someone else completed it unseen. */
	const shownBefore: Values = {
		...initial,
		...(scenario.doneBefore && { status: 'open' as Status })
	};
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
	/** The wishes the user keeps for a value, in their order; a change that dropped one holds none. */
	const keptOf = (feature: Feature): Intent[] =>
		intents.filter(
			(intent) =>
				intent.feature === feature && !intent.discarded && !intent.superseded && !intent.cancel
		);
	/** What the user wants of a value now: the last wish they keep, else the value before. */
	const willNow = (feature: Feature): Value => keptOf(feature).at(-1)?.value ?? initial[feature];
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
	// Someone else completed A before the chain; the views never showed it.
	if (scenario.doneBefore) {
		foreignActive.set('status', 'done');
		foreignAt.set('status', { value: 'done', at: tick++ });
	}
	/** The oracle's own bookkeeping of the requests (R2-4): identifiers with a request before. */
	const requested = new Set<string>();
	/** A step of the class "direkt" makes its change now: only its first request names no value before. */
	let directStep = false;

	/**
	 * Someone else sets a value: always the same one per value in a run (the mark of the day turned
	 * the first time), so no change of someone else returns to a value an own change was based on.
	 */
	function changeByOthers(feature: OwnFeature): void {
		const before = serverValues(h)[feature];
		let value: Value;
		if (feature === 'due') {
			value = FOREIGN.due;
			h.server.due.set(A, FOREIGN.due);
		} else if (feature === 'mark') {
			const item = h.server.items.get(ITEM) ?? { ticket: A, doneToday: false };
			const first = foreignAt.get('mark');
			value = first === undefined ? !item.doneToday : first.value === true;
			h.server.items.set(ITEM, { ...item, doneToday: value });
		} else {
			value = scenario.foreignStatus;
			h.server.status.set(A, scenario.foreignStatus);
		}
		if (before === value) return;
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
	 * The writes of a request (I2). Only the first request of a change of the class "direkt" names no
	 * value before (OF-2 §2; round 3, R2-4: no later one, no other step). The limit M1 counts where the
	 * value of someone else is the wish of a discarded own change that may have arrived; and, the same
	 * limit of the server, where the server took an own request the first time without a change because
	 * someone else had set its very wish: it cannot tell this from the request arriving (it takes the
	 * wish without a conflict), so from then on the value counts as the own one. A repetition of an
	 * identifier the server applied before changes nothing and takes nothing over (R2-4).
	 */
	function noteWrites(
		action: KeptAction,
		before: Values,
		fields: OutboxFields,
		ok: boolean,
		request: { first: boolean; direct: boolean; replay: boolean }
	): void {
		const after = serverValues(h);
		const blind = fields.expected === undefined && request.direct && request.first;
		for (const feature of FEATURES) {
			if (before[feature] === after[feature]) continue;
			// The limit of the day plan with a done ticket (OF-3b §9): it compares "checked", the mark
			// of the day or done, so a mark of someone else cannot show as a conflict.
			const done = feature === 'mark' && before.status === 'done';
			const limit = blind || done || isLimitM1(feature, before[feature]);
			if (foreignActive.has(feature) && !limit) {
				outcome.i2.push(`${feature}: ${String(before[feature])} → ${String(after[feature])}`);
			}
			foreignActive.delete(feature);
		}
		const main = mainFeatureOf(action);
		if (!ok || request.replay || main === null || before[main] !== after[main]) return;
		if (wishOf(action) === before[main]) foreignActive.delete(main);
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
		const first = !requested.has(op);
		requested.add(op);
		const direct = directStep;
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
		const replay = h.server.applied.has(op);
		const facts = { first, direct, replay };
		let answer: T;
		try {
			answer = await request();
		} catch (error) {
			// The fake server loses an answer only after it took the request.
			const lost = error instanceof DataError && error.kind === 'network';
			if (lost) maybeArrived.add(op);
			noteWrites(action, before, fields, lost, facts);
			throw error;
		}
		noteWrites(action, before, fields, true, facts);
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

	/** What the views show of a value of A someone else may change, the waiting changes over it. */
	function shownValue(feature: OwnFeature): Value {
		if (feature === 'mark') return h.outbox.checkRow(knownItem, knownTicket(A)).doneToday;
		const main = h.outbox.apply(knownTicket(A));
		return feature === 'due' ? main.due : main.status;
	}

	/** Makes a change and notes its wishes with the action they live in. */
	async function change(kind: Kind): Promise<string | null | undefined> {
		const before = userActions();
		const own: readonly OwnFeature[] = ['status', 'due', 'mark'];
		const seen = new Map<Feature, Value>(own.map((feature) => [feature, shownValue(feature)]));
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
		if (cancel) {
			for (const intent of intents) if (intent.op === dropped) intent.superseded = true;
			// A change drops a waiting one only on the way back to what the user wanted without it.
			for (const wish of made) {
				const will = willNow(wish.feature);
				if (will !== wish.value)
					outcome.i1.push(`${wish.feature}: aufgehoben, gewollt ${String(will)}`);
			}
		}
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
	const stepOps: (string | null | undefined)[] = [];
	for (const entry of scenario.steps) {
		const direct = entry.send === 'direct' || entry.send === 'directLost';
		if (direct) {
			await online();
			if (entry.send === 'directLost') h.server.lose = 1;
		}
		directStep = direct;
		const op = await change(entry.kind);
		directStep = false;
		stepOps.push(op);
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
	const late = scenario.lateDiscard === null ? undefined : stepOps[scenario.lateDiscard];
	if (typeof late === 'string' && h.outbox.actions.some((action) => action.op === late)) {
		await discardWithUndo(late);
		await settle();
	}

	if (scenario.clock !== null) vi.setSystemTime(NOW + AUTO_SEND_MS + 60_000);
	if (scenario.answer === 'conflict') changeByOthers(scenario.foreign);
	else if (scenario.answer !== 'success') finalMode = scenario.answer;
	// At most four minutes; it ends once the outbox rests (OF-4b round 2, K-6).
	await online();
	await drain(h, 4);
	if (scenario.clock !== null) {
		let index = 0;
		for (const action of [...h.outbox.actions]) {
			if (action.state !== 'expired' || action.undoes !== undefined) continue;
			const decision = scenario.clock[index++ % scenario.clock.length];
			if (decision === 'send') await h.outbox.sendAnyway(action.op);
			else await discardWithUndo(action.op);
		}
		await drain(h, 4);
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
	// A sub-task the server did not complete although a kept completion should have taken it along
	// (the hook completes blocking ones on the step to "done" only): the notice names it and stays,
	// the user decides in the ticket (round 3, R2-1). It leaves I1 out for that sub-task only where the
	// user wants it done in the end and it is not; a notice about a sub-task that is done or that the
	// user no longer wants done is a false one (OF-3c, R3-4: I3). The words are the oracle's own.
	const notices = h.outbox.notices.map((notice) => notice.text);
	for (const id of [C1, C2, C3]) {
		const named = `Unteraufgabe HAUS-${id.slice(-2)} ist nicht erledigt`;
		const feature = featureOfTicket(id);
		if (feature === null || !notices.some((text) => text.includes(named))) continue;
		if (willNow(feature) === 'done' && server[feature] !== 'done') suspended.add(feature);
		else {
			const values = `Server ${String(server[feature])}, gewollt ${String(willNow(feature))}`;
			outcome.i3.push(`${feature}: falscher Hinweis „nicht erledigt“, ${values}`);
		}
	}
	/** The wishes the user keeps for a value, in their order. */
	const willOf = willNow;
	// The value of the server holds the will, or someone else set it after the last own change that
	// writes the will (after the start without one), or a decision touching it is to be seen.
	const holds = (feature: Feature): boolean => {
		if (suspended.has(feature) || server[feature] === willOf(feature)) return true;
		// The limit M1 before the chain (round 3): someone else had set the very wish of a discarded
		// own change that may have arrived, unseen; without a change the user keeps, its take-back
		// goes back to what the views showed, as the server cannot tell the two apart (OF-3b §9).
		const before = keptOf(feature).length === 0 && isLimitM1(feature, initial[feature]);
		if (before && server[feature] === shownBefore[feature]) return true;
		const foreign = foreignAt.get(feature);
		const source = keptOf(feature).at(-1)?.at ?? -1;
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
	const late =
		scenario.lateDiscard === null ? '' : ` [spät verworfen: ${scenario.lateDiscard + 1}]`;
	const server =
		scenario.cls !== 'Unteraufgaben'
			? ''
			: ` {blockiert: ${scenario.blocking.map(featureOfTicket).join(',') || '–'}${scenario.doneBefore ? ', vorher erledigt' : ''}, fremd: ${scenario.foreignStatus}}`;
	return `${scenario.cls}: ${steps}${late}${server} ⇒ ${scenario.answer}${foreign}${clock}`;
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
	const perClass = new Map<Cls, number>();
	for (const scenario of runs) {
		const outcome = await run(scenario);
		const all: string[] = [];
		for (const name of CHECKS) {
			if (outcome[name].length > 0) counts[name] += 1;
			all.push(...outcome[name].map((entry) => `${name.toUpperCase()} ${entry}`));
		}
		if (all.length === 0) continue;
		failures.push(`${describeScenario(scenario)}: ${all.join('; ')}`);
		perClass.set(scenario.cls, (perClass.get(scenario.cls) ?? 0) + 1);
	}
	if (process.env.BYL_MATRIX_REPORT === '1') {
		const broken = CHECKS.map((name) => `${name.toUpperCase()} ${counts[name]}`).join(', ');
		const classes = [...perClass].map(([cls, count]) => `${cls} ${count}`).join(', ');
		const lines = [
			`Matrix: ${runs.length} Abläufe, verletzt: ${failures.length} (${broken})`,
			`Verletzt je Klasse: ${classes === '' ? 'keine' : classes}`,
			`Abdeckung: ${coverage}`,
			...failures.slice(0, 40)
		];
		process.stdout.write(`${lines.join('\n')}\n`);
	}
	return failures;
}

/** Runs per length drawn in the base class in addition to all one-change runs (fixed seed). */
const DRAWN = 1000;
/**
 * Runs drawn per class of round 2 (fixed seed); together with the base class the file took 5.9 s on a
 * developer machine (round 2 of OF-4b, K-6) and stays under 10 s.
 */
const CLASS_RUNS = 250;
/** The runs around a notice that stands, as a share of CLASS_RUNS (OF-3c round 2): 100 of 250. */
const NOTICE_SHARE = 0.4;
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
