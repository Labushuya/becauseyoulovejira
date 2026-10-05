// The day plan (TP-1, ADR-0065), pure: the kind of a ticket, the sources of suggestions with their
// modes, the suggestions of a day, what a check mark means, which days can be planned, the order of
// the entries and the texts of the page. Mirror of app/pb_hooks/lib/day-plan-rules.js
// (tests/unit/web-day-plan.test.mjs keeps both equal); the SPA computes the suggestions from its live
// tickets, the server the same for the automatic sources.
//
// "Heute" is the Berlin day of berlin-date.ts, the same as "Heute fällig" of the list (domain/filter.ts
// dueBucket), never a time zone of the runtime (ADR-0005).

import { addDays, parseCalendarDate, type CalendarDate } from './berlin-date';
import type { Priority, Status } from './status';

// --- Kind of a ticket --------------------------------------------------------------------------

/** "Aufgabe" (the default) or "Laufendes Vorhaben" (ADR-0065 §1). */
export type TicketKind = 'task' | 'ongoing';

export const TICKET_KINDS: readonly TicketKind[] = Object.freeze(['task', 'ongoing']);
export const DEFAULT_KIND: TicketKind = 'task';

/** The kind of a stored value: 'ongoing' or else 'task' (empty before the migration). */
export function kindOf(value: unknown): TicketKind {
	return value === 'ongoing' ? 'ongoing' : DEFAULT_KIND;
}

export function isTicketKind(value: unknown): value is TicketKind {
	return value === 'task' || value === 'ongoing';
}

export const KIND_LABELS: Readonly<Record<TicketKind, string>> = Object.freeze({
	task: 'Aufgabe',
	ongoing: 'Laufendes Vorhaben'
});

/** The badge of an ongoing project in the detail, the lists and the plan. */
export const ONGOING_BADGE = 'Vorhaben';

// --- Sources and modes -------------------------------------------------------------------------

export type DayPlanSource =
	'ongoing' | 'due_today' | 'overdue' | 'recurrence' | 'leftover' | 'in_progress';
export type SourceMode = 'off' | 'suggest' | 'auto';
export type DayPlanOrigin = 'manual' | DayPlanSource;
export type DayPlanSettings = Readonly<Record<DayPlanSource, SourceMode>>;

/** The sources in the order of the settings. */
export const DAY_PLAN_SOURCES: readonly DayPlanSource[] = Object.freeze([
	'ongoing',
	'due_today',
	'overdue',
	'recurrence',
	'leftover',
	'in_progress'
]);
export const SOURCE_MODES: readonly SourceMode[] = Object.freeze(['off', 'suggest', 'auto']);
export const DEFAULT_SOURCES: DayPlanSettings = Object.freeze({
	ongoing: 'auto',
	due_today: 'suggest',
	overdue: 'suggest',
	recurrence: 'suggest',
	leftover: 'suggest',
	in_progress: 'suggest'
});
export const DAY_PLAN_ORIGINS: readonly DayPlanOrigin[] = Object.freeze([
	'manual',
	'due_today',
	'overdue',
	'recurrence',
	'leftover',
	'in_progress',
	'ongoing'
]);
/** The reason a suggestion names first when a ticket matches several sources: the most specific. */
export const SOURCE_PRECEDENCE: readonly DayPlanSource[] = Object.freeze([
	'ongoing',
	'recurrence',
	'leftover',
	'overdue',
	'due_today',
	'in_progress'
]);

/** Names of the sources in the settings. */
export const SOURCE_LABELS: Readonly<Record<DayPlanSource, string>> = Object.freeze({
	ongoing: 'Laufende Vorhaben',
	due_today: 'Heute fällig',
	overdue: 'Überfällig',
	recurrence: 'Wiederholung von heute',
	leftover: 'Übrig von gestern',
	in_progress: 'In Arbeit'
});

/** Names of the modes in the settings. */
export const MODE_LABELS: Readonly<Record<SourceMode, string>> = Object.freeze({
	off: 'Aus',
	suggest: 'Vorschlagen',
	auto: 'Automatisch übernehmen'
});

