// Recurrence rules in the SPA (ADR-0021 to ADR-0023; E5 plan, package 4). Pure: the rule as the
// data layer maps it, the values of the form "Wiederholen…" with their checks and preview, and
// the texts of the panel line. Every date calculation goes through recurrence.ts (E5 plan,
// section 2); the checks give the same codes as the hook (lib/recurrence.js).

import { isCalendarDate, type CalendarDate } from './berlin-date';
import type { ProjectColor } from './colors';
import {
	DEFAULT_LEAD_DAYS,
	LAST_DAY,
	RECURRENCE_CODES,
	after,
	afterCompletion,
	catchUp,
	createOn,
	onOrAfter,
	upcoming,
	validRule,
	validateRule,
	weekdayOf,
	type RecurrenceFreq,
	type RecurrenceMode,
	type RecurrenceParams,
	type Weekday
} from './recurrence';
import { overdueSinceText } from './due-label';
import { formatCalendarDate } from './format';
import { dayLabel, joinWords, recurrenceTextInSentence, shortDate } from './recurrence-text';
import {
	DEFAULT_SERIES_START,
	createDates,
	firstFromToday,
	type SeriesStart
} from './series-start';
import type { TemplateStatus, TemplateSubtask } from './series-template';
import type { Priority } from './status';

/** A rule as the data layer maps it (ADR-0021 section 1). */
export interface RecurrenceRule {
	id: string;
	title: string;
	description: string;
	projectId: string | null;
	tagIds: string[];
	priority: Priority | null;
	/** '' only for rules from before E5 without a rhythm (paused by the migration). */
	mode: RecurrenceMode | '';
	freq: RecurrenceFreq | '';
	interval: number;
	weekdays: Weekday[];
	/** 1 to 31, LAST_DAY (-1) for the last day, null when not monthly. */
	monthDay: number | null;
	anchor: CalendarDate | null;
	leadDays: number;
	/** Due date of the next ticket not created yet; null while an after-completion rule waits. */
	nextDue: CalendarDate | null;
	/** UTC timestamp of PocketBase, null before the first ticket. */
	lastGeneratedAt: string | null;
	active: boolean;
	/** Neutral hint of the server, '' without one. */
	lastHint: string;
	/**
	 * "Jeden Termin einzeln anlegen" (plan OR-5): every date gets its own ticket, open earlier ones
	 * or not; false as well before the migration. Optional so that rules built by hand stay valid.
	 */
	eachOccurrence?: boolean;
	/**
	 * "Status beim Anlegen" of the template (plan WV, ADR-0022 addendum 8): the status the next
	 * tickets start with; "open" before the migration and for older rules. Optional so that rules
	 * built by hand stay valid (absent counts as "open").
	 */
	initialStatus?: TemplateStatus;
	/**
	 * Sub-tasks of the template (plan WV-3, ADR-0022 addendum 10): every next ticket gets them as
	 * new, open sub-tasks; [] before the migration. Optional so that rules built by hand stay valid
	 * (absent counts as none).
	 */
	templateSubtasks?: TemplateSubtask[];
	/**
	 * Color of the template (ADR-0052): the next tickets get it as their own color; null for "wie
	 * Projekt", absent before the migration (then nothing is offered). Optional so that rules built by
	 * hand stay valid.
	 */
	color?: ProjectColor | null;
	/**
	 * Charm of the template (ADR-0062): every next ticket gets it when it is made; null for none,
	 * absent before the migration. Optional so that rules built by hand stay valid.
	 */
	charm?: string | null;
	/** The account that created the rule (`owner`); the data layer sets it (ADR-0061 §4). */
	owner?: string;
	created: string;
	updated: string;
}

/** Parameters of a rule for recurrence.ts. */
export function ruleParams(
	rule: Pick<
		RecurrenceRule,
		'mode' | 'freq' | 'interval' | 'weekdays' | 'monthDay' | 'anchor' | 'leadDays'
	>
): RecurrenceParams {
	return {
		mode: rule.mode,
		freq: rule.freq,
		interval: rule.interval,
		weekdays: rule.weekdays,
		month_day: rule.monthDay ?? 0,
		anchor: rule.anchor ?? '',
		lead_days: rule.leadDays
	};
}

/** Rhythm in words for the middle of a sentence ("jeden Montag"); '' without a valid rhythm. */
export function ruleText(rule: RecurrenceRule): string {
	return recurrenceTextInSentence(ruleParams(rule));
}

/**
 * The next ticket of a rule as the server will make it (plan "Wiederholungen verständlich machen",
 * recommendation 2):
 *   due        its due date; for a fixed rhythm with missed dates the latest of them up to today,
 *              which is what a ticket made today gets (ADR-0022 section 3); while an open ticket
 *              holds it back, the first date after today unless next_due lies later, which is what
 *              completing that ticket today gives (WH-1, ADR-0022 addendum 13: never a date in the
 *              past); null while an after-completion rule waits for the completion of its open ticket
 *   appears    the day from which it is made (due minus the lead time), which may be today or
 *              earlier ("in Kürze")
 *   blockedBy  keys of the open tickets it waits for: without "Verpasste Termine nachholen" a rule
 *              makes nothing while one of its tickets is open
 */
