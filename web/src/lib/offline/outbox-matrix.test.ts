// The scenario matrix of "Verwerfen" (OF-3b, ADR-0074 addendum OF-3b): small runs on one ticket with
// up to three changes of its status, the mark of the day of one entry and its due date, each made
// without a connection, sent in a short return of the connection with its answer lost or without
// reaching the server, or kept; "Verwerfen" before, while and after it is sent, "Rückgängig" after
// "Verwerfen"; then the connection comes back with a success, a change of someone else, or one
// answer 404, and every change goes. Afterwards the targets of the addendum hold:
// - I1: every value has the wish of the last change the user kept for it (the value before without
//   one), or a conflict or a refusal is to be seen, or someone else set it after all of the own ones;
// - I2: no change of the outbox overwrites a value someone else set without a conflict (the limit M1
//   aside: someone else set the very value the own change wanted);
// - I3: no change whose request the server took leaves the outbox without a word after a 404.
// Every run starts the real outbox, its worker, the storage of the tests and `verdictOf` against the
// fake server of $lib/test/outbox-fake.ts. One-change runs are all there; runs of two and three
// changes are drawn with a fixed seed.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DayPlanItem } from '$lib/data/day-plan';
import { DataError } from '$lib/data/errors';
import type { CalendarDate } from '$lib/domain/berlin-date';
import type { OutboxFields } from '$lib/domain/offline';
import type { Status } from '$lib/domain/status';
import type { Ticket, TicketSummary } from '$lib/domain/ticket';
import {
	A,
	ALL_OPS,
	NOW,
	entry,
	harness,
	settle,
	ticket,
	type Harness
} from '$lib/test/outbox-fake';
import type { CheckAnswer } from './outbox.svelte';

const ITEM = 'item00000000001';
const D1: CalendarDate = '2026-10-22';
/** Values someone else sets: never one the user picks, so a conflict is a real one. */
const FOREIGN = { status: 'waiting' as Status, due: '2026-11-30' as CalendarDate };

type Kind = 'prog' | 'done' | 'mark' | 'due' | 'plan';
type Send = 'offline' | 'lost' | 'unreached';
type Discard = 'none' | 'before' | 'during' | 'after';
type Answer = 'success' | 'conflict' | 'missing';
type Feature = 'status' | 'due' | 'mark';

interface Step {
	kind: Kind;
	send: Send;
	discard: Discard;
	undo: boolean;
}

interface Scenario {
	steps: Step[];
	answer: Answer;
	/** The value someone else changes for `conflict`. */
	foreign: Feature;
}

const KINDS: readonly Kind[] = ['prog', 'done', 'mark', 'due', 'plan'];

/** Every way of one change: kept (discarded before or not), or sent and discarded during or after. */
const WAYS: readonly Omit<Step, 'kind'>[] = [
	{ send: 'offline', discard: 'none', undo: false },
	{ send: 'offline', discard: 'before', undo: false },
	{ send: 'offline', discard: 'before', undo: true },
	...(['lost', 'unreached'] as const).flatMap((send) => [
		{ send, discard: 'none' as const, undo: false },
		{ send, discard: 'during' as const, undo: false },
		{ send, discard: 'during' as const, undo: true },
		{ send, discard: 'after' as const, undo: false },
		{ send, discard: 'after' as const, undo: true }
	])
];
const ANSWERS: readonly Answer[] = ['success', 'conflict', 'missing'];

