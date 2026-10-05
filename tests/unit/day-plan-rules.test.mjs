// Pure rules of the day plan (TP-1, ADR-0065, app/pb_hooks/lib/day-plan-rules.js): the kind of a
// ticket, the modes of the sources with their defaults, which source a ticket matches, the suggestions
// with mode, origin and reasons in their order, what a check mark means, which days can be planned
// and the order of the entries.

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