export interface NextTicket {
	state: 'paused' | 'waiting' | 'after_completion' | 'scheduled';
	due: CalendarDate | null;
	appears: CalendarDate | null;
	blockedBy: string[];
}

export function nextTicketOf(
	rule: RecurrenceRule,
	today: CalendarDate,
	openKeys: readonly string[] = []
): NextTicket {
	const blockedBy = rule.eachOccurrence === true ? [] : [...openKeys];
	if (!rule.active) return { state: 'paused', due: rule.nextDue, appears: null, blockedBy: [] };
	if (isWaiting(rule)) return { state: 'waiting', due: rule.nextDue, appears: null, blockedBy: [] };
	const params = ruleParams(rule);
	const valid = validRule(params);
	if (rule.nextDue === null || valid === null) {
		return { state: 'after_completion', due: null, appears: null, blockedBy };
	}
	const due = scheduledDue(
		valid,
		rule.nextDue,
		rule.eachOccurrence === true,
		today,
		blockedBy.length > 0
	);
	return { state: 'scheduled', due, appears: createOn(due, valid.lead_days), blockedBy };
}

/**
 * Due date of the next ticket of a valid rule (see NextTicket): next_due with "Verpasste Termine
 * nachholen" (`each`) or after completion; a fixed rhythm held back by an open ticket goes on after
 * the day that ticket is completed, today at the earliest (nextDueAfterDay of the hook, WH-1);
 * without one, missed dates are caught up with the latest of them (generation of the hook).
 */
function scheduledDue(
	valid: RecurrenceParams,
	nextDue: CalendarDate,
	each: boolean,
	today: CalendarDate,
	blocked: boolean
): CalendarDate {
	if (valid.mode !== 'calendar' || each) return nextDue;
	if (blocked) {
		const earliest = after(valid, today);
		return nextDue >= earliest ? nextDue : earliest;
	}
	return nextDue < today ? catchUp(valid, nextDue, today) : nextDue;
}

/** "HAUS-12 erledigt ist" or "HAUS-12 und HAUS-14 erledigt sind". */
function doneClause(keys: readonly string[]): string {
	return keys.length === 1 ? `${keys[0]} erledigt ist` : `${joinWords(keys)} erledigt sind`;
}

/**
 * The line "Nächstes Ticket …" of panel and ticket: "Nächstes Ticket fällig 12.10., erscheint am
 * 09.10.", with " (sobald HAUS-12 erledigt ist)" while an open ticket holds it back, "Nächstes
 * Ticket nach dem Erledigen von HAUS-12" after completion, "Pausiert" and, for a large backlog,
 * "Nächstes Ticket wartet auf deine Entscheidung".
 */
export function nextTicketText(
	rule: RecurrenceRule,
	today: CalendarDate,
	openKeys: readonly string[] = []
): string {
	const next = nextTicketOf(rule, today, openKeys);
	if (next.state === 'paused') return 'Pausiert';
	if (next.state === 'waiting') return 'Nächstes Ticket wartet auf deine Entscheidung';
	if (next.state === 'after_completion' || next.due === null || next.appears === null) {
		return next.blockedBy.length === 0
			? 'Nächstes Ticket nach dem Erledigen'
			: `Nächstes Ticket nach dem Erledigen von ${joinWords(next.blockedBy)}`;
	}
	const due = `Nächstes Ticket fällig ${shortDate(next.due, today)}`;
	const blocked = next.blockedBy.length > 0;
	if (next.appears <= today) {
		return blocked
			? `${due}, erscheint, sobald ${doneClause(next.blockedBy)}`
			: `${due}, erscheint in Kürze`;
	}
	const appears = `${due}, erscheint am ${shortDate(next.appears, today)}`;
	return blocked ? `${appears} (sobald ${doneClause(next.blockedBy)})` : appears;
}

/**
 * Column "Nächstes Ticket" of the overview (E5 plan, package 5): the due date of the next ticket
 * ("28.09."), or "nach dem Erledigen" while an after-completion rule waits for its instance. A
 * paused rule keeps its date for display (ADR-0023 section 4); the column "Zustand" says it pauses.
 * The second line (`nextTicketNote`) says when it appears; the whole sentence is its title.
 */
export function nextTicketDate(
	rule: RecurrenceRule,
	today: CalendarDate,
	openKeys: readonly string[] = []
): string {
	const next = nextTicketOf(rule, today, openKeys);
	return next.due === null || next.state === 'after_completion'
		? 'nach dem Erledigen'
		: shortDate(next.due, today);
}

/** Second line of the column: "erscheint 09.10.", "erscheint in Kürze", "nach HAUS-12", or ''. */
export function nextTicketNote(
	rule: RecurrenceRule,
	today: CalendarDate,
	openKeys: readonly string[] = []
): string {
	const next = nextTicketOf(rule, today, openKeys);
	if (next.state === 'paused' || next.state === 'waiting') return '';
	if (next.state === 'after_completion') {
		return next.blockedBy.length === 0
			? ''
			: `von ${next.blockedBy[0]}${next.blockedBy.length > 1 ? ' …' : ''}`;
	}
	if (next.blockedBy.length > 0) {
		return `nach ${next.blockedBy[0]}${next.blockedBy.length > 1 ? ' …' : ''}`;
	}
	if (next.appears === null || next.appears <= today) return 'erscheint in Kürze';
	return `erscheint ${shortDate(next.appears, today)}`;
}

