// Calendar view (ADR-0053, plan docs/plan/kalender.md, packages K-1 and K-2). Pure: the state of the
// view in the URL, the view and the layers this device remembers, the periods with ISO weeks, the
// moves of the keyboard in the grid, the labels, and the entries of every day: tickets by due date,
// the planned dates of the rules (calendar-plan.ts) and the dated entries of the inbox, narrowed by
// the filters of "Aufgaben" (list-query.ts, filter.ts); then which entries may move to another day
// and the texts of moving. Only calendar dates in Berlin (ADR-0005), never times: every entry lasts
// the whole day. No loop runs over more days than the shown period.

import { addDays, isCalendarDate, parseCalendarDate, type CalendarDate } from './berlin-date';
import type { PlannedOccurrence } from './calendar-plan';
import { matchesFilter, type SubProjectsOf } from './filter';
import { formatCalendarDate } from './format';
import { eventDueDate, type InboxItemSummary } from './inbox';
import { NO_PROJECT, type ListQuery } from './list-query';
import { compareTickets, compareTitles } from './ordering';
import { WEEKDAYS, weekdayOf } from './recurrence';
import { MONTH_NAMES, WEEKDAY_NAMES } from './recurrence-text';
import { sourceFamily } from './source';
import type { TicketSummary } from './ticket';

// --- Views and the URL ---------------------------------------------------------------------------

export const CALENDAR_VIEWS = ['month', 'week', 'agenda'] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

/** The views where days stand in a grid (APG grid); the agenda is a list. */
export type GridView = Exclude<CalendarView, 'agenda'>;

export const CALENDAR_VIEW_LABELS: Readonly<Record<CalendarView, string>> = Object.freeze({
	month: 'Monat',
	week: 'Woche',
	agenda: 'Agenda'
});

/** URL values of the views, German like every parameter of the app (ADR-0013 section 4). */
const VIEW_VALUES: Readonly<Record<CalendarView, string>> = Object.freeze({
	month: 'monat',
	week: 'woche',
	agenda: 'agenda'
});

/** Parameters of the calendar; the filters are the ones of the list (LIST_PARAMS). */
export const CALENDAR_PARAMS = Object.freeze({ view: 'ansicht', date: 'datum' } as const);

/** Years a date of the URL may have, like "Beginnt am" of a rule (ADR-0021, addendum). */
export const CALENDAR_MIN_YEAR = 1900;
export const CALENDAR_MAX_YEAR = 2999;

export interface CalendarQuery {
	/** View named in the URL; null: the one this device remembers, else the default. */
	view: CalendarView | null;
	/** The day the period is built around; null: today. */
	date: CalendarDate | null;
}

export const EMPTY_CALENDAR_QUERY: Readonly<CalendarQuery> = Object.freeze({
	view: null,
	date: null
});

/** The value of a parameter that occurs exactly once; doubled parameters count as not set. */
function single(params: URLSearchParams, name: string): string | null {
	const values = params.getAll(name);
	return values.length === 1 ? (values[0] ?? null) : null;
}

/** A view from its URL or storage value; anything else is null. */
export function viewOf(value: string | null | undefined): CalendarView | null {
	return CALENDAR_VIEWS.find((view) => VIEW_VALUES[view] === value) ?? null;
}

/** The URL and storage value of a view. */
export function viewValue(view: CalendarView): string {
	return VIEW_VALUES[view];
}

/** A real calendar date within the years of the calendar, else null. */
export function calendarDateOf(value: string | null | undefined): CalendarDate | null {
	if (typeof value !== 'string' || !isCalendarDate(value)) return null;
	const year = Number(value.slice(0, 4));
	return year >= CALENDAR_MIN_YEAR && year <= CALENDAR_MAX_YEAR ? value : null;
}

