// "Ticket duplizieren" (ADR-0045): what the SPA sends to the route and reads from its answer, and
// the rules of the question "Wie soll das Duplikat entstehen?". Pure. The texts of the codes are the
// same as in app/pb_hooks/lib/duplicate-rules.js (tests/unit/web-duplicate.test.mjs).

import { CHANNEL_LABELS, type InboxItemSummary } from './inbox';
import type { Status } from './status';
import { keyList } from './ticket-origins';

/** A duplicate starts as new work: every status but "Erledigt". */
export type DuplicateStatus = Exclude<Status, 'done'>;

/** No source (the default), or a copy of the main source of the original. */
export type DuplicateSource = 'none' | 'copy';

/** What the duplicate takes over from the original (and its new sub-tasks from theirs). */
export interface DuplicateTake {
	description: boolean;
	priority: boolean;
	tags: boolean;
	due: boolean;
	/** A sub-task stays below the same parent. */
	parent: boolean;
	/** New, open sub-tasks from those of the original. */
	subtasks: boolean;
	/** Copies of the comments with the note "Kopiert aus …". */
	comments: boolean;
	/** The own color of the ticket (ADR-0052); without it the copy shows the color of its project. */
	color: boolean;
}

export interface DuplicateRequest {
	title: string;
	status: DuplicateStatus;
	/** Project of the duplicate, null for none; the hook gives the key of its number range. */
	project: string | null;
	take: DuplicateTake;
	source: DuplicateSource;
}

/** A ticket the duplication created, by ID and key. */
export interface DuplicateRef {
	id: string;
	key: string;
}

/** Answer of the route. */
export interface DuplicateOutcome extends DuplicateRef {
	title: string;
	original: DuplicateRef;
	subtasks: DuplicateRef[];
	/** Number of copied comments. */
	comments: number;
	/** The copied source, null without one. */
	source: string | null;
}

/** Texts of the codes of the route, the same as the hook's. */
export const DUPLICATE_MESSAGES = Object.freeze({
	validation_duplicate_title: 'Bitte einen Titel mit höchstens 200 Zeichen angeben.',
	validation_duplicate_status_required: 'Bitte wählen, mit welchem Status das Duplikat startet.',
	validation_duplicate_status:
		'Ein Duplikat startet mit Backlog, Offen, In Arbeit oder Wartet, nie als „Erledigt“.',
	validation_duplicate_source: 'Diese Wahl der Quelle gibt es nicht.',
	validation_duplicate_source_missing:
		'Das Original hat keine Hauptquelle, die sich kopieren ließe.',
	validation_duplicate_source_file:
		'Die Originaldatei der Hauptquelle fehlt; die Herkunft lässt sich so nicht vollständig kopieren.'
});

