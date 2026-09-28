// List state in the URL (E3 plan, T-2 and package 1; ADR-0013 section 4).

import { describe, expect, it } from 'vitest';
import {
	activeSearch,
	SEARCH_MIN_LENGTH,
	EMPTY_LIST_QUERY,
	FILTER_KEYS,
	NO_PROJECT,
	SEARCH_MAX_LENGTH,
	hasFilters,
	parseListQuery,
	resetFilters,
	secondLevel,
	serializeListQuery,
	withFilter,
	type ListQuery
} from './list-query';
import { PRIORITIES, STATUSES } from './status';

const PROJECT_ID = 'p0000000000abcd';
const TAG_ID = 't0000000000abcd';

const parse = (search: string) => parseListQuery(new URLSearchParams(search));
const query = (overrides: Partial<ListQuery>): ListQuery => ({ ...EMPTY_LIST_QUERY, ...overrides });
/** URL → query → URL. */
const normalize = (search: string) =>
	serializeListQuery(parse(search), new URLSearchParams(search));

describe('parseListQuery', () => {
	it('gives the empty query without parameters', () => {
		expect(parse('')).toEqual(EMPTY_LIST_QUERY);
	});

	it.each(STATUSES)('reads status=%s', (status) => {
		expect(parse(`status=${status}`)).toEqual(query({ status }));
	});

	it.each(PRIORITIES)('reads prio=%s', (priority) => {
		expect(parse(`prio=${priority}`)).toEqual(query({ priority }));
	});

	it.each([
		['ueberfaellig', 'overdue'],
		['heute', 'today'],
		['bald', 'soon'],
		['ohne', 'none']
	] as const)('reads faellig=%s as %s', (value, due) => {
		expect(parse(`faellig=${value}`)).toEqual(query({ due }));
	});

	it('reads a project ID, "ohne" and a tag ID', () => {
		expect(parse(`projekt=${PROJECT_ID}`)).toEqual(query({ project: PROJECT_ID }));
		expect(parse('projekt=ohne')).toEqual(query({ project: NO_PROJECT }));
		expect(parse(`tag=${TAG_ID}`)).toEqual(query({ tag: TAG_ID }));
	});

	it('reads the search text trimmed', () => {
		expect(parse('q=%20Rechnung%20Mai%20')).toEqual(query({ search: 'Rechnung Mai' }));
		expect(parse(`q=${'x'.repeat(SEARCH_MAX_LENGTH)}`).search).toHaveLength(SEARCH_MAX_LENGTH);
	});

	it.each([
		['key', 'key'],
		['prio', 'priority'],
		['status', 'status'],
		['titel', 'title'],
		['projekt', 'project'],
		['faellig', 'due'],
		['erstellt', 'created']
	] as const)('reads sort=%s in both directions', (value, key) => {
		expect(parse(`sort=${value}`)).toEqual(query({ sort: { key, reversed: false } }));
		expect(parse(`sort=-${value}`)).toEqual(query({ sort: { key, reversed: true } }));
	});

	it.each([
		['status', 'status'],
		['prio', 'priority'],
		['projekt', 'project'],
		['faellig', 'due']
	] as const)('reads gruppe=%s', (value, grouping) => {
		expect(parse(`gruppe=${value}`)).toEqual(query({ grouping }));
	});

	it('reads the switch "Erledigte anzeigen" only as 1', () => {
		expect(parse('erledigte=1').showDone).toBe(true);
		expect(parse('erledigte=0').showDone).toBe(false);
		expect(parse('erledigte=true').showDone).toBe(false);
	});

	it('combines every group', () => {
		expect(
			parse(
				`status=waiting&prio=high&faellig=bald&quelle=chat&projekt=${PROJECT_ID}&tag=${TAG_ID}` +
					'&q=Auto&sort=-faellig&gruppe=projekt&erledigte=1&unterprojekte=0'
			)
		).toEqual({
			status: 'waiting',
			priority: 'high',
			due: 'soon',
			source: 'chat',
			recurring: null,
			project: PROJECT_ID,
			subProjects: false,
			tag: TAG_ID,
			search: 'Auto',
			sort: { key: 'due', reversed: true },
			grouping: 'project',
			subGrouping: null,
			showDone: true
		});
	});

	it.each([
		['status=foo', 'status'],
		['status=Open', 'status'],
		['status=', 'status'],
		['status=open&status=done', 'status'],
		['prio=wichtig', 'priority'],
		['prio=urgent&prio=urgent', 'priority'],
		['faellig=overdue', 'due'],
		['faellig=morgen', 'due'],
		['projekt=abc', 'project'],
		['projekt=P0000000000ABCD', 'project'],
		["projekt=p000000000'abcd", 'project'],
		['projekt=', 'project'],
		['tag=ohne', 'tag'],
		['tag=t0000000000abcde', 'tag'],
		['q=', 'search'],
		['q=%20%20', 'search'],
		[`q=${'x'.repeat(SEARCH_MAX_LENGTH + 1)}`, 'search'],
		['q=a&q=b', 'search'],
		['sort=tags', 'sort'],
		['sort=--key', 'sort'],
		['sort=-', 'sort'],
		['sort=+key', 'sort'],
		['gruppe=tag', 'grouping'],
		['gruppe=keine', 'grouping']
	] as const)('treats %s as not set', (search, key) => {
		expect(parse(search)[key]).toBeNull();
	});

	it('keeps valid groups when others are invalid', () => {
		expect(parse('status=foo&prio=low&sort=bar&gruppe=status')).toEqual(
			query({ priority: 'low', grouping: 'status' })
		);
	});

	it('ignores doubled switches', () => {
		expect(parse('erledigte=1&erledigte=1').showDone).toBe(false);
	});
});