/** Reads view and date from the URL; every input gives a valid query. */
export function parseCalendarQuery(params: URLSearchParams): CalendarQuery {
	return {
		view: viewOf(single(params, CALENDAR_PARAMS.view)),
		date: calendarDateOf(single(params, CALENDAR_PARAMS.date))
	};
}

/**
 * The search part of `params` with view and date replaced (`?…`, '' when empty): the filters of the
 * list and every other parameter stay in their order, view and date follow at the end.
 */
export function replaceCalendarQuery(params: URLSearchParams, query: CalendarQuery): string {
	const next = new URLSearchParams(params);
	next.delete(CALENDAR_PARAMS.view);
	next.delete(CALENDAR_PARAMS.date);
	if (query.view !== null) next.append(CALENDAR_PARAMS.view, VIEW_VALUES[query.view]);
	if (query.date !== null) next.append(CALENDAR_PARAMS.date, query.date);
	const search = next.toString();
	return search === '' ? '' : `?${search}`;
}

// --- What this device remembers ------------------------------------------------------------------

/** Key of the last chosen view in localStorage (ADR-0053 §2). */
export const CALENDAR_VIEW_STORAGE_KEY = 'byl-calendar-view';

/**
 * Below this width a month grid has no room for titles: without a choice the calendar starts with
 * the agenda there, and a month shows dots instead of titles (ADR-0053 §7).
 */
export const CALENDAR_NARROW_QUERY = '(max-width: 39.99rem)';

/** The view shown: the one of the URL, else the remembered one, else the month (agenda if narrow). */
export function effectiveView(
	named: CalendarView | null,
	stored: CalendarView | null,
	narrow: boolean
): CalendarView {
	return named ?? stored ?? (narrow ? 'agenda' : 'month');
}

export const CALENDAR_LAYERS = ['open', 'done', 'planned', 'inbox'] as const;
export type CalendarLayer = (typeof CALENDAR_LAYERS)[number];

export const LAYER_LABELS: Readonly<Record<CalendarLayer, string>> = Object.freeze({
	open: 'Offene Tickets',
	done: 'Erledigte Tickets',
	planned: 'Künftige Wiederholungen',
	inbox: 'Termine im Eingang'
});

/** What a layer shows, below its name in the popover "Ebenen". */
export const LAYER_HINTS: Readonly<Record<CalendarLayer, string>> = Object.freeze({
	open: 'Nach Fälligkeit; überfällige mit Uhr und „überfällig“.',
	done: 'Gedämpft, mit Häkchen; werden je Zeitraum geladen.',
	planned: 'Termine von Regeln, für die es noch kein Ticket gibt; pausierte nicht.',
	inbox: 'Neue Einträge mit Datum aus Kalendern und Notion, noch nicht umgewandelt.'
});

/** Layers of a new device: every one except the done tickets. */
export const DEFAULT_LAYERS: readonly CalendarLayer[] = Object.freeze(['open', 'planned', 'inbox']);

/** Key of the shown layers in localStorage; only a choice other than the default is stored. */
export const CALENDAR_LAYERS_STORAGE_KEY = 'byl-calendar-layers';

const LAYER_VALUES: Readonly<Record<CalendarLayer, string>> = Object.freeze({
	open: 'offen',
	done: 'erledigt',
	planned: 'geplant',
	inbox: 'eingang'
});

/**
 * The stored layers read strictly: a list of their values separated by commas, '' for none. No
 * value, or one without a single known layer, is the default.
 */
export function parseLayers(raw: string | null | undefined): ReadonlySet<CalendarLayer> {
	if (typeof raw !== 'string') return new Set(DEFAULT_LAYERS);
	if (raw === '') return new Set();
	const layers = raw
		.split(',')
		.map((value) => CALENDAR_LAYERS.find((layer) => LAYER_VALUES[layer] === value))
		.filter((layer): layer is CalendarLayer => layer !== undefined);
	return new Set(layers.length === 0 ? DEFAULT_LAYERS : layers);
}

