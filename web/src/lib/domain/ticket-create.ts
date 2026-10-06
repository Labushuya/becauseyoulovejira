// "Neues Ticket" with everything at once (NT-1, ADR-0069): the request of the route
// POST /api/byl/tickets/create, its answer, what the server knows (GET of the same address), the
// mapping of its field errors to the fields of the form and the area "Weitere Optionen". Pure. The
// limits and texts are the same as in app/pb_hooks/lib/ticket-create-rules.js
// (tests/unit/web-ticket-create.test.mjs).

import type { TemplateSubtask } from './series-template';
import type { RecurrenceFormField } from './recurrence-rule';
import type { TicketDraft } from './ticket';

/** Sub-tasks, source tickets and entries of the inbox one request takes at most. */
export const CREATE_SUBTASKS_MAX = 20;
export const CREATE_TICKET_SOURCES_MAX = 20;
export const CREATE_SOURCES_MAX = 50;

/** Texts of the codes of the route; the same as MESSAGES of lib/ticket-create-rules.js. */
export const CREATE_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
	validation_create_format: 'Dieser Wert ist ungültig.',
	validation_create_title: 'Der Titel darf nicht leer sein.',
	validation_create_title_max: 'Der Titel hat höchstens 200 Zeichen.',
	validation_create_description_max: 'Die Beschreibung hat höchstens 100 000 Zeichen.',
	validation_create_unavailable: 'Diese Option steht nach dem nächsten Neustart der App bereit.',
	validation_create_subtasks: 'Die Unteraufgaben sind ungültig.',
	validation_create_subtasks_max: 'Beim Anlegen gehen höchstens 20 Unteraufgaben.',
	validation_create_subtask_title: 'Jede Unteraufgabe braucht einen Titel.',
	validation_create_subtask_title_max: 'Der Titel einer Unteraufgabe hat höchstens 200 Zeichen.',
	validation_create_subtask_priority: 'Bitte für jede Unteraufgabe eine gültige Priorität wählen.',
	validation_create_subtasks_nested:
		'Eine Unteraufgabe hat keine eigenen Unteraufgaben (nur eine Ebene).',
	validation_create_ticket_sources: 'Die Quell-Tickets sind ungültig.',
	validation_create_ticket_sources_max: 'Beim Anlegen gehen höchstens 20 Quell-Tickets.',
	validation_create_sources: 'Die Quellen aus dem Eingang sind ungültig.',
	validation_create_sources_max: 'Beim Anlegen gehen höchstens 50 Einträge aus dem Eingang.',
	validation_create_source_missing:
		'Dieser Eintrag ist nicht mehr im Eingang oder für dich nicht sichtbar.',
	validation_create_recurrence: 'Die Angaben zur Wiederholung sind ungültig.'
});

/**
 * What a new ticket gets beyond its own fields; each needs the ticket, so the route writes it in the
 * same transaction.
 */
export interface TicketExtras {
	/** New open sub-tasks in this order (ADR-0033), with the project and tags of the ticket. */
	subtasks: TemplateSubtask[];
	/** Tickets the new one stems from (ADR-0067). */
	ticketSources: string[];
	/** New entries of the inbox that become its sources (ADR-0031). */
	sources: string[];
	/** "Anheften" for the own account (ADR-0064). */
	pin: boolean;
	/** "Zum Tagesplan" of today (ADR-0065). */
	dayPlan: boolean;
	/** The sub-tasks go into the template of the series as well (plan WV-3). */
	templateSubtasks: boolean;
}

/** No extras: what "Neues Ticket" sends while nothing is set under "Weitere Optionen". */
export const NO_EXTRAS: Readonly<TicketExtras> = Object.freeze({
	subtasks: [],
	ticketSources: [],
	sources: [],
	pin: false,
	dayPlan: false,
	templateSubtasks: false
});

/** The parameters of the rule of a series; the server takes its template from the ticket. */
export type RuleParams = Readonly<Record<string, unknown>>;

