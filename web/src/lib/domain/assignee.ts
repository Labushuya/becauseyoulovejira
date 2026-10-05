// "Zuständig" in the household (E7-5, ADR-0068), pure. The mirror of app/pb_hooks/lib/assignee-rules.js
// (modes, limit, texts, the person of the next occurrences; tests/unit/web-assignee.test.mjs keeps both
// equal) and what the SPA alone needs: the name and the initials of an assignee, the stable color of an
// account, the card "Mir zugewiesen", the filter, groups and order "Zuständig", the history and the
// preview of a rotation.
//
// Only a ticket of a household has an assignee; a private one never has one, so everything here shows
// nothing there. The color is a ring of the palette of the projects (ADR-0052) around the initials,
// never the only sign: the initials and the full name (tooltip, text for screen readers) say who it is.

import { PROJECT_COLORS, type ProjectColor } from './colors';
import { initialsOf } from './day-plan';
import { OTHER_LABEL, SELF_LABEL, type PersonNames } from './people';
import type { TicketSummary } from './ticket';

// --- Mirror of the hook ------------------------------------------------------------------------

/** "fest" and "abwechselnd"; '' is "keine". */
export type AssigneeMode = 'fixed' | 'rotate';

export const ASSIGNEE_MODES: readonly AssigneeMode[] = Object.freeze(['fixed', 'rotate']);

/** At most this many people in the list of a rule. */
export const ASSIGNEES_MAX = 10;

/** Texts of the codes of the hook, the same as MESSAGES of lib/assignee-rules.js. */
export const ASSIGNEE_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
	validation_assignee_private: 'Private Tickets haben keine Zuständigkeit.',
	validation_assignee_member: 'Zuständig sein kann nur ein Mitglied des Haushalts.',
	validation_recurrence_assignee_private: 'Private Wiederholungen haben keine Zuständigkeit.',
	validation_recurrence_assignee_mode: 'Unbekannte Art der Zuständigkeit.',
	validation_recurrence_assignee_fixed: 'Bitte genau eine Person wählen.',
	validation_recurrence_assignee_rotate: 'Bitte mindestens eine Person wählen.',
	validation_recurrence_assignee_member: 'Zuständig sein kann nur ein Mitglied des Haushalts.',
	validation_recurrence_assignees_max: 'Höchstens 10 Personen.',
	validation_recurrence_assignee_next: 'Ungültige Stelle in der Reihenfolge.'
});

export function isAssigneeMode(value: unknown): value is AssigneeMode {
	return value === 'fixed' || value === 'rotate';
}

/** The mode of a stored value: 'fixed', 'rotate' or '' ("keine"). */
export function assigneeModeOf(value: unknown): AssigneeMode | '' {
	return isAssigneeMode(value) ? value : '';
}

/** The assignment of a rule: its mode, the people in order and the pointer of the rotation. */
export interface RuleAssignment {
	mode: AssigneeMode | '';
	assignees: readonly string[];
	next: number;
}

export const NO_ASSIGNMENT: RuleAssignment = Object.freeze({ mode: '', assignees: [], next: 0 });

function isIndex(value: number): boolean {
	return Number.isInteger(value) && value >= 0;
}

/**
 * The person of the next new occurrence and the pointer after it: "fest" its one person, "abwechselnd"
 * the person at the pointer (0 outside the list), round and round; '' without a mode. The same as
 * `nextAssignee` of the hook.
 */
export function nextAssignee(rule: RuleAssignment): { assignee: string; next: number } {
	const mode = assigneeModeOf(rule.mode);
	const assignees = rule.assignees.filter((id) => id !== '');
	const first = assignees[0];
	if (mode === 'fixed' && first !== undefined) return { assignee: first, next: 0 };
	if (mode === 'rotate' && assignees.length > 0) {
		const index = isIndex(rule.next) && rule.next < assignees.length ? rule.next : 0;
		return { assignee: assignees[index] ?? '', next: (index + 1) % assignees.length };
	}
	return { assignee: '', next: 0 };
}

/** The people of the next `count` new occurrences, for the preview of the dialog. */
export function upcomingAssignees(rule: RuleAssignment, count: number): string[] {
	const result: string[] = [];
	let state: RuleAssignment = { ...rule, assignees: rule.assignees.filter((id) => id !== '') };
	for (let i = 0; i < count; i++) {
		const step = nextAssignee(state);
		if (step.assignee === '') break;
		result.push(step.assignee);
		state = { ...state, next: step.next };
	}
	return result;
}

