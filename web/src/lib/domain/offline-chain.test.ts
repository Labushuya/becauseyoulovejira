// Pure rules of the chains after "Verwerfen" (OF-3b, ADR-0074 addendum OF-3b): what the user wants of
// a value (`targetOf`, `intentOf`), the take-backs a chain needs (`settleChains`), what passes on when
// an action goes (`leaveChain`, `fallback`), the end of a discarded one after 48 hours
// (`coveredAtExpiry`), the format of the new fields and "Trotzdem wieder öffnen".

import { describe, expect, it } from 'vitest';
import {
	coveredAtExpiry,
	inverseOf,
	leaveChain,
	restoreAs,
	settleChains,
	takenBackBy,
	type ChainContext
} from './offline-chain';
import {
	canReopenAnyway,
	intentOf,
	opsOf,
	parseAction,
	planStatusChange,
	reopenInstead,
	statusFeature,
	targetOf,
	writesOf,
	type DayPlanAction,
	type KeptAction,
	type OutboxAction
} from './offline';

const NOW = Date.UTC(2026, 9, 20, 12, 30, 0);
const USER = 'user00000000001';
const TICKET = 'tick00000000001';
const FIRST = 'aaaaaaaaaaaaaaaaaaa1';
const SECOND = 'aaaaaaaaaaaaaaaaaaa2';

