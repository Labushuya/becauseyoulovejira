// The chains of the outbox and "Verwerfen" (OF-3b, ADR-0074 addendum OF-3b with its round 2). Pure:
// the store passes the actions of the device and a source of new identifiers, and writes what comes
// back with one compare-and-swap per action.
//
// - A chain is the status of a ticket with the check marks of its entries, or its due date (OF-3). A
//   take-back of a sub-task belongs to the chain of the completion it takes back while that waits; while
//   a completion takes sub-tasks along, their own chains count as one with its chain (round 2, M-2).
// - For every value of a chain the user wants the wish of the last change they keep, else the value
//   before the chain (I1). Where the chain would end on another value, a take-back stands at its end.
//   `settleChains` decides the take-backs anew at every change of the device: one that never left the
//   device is adjusted or goes, one that left it stays and gets another one behind it where needed.
//   The values before of the actions that never left the device follow from the ones before them.
// - `leaveChain` lets an action go: arrived, changed nothing (a refusal or a conflict of a discarded
//   one), or decided by the user. The next action that names a value is based on what the server has
//   then and keeps what the user wants of it (`fallback`); without one a take-back carries it.
// - A take-back has no "Verwerfen" of its own (round 2, S2). "Rückgängig" after "Verwerfen" of a change
//   that went meanwhile brings its wish back as a normal change at the end of the chain (`wishAgain`).

import type { CalendarDate } from './berlin-date';
import {
	chainBaseOf,
	changesSomething,
	childFeaturesOf,
	expectedOf,
	fallbackOf,
	inOrder,
	intentOf,
	isDayPlanAction,
	isDerived,
	isDueAction,
	isFree,
	isTakeBack,
	isWill,
	mayHaveArrived,
	needsDecision,
	opsOf,
	priorOf,
	rebasedBehind,
	stateBefore,
	ticketOf,
	valuesOfState,
	withChildBefore,
	withExpected,
	withFallback,
	writesOf,
	type Feature,
	type FeatureValue,
	type KeptAction,
	type ServerState
} from './offline';
import type { Status } from './status';

/** A new identifier, number of the order and time for an action the outbox makes itself. */
export interface Fresh {
	op: string;
	seq: number;
	now: number;
}

export interface ChainContext {
	fresh: () => Fresh;
	/** The key of a sub-task for its take-back (no title: no content of it), null when unknown. */
	label?: (ticket: string) => string | null;
}

/**
 * How an action leaves its chain: arrived; changed nothing; a conflict the user let go (they take what
 * the server has); or refused or older than 48 hours and let go by the user (round 2, H-1): the next
 * ones are based on `state` as well, but what the user wants without it (`fallback`) still counts.
 */
export type Leave =
	| { how: 'arrived' }
	| { how: 'nothing' }
	| { how: 'decided'; state: ServerState }
	| { how: 'refused'; state: ServerState };

/** A request of the action may be on its way or have arrived: under way, or without an answer. */
export function mayBeThere(action: KeptAction): boolean {
	return action.state === 'sending' || mayHaveArrived(action);
}

/** The own chain of an action: its value, or for a derived take-back the chain of what it takes back. */
function chainKeyOf(action: KeptAction, byOp: ReadonlyMap<string, KeptAction>, depth = 0): string {
	if (action.undoes !== undefined && isFree(action) && depth < 4) {
		const undone = byOp.get(action.undoes);
		if (undone !== undefined && undone !== action) return chainKeyOf(undone, byOp, depth + 1);
	}
	return isDueAction(action) ? `due:${action.target}` : `status:${ticketOf(action)}`;
}

function byOpOf(actions: readonly KeptAction[]): Map<string, KeptAction> {
	return new Map(actions.map((action) => [action.op, action]));
}

/** Whether `feature` is the status of a sub-task the action takes along, not of its own ticket. */
function isChildOf(action: KeptAction, feature: Feature): boolean {
	return feature.startsWith('status:') && feature !== `status:${ticketOf(action)}`;
}

/**
 * The chain of every action (round 2, M-2): its own, and while a completion takes sub-tasks along, the
 * chains of the status of these sub-tasks are one chain with its chain, so a change of a sub-task of
 * its own counts for what the user wants of it and for where it ends.
 */