/**
 * The list of a rotation in the order of the coming occurrences: the person at the pointer first. The
 * dialog shows it so and sends it back with the pointer 0 (ADR-0068 §5), so what it shows is what comes.
 */
export function rotationOrder(rule: RuleAssignment): string[] {
	const assignees = rule.assignees.filter((id) => id !== '');
	if (assigneeModeOf(rule.mode) !== 'rotate' || assignees.length === 0) return assignees;
	const start = isIndex(rule.next) && rule.next < assignees.length ? rule.next : 0;
	return [...assignees.slice(start), ...assignees.slice(0, start)];
}

// --- Names, initials and color -----------------------------------------------------------------

/** Where the names of the accounts come from (the people of the layout, the household, a test). */
export interface AssigneeContext {
	/** The signed-in account. */
	selfId: string | null;
	/** Its display name ('' without one). */
	selfName: string;
	names: PersonNames | null;
}

/**
 * The full name of an assignee for tooltip, text for screen readers and lists: the own name (else
 * "Du") for the signed-in account, the name of another visible account, else "Anderes Konto".
 */
export function assigneeName(id: string, context: AssigneeContext): string {
	if (id === context.selfId) {
		const own = context.selfName.trim();
		return own === '' ? SELF_LABEL : own;
	}
	const name = context.names?.nameOf(id)?.trim() ?? '';
	return name === '' ? OTHER_LABEL : name;
}

/** Initials of a name ("Anna Beispiel" → "AB"), "?" without one. */
export function assigneeInitials(name: string): string {
	const initials = initialsOf(name);
	return initials === '' ? '?' : initials;
}

/** "Zuständig: Anna Beispiel", the tooltip and the text for screen readers of the initials. */
export function assigneeTitle(name: string): string {
	return `Zuständig: ${name}`;
}

/**
 * The color of an account: one of the palette of the projects (ADR-0052), always the same for the same
 * ID (FNV-1a over its characters), so the initials of a person look the same everywhere.
 */
export function assigneeColor(id: string): ProjectColor {
	let hash = 0x811c9dc5;
	for (let i = 0; i < id.length; i++) {
		hash ^= id.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return PROJECT_COLORS[hash % PROJECT_COLORS.length] ?? PROJECT_COLORS[0];
}

// --- Tickets -----------------------------------------------------------------------------------

/** What the rules here look at of a ticket. */
export type AssignedTicket = Pick<TicketSummary, 'assignee'>;

/** The assignee of a ticket, '' for none (also before the migration). */
export function assigneeOf(ticket: AssignedTicket): string {
	return ticket.assignee ?? '';
}

/** "Mir zugewiesen": the signed-in account is the assignee. */
export function isAssignedTo(ticket: AssignedTicket, selfId: string | null): boolean {
	return selfId !== null && selfId !== '' && assigneeOf(ticket) === selfId;
}

/** Value of the filter "Zuständig" for tickets without an assignee. */
export const NOBODY = 'niemand';

/** Label of "nobody" in the filter, the groups and the field. */
export const NOBODY_LABEL = 'Niemand';

/** The filter "Zuständig": an account ID or NOBODY; null lets every ticket pass. */
export function matchesAssignee(ticket: AssignedTicket, filter: string | null): boolean {
	if (filter === null) return true;
	if (filter === NOBODY) return assigneeOf(ticket) === '';
	return assigneeOf(ticket) === filter;
}

/**
 * Groups "Nach Zuständigkeit": the own account first, then the others by name, "Niemand" last. Returns
 * the order of the keys ('' for nobody).
 */
export function assigneeGroupOrder(keys: Iterable<string>, context: AssigneeContext): string[] {
	const people = [...new Set(keys)].filter((key) => key !== '');
	const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });
	people.sort((a, b) => {
		if (a === context.selfId) return -1;
		if (b === context.selfId) return 1;
		return (
			collator.compare(assigneeName(a, context), assigneeName(b, context)) ||
			(a < b ? -1 : a > b ? 1 : 0)
		);
	});
	return [...people, ''];
}