describe('serializeListQuery', () => {
	it('writes nothing for the empty query', () => {
		expect(serializeListQuery(EMPTY_LIST_QUERY)).toBe('');
	});

	it('writes the parameters in a fixed order', () => {
		const full: ListQuery = {
			showDone: true,
			subGrouping: 'priority',
			grouping: 'due',
			sort: { key: 'created', reversed: false },
			search: 'Öl wechseln',
			tag: TAG_ID,
			subProjects: true,
			project: NO_PROJECT,
			recurring: 'once',
			source: 'calendar',
			due: 'overdue',
			priority: 'urgent',
			status: 'backlog'
		};
		expect(serializeListQuery(full)).toBe(
			'?status=backlog&prio=urgent&faellig=ueberfaellig&quelle=kalender&wiederholung=einmalig' +
				`&projekt=ohne&tag=${TAG_ID}&q=%C3%96l+wechseln&sort=erstellt&gruppe=faellig` +
				'&untergruppe=prio&erledigte=1'
		);
		expect(serializeListQuery({ ...full, project: PROJECT_ID, subProjects: false })).toBe(
			'?status=backlog&prio=urgent&faellig=ueberfaellig&quelle=kalender&wiederholung=einmalig' +
				`&projekt=${PROJECT_ID}&unterprojekte=0&tag=${TAG_ID}&q=%C3%96l+wechseln&sort=erstellt` +
				'&gruppe=faellig&untergruppe=prio&erledigte=1'
		);
	});

	it('reads and writes "unterprojekte=0" only with a project (ADR-0034)', () => {
		expect(parse(`projekt=${PROJECT_ID}`).subProjects).toBe(true);
		expect(parse(`projekt=${PROJECT_ID}&unterprojekte=0`).subProjects).toBe(false);
		expect(parse(`projekt=${PROJECT_ID}&unterprojekte=1`).subProjects).toBe(true);
		expect(parse(`projekt=${PROJECT_ID}&unterprojekte=0&unterprojekte=0`).subProjects).toBe(true);
		expect(normalize(`unterprojekte=0&projekt=${PROJECT_ID}`)).toBe(
			`?projekt=${PROJECT_ID}&unterprojekte=0`
		);
		// Without a project or with "Ohne Projekt" the switch means nothing and is left out.
		expect(normalize('unterprojekte=0')).toBe('');
		expect(normalize('projekt=ohne&unterprojekte=0')).toBe('?projekt=ohne');
		expect(serializeListQuery(query({ subProjects: false }))).toBe('');
	});

	it('gives the same URL for the same filters in any input order', () => {
		expect(normalize(`gruppe=status&prio=low&status=open`)).toBe(
			normalize(`status=open&prio=low&gruppe=status`)
		);
		expect(normalize('erledigte=1&sort=-titel')).toBe('?sort=-titel&erledigte=1');
	});

	it('writes the reversed sort with a minus sign', () => {
		expect(serializeListQuery(query({ sort: { key: 'priority', reversed: true } }))).toBe(
			'?sort=-prio'
		);
	});

	it('trims the search and leaves out an empty or too long one', () => {
		expect(serializeListQuery(query({ search: '  Miete ' }))).toBe('?q=Miete');
		expect(serializeListQuery(query({ search: '   ' }))).toBe('');
		expect(serializeListQuery(query({ search: 'x'.repeat(SEARCH_MAX_LENGTH + 1) }))).toBe('');
	});

	it('keeps unknown parameters in their order and replaces the known ones', () => {
		const base = new URLSearchParams('x=2&status=open&archiviert=1&x=3&q=alt');
		expect(serializeListQuery(query({ priority: 'high' }), base)).toBe(
			'?x=2&archiviert=1&x=3&prio=high'
		);
	});

	it('drops invalid list parameters of the base', () => {
		expect(normalize('status=foo&x=1&sort=bar')).toBe('?x=1');
		expect(normalize('status=open&status=done')).toBe('');
	});

	it.each([
		'',
		'status=in_progress',
		'prio=medium&faellig=heute',
		`projekt=${PROJECT_ID}&tag=${TAG_ID}`,
		'faellig=ohne&projekt=ohne',
		'q=Rechnung+%26+Mahnung',
		'q=100%25',
		'sort=-key&gruppe=prio',
		'erledigte=1',
		'quelle=manuell',
		'faellig=heute&quelle=chat&gruppe=quelle',
		`status=done&prio=low&faellig=bald&quelle=mail&projekt=${PROJECT_ID}&tag=${TAG_ID}&q=a%2Bb&sort=faellig&gruppe=status&erledigte=1`
	])('round trip of "%s" is stable', (search) => {
		const once = normalize(search);
		expect(once).toBe(search === '' ? '' : `?${search}`);
		expect(normalize(once.slice(1))).toBe(once);
		expect(parse(once.slice(1))).toEqual(parse(search));
	});
});

