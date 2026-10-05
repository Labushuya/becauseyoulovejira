// Unit tests of the view "Erledigte" (ER-1, ADR-0066): the groups by the Berlin day of completion
// with their limits (Berlin midnight in summer and winter, the week from Monday, the change of the
// month and of the year), the order, the state of the address, the client form of the filter and
// the old addresses of "Aufgaben".

import { describe, expect, it } from 'vitest';
import {
	EMPTY_DONE_QUERY,
	activeDoneSearch,
	compareCompleted,
	completedDayOf,
	doneCountText,
	doneGroupKey,
	doneGroupLabel,
	doneQueryOf,
	doneTimeLabel,
	groupDone,
	hasDoneFilters,
	legacyDoneTarget,
	matchesDoneQuery,
	parseDoneQuery,
	resetDoneFilters,
	serializeDoneQuery,
	type DoneQuery
} from './done-view';
import { EMPTY_LIST_QUERY, NO_PROJECT, type ListQuery } from './list-query';
import type { TicketSummary } from './ticket';

const PROJECT = 'proj00000000001';
const GARDEN = 'proj00000000011';
const TAG = 'tag000000000001';

let sequence = 0;

function done(completedAt: string | null, overrides: Partial<TicketSummary> = {}): TicketSummary {
	sequence += 1;
	return {
		id: `t${String(sequence).padStart(14, '0')}`,
		key: `TASK-${sequence}`,
		title: `Ticket ${sequence}`,
		status: 'done',
		priority: 'medium',
		due: null,
		projectId: null,
		tagIds: [],
		project: null,
		tags: [],
		recurring: false,
		source: null,
		completedAt,
		created: '2026-09-01 10:00:00.000Z',
		updated: '2026-09-01 10:00:00.000Z',
		...overrides
	};
}

const query = (overrides: Partial<DoneQuery> = {}): DoneQuery => ({
	...EMPTY_DONE_QUERY,
	...overrides
});

describe('day of completion in Berlin', () => {
	it('changes at the Berlin midnight, in summer and in winter time', () => {
		// CEST (UTC+2): 22:00 UTC is midnight.
		expect(completedDayOf(done('2026-10-04 21:59:59.999Z'))).toBe('2026-10-04');
		expect(completedDayOf(done('2026-10-04 22:00:00.000Z'))).toBe('2026-10-05');
		// CET (UTC+1): 23:00 UTC is midnight, also across the change of the year.
		expect(completedDayOf(done('2026-12-31 22:59:59.000Z'))).toBe('2026-12-31');
		expect(completedDayOf(done('2026-12-31 23:00:00.000Z'))).toBe('2027-01-01');
		// The night the clocks go back (25 October 2026, 01:00 UTC).
		expect(completedDayOf(done('2026-10-24 22:30:00.000Z'))).toBe('2026-10-25');
	});

	it('falls back to the last change of a ticket without a time of completion', () => {
		expect(completedDayOf(done(null, { updated: '2026-10-05 08:00:00.000Z' }))).toBe('2026-10-05');
	});
});

