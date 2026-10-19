// "Auf Unteraufgaben übertragen …" (UE-1, ADR-0070): what the dialog offers, chooses in advance and
// counts, the request it sends and the answer it reads. The limits, the texts of the route and the
// changes per sub-task mirror app/pb_hooks/lib/subtask-transfer-rules.js
// (tests/unit/web-subtask-transfer.test.mjs). Pure module.
//
// The parent is the source of truth: the request names the fields, the server reads their values. The
// route also takes what UE-2 will offer after a change of the parent (ADR-0070 §6): the due date
// moved by a number of days (`shift`) and tags to remove (`remove`); the dialog of UE-1 sends only
// `same` and the tags of the parent to add.

import { addDays, type CalendarDate } from './berlin-date';
import { formatCalendarDate } from './format';
import { PRIORITY_LABELS, STATUS_LABELS } from './labels';
import { openOngoing } from './ongoing-finish';
import { projectPath } from './project-tree';
import { categoryOf, type Priority, type Status } from './status';
import type { ProjectRef, TicketSummary } from './ticket';

/** The fields that go from the parent to its sub-tasks, in the order of the dialog. */
export const TRANSFER_FIELDS = [
	'due',
	'priority',
	'status',
	'assignee',
	'tags',
	'project'
] as const;
export type TransferField = (typeof TRANSFER_FIELDS)[number];

/** Fields that take the value of the parent as it is. */
export const COPIED_FIELDS: readonly TransferField[] = Object.freeze([
	'priority',
	'status',
	'assignee',
	'project'
]);

/** What a device remembers of the last confirmed choice: never the project (ADR-0070 §2). */
export const REMEMBERED_FIELDS: readonly TransferField[] = Object.freeze(
	TRANSFER_FIELDS.filter((field) => field !== 'project')
);

/** The choice in advance on a device without a remembered one. */
export const DEFAULT_TRANSFER_FIELDS: readonly TransferField[] = Object.freeze(['due', 'priority']);

/** Key in localStorage: the last confirmed choice of a device (ADR-0070 §2). */
export const SUBTASK_TRANSFER_STORAGE_KEY = 'byl-subtask-transfer-fields';

export const TRANSFER_TARGETS_MAX = 200;
export const TRANSFER_TAGS_MAX = 100;
export const TRANSFER_SHIFT_DAYS_MAX = 3650;

/** Texts of the refusals of the route, the same as in subtask-transfer-rules.js. */
export const TRANSFER_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
	validation_transfer_expected: 'Der bekannte Stand des Haupttickets fehlt. Bitte erneut öffnen.',
	validation_transfer_fields: 'Wähle mindestens ein Feld zum Übertragen.',
	validation_transfer_field: 'Dieses Feld lässt sich nicht auf Unteraufgaben übertragen.',
	validation_transfer_due:
		'Die Fälligkeit wird gleich übernommen oder um 1 bis 3650 Tage verschoben.',
	validation_transfer_tags:
		'Tags: hinzufügen nur Tags des Haupttickets, entfernen nur Tags, die es nicht hat, je höchstens 100.',
	validation_transfer_targets: 'Wähle mindestens eine Unteraufgabe.',
	validation_transfer_targets_max: 'Höchstens 200 Unteraufgaben auf einmal.',
	validation_transfer_target:
		'Diese Unteraufgabe gehört nicht zu diesem Ticket oder liegt im Papierkorb.',
	validation_transfer_unavailable: 'Die Zuständigkeit kennt der Server noch nicht.',
	validation_transfer_missing: 'Das Ticket gibt es nicht mehr, oder es liegt im Papierkorb.'
});

/** The answer 409: the parent changed after the dialog read it. */
export const TRANSFER_STALE_MESSAGE =
	'Das Hauptticket wurde inzwischen geändert. Bitte erneut öffnen.';

