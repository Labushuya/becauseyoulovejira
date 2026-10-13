// Pure rules of the day plan (TP-1, ADR-0065, app/pb_hooks/lib/day-plan-rules.js): the kind of a
// ticket, the modes of the sources with their defaults, which source a ticket matches, the suggestions
// with mode, origin and reasons in their order, what a check mark means, which days can be planned
// and the order of the entries; since TP-4 the order of "Aufgaben", the place of a new entry and the
// order of a plan as one request.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const rules = loadHookLib('day-plan-rules.js');
const TODAY = '2031-05-14';

/** An open task without a due date, changed by `data`. */
function ticket(id, data = {}) {
	return { id, status: 'open', due: '', kind: 'task', recurring: false, priority: 'medium', created: `2031-01-01 00:00:0${id.length}.000Z`, ...data };
}

const context = (data = {}) => ({ today: TODAY, settings: null, planned: [], dismissed: [], leftover: [], ...data });

describe('kind of a ticket', () => {
	it('is "ongoing" only for that value, a task otherwise', () => {
		expect(rules.kindOf('ongoing')).toBe('ongoing');
		for (const value of ['task', '', null, undefined, 'Ongoing', 'projekt']) expect(rules.kindOf(value), String(value)).toBe('task');
		expect([...rules.KINDS]).toEqual(['task', 'ongoing']);
		expect(rules.DEFAULT_KIND).toBe('task');
	});
});

describe('modes of the sources', () => {
	it('defaults to "automatisch übernehmen" for ongoing projects and "vorschlagen" for the rest', () => {
		expect(rules.settingsOf(null)).toEqual({
			ongoing: 'auto',
			due_today: 'suggest',
			overdue: 'suggest',
			recurrence: 'suggest',
			leftover: 'suggest',
			in_progress: 'suggest',
			// "Mir zugewiesen" (ADR-0068 §8).
			assigned: 'suggest'
		});
	});

	it('takes known modes of known sources and the default for anything else', () => {
		expect(rules.settingsOf({ ongoing: 'off', overdue: 'auto', due_today: 'immer', morgen: 'auto' })).toMatchObject({
			ongoing: 'off',
			overdue: 'auto',
			due_today: 'suggest'
		});
		expect(rules.settingsOf([])).toEqual(rules.settingsOf(null));
		expect(rules.settingsOf('auto')).toEqual(rules.settingsOf(null));
	});

	it('refuses a request with an unknown source or mode', () => {
		expect(rules.sourcesViolation({ ongoing: 'off', in_progress: 'auto' })).toBe('');
		expect(rules.sourcesViolation({})).toBe('');
		for (const input of [null, [], 'auto', { ongoing: 'immer' }, { morgen: 'auto' }, { ongoing: null }]) {
			expect(rules.sourcesViolation(input), JSON.stringify(input)).toBe('validation_dayplan_sources');
		}
	});
});