export type RuleState = 'Aktiv' | 'Pausiert' | 'Wartet';

/**
 * "Aktiv", "Pausiert" or, while a large backlog waits for the choice of the user (ADR-0022
 * addendum 5), "Wartet" (short, it fits the column "Zustand"; the panel says what on); as text
 * next to its icon (no state by colour alone).
 */
export function ruleStateLabel(
	rule: Pick<RecurrenceRule, 'active'> &
		Partial<Pick<RecurrenceRule, 'lastHint' | 'eachOccurrence'>>
): RuleState {
	if (!rule.active) return 'Pausiert';
	return isWaiting(rule) ? 'Wartet' : 'Aktiv';
}

/**
 * "Folgetickets starten mit" without an answer (ADR-0022 addendum 9): the form checks it before
 * sending, the hook refuses a create without it with the same text.
 */
export const INITIAL_STATUS_REQUIRED = 'Bitte wählen, mit welchem Status Folgetickets starten.';

/** German texts of the codes; the same as the hook sends (tests/unit/web-recurrence.test.mjs). */
export const RECURRENCE_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
	validation_recurrence_mode: 'Bitte „Fester Rhythmus“ oder „Nach Erledigung“ wählen.',
	validation_recurrence_freq: 'Bitte einen Rhythmus wählen.',
	validation_recurrence_interval: 'Das Intervall muss eine ganze Zahl von 1 bis 365 sein.',
	validation_recurrence_weekdays: 'Bitte mindestens einen Wochentag wählen.',
	validation_recurrence_weekdays_mode:
		'Wochentage gibt es nur bei einem festen wöchentlichen Rhythmus.',
	validation_recurrence_month_day:
		'Der Tag im Monat muss zwischen 1 und 31 liegen oder „Letzter Tag“ sein.',
	validation_recurrence_month_day_mode:
		'Einen Tag im Monat gibt es nur bei einem festen monatlichen Rhythmus.',
	validation_recurrence_anchor: 'Bitte ein gültiges Datum für „Beginnt am“ wählen.',
	validation_recurrence_lead_days: 'Der Vorlauf muss zwischen 0 und 30 Tagen liegen.',
	validation_recurrence_ticket_missing:
		'Das Ticket wurde nicht gefunden oder liegt in einem anderen Bereich.',
	validation_recurrence_ticket_done: 'Ein erledigtes Ticket kann keine Serie beginnen.',
	validation_recurrence_ticket_linked: 'Das Ticket gehört schon zu einer Serie.',
	validation_recurrence_managed: 'Eine Wiederholung entsteht über „Wiederholen…“ am Ticket.',
	validation_recurrence_open_instance:
		'Von dieser Serie ist schon ein anderes Ticket offen. Erledige es zuerst oder löse ein Ticket aus der Serie.',
	validation_recurrence_each_mode:
		'„Verpasste Termine nachholen“ gibt es nur bei einem festen Rhythmus.',
	validation_recurrence_backlog: 'Bitte „Alle nachholen“ oder „Nur ab heute“ wählen.',
	validation_recurrence_start:
		'Bitte „Serie ab heute beginnen“ oder „Ursprüngliches Datum behalten“ wählen.',
	validation_recurrence_reopen_older:
		'Von dieser Serie ist schon ein anderes Ticket offen, und dieses Ticket ist nicht das zuletzt erledigte. Du kannst es als normales Ticket wieder öffnen (aus der Serie lösen).',
	validation_recurrence_initial_status:
		'Als „Status beim Anlegen“ geht jeder Status außer „Erledigt“.',
	validation_recurrence_initial_status_required: INITIAL_STATUS_REQUIRED,
	validation_recurrence_subtasks: 'Die Unteraufgaben der Vorlage sind ungültig.',
	validation_recurrence_subtasks_max: 'Die Vorlage hat höchstens 20 Unteraufgaben.',
	validation_recurrence_subtask_title: 'Jede Unteraufgabe der Vorlage braucht einen Titel.',
	validation_recurrence_subtask_title_max:
		'Der Titel einer Unteraufgabe hat höchstens 200 Zeichen.',
	validation_recurrence_subtask_priority:
		'Bitte für jede Unteraufgabe eine gültige Priorität wählen.'
});

/**
 * Codes of a refused reopening (ADR-0023 section 3 and addendum 4): another ticket of the series is
 * open. Both offer to reopen the ticket as a normal one ("aus der Serie lösen").
 */
export const REOPEN_REFUSALS: readonly string[] = Object.freeze([
	'validation_recurrence_open_instance',
	'validation_recurrence_reopen_older'
]);

// --- A large backlog with "Jeden Termin einzeln anlegen" (ADR-0022 addendum 5) -----------------