/** The value to store, or null to remove the key (the default). */
export function serializeLayers(layers: ReadonlySet<CalendarLayer>): string | null {
	const chosen = CALENDAR_LAYERS.filter((layer) => layers.has(layer));
	const value = chosen.map((layer) => LAYER_VALUES[layer]).join(',');
	return value === DEFAULT_LAYERS.map((layer) => LAYER_VALUES[layer]).join(',') ? null : value;
}

// --- Weeks, months and periods --------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

const pad = (value: number) => String(value).padStart(2, '0');

/** Year and month (1 to 12) of a date. */
function yearMonth(date: CalendarDate): [number, number] {
	return [Number(date.slice(0, 4)), Number(date.slice(5, 7))];
}

/** Number of days of a month (1 to 12). */
export function daysInMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** First day of the month of `date`. */
export function monthStart(date: CalendarDate): CalendarDate {
	return `${date.slice(0, 7)}-01`;
}

/** Last day of the month of `date`. */
export function monthEnd(date: CalendarDate): CalendarDate {
	const [year, month] = yearMonth(date);
	return `${date.slice(0, 7)}-${pad(daysInMonth(year, month))}`;
}

/** Monday of the ISO week of `date` (weeks begin on Monday). */
export function mondayOf(date: CalendarDate): CalendarDate {
	return addDays(date, -WEEKDAYS.indexOf(weekdayOf(date)));
}

/** ISO week of a date: the week of its Thursday, counted from the week of 4 January. */
export function isoWeekOf(date: CalendarDate): { year: number; week: number } {
	const monday = mondayOf(date);
	const year = Number(addDays(monday, 3).slice(0, 4));
	const first = mondayOf(`${year}-01-04`);
	return {
		year,
		week: 1 + Math.round((parseCalendarDate(monday) - parseCalendarDate(first)) / (7 * DAY_MS))
	};
}

/** One week of a grid: its ISO number and its days, Monday first. */
export interface CalendarWeek {
	year: number;
	week: number;
	days: readonly CalendarDate[];
}

export interface CalendarPeriod {
	view: CalendarView;
	/** The day the period is built around: the date of the URL or today. */
	anchor: CalendarDate;
	/** First and last day shown; entries come only from this range. */
	from: CalendarDate;
	to: CalendarDate;
	/** Weeks of the grid, Monday first; empty for the agenda. */
	weeks: readonly CalendarWeek[];
	/** The month of the month view (`YYYY-MM`); its days outside stand muted. Null otherwise. */
	month: string | null;
}

/** Days of the agenda: four weeks from its first day on. */
export const AGENDA_DAYS = 28;

function weekOf(monday: CalendarDate): CalendarWeek {
	const { year, week } = isoWeekOf(monday);
	return { year, week, days: Array.from({ length: 7 }, (_, index) => addDays(monday, index)) };
}

/** The period of a view around `anchor`: a month in whole weeks, one week, or four weeks of agenda. */
export function periodOf(view: CalendarView, anchor: CalendarDate): CalendarPeriod {
	if (view === 'agenda') {
		const to = addDays(anchor, AGENDA_DAYS - 1);
		return { view, anchor, from: anchor, to, weeks: [], month: null };
	}
	if (view === 'week') {
		const monday = mondayOf(anchor);
		const weeks = [weekOf(monday)];
		return { view, anchor, from: monday, to: addDays(monday, 6), weeks, month: null };
	}
	const from = mondayOf(monthStart(anchor));
	const to = addDays(mondayOf(monthEnd(anchor)), 6);
	const weeks: CalendarWeek[] = [];
	for (let monday = from; monday <= to; monday = addDays(monday, 7)) weeks.push(weekOf(monday));
	return { view, anchor, from, to, weeks, month: anchor.slice(0, 7) };
}

