// Unit tests of the calendar (ADR-0053, plan kalender, K-1 and K-2): the state in the URL, what the
// device remembers, ISO weeks and periods, the keys of the grid, the labels, the entries of the days
// with the filters of "Aufgaben", the layers, the group "Überfällig" and "+N weitere", and which
// entries may move with which instructions.

import { describe, expect, it } from 'vitest';
import {
	AGENDA_DAYS,
	CALENDAR_MOVE_KEY,
	CALENDAR_PARAMS,
	DEFAULT_LAYERS,
	MONTH_DAY_LIMIT,
	SERIES_MOVE_HINT,
	calendarDateOf,
	calendarListQuery,
	dayCellLabel,
	daysInMonth,
	effectiveView,
	entriesByDay,
	entryCountText,
	fullDateLabel,
	gridMove,
	inPeriod,
	inboxMatches,
	isMovable,
	isoWeekOf,
	mondayOf,
	moreLabel,
	moveInstructions,
	overdueEntries,
	parseCalendarQuery,
	parseLayers,
	periodOf,
	periodTitle,
	plannedMatches,
	replaceCalendarQuery,
	serializeLayers,
	shiftPeriod,
	shortDayLabel,
	showsDone,
	showsOpen,
	sliceDay,
	viewOf,
	viewValue,
	weekLabel,
	type CalendarFilter,
	type CalendarLayer
} from './calendar';
import type { PlannedOccurrence } from './calendar-plan';
import type { InboxItemSummary } from './inbox';
import { EMPTY_LIST_QUERY, NO_PROJECT, parseListQuery, type ListQuery } from './list-query';
import type { Priority, Status } from './status';
import type { TicketSummary } from './ticket';

const TODAY = '2026-10-02';
const T0 = '2026-09-01 08:00:00.000Z';
const HOUSE = 'house0000000001';
const GARDEN = 'garden000000001';
const OFFICE = 'office000000001';
const TAG = 'tag000000000001';

let sequence = 0;

function ticket(
	due: string | null,
	{
		status = 'open' as Status,
		priority = 'medium' as Priority,
		project = HOUSE as string | null,
		tags = [] as string[],
		recurring = false,
		title = 'Ticket',
		created = T0
	} = {}
): TicketSummary {
	sequence += 1;
	const id = `t${String(sequence).padStart(14, '0')}`;
	return {
		id,
		key: `HAUS-${sequence}`,
		title,
		status,
		priority,
		due,
		projectId: project,
		tagIds: tags,
		project: null,
		tags: [],
		recurring,
		recurrenceId: recurring ? 'rule00000000001' : null,
		source: null,
		completedAt: status === 'done' ? T0 : null,
		created,
		updated: created
	};
}

function planned(date: string, overrides: Partial<PlannedOccurrence> = {}): PlannedOccurrence {
	return {
		ruleId: 'rule00000000001',
		title: 'Müll',
		date,
		appears: date,
		blockedBy: [],
		projectId: HOUSE,
		tagIds: [],
		priority: 'medium',
		status: 'open',
		color: null,
		...overrides
	};
}

function item(
	sourceDate: string | null,
	overrides: Partial<InboxItemSummary> = {}
): InboxItemSummary {
	sequence += 1;
	return {
		id: `i${String(sequence).padStart(14, '0')}`,
		channel: 'ics',
		kind: 'event',
		title: 'Zahnarzt',
		sourceUrl: '',
		sourceRef: '',
		sourceDate,
		sourceMeta: {},
		original: '',
		state: 'new',
		ticketId: null,
		handledAt: null,
		targetProjectId: null,
		created: T0,
		updated: T0,
		...overrides
	};
}

const SUB_PROJECTS = (projectId: string) => (projectId === HOUSE ? [GARDEN] : []);

function filter(
	query: Partial<ListQuery> = {},
	layers: readonly CalendarLayer[] = DEFAULT_LAYERS
): CalendarFilter {
	return {
		query: { ...EMPTY_LIST_QUERY, ...query },
		layers: new Set(layers),
		today: TODAY,
		subProjectsOf: SUB_PROJECTS
	};
}

const OCTOBER = periodOf('month', TODAY);