const MODE_RANK: Readonly<Record<SourceMode, number>> = { off: 0, suggest: 1, auto: 2 };
const PRIORITY_RANK: Readonly<Record<string, number>> = { urgent: 0, high: 1, medium: 2, low: 3 };

function isSource(value: string): value is DayPlanSource {
	return (DAY_PLAN_SOURCES as readonly string[]).includes(value);
}

function isMode(value: unknown): value is SourceMode {
	return typeof value === 'string' && (SOURCE_MODES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The modes of every source from a stored or sent value: the default for anything missing or unknown. */
export function settingsOf(raw: unknown): DayPlanSettings {
	const result = {} as Record<DayPlanSource, SourceMode>;
	for (const source of DAY_PLAN_SOURCES) {
		const value = isRecord(raw) && Object.hasOwn(raw, source) ? raw[source] : undefined;
		result[source] = isMode(value) ? value : DEFAULT_SOURCES[source];
	}
	return result;
}

/** The sources of a request: known sources with known modes only; '' or the code of the problem. */
export function sourcesViolation(input: unknown): '' | 'validation_dayplan_sources' {
	if (!isRecord(input)) return 'validation_dayplan_sources';
	for (const [key, value] of Object.entries(input)) {
		if (!isSource(key) || !isMode(value)) return 'validation_dayplan_sources';
	}
	return '';
}

// --- Suggestions -------------------------------------------------------------------------------

/** What the rules need of a ticket. `due` is '' without a due date. */
export interface PlanTicketFacts {
	id: string;
	status: Status | string;
	due: CalendarDate | '';
	kind: TicketKind | string;
	recurring: boolean;
	priority: Priority | string;
	created: string;
}

export interface SuggestionContext {
	today: CalendarDate;
	settings: unknown;
	/** Ticket IDs in the plan. */
	planned: readonly string[];
	/** Ticket IDs removed from the plan that day. */
	dismissed: readonly string[];
	/** Ticket IDs of the entries of yesterday that were neither done nor checked for the day. */
	leftover: readonly string[];
}

export interface Suggestion {
	id: string;
	/** The strongest mode of its sources: 'suggest' or 'auto'. */
	mode: Exclude<SourceMode, 'off'>;
	/** The first source of that mode by SOURCE_PRECEDENCE. */
	origin: DayPlanSource;
	/** The texts of every source that is not off, in that order. */
	reasons: string[];
}

/** Whole days from `from` to `to`. */
export function daysBetween(from: CalendarDate, to: CalendarDate): number {
	return Math.round((parseCalendarDate(to) - parseCalendarDate(from)) / 86_400_000);
}

/** The sources an open ticket matches on `today`, in the order of SOURCE_PRECEDENCE. */
export function matchingSources(
	ticket: PlanTicketFacts,
	today: CalendarDate,
	leftover: readonly string[]
): DayPlanSource[] {
	if (ticket.status === 'done') return [];
	const due = ticket.due || '';
	const matches: Readonly<Record<DayPlanSource, boolean>> = {
		ongoing: kindOf(ticket.kind) === 'ongoing',
		recurrence: ticket.recurring && due === today,
		leftover: leftover.includes(ticket.id),
		overdue: due !== '' && due < today,
		due_today: due === today,
		in_progress: ticket.status === 'in_progress'
	};
	return SOURCE_PRECEDENCE.filter((source) => matches[source]);
}

/** Text of a reason, e.g. "überfällig seit 3 Tagen". */
export function reasonText(
	source: DayPlanSource,
	ticket: Pick<PlanTicketFacts, 'due'>,
	today: CalendarDate
): string {
	switch (source) {
		case 'ongoing':
			return 'laufendes Vorhaben';
		case 'recurrence':
			return 'Wiederholung';
		case 'leftover':
			return 'übrig von gestern';
		case 'overdue': {
			const days = ticket.due === '' ? 0 : daysBetween(ticket.due, today);
			return days === 1 ? 'überfällig seit 1 Tag' : `überfällig seit ${days} Tagen`;
		}
		case 'due_today':
			return 'heute fällig';
		case 'in_progress':
			return 'in Arbeit';
	}
}

function rankOf(priority: string): number {
	return Object.hasOwn(PRIORITY_RANK, priority) ? (PRIORITY_RANK[priority] ?? 2) : 2;
}

function compare(
	a: { origin: DayPlanSource; ticket: PlanTicketFacts },
	b: { origin: DayPlanSource; ticket: PlanTicketFacts }
): number {
	const origin = SOURCE_PRECEDENCE.indexOf(a.origin) - SOURCE_PRECEDENCE.indexOf(b.origin);
	if (origin !== 0) return origin;
	const dueA = a.ticket.due || '';
	const dueB = b.ticket.due || '';
	if (dueA !== dueB) {
		if (dueA === '') return 1;
		if (dueB === '') return -1;
		return dueA < dueB ? -1 : 1;
	}
	const priority = rankOf(a.ticket.priority) - rankOf(b.ticket.priority);
	if (priority !== 0) return priority;
	if (a.ticket.created !== b.ticket.created) return a.ticket.created < b.ticket.created ? -1 : 1;
	return a.ticket.id < b.ticket.id ? -1 : a.ticket.id > b.ticket.id ? 1 : 0;
}

/**
 * The suggestions of the plan of `today`: every open ticket that is neither planned nor removed today
 * and matches a source that is not off; sorted by origin, due date (none last), priority, creation
 * and ID. The same as `suggestionsOf` of the hook.
 */
export function suggestionsOf(
	tickets: readonly PlanTicketFacts[],
	context: SuggestionContext
): Suggestion[] {
	const settings = settingsOf(context.settings);
	const found: (Suggestion & { ticket: PlanTicketFacts })[] = [];
	for (const ticket of tickets) {
		if (context.planned.includes(ticket.id) || context.dismissed.includes(ticket.id)) continue;
		let best: SourceMode = 'off';
		let origin: DayPlanSource | null = null;
		const reasons: string[] = [];
		for (const source of matchingSources(ticket, context.today, context.leftover)) {
			const mode = settings[source];
			if (mode === 'off') continue;
			reasons.push(reasonText(source, ticket, context.today));
			if (MODE_RANK[mode] > MODE_RANK[best]) {
				best = mode;
				origin = source;
			}
		}
		if (best === 'off' || origin === null) continue;
		found.push({ id: ticket.id, mode: best, origin, reasons, ticket });
	}
	found.sort(compare);
	return found.map(({ id, mode, origin, reasons }) => ({ id, mode, origin, reasons }));
}

// --- Check marks ---------------------------------------------------------------------------------

/** 'check' is the check mark itself; 'today' "Nur für heute abhaken"; 'complete' "Vorhaben abschließen …". */
export type CheckMode = 'check' | 'today' | 'complete';
export type CheckAction = 'complete' | 'today';

export const CHECK_MODES: readonly CheckMode[] = Object.freeze(['check', 'today', 'complete']);

/** What a check does: the check mark completes a task and checks an ongoing project for the day. */
export function checkAction(kind: unknown, mode: unknown): CheckAction | null {
	if (mode === 'today' || mode === 'complete') return mode;
	if (mode === 'check') return kindOf(kind) === 'ongoing' ? 'today' : 'complete';
	return null;
}

/** Whether an entry counts as done in its plan: checked for the day or its ticket is done. */
export function isDone(doneToday: boolean, ticketStatus: string): boolean {
	return doneToday || ticketStatus === 'done';
}

// --- Days --------------------------------------------------------------------------------------

/** '' for a calendar date until tomorrow; else the code of the problem. */
export function dateViolation(
	date: unknown,
	tomorrow: CalendarDate
): '' | 'validation_dayplan_date' | 'validation_dayplan_future' {
	if (typeof date !== 'string') return 'validation_dayplan_date';
	try {
		parseCalendarDate(date);
	} catch {
		return 'validation_dayplan_date';
	}
	return date > tomorrow ? 'validation_dayplan_future' : '';
}

/** Whether the plan of `date` can change: today and tomorrow; days before are read-only. */
export function isEditable(date: CalendarDate, today: CalendarDate, tomorrow: CalendarDate): boolean {
	return date >= today && date <= tomorrow;
}

// --- Order -------------------------------------------------------------------------------------

/** The IDs with `id` moved to `index` (clamped), or null when `id` is not among them. */
export function moved(ids: readonly string[], id: string, index: number): string[] | null {
	const from = ids.indexOf(id);
	if (from === -1) return null;
	const rest = [...ids.slice(0, from), ...ids.slice(from + 1)];
	let target = Number.isFinite(index) ? Math.floor(index) : rest.length;
	target = Math.min(Math.max(target, 0), rest.length);
	return [...rest.slice(0, target), id, ...rest.slice(target)];
}

// --- Texts ---------------------------------------------------------------------------------------

/** Texts of the codes of the routes, the same as MESSAGES of the hook. */
export const DAY_PLAN_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
	validation_dayplan_date: 'Kein gültiger Tag für den Tagesplan.',
	validation_dayplan_future: 'Planen geht für heute und morgen.',
	validation_dayplan_readonly: 'Vergangene Tage lassen sich nicht mehr ändern.',
	validation_dayplan_area: 'Diesen Bereich gibt es für dein Konto nicht.',
	validation_dayplan_ticket_missing: 'Das Ticket gibt es nicht mehr oder es ist nicht sichtbar.',
	validation_dayplan_ticket_done: 'Erledigte Tickets kommen nicht in den Tagesplan.',
	validation_dayplan_mode: 'Unbekannte Art des Abhakens.',
	validation_dayplan_status: 'Unbekannter Status zum Wiederöffnen.',
	validation_dayplan_index: 'Ungültige Stelle im Plan.',
	validation_dayplan_sources: 'Ungültige Einstellung der Vorschläge.',
	validation_dayplan_tomorrow: 'Auf morgen schieben geht nur im Plan von heute.',
	validation_dayplan_tickets: 'Bitte höchstens 200 Tickets auf einmal übernehmen.'
});