function chainKeysOf(actions: readonly KeptAction[]): Map<string, string> {
	const byOp = byOpOf(actions);
	const parent = new Map<string, string>();
	const rootOf = (key: string): string => {
		let root = key;
		for (let up = parent.get(root); up !== undefined; up = parent.get(root)) root = up;
		return root;
	};
	for (const action of actions) {
		const own = rootOf(chainKeyOf(action, byOp));
		for (const feature of priorOf(action).keys()) {
			if (!isChildOf(action, feature)) continue;
			const child = rootOf(feature);
			if (child !== own) parent.set(child, own);
		}
	}
	return new Map(actions.map((action) => [action.op, rootOf(chainKeyOf(action, byOp))]));
}

/** The members of the chain of `action` in their order. */
export function chainOf(actions: readonly KeptAction[], action: KeptAction): KeptAction[] {
	const keys = chainKeysOf(actions);
	const key = keys.get(action.op);
	return inOrder(actions).filter((other) => keys.get(other.op) === key);
}

interface Want {
	wish: FeatureValue;
	expected: FeatureValue;
	/** The discarded action whose change it takes back, or the first one of the value. */
	anchor: KeptAction;
}

/**
 * The values before of the free actions from the ones before them, also the status before of the
 * sub-tasks a completion takes along (round 2); a fallback counts only first.
 */
function recompute(actions: readonly KeptAction[]): KeptAction[] {
	const values = new Map<Feature, FeatureValue>();
	return actions.map((original) => {
		let action = original;
		if (isFree(action)) {
			for (const feature of [...expectedOf(action).keys(), ...childFeaturesOf(action)]) {
				if (!values.has(feature)) continue;
				const value = values.get(feature) as FeatureValue;
				action = withChildBefore(withExpected(action, feature, value), feature, value);
				action = withFallback(action, feature, undefined);
			}
		}
		for (const [feature, value] of priorOf(action)) {
			if (!values.has(feature)) values.set(feature, value);
		}
		for (const [feature, value] of writesOf(action)) values.set(feature, value);
		return action;
	});
}

/** The take-back of `feature` for `want`, at the end of the chain. */
function takeBackOf(
	feature: Feature,
	want: Want,
	dependsOn: string[],
	context: ChainContext
): KeptAction {
	const { op, seq, now } = context.fresh();
	const anchor = want.anchor;
	const head = {
		v: 1 as const,
		op,
		seq,
		user: anchor.user,
		scope: anchor.scope,
		dependsOn,
		key: anchor.key,
		title: anchor.title,
		createdAt: now,
		state: 'queued' as const,
		attempts: 0,
		nextAttemptAt: 0,
		undoes: anchor.op
	};
	if (feature.startsWith('due:')) {
		return {
			...head,
			kind: 'ticket.update',
			target: feature.slice('due:'.length),
			payload: { due: want.wish as CalendarDate | null },
			expected: { due: want.expected as CalendarDate | null }
		};
	}
	if (feature.startsWith('mark:') && isDayPlanAction(anchor)) {
		const on = want.wish === true;
		return {
			...head,
			kind: on ? 'dayplan.check' : 'dayplan.uncheck',
			target: anchor.target,
			ticket: anchor.ticket,
			ticketKind: anchor.ticketKind,
			payload: on ? { action: 'today', mode: 'today' } : { action: 'today' },
			expected: { doneToday: want.expected === true, status: anchor.expected.status }
		};
	}
	const ticket = feature.slice('status:'.length);
	const wish = want.wish as Status;
	const before = want.expected as Status;
	if (ticket !== ticketOf(anchor)) {
		// A sub-task a discarded completion took along (M3): opened like "Rückgängig" does it online.
		return {
			...head,
			key: context.label?.(ticket) ?? '',
			title: '',
			kind: 'ticket.update',
			target: ticket,
			payload: { status: wish },
			expected: { status: before }
		};
	}
	if (isDayPlanAction(anchor) && anchor.discarded === true) {
		// The counterpart of a discarded check mark goes the way of the day plan as well (OF-3).
		const plan = {
			...head,
			target: anchor.target,
			ticket: anchor.ticket,
			ticketKind: anchor.ticketKind,
			expected: { doneToday: anchor.expected.doneToday, status: before }
		};
		// Taking a completion back opens only a done ticket; otherwise the status goes directly.
		if (anchor.kind === 'dayplan.check' && wish !== 'done' && before === 'done') {
			return {
				...plan,
				kind: 'dayplan.uncheck',
				payload: { action: 'complete', status: wish }
			};
		}
		if (anchor.kind === 'dayplan.uncheck' && wish === 'done') {
			return { ...plan, kind: 'dayplan.check', payload: { action: 'complete', mode: 'complete' } };
		}
	}
	return {
		...head,
		kind: 'ticket.update',
		target: ticket,
		payload: { status: wish },
		expected: { status: before }
	};
}