describe('matching sources', () => {
	it('names each source a ticket matches, most specific first', () => {
		expect(rules.matchingSources(ticket('a', { kind: 'ongoing' }), TODAY, [])).toEqual(['ongoing']);
		expect(rules.matchingSources(ticket('a', { due: TODAY }), TODAY, [])).toEqual(['due_today']);
		expect(rules.matchingSources(ticket('a', { due: TODAY, recurring: true }), TODAY, [])).toEqual(['recurrence', 'due_today']);
		expect(rules.matchingSources(ticket('a', { due: '2031-05-13', recurring: true }), TODAY, [])).toEqual(['overdue']);
		expect(rules.matchingSources(ticket('a', { due: '2031-05-11' }), TODAY, ['a'])).toEqual(['leftover', 'overdue']);
		expect(rules.matchingSources(ticket('a', { status: 'in_progress', kind: 'ongoing' }), TODAY, [])).toEqual([
			'ongoing',
			'in_progress'
		]);
		expect(rules.matchingSources(ticket('a', { due: '2031-05-15' }), TODAY, [])).toEqual([]);
		expect(rules.matchingSources(ticket('a', { status: 'waiting' }), TODAY, [])).toEqual([]);
	});

	it('never matches a done ticket', () => {
		expect(rules.matchingSources(ticket('a', { status: 'done', kind: 'ongoing', due: TODAY }), TODAY, ['a'])).toEqual([]);
	});

	it('names the reasons in German, overdue with the day it is overdue since (WH-1)', () => {
		expect(rules.reasonText('overdue', { due: '2031-05-13' }, TODAY)).toBe('überfällig seit 13.05.');
		expect(rules.reasonText('overdue', { due: '2031-05-01' }, TODAY)).toBe('überfällig seit 01.05.');
		expect(rules.reasonText('overdue', { due: '2030-05-14' }, TODAY)).toBe('überfällig seit 14.05.2030');
		expect(rules.overdueSinceText('2030-12-31', '2031-01-01')).toBe('überfällig seit 31.12.2030');
		expect(['ongoing', 'recurrence', 'leftover', 'due_today', 'in_progress'].map((source) => rules.reasonText(source, {}, TODAY))).toEqual([
			'laufendes Vorhaben',
			'Wiederholung',
			'übrig von gestern',
			'heute fällig',
			'in Arbeit'
		]);
	});

	it('names the overdue day across a leap day and the turn of the year', () => {
		expect(rules.shortDate('2032-02-29', '2032-03-01')).toBe('29.02.');
		expect(rules.shortDate('2031-12-31', '2032-01-01')).toBe('31.12.2031');
		expect(rules.reasonText('overdue', { due: '2031-03-29' }, '2031-03-31')).toBe('überfällig seit 29.03.');
	});
});