/** The anchor of the period before (-1) or after (1): a month (the day clamped), a week, four weeks. */
export function shiftPeriod(view: CalendarView, anchor: CalendarDate, step: -1 | 1): CalendarDate {
	if (view === 'week') return addDays(anchor, 7 * step);
	if (view === 'agenda') return addDays(anchor, AGENDA_DAYS * step);
	const [year, month] = yearMonth(anchor);
	const index = year * 12 + (month - 1) + step;
	const nextYear = Math.floor(index / 12);
	const nextMonth = (index % 12) + 1;
	const day = Math.min(Number(anchor.slice(8, 10)), daysInMonth(nextYear, nextMonth));
	return `${String(nextYear).padStart(4, '0')}-${pad(nextMonth)}-${pad(day)}`;
}

/** Whether the period shows the day. */
export function inPeriod(period: Pick<CalendarPeriod, 'from' | 'to'>, date: CalendarDate): boolean {
	return date >= period.from && date <= period.to;
}

/** Names of the buttons before and after, by view. */
export const PERIOD_STEP_LABELS: Readonly<Record<CalendarView, readonly [string, string]>> =
	Object.freeze({
		month: ['Vorheriger Monat', 'Nächster Monat'],
		week: ['Vorherige Woche', 'Nächste Woche'],
		agenda: ['Vorherige 4 Wochen', 'Nächste 4 Wochen']
	});

/** "Montag, 5. Oktober 2026": the full date, the name of a day of the grid. */
export function fullDateLabel(date: CalendarDate): string {
	const [year, month] = yearMonth(date);
	return `${WEEKDAY_NAMES[weekdayOf(date)]}, ${Number(date.slice(8, 10))}. ${MONTH_NAMES[month - 1]} ${year}`;
}

/** "5.10." or, in another year than `today`, "5.10.2027". */
export function shortDayLabel(date: CalendarDate, today: CalendarDate): string {
	const [year, month] = yearMonth(date);
	const day = `${Number(date.slice(8, 10))}.${month}.`;
	return year === Number(today.slice(0, 4)) ? day : `${day}${year}`;
}

/**
 * Heading of the period: "Oktober 2026", "KW 40 · 28.09. – 04.10.2026" or, for the agenda,
 * "02.10. – 29.10.2026".
 */
export function periodTitle(period: CalendarPeriod): string {
	if (period.view === 'month') {
		const [year, month] = yearMonth(period.anchor);
		return `${MONTH_NAMES[month - 1]} ${year}`;
	}
	const range = `${formatCalendarDate(period.from).slice(0, 6)} – ${formatCalendarDate(period.to)}`;
	if (period.view === 'agenda') return range;
	const week = period.weeks[0];
	return week === undefined ? range : `KW ${week.week} · ${range}`;
}

/** The ISO week for screen readers, "Kalenderwoche 40". */
export function weekLabel(week: Pick<CalendarWeek, 'week'>): string {
	return `Kalenderwoche ${week.week}`;
}

// --- The keyboard in the grid (APG grid and date picker) ------------------------------------------

/**
 * The day the focus moves to: arrow keys by a day or a week, Home and End to the first and last day
 * of the week, Ctrl with them to the first and last day of the month (of the week in the week view),
 * Page Up and Page Down by a period. Null for another key. The day may lie outside the period: the
 * calendar then shows the period around it.
 */
export function gridMove(
	view: GridView,
	date: CalendarDate,
	key: string,
	ctrl = false
): CalendarDate | null {
	switch (key) {
		case 'ArrowLeft':
			return addDays(date, -1);
		case 'ArrowRight':
			return addDays(date, 1);
		case 'ArrowUp':
			return addDays(date, -7);
		case 'ArrowDown':
			return addDays(date, 7);
		case 'Home':
			return ctrl && view === 'month' ? monthStart(date) : mondayOf(date);
		case 'End':
			return ctrl && view === 'month' ? monthEnd(date) : addDays(mondayOf(date), 6);
		case 'PageUp':
			return shiftPeriod(view, date, -1);
		case 'PageDown':
			return shiftPeriod(view, date, 1);
		default:
			return null;
	}
}