describe('withFilter, resetFilters, hasFilters', () => {
	const full: ListQuery = {
		status: 'open',
		priority: 'high',
		due: 'today',
		source: 'link',
		recurring: 'recurring',
		project: PROJECT_ID,
		subProjects: false,
		tag: TAG_ID,
		search: 'Auto',
		sort: { key: 'title', reversed: false },
		grouping: 'priority',
		subGrouping: 'project',
		showDone: true
	};

	it('sets one filter and leaves the others', () => {
		expect(withFilter(EMPTY_LIST_QUERY, 'status', 'waiting')).toEqual(query({ status: 'waiting' }));
		expect(withFilter(full, 'due', null)).toEqual({ ...full, due: null });
		expect(withFilter(full, 'project', NO_PROJECT)).toEqual({ ...full, project: NO_PROJECT });
	});

	it('does not change the given query', () => {
		const before = { ...full };
		withFilter(full, 'priority', 'low');
		resetFilters(full);
		expect(full).toEqual(before);
	});

	it('resets filters and search, keeps sort, grouping and the switch', () => {
		expect(resetFilters(full)).toEqual(
			query({
				sort: { key: 'title', reversed: false },
				grouping: 'priority',
				subGrouping: 'project',
				showDone: true
			})
		);
	});

	it('knows whether a filter is set', () => {
		expect(hasFilters(EMPTY_LIST_QUERY)).toBe(false);
		expect(hasFilters(query({ sort: { key: 'key', reversed: true }, grouping: 'due' }))).toBe(
			false
		);
		expect(hasFilters(query({ showDone: true }))).toBe(false);
		for (const key of FILTER_KEYS) {
			expect(hasFilters({ ...EMPTY_LIST_QUERY, [key]: full[key] }), key).toBe(true);
		}
		expect(hasFilters(resetFilters(full))).toBe(false);
	});
});

describe('activeSearch (E3 plan, package 11)', () => {
	it('applies a search from two characters on, a shorter one narrows nothing', () => {
		expect(SEARCH_MIN_LENGTH).toBe(2);
		expect(activeSearch({ search: null })).toBeNull();
		expect(activeSearch({ search: 'M' })).toBeNull();
		expect(activeSearch({ search: 'Mi' })).toBe('Mi');
		expect(activeSearch(parseListQuery(new URLSearchParams('q=%20Miete%20')))).toBe('Miete');
	});
});

describe('list query: source (E4 plan, package 9; ADR-0019)', () => {
	const read = (search: string) => parseListQuery(new URLSearchParams(search));

	it('reads the families of the URL and ignores unknown, empty or repeated values', () => {
		expect(read('quelle=manuell').source).toBe('manual');
		expect(read('quelle=link').source).toBe('link');
		expect(read('quelle=mail').source).toBe('mail');
		expect(read('quelle=kalender').source).toBe('calendar');
		expect(read('quelle=chat').source).toBe('chat');
		expect(read('quelle=notion').source).toBe('notion');
		expect(read('quelle=eml').source).toBeNull();
		expect(read('quelle=').source).toBeNull();
		expect(read('quelle=mail&quelle=chat').source).toBeNull();
		expect(read('gruppe=quelle').grouping).toBe('source');
	});

	it('keeps old addresses without quelle unchanged', () => {
		const old = 'status=open&prio=high&faellig=bald&gruppe=projekt';
		expect(read(old)).toEqual({ ...read(old), source: null });
		expect(serializeListQuery(read(old))).toBe(`?${old}`);
	});

	it('counts the source as a filter that "Zurücksetzen" clears', () => {
		const withSource = {
			...EMPTY_LIST_QUERY,
			source: 'mail' as const,
			grouping: 'source' as const
		};
		expect(hasFilters(withSource)).toBe(true);
		expect(resetFilters(withSource)).toEqual({ ...EMPTY_LIST_QUERY, grouping: 'source' });
	});
});