/** One request of the route. */
export interface CreateRequest {
	draft: TicketDraft;
	/** The entry of the inbox the ticket is converted from (its main source), null for none. */
	sourceItem: string | null;
	/** Rhythm, "Folgetickets starten mit" and the rest of the rule; null without a series. */
	recurrence: RuleParams | null;
	extras: Omit<TicketExtras, 'templateSubtasks'>;
}

/** Request body of the route: the fields of the ticket in the form of the collection, then the extras. */
export function createRequestBody(
	request: CreateRequest,
	household: string,
	dueOf: (due: TicketDraft['due']) => string
): Record<string, unknown> {
	const { draft, extras } = request;
	return {
		...(household !== '' && { household }),
		title: draft.title,
		description: draft.description,
		status: draft.status,
		priority: draft.priority,
		due: dueOf(draft.due),
		project: draft.project ?? '',
		tags: [...draft.tags],
		...(draft.parent ? { parent: draft.parent } : {}),
		...(draft.parent && draft.blocksParent === false ? { blocks_parent: false } : {}),
		...(draft.color ? { color: draft.color } : {}),
		...(draft.charm ? { charm: draft.charm } : {}),
		...(draft.kind && draft.kind !== 'task' ? { kind: draft.kind } : {}),
		...(draft.assignee ? { assignee: draft.assignee } : {}),
		...(request.sourceItem !== null ? { source_item: request.sourceItem } : { source: 'manual' }),
		...(extras.subtasks.length > 0 && {
			subtasks: extras.subtasks.map((entry) => ({ title: entry.title, priority: entry.priority }))
		}),
		...(extras.ticketSources.length > 0 && { ticket_sources: [...extras.ticketSources] }),
		...(extras.sources.length > 0 && { sources: [...extras.sources] }),
		...(request.recurrence !== null && { recurrence: { ...request.recurrence } }),
		...(extras.pin && { pin: true }),
		...(extras.dayPlan && { day_plan: true })
	};
}

/** Answer of the route. */
export interface CreateOutcome {
	id: string;
	key: string;
	scope: string;
	subtasks: { id: string; key: string }[];
	/** Linked entries of the inbox and source tickets. */
	sources: number;
	ticketSources: number;
	/** The rule of the series, '' without one. */
	rule: string;
	pinned: boolean;
	dayPlan: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The answer of the route, or null when it is not one. */
export function toCreateOutcome(value: unknown): CreateOutcome | null {
	if (!isRecord(value)) return null;
	const { id, key, scope, subtasks, sources, ticket_sources, rule, pinned, day_plan } = value;
	if (typeof id !== 'string' || typeof key !== 'string' || !Array.isArray(subtasks)) return null;
	const children: { id: string; key: string }[] = [];
	for (const entry of subtasks as unknown[]) {
		if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.key !== 'string') {
			return null;
		}
		children.push({ id: entry.id, key: entry.key });
	}
	return {
		id,
		key,
		scope: typeof scope === 'string' ? scope : '',
		subtasks: children,
		sources: typeof sources === 'number' ? sources : 0,
		ticketSources: typeof ticket_sources === 'number' ? ticket_sources : 0,
		rule: typeof rule === 'string' ? rule : '',
		pinned: pinned === true,
		dayPlan: day_plan === true
	};
}

/**
 * The options the server knows (GET /api/byl/tickets/create): each after the migration that brings
 * it. Before the restart after this package the route is missing, and the form creates as before.
 */
export interface CreateSupport {
	recurrence: boolean;
	pin: boolean;
	dayPlan: boolean;
	ticketSources: boolean;
	kind: boolean;
	color: boolean;
	charm: boolean;
	assignee: boolean;
}

/** The answer of the GET, or null when it is not one. */
export function toCreateSupport(value: unknown): CreateSupport | null {
	if (!isRecord(value)) return null;
	const flag = (name: string) => value[name] === true;
	return {
		recurrence: flag('recurrence'),
		pin: flag('pin'),
		dayPlan: flag('day_plan'),
		ticketSources: flag('ticket_sources'),
		kind: flag('kind'),
		color: flag('color'),
		charm: flag('charm'),
		assignee: flag('assignee')
	};
}