/** Hints of the server; the same texts as CATCH_UP_ASK_HINT and CATCH_UP_ALL_HINT of the hook. */
export const CATCH_UP_ASK_HINT =
	'Viele verpasste Termine: Die Regel wartet auf deine Entscheidung, ob sie alle nachholt oder erst ab heute weitermacht.';
export const CATCH_UP_ALL_HINT =
	'Die verpassten Termine werden nachgeholt, höchstens 20 je Lauf (stündlich).';

/** The choice about a backlog, sent as the body field `backlog`. */
export type BacklogChoice = 'all' | 'today';

/** Missed dates before today without a ticket, from a start on. */
export interface Backlog {
	count: number;
	first: CalendarDate;
	last: CalendarDate;
	/** The count stopped at BACKLOG_COUNT_MAX: there are more. */
	more: boolean;
}

/** Dates counted at most for a backlog; the loop runs over dates of the series. */
export const BACKLOG_COUNT_MAX = 10000;

/**
 * The dates of a fixed rhythm from `from` on (inclusive) that lie before `today`, or null without
 * any (or for a rule that is not a valid fixed rhythm).
 */
export function backlogOf(
	params: RecurrenceParams,
	from: CalendarDate | null,
	today: CalendarDate
): Backlog | null {
	const rule = validRule(params);
	if (rule === null || rule.mode !== 'calendar' || from === null || !(from < today)) return null;
	let count = 0;
	let last = from;
	let date = onOrAfter(rule, from);
	while (date < today && count < BACKLOG_COUNT_MAX) {
		count += 1;
		last = date;
		date = after(rule, date);
	}
	if (count === 0) return null;
	return { count, first: onOrAfter(rule, from), last, more: date < today };
}

/** Whether a rule waits for the choice about a large backlog (the hint of its last run). */
export function isWaiting(
	rule: Pick<RecurrenceRule, 'active'> &
		Partial<Pick<RecurrenceRule, 'lastHint' | 'eachOccurrence'>>
): boolean {
	return rule.active && rule.eachOccurrence === true && rule.lastHint === CATCH_UP_ASK_HINT;
}

/** The backlog of a rule from its next ticket on, or null. */
export function ruleBacklog(rule: RecurrenceRule, today: CalendarDate): Backlog | null {
	return backlogOf(ruleParams(rule), rule.nextDue, today);
}

/** "25 Termine (01.09. bis 25.09.)" or "1 Termin (12.10.)"; "mehr als" when the count stopped. */
export function backlogText(backlog: Backlog, today: CalendarDate): string {
	const amount = backlog.more
		? `Mehr als ${backlog.count} Termine`
		: backlog.count === 1
			? '1 Termin'
			: `${backlog.count} Termine`;
	const first = shortDate(backlog.first, today);
	const range = backlog.count === 1 ? first : `${first} bis ${shortDate(backlog.last, today)}`;
	return `${amount} (${range})`;
}

/** Label of the button "Alle 25 nachholen". */
export function catchUpAllLabel(backlog: Backlog): string {
	return backlog.more ? 'Alle nachholen' : `Alle ${backlog.count} nachholen`;
}

/** Label of the button "Nur ab heute". */
export const CATCH_UP_TODAY_LABEL = 'Nur ab heute';

/**
 * "Die Serie geht weiter, sobald alle 3 offenen Tickets erledigt sind (HAUS-1, HAUS-2, HAUS-3)."
 * (ADR-0022 addendum 5, recommendation 6): without "Jeden Termin einzeln anlegen" a rule makes
 * nothing while one of its tickets is open.
 */
export function openBlockText(keys: readonly string[]): string {
	return `Die Serie geht weiter, sobald alle ${keys.length} offenen Tickets erledigt sind (${keys.join(', ')}).`;
}

/** An open ticket of a rule as overview, panel and form show it. */
export interface OpenInstance {
	id: string;
	key: string;
	title: string;
}

/**
 * The open tickets of a rule among the open tickets of the list, oldest first (recommendation 7:
 * all of them, not only one).
 */
export function openInstancesOf(
	open: readonly {
		id: string;
		key: string;
		title: string;
		recurrenceId?: string | null;
		created: string;
	}[],
	ruleId: string
): OpenInstance[] {
	return open
		.filter((ticket) => ticket.recurrenceId === ruleId)
		.sort((a, b) => (a.created < b.created ? -1 : a.created > b.created ? 1 : a.id < b.id ? -1 : 1))
		.map((ticket) => ({ id: ticket.id, key: ticket.key, title: ticket.title }));
}

/**
 * The question "Regel löschen?" (ADR-0023 section 7: its tickets stay), in the panel and from the
 * menu "•••" of a row (plan aktionsmenues, AM-4): which open tickets stay as normal ones.
 */
export function ruleDeleteText(title: string, openKeys: readonly string[]): string {
	const open =
		openKeys.length === 1
			? `; ${openKeys[0]} bleibt als normales Ticket offen`
			: openKeys.length > 1
				? `; ${openKeys.join(', ')} bleiben als normale Tickets offen`
				: '';
	return `Bestehende Tickets bleiben erhalten. „${title}“ erzeugt danach keine Tickets mehr${open}.`;
}