/** What has to be taken back per value of a chain: where it ends otherwise than the user wants. */
function wantsOf(fixed: readonly KeptAction[]): Map<Feature, Want> {
	const wanted = new Map<Feature, Want>();
	const features = new Set<Feature>();
	for (const action of fixed) for (const [feature] of priorOf(action)) features.add(feature);
	for (const feature of features) {
		const base = chainBaseOf(fixed, feature);
		if (base === undefined) continue;
		let target = base.will;
		let end = base.server;
		let anchor: KeptAction | null = null;
		for (const action of fixed) {
			const writes = writesOf(action);
			if (writes.has(feature)) end = writes.get(feature) as FeatureValue;
			if (action.discarded === true) {
				if (writes.has(feature)) anchor = action;
				continue;
			}
			const intent = intentOf(action);
			if (intent.has(feature)) target = intent.get(feature) as FeatureValue;
		}
		if (end === target) continue;
		wanted.set(feature, { wish: target, expected: end, anchor: anchor ?? base.first });
	}
	return wanted;
}

function settleChain(
	members: readonly KeptAction[],
	present: ReadonlySet<string>,
	context: ChainContext
): KeptAction[] {
	const derived = members.filter((action) => isDerived(action, present));
	const fixed = recompute(members.filter((action) => !isDerived(action, present)));
	const wanted = wantsOf(fixed);
	const position = new Map(members.map((action, index) => [action.op, index]));
	const kept: KeptAction[] = [];
	const matched = new Set<Feature>();
	for (const takeBack of derived) {
		const writes = [...writesOf(takeBack)];
		const only = writes.length === 1 ? writes[0] : undefined;
		const want = only === undefined ? undefined : wanted.get(only[0]);
		if (only === undefined || want === undefined || matched.has(only[0])) continue;
		if (only[1] !== want.wish) continue;
		if ((position.get(takeBack.op) ?? -1) < (position.get(want.anchor.op) ?? 0)) continue;
		matched.add(only[0]);
		const undoes = want.anchor.op;
		kept.push(takeBack.undoes === undoes ? takeBack : { ...takeBack, undoes });
	}
	const settled = inOrder([...fixed, ...kept]);
	for (const [feature, want] of wanted) {
		if (matched.has(feature)) continue;
		const before = settled.map((action) => action.op);
		settled.push(takeBackOf(feature, want, before, context));
	}
	return recompute(settled);
}

/**
 * The actions of the device as they should be (OF-3b): per chain the take-backs it needs, the values
 * before of the actions that never left the device. A take-back that took everything back and changes
 * nothing goes. New take-backs come last, with identifiers from `context.fresh`.
 */
export function settleChains(actions: readonly KeptAction[], context: ChainContext): KeptAction[] {
	const present = new Set(actions.map((action) => action.op));
	const spent = (action: KeptAction) =>
		isTakeBack(action) &&
		isFree(action) &&
		!isDerived(action, present) &&
		!changesSomething(action);
	const live = inOrder(actions).filter((action) => !spent(action));
	const alive = new Set(live.map((action) => action.op));
	const keys = chainKeysOf(live);
	const chains = new Map<string, KeptAction[]>();
	for (const action of live) {
		const key = keys.get(action.op) ?? '';
		chains.set(key, [...(chains.get(key) ?? []), action]);
	}
	const result: KeptAction[] = [];
	for (const members of chains.values()) result.push(...settleChain(members, alive, context));
	return result;
}