describe('list query: recurring (plan OR-2)', () => {
	const read = (search: string) => parseListQuery(new URLSearchParams(search));

	it('reads "wiederholung" and ignores unknown, empty or repeated values', () => {
		expect(read('wiederholung=wiederkehrend').recurring).toBe('recurring');
		expect(read('wiederholung=einmalig').recurring).toBe('once');
		expect(read('wiederholung=ja').recurring).toBeNull();
		expect(read('wiederholung=').recurring).toBeNull();
		expect(read('wiederholung=einmalig&wiederholung=einmalig').recurring).toBeNull();
		expect(read('gruppe=wiederholung').grouping).toBe('recurrence');
	});

	it('writes the filter after the source and before the project', () => {
		expect(
			serializeListQuery(
				query({
					source: 'mail',
					recurring: 'recurring',
					project: NO_PROJECT,
					grouping: 'recurrence'
				})
			)
		).toBe('?quelle=mail&wiederholung=wiederkehrend&projekt=ohne&gruppe=wiederholung');
		expect(normalize('gruppe=wiederholung&wiederholung=einmalig')).toBe(
			'?wiederholung=einmalig&gruppe=wiederholung'
		);
	});

	it('counts as a filter that "Zurücksetzen" clears; the grouping stays', () => {
		const recurring = query({ recurring: 'once', grouping: 'recurrence' });
		expect(hasFilters(recurring)).toBe(true);
		expect(resetFilters(recurring)).toEqual(query({ grouping: 'recurrence' }));
	});
});

describe('list query: two levels of grouping (plan OR-3)', () => {
	const read = (search: string) => parseListQuery(new URLSearchParams(search));

	it('reads "untergruppe" only below "gruppe" and never the same as it', () => {
		expect(read('gruppe=projekt&untergruppe=status')).toMatchObject({
			grouping: 'project',
			subGrouping: 'status'
		});
		expect(read('gruppe=faellig&untergruppe=prio').subGrouping).toBe('priority');
		expect(read('gruppe=faellig&untergruppe=wiederholung').subGrouping).toBe('recurrence');
		expect(read('untergruppe=status').subGrouping).toBeNull();
		expect(read('gruppe=status&untergruppe=status').subGrouping).toBeNull();
		expect(read('gruppe=status&untergruppe=tag').subGrouping).toBeNull();
		expect(read('gruppe=status&untergruppe=prio&untergruppe=prio').subGrouping).toBeNull();
		expect(read('gruppe=tag&untergruppe=prio')).toMatchObject({
			grouping: null,
			subGrouping: null
		});
	});

	it('writes "untergruppe" right after "gruppe", and only where it applies', () => {
		expect(serializeListQuery(query({ grouping: 'project', subGrouping: 'status' }))).toBe(
			'?gruppe=projekt&untergruppe=status'
		);
		expect(serializeListQuery(query({ subGrouping: 'status' }))).toBe('');
		expect(serializeListQuery(query({ grouping: 'status', subGrouping: 'status' }))).toBe(
			'?gruppe=status'
		);
		expect(normalize('untergruppe=prio&erledigte=1&gruppe=faellig')).toBe(
			'?gruppe=faellig&untergruppe=prio&erledigte=1'
		);
		expect(normalize('untergruppe=prio')).toBe('');
	});

	it('knows the second level as it applies', () => {
		expect(secondLevel('project', 'status')).toBe('status');
		expect(secondLevel('project', 'project')).toBeNull();
		expect(secondLevel(null, 'status')).toBeNull();
		expect(secondLevel('due', null)).toBeNull();
	});

	it('keeps both levels on "Zurücksetzen" and counts them as no filter', () => {
		const grouped = query({ grouping: 'due', subGrouping: 'priority', priority: 'high' });
		expect(resetFilters(grouped)).toEqual(query({ grouping: 'due', subGrouping: 'priority' }));
		expect(hasFilters(query({ grouping: 'due', subGrouping: 'priority' }))).toBe(false);
	});
});