/** Label of the way out of a refused reopening. */
export const REOPEN_DETACHED_LABEL = 'Als normales Ticket wieder öffnen (aus der Serie lösen)';

/** Refusal of reopening an older instance (ADR-0023 addendum 4), with the key of the open one. */
export function reopenOlderMessage(key: string): string {
	return `Von dieser Serie ist schon ${key} offen, und dieses Ticket ist nicht das zuletzt erledigte. Du kannst es als normales Ticket wieder öffnen (aus der Serie lösen).`;
}

// --- Missed dates made into one ticket (ADR-0022 addendum 4) ------------------------------------

/** History field of the note; the same as SKIPPED_FIELD of the hook. */
export const SKIPPED_FIELD = 'recurrence_skipped';

/** The dates a catch-up ticket stands for besides its own, as the hook writes them. */
export interface SkippedDates {
	count: number;
	/** The oldest of them, at most five. */
	dates: CalendarDate[];
	/** The count stopped at the cap of the hook: there were more. */
	more: boolean;
}

/** Reads the value of a history entry SKIPPED_FIELD; null for anything else. */
export function parseSkipped(value: string): SkippedDates | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		return null;
	}
	if (typeof parsed !== 'object' || parsed === null) return null;
	const { count, dates, more } = parsed as Record<string, unknown>;
	if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) return null;
	if (
		!Array.isArray(dates) ||
		!dates.every((date) => typeof date === 'string' && isCalendarDate(date))
	)
		return null;
	return { count, dates: [...(dates as CalendarDate[])], more: more === true };
}

/**
 * "2 Termine übersprungen (12.10., 19.10.)": neutral note of a ticket that stands for missed dates.
 * More dates than listed end with "…"; `more` says the count is a lower bound. Without `today`
 * (the history) the dates carry their year.
 */
export function skippedText(skipped: SkippedDates, today?: CalendarDate): string {
	const amount = skipped.more
		? `Mehr als ${skipped.count} Termine`
		: skipped.count === 1
			? '1 Termin'
			: `${skipped.count} Termine`;
	const listed = skipped.dates
		.map((date) => (today === undefined ? formatCalendarDate(date) : shortDate(date, today)))
		.join(', ');
	const rest = skipped.more || skipped.count > skipped.dates.length ? ' …' : '';
	return `${amount} übersprungen (${listed}${rest})`;
}

// --- Sub-tasks from the template (plan WV-3, ADR-0022 addendum 10) -----------------------------

/** History field of the note; the same as SUBTASKS_FIELD of the hook. */
export const SUBTASKS_FIELD = 'recurrence_subtasks';

/**
 * "3 Unteraufgaben aus der Vorlage angelegt": the note of a ticket of a series about the sub-tasks
 * it got from the template (value `{ count, tickets }` as the hook writes it).
 */
export function subtasksNoteText(value: string): string {
	let count: unknown;
	try {
		count = (JSON.parse(value) as { count?: unknown } | null)?.count;
	} catch {
		count = undefined;
	}
	if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
		return 'Unteraufgaben aus der Vorlage angelegt';
	}
	return count === 1
		? '1 Unteraufgabe aus der Vorlage angelegt'
		: `${count} Unteraufgaben aus der Vorlage angelegt`;
}

/**
 * At most so many tickets per rule and run with "Jeden Termin einzeln anlegen" (plan OR-5); the
 * same number as EACH_MAX_PER_RUN of the hook (tests/unit/web-recurrence.test.mjs).
 */
export const EACH_MAX_PER_RUN = 20;

/** Hint after a full batch without a choice; the same text as EACH_LIMIT_HINT of the hook. */
export const EACH_LIMIT_HINT =
	'Viele Termine auf einmal: 20 Tickets angelegt, die übrigen folgen beim nächsten Lauf (stündlich).';

/** Refusal of reopening with the key of the open ticket (ADR-0023 section 3). */
export function openInstanceMessage(key: string): string {
	return `Von dieser Serie ist schon ${key} offen. Erledige es zuerst oder löse ein Ticket aus der Serie.`;
}

// --- The form ---------------------------------------------------------------------------------

/** Values of the form as typed; numbers stay text until they are checked. */
export interface RecurrenceFormValues {
	mode: RecurrenceMode;
	freq: RecurrenceFreq;
	interval: string;
	weekdays: Weekday[];
	/** Day of the month as typed, used when `lastDay` is off. */
	monthDay: string;
	lastDay: boolean;
	anchor: string;
	leadDays: string;
	/**
	 * "Jeden Termin einzeln anlegen" (plan OR-5); sent only with a fixed rhythm. Optional so that
	 * values built by hand stay valid (absent counts as off).
	 */
	eachOccurrence?: boolean;
	/**
	 * Answer to the question about a large backlog when the switch goes on (ADR-0022 addendum 5);
	 * absent: no answer, the rule then waits for it at the overview.
	 */
	backlog?: BacklogChoice;
	/**
	 * Where a series with a ticket begins whose first date lies in the past (WH-2, ADR-0022 addendum
	 * 14): "Serie ab heute beginnen" or "Ursprüngliches Datum behalten"; absent counts as
	 * DEFAULT_SERIES_START, the choice made in advance.
	 */
	start?: SeriesStart;
}