// --- Entries --------------------------------------------------------------------------------------

/** An entry of a day: a ticket, a planned date of a rule, or a dated entry of the inbox. */
export type CalendarEntry =
	| {
			kind: 'ticket';
			/** Unique within the calendar, for keyed lists. */
			key: string;
			date: CalendarDate;
			ticket: TicketSummary;
			done: boolean;
			/** Open and due before today. */
			overdue: boolean;
	  }
	| { kind: 'planned'; key: string; date: CalendarDate; planned: PlannedOccurrence }
	| { kind: 'inbox'; key: string; date: CalendarDate; item: InboxItemSummary };

/** What the calendar shows entries of. */
export interface CalendarSources {
	/** Open tickets (the list store keeps all of them live). */
	open: readonly TicketSummary[];
	/** Done tickets of the period (loaded on demand). */
	done: readonly TicketSummary[];
	planned: readonly PlannedOccurrence[];
	/** New entries of the inbox; only those with a date of an appointment count. */
	inbox: readonly InboxItemSummary[];
}

/** Filters and layers at a Berlin date. */
export interface CalendarFilter {
	query: ListQuery;
	layers: ReadonlySet<CalendarLayer>;
	today: CalendarDate;
	subProjectsOf: SubProjectsOf;
}

/**
 * The filters of "Aufgaben" as the calendar applies them: without "Fällig" (the calendar is the axis
 * of the due date) and without the search (the server answers it for open tickets of the list only).
 */
export function calendarListQuery(query: ListQuery): ListQuery {
	if (query.due === null && query.search === null) return query;
	return { ...query, due: null, search: null };
}

/** Open tickets are shown: their layer is on and the status filter is not "Erledigt". */
export function showsOpen(filter: Pick<CalendarFilter, 'query' | 'layers'>): boolean {
	return filter.layers.has('open') && filter.query.status !== 'done';
}

/**
 * Done tickets are shown: the status filter "Erledigt" shows them (like the list, T-6), another
 * status hides them, without one their layer decides.
 */
export function showsDone(filter: Pick<CalendarFilter, 'query' | 'layers'>): boolean {
	if (filter.query.status !== null) return filter.query.status === 'done';
	return filter.layers.has('done');
}

/** Whether the target project of an entry passes the project filter (ADR-0049, ADR-0034). */
function matchesTarget(
	target: string | null,
	query: ListQuery,
	subProjectsOf: SubProjectsOf
): boolean {
	if (query.project === null) return true;
	if (query.project === NO_PROJECT) return target === null;
	if (target === query.project) return true;
	return query.subProjects && target !== null && subProjectsOf(query.project).includes(target);
}

/**
 * A planned date passes the filters as the ticket it will become: the values of the template, the
 * status it starts with, no source ("Manuell", ADR-0022 §2), a ticket of a series.
 */
export function plannedMatches(
	planned: PlannedOccurrence,
	query: ListQuery,
	today: CalendarDate,
	subProjectsOf: SubProjectsOf
): boolean {
	return matchesFilter(
		{
			status: planned.status,
			priority: planned.priority,
			due: planned.date,
			projectId: planned.projectId,
			tagIds: [...planned.tagIds],
			source: null,
			recurring: true
		},
		calendarListQuery(query),
		today,
		subProjectsOf
	);
}

/**
 * An entry of the inbox has no status, priority, tags or series: any of these filters hides it. The
 * project filter compares its target project (ADR-0049, sub projects included), the source filter
 * the family of its channel.
 */
export function inboxMatches(
	item: Pick<InboxItemSummary, 'channel' | 'targetProjectId'>,
	query: ListQuery,
	subProjectsOf: SubProjectsOf
): boolean {
	if (query.status !== null || query.priority !== null) return false;
	if (query.tag !== null || query.recurring !== null) return false;
	if (query.source !== null && sourceFamily(item.channel) !== query.source) return false;
	return matchesTarget(item.targetProjectId ?? null, query, subProjectsOf);
}