describe('groups by the day of completion', () => {
	it('names today, yesterday, this week, this month and the months before', () => {
		// Wednesday, 7 October 2026: the week began on Monday the 5th.
		const today = '2026-10-07';
		expect(doneGroupKey('2026-10-07', today)).toBe('today');
		expect(doneGroupKey('2026-10-06', today)).toBe('yesterday');
		expect(doneGroupKey('2026-10-05', today)).toBe('week');
		expect(doneGroupKey('2026-10-04', today)).toBe('month');
		expect(doneGroupKey('2026-10-01', today)).toBe('month');
		expect(doneGroupKey('2026-09-30', today)).toBe('month:2026-09');
		expect(doneGroupKey('2025-12-31', today)).toBe('month:2025-12');
		// A later day only comes from a wrong clock; it counts as today.
		expect(doneGroupKey('2026-10-08', today)).toBe('today');
	});

	it('begins the week on Monday: on a Monday "Gestern" is the Sunday before', () => {
		const monday = '2026-10-05';
		expect(doneGroupKey('2026-10-05', monday)).toBe('today');
		expect(doneGroupKey('2026-10-04', monday)).toBe('yesterday');
		expect(doneGroupKey('2026-10-03', monday)).toBe('month');
		// Sunday: the week from the Monday before.
		expect(doneGroupKey('2026-10-05', '2026-10-11')).toBe('week');
		expect(doneGroupKey('2026-10-04', '2026-10-11')).toBe('month');
	});

	it('gives a week that began in the month before its days, the rest of that month its own group', () => {
		// Thursday, 1 October 2026: the week began on Monday, 28 September.
		const first = '2026-10-01';
		expect(doneGroupKey('2026-09-30', first)).toBe('yesterday');
		expect(doneGroupKey('2026-09-28', first)).toBe('week');
		expect(doneGroupKey('2026-09-27', first)).toBe('month:2026-09');
	});

	it('moves to the month before at the change of the month', () => {
		// Sunday, 1 November 2026.
		const first = '2026-11-01';
		expect(doneGroupKey('2026-10-31', first)).toBe('yesterday');
		expect(doneGroupKey('2026-10-26', first)).toBe('week');
		expect(doneGroupKey('2026-10-25', first)).toBe('month:2026-10');
		// Monday, 2 November: October is a month before, the 1st yesterday.
		expect(doneGroupKey('2026-11-01', '2026-11-02')).toBe('yesterday');
		expect(doneGroupKey('2026-10-31', '2026-11-02')).toBe('month:2026-10');
	});

	it('labels the groups in German', () => {
		expect(['today', 'yesterday', 'week', 'month'].map(doneGroupLabel)).toEqual([
			'Heute',
			'Gestern',
			'Diese Woche',
			'Diesen Monat'
		]);
		expect(doneGroupLabel('month:2026-09')).toBe('September 2026');
		expect(doneGroupLabel('month:2025-03')).toBe('März 2025');
	});

	it('orders the tickets newest first and the groups by their first ticket', () => {
		const today = '2026-10-07';
		const older = done('2026-08-15 10:00:00.000Z');
		const september = done('2026-09-02 10:00:00.000Z');
		const yesterday = done('2026-10-06 08:00:00.000Z');
		const morning = done('2026-10-07 06:00:00.000Z');
		const evening = done('2026-10-07 18:00:00.000Z');
		const groups = groupDone([older, morning, september, evening, yesterday], today);

		expect(groups.map((group) => group.label)).toEqual([
			'Heute',
			'Gestern',
			'September 2026',
			'August 2026'
		]);
		expect(groups[0]?.tickets).toEqual([evening, morning]);
		expect(groupDone([], today)).toEqual([]);
	});

	it('orders by completion, then creation, then ID, like the server', () => {
		const a = done('2026-10-05 10:00:00.000Z', { created: '2026-10-01 10:00:00.000Z' });
		const b = done('2026-10-05 10:00:00.000Z', { created: '2026-10-02 10:00:00.000Z' });
		const c = done('2026-10-06 10:00:00.000Z');
		expect([a, b, c].sort(compareCompleted)).toEqual([c, b, a]);
	});

	it('counts and times the entries', () => {
		expect(doneCountText(1)).toBe('1 erledigtes Ticket');
		expect(doneCountText(12)).toBe('12 erledigte Tickets');
		expect(doneCountText(0)).toBe('0 erledigte Tickets');
		// Today and yesterday the Berlin time of day, else the date.
		expect(doneTimeLabel('2026-10-07 12:05:00.000Z', '2026-10-07')).toBe('14:05');
		expect(doneTimeLabel('2026-10-05 22:30:00.000Z', '2026-10-07')).toBe('00:30');
		expect(doneTimeLabel('2026-10-05 12:00:00.000Z', '2026-10-07')).toBe('05.10.2026');
	});
});