/** Text of `validation_scope_mismatch` at the ticket of an entry, the same as the hook. */
export const DAY_PLAN_SCOPE_TEXT =
	'Das Ticket gehört zu einem anderen Bereich (Privat oder Haushalt) als dieser Tagesplan.';

/** At most this many tickets in one "Übernehmen". */
export const ADOPT_MAX = 200;

/** "3/7 erledigt" (visible) and its spoken form. */
export function progressText(done: number, total: number): { text: string; spoken: string } {
	return {
		text: `${done}/${total} erledigt`,
		spoken: total === 1 ? `${done} von 1 Eintrag erledigt` : `${done} von ${total} Einträgen erledigt`
	};
}

const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONTHS = [
	'Januar',
	'Februar',
	'März',
	'April',
	'Mai',
	'Juni',
	'Juli',
	'August',
	'September',
	'Oktober',
	'November',
	'Dezember'
];

/** "Heute", "Morgen", "Gestern" or the weekday, then the date: "Heute, Montag, 5. Oktober 2026". */
export function dayTitle(date: CalendarDate, today: CalendarDate): string {
	const day = new Date(parseCalendarDate(date));
	const full = `${WEEKDAYS[day.getUTCDay()]}, ${day.getUTCDate()}. ${MONTHS[day.getUTCMonth()]} ${day.getUTCFullYear()}`;
	if (date === today) return `Heute, ${full}`;
	if (date === addDays(today, 1)) return `Morgen, ${full}`;
	if (date === addDays(today, -1)) return `Gestern, ${full}`;
	return full;
}

/** The hint at the other area: "Im Haushalt: 3 Einträge für heute". */
export function otherAreaText(name: string, count: number): string {
	const entries = count === 1 ? '1 Eintrag' : `${count} Einträge`;
	return `${name}: ${entries} für heute`;
}

/** Initials of a name for the hint who added or checked an entry ("Anna Beispiel" → "AB"). */
export function initialsOf(name: string): string {
	const words = name.trim().split(/\s+/).filter((word) => word !== '');
	if (words.length === 0) return '';
	const first = words[0]?.[0] ?? '';
	const last = words.length > 1 ? (words.at(-1)?.[0] ?? '') : '';
	return `${first}${last}`.toUpperCase();
}