/** Order of the kinds within a day: open tickets, planned dates, the inbox, done tickets. */
function rankOf(entry: CalendarEntry): number {
	if (entry.kind === 'ticket') return entry.done ? 3 : 0;
	return entry.kind === 'planned' ? 1 : 2;
}

function compareEntries(a: CalendarEntry, b: CalendarEntry, today: CalendarDate): number {
	const byRank = rankOf(a) - rankOf(b);
	if (byRank !== 0) return byRank;
	if (a.kind === 'ticket' && b.kind === 'ticket') return compareTickets(a.ticket, b.ticket, today);
	const titleOf = (entry: CalendarEntry) =>
		entry.kind === 'ticket'
			? entry.ticket.title
			: entry.kind === 'planned'
				? entry.planned.title
				: entry.item.title;
	return compareTitles(titleOf(a), titleOf(b)) || compareText(a.key, b.key);
}

function compareText(a: string, b: string): number {
	if (a === b) return 0;
	return a < b ? -1 : 1;
}

function ticketEntry(ticket: TicketSummary, date: CalendarDate, today: CalendarDate) {
	const done = ticket.status === 'done';
	const overdue = !done && date < today;
	const key = `ticket:${ticket.id}`;
	const entry: CalendarEntry = { kind: 'ticket', key, date, ticket, done, overdue };
	return entry;
}

/**
 * The entries of every day from `from` to `to` that pass the filters and layers, each day in the
 * order of the kinds (open tickets by priority, then planned dates, the inbox and done tickets).
 * Days without entries are missing from the map.
 */
export function entriesByDay(
	range: { from: CalendarDate; to: CalendarDate },
	sources: CalendarSources,
	filter: CalendarFilter
): ReadonlyMap<CalendarDate, readonly CalendarEntry[]> {
	const { today, subProjectsOf } = filter;
	const query = calendarListQuery(filter.query);
	const days = new Map<CalendarDate, CalendarEntry[]>();
	const add = (entry: CalendarEntry) => {
		const list = days.get(entry.date);
		if (list === undefined) days.set(entry.date, [entry]);
		else list.push(entry);
	};
	const inRange = (date: CalendarDate | null): date is CalendarDate =>
		date !== null && date >= range.from && date <= range.to;
	if (showsOpen(filter)) {
		for (const ticket of sources.open) {
			if (inRange(ticket.due) && matchesFilter(ticket, query, today, subProjectsOf)) {
				add(ticketEntry(ticket, ticket.due, today));
			}
		}
	}
	if (showsDone(filter)) {
		for (const ticket of sources.done) {
			if (
				ticket.status === 'done' &&
				inRange(ticket.due) &&
				matchesFilter(ticket, query, today, subProjectsOf)
			) {
				add(ticketEntry(ticket, ticket.due, today));
			}
		}
	}
	if (filter.layers.has('planned')) {
		for (const planned of sources.planned) {
			if (inRange(planned.date) && plannedMatches(planned, query, today, subProjectsOf)) {
				const key = `planned:${planned.ruleId}:${planned.date}`;
				add({ kind: 'planned', key, date: planned.date, planned });
			}
		}
	}
	if (filter.layers.has('inbox')) {
		for (const item of sources.inbox) {
			const date = item.state === 'new' ? eventDueDate(item) : null;
			if (inRange(date) && inboxMatches(item, query, subProjectsOf)) {
				add({ kind: 'inbox', key: `inbox:${item.id}`, date, item });
			}
		}
	}
	for (const list of days.values()) list.sort((a, b) => compareEntries(a, b, today));
	return days;
}

/**
 * Group "Überfällig" of the agenda (ADR-0053 §3): the open tickets due before `before` that pass the
 * filters, oldest due date first; empty while open tickets are not shown.
 */
