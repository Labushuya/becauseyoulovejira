// Unit tests of the planned dates in the calendar (ADR-0053 §4): the dates of the rules in the
// period from the next ticket on (catch-up without "Jeden Termin einzeln anlegen"), paused rules
// left out, a waiting rule from today on, a rule after completion with its one date, no date twice
// next to an open ticket of the series, the texts of "erscheint …", and the size of a month with
// 2 000 open tickets and 50 rules.

import { describe, expect, it } from 'vitest';
import { periodOf, entriesByDay, DEFAULT_LAYERS } from './calendar';
import {
	PLANNED_PER_RULE_MAX,
	plannedAppearsText,
	plannedOccurrences,
	type PlannedOccurrence
} from './calendar-plan';
import { EMPTY_LIST_QUERY } from './list-query';
import { CATCH_UP_ASK_HINT, type RecurrenceRule } from './recurrence-rule';
import type { TicketSummary } from './ticket';

const TODAY = '2026-10-02';
const T0 = '2026-09-01 08:00:00.000Z';
const OCTOBER = periodOf('month', TODAY);

function rule(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
	return {
		id: 'rule00000000001',
		title: 'Müll rausbringen',
		description: '',
		projectId: null,
		tagIds: [],
		priority: null,
		mode: 'calendar',
		freq: 'weekly',
		interval: 1,
		weekdays: ['MO'],
		monthDay: null,
		anchor: '2026-09-07',
		leadDays: 3,
		nextDue: '2026-10-05',
		lastGeneratedAt: null,
		active: true,
		lastHint: '',
		created: T0,
		updated: T0,
		...overrides
	};
}

let sequence = 0;

function instance(due: string | null, ruleId = 'rule00000000001', status = 'open'): TicketSummary {
	sequence += 1;
	return {
		id: `t${String(sequence).padStart(14, '0')}`,
		key: `HAUS-${sequence}`,
		title: 'Müll rausbringen',
		status: status === 'done' ? 'done' : 'open',
		priority: 'medium',
		due,
		projectId: null,
		tagIds: [],
		project: null,
		tags: [],
		recurring: true,
		recurrenceId: ruleId,
		source: null,
		completedAt: null,
		created: `2026-09-0${Math.min(sequence, 9)} 08:00:00.000Z`,
		updated: T0
	};
}

const dates = (list: readonly PlannedOccurrence[]) => list.map((entry) => entry.date);

