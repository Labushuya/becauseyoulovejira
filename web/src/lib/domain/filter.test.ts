// Filter of the ticket list (E3 plan, T-6 and package 1).

import { describe, expect, it } from 'vitest';
import { addDays } from './berlin-date';
import { dueBucket, matchesFilter, type DueBucket, type FilterableTicket } from './filter';
import { DUE_FILTERS, EMPTY_LIST_QUERY, NO_PROJECT, type ListQuery } from './list-query';
import { SOON_DAYS } from './ordering';
import { PRIORITIES, STATUSES } from './status';

const TODAY = '2026-09-25';
const HOUSE = { id: 'p00000000000001', name: 'Haus', code: 'HAUS', archived: false };
const CAR = { id: 'p00000000000002', name: 'Auto', code: 'AUTO', archived: true };
const SHOP = { id: 't00000000000001', name: 'Einkauf' };
const CALL = { id: 't00000000000002', name: 'Anruf' };

function ticket(overrides: Partial<FilterableTicket> = {}): FilterableTicket {
	return {
		status: 'open',
		priority: 'medium',
		due: null,
		projectId: null,
		tagIds: [],
		source: null,
		recurring: false,
		...overrides
	};
}

const query = (overrides: Partial<ListQuery>): ListQuery => ({ ...EMPTY_LIST_QUERY, ...overrides });

describe('dueBucket', () => {
	it.each<[string | null, DueBucket]>([
		[null, 'none'],
		['2025-12-31', 'overdue'],
		[addDays(TODAY, -1), 'overdue'],
		[TODAY, 'today'],
		[addDays(TODAY, 1), 'soon'],
		[addDays(TODAY, SOON_DAYS), 'soon'],
		[addDays(TODAY, SOON_DAYS + 1), 'later'],
		['2027-06-01', 'later']
	])('%s is %s', (due, bucket) => {
		expect(dueBucket(due, TODAY)).toBe(bucket);
	});

	it('counts the soon days across the turn of the year', () => {
		expect(dueBucket('2027-01-03', '2026-12-27')).toBe('soon');
		expect(dueBucket('2027-01-04', '2026-12-27')).toBe('later');
		expect(dueBucket('2026-12-31', '2027-01-01')).toBe('overdue');
	});
});