describe('state of the calendar in the URL', () => {
	it('reads view and day, and leaves out what it does not know', () => {
		const query = parseCalendarQuery(new URLSearchParams('ansicht=woche&datum=2026-10-05'));
		expect(query).toEqual({ view: 'week', date: '2026-10-05' });
		expect(parseCalendarQuery(new URLSearchParams('ansicht=jahr&datum=2026-02-30'))).toEqual({
			view: null,
			date: null
		});
		// Doubled parameters count as not set, like the list (ADR-0013 section 4).
		expect(parseCalendarQuery(new URLSearchParams('ansicht=monat&ansicht=woche')).view).toBeNull();
		expect(calendarDateOf('1899-12-31')).toBeNull();
		expect(calendarDateOf('3000-01-01')).toBeNull();
		expect(calendarDateOf('2999-12-31')).toBe('2999-12-31');
	});

	it('keeps the filters of the list next to view and day', () => {
		const params = new URLSearchParams('status=open&projekt=house0000000001&datum=2026-01-01');
		const search = replaceCalendarQuery(params, { view: 'agenda', date: '2026-10-05' });
		expect(search).toBe('?status=open&projekt=house0000000001&ansicht=agenda&datum=2026-10-05');
		expect(parseListQuery(new URLSearchParams(search)).project).toBe(HOUSE);
		const cleared = replaceCalendarQuery(new URLSearchParams('ansicht=woche'), {
			view: null,
			date: null
		});
		expect(cleared).toBe('');
		expect(CALENDAR_PARAMS).toEqual({ view: 'ansicht', date: 'datum' });
	});

	it('shows the view of the URL, else the remembered one, else the month (the agenda when narrow)', () => {
		expect(effectiveView('week', 'agenda', true)).toBe('week');
		expect(effectiveView(null, 'week', true)).toBe('week');
		expect(effectiveView(null, null, false)).toBe('month');
		expect(effectiveView(null, null, true)).toBe('agenda');
		expect(viewOf(viewValue('agenda'))).toBe('agenda');
		expect(viewOf('kalender')).toBeNull();
		expect(viewOf(null)).toBeNull();
	});
});

describe('layers this device remembers', () => {
	it('starts with open tickets, planned dates and the inbox, without done tickets', () => {
		expect([...parseLayers(null)]).toEqual(['open', 'planned', 'inbox']);
		expect(serializeLayers(new Set(DEFAULT_LAYERS))).toBeNull();
	});

	it('stores only a choice other than the default and reads it strictly', () => {
		const all = new Set<CalendarLayer>(['inbox', 'done', 'open', 'planned']);
		expect(serializeLayers(all)).toBe('offen,erledigt,geplant,eingang');
		expect([...parseLayers('offen,erledigt,geplant,eingang')]).toEqual([
			'open',
			'done',
			'planned',
			'inbox'
		]);
		expect(serializeLayers(new Set())).toBe('');
		expect(parseLayers('').size).toBe(0);
		expect([...parseLayers('erledigt,unbekannt')]).toEqual(['done']);
		// A value without a single known layer is broken: the default.
		expect([...parseLayers('xyz')]).toEqual(['open', 'planned', 'inbox']);
	});
});