function status(overrides: Partial<OutboxAction> = {}): OutboxAction {
	return {
		v: 1,
		op: FIRST,
		seq: 1,
		user: USER,
		scope: `u:${USER}`,
		kind: 'ticket.update',
		target: TICKET,
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

/** A second change of the status behind the first one. */
function behind(overrides: Partial<OutboxAction> = {}): OutboxAction {
	const waiting = { payload: { status: 'waiting' as const } };
	return status({ op: SECOND, seq: 2, dependsOn: [FIRST], ...waiting, ...overrides });
}

function check(overrides: Partial<DayPlanAction> = {}): DayPlanAction {
	return {
		v: 1,
		op: FIRST,
		seq: 1,
		user: USER,
		scope: `u:${USER}`,
		kind: 'dayplan.check',
		target: 'item00000000001',
		ticket: TICKET,
		ticketKind: 'task',
		dependsOn: [],
		payload: { action: 'today', mode: 'today' },
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

/** Identifiers "bbb…1", "bbb…2", … for new take-backs, numbers of the order from 10. */
function context(): ChainContext {
	let next = 0;
	return {
		fresh: () => {
			next += 1;
			return { op: `bbbbbbbbbbbbbbbbbbb${next}`, seq: 9 + next, now: NOW };
		},
		label: (id) => (id === 'tick00000000003' ? 'HAUS-13' : null)
	};
}

const kept = { sent: true as const, unanswered: true as const, discarded: true as const };
const toProgress: Partial<OutboxAction> = {
	payload: { status: 'in_progress' },
	expected: { status: 'done' }
};

describe('what the user wants of a value (OF-3b)', () => {
	it('is the wish of the last change they keep, else the value before the chain', () => {
		const discarded = status(kept);
		const later = behind();
		const feature = statusFeature(TICKET);
		expect(targetOf([discarded], feature, opsOf([discarded]))).toBe('open');
		expect(targetOf([discarded, later], feature, opsOf([discarded, later]))).toBe('waiting');
		expect(targetOf([], feature, new Set())).toBeUndefined();
	});

	it('counts a check mark for what it is for, also where the server has that already', () => {
		const noop = check({ expected: { doneToday: true, status: 'open' } });
		expect(writesOf(noop).size).toBe(0);
		expect([...intentOf(noop)]).toEqual([['mark:item00000000001', true]]);
	});

	it('drops a waiting change only on the way back to what the user wanted before it', () => {
		const discarded = status(kept);
		const later = behind(toProgress);
		const base = { target: TICKET, key: 'HAUS-12', title: '', scope: '', base: 'open' as const };
		const plan = { user: USER, op: 'cccccccccccccccccccc', seq: 3, now: NOW, offline: true };
		// "Erledigt" again is a wish of its own once the first one is discarded.
		const done = planStatusChange([discarded, later], { ...base, status: 'done' }, plan);
		expect(done).toMatchObject({ kind: 'merge', action: { op: SECOND } });
		expect(done.kind === 'merge' && done.action.payload).toEqual({ status: 'done' });
		const open = planStatusChange([discarded, later], { ...base, status: 'open' }, plan);
		expect(open).toEqual({ kind: 'cancel', op: SECOND });
	});
});

describe('the take-backs of a chain (OF-3b)', () => {
	it('takes back a discarded change at the end of its chain, and none where a later change sets the value', () => {
		const discarded = status(kept);
		const [, takeBack] = settleChains([discarded], context());
		expect(takeBack).toMatchObject({
			undoes: FIRST,
			dependsOn: [FIRST],
			payload: { status: 'open' },
			expected: { status: 'done' }
		});
		const settled = settleChains([discarded, behind()], context());
		expect(settled.map((action) => action.op)).toEqual([FIRST, SECOND]);
		expect(settled[1]?.expected).toEqual({ status: 'done' });
	});

	it('takes back the mark of the day under a later change of the status (H1a)', () => {
		const settled = settleChains([check(kept), behind()], context());
		expect(settled.at(-1)).toMatchObject({
			kind: 'dayplan.uncheck',
			undoes: FIRST,
			payload: { action: 'today' },
			expected: { doneToday: true, status: 'waiting' }
		});
	});

	it('adjusts or drops a take-back that never left the device, and goes behind one that did', () => {
		const settled = settleChains([status(kept)], context());
		const back = settled.at(-1) as KeptAction;
		expect(takenBackBy(settled, back).map((action) => action.op)).toEqual([FIRST]);
		// Kept again: the take-back that never left the device goes.
		const again = status({ sent: true, unanswered: true });
		const restored = settleChains([again, back], context());
		expect(restored.map((action) => action.op)).toEqual([FIRST]);
		// One that left the device, after the first one went, stays; discarded in turn ("Rückgängig"),
		// it gets another one behind it.
		const later = settleChains([{ ...back, ...kept }], context());
		expect(later.map((action) => action.payload)).toEqual([{ status: 'open' }, { status: 'done' }]);
		expect(later[1]).toMatchObject({ undoes: back.op, expected: { status: 'open' } });
	});

	it('opens the sub-tasks a discarded completion took along with their status before (M3)', () => {
		const completion = status({
			...kept,
			completion: 'complete_children',
			children: ['tick00000000003'],
			childrenBefore: ['in_progress']
		});
		const settled = settleChains([completion], context());
		expect(settled.slice(1)).toMatchObject([
			{ target: TICKET, payload: { status: 'open' } },
			{ target: 'tick00000000003', key: 'HAUS-13', title: '', payload: { status: 'in_progress' } }
		]);
		expect(settled[2]?.dependsOn).toEqual([FIRST, settled[1]?.op]);
	});
});

describe('an action that goes (OF-3b)', () => {
	it('passes on what the user wants when a discarded one arrived (fallback)', () => {
		const chain = [status(kept), behind(toProgress)];
		const left = leaveChain(chain, FIRST, { how: 'arrived' }, context());
		expect(left).toMatchObject([{ op: SECOND, expected: { status: 'done' } }]);
		expect(left[0]?.fallback).toEqual({ status: 'open' });
		// Discarded as well, a take-back brings the value back to what the user wanted before both.
		const settled = settleChains([{ ...(left[0] as KeptAction), ...kept }], context());
		expect(settled.at(-1)?.payload).toEqual({ status: 'open' });
		expect(settled.at(-1)?.expected).toEqual({ status: 'in_progress' });
	});

	it('bases the next one on the value before when a discarded one changed nothing (H3)', () => {
		const chain = [status(kept), behind(toProgress)];
		const left = leaveChain(chain, FIRST, { how: 'nothing' }, context());
		expect(left).toMatchObject([{ op: SECOND, expected: { status: 'open' } }]);
		expect(left[0]).not.toHaveProperty('fallback');
	});

	it('comes back as a take-back of "Verwerfen" on "Rückgängig", based on what the user wanted before', () => {
		const original = status({ ...kept, fallback: { status: 'waiting' } });
		const restored = restoreAs([], original, { op: SECOND, seq: 5, now: NOW });
		expect(restored).toMatchObject({ op: SECOND, undoes: FIRST, expected: { status: 'waiting' } });
		expect(restored).not.toHaveProperty('discarded');
		const takeBack = behind({
			undoes: FIRST,
			payload: { status: 'open' },
			expected: { status: 'done' }
		});
		const turned = inverseOf(takeBack, { op: 'cccccccccccccccccccc', seq: 9, now: NOW });
		expect(turned).toMatchObject({ payload: { status: 'done' }, expected: { status: 'open' } });
		expect(turned.undoes).toBe(SECOND);
	});

	it('goes after 48 hours without being sent where its take-back holds whatever the server has', () => {
		const discarded = status(kept);
		expect(coveredAtExpiry(settleChains([discarded], context()), discarded)).toBe(true);
		expect(coveredAtExpiry([discarded, behind()], discarded)).toBe(false);
	});
});

describe('the format and "Trotzdem wieder öffnen" (OF-3b)', () => {
	it('reads the fallback and the status before of the sub-tasks back, and a broken one as broken', () => {
		const action = status({
			fallback: { status: 'waiting', due: null },
			completion: 'complete_children',
			children: ['tick00000000003'],
			childrenBefore: ['in_progress']
		});
		const codeOf = (raw: unknown) => parseAction(raw)?.outcome?.code;
		expect(parseAction(JSON.parse(JSON.stringify(action)))).toEqual(action);
		expect(codeOf({ ...action, fallback: { status: 'kaputt' } })).toBe('broken');
		expect(codeOf({ ...action, childrenBefore: ['open', 'open'] })).toBe('broken');
	});

	it('opens a ticket over the normal way instead of a refused taking back of a completion', () => {
		const back = check({
			kind: 'dayplan.uncheck',
			payload: { action: 'complete', status: 'waiting' },
			expected: { doneToday: false, status: 'done' },
			state: 'refused',
			outcome: { code: 'validation_dayplan_readonly', message: '' }
		});
		expect(canReopenAnyway(back)).toBe(true);
		expect(canReopenAnyway({ ...back, payload: { action: 'today' } })).toBe(false);
		expect(reopenInstead(back, SECOND)).toMatchObject({
			op: SECOND,
			kind: 'ticket.update',
			target: TICKET,
			payload: { status: 'waiting' },
			expected: { status: 'done' },
			state: 'queued'
		});
	});
});