/** Words of the entry and of the dialog. */
export const TRANSFER_TEXTS = Object.freeze({
	action: 'Auf Unteraufgaben übertragen …',
	title: 'Auf Unteraufgaben übertragen',
	fields: 'Felder',
	target: 'Ziel',
	choose: 'Auswählen …',
	chosenList: 'Unteraufgaben',
	done: 'Erledigt',
	submit: 'Übertragen',
	busy: 'Wird übertragen …',
	cancel: 'Abbrechen',
	loading: 'Wird geprüft …',
	retry: 'Erneut versuchen',
	restart:
		'Diese Funktion ist nach einem Neustart verfügbar: Einstellungen → System → „Jetzt neu starten“.',
	systemLink: 'Zur Seite System',
	problem: (reason: string) =>
		`Ob der Server das Übertragen schon kennt, ließ sich gerade nicht abfragen. ${reason}`,
	allOpen: (count: number) => `Alle offenen Unteraufgaben (${count})`,
	describe: (key: string) =>
		`Die gewählten Werte von ${key} gehen auf seine Unteraufgaben über. Titel, Beschreibung, Wiederholung und Art bleiben.`
});

// --- Request and answer --------------------------------------------------------------------------

/** The due date of the sub-tasks: that of the parent, or moved by a number of days (UE-2). */
export type DueTransfer = { mode: 'same' } | { mode: 'shift'; days: number };

/** Tags to add (only those of the parent) and to remove (only those it does not have, UE-2). */
export interface TagsTransfer {
	add: readonly string[];
	remove: readonly string[];
}

/** The chosen fields of a request; a field not chosen is null or false. */
export interface TransferFields {
	due: DueTransfer | null;
	priority: boolean;
	status: boolean;
	assignee: boolean;
	project: boolean;
	tags: TagsTransfer | null;
}

export const NO_TRANSFER_FIELDS: TransferFields = Object.freeze({
	due: null,
	priority: false,
	status: false,
	assignee: false,
	project: false,
	tags: null
});

/** "Alle offenen Unteraufgaben" (the server decides which), or a chosen list of IDs. */
export type TransferTargets = 'open' | readonly string[];

export interface TransferRequest {
	/** The `updated` of the parent the dialog read; another one on the server answers 409. */
	expectedUpdated: string;
	fields: TransferFields;
	targets: TransferTargets;
}

export interface TransferredTicket {
	id: string;
	key: string;
	/** The key before; another one after a new project. */
	previousKey: string;
}

export interface TransferOutcome {
	parent: { id: string; key: string };
	/** Sub-tasks that changed. */
	changed: number;
	/** Chosen sub-tasks that had every value already (not saved). */
	unchanged: number;
	tickets: readonly TransferredTicket[];
}