describe('weeks, months and periods', () => {
	it('counts ISO weeks: the week of its Thursday, from the week of 4 January', () => {
		expect(isoWeekOf('2026-01-01')).toEqual({ year: 2026, week: 1 });
		expect(isoWeekOf('2025-12-29')).toEqual({ year: 2026, week: 1 });
		expect(isoWeekOf('2027-01-01')).toEqual({ year: 2026, week: 53 });
		expect(isoWeekOf('2021-01-03')).toEqual({ year: 2020, week: 53 });
		expect(isoWeekOf('2024-12-30')).toEqual({ year: 2025, week: 1 });
		expect(isoWeekOf('2026-10-05')).toEqual({ year: 2026, week: 41 });
		expect(mondayOf('2026-10-04')).toBe('2026-09-28');
		expect(mondayOf('2026-10-05')).toBe('2026-10-05');
	});

	it('shows a month in whole weeks from Monday to Sunday, four to six of them', () => {
		expect(OCTOBER.from).toBe('2026-09-28');
		expect(OCTOBER.to).toBe('2026-11-01');
		expect(OCTOBER.weeks.map((week) => week.week)).toEqual([40, 41, 42, 43, 44]);
		expect(OCTOBER.weeks[0]?.days).toHaveLength(7);
		expect(OCTOBER.month).toBe('2026-10');
		expect(periodOf('month', '2027-02-14').weeks).toHaveLength(4);
		expect(periodOf('month', '2026-08-20').weeks).toHaveLength(6);
		expect(daysInMonth(2028, 2)).toBe(29);
		expect(daysInMonth(2100, 2)).toBe(28);
	});

	it('shows one week and four weeks of agenda from their first day', () => {
		const week = periodOf('week', TODAY);
		expect([week.from, week.to]).toEqual(['2026-09-28', '2026-10-04']);
		expect(week.weeks).toHaveLength(1);
		const agenda = periodOf('agenda', TODAY);
		expect([agenda.from, agenda.to]).toEqual(['2026-10-02', '2026-10-29']);
		expect(AGENDA_DAYS).toBe(28);
		expect(agenda.weeks).toEqual([]);
		expect(inPeriod(agenda, '2026-10-29')).toBe(true);
		expect(inPeriod(agenda, '2026-10-30')).toBe(false);
	});

	it('moves by a month (the day clamped), a week or four weeks', () => {
		expect(shiftPeriod('month', '2026-01-31', 1)).toBe('2026-02-28');
		expect(shiftPeriod('month', '2028-01-31', 1)).toBe('2028-02-29');
		expect(shiftPeriod('month', '2026-12-15', 1)).toBe('2027-01-15');
		expect(shiftPeriod('month', '2026-01-15', -1)).toBe('2025-12-15');
		expect(shiftPeriod('week', TODAY, -1)).toBe('2026-09-25');
		expect(shiftPeriod('agenda', TODAY, 1)).toBe('2026-10-30');
	});
});

describe('keys of the grid', () => {
	it('moves by a day, a week, to the ends of week and month, and by a period', () => {
		const day = '2026-10-14';
		expect(gridMove('month', day, 'ArrowLeft')).toBe('2026-10-13');
		expect(gridMove('month', day, 'ArrowRight')).toBe('2026-10-15');
		expect(gridMove('month', day, 'ArrowUp')).toBe('2026-10-07');
		expect(gridMove('month', day, 'ArrowDown')).toBe('2026-10-21');
		expect(gridMove('month', day, 'Home')).toBe('2026-10-12');
		expect(gridMove('month', day, 'End')).toBe('2026-10-18');
		expect(gridMove('month', day, 'Home', true)).toBe('2026-10-01');
		expect(gridMove('month', day, 'End', true)).toBe('2026-10-31');
		expect(gridMove('week', day, 'Home', true)).toBe('2026-10-12');
		expect(gridMove('month', day, 'PageUp')).toBe('2026-09-14');
		expect(gridMove('month', day, 'PageDown')).toBe('2026-11-14');
		expect(gridMove('week', day, 'PageDown')).toBe('2026-10-21');
		expect(gridMove('month', day, 'Enter')).toBeNull();
		expect(gridMove('month', day, 'a')).toBeNull();
	});
});

describe('labels', () => {
	it('names days with the full date, today and the number of entries', () => {
		expect(fullDateLabel('2026-10-05')).toBe('Montag, 5. Oktober 2026');
		expect(dayCellLabel(TODAY, TODAY, 3)).toBe('Freitag, 2. Oktober 2026, heute, 3 Einträge');
		expect(dayCellLabel('2026-10-05', TODAY, 1)).toBe('Montag, 5. Oktober 2026, 1 Eintrag');
		expect(dayCellLabel('2026-10-06', TODAY, 0)).toBe('Dienstag, 6. Oktober 2026, keine Einträge');
		expect(entryCountText(12)).toBe('12 Einträge');
		expect(shortDayLabel('2026-10-05', TODAY)).toBe('5.10.');
		expect(shortDayLabel('2027-01-05', TODAY)).toBe('5.1.2027');
		expect(weekLabel({ week: 40 })).toBe('Kalenderwoche 40');
	});

	it('names the period: the month, the week with its number, the days of the agenda', () => {
		expect(periodTitle(OCTOBER)).toBe('Oktober 2026');
		expect(periodTitle(periodOf('week', TODAY))).toBe('KW 40 · 28.09. – 04.10.2026');
		expect(periodTitle(periodOf('agenda', TODAY))).toBe('02.10. – 29.10.2026');
	});

	it('shows all entries up to the limit, else one fewer and "+N weitere"', () => {
		expect(sliceDay([1, 2, 3, 4], MONTH_DAY_LIMIT)).toEqual({ shown: [1, 2, 3, 4], more: 0 });
		expect(sliceDay([1, 2, 3, 4, 5, 6], MONTH_DAY_LIMIT)).toEqual({ shown: [1, 2, 3], more: 3 });
		expect(moreLabel(3)).toBe('+3 weitere');
	});
});