describe('suggestions', () => {
	it('suggests by default and takes ongoing projects in automatically', () => {
		const tickets = [ticket('a', { kind: 'ongoing' }), ticket('b', { due: TODAY }), ticket('c')];
		expect(rules.suggestionsOf(tickets, context())).toEqual([
			{ id: 'a', mode: 'auto', origin: 'ongoing', reasons: ['laufendes Vorhaben'] },
			{ id: 'b', mode: 'suggest', origin: 'due_today', reasons: ['heute fällig'] }
		]);
	});

	it('leaves planned and dismissed tickets out', () => {
		const tickets = [ticket('a', { due: TODAY }), ticket('b', { due: TODAY }), ticket('c', { due: TODAY })];
		expect(rules.suggestionsOf(tickets, context({ planned: ['a'], dismissed: ['b'] })).map((s) => s.id)).toEqual(['c']);
	});

	it('takes the strongest mode of the sources of a ticket, and its first source as origin', () => {
		const series = ticket('a', { due: TODAY, recurring: true });
		expect(rules.suggestionsOf([series], context({ settings: { due_today: 'auto' } }))).toEqual([
			{ id: 'a', mode: 'auto', origin: 'due_today', reasons: ['Wiederholung', 'heute fällig'] }
		]);
		expect(rules.suggestionsOf([series], context({ settings: { recurrence: 'off' } }))).toEqual([
			{ id: 'a', mode: 'suggest', origin: 'due_today', reasons: ['heute fällig'] }
		]);
		expect(rules.suggestionsOf([series], context({ settings: { recurrence: 'off', due_today: 'off' } }))).toEqual([]);
	});

	it('orders by origin, due date (none last), priority, creation and ID', () => {
		const tickets = [
			ticket('late', { status: 'in_progress' }),
			ticket('old', { due: '2031-05-01' }),
			ticket('new', { due: '2031-05-12' }),
			ticket('low', { due: TODAY, priority: 'low' }),
			ticket('top', { due: TODAY, priority: 'urgent' }),
			ticket('mid', { due: TODAY }),
			ticket('first', { kind: 'ongoing' })
		];
		expect(rules.suggestionsOf(tickets, context()).map((s) => s.id)).toEqual(['first', 'old', 'new', 'top', 'mid', 'low', 'late']);
	});

	it('proposes a series at most once: only its current occurrence, nothing while one is planned (WH-1)', () => {
		expect(rules.seriesKeyOf('rule1', '')).toBe('rule1');
		expect(rules.seriesKeyOf('rule1', '2031-05-12 00:00:00.000Z')).toBe('');
		expect(rules.seriesKeyOf('', '')).toBe('');
		// Two open tickets of one series (only possible with data from before): the later one counts,
		// the older one is never proposed, also when the later one is removed for the day.
		const older = ticket('old', { due: '2031-05-10', recurring: true, series: 'rule1' });
		const current = ticket('cur', { due: '2031-05-12', recurring: true, series: 'rule1' });
		const other = ticket('one', { due: '2031-05-11' });
		expect(rules.suggestionsOf([older, current, other], context())).toEqual([
			{ id: 'one', mode: 'suggest', origin: 'overdue', reasons: ['überfällig seit 11.05.'] },
			{ id: 'cur', mode: 'suggest', origin: 'overdue', reasons: ['überfällig seit 12.05.'] }
		]);
		expect(rules.suggestionsOf([older, current], context({ dismissed: ['cur'] }))).toEqual([]);
		expect(rules.suggestionsOf([older, current], context({ planned: ['old'] }))).toEqual([]);
		// Without a due date it counts as the earliest; then the later creation, then the ID.
		const undated = ticket('none', { recurring: true, series: 'rule1', created: '2031-05-13 00:00:00.000Z' });
		expect(rules.suggestionsOf([undated, current], context()).map((s) => s.id)).toEqual(['cur']);
		const twin = ticket('cux', { due: '2031-05-12', recurring: true, series: 'rule1', created: current.created });
		expect(rules.suggestionsOf([current, twin], context()).map((s) => s.id)).toEqual(['cux']);
		// A done ticket never stands for its series.
		expect(rules.suggestionsOf([older, { ...current, status: 'done' }], context()).map((s) => s.id)).toEqual(['old']);
	});

	it('proposes every date of "Verpasste Termine nachholen" on its own (no series key)', () => {
		const dates = ['2031-05-12', '2031-05-13', TODAY].map((due, index) =>
			ticket(`d${index}`, { due, recurring: true, series: '' })
		);
		expect(rules.suggestionsOf(dates, context()).map((s) => s.id)).toEqual(['d2', 'd0', 'd1']);
	});

	it('suggests the leftovers of yesterday', () => {
		expect(rules.suggestionsOf([ticket('a'), ticket('b')], context({ leftover: ['b'] }))).toEqual([
			{ id: 'b', mode: 'suggest', origin: 'leftover', reasons: ['übrig von gestern'] }
		]);
	});
});

describe('check marks', () => {
	it('completes a task and checks an ongoing project for the day', () => {
		expect(rules.checkAction('task', 'check')).toBe('complete');
		expect(rules.checkAction('', 'check')).toBe('complete');
		expect(rules.checkAction('ongoing', 'check')).toBe('today');
	});

	it('offers the other way in the menu: "Nur für heute abhaken" and "Vorhaben abschließen"', () => {
		expect(rules.checkAction('task', 'today')).toBe('today');
		expect(rules.checkAction('ongoing', 'complete')).toBe('complete');
		expect(rules.checkAction('task', 'halb')).toBeNull();
		expect(rules.checkAction('task', undefined)).toBeNull();
	});

	it('counts an entry as done when it is checked for the day or its ticket is done', () => {
		expect(rules.isDone({ done_today: true }, 'open')).toBe(true);
		expect(rules.isDone({ done_today: false }, 'done')).toBe(true);
		expect(rules.isDone({ done_today: false }, 'in_progress')).toBe(false);
	});
});