/** The body of POST /api/byl/tickets/{id}/subtasks/transfer. */
export function transferRequestBody(request: TransferRequest): Record<string, unknown> {
	const { fields } = request;
	const sent: Record<string, unknown> = {};
	if (fields.due !== null) sent.due = { ...fields.due };
	if (fields.priority) sent.priority = true;
	if (fields.status) sent.status = true;
	if (fields.assignee) sent.assignee = true;
	if (fields.project) sent.project = true;
	if (fields.tags !== null)
		sent.tags = { add: [...fields.tags.add], remove: [...fields.tags.remove] };
	return {
		expected_updated: request.expectedUpdated,
		fields: sent,
		targets: request.targets === 'open' ? 'open' : [...request.targets]
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The answer of the route, or null when it is not one. */
export function toTransferOutcome(value: unknown): TransferOutcome | null {
	if (!isRecord(value) || !isRecord(value.parent) || !Array.isArray(value.tickets)) return null;
	const { id, key } = value.parent;
	if (typeof id !== 'string' || typeof key !== 'string') return null;
	if (typeof value.changed !== 'number' || typeof value.unchanged !== 'number') return null;
	const tickets: TransferredTicket[] = [];
	for (const entry of value.tickets) {
		if (!isRecord(entry)) return null;
		if (typeof entry.id !== 'string' || typeof entry.key !== 'string') return null;
		const previousKey = typeof entry.previous_key === 'string' ? entry.previous_key : entry.key;
		tickets.push({ id: entry.id, key: entry.key, previousKey });
	}
	return { parent: { id, key }, changed: value.changed, unchanged: value.unchanged, tickets };
}

// --- Values and changes --------------------------------------------------------------------------

/** What the changes compare of a ticket. */
export interface TransferValues {
	due: CalendarDate | null;
	priority: Priority;
	status: Status;
	/** '' for nobody, also before the migration and in the private area. */
	assignee: string;
	/** '' without a project. */
	project: string;
	tags: readonly string[];
}

export function transferValuesOf(
	ticket: Pick<TicketSummary, 'due' | 'priority' | 'status' | 'assignee' | 'projectId' | 'tagIds'>
): TransferValues {
	return {
		due: ticket.due,
		priority: ticket.priority,
		status: ticket.status,
		assignee: ticket.assignee ?? '',
		project: ticket.projectId ?? '',
		tags: [...ticket.tagIds]
	};
}

/** The new values of a sub-task, only of the fields that change. */
export type TransferChanges = Partial<{
	due: CalendarDate | null;
	priority: Priority;
	status: Status;
	assignee: string;
	project: string;
	tags: string[];
}>;

function nextTags(own: readonly string[], tags: TagsTransfer): string[] {
	const list: string[] = [];
	for (const id of own) if (!tags.remove.includes(id) && !list.includes(id)) list.push(id);
	for (const id of tags.add) if (!list.includes(id)) list.push(id);
	return list;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((id) => b.includes(id));
}

/**
 * What a sub-task gets from its parent with the chosen fields, as the server computes it
 * (subtask-transfer-rules.js changesOf); null when it has every value already (it does not count).
 */
export function changesOf(
	parent: TransferValues,
	child: TransferValues,
	fields: TransferFields
): TransferChanges | null {
	const changes: TransferChanges = {};
	let changed = false;
	if (fields.due !== null) {
		const due =
			fields.due.mode === 'same'
				? parent.due
				: child.due === null
					? null
					: addDays(child.due, fields.due.days);
		if (due !== child.due) {
			changes.due = due;
			changed = true;
		}
	}
	if (fields.priority && parent.priority !== child.priority) {
		changes.priority = parent.priority;
		changed = true;
	}
	if (fields.status && parent.status !== child.status) {
		changes.status = parent.status;
		changed = true;
	}
	if (fields.assignee && parent.assignee !== child.assignee) {
		changes.assignee = parent.assignee;
		changed = true;
	}
	if (fields.project && parent.project !== child.project) {
		changes.project = parent.project;
		changed = true;
	}
	if (fields.tags !== null) {
		const tags = nextTags(child.tags, fields.tags);
		if (!sameSet(tags, child.tags)) {
			changes.tags = tags;
			changed = true;
		}
	}
	return changed ? changes : null;
}

// --- Targets ---------------------------------------------------------------------------------------

/**
 * A sub-task counts as open while its status is not in the category "abgeschlossen" (docs/regeln/datenmodell.md,
 * domain/status.ts): every status but "Erledigt".
 */
export function isOpenSubtask(ticket: Pick<TicketSummary, 'status'>): boolean {
	return categoryOf(ticket.status) !== 'closed';
}

/** "Alle offenen Unteraufgaben (n)" or "Auswählen …" with the chosen IDs. */
export type TargetChoice =
	{ readonly mode: 'open' } | { readonly mode: 'chosen'; readonly ids: ReadonlySet<string> };

export const OPEN_TARGETS: TargetChoice = Object.freeze({ mode: 'open' });

/**
 * "Auswählen …" starts with the open sub-tasks; the done ones stand in the list, marked, but are not
 * chosen in advance.
 */
export function chosenInAdvance(subtasks: readonly TicketSummary[]): TargetChoice {
	return {
		mode: 'chosen',
		ids: new Set(subtasks.filter(isOpenSubtask).map((ticket) => ticket.id))
	};
}

/** The sub-tasks a choice names, in the order of the list. */
export function targetsOf(
	subtasks: readonly TicketSummary[],
	choice: TargetChoice
): TicketSummary[] {
	return choice.mode === 'open'
		? subtasks.filter(isOpenSubtask)
		: subtasks.filter((ticket) => choice.ids.has(ticket.id));
}

/** The targets of the request: 'open' lets the server decide; a chosen list goes as IDs. */
export function targetsRequest(
	subtasks: readonly TicketSummary[],
	choice: TargetChoice
): TransferTargets {
	return choice.mode === 'open' ? 'open' : targetsOf(subtasks, choice).map((ticket) => ticket.id);
}

// --- The fields of the dialog --------------------------------------------------------------------

/** What the dialog needs to name the values of the parent. */
export interface TransferNames {
	/** The project of the parent as the catalog knows it, null without one. */
	project: ProjectRef | null;
	/** The names of its tags, in its order. */
	tags: readonly string[];
	/** Name of its assignee ('' for nobody); null where the area has no assignees. */
	assignee: string | null;
}

/** One checkbox: its name, the value of the parent, a hint and why it is locked (null: it is not). */
export interface FieldOffer {
	readonly field: TransferField;
	readonly label: string;
	readonly value: string;
	readonly hint: string | null;
	readonly locked: string | null;
}

export const FIELD_TEXTS = Object.freeze({
	due: 'Gleiche Fälligkeit wie das Hauptticket',
	none: 'keine',
	dueLost: 'Die Unteraufgaben verlieren ihre Fälligkeit.',
	priority: 'Priorität',
	status: 'Status',
	assignee: 'Zuständigkeit',
	nobody: 'Niemand',
	tags: 'Tags hinzufügen',
	tagsKept: 'Vorhandene Tags der Unteraufgaben bleiben.',
	tagsNone: 'Das Hauptticket hat keine Tags.',
	project: 'Projekt',
	projectNone: 'kein Projekt',
	newKeys: 'Die Unteraufgaben erhalten neue Schlüssel.',
	projectArchived: 'Das Projekt des Haupttickets ist archiviert.'
});

/**
 * The checkboxes of the dialog for `parent`: due date, priority, status, the assignee only where the
 * area has assignees, tags and project. No status needs further input in BYLJ (ADR-0070 §3), so the
 * status is never locked; tags without any and an archived project are.
 */
export function fieldOffers(
	parent: Pick<TicketSummary, 'due' | 'priority' | 'status'>,
	names: TransferNames
): FieldOffer[] {
	const offers: FieldOffer[] = [
		{
			field: 'due',
			label: FIELD_TEXTS.due,
			value: parent.due === null ? FIELD_TEXTS.none : formatCalendarDate(parent.due),
			hint: parent.due === null ? FIELD_TEXTS.dueLost : null,
			locked: null
		},
		{
			field: 'priority',
			label: FIELD_TEXTS.priority,
			value: PRIORITY_LABELS[parent.priority],
			hint: null,
			locked: null
		},
		{
			field: 'status',
			label: FIELD_TEXTS.status,
			value: STATUS_LABELS[parent.status],
			hint: null,
			locked: null
		}
	];
	if (names.assignee !== null) {
		offers.push({
			field: 'assignee',
			label: FIELD_TEXTS.assignee,
			value: names.assignee === '' ? FIELD_TEXTS.nobody : names.assignee,
			hint: null,
			locked: null
		});
	}
	offers.push(
		{
			field: 'tags',
			label: FIELD_TEXTS.tags,
			value: names.tags.length === 0 ? FIELD_TEXTS.none : names.tags.join(', '),
			hint: names.tags.length === 0 ? null : FIELD_TEXTS.tagsKept,
			locked: names.tags.length === 0 ? FIELD_TEXTS.tagsNone : null
		},
		{
			field: 'project',
			label: FIELD_TEXTS.project,
			value: names.project === null ? FIELD_TEXTS.projectNone : projectPath(names.project),
			hint: names.project?.archived ? null : FIELD_TEXTS.newKeys,
			locked: names.project?.archived ? FIELD_TEXTS.projectArchived : null
		}
	);
	return offers;
}

/**
 * The fields checked when the dialog opens: the remembered ones the dialog offers unlocked, never the
 * project, and the due date only when the parent has one (without one it stays offered).
 */
export function initialFields(
	remembered: readonly TransferField[],
	offers: readonly FieldOffer[],
	parent: Pick<TicketSummary, 'due'>
): Set<TransferField> {
	const chosen = new Set<TransferField>();
	for (const offer of offers) {
		if (offer.locked !== null || offer.field === 'project') continue;
		if (offer.field === 'due' && parent.due === null) continue;
		if (remembered.includes(offer.field)) chosen.add(offer.field);
	}
	return chosen;
}

/** The fields of the request of UE-1: the due date of the parent and its tags to add. */
export function fieldsOf(
	chosen: ReadonlySet<TransferField>,
	parent: Pick<TicketSummary, 'tagIds'>
): TransferFields {
	return {
		due: chosen.has('due') ? { mode: 'same' } : null,
		priority: chosen.has('priority'),
		status: chosen.has('status'),
		assignee: chosen.has('assignee'),
		project: chosen.has('project'),
		tags:
			chosen.has('tags') && parent.tagIds.length > 0
				? { add: [...parent.tagIds], remove: [] }
				: null
	};
}

/** Whether a request names at least one field. */
export function hasFields(fields: TransferFields): boolean {
	return (
		fields.due !== null ||
		fields.priority ||
		fields.status ||
		fields.assignee ||
		fields.project ||
		fields.tags !== null
	);
}

// --- Remembered choice -----------------------------------------------------------------------------

/** The remembered fields of a confirmed choice: in the order of the dialog, never the project. */
export function rememberedOf(chosen: Iterable<TransferField>): TransferField[] {
	const set = new Set(chosen);
	return REMEMBERED_FIELDS.filter((field) => set.has(field));
}

/** The stored value: a JSON list of fields. */
export function serializeRememberedFields(fields: Iterable<TransferField>): string {
	return JSON.stringify(rememberedOf(fields));
}

/**
 * The remembered fields of a stored value; nothing stored or anything that is no list gives the
 * default (due date and priority). Unknown names and the project are dropped; an empty list stays
 * empty (the last choice was the project alone).
 */
export function parseRememberedFields(raw: string | null | undefined): TransferField[] {
	if (raw === null || raw === undefined) return [...DEFAULT_TRANSFER_FIELDS];
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return [...DEFAULT_TRANSFER_FIELDS];
	}
	if (!Array.isArray(value)) return [...DEFAULT_TRANSFER_FIELDS];
	return rememberedOf(
		value.filter((entry): entry is TransferField =>
			(REMEMBERED_FIELDS as readonly unknown[]).includes(entry)
		)
	);
}

// --- Summary and result ----------------------------------------------------------------------------

export interface TransferSummary {
	/** Chosen sub-tasks. */
	readonly total: number;
	/** Those that change (one that has every value already does not count). */
	readonly changing: number;
	/** Open ongoing projects among those that change and become done. */
	readonly ongoing: number;
}

/** What a request would change, as the client knows the sub-tasks. */
export function transferSummary(
	parent: Pick<TicketSummary, 'due' | 'priority' | 'status' | 'assignee' | 'projectId' | 'tagIds'>,
	targets: readonly TicketSummary[],
	fields: TransferFields
): TransferSummary {
	const values = transferValuesOf(parent);
	const changing = targets.filter(
		(target) => changesOf(values, transferValuesOf(target), fields) !== null
	);
	const completes = fields.status && parent.status === 'done' ? openOngoing(changing).length : 0;
	return { total: targets.length, changing: changing.length, ongoing: completes };
}

function subtasksWord(count: number): string {
	return count === 1 ? 'Unteraufgabe' : 'Unteraufgaben';
}

/** "Ändert 3 von 4 Unteraufgaben." and what completing an ongoing project means. */
export function summaryText(summary: TransferSummary): string {
	if (summary.total === 0) return 'Keine Unteraufgabe gewählt.';
	const base =
		summary.changing === 0
			? `Ändert keine der ${summary.total} gewählten ${subtasksWord(summary.total)}: Sie haben diese Werte schon.`
			: `Ändert ${summary.changing} von ${summary.total} ${subtasksWord(summary.total)}.`;
	if (summary.ongoing === 0) return base;
	const ongoing =
		summary.ongoing === 1
			? 'Darunter ist ein laufendes Vorhaben; es wird damit abgeschlossen.'
			: `Darunter sind ${summary.ongoing} laufende Vorhaben; sie werden damit abgeschlossen.`;
	return `${base} ${ongoing}`;
}

/** The title of the flag after the transfer. */
export function transferredText(changed: number): string {
	if (changed === 0) return 'Nichts übertragen: Die Unteraufgaben hatten diese Werte schon.';
	return `Auf ${changed} ${subtasksWord(changed)} übertragen.`;
}

/** The message of a refused sub-task: "GART-3: Das Projekt ist archiviert." */
export function targetFailureText(key: string, message: string): string {
	return `${key}: ${message}`;
}