describe('planned dates of a rule', () => {
	it('lists the dates of the period from the next ticket on, each with the day it appears', () => {
		const list = plannedOccurrences([rule()], [], TODAY, OCTOBER.from, OCTOBER.to);
		expect(dates(list)).toEqual(['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
		expect(list[0]?.appears).toBe('2026-10-02');
		expect(list[1]?.appears).toBe('2026-10-09');
	});

	it('names the open ticket that holds the next one back, and shows no date twice', () => {
		const open = instance('2026-09-28');
		const list = plannedOccurrences([rule()], [open], TODAY, OCTOBER.from, OCTOBER.to);
		expect(list[0]?.blockedBy).toEqual([open.key]);
		expect(list[1]?.blockedBy).toEqual([]);
		// The open ticket was moved to a planned date: it stands there, the plan leaves it out.
		const moved = instance('2026-10-12');
		const without = plannedOccurrences([rule()], [moved], TODAY, OCTOBER.from, OCTOBER.to);
		expect(dates(without)).toEqual(['2026-10-05', '2026-10-19', '2026-10-26']);
		// Done tickets of the series hold their date as well.
		const done = instance('2026-10-19', 'rule00000000001', 'done');
		expect(dates(plannedOccurrences([rule()], [done], TODAY, OCTOBER.from, OCTOBER.to))).toEqual([
			'2026-10-05',
			'2026-10-12',
			'2026-10-26'
		]);
	});

	it('starts after missed dates with the latest of them, as the server catches up (ADR-0022 §3)', () => {
		const late = rule({ nextDue: '2026-09-14' });
		expect(dates(plannedOccurrences([late], [], TODAY, OCTOBER.from, OCTOBER.to))).toEqual([
			'2026-09-28',
			'2026-10-05',
			'2026-10-12',
			'2026-10-19',
			'2026-10-26'
		]);
	});

	it('shows no missed date of a series held back by its overdue ticket, only dates after today (WH-1)', () => {
		// The ticket of 14.09. is carried along (next_due 21.09.). Done today (Fri 02.10.) at the
		// earliest, the next one is Monday 05.10.; 21.09. and 28.09. are no open entries.
		const carried = instance('2026-09-14');
		const list = plannedOccurrences(
			[rule({ nextDue: '2026-09-21' })],
			[carried],
			TODAY,
			OCTOBER.from,
			OCTOBER.to
		);
		expect(OCTOBER.from <= '2026-09-28').toBe(true);
		expect(dates(list)).toEqual(['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
		expect(list[0]?.blockedBy).toEqual([carried.key]);
		expect(list.every((entry) => entry.date > TODAY)).toBe(true);
	});

	it('with "Jeden Termin einzeln anlegen" waits for no open ticket', () => {
		const each = rule({ eachOccurrence: true, nextDue: '2026-09-28' });
		const open = [instance('2026-09-21')];
		const list = plannedOccurrences([each], open, TODAY, OCTOBER.from, OCTOBER.to);
		expect(dates(list)[0]).toBe('2026-09-28');
		expect(list.every((entry) => entry.blockedBy.length === 0)).toBe(true);
	});

	it('leaves paused rules out and shows a waiting one from today on', () => {
		const paused = rule({ active: false });
		expect(plannedOccurrences([paused], [], TODAY, OCTOBER.from, OCTOBER.to)).toEqual([]);
		const waiting = rule({
			eachOccurrence: true,
			nextDue: '2026-01-05',
			lastHint: CATCH_UP_ASK_HINT
		});
		expect(dates(plannedOccurrences([waiting], [], TODAY, OCTOBER.from, OCTOBER.to))[0]).toBe(
			'2026-10-05'
		);
	});

	it('knows only the next date of a rule after completion, and none while its ticket is open', () => {
		const after = rule({
			mode: 'after_completion',
			freq: 'daily',
			interval: 3,
			weekdays: [],
			nextDue: '2026-10-10'
		});
		expect(dates(plannedOccurrences([after], [], TODAY, OCTOBER.from, OCTOBER.to))).toEqual([
			'2026-10-10'
		]);
		expect(
			plannedOccurrences([{ ...after, nextDue: null }], [], TODAY, OCTOBER.from, OCTOBER.to)
		).toEqual([]);
	});

	it('carries the values of the template: priority, status of the start, project, tags, color', () => {
		const template = rule({
			priority: null,
			initialStatus: 'waiting',
			projectId: 'house0000000001',
			tagIds: ['tag000000000001'],
			color: 'blau'
		});
		const [first] = plannedOccurrences([template], [], TODAY, OCTOBER.from, OCTOBER.to);
		expect(first).toMatchObject({
			ruleId: 'rule00000000001',
			title: 'Müll rausbringen',
			priority: 'medium',
			status: 'waiting',
			projectId: 'house0000000001',
			tagIds: ['tag000000000001'],
			color: 'blau'
		});
	});

	it('orders by date and title, stops after PLANNED_PER_RULE_MAX dates and ignores an empty range', () => {
		const daily = rule({ id: 'rule00000000002', title: 'Blumen', freq: 'daily', weekdays: [] });
		const list = plannedOccurrences([rule(), daily], [], TODAY, OCTOBER.from, OCTOBER.to);
		expect(list.slice(0, 4).map((entry) => `${entry.date} ${entry.title}`)).toEqual([
			'2026-10-05 Blumen',
			'2026-10-05 Müll rausbringen',
			'2026-10-06 Blumen',
			'2026-10-07 Blumen'
		]);
		expect(
			plannedOccurrences([{ ...daily, nextDue: TODAY }], [], TODAY, TODAY, '2028-12-31')
		).toHaveLength(PLANNED_PER_RULE_MAX);
		expect(plannedOccurrences([rule()], [], TODAY, OCTOBER.to, OCTOBER.from)).toEqual([]);
	});
});

describe('when the ticket of a planned date appears', () => {
	it('says the day, "in Kürze" or which open ticket it waits for', () => {
		const date = (appears: string, blockedBy: string[] = []) => ({ appears, blockedBy });
		expect(plannedAppearsText(date('2026-10-09'), TODAY)).toBe('erscheint am 09.10.');
		expect(plannedAppearsText(date(TODAY), TODAY)).toBe('erscheint in Kürze');
		expect(plannedAppearsText(date('2026-09-30'), TODAY)).toBe('erscheint in Kürze');
		expect(plannedAppearsText(date('2026-10-09', ['HAUS-12']), TODAY)).toBe(
			'erscheint am 09.10. (sobald HAUS-12 erledigt ist)'
		);
		expect(plannedAppearsText(date(TODAY, ['HAUS-12', 'HAUS-14']), TODAY)).toBe(
			'erscheint, sobald HAUS-12 und HAUS-14 erledigt sind'
		);
		expect(plannedAppearsText(date('2027-01-08'), TODAY)).toBe('erscheint am 08.01.2027');
	});
});

describe('a month with 2 000 open tickets and 50 rules', () => {
	it('computes its days in a few milliseconds and keeps only the period', () => {
		const two = (value: number) => String(value).padStart(2, '0');
		const open: TicketSummary[] = [];
		for (let index = 0; index < 2000; index += 1) {
			const ticket = instance(null, `rule${String(index % 50).padStart(11, '0')}`);
			// Due dates spread over the year; every fifth ticket without one.
			const due = index % 5 === 0 ? null : `2026-${two((index % 12) + 1)}-${two((index % 28) + 1)}`;
			open.push({ ...ticket, due, recurring: index % 3 === 0 });
		}
		const rules = Array.from({ length: 50 }, (_, index) =>
			rule({
				id: `rule${String(index).padStart(11, '0')}`,
				title: `Regel ${index}`,
				freq: index % 2 === 0 ? 'daily' : 'weekly',
				weekdays: index % 2 === 0 ? [] : ['MO', 'TH'],
				nextDue: TODAY
			})
		);
		const started = performance.now();
		const planned = plannedOccurrences(rules, open, TODAY, OCTOBER.from, OCTOBER.to);
		const days = entriesByDay(
			OCTOBER,
			{ open, done: [], planned, inbox: [] },
			{
				query: EMPTY_LIST_QUERY,
				layers: new Set(DEFAULT_LAYERS),
				today: TODAY,
				subProjectsOf: () => []
			}
		);
		const elapsed = performance.now() - started;
		// Generous for slow runners; measured locally 3 to 7 ms for a month (plan kalender §6).
		expect(elapsed).toBeLessThan(1000);
		expect([...days.keys()].every((date) => date >= OCTOBER.from && date <= OCTOBER.to)).toBe(true);
		const tickets = [...days.values()].flat().filter((entry) => entry.kind === 'ticket');
		expect(tickets.length).toBeLessThan(open.length);
		expect(planned.length).toBeGreaterThan(500);
	});
});
