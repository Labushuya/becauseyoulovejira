// Numbers of the KPI tiles (E3 plan, T-10 and package 12).

import { describe, expect, it } from 'vitest';
import { addDays } from './berlin-date';
import { EMPTY_LIST_QUERY } from './list-query';
import { matchesFilter } from './filter';
import { countKpis, type CountableTicket } from './kpis';
import { STATUSES } from './status';

const TODAY = '2026-09-25';

function ticket(overrides: Partial<CountableTicket> = {}): CountableTicket {
	return { status: 'open', priority: 'medium', due: null, ...overrides };
}

describe('countKpis', () => {
	it('counts nothing without tickets', () => {
		expect(countKpis([], TODAY)).toEqual({
			notDone: 0,
			inProgress: 0,
			dueToday: 0,
			overdue: 0,
			urgent: 0
		});
	});

	it('never counts done tickets', () => {
		const done = ticket({ status: 'done', priority: 'urgent', due: addDays(TODAY, -3) });
		expect(countKpis([done, { ...done, due: TODAY }], TODAY)).toEqual({
			notDone: 0,
			inProgress: 0,
			dueToday: 0,
			overdue: 0,
			urgent: 0
		});
	});

	it('counts every status that is not done', () => {
		const tickets = STATUSES.map((status) => ticket({ status }));
		const kpis = countKpis(tickets, TODAY);
		expect(kpis.notDone).toBe(4);
		expect(kpis.inProgress).toBe(1);
	});

	it('draws the due boundaries at today and yesterday', () => {
		const kpis = countKpis(
			[
				ticket({ due: addDays(TODAY, -30) }),
				ticket({ due: addDays(TODAY, -1) }),
				ticket({ due: TODAY }),
				ticket({ due: TODAY, status: 'waiting' }),
				ticket({ due: addDays(TODAY, 1) }),
				ticket()
			],
			TODAY
		);
		expect(kpis).toMatchObject({ notDone: 6, overdue: 2, dueToday: 2 });
	});

	it('counts urgent tickets of every open status', () => {
		const kpis = countKpis(
			[
				ticket({ priority: 'urgent' }),
				ticket({ priority: 'urgent', status: 'backlog' }),
				ticket({ priority: 'high' })
			],
			TODAY
		);
		expect(kpis.urgent).toBe(2);
	});

	it('follows the Berlin date', () => {
		const due = [ticket({ due: '2026-09-25' })];
		expect(countKpis(due, '2026-09-25')).toMatchObject({ dueToday: 1, overdue: 0 });
		expect(countKpis(due, '2026-09-26')).toMatchObject({ dueToday: 0, overdue: 1 });
	});

	it('counts the same tickets the filter of each tile shows', () => {
		const tickets = [
			...STATUSES.flatMap((status) => [
				ticket({ status, due: addDays(TODAY, -2) }),
				ticket({ status, due: TODAY, priority: 'urgent' }),
				ticket({ status, due: addDays(TODAY, 3) })
			])
		].map((entry) => ({ ...entry, projectId: null, tagIds: [] }));
		const open = tickets.filter((entry) => entry.status !== 'done');
		const shown = (overrides: object) =>
			open.filter((entry) => matchesFilter(entry, { ...EMPTY_LIST_QUERY, ...overrides }, TODAY))
				.length;

		const kpis = countKpis(tickets, TODAY);
		expect(kpis.notDone).toBe(shown({}));
		expect(kpis.inProgress).toBe(shown({ status: 'in_progress' }));
		expect(kpis.dueToday).toBe(shown({ due: 'today' }));
		expect(kpis.overdue).toBe(shown({ due: 'overdue' }));
		expect(kpis.urgent).toBe(shown({ priority: 'urgent' }));
	});
});