/** Request body of the route. */
export function duplicateRequestBody(request: DuplicateRequest): Record<string, string | boolean> {
	return {
		title: request.title,
		status: request.status,
		project: request.project ?? '',
		source: request.source,
		description: request.take.description,
		priority: request.take.priority,
		tags: request.take.tags,
		due: request.take.due,
		parent: request.take.parent,
		subtasks: request.take.subtasks,
		comments: request.take.comments,
		color: request.take.color
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toRef(value: unknown): DuplicateRef | null {
	if (!isRecord(value)) return null;
	const { id, key } = value;
	return typeof id === 'string' && id !== '' && typeof key === 'string' ? { id, key } : null;
}

/** The answer of the route, or null when it is not one. */
export function toDuplicateOutcome(value: unknown): DuplicateOutcome | null {
	if (!isRecord(value)) return null;
	const ref = toRef(value);
	const original = toRef(value.original);
	const { title, subtasks, comments, source } = value;
	if (ref === null || original === null || typeof title !== 'string') return null;
	if (!Array.isArray(subtasks) || typeof comments !== 'number' || typeof source !== 'string') {
		return null;
	}
	const children: DuplicateRef[] = [];
	for (const entry of subtasks as unknown[]) {
		const child = toRef(entry);
		if (child === null) return null;
		children.push(child);
	}
	return {
		...ref,
		title,
		original,
		subtasks: children,
		comments,
		source: source === '' ? null : source
	};
}

/** Longest title of a ticket (tickets.title). */
export const DUPLICATE_TITLE_MAX = 200;

/** What the title of the original gets for the duplicate. */
export const DUPLICATE_TITLE_SUFFIX = ' (Kopie)';

/**
 * The title the question starts with: "‹Titel› (Kopie)". A long title is cut before the suffix
 * with "…", so the whole stays within DUPLICATE_TITLE_MAX.
 */
export function duplicateTitle(title: string): string {
	const base = title.trim();
	if (base.length + DUPLICATE_TITLE_SUFFIX.length <= DUPLICATE_TITLE_MAX) {
		return `${base}${DUPLICATE_TITLE_SUFFIX}`;
	}
	const room = DUPLICATE_TITLE_MAX - DUPLICATE_TITLE_SUFFIX.length - 1;
	return `${base.slice(0, room).trimEnd()}…${DUPLICATE_TITLE_SUFFIX}`;
}

/**
 * What the question takes over at first: the fields of the ticket with its color (ADR-0052), not
 * sub-tasks and comments.
 */
export const DEFAULT_TAKE: Readonly<DuplicateTake> = Object.freeze({
	description: true,
	priority: true,
	tags: true,
	due: true,
	parent: true,
	subtasks: false,
	comments: false,
	color: true
});

/** The answers of the question "Wie soll das Duplikat entstehen?". */
export interface DuplicateForm {
	title: string;
	/** '' until the user chooses: no answer in advance (ADR-0045 §2). */
	status: DuplicateStatus | '';
	/** "Projekt" is checked: the duplicate goes into `project`. */
	takeProject: boolean;
	/** The chosen project, '' for none. */
	project: string;
	take: DuplicateTake;
	source: DuplicateSource;
}

/**
 * The question as it starts for a ticket: its title with "(Kopie)", its project if that can still
 * take tickets (one of `activeProjectIds`; an archived one cannot), no status, no source.
 */
export function initialDuplicateForm(
	ticket: { title: string; projectId: string | null },
	activeProjectIds: readonly string[]
): DuplicateForm {
	const project =
		ticket.projectId !== null && activeProjectIds.includes(ticket.projectId)
			? ticket.projectId
			: '';
	return {
		title: duplicateTitle(ticket.title),
		status: '',
		takeProject: true,
		project,
		take: { ...DEFAULT_TAKE },
		source: 'none'
	};
}

/** Fields of the question that carry an error of their own. */
export type DuplicateField = 'title' | 'status' | 'project' | 'source';

/** Errors of the question before sending: a title of 1 to 200 characters and a status. */
export function duplicateFormErrors(
	form: Pick<DuplicateForm, 'title' | 'status'>
): Partial<Record<DuplicateField, string>> {
	const errors: Partial<Record<DuplicateField, string>> = {};
	const title = form.title.trim();
	if (title === '' || title.length > DUPLICATE_TITLE_MAX) {
		errors.title = DUPLICATE_MESSAGES.validation_duplicate_title;
	}
	if (form.status === '') errors.status = DUPLICATE_MESSAGES.validation_duplicate_status_required;
	return errors;
}

/** The request of an answered question. */
export function duplicateRequestOf(
	form: DuplicateForm & { status: DuplicateStatus }
): DuplicateRequest {
	return {
		title: form.title.trim(),
		status: form.status,
		project: form.takeProject && form.project !== '' ? form.project : null,
		take: { ...form.take },
		source: form.source
	};
}

/**
 * What "Kopie der Herkunft übernehmen" does with the main source of the original and, since QT-1
 * (ADR-0067), with its source tickets (`ticketKeys`, the live ones), or why it is not possible
 * without either.
 */
export function copySourceHint(
	main: Pick<InboxItemSummary, 'title' | 'channel' | 'original'> | null,
	key: string,
	ticketKeys: readonly string[] = []
): string {
	const tickets = ticketKeys.length > 0 ? keyList(ticketKeys) : '';
	if (main === null) {
		return tickets === ''
			? DUPLICATE_MESSAGES.validation_duplicate_source_missing
			: `Das Duplikat stammt wie das Original aus ${tickets}.`;
	}
	const what =
		main.original === '' ? 'mit Text und Details' : 'mit Text, Details und Originaldatei';
	const copy = `Ein neuer Eintrag als Kopie von „${main.title}“ (${CHANNEL_LABELS[main.channel]}) wird die Hauptquelle des Duplikats, ${what}, gekennzeichnet als „Kopie aus ${key}“.`;
	return tickets === '' ? copy : `${copy} Außerdem stammt es wie das Original aus ${tickets}.`;
}

/** Text of a history entry "duplicate" (ADR-0045 §6): "Dupliziert aus HAUS-12" or "… nach HAUS-13". */
export function duplicateHistoryText(value: string): string {
	try {
		const parsed: unknown = JSON.parse(value);
		if (isRecord(parsed)) {
			const { direction, key } = parsed;
			const other = typeof key === 'string' && key !== '' ? ` ${key}` : '';
			if (direction === 'from') return `Dupliziert aus${other}`;
			if (direction === 'to') return `Dupliziert nach${other}`;
		}
	} catch {
		// Not readable: named without the other ticket.
	}
	return 'Dupliziert';
}

/** The flag after duplicating: what happened, the new key and the way back to the original. */
export function duplicatedFlag(
	originalKey: string,
	duplicateKey: string
): { title: string; description: string; action: string } {
	return {
		title: `${originalKey} dupliziert.`,
		description: `Das Duplikat ist ${duplicateKey}.`,
		action: `${originalKey} öffnen`
	};
}