/** A field of the form an error of the route stands at. */
export type CreateField =
	| keyof TicketDraft
	| 'subtasks'
	| 'ticketSources'
	| 'sources'
	| 'pin'
	| 'dayPlan'
	| 'recurrence'
	| 'initialStatus'
	| 'templateSubtasks'
	| RecurrenceFormField;

/** Fields whose errors name the row of a list (`params.index`). */
export type CreateListField = 'subtasks' | 'ticketSources' | 'sources';

/**
 * The fields of the route and of the hooks it runs, by the fields of the form. The fields of the
 * ticket keep their names; those of the rule go to the section "Wiederholen". `source_item` and
 * `household` have no field: their error is the message of the form.
 */
const SERVER_TO_FORM: Readonly<Record<string, CreateField>> = Object.freeze({
	title: 'title',
	description: 'description',
	status: 'status',
	priority: 'priority',
	due: 'due',
	project: 'project',
	tags: 'tags',
	parent: 'parent',
	blocks_parent: 'blocksParent',
	color: 'color',
	charm: 'charm',
	kind: 'kind',
	assignee: 'assignee',
	subtasks: 'subtasks',
	ticket_sources: 'ticketSources',
	sources: 'sources',
	pin: 'pin',
	day_plan: 'dayPlan',
	recurrence: 'recurrence',
	ticket: 'recurrence',
	start: 'recurrence',
	backlog: 'recurrence',
	initial_status: 'initialStatus',
	template_subtasks: 'templateSubtasks',
	mode: 'mode',
	freq: 'freq',
	interval: 'interval',
	weekdays: 'weekdays',
	month_day: 'monthDay',
	anchor: 'anchor',
	lead_days: 'leadDays',
	each_occurrence: 'eachOccurrence',
	assignee_mode: 'assignees',
	assignees: 'assignees',
	assignee_next: 'assignees'
});

/** The field of the form for a field of the server, null when the error belongs to the form as a whole. */
export function createFieldOf(serverField: string): CreateField | null {
	return Object.prototype.hasOwnProperty.call(SERVER_TO_FORM, serverField)
		? (SERVER_TO_FORM[serverField] ?? null)
		: null;
}

// --- "Weitere Optionen" -----------------------------------------------------------------------

/** localStorage key: "Weitere Optionen" is open on this device (only `1`). */
export const MORE_OPTIONS_KEY = 'byl-new-ticket-more';

export const MORE_OPTIONS_LABEL = 'Weitere Optionen';

/** What "Weitere Optionen" holds, as far as it counts for "gesetzt". */
export interface MoreOptionsState {
	pin: boolean;
	dayPlan: boolean;
	/** An own color (null is "wie Projekt"). */
	color: string | null;
	ongoing: boolean;
	parent: boolean;
	recurrence: boolean;
	subtasks: number;
	sources: number;
	ticketSources: number;
}

/** How many options under "Weitere Optionen" differ from the default of a new ticket. */
export function moreOptionsSet(state: MoreOptionsState): number {
	return [
		state.pin,
		state.dayPlan,
		state.color !== null,
		state.ongoing,
		state.parent,
		state.recurrence,
		state.subtasks > 0,
		state.sources + state.ticketSources > 0
	].filter(Boolean).length;
}

/** The heading of the area: "Weitere Optionen", with set ones "Weitere Optionen (2 gesetzt)". */
export function moreOptionsLabel(count: number): string {
	return count > 0 ? `${MORE_OPTIONS_LABEL} (${count} gesetzt)` : MORE_OPTIONS_LABEL;
}

/** Whether "Weitere Optionen" is open on this device; a blocked storage keeps it closed. */
export function readMoreOpen(storage: Pick<Storage, 'getItem'> | null): boolean {
	try {
		return storage?.getItem(MORE_OPTIONS_KEY) === '1';
	} catch {
		return false;
	}
}

/** Remembers it on this device; a blocked storage keeps it for this form only. */
export function writeMoreOpen(
	storage: Pick<Storage, 'setItem' | 'removeItem'> | null,
	open: boolean
): void {
	try {
		if (open) storage?.setItem(MORE_OPTIONS_KEY, '1');
		else storage?.removeItem(MORE_OPTIONS_KEY);
	} catch {
		// Private mode or a full storage: the area stays as it is in this form.
	}
}