/**
 * A rule to create for a ticket ("Wiederholen…", the section "Wiederholen" of "Neues Ticket"): the
 * rhythm and the answer to "Folgetickets starten mit" (ADR-0022 addendum 9); null where nothing is
 * asked (before the migration of "Status beim Anlegen").
 */
export interface RepeatRequest {
	values: RecurrenceFormValues;
	initialStatus: TemplateStatus | null;
}

export type RecurrenceFormField =
	'mode' | 'freq' | 'interval' | 'weekdays' | 'monthDay' | 'anchor' | 'leadDays' | 'eachOccurrence';

/** Maps the codes of the fields of recurrence.ts to the fields of the form. */
const FORM_FIELDS: Readonly<Record<string, RecurrenceFormField>> = {
	mode: 'mode',
	freq: 'freq',
	interval: 'interval',
	weekdays: 'weekdays',
	month_day: 'monthDay',
	anchor: 'anchor',
	lead_days: 'leadDays'
};

/** Server field names for the field errors of the form. */
export const SERVER_FIELDS: Readonly<Record<RecurrenceFormField, string>> = Object.freeze({
	mode: 'mode',
	freq: 'freq',
	interval: 'interval',
	weekdays: 'weekdays',
	monthDay: 'month_day',
	anchor: 'anchor',
	leadDays: 'lead_days',
	eachOccurrence: 'each_occurrence'
});

/**
 * Values of "Wiederholen…" (E5 plan, package 4): fixed rhythm, weekly on the weekday of the due
 * date or of today, starting on the due date or today, lead time 3 (OF-E5-1).
 */
export function defaultFormValues(
	due: CalendarDate | null,
	today: CalendarDate
): RecurrenceFormValues {
	const anchor = due ?? today;
	return {
		mode: 'calendar',
		freq: 'weekly',
		interval: '1',
		weekdays: [weekdayOf(anchor)],
		monthDay: String(Number(anchor.slice(8, 10))),
		lastDay: false,
		anchor,
		leadDays: String(DEFAULT_LEAD_DAYS)
	};
}

/** Values of the form for an existing rule ("Regel bearbeiten"). */
export function formValuesOf(rule: RecurrenceRule, today: CalendarDate): RecurrenceFormValues {
	const anchor = rule.anchor ?? today;
	return {
		mode: rule.mode === '' ? 'calendar' : rule.mode,
		freq: rule.freq === '' ? 'weekly' : rule.freq,
		interval: String(rule.interval || 1),
		weekdays: rule.weekdays.length > 0 ? [...rule.weekdays] : [weekdayOf(anchor)],
		monthDay:
			rule.monthDay !== null && rule.monthDay !== LAST_DAY
				? String(rule.monthDay)
				: String(Number(anchor.slice(8, 10))),
		lastDay: rule.monthDay === LAST_DAY,
		anchor,
		leadDays: String(rule.leadDays),
		eachOccurrence: rule.eachOccurrence === true
	};
}

/** A whole number from typed text, or NaN (then the check reports the field). */
function wholeNumber(text: string): number {
	return /^-?\d+$/.test(text.trim()) ? Number(text.trim()) : Number.NaN;
}

/**
 * Parameters as sent to the server: weekdays only for a fixed weekly rhythm, the day of the
 * month only for a fixed monthly one, "Jeden Termin einzeln anlegen" only for a fixed rhythm, so
 * switching the rhythm leaves nothing behind.
 */
export function formParams(values: RecurrenceFormValues): {
	mode: RecurrenceMode;
	freq: RecurrenceFreq;
	interval: number;
	weekdays: Weekday[];
	month_day: number;
	anchor: string;
	lead_days: number;
	each_occurrence: boolean;
	backlog?: BacklogChoice;
} {
	const calendar = values.mode === 'calendar';
	const each = calendar && values.eachOccurrence === true;
	return {
		mode: values.mode,
		freq: values.freq,
		interval: wholeNumber(values.interval),
		weekdays: calendar && values.freq === 'weekly' ? [...values.weekdays] : [],
		month_day:
			calendar && values.freq === 'monthly'
				? values.lastDay
					? LAST_DAY
					: wholeNumber(values.monthDay)
				: 0,
		anchor: values.anchor,
		lead_days: wholeNumber(values.leadDays),
		each_occurrence: each,
		// The answer to the question about a backlog, only with the switch (ADR-0022 addendum 5).
		...(each && values.backlog !== undefined && { backlog: values.backlog })
	};
}

/** Where the form is used: its first date and next_due follow from it (backlog question). */
export type RecurrenceFormContext =
	| { kind: 'ticket'; due: CalendarDate | null }
	| { kind: 'rule'; nextDue: CalendarDate | null; each: boolean };