describe('entries of the days', () => {
	it('puts open tickets on their due day within the period, overdue ones marked', () => {
		const overdue = ticket('2026-09-30');
		const later = ticket('2026-10-20');
		const outside = ticket('2026-11-02');
		const none = ticket(null);
		const days = entriesByDay(
			OCTOBER,
			{ open: [overdue, later, outside, none], done: [], planned: [], inbox: [] },
			filter()
		);
		expect([...days.keys()].sort()).toEqual(['2026-09-30', '2026-10-20']);
		const first = days.get('2026-09-30')?.[0];
		expect(first?.kind === 'ticket' && first.overdue).toBe(true);
		const second = days.get('2026-10-20')?.[0];
		expect(second?.kind === 'ticket' && second.overdue).toBe(false);
	});

	it('orders a day: open tickets by priority, planned dates, the inbox, done tickets', () => {
		const low = ticket(TODAY, { priority: 'low', title: 'Niedrig' });
		const urgent = ticket(TODAY, { priority: 'urgent', title: 'Dringend' });
		const done = ticket(TODAY, { status: 'done', title: 'Erledigt' });
		const days = entriesByDay(
			OCTOBER,
			{
				open: [low, urgent],
				done: [done],
				planned: [planned(TODAY)],
				inbox: [item('2026-10-02 07:00:00.000Z')]
			},
			filter({}, ['open', 'done', 'planned', 'inbox'])
		);
		expect(days.get(TODAY)?.map((entry) => entry.key)).toEqual([
			`ticket:${urgent.id}`,
			`ticket:${low.id}`,
			`planned:rule00000000001:${TODAY}`,
			expect.stringMatching(/^inbox:/),
			`ticket:${done.id}`
		]);
	});

	it('follows the layers', () => {
		const sources = {
			open: [ticket(TODAY)],
			done: [ticket(TODAY, { status: 'done' })],
			planned: [planned(TODAY)],
			inbox: [item('2026-10-02 07:00:00.000Z')]
		};
		const kinds = (layers: CalendarLayer[]) =>
			(entriesByDay(OCTOBER, sources, filter({}, layers)).get(TODAY) ?? []).map((entry) =>
				entry.kind === 'ticket' ? (entry.done ? 'done' : 'open') : entry.kind
			);
		const all: CalendarLayer[] = ['open', 'done', 'planned', 'inbox'];
		expect(kinds(all)).toEqual(['open', 'planned', 'inbox', 'done']);
		expect(kinds(['open'])).toEqual(['open']);
		expect(kinds(['done', 'inbox'])).toEqual(['inbox', 'done']);
		expect(kinds([])).toEqual([]);
	});

	it('lets the status filter decide over the tickets, like the list', () => {
		expect(showsOpen(filter())).toBe(true);
		expect(showsDone(filter())).toBe(false);
		expect(showsDone(filter({ status: 'done' }))).toBe(true);
		expect(showsOpen(filter({ status: 'done' }))).toBe(false);
		expect(showsDone(filter({ status: 'open' }, ['open', 'done']))).toBe(false);
		expect(showsDone(filter({}, ['done']))).toBe(true);
	});

	it('applies the filters of "Aufgaben" to tickets, without "Fällig" and the search', () => {
		const house = ticket(TODAY, { priority: 'high' });
		const garden = ticket(TODAY, { project: GARDEN, tags: [TAG] });
		const office = ticket(TODAY, { project: OFFICE, recurring: true });
		const sources = { open: [house, garden, office], done: [], planned: [], inbox: [] };
		const keysOf = (query: Partial<ListQuery>) =>
			(entriesByDay(OCTOBER, sources, filter(query)).get(TODAY) ?? []).map((entry) => entry.key);
		expect(keysOf({ project: HOUSE })).toEqual([`ticket:${house.id}`, `ticket:${garden.id}`]);
		expect(keysOf({ project: HOUSE, subProjects: false })).toEqual([`ticket:${house.id}`]);
		expect(keysOf({ tag: TAG })).toEqual([`ticket:${garden.id}`]);
		expect(keysOf({ priority: 'high' })).toEqual([`ticket:${house.id}`]);
		expect(keysOf({ recurring: 'recurring' })).toEqual([`ticket:${office.id}`]);
		expect(keysOf({ due: 'overdue', search: 'nichts' })).toHaveLength(3);
		expect(calendarListQuery({ ...EMPTY_LIST_QUERY, due: 'today' }).due).toBeNull();
		expect(calendarListQuery(EMPTY_LIST_QUERY)).toBe(EMPTY_LIST_QUERY);
	});

	it('leaves the filter cards out, which only "Aufgaben" shows (FI-1)', () => {
		const house = ticket(TODAY, { priority: 'high' });
		const working = ticket(TODAY, { status: 'in_progress' });
		const sources = { open: [house, working], done: [], planned: [], inbox: [] };
		const keysOf = (query: Partial<ListQuery>) =>
			(entriesByDay(OCTOBER, sources, filter(query)).get(TODAY) ?? []).map((entry) => entry.key);
		expect(keysOf({ cards: ['in_progress'] })).toHaveLength(2);
		expect(keysOf({ cards: ['urgent'], priority: 'high' })).toEqual([`ticket:${house.id}`]);
		expect(calendarListQuery({ ...EMPTY_LIST_QUERY, cards: ['overdue'] }).cards).toEqual([]);
	});

	it('filters planned dates as the tickets they will become', () => {
		const query = (values: Partial<ListQuery>) => ({ ...EMPTY_LIST_QUERY, ...values });
		const date = planned(TODAY, { priority: 'high', tagIds: [TAG], status: 'waiting' });
		expect(plannedMatches(date, query({ project: HOUSE }), TODAY, SUB_PROJECTS)).toBe(true);
		expect(plannedMatches(date, query({ priority: 'high' }), TODAY, SUB_PROJECTS)).toBe(true);
		expect(plannedMatches(date, query({ priority: 'low' }), TODAY, SUB_PROJECTS)).toBe(false);
		expect(plannedMatches(date, query({ status: 'waiting' }), TODAY, SUB_PROJECTS)).toBe(true);
		expect(plannedMatches(date, query({ status: 'done' }), TODAY, SUB_PROJECTS)).toBe(false);
		expect(plannedMatches(date, query({ recurring: 'once' }), TODAY, SUB_PROJECTS)).toBe(false);
		expect(plannedMatches(date, query({ source: 'manual' }), TODAY, SUB_PROJECTS)).toBe(true);
		expect(plannedMatches(date, query({ tag: TAG }), TODAY, SUB_PROJECTS)).toBe(true);
	});

	it('filters the inbox by its target project and the family of its channel only', () => {
		const query = (values: Partial<ListQuery>) => ({ ...EMPTY_LIST_QUERY, ...values });
		const garden = { channel: 'calendar' as const, targetProjectId: GARDEN };
		expect(inboxMatches(garden, query({ project: HOUSE }), SUB_PROJECTS)).toBe(true);
		expect(inboxMatches(garden, query({ project: HOUSE, subProjects: false }), SUB_PROJECTS)).toBe(
			false
		);
		expect(inboxMatches(garden, query({ project: NO_PROJECT }), SUB_PROJECTS)).toBe(false);
		const withoutTarget = { channel: 'ics' as const, targetProjectId: null };
		expect(inboxMatches(withoutTarget, query({ project: NO_PROJECT }), SUB_PROJECTS)).toBe(true);
		expect(inboxMatches(garden, query({ source: 'calendar' }), SUB_PROJECTS)).toBe(true);
		expect(inboxMatches(garden, query({ source: 'mail' }), SUB_PROJECTS)).toBe(false);
		for (const values of [
			{ status: 'open' },
			{ priority: 'high' },
			{ tag: TAG },
			{ recurring: 'once' }
		] as Partial<ListQuery>[]) {
			expect(inboxMatches(garden, query(values), SUB_PROJECTS)).toBe(false);
		}
	});

	it('shows new entries with the date of an appointment, on their Berlin day', () => {
		const late = item('2026-10-04 22:30:00.000Z');
		const mail = item('2026-10-03 08:00:00.000Z', { kind: 'mail', channel: 'mail' });
		const notion = item('2026-10-03 00:00:00.000Z', { kind: 'task', channel: 'notion' });
		const converted = item('2026-10-03 08:00:00.000Z', { state: 'converted' });
		const undated = item(null);
		const days = entriesByDay(
			OCTOBER,
			{ open: [], done: [], planned: [], inbox: [late, mail, notion, converted, undated] },
			filter()
		);
		// 22:30 UTC on 4 October is the 5th in Berlin (summer time).
		expect(days.get('2026-10-05')?.map((entry) => entry.key)).toEqual([`inbox:${late.id}`]);
		expect(days.get('2026-10-03')?.map((entry) => entry.key)).toEqual([`inbox:${notion.id}`]);
	});
});

