// Planned dates of the rules in the calendar (ADR-0053 §4, layer "Künftige Wiederholungen"). Pure:
// the dates a rule will make tickets for, without a ticket yet, within the shown period. It asks the
// same functions as the rest of the SPA and therefore the same rules as the hook (ADR-0021 to
// ADR-0023): the next ticket from `nextTicketOf` (catch-up of missed dates without "Verpasste
// Termine nachholen"; while an open ticket holds the series back, the first date after today, so a
// missed date never stands as an open entry, WH-1), the dates after it from `after` of
// recurrence.ts, the day it appears from
// `createOn` (due minus the lead time). Paused rules make nothing and are left out; a rule that
// waits for the choice about a large backlog makes the dates from today on either way. A rule
// "nach Erledigung" has only its next date, and none while its ticket is open (it hangs on the
// completion). A date that a ticket of the rule already holds (open or done, also one moved
// there by hand) is not shown twice. The loop runs over dates of the series, never over days, and
// stops after PLANNED_PER_RULE_MAX dates.

import type { CalendarDate } from './berlin-date';
import type { ProjectColor } from './colors';
import { after, createOn, onOrAfter, validRule } from './recurrence';
import { nextTicketOf, ruleParams, type RecurrenceRule } from './recurrence-rule';
import { joinWords, shortDate } from './recurrence-text';
import { templateStatusOf, type TemplateStatus } from './series-template';
import type { Priority } from './status';
import type { TicketSummary } from './ticket';

/** Dates of one rule at most in one period (a daily rule fills six weeks with 42). */
export const PLANNED_PER_RULE_MAX = 400;

/** A date a rule will make a ticket for, as the calendar shows it. */
export interface PlannedOccurrence {
	ruleId: string;
	/** Title of the template, the title of the next ticket. */
	title: string;
	/** Due date of the ticket the rule will make. */
	date: CalendarDate;
	/** Day from which it is made: the due date minus the lead time (today or earlier: soon). */
	appears: CalendarDate;
	/**
	 * Keys of the open tickets of the rule that hold the next ticket back (without "Jeden Termin
	 * einzeln anlegen" a rule makes nothing while one of its tickets is open), oldest first.
	 */
	blockedBy: readonly string[];
	/** Values of the template, for the filters and the color (ADR-0052). */
	projectId: string | null;
	tagIds: readonly string[];
	priority: Priority;
	status: TemplateStatus;
	color: ProjectColor | null;
	/** Charm of the template (ADR-0062), the one of the ticket it becomes; absent or null for none. */
	charm?: string | null;
}

/** Tickets of the rule and the keys of its open ones, oldest first. */
interface RuleTickets {
	dates: Set<CalendarDate>;
	openKeys: string[];
}

function ticketsByRule(tickets: readonly TicketSummary[]): Map<string, RuleTickets> {
	const byRule = new Map<string, RuleTickets>();
	const sorted = [...tickets].sort(
		(a, b) => compareText(a.created, b.created) || compareText(a.id, b.id)
	);
	for (const ticket of sorted) {
		const ruleId = ticket.recurrenceId;
		if (!ruleId) continue;
		let entry = byRule.get(ruleId);
		if (entry === undefined) {
			entry = { dates: new Set(), openKeys: [] };
			byRule.set(ruleId, entry);
		}
		if (ticket.due !== null) entry.dates.add(ticket.due);
		if (ticket.status !== 'done') entry.openKeys.push(ticket.key);
	}
	return byRule;
}

/** The planned dates of one rule from `from` to `to` (both included). */
function occurrencesOf(
	rule: RecurrenceRule,
	known: RuleTickets | undefined,
	today: CalendarDate,
	from: CalendarDate,
	to: CalendarDate
): PlannedOccurrence[] {
	const valid = validRule(ruleParams(rule));
	if (valid === null) return [];
	const next = nextTicketOf(rule, today, known?.openKeys ?? []);
	if (next.state === 'paused' || next.state === 'after_completion') return [];
	// Waiting for the choice about a backlog (only "Jeden Termin einzeln anlegen", always a fixed
	// rhythm): both choices make the dates from today on.
	const start = next.state === 'waiting' ? onOrAfter(valid, today) : next.due;
	if (start === null) return [];
	const occurrence = (date: CalendarDate, blockedBy: readonly string[]): PlannedOccurrence => ({
		ruleId: rule.id,
		title: rule.title,
		date,
		appears: createOn(date, valid.lead_days),
		blockedBy,
		projectId: rule.projectId,
		tagIds: rule.tagIds,
		priority: rule.priority ?? 'medium',
		status: templateStatusOf(rule.initialStatus),
		color: rule.color ?? null,
		charm: rule.charm ?? null
	});
	const taken = known?.dates ?? new Set<CalendarDate>();
	if (valid.mode !== 'calendar') {
		// After completion: only the next date is known.
		return start >= from && start <= to && !taken.has(start)
			? [occurrence(start, next.blockedBy)]
			: [];
	}
	const result: PlannedOccurrence[] = [];
	let date = start >= from ? start : onOrAfter(valid, from);
	let count = 0;
	while (date <= to && count < PLANNED_PER_RULE_MAX) {
		// Only the next ticket waits for the open ones; the later dates follow it.
		if (!taken.has(date)) result.push(occurrence(date, date === start ? next.blockedBy : []));
		date = after(valid, date);
		count += 1;
	}
	return result;
}

/**
 * The planned dates of all rules from `from` to `to`, by date and then by title. `tickets` are the
 * tickets the SPA knows (open ones and the loaded done ones): a date one of them holds is left out.
 */
export function plannedOccurrences(
	rules: readonly RecurrenceRule[],
	tickets: readonly TicketSummary[],
	today: CalendarDate,
	from: CalendarDate,
	to: CalendarDate
): PlannedOccurrence[] {
	if (from > to) return [];
	const byRule = ticketsByRule(tickets);
	const occurrences = rules.flatMap((rule) =>
		rule.active ? occurrencesOf(rule, byRule.get(rule.id), today, from, to) : []
	);
	return occurrences.sort((a, b) => compareText(a.date, b.date) || compareText(a.title, b.title));
}

function compareText(a: string, b: string): number {
	if (a === b) return 0;
	return a < b ? -1 : 1;
}

/**
 * When the ticket of a planned date appears, in the words of the line "Nächstes Ticket" of the
 * rules (`nextTicketText`): "erscheint am 09.10.", "erscheint in Kürze" (today or earlier: with the
 * next run of the server), and while an open ticket holds it back "erscheint am 09.10. (sobald
 * HAUS-12 erledigt ist)" or "erscheint, sobald HAUS-12 erledigt ist".
 */
export function plannedAppearsText(
	planned: Pick<PlannedOccurrence, 'appears' | 'blockedBy'>,
	today: CalendarDate
): string {
	const keys = planned.blockedBy;
	const done =
		keys.length === 0
			? ''
			: keys.length === 1
				? `sobald ${keys[0]} erledigt ist`
				: `sobald ${joinWords(keys)} erledigt sind`;
	if (planned.appears <= today) return done === '' ? 'erscheint in Kürze' : `erscheint, ${done}`;
	const appears = `erscheint am ${shortDate(planned.appears, today)}`;
	return done === '' ? appears : `${appears} (${done})`;
}