/**
 * The backlog the form asks about when "Jeden Termin einzeln anlegen" goes on (ADR-0022 addendum
 * 5): more than EACH_MAX_PER_RUN dates before today that the rule would make at once. For a
 * ticket the series starts after its due date (or its first date without one, ADR-0023 section
 * 1), after the first date from today when it begins from today (WH-2); for an existing rule
 * without the switch at its next ticket. Null otherwise.
 */
export function formBacklog(
	values: RecurrenceFormValues,
	today: CalendarDate,
	context: RecurrenceFormContext | undefined
): Backlog | null {
	if (context === undefined || values.mode !== 'calendar' || values.eachOccurrence !== true) {
		return null;
	}
	if (Object.keys(formErrors(values)).length > 0) return null;
	const params = formParams(values);
	let from: CalendarDate | null;
	if (context.kind === 'rule') {
		if (context.each) return null;
		from = context.nextDue;
	} else {
		if (context.due !== null && !isCalendarDate(context.due)) return null;
		const dates = createDates({
			rule: params,
			withTicket: true,
			ticketDue: context.due ?? '',
			today,
			start: values.start ?? DEFAULT_SERIES_START
		});
		from = dates === null || dates.nextDue === '' ? null : dates.nextDue;
	}
	const backlog = backlogOf(params, from, today);
	return backlog !== null && (backlog.more || backlog.count > EACH_MAX_PER_RUN) ? backlog : null;
}

/**
 * Whether two sets of form values send the same rhythm and lead time. The rule panel sends the
 * rhythm only when it changed, so saving the template alone leaves "Nächstes Ticket" as it is.
 */
export function sameRhythm(a: RecurrenceFormValues, b: RecurrenceFormValues): boolean {
	const left = formParams(a);
	const right = formParams(b);
	return (
		left.mode === right.mode &&
		left.freq === right.freq &&
		Object.is(left.interval, right.interval) &&
		left.weekdays.join(',') === right.weekdays.join(',') &&
		Object.is(left.month_day, right.month_day) &&
		left.anchor === right.anchor &&
		Object.is(left.lead_days, right.lead_days) &&
		left.each_occurrence === right.each_occurrence
	);
}

/** Problems of the form per field, with the texts of the hook; empty when it may be sent. */
export function formErrors(
	values: RecurrenceFormValues
): Partial<Record<RecurrenceFormField, string>> {
	const params = formParams(values);
	const codes = validateRule(params);
	const errors: Partial<Record<RecurrenceFormField, string>> = {};
	for (const [field, code] of Object.entries(codes)) {
		const formField = FORM_FIELDS[field];
		if (formField !== undefined && code !== undefined) {
			errors[formField] = RECURRENCE_MESSAGES[code] ?? code;
		}
	}
	// A number the browser could not read is not "missing": say what is wrong with it.
	if (
		values.mode === 'calendar' &&
		values.freq === 'monthly' &&
		!values.lastDay &&
		Number.isNaN(params.month_day)
	) {
		errors.monthDay = RECURRENCE_MESSAGES[RECURRENCE_CODES.monthDay];
	}
	return errors;
}

/** A row of the preview: the due date and the day from which its ticket is made. */
export interface PreviewRow {
	due: CalendarDate;
	appears: CalendarDate;
}

export interface RecurrencePreview {
	/** The next dates of a fixed rhythm, or the date after completing today. */
	dates: CalendarDate[];
	/** The same dates with the day each ticket appears (due minus the lead time). */
	rows: PreviewRow[];
	/** Due date a ticket without one gets with a fixed rhythm (ADR-0023 section 1), else null. */
	firstDue: CalendarDate | null;
}

/**
 * Preview of the form: for a fixed rhythm the next three dates from the start (not before
 * today), after completion the date that follows a completion today; each with the day its
 * ticket appears (plan "Wiederholungen verständlich machen": "erscheint … → fällig …"). Empty
 * while the values are invalid. `withoutDue`: the ticket has no due date yet and gets the first
 * occurrence.
 */
export function formPreview(
	values: RecurrenceFormValues,
	today: CalendarDate,
	withoutDue = false
): RecurrencePreview {
	const rule = validRule(formParams(values));
	const invalid = rule === null || Object.keys(formErrors(values)).length > 0;
	if (invalid || !isCalendarDate(rule.anchor)) return { dates: [], rows: [], firstDue: null };
	const rowsOf = (dates: CalendarDate[]) =>
		dates.map((due) => ({ due, appears: createOn(due, rule.lead_days) }));
	if (rule.mode === 'after_completion') {
		const dates = [afterCompletion(rule, today)];
		return { dates, rows: rowsOf(dates), firstDue: null };
	}
	const from = rule.anchor > today ? rule.anchor : today;
	const dates = upcoming(rule, from, 3);
	return {
		dates,
		rows: rowsOf(dates),
		firstDue: withoutDue ? onOrAfter(rule, rule.anchor) : null
	};
}

/**
 * "erscheint heute", "erscheint sofort" (the day lies before today) or "erscheint Fr 02.10.":
 * when the ticket of a date appears, for the preview and the examples.
 */
