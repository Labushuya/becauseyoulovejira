// The day plan (TP-1, ADR-0065): the SPA (web/src/lib/domain/day-plan.ts) and the hook
// (app/pb_hooks/lib/day-plan-rules.js) know the same kinds, sources, modes, defaults, origins and
// texts, and compute the same suggestions, check actions, days and orders. The suggestions are
// compared on many generated plans, so a change on one side alone fails here.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import * as web from '../../web/src/lib/domain/day-plan.ts';
import * as dueLabel from '../../web/src/lib/domain/due-label.ts';

const hook = loadHookLib('day-plan-rules.js');

describe('constants of the day plan', () => {
	it('are the same in the SPA and in the hook', () => {
		expect([...web.TICKET_KINDS]).toEqual([...hook.KINDS]);
		expect(web.DEFAULT_KIND).toBe(hook.DEFAULT_KIND);
		expect([...web.DAY_PLAN_SOURCES]).toEqual([...hook.SOURCES]);
		expect([...web.SOURCE_MODES]).toEqual([...hook.MODES]);
		expect({ ...web.DEFAULT_SOURCES }).toEqual({ ...hook.DEFAULT_SOURCES });
		expect([...web.DAY_PLAN_ORIGINS]).toEqual([...hook.ORIGINS]);
		expect([...web.SOURCE_PRECEDENCE]).toEqual([...hook.PRECEDENCE]);
		expect([...web.CHECK_MODES]).toEqual([...hook.CHECK_MODES]);
		expect({ ...web.DAY_PLAN_MESSAGES }).toEqual({ ...hook.MESSAGES });
		expect(web.DAY_PLAN_SCOPE_TEXT).toBe(hook.SCOPE_TEXT);
		expect(web.ADOPT_MAX).toBe(hook.ADOPT_MAX);
	});

	it('name every source and mode in the settings', () => {
		expect(Object.keys(web.SOURCE_LABELS)).toEqual([...hook.SOURCES]);
		expect(Object.keys(web.MODE_LABELS)).toEqual([...hook.MODES]);
	});
});

/** A small deterministic generator (xorshift), so a failure can be repeated. */
function generator(seed) {
	let state = seed;
	return (n) => {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		return Math.abs(state) % n;
	};
}

const TODAY = '2031-06-10';
const DATES = ['', '', '2031-06-01', '2031-06-08', '2031-06-09', TODAY, TODAY, '2031-06-11', '2031-07-01'];
const STATUSES = ['backlog', 'open', 'open', 'in_progress', 'waiting', 'done'];
const PRIORITIES = ['low', 'medium', 'medium', 'high', 'urgent'];
const MODES = ['off', 'suggest', 'auto'];

function randomPlan(next, index) {
	const tickets = [];
	const count = 1 + next(12);
	for (let i = 0; i < count; i++) {
		const recurring = next(3) === 0;
		tickets.push({
			id: `t${index}x${i}`,
			status: STATUSES[next(STATUSES.length)],
			due: DATES[next(DATES.length)],
			kind: next(4) === 0 ? 'ongoing' : next(2) === 0 ? 'task' : '',
			recurring,
			// Several open tickets of one series (WH-1): only possible with data from before, so the
			// rules must agree on which one counts.
			series: recurring && next(3) !== 0 ? `r${next(2)}` : '',
			priority: PRIORITIES[next(PRIORITIES.length)],
			created: `2031-0${1 + next(5)}-1${next(9)} 10:00:00.000Z`
		});
	}
	const pick = () => tickets.filter(() => next(4) === 0).map((ticket) => ticket.id);
	const settings = next(3) === 0 ? null : Object.fromEntries(hook.SOURCES.map((source) => [source, MODES[next(3)]]));
	return { tickets, context: { today: TODAY, settings, planned: pick(), dismissed: pick(), leftover: pick() } };
}

describe('suggestions of the SPA and of the hook', () => {
	it('are the same for 400 generated plans', () => {
		const next = generator(20310610);
		for (let index = 0; index < 400; index++) {
			const { tickets, context } = randomPlan(next, index);
			expect(web.suggestionsOf(tickets, context), `plan ${index}`).toEqual(hook.suggestionsOf(tickets, context));
		}
	});

	it('name the same series and the same day an overdue ticket is overdue since (WH-1)', () => {
		for (const [recurrence, occurrence] of [['r1', ''], ['r1', '2031-06-01 00:00:00.000Z'], ['', ''], ['', '2031-06-01']]) {
			expect(web.seriesKeyOf(recurrence, occurrence)).toBe(hook.seriesKeyOf(recurrence, occurrence));
		}
		for (const due of ['2031-06-09', '2031-01-01', '2030-12-31', '2028-02-29']) {
			expect(web.reasonText('overdue', { due }, TODAY)).toBe(hook.reasonText('overdue', { due }, TODAY));
			expect(dueLabel.overdueSinceText(due, TODAY)).toBe(hook.overdueSinceText(due, TODAY));
			expect(dueLabel.relativeDue(due, TODAY).text).toBe(hook.overdueSinceText(due, TODAY));
		}
	});

	it('match the same sources and reasons for every ticket', () => {
		const next = generator(7);
		for (let index = 0; index < 100; index++) {
			const { tickets, context } = randomPlan(next, index);
			for (const ticket of tickets) {
				const sources = hook.matchingSources(ticket, TODAY, context.leftover);
				expect(web.matchingSources(ticket, TODAY, context.leftover)).toEqual(sources);
				for (const source of sources) expect(web.reasonText(source, ticket, TODAY)).toBe(hook.reasonText(source, ticket, TODAY));
			}
		}
	});
});

describe('the other rules of the SPA and of the hook', () => {
	it('read the same settings and refuse the same requests', () => {
		const inputs = [null, [], 'auto', {}, { ongoing: 'off' }, { ongoing: 'immer' }, { morgen: 'auto' }, { overdue: 'auto', in_progress: 'off' }];
		for (const input of inputs) {
			expect(web.settingsOf(input), JSON.stringify(input)).toEqual(hook.settingsOf(input));
			expect(web.sourcesViolation(input), JSON.stringify(input)).toBe(hook.sourcesViolation(input));
		}
	});

	it('decide the same about check marks, days and the order', () => {
		for (const kind of ['task', 'ongoing', '', 'x']) {
			for (const mode of ['check', 'today', 'complete', 'x', undefined]) {
				expect(web.checkAction(kind, mode), `${kind} ${mode}`).toBe(hook.checkAction(kind, mode));
			}
		}
		for (const date of ['2031-06-09', TODAY, '2031-06-11', '2031-06-12', '2031-02-30', 'x', '']) {
			expect(web.dateViolation(date, '2031-06-11'), date).toBe(hook.dateViolation(date, '2031-06-11'));
		}
		for (const date of ['2031-06-09', TODAY, '2031-06-11', '2031-06-12']) {
			expect(web.isEditable(date, TODAY, '2031-06-11')).toBe(hook.isEditable(date, TODAY, '2031-06-11'));
		}
		for (const index of [-1, 0, 1, 2, 5, 1.5]) {
			expect(web.moved(['a', 'b', 'c'], 'b', index)).toEqual(hook.moved(['a', 'b', 'c'], 'b', index));
		}
		for (const [done, status] of [[true, 'open'], [false, 'done'], [false, 'open']]) {
			expect(web.isDone(done, status)).toBe(hook.isDone({ done_today: done }, status));
		}
		expect(web.kindOf('ongoing')).toBe(hook.kindOf('ongoing'));
		expect(web.kindOf('')).toBe(hook.kindOf(''));
	});
});