describe('days', () => {
	it('takes calendar dates until tomorrow; days before only to read', () => {
		expect(rules.dateViolation(TODAY, '2031-05-15')).toBe('');
		expect(rules.dateViolation('2031-05-15', '2031-05-15')).toBe('');
		expect(rules.dateViolation('2020-01-01', '2031-05-15')).toBe('');
		expect(rules.dateViolation('2031-05-16', '2031-05-15')).toBe('validation_dayplan_future');
		for (const value of ['2031-02-30', '14.05.2031', '', null, 20310514]) {
			expect(rules.dateViolation(value, '2031-05-15'), String(value)).toBe('validation_dayplan_date');
		}
		expect(rules.isEditable(TODAY, TODAY, '2031-05-15')).toBe(true);
		expect(rules.isEditable('2031-05-15', TODAY, '2031-05-15')).toBe(true);
		expect(rules.isEditable('2031-05-13', TODAY, '2031-05-15')).toBe(false);
	});
});

describe('order of the entries', () => {
	it('moves an entry to a place, clamped to the list', () => {
		expect(rules.moved(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b']);
		expect(rules.moved(['a', 'b', 'c'], 'a', 1)).toEqual(['b', 'a', 'c']);
		expect(rules.moved(['a', 'b', 'c'], 'a', 99)).toEqual(['b', 'c', 'a']);
		expect(rules.moved(['a', 'b', 'c'], 'b', -3)).toEqual(['b', 'a', 'c']);
		expect(rules.moved(['a', 'b', 'c'], 'b', 1.7)).toEqual(['a', 'b', 'c']);
		expect(rules.moved(['a', 'b', 'c'], 'x', 0)).toBeNull();
	});
});

describe('the order of "Aufgaben" (TP-4, mirror of ticketOrder)', () => {
	const order = rules.ticketOrder(TODAY);
	const sorted = (list) => [...list].sort(order).map((entry) => entry.id);
	const t = (id, due, priority = 'medium', created = '2031-05-01 10:00:00.000Z') => ({ id, due, priority, created });

	it('puts what is due until today + 7 days first, by date, then the rest by priority', () => {
		expect(
			sorted([
				t('later-urgent', '2031-05-22', 'urgent'),
				t('none-high', '', 'high'),
				t('soon-low', '2031-05-21', 'low'),
				t('overdue', '2031-05-01', 'low'),
				t('today', TODAY, 'medium')
			])
		).toEqual(['overdue', 'today', 'soon-low', 'later-urgent', 'none-high']);
	});

	it('takes the priority within the same due date, then the newest, last the ID', () => {
		expect(
			sorted([
				t('b', '', 'medium', '2031-05-01 10:00:00.000Z'),
				t('a', '', 'medium', '2031-05-01 10:00:00.000Z'),
				t('newer', '', 'medium', '2031-05-02 10:00:00.000Z'),
				t('high', TODAY, 'high'),
				t('low', TODAY, 'low')
			])
		).toEqual(['high', 'low', 'newer', 'a', 'b']);
	});
});

describe('placing a new entry (TP-4)', () => {
	/** A ticket of an entry: a parent ('' for none), no due date, priority medium. */
	const e = (id, parent = '', data = {}) => ({ id, parent, due: '', priority: 'medium', created: '2031-05-01 10:00:00.000Z', ...data });
	const place = (entries, ticket) => rules.placementOf(entries, ticket, TODAY);

	it('puts a sub-task into the block of its parent, at its place by the order of "Aufgaben"', () => {
		const plan = [e('a'), e('p'), e('s1', 'p', { due: '2031-05-20' }), e('s3', 'p'), e('b')];
		// Due earlier than the first sibling: before it.
		expect(place(plan, e('s2', 'p', { due: '2031-05-16' }))).toBe(2);
		// Between the two: due later than s1, before s3 without a due date.
		expect(place(plan, e('s4', 'p', { due: '2031-05-25' }))).toBe(3);
		// After every sibling: at the end of the block, before the next entry.
		expect(place(plan, e('s5', 'p', { priority: 'low' }))).toBe(4);
		// Equal siblings: the newest first, as in "Aufgaben".
		expect(place([e('p'), e('s1', 'p'), e('s2', 'p')], e('s3', 'p', { created: '2031-05-09 10:00:00.000Z' }))).toBe(1);
	});

	it('puts a sub-task of a parent without a block after its last sibling below the parent, else after the parent', () => {
		// Scattered: the siblings stand apart from the parent.
		expect(place([e('p'), e('x'), e('s1', 'p'), e('y'), e('s2', 'p'), e('z')], e('s3', 'p'))).toBe(5);
		// A sibling above the parent does not count.
		expect(place([e('s1', 'p'), e('a'), e('p'), e('b')], e('s2', 'p'))).toBe(3);
		// No sibling: directly after the parent.
		expect(place([e('a'), e('p'), e('b')], e('s1', 'p'))).toBe(2);
		// An entry without a ticket ends a block like in the display.
		expect(place([e('p'), null, e('s1', 'p'), e('b')], e('s2', 'p'))).toBe(3);
	});

	it('puts a parent directly before the first of its sub-tasks in the plan', () => {
		expect(place([e('a'), e('s1', 'p'), e('b'), e('s2', 'p')], e('p'))).toBe(1);
		expect(place([e('s1', 'p')], e('p'))).toBe(0);
	});

	it('puts everything else at the end: no parent in the plan, no sub-task, an empty plan', () => {
		expect(place([e('s1', 'p'), e('a')], e('s2', 'p'))).toBe(2);
		expect(place([e('a'), e('b')], e('c'))).toBe(2);
		expect(place([e('a'), null], e('c'))).toBe(2);
		expect(place([], e('s1', 'p'))).toBe(0);
		expect(place([], e('c'))).toBe(0);
	});
});

describe('the order of a plan as one request (TP-4)', () => {
	it('takes 1 to 500 different IDs', () => {
		expect(rules.ORDER_MAX).toBe(500);
		expect(rules.orderViolation(['a'])).toBe('');
		expect(rules.orderViolation(Array.from({ length: 500 }, (_, index) => `i${index}`))).toBe('');
		expect(rules.orderViolation(Array.from({ length: 501 }, (_, index) => `i${index}`))).toBe('validation_dayplan_order_max');
		for (const ids of [undefined, null, 'a', {}, [], ['a', 'a'], ['a', 1], ['a', ''], [null]]) {
			expect(rules.orderViolation(ids), JSON.stringify(ids)).toBe('validation_dayplan_order');
		}
	});

	it('puts the named entries in their order on the places they hold together; every other one stays', () => {
		const plan = ['a', 'p', 's1', 's2', 'b', 'c'];
		// A parent with its block before "a": the client names the part that changed.
		expect(rules.orderedIds(plan, ['p', 's1', 's2', 'a'])).toEqual(['p', 's1', 's2', 'a', 'b', 'c']);
		// The whole plan in a new order.
		expect(rules.orderedIds(plan, ['c', 'b', 'a', 'p', 's1', 's2'])).toEqual(['c', 'b', 'a', 'p', 's1', 's2']);
		// Added meanwhile (x at the end, y in the block): unnamed, they keep their places.
		const now = ['a', 'p', 's1', 'y', 's2', 'b', 'c', 'x'];
		expect(rules.orderedIds(now, ['b', 'c', 'a', 'p', 's1', 's2'])).toEqual(['b', 'c', 'a', 'y', 'p', 's1', 's2', 'x']);
	});

	it('refuses an entry of another plan, one removed meanwhile and one named twice', () => {
		expect(rules.orderedIds(['a', 'b'], ['b', 'z'])).toBeNull();
		expect(rules.orderedIds(['a', 'b'], ['b', 'b'])).toBeNull();
		expect(rules.MESSAGES.validation_dayplan_order).toBe('Die Reihenfolge passt nicht zu den Einträgen dieses Plans.');
		expect(rules.MESSAGES.validation_dayplan_order_max).toBe('Bitte höchstens 500 Einträge auf einmal ordnen.');
	});
});