/** Label of a group of "Nach Zuständigkeit" ('' is "Niemand"). */
export function assigneeGroupLabel(key: string, context: AssigneeContext): string {
	return key === '' ? NOBODY_LABEL : assigneeName(key, context);
}

// --- History and texts ---------------------------------------------------------------------------

/** The history of the field `assignee`: "Zuständig: Anna Beispiel" or "Zuständigkeit entfernt". */
export function assigneeHistoryText(newValue: string, context: AssigneeContext): string {
	return newValue === ''
		? 'Zuständigkeit entfernt'
		: `Zuständig: ${assigneeName(newValue, context)}`;
}

/** The live notice of an assignment by someone else: "Anna hat dir HAUS-12 zugewiesen." */
export function assignedNoticeText(byName: string, key: string): string {
	const who = byName.trim() === '' ? 'Jemand' : byName.trim();
	return `${who} hat dir ${key} zugewiesen.`;
}

/** Names of the modes in the dialog of a rule. */
export const ASSIGNEE_MODE_LABELS: Readonly<Record<AssigneeMode | '', string>> = Object.freeze({
	'': 'Keine',
	fixed: 'Fest',
	rotate: 'Abwechselnd'
});

// --- The form of a rule ----------------------------------------------------------------------------

/**
 * "Zuständigkeit" in the form of a rule: the mode and the people in the order of the coming
 * occurrences (the person of the next one first, `rotationOrder`).
 */
export interface FormAssignment {
	mode: AssigneeMode | '';
	assignees: string[];
}

/** The form values of a stored assignment; none without one. */
export function formAssignmentOf(rule: RuleAssignment | null | undefined): FormAssignment {
	if (rule === null || rule === undefined) return { mode: '', assignees: [] };
	const mode = assigneeModeOf(rule.mode);
	return { mode, assignees: mode === '' ? [] : rotationOrder(rule) };
}

/** The people a mode sends: none, the first one for "fest", every one for "abwechselnd". */
function sentAssignees(form: FormAssignment): string[] {
	const people = form.assignees.filter(
		(id, index, list) => id !== '' && list.indexOf(id) === index
	);
	if (form.mode === '') return [];
	return form.mode === 'fixed' ? people.slice(0, 1) : people;
}

/** What the form refuses before it sends: "fest" without a person, "abwechselnd" without anyone. */
export function assignmentProblem(form: FormAssignment): string | null {
	const people = sentAssignees(form);
	if (form.mode === 'fixed' && people.length !== 1) return 'Bitte eine Person wählen.';
	if (form.mode === 'rotate' && people.length === 0) return 'Bitte mindestens eine Person wählen.';
	if (people.length > ASSIGNEES_MAX)
		return ASSIGNEE_MESSAGES.validation_recurrence_assignees_max ?? '';
	return null;
}

/** The body of a rule: the changed assignment, or nothing; the pointer starts at the shown first person. */
export interface AssignmentBody {
	assignee_mode?: AssigneeMode | '';
	assignees?: string[];
	assignee_next?: number;
}

/**
 * The fields of the assignment the request sends (ADR-0068 §5): nothing while it is unchanged (the
 * stored pointer stays), else mode, people in the shown order and the pointer 0, so the person shown
 * first gets the next occurrence. A new rule sends nothing without a mode.
 */
export function assignmentBody(
	form: FormAssignment | undefined,
	stored: RuleAssignment | null | undefined
): AssignmentBody {
	if (form === undefined) return {};
	const people = sentAssignees(form);
	const before = formAssignmentOf(stored);
	const unchanged =
		before.mode === form.mode &&
		before.assignees.length === people.length &&
		before.assignees.every((id, index) => people[index] === id);
	if (unchanged) return {};
	return { assignee_mode: form.mode, assignees: people, assignee_next: 0 };
}

/**
 * The preview of the dialog of a rule: "Nächstes Vorkommen: Anna, danach: Bert"; with one person "Jedes
 * Vorkommen: Anna"; '' without people.
 */
export function rotationPreviewText(names: readonly string[], mode: AssigneeMode | ''): string {
	const [first, second] = names;
	if (first === undefined) return '';
	if (mode === 'fixed' || second === undefined || second === first)
		return `Jedes Vorkommen: ${first}`;
	return `Nächstes Vorkommen: ${first}, danach: ${second}`;
}