/**
 * The actions once `op` left (OF-3b). Arrived: the next ones are based on its wish already. Changed
 * nothing: they are based on its value before, and its derived take-backs go with it. Let go by the
 * user: they are based on `state`, what the server had at the conflict or as last seen; after a
 * conflict the user takes that, after a refusal or 48 hours what they want without it (`fallback`,
 * round 2) still counts. What the user wants of a value passes on to the next action that names it, or
 * to a take-back when none does.
 */
export function leaveChain(
	actions: readonly KeptAction[],
	op: string,
	leave: Leave,
	context: ChainContext
): KeptAction[] {
	const ordered = inOrder(actions);
	const self = ordered.find((action) => action.op === op);
	if (self === undefined) return ordered;
	const present = new Set(ordered.map((action) => action.op));
	const members = chainOf(ordered, self);
	const index = members.indexOf(self);
	const gone = new Set([op]);
	if (leave.how !== 'arrived') {
		for (const action of members) {
			if (action.undoes === op && isDerived(action, present)) gone.add(action.op);
		}
	}
	let state: ServerState | null = null;
	if (leave.how === 'decided' || leave.how === 'refused') state = leave.state;
	else if (leave.how === 'nothing') state = stateBefore(self);
	const rebased = new Map<string, KeptAction>();
	if (state !== null) {
		const remaining = ordered.filter((action) => !gone.has(action.op) || action.op === op);
		for (const next of rebasedBehind(remaining, op, state)) rebased.set(next.op, next);
	}
	let result = ordered
		.filter((action) => !gone.has(action.op))
		.map((action) => rebased.get(action.op) ?? action);
	const later = new Set(members.slice(index + 1).map((action) => action.op));
	const values = state === null ? new Map<Feature, FeatureValue>() : valuesOfState(self, state);
	const writes = writesOf(self);
	const created: KeptAction[] = [];
	for (const [feature, before] of priorOf(self)) {
		if (members.slice(0, index).some((action) => priorOf(action).has(feature))) continue;
		let server = before;
		if (leave.how === 'arrived' && writes.has(feature)) {
			server = writes.get(feature) as FeatureValue;
		} else if (values.has(feature)) {
			server = values.get(feature) as FeatureValue;
		}
		const fallback = fallbackOf(self, feature);
		const intent = intentOf(self);
		let will = fallback === undefined ? before : fallback;
		if (leave.how === 'decided') will = server;
		else if (leave.how === 'refused') will = fallback === undefined ? server : fallback;
		else if (leave.how === 'arrived' && self.discarded !== true && intent.has(feature)) {
			will = intent.get(feature) as FeatureValue;
		}
		const next = result.find((action) => later.has(action.op) && priorOf(action).has(feature));
		if (next !== undefined) {
			if (isTakeBack(next) || next.state === 'sending') continue;
			const updated = withFallback(next, feature, will === server ? undefined : will);
			result = result.map((action) => (action.op === next.op ? updated : action));
		} else if (will !== server) {
			// Also a sub-task it took along, where what the user wants of it passed on (round 2).
			const chain = result.filter((action) => later.has(action.op)).map((action) => action.op);
			const want = { wish: will, expected: server, anchor: self };
			created.push(takeBackOf(feature, want, chain, context));
		}
	}
	return [...result, ...created];
}

/** Where the actions leave `feature`: the last value one of them sets, else the value before the first. */
function endOf(actions: readonly KeptAction[], feature: Feature): { value: FeatureValue } | null {
	let end: { value: FeatureValue } | null = null;
	for (const action of inOrder(actions)) {
		const prior = priorOf(action);
		if (end === null && prior.has(feature)) end = { value: prior.get(feature) as FeatureValue };
		const writes = writesOf(action);
		if (writes.has(feature)) end = { value: writes.get(feature) as FeatureValue };
	}
	return end;
}

/** The action itself once more as a new, normal change: new identifier, number and time. */
function againOf(original: KeptAction, fresh: Fresh): KeptAction {
	const copy: KeptAction = {
		...original,
		op: fresh.op,
		seq: fresh.seq,
		createdAt: fresh.now,
		dependsOn: [],
		state: 'queued',
		attempts: 0,
		nextAttemptAt: 0
	};
	const dropped = [
		'sent',
		'unanswered',
		'discarded',
		'outcome',
		'sendingSince',
		'late',
		'fallback',
		'undoes'
	] as const;
	for (const field of dropped) delete copy[field];
	return copy;
}