export function overdueEntries(
	open: readonly TicketSummary[],
	filter: CalendarFilter,
	before: CalendarDate
): CalendarEntry[] {
	if (!showsOpen(filter)) return [];
	const query = calendarListQuery(filter.query);
	return open
		.filter(
			(ticket) =>
				ticket.status !== 'done' &&
				ticket.due !== null &&
				ticket.due < before &&
				ticket.due < filter.today &&
				matchesFilter(ticket, query, filter.today, filter.subProjectsOf)
		)
		.map((ticket) => ticketEntry(ticket, ticket.due ?? before, filter.today))
		.sort((a, b) => compareText(a.date, b.date) || compareEntries(a, b, filter.today));
}

/** Entries of a day in the month view at most, "+N weitere" included. */
export const MONTH_DAY_LIMIT = 4;
/** Entries of a day in the week view at most, "+N weitere" included. */
export const WEEK_DAY_LIMIT = 12;

/**
 * The entries a cell shows and how many more it hides: all up to `limit`, else `limit - 1` and
 * "+N weitere" in the last line.
 */
export function sliceDay<T>(
	entries: readonly T[],
	limit: number
): { shown: readonly T[]; more: number } {
	if (entries.length <= limit) return { shown: entries, more: 0 };
	const shown = entries.slice(0, Math.max(limit - 1, 0));
	return { shown, more: entries.length - shown.length };
}

/** "+3 weitere". */
export function moreLabel(more: number): string {
	return `+${more} weitere`;
}

/** "keine Einträge", "1 Eintrag", "5 Einträge". */
export function entryCountText(count: number): string {
	if (count === 0) return 'keine Einträge';
	return count === 1 ? '1 Eintrag' : `${count} Einträge`;
}

/**
 * Name of a day of the grid: the full date, ", heute" for today, and the number of its entries,
 * e.g. "Montag, 5. Oktober 2026, heute, 3 Einträge".
 */
export function dayCellLabel(date: CalendarDate, today: CalendarDate, count: number): string {
	return `${fullDateLabel(date)}${date === today ? ', heute' : ''}, ${entryCountText(count)}`;
}

// --- Moving a due date (K-2) ----------------------------------------------------------------------

/** Key on a ticket of the grid that starts moving its due date (ADR-0053 §12). */
export const CALENDAR_MOVE_KEY = 'm';

/** Pixels a pressed mouse moves before it drags an entry; less stays a click. */
export const DRAG_THRESHOLD_PX = 5;

/**
 * Note of the flag after moving the due date of a ticket of a series: only this ticket moves, the
 * rule keeps its dates (ADR-0023; the help of "Wiederholungen" says the same).
 */
export const SERIES_MOVE_HINT =
	'Die Fälligkeit eines Tickets der Serie zu verschieben, verschiebt die Serie nicht.';

/**
 * An entry whose day may change: an open ticket. Done tickets keep the day they were due, a planned
 * date follows its rule, an entry of the inbox is no ticket yet.
 */
export function isMovable(entry: CalendarEntry): boolean {
	return entry.kind === 'ticket' && !entry.done;
}

/**
 * What to do while a due date moves, for the status line of the grid: with the keyboard (or after
 * the menu) the arrow keys or a click choose the day, with the mouse the day under it.
 */
export function moveInstructions(
	key: string,
	how: 'keyboard' | 'pointer',
	recurring: boolean
): string {
	const steps =
		how === 'keyboard'
			? 'Tag mit den Pfeiltasten wählen oder anklicken, Enter setzt die Fälligkeit, Esc bricht ab.'
			: 'Auf einen Tag ziehen und loslassen, Esc bricht ab.';
	const series = recurring ? ' Nur dieses Ticket, die Serie verschiebt sich nicht.' : '';
	return `Fälligkeit von ${key} verschieben: ${steps}${series}`;
}