describe('matchesFilter', () => {
	it('lets every ticket pass without filters, including done ones', () => {
		for (const status of STATUSES) {
			expect(matchesFilter(ticket({ status }), EMPTY_LIST_QUERY, TODAY)).toBe(true);
		}
	});

	it.each(STATUSES)('status %s matches only that status', (status) => {
		for (const other of STATUSES) {
			expect(matchesFilter(ticket({ status: other }), query({ status }), TODAY)).toBe(
				other === status
			);
		}
	});

	it.each(PRIORITIES)('priority %s matches only that priority', (priority) => {
		for (const other of PRIORITIES) {
			expect(matchesFilter(ticket({ priority: other }), query({ priority }), TODAY)).toBe(
				other === priority
			);
		}
	});

	describe('due', () => {
		const cases: [string | null, Record<(typeof DUE_FILTERS)[number], boolean>][] = [
			[addDays(TODAY, -30), { overdue: true, today: false, soon: false, none: false }],
			[addDays(TODAY, -1), { overdue: true, today: false, soon: false, none: false }],
			[TODAY, { overdue: false, today: true, soon: false, none: false }],
			[addDays(TODAY, 1), { overdue: false, today: false, soon: true, none: false }],
			[addDays(TODAY, 7), { overdue: false, today: false, soon: true, none: false }],
			[addDays(TODAY, 8), { overdue: false, today: false, soon: false, none: false }],
			[null, { overdue: false, today: false, soon: false, none: true }]
		];

		it.each(cases)('%s', (due, expected) => {
			for (const filter of DUE_FILTERS) {
				expect(matchesFilter(ticket({ due }), query({ due: filter }), TODAY), filter).toBe(
					expected[filter]
				);
			}
		});

		it('never counts a done ticket as overdue', () => {
			const done = ticket({ status: 'done', due: addDays(TODAY, -3) });
			expect(matchesFilter(done, query({ due: 'overdue' }), TODAY)).toBe(false);
			expect(
				matchesFilter(
					ticket({ status: 'waiting', due: addDays(TODAY, -3) }),
					query({ due: 'overdue' }),
					TODAY
				)
			).toBe(true);
		});

		it('keeps today, soon and without date for done tickets', () => {
			const done = (due: string | null) => ticket({ status: 'done', due });
			expect(matchesFilter(done(TODAY), query({ due: 'today' }), TODAY)).toBe(true);
			expect(matchesFilter(done(addDays(TODAY, 2)), query({ due: 'soon' }), TODAY)).toBe(true);
			expect(matchesFilter(done(null), query({ due: 'none' }), TODAY)).toBe(true);
		});

		it('follows the Berlin date', () => {
			const due = ticket({ due: '2026-09-25' });
			expect(matchesFilter(due, query({ due: 'today' }), '2026-09-25')).toBe(true);
			expect(matchesFilter(due, query({ due: 'overdue' }), '2026-09-26')).toBe(true);
			expect(matchesFilter(due, query({ due: 'soon' }), '2026-09-24')).toBe(true);
		});
	});

	it('filters by project, without project and by an unknown project', () => {
		const inHouse = ticket({ projectId: HOUSE.id });
		const inCar = ticket({ projectId: CAR.id });
		const without = ticket();

		expect(matchesFilter(inHouse, query({ project: HOUSE.id }), TODAY)).toBe(true);
		expect(matchesFilter(inCar, query({ project: HOUSE.id }), TODAY)).toBe(false);
		expect(matchesFilter(without, query({ project: HOUSE.id }), TODAY)).toBe(false);
		expect(matchesFilter(inCar, query({ project: CAR.id }), TODAY)).toBe(true);
		expect(matchesFilter(without, query({ project: NO_PROJECT }), TODAY)).toBe(true);
		expect(matchesFilter(inHouse, query({ project: NO_PROJECT }), TODAY)).toBe(false);
		for (const candidate of [inHouse, inCar, without]) {
			expect(matchesFilter(candidate, query({ project: 'unknown00000000' }), TODAY)).toBe(false);
		}
	});

	it('takes the sub projects of a project in unless they are switched off (ADR-0034)', () => {
		const GARDEN_ID = 'p00000000000011';
		const subProjectsOf = (id: string) => (id === HOUSE.id ? [GARDEN_ID] : []);
		const inGarden = ticket({ projectId: GARDEN_ID });
		const inHouse = ticket({ projectId: HOUSE.id });
		const inCar = ticket({ projectId: CAR.id });

		const house = query({ project: HOUSE.id });
		expect(matchesFilter(inGarden, house, TODAY, subProjectsOf)).toBe(true);
		expect(matchesFilter(inHouse, house, TODAY, subProjectsOf)).toBe(true);
		expect(matchesFilter(inCar, house, TODAY, subProjectsOf)).toBe(false);
		// Without the catalog nothing is a sub project; with "unterprojekte=0" only the project.
		expect(matchesFilter(inGarden, house, TODAY)).toBe(false);
		const only = query({ project: HOUSE.id, subProjects: false });
		expect(matchesFilter(inGarden, only, TODAY, subProjectsOf)).toBe(false);
		expect(matchesFilter(inHouse, only, TODAY, subProjectsOf)).toBe(true);
		// The sub project alone has no sub projects; "Ohne Projekt" stays without project.
		expect(matchesFilter(inGarden, query({ project: GARDEN_ID }), TODAY, subProjectsOf)).toBe(true);
		expect(matchesFilter(inHouse, query({ project: GARDEN_ID }), TODAY, subProjectsOf)).toBe(false);
		expect(matchesFilter(inGarden, query({ project: NO_PROJECT }), TODAY, subProjectsOf)).toBe(
			false
		);
	});

	it('filters by tag', () => {
		const both = ticket({ tagIds: [SHOP.id, CALL.id] });
		expect(matchesFilter(both, query({ tag: SHOP.id }), TODAY)).toBe(true);
		expect(matchesFilter(both, query({ tag: CALL.id }), TODAY)).toBe(true);
		expect(matchesFilter(ticket({ tagIds: [CALL.id] }), query({ tag: SHOP.id }), TODAY)).toBe(
			false
		);
		expect(matchesFilter(ticket(), query({ tag: SHOP.id }), TODAY)).toBe(false);
	});

	it('combines the groups with AND', () => {
		const filters = query({
			status: 'in_progress',
			priority: 'urgent',
			due: 'soon',
			project: HOUSE.id,
			tag: SHOP.id
		});
		const match = ticket({
			status: 'in_progress',
			priority: 'urgent',
			due: addDays(TODAY, 3),
			projectId: HOUSE.id,
			tagIds: [CALL.id, SHOP.id]
		});

		expect(matchesFilter(match, filters, TODAY)).toBe(true);
		const misses: Partial<FilterableTicket>[] = [
			{ status: 'open' },
			{ priority: 'high' },
			{ due: TODAY },
			{ projectId: CAR.id },
			{ tagIds: [CALL.id] }
		];
		for (const miss of misses) {
			expect(matchesFilter({ ...match, ...miss }, filters, TODAY), JSON.stringify(miss)).toBe(
				false
			);
		}
	});

	it('ignores search, sort, grouping and the switch', () => {
		const view = query({
			search: 'nichts davon',
			sort: { key: 'title', reversed: true },
			grouping: 'status',
			showDone: true
		});
		expect(matchesFilter(ticket(), view, TODAY)).toBe(true);
	});
});