function featureOf(kind: Kind): Feature {
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

/** All one-change runs, and `count` drawn runs of two and of three changes each. */
function scenarios(count: number, seed: number): Scenario[] {
	const all: Scenario[] = [];
	for (const kind of KINDS) {
		for (const way of WAYS) {
			for (const answer of ANSWERS) {
				all.push({ steps: [{ kind, ...way }], answer, foreign: featureOf(kind) });
			}
		}
	}
	const random = seeded(seed);
	for (const length of [2, 3]) {
		for (let index = 0; index < count; index++) {
			const steps = Array.from({ length }, () => ({
				kind: pick(random, KINDS),
				...pick(random, WAYS)
			}));
			const answer = pick(random, ANSWERS);
			const foreign = featureOf(pick(random, steps).kind);
			all.push({ steps, answer, foreign });
		}
	}
	return all;
}

interface Intent {
	feature: Feature;
	value: Status | CalendarDate | boolean | null;
	/** The action the change lives in; null when it dropped one (back to the value before). */
	op: string | null;
	discarded: boolean;
}

interface Outcome {
	i1: string[];
	i2: string[];
	i3: string[];
}

type Values = { status: Status; due: CalendarDate | null; mark: boolean };

function serverValues(h: Harness): Values {
	return {
		status: h.server.status.get(A) ?? 'open',
		due: h.server.due.get(A) ?? null,
		mark: h.server.items.get(ITEM)?.doneToday ?? false
	};
}

/** Runs one scenario against the real outbox and the fake server and checks I1 to I3. */
async function run(scenario: Scenario): Promise<Outcome> {
	vi.setSystemTime(NOW);
	const h = harness({ support: ALL_OPS });
	h.server.items.set(ITEM, { ticket: A, doneToday: false });
	await settle();
	const initial: Values = serverValues(h);
	const outcome: Outcome = { i1: [], i2: [], i3: [] };

	// What the client knows of the server: the tickets the outbox shows, the entry of its answers.
	let known: Ticket = ticket(A);
	let knownItem: DayPlanItem = entry(ITEM, A, false);
	h.sink.upsert.mockImplementation((shown: TicketSummary) => {
		if (shown.id === A) known = { ...known, ...shown };
	});
	h.outbox.watchChecks((answer: CheckAnswer | null) => {
		const item = h.server.items.get(ITEM);
		knownItem =
			answer === null ? entry(ITEM, A, item?.doneToday ?? false) : { ...answer.item, ticket: null };
	});

	// The requests: the first one of an identifier may be lost or not reach the server, "Verwerfen"
	// may come while it is under way, the first one after the return may answer 404; every write
	// that changes a value someone else set is noted (I2).
	const first = new Map<string, Send>();
	let during: { op: string; undo: boolean } | null = null;
	let pendingUndo: (() => void) | null = null;
	let missing = false;
	const missed = new Set<string>();
	const foreignSet = new Set<Feature>();
	const intents: Intent[] = [];
	const exempt = (feature: Feature, value: unknown) =>
		intents.some((intent) => intent.feature === feature && intent.value === value);

	async function watched<T>(fields: OutboxFields, request: () => Promise<T>): Promise<T> {
		const op = fields.opId;
		if (missing) {
			missing = false;
			missed.add(op);
			throw new DataError('not_found', { status: 404 });
		}
		const mode = first.get(op);
		if (mode !== undefined) first.delete(op);
		if (mode !== undefined && during?.op === op) {
			const note = during;
			during = null;
			pendingUndo = await discardWithUndo(op);
			if (!note.undo) pendingUndo = null;
		}
		if (mode === 'unreached') throw new DataError('network');
		const before = serverValues(h);
		const answer = await request();
		const after = serverValues(h);
		for (const feature of ['status', 'due', 'mark'] as const) {
			if (before[feature] === after[feature]) continue;
			if (foreignSet.has(feature) && !exempt(feature, before[feature])) {
				outcome.i2.push(`${feature}: ${String(before[feature])} → ${String(after[feature])}`);
			}
			foreignSet.delete(feature);
		}
		if (mode === 'lost') throw new DataError('network');
		return answer;
	}
	const send = h.send.getMockImplementation();
	const sendDue = h.sendDue.getMockImplementation();
	const sendDayPlan = h.sendDayPlan.getMockImplementation();
	if (send === undefined || sendDue === undefined || sendDayPlan === undefined) {
		throw new Error('The fake server has no ways.');
	}
	h.send.mockImplementation((action, fields, signal) =>
		watched(fields, () => send(action, fields, signal))
	);
	h.sendDue.mockImplementation((action, fields, signal) =>
		watched(fields, () => sendDue(action, fields, signal))
	);
	h.sendDayPlan.mockImplementation((action, fields, signal) =>
		watched(fields, () => sendDayPlan(action, fields, signal))
	);

	/** "Verwerfen" of an action; resolves to the "Rückgängig" of its flag, if it offered one. */
	async function discardWithUndo(op: string): Promise<(() => void) | null> {
		const before = h.flags.show.mock.calls.length;
		await h.outbox.discard(op);
		for (const intent of intents) if (intent.op === op) intent.discarded = true;
		const flag = h.flags.show.mock.calls
			.slice(before)
			.map((call) => call[0])
			.find((input) => input.action?.label === 'Rückgängig');
		const undo = flag?.action?.run;
		if (undo === undefined) return null;
		return () => {
			undo();
			for (const intent of intents) if (intent.op === op) intent.discarded = false;
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

	const userOps = () =>
		new Map(
			h.outbox.actions
				.filter((action) => action.undoes === undefined)
				.map((action) => [action.op, JSON.stringify(action.payload)])
		);

	/** One change as the views make it, from what they show. */
	async function perform(kind: Kind): Promise<Intent | null> {
		const shown = h.outbox.apply(known);
		const row = h.outbox.checkRow(knownItem, known);
		const plan = { item: knownItem, ticket: known };
		if (kind === 'prog' || kind === 'done') {
			const status: Status = kind === 'prog' ? 'in_progress' : 'done';
			if (shown.status === status) return null;
			await h.outbox.changeStatus(shown, { status });
			return { feature: 'status', value: status, op: null, discarded: false };
		}
		if (kind === 'due') {
			const due = shown.due === D1 ? null : D1;
			await h.outbox.changeDue(shown, due);
			return { feature: 'due', value: due, op: null, discarded: false };
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
			return { feature: 'mark', value: !row.doneToday, op: null, discarded: false };
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
		return { feature: 'status', value: done ? 'open' : 'done', op: null, discarded: false };
	}

	await offline();
	for (const step of scenario.steps) {
		const before = userOps();
		const intent = await perform(step.kind);
		await settle();
		if (intent === null) continue;
		const after = userOps();
		const created = [...after.keys()].find((op) => !before.has(op));
		const merged = [...after.keys()].find(
			(op) => before.has(op) && before.get(op) !== after.get(op)
		);
		intent.op = created ?? merged ?? null;
		intents.push(intent);
		const op = intent.op;
		if (op === null) continue;
		const present = () => h.outbox.actions.some((action) => action.op === op);
		if (step.discard === 'before') {
			const undo = await discardWithUndo(op);
			await settle();
			if (step.undo) undo?.();
			await settle();
			continue;
		}
		if (step.send === 'offline') continue;
		first.set(op, step.send);
		if (step.discard === 'during') during = { op, undo: step.undo };
		await online();
		await offline();
		await settle();
		first.delete(op);
		during = null;
		if (step.discard === 'after' && present()) {
			const undo = await discardWithUndo(op);
			await settle();
			if (step.undo) undo?.();
		} else if (pendingUndo !== null) {
			const undo: () => void = pendingUndo;
			pendingUndo = null;
			undo();
		}
		await settle();
	}

	if (scenario.answer === 'conflict') {
		if (scenario.foreign === 'status') h.server.status.set(A, FOREIGN.status);
		else if (scenario.foreign === 'due') h.server.due.set(A, FOREIGN.due);
		else {
			const item = h.server.items.get(ITEM) ?? { ticket: A, doneToday: false };
			h.server.items.set(ITEM, { ...item, doneToday: !item.doneToday });
		}
		foreignSet.add(scenario.foreign);
	}
	if (scenario.answer === 'missing') missing = true;
	await online();
	for (let round = 0; round < 4; round++) await vi.advanceTimersByTimeAsync(61_000);

	// I1: the value of the server against the will of the user.
	const server = serverValues(h);
	const visible = h.outbox.actions.some(
		(action) => action.state === 'conflict' || action.state === 'refused'
	);
	for (const feature of ['status', 'due', 'mark'] as const) {
		const last = intents.filter((intent) => intent.feature === feature && !intent.discarded).at(-1);
		const will = last === undefined ? initial[feature] : last.value;
		if (server[feature] === will || visible) continue;
		if (foreignSet.has(feature)) continue;
		outcome.i1.push(`${feature}: Server ${String(server[feature])}, gewollt ${String(will)}`);
	}
	// I3: a request the server took, refused with 404, never leaves without a word.
	for (const op of missed) {
		const kept = h.outbox.actions.some((action) => action.op === op);
		if (!kept && h.server.applied.has(op) && !visible) outcome.i3.push(op);
	}
	h.stop();
	return outcome;
}

function describeScenario(scenario: Scenario): string {
	const steps = scenario.steps
		.map((step) => `${step.kind}/${step.send}/${step.discard}${step.undo ? '+undo' : ''}`)
		.join(' → ');
	const foreign = scenario.answer === 'conflict' ? `(${scenario.foreign})` : '';
	return `${steps} ⇒ ${scenario.answer}${foreign}`;
}

/** How many of the possible runs of each length the drawn ones cover. */
function coverage(runs: readonly Scenario[]): string {
	const lengths = [1, 2, 3].map((length) => {
		const distinct = new Set(
			runs.filter((run) => run.steps.length === length).map(describeScenario)
		);
		const possible = (KINDS.length * WAYS.length) ** length * ANSWERS.length;
		return `${length}: ${distinct.size} von ${possible}`;
	});
	return lengths.join(', ');
}

/** Runs per length drawn in addition to all one-change runs (fixed seed); the CI keeps under 10 s. */
const DRAWN = 1000;

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('the scenario matrix of "Verwerfen" (OF-3b)', () => {
	// BYL_MATRIX_RUNS and BYL_MATRIX_SEED draw other runs, BYL_MATRIX_REPORT=1 prints the numbers.
	it('keeps I1 to I3 in every run', { timeout: 60_000 }, async () => {
		const count = Number(process.env.BYL_MATRIX_RUNS ?? DRAWN);
		const runs = scenarios(count, Number(process.env.BYL_MATRIX_SEED ?? 20261021));
		const failures: string[] = [];
		const counts = { i1: 0, i2: 0, i3: 0 };
		for (const scenario of runs) {
			const outcome = await run(scenario);
			if (outcome.i1.length > 0) counts.i1 += 1;
			if (outcome.i2.length > 0) counts.i2 += 1;
			if (outcome.i3.length > 0) counts.i3 += 1;
			const all = [
				...outcome.i1.map((text) => `I1 ${text}`),
				...outcome.i2.map((text) => `I2 ${text}`),
				...outcome.i3.map((op) => `I3 ${op}`)
			];
			if (all.length > 0) failures.push(`${describeScenario(scenario)}: ${all.join('; ')}`);
		}
		if (process.env.BYL_MATRIX_REPORT === '1') {
			const broken = `I1 ${counts.i1}, I2 ${counts.i2}, I3 ${counts.i3}`;
			const lines = [
				`Matrix: ${runs.length} Abläufe, verletzt: ${failures.length} (${broken})`,
				`Verschiedene Abläufe je Länge: ${coverage(runs)}`,
				...failures.slice(0, 40)
			];
			process.stdout.write(`${lines.join('\n')}\n`);
		}
		expect(failures.slice(0, 10)).toEqual([]);
	});
});