describe('state of the address', () => {
	it('reads search, project with sub projects, tag and charm; ignores the rest', () => {
		expect(parseDoneQuery(new URLSearchParams(''))).toEqual(EMPTY_DONE_QUERY);
		expect(
			parseDoneQuery(
				new URLSearchParams(
					`q=Miete&projekt=${PROJECT}&unterprojekte=0&tag=${TAG}&charm=auto&prio=high&erledigte=1`
				)
			)
		).toEqual({
			search: 'Miete',
			project: PROJECT,
			subProjects: false,
			tag: TAG,
			charm: 'auto',
			assignee: null
		});
		// "Zuständig" (ADR-0068): an account or "niemand", like in "Aufgaben".
		expect(parseDoneQuery(new URLSearchParams('zustaendig=niemand')).assignee).toBe('niemand');
		expect(parseDoneQuery(new URLSearchParams(`zustaendig=${TAG}`)).assignee).toBe(TAG);
		expect(parseDoneQuery(new URLSearchParams('zustaendig=x')).assignee).toBeNull();
		expect(parseDoneQuery(new URLSearchParams('charm=unbekannt')).charm).toBeNull();
		expect(parseDoneQuery(new URLSearchParams('charm=auto&charm=zug')).charm).toBeNull();
		expect(parseDoneQuery(new URLSearchParams('projekt=ohne')).project).toBe(NO_PROJECT);
	});

	it('writes the state in a fixed order and stays stable', () => {
		const full = query({
			search: ' Miete ',
			project: PROJECT,
			subProjects: false,
			tag: TAG,
			charm: 'auto'
		});
		const written = serializeDoneQuery(full);
		expect(written).toBe(`?projekt=${PROJECT}&unterprojekte=0&tag=${TAG}&q=Miete&charm=auto`);
		expect(serializeDoneQuery(parseDoneQuery(new URLSearchParams(written.slice(1))))).toBe(written);
		expect(serializeDoneQuery(query({ assignee: 'niemand', tag: TAG }))).toBe(
			`?tag=${TAG}&zustaendig=niemand`
		);
		expect(serializeDoneQuery(EMPTY_DONE_QUERY)).toBe('');
		expect(serializeDoneQuery(query({ charm: 'kein-charm' }))).toBe('');
	});

	it('knows whether a filter is set, resets them and applies the search from two characters', () => {
		expect(hasDoneFilters(EMPTY_DONE_QUERY)).toBe(false);
		for (const set of [
			{ search: 'x' },
			{ project: PROJECT },
			{ tag: TAG },
			{ charm: 'auto' },
			{ assignee: 'niemand' }
		]) {
			expect(hasDoneFilters(query(set)), JSON.stringify(set)).toBe(true);
		}
		expect(resetDoneFilters()).toEqual(EMPTY_DONE_QUERY);
		expect(activeDoneSearch(query({ search: 'M' }))).toBeNull();
		expect(activeDoneSearch(query({ search: 'Mi' }))).toBe('Mi');
	});

	it('takes over the filters of "Aufgaben" both views know', () => {
		const list: ListQuery = {
			...EMPTY_LIST_QUERY,
			cards: ['urgent'],
			status: 'open',
			priority: 'high',
			project: PROJECT,
			subProjects: false,
			tag: TAG,
			assignee: 'niemand',
			search: 'Auto',
			sort: { key: 'title', reversed: false }
		};
		expect(doneQueryOf(list)).toEqual({
			search: 'Auto',
			project: PROJECT,
			subProjects: false,
			tag: TAG,
			charm: null,
			assignee: 'niemand'
		});
	});
});

describe('filter in the client', () => {
	const subProjectsOf = (id: string) => (id === PROJECT ? [GARDEN] : []);

	it('lets only done tickets pass', () => {
		expect(matchesDoneQuery(done('2026-10-05 10:00:00.000Z'), EMPTY_DONE_QUERY)).toBe(true);
		expect(
			matchesDoneQuery(done(null, { status: 'open', completedAt: null }), EMPTY_DONE_QUERY)
		).toBe(false);
	});

	it('checks project with its sub projects, "Ohne Projekt", tag and charm', () => {
		const inGarden = done('2026-10-05 10:00:00.000Z', { projectId: GARDEN });
		const loose = done('2026-10-05 10:00:00.000Z');
		expect(matchesDoneQuery(inGarden, query({ project: PROJECT }), subProjectsOf)).toBe(true);
		expect(
			matchesDoneQuery(inGarden, query({ project: PROJECT, subProjects: false }), subProjectsOf)
		).toBe(false);
		expect(matchesDoneQuery(loose, query({ project: NO_PROJECT }))).toBe(true);
		expect(matchesDoneQuery(inGarden, query({ project: NO_PROJECT }))).toBe(false);

		const tagged = done('2026-10-05 10:00:00.000Z', { tagIds: [TAG], charm: 'auto' });
		expect(matchesDoneQuery(tagged, query({ tag: TAG, charm: 'auto' }))).toBe(true);
		expect(matchesDoneQuery(loose, query({ tag: TAG }))).toBe(false);
		expect(matchesDoneQuery(tagged, query({ charm: 'zug' }))).toBe(false);
		// Before the migration of CH-1 the field is missing: no charm.
		expect(matchesDoneQuery(loose, query({ charm: 'auto' }))).toBe(false);
	});
});

describe('old addresses of "Aufgaben" (ADR-0066 §5)', () => {
	const target = (search: string) => legacyDoneTarget(new URLSearchParams(search));

	it('leads the switch without a status and the status "Erledigt" to "Erledigte"', () => {
		expect(target(`erledigte=1&projekt=${PROJECT}&prio=high&q=Miete`)).toEqual({
			kind: 'done',
			query: query({ project: PROJECT, search: 'Miete' })
		});
		expect(target(`status=done&tag=${TAG}`)).toEqual({ kind: 'done', query: query({ tag: TAG }) });
		expect(target('status=done&erledigte=1')).toEqual({ kind: 'done', query: EMPTY_DONE_QUERY });
	});

	it('only drops the switch where it asked for nothing done, and ignores other addresses', () => {
		expect(target('status=open&erledigte=1&sort=titel')).toEqual({
			kind: 'strip',
			search: '?status=open&sort=titel'
		});
		expect(target('erledigte=0')).toEqual({ kind: 'strip', search: '' });
		expect(target('erledigte=1&erledigte=1')).toEqual({ kind: 'strip', search: '' });
		expect(target('status=open&prio=high')).toBeNull();
		expect(target('')).toBeNull();
	});
});
