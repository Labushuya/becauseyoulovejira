// "Ticket duplizieren" (ADR-0045): what the SPA sends to the route and reads from its answer. Pure.
// The texts of the codes are the same as in app/pb_hooks/lib/duplicate-rules.js
// (tests/unit/web-duplicate.test.mjs).

import type { Status } from './status';

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
		comments: request.take.comments
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
