// "Aufgaben" in the phone frame (MO-3, ADR-0073 addendum MO-3): the number on the button "Filter"
// and the sort chosen in the filter sheet, where the cards have no column headers to click.

import { describe, expect, it } from 'vitest';
import { EMPTY_LIST_QUERY, activeFilterCount, parseListQuery, type ListQuery } from './list-query';
import { chooseSortKey, nextSort } from './ordering';

const query = (overrides: Partial<ListQuery>): ListQuery => ({ ...EMPTY_LIST_QUERY, ...overrides });

describe('activeFilterCount (MO-3)', () => {
	it('is 0 without cards and filters', () => {
		expect(activeFilterCount(EMPTY_LIST_QUERY)).toBe(0);
	});

	it('counts every chosen card and every detail filter', () => {
		expect(activeFilterCount(query({ cards: ['in_progress', 'urgent'] }))).toBe(2);
		expect(
			activeFilterCount(
				parseListQuery(
					new URLSearchParams(
						'karte=heute&status=open&prio=high&faellig=bald&quelle=mail&wiederholung=einmalig&art=vorhaben&projekt=ohne&tag=t0000000000abcd&zustaendig=niemand'
					)
				)
			)
		).toBe(10);
	});

	it('leaves out the search, the sort and the grouping', () => {
		expect(
			activeFilterCount(
				query({
					search: 'Fenster',
					sort: { key: 'priority', reversed: true },
					grouping: 'project',
					subGrouping: 'status'
				})
			)
		).toBe(0);
		expect(activeFilterCount(query({ search: 'Fenster', priority: 'urgent' }))).toBe(1);
	});

	it('counts a project without its sub projects as one filter', () => {
		expect(activeFilterCount(query({ project: 'p0000000000abcd', subProjects: false }))).toBe(1);
	});
});

describe('chooseSortKey (MO-3)', () => {
	it('goes back to the default order without a column', () => {
		expect(chooseSortKey({ key: 'due', reversed: true }, null)).toBeNull();
		expect(chooseSortKey(null, null)).toBeNull();
	});

	it('starts another column in its natural direction, like a first click on its header', () => {
		expect(chooseSortKey(null, 'priority')).toEqual({ key: 'priority', reversed: false });
		expect(chooseSortKey({ key: 'due', reversed: true }, 'priority')).toEqual(
			nextSort({ key: 'due', reversed: true }, 'priority')
		);
	});

	it('keeps the direction of the column already sorted', () => {
		const spec = { key: 'due' as const, reversed: true };
		expect(chooseSortKey(spec, 'due')).toBe(spec);
	});
});