export function appearsText(appears: CalendarDate, today: CalendarDate): string {
	if (appears < today) return 'erscheint sofort';
	if (appears === today) return 'erscheint heute';
	return `erscheint ${dayLabel(appears, today)}`;
}

// --- A series whose first date lies in the past (WH-2, ADR-0022 addendum 14) -------------------

/** Labels of the choice; the texts of validation_recurrence_start name them. */
export const SERIES_START_TODAY_LABEL = 'Serie ab heute beginnen';
export const SERIES_START_KEEP_LABEL = 'Ursprüngliches Datum behalten';

/**
 * The hint of the form when a series would begin in the past:
 *   reason  'due': the due date of the ticket lies before today; 'first': a ticket without due date
 *           would get a first date before today ("Beginnt am"); 'rule': "Beginnt am" of a new rule
 *           lies before today
 *   past    that date
 *   first   the first regular date on or after today (firstFromToday): where the series begins
 *           with "Serie ab heute beginnen", and where a new rule begins anyway
 *   choice  whether the user chooses: a ticket may keep its date ("Ursprüngliches Datum behalten");
 *           a new rule has no ticket and begins from today on the server (ADR-0023 section 1), so the
 *           hint only says so
 */
export interface SeriesStartQuestion {
	reason: 'due' | 'first' | 'rule';
	past: CalendarDate;
	first: CalendarDate;
	choice: boolean;
}

/**
 * Whether the form asks where the series begins (WH-2): every way a rule is created shows the same
 * hint, "Wiederholen…" at a ticket (also prepared from the inbox or after a failed rule), the section
 * "Wiederholen" of "Neues Ticket" (also a series taken over from a calendar) and "Neue Regel". The
 * ticket is `context` (its due date, null without one; `withoutDue` for callers without a context);
 * without either it is a new rule. Not when a rule is edited, while the values are invalid, or when
 * the date lies today or later.
 */
export function seriesStartQuestion(
	values: RecurrenceFormValues,
	today: CalendarDate,
	context: RecurrenceFormContext | undefined,
	withoutDue = false
): SeriesStartQuestion | null {
	if (context?.kind === 'rule' || Object.keys(formErrors(values)).length > 0) return null;
	const rule = validRule(formParams(values));
	const first = rule === null ? null : firstFromToday(rule, today);
	if (rule === null || first === null) return null;
	const due = context?.kind === 'ticket' ? context.due : withoutDue ? null : undefined;
	if (due === undefined) {
		return rule.anchor < today ? { reason: 'rule', past: rule.anchor, first, choice: false } : null;
	}
	if (due !== null && !isCalendarDate(due)) return null;
	const past = due ?? (rule.mode === 'calendar' ? onOrAfter(rule, rule.anchor) : null);
	if (past === null || past >= today) return null;
	return { reason: due === null ? 'first' : 'due', past, first, choice: true };
}

/**
 * "Die Fälligkeit liegt in der Vergangenheit (12.03.2024).", "Der erste Termin liegt in der
 * Vergangenheit (07.09.2026)." or "„Beginnt am“ liegt in der Vergangenheit (12.03.2024)."
 */
export function seriesStartText(question: SeriesStartQuestion): string {
	const date = formatCalendarDate(question.past);
	if (question.reason === 'due') return `Die Fälligkeit liegt in der Vergangenheit (${date}).`;
	if (question.reason === 'first') return `Der erste Termin liegt in der Vergangenheit (${date}).`;
	return `„Beginnt am“ liegt in der Vergangenheit (${date}).`;
}

/** "Erstes Vorkommen: Mo 12.10.", for today "Erstes Vorkommen: Mo 05.10. (heute)". */
export function firstOccurrenceText(question: SeriesStartQuestion, today: CalendarDate): string {
	const label = dayLabel(question.first, today);
	return `Erstes Vorkommen: ${question.first === today ? `${label} (heute)` : label}`;
}

/**
 * What "Ursprüngliches Datum behalten" means, with the text the lists show: "Das Ticket bleibt
 * „überfällig seit 12.03.2024“." (in the current year „überfällig seit 07.09.“).
 */
export function keepStartText(question: SeriesStartQuestion, today: CalendarDate): string {
	return `Das Ticket bleibt „${overdueSinceText(question.past, today)}“.`;
}

/**
 * The ticket after "Wiederholen…" (ADR-0023 section 1), as the server leaves it (createDates): in
 * the series; with a fixed rhythm a ticket without due date gets the first occurrence, and a first
 * date before today moves to the first one from today unless the user keeps it (WH-2). For panel
 * and list until the realtime event of the server follows.
 */
export function joinedSeries<
	T extends { due: CalendarDate | null; recurring: boolean; recurrenceId?: string | null }
>(ticket: T, ruleId: string, values: RecurrenceFormValues, today: CalendarDate): T {
	const dates = createDates({
		rule: formParams(values),
		withTicket: true,
		ticketDue: ticket.due ?? '',
		today,
		start: values.start ?? DEFAULT_SERIES_START
	});
	return {
		...ticket,
		recurring: true,
		recurrenceId: ruleId,
		due: dates?.ticketDue ?? ticket.due
	};
}