describe('group "Überfällig" of the agenda', () => {
	it('holds the open tickets due before the first day, oldest first, with the filters', () => {
		const old = ticket('2026-09-01');
		const older = ticket('2026-08-15', { priority: 'low' });
		const office = ticket('2026-09-10', { project: OFFICE });
		const due = ticket(TODAY);
		const done = ticket('2026-09-01', { status: 'done' });
		const open = [old, older, office, due, done];
		expect(overdueEntries(open, filter(), TODAY).map((entry) => entry.key)).toEqual([
			`ticket:${older.id}`,
			`ticket:${old.id}`,
			`ticket:${office.id}`
		]);
		expect(overdueEntries(open, filter({ project: HOUSE }), TODAY)).toHaveLength(2);
		expect(overdueEntries(open, filter({}, ['planned']), TODAY)).toEqual([]);
		expect(overdueEntries(open, filter({ status: 'done' }), TODAY)).toEqual([]);
	});
});

describe('moving a due date (K-2)', () => {
	it('lets only open tickets move, overdue ones included', () => {
		const open = ticket('2026-10-06');
		const overdue = ticket('2026-09-20');
		const done = ticket('2026-10-08', { status: 'done' });
		const days = entriesByDay(
			OCTOBER,
			{
				open: [open],
				done: [done],
				planned: [planned('2026-10-12')],
				inbox: [item('2026-10-13 07:00:00.000Z')]
			},
			filter({}, ['open', 'done', 'planned', 'inbox'])
		);
		const all = [...days.values()].flat();
		expect(all).toHaveLength(4);
		const movable = all.filter(isMovable);
		expect(movable.map((entry) => entry.key)).toEqual([`ticket:${open.id}`]);
		const [late] = overdueEntries([overdue], filter(), TODAY);
		expect(late !== undefined && isMovable(late)).toBe(true);
	});

	it('says how to move, with the keyboard or the mouse, and notes a ticket of a series', () => {
		expect(moveInstructions('HAUS-12', 'keyboard', false)).toBe(
			'Fälligkeit von HAUS-12 verschieben: Tag mit den Pfeiltasten wählen oder anklicken, Enter setzt die Fälligkeit, Esc bricht ab.'
		);
		expect(moveInstructions('HAUS-12', 'pointer', true)).toBe(
			'Fälligkeit von HAUS-12 verschieben: Auf einen Tag ziehen und loslassen, Esc bricht ab. Nur dieses Ticket, die Serie verschiebt sich nicht.'
		);
		expect(SERIES_MOVE_HINT).toContain('verschiebt die Serie nicht');
		expect(CALENDAR_MOVE_KEY).toBe('m');
	});
});