/**
 * "Rückgängig" after "Verwerfen" of a change that went meanwhile (round 2, H-2c): the user wants its
 * wish again. Where a later change they keep sets a value, that one stays and keeps the wish for the
 * case it goes as well (`fallback`). Every other value gets the wish anew as a normal change at the end
 * of its chain, with a new identifier and based on where the chain ends: the change itself once more,
 * or one change per value where only some of its values come back. A take-back of it in a conflict or
 * refused goes first; the new change is based on what the take-back was based on, so a change of
 * someone else shows as a conflict. Null when nothing is to do.
 */
export function wishAgain(
	actions: readonly KeptAction[],
	original: KeptAction,
	context: ChainContext
): KeptAction[] | null {
	let result = inOrder(actions);
	const own = (action: KeptAction) => action.undoes === original.op;
	const later = (action: KeptAction) => action.seq > original.seq && !own(action);
	const present = opsOf(result);
	const needed = new Map<Feature, FeatureValue>();
	let changed = false;
	for (const [feature, wish] of intentOf(original)) {
		const kept = result.some(
			(action) => later(action) && isWill(action, present) && intentOf(action).has(feature)
		);
		if (!kept) {
			needed.set(feature, wish);
			continue;
		}
		const next = result.find((action) => later(action) && priorOf(action).has(feature));
		if (next === undefined || isTakeBack(next) || next.state === 'sending') continue;
		const before = priorOf(next).get(feature);
		const updated = withFallback(next, feature, wish === before ? undefined : wish);
		if (updated === next) continue;
		result = result.map((action) => (action.op === next.op ? updated : action));
		changed = true;
	}
	if (needed.size === 0) return changed ? result : null;
	const bases = new Map<Feature, FeatureValue>();
	for (const back of result.filter((action) => own(action) && needsDecision(action))) {
		if (![...writesOf(back).keys()].some((feature) => needed.has(feature))) continue;
		for (const [feature, value] of priorOf(back)) bases.set(feature, value);
		result = leaveChain(result, back.op, { how: 'nothing' }, context);
	}
	const left = opsOf(result);
	const fixed = result.filter((action) => !isDerived(action, left));
	const baseOf = (feature: Feature): FeatureValue => {
		const end = endOf(fixed, feature);
		if (end !== null) return end.value;
		if (bases.has(feature)) return bases.get(feature) as FeatureValue;
		const fallback = fallbackOf(original, feature);
		return fallback === undefined ? (priorOf(original).get(feature) as FeatureValue) : fallback;
	};
	const made: KeptAction[] = [];
	if ([...intentOf(original).keys()].every((feature) => needed.has(feature))) {
		made.push(againOf(original, context.fresh()));
	} else {
		for (const [feature, wish] of needed) {
			const change = takeBackOf(
				feature,
				{ wish, expected: baseOf(feature), anchor: original },
				[],
				context
			);
			delete change.undoes;
			made.push(change);
		}
	}
	for (const change of made) {
		let based = change;
		for (const [feature] of expectedOf(change)) {
			based = withExpected(based, feature, baseOf(feature));
		}
		const chain = chainOf([...result, based], based).filter((action) => action.op !== based.op);
		result = [...result, { ...based, dependsOn: chain.map((action) => action.op) }];
	}
	return result;
}

/**
 * Whether a discarded action older than 48 hours may go without being sent (OF-3b): no request of it
 * is under way any more, and every value it changes is taken back right behind it to its value before.
 * The server has that value or the wish of the action; the take-back is based on the wish and ends on
 * the value before, and the server takes a change to the value it already has without a conflict.
 */
export function coveredAtExpiry(actions: readonly KeptAction[], action: KeptAction): boolean {
	const members = chainOf(actions, action);
	const after = members.slice(members.indexOf(action) + 1);
	for (const [feature, wish] of writesOf(action)) {
		const before = priorOf(action).get(feature);
		if (wish === before) continue;
		const next = after.find((other) => priorOf(other).has(feature) || writesOf(other).has(feature));
		if (next === undefined || next.undoes !== action.op || !isFree(next)) return false;
		if (writesOf(next).get(feature) !== before) return false;
	}
	return true;
}