describe('matchesFilter: source (E4 plan, package 9; ADR-0019 section 2)', () => {
	it.each([
		[null, 'manual'],
		['manual', 'manual'],
		['quick', 'manual'],
		['clipboard', 'manual'],
		['link', 'link'],
		['eml', 'mail'],
		['mail', 'mail'],
		['ics', 'calendar'],
		['calendar', 'calendar'],
		['whatsapp', 'chat'],
		['telegram', 'chat'],
		['notion', 'notion']
	] as const)('puts the source %s into the family %s only', (source, family) => {
		const entry = ticket({ source });
		for (const other of ['manual', 'link', 'mail', 'calendar', 'chat', 'notion'] as const) {
			expect(matchesFilter(entry, query({ source: other }), TODAY), other).toBe(other === family);
		}
		expect(matchesFilter(entry, query({ source: null }), TODAY)).toBe(true);
	});

	it('combines the source with the other filters', () => {
		const mail = ticket({ source: 'eml', priority: 'high' });
		expect(matchesFilter(mail, query({ source: 'mail', priority: 'high' }), TODAY)).toBe(true);
		expect(matchesFilter(mail, query({ source: 'mail', priority: 'low' }), TODAY)).toBe(false);
	});
});

describe('matchesFilter: recurring (plan OR-2)', () => {
	it('takes only tickets of a series or only single ones, both without the filter', () => {
		const series = ticket({ recurring: true });
		const single = ticket({ recurring: false });
		expect(matchesFilter(series, query({ recurring: 'recurring' }), TODAY)).toBe(true);
		expect(matchesFilter(single, query({ recurring: 'recurring' }), TODAY)).toBe(false);
		expect(matchesFilter(series, query({ recurring: 'once' }), TODAY)).toBe(false);
		expect(matchesFilter(single, query({ recurring: 'once' }), TODAY)).toBe(true);
		expect(matchesFilter(series, query({ recurring: null }), TODAY)).toBe(true);
		expect(matchesFilter(single, query({ recurring: null }), TODAY)).toBe(true);
	});

	it('combines with the other filters, also for done tickets', () => {
		const done = ticket({ recurring: true, status: 'done', priority: 'high' });
		expect(
			matchesFilter(
				done,
				query({ recurring: 'recurring', status: 'done', priority: 'high' }),
				TODAY
			)
		).toBe(true);
		expect(matchesFilter(done, query({ recurring: 'recurring', priority: 'low' }), TODAY)).toBe(
			false
		);
	});
});
