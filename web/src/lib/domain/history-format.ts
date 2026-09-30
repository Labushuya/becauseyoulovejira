// Readable history entries (E2 plan, T-9 and T-10). Pure: the raw values of ticket_history
// (OF-12) become German text; projects and tags are resolved through lookup lists, unknown IDs
// appear as "(gelöscht)". Descriptions are returned as plain text for a collapsible detail and
// never rendered as Markdown.

import { formatCalendarDate, formatBerlinDateTime } from './format';
import { CHANNEL_LABELS, isInboxChannel } from './inbox';
import { PRIORITY_LABELS, STATUS_LABELS, historyFieldLabel } from './labels';
import { personLabel } from './people';
import { SKIPPED_FIELD, parseSkipped, skippedText } from './recurrence-rule';
import { isPriority, isStatus } from './status';
import {
	toDueInput,
	type Comment,
	type HistoryEntry,
	type ProjectRef,
	type TagRef
} from './ticket';

export const EMPTY_VALUE = '–';
export const DELETED_VALUE = '(gelöscht)';

/**
 * Projects and tags visible to the user, keyed by record ID; the loaded comments of the ticket
 * name a pinned comment by author and time (ADR-0044).
 */
export interface HistoryLookups {
	projects: ReadonlyMap<string, ProjectRef>;
	tags: ReadonlyMap<string, TagRef>;
	comments?: ReadonlyMap<string, Pick<Comment, 'author' | 'created'>>;
}

/** Lookups from the visible projects and tags (read-only after creation). */
export function historyLookups(
	projects: readonly ProjectRef[],
	tags: readonly TagRef[]
): HistoryLookups {
	return {
		projects: new Map(projects.map((project) => [project.id, project])),
		tags: new Map(tags.map((tag) => [tag.id, tag]))
	};
}

/** The lookups plus the loaded comments of the ticket (ADR-0044). */
export function withComments(
	lookups: HistoryLookups,
	comments: readonly Pick<Comment, 'id' | 'author' | 'created'>[]
): HistoryLookups {
	return { ...lookups, comments: new Map(comments.map((comment) => [comment.id, comment])) };
}

export interface HistoryLine {
	id: string;
	/** Berlin local time `TT.MM.JJJJ HH:MM`. */
	time: string;
	/** "Du", "System" or "Anderes Konto" (T-9). */
	actor: string;
	/** What happened, e.g. "Status: Offen → In Arbeit". */
	text: string;
	/** Old and new text of a changed description, shown collapsed as plain text. */
	details: { before: string; after: string } | null;
}

const orEmpty = (value: string) => (value === '' ? EMPTY_VALUE : value);

function statusText(value: string): string {
	return isStatus(value) ? STATUS_LABELS[value] : orEmpty(value);
}

function priorityText(value: string): string {
	return isPriority(value) ? PRIORITY_LABELS[value] : orEmpty(value);
}

/** Stored due value as `TT.MM.JJJJ`; an unexpected value is shown as stored. */
function dueText(value: string): string {
	try {
		const date = toDueInput(value);
		return date === '' ? EMPTY_VALUE : formatCalendarDate(date);
	} catch {
		return value;
	}
}

function projectText(value: string, lookups: HistoryLookups): string {
	if (value === '') return EMPTY_VALUE;
	const project = lookups.projects.get(value);
	return project === undefined ? DELETED_VALUE : `${project.name} (${project.code})`;
}

/** Tag IDs of a stored tags value: '' or a sorted JSON array of IDs (history.js). */
function tagIds(value: string): string[] {
	if (value === '') return [];
	try {
		const parsed: unknown = JSON.parse(value);
		if (Array.isArray(parsed)) return parsed.filter((item) => typeof item === 'string');
	} catch {
		// A single ID without JSON: shown like one tag.
	}
	return [value];
}

function tagNames(ids: string[], lookups: HistoryLookups): string {
	return ids.map((id) => lookups.tags.get(id)?.name ?? DELETED_VALUE).join(', ');
}

function tagsText(oldValue: string, newValue: string, lookups: HistoryLookups): string {
	const before = tagIds(oldValue);
	const after = tagIds(newValue);
	const added = after.filter((id) => !before.includes(id));
	const removed = before.filter((id) => !after.includes(id));
	const parts: string[] = [];
	if (added.length > 0) {
		parts.push(`${added.length === 1 ? 'Tag' : 'Tags'} hinzugefügt: ${tagNames(added, lookups)}`);
	}
	if (removed.length > 0) {
		parts.push(`${removed.length === 1 ? 'Tag' : 'Tags'} entfernt: ${tagNames(removed, lookups)}`);
	}
	return parts.length === 0 ? 'Tags geändert' : parts.join('; ');
}

/** Empty household: private area; any household ID: the household area (P-5). */
function areaText(value: string): string {
	return value === '' ? 'Privat' : 'Haushalt';
}

/**
 * The inbox item of a "source_link" entry (ADR-0031 section 2): JSON with item, channel and title
 * as the hook wrote it, e.g. `Mail „Rechnung März“`; '' when the value is not readable.
 */
function sourceText(parsed: Record<string, unknown> | null): string {
	if (parsed === null) return '';
	const { channel, title } = parsed;
	const label = isInboxChannel(channel) ? CHANNEL_LABELS[channel] : '';
	const name = typeof title === 'string' && title !== '' ? `„${title}“` : '';
	return [label, name].filter((part) => part !== '').join(' ');
}

function parseSourceValue(value: string): Record<string, unknown> | null {
	try {
		const parsed: unknown = JSON.parse(value);
		return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

/** Key of the other ticket of a move (`moved_to` or `moved_from`, ADR-0031 addendum), else ''. */
function movedKey(
	parsed: Record<string, unknown> | null,
	field: 'moved_to' | 'moved_from'
): string {
	const other = parsed?.[field];
	if (typeof other !== 'object' || other === null) return '';
	const { key } = other as { key?: unknown };
	return typeof key === 'string' ? key : '';
}

/**
 * Linking (new value set) or releasing (old value set) a source of the ticket; a move to or from
 * another ticket names it ("Quelle verschoben nach HAUS-13: …", "Quelle verschoben von HAUS-12: …").
 */
function sourceLinkText(oldValue: string, newValue: string): string {
	const linked = newValue !== '';
	const parsed = parseSourceValue(linked ? newValue : oldValue);
	const what = sourceText(parsed);
	const moved = parsed !== null && (linked ? 'moved_from' : 'moved_to') in parsed;
	const key = movedKey(parsed, linked ? 'moved_from' : 'moved_to');
	let verb = linked ? 'Quelle verknüpft' : 'Quelle gelöst';
	if (moved) {
		const direction = linked ? 'von' : 'nach';
		verb = key === '' ? 'Quelle verschoben' : `Quelle verschoben ${direction} ${key}`;
	}
	return what === '' ? verb : `${verb}: ${what}`;
}

function change(label: string, before: string, after: string): string {
	return `${label}: ${before} → ${after}`;
}

/** A line with a task marker: containers in front, the mark, the text of the task. */
const TASK_LINE = /^([ \t>]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+[ \t>]*)*)\[([ xX])\](.*)$/;

/** Longest task text a history entry names. */
const TASK_TEXT_MAX = 80;

/**
 * "Aufgabe abgehakt: …" or "Aufgabe wieder offen: …" when a change of the description only ticks
 * or unticks one task (ADR-0032 section 6: ticking in the view), else null. Line based on purpose:
 * the history needs no Markdown parser, and anything else counts as an ordinary change.
 */
function taskToggleText(before: string, after: string): string | null {
	const old = before.split(/\r\n|\r|\n/);
	const next = after.split(/\r\n|\r|\n/);
	if (old.length !== next.length) return null;
	const changed = old.flatMap((line, index) => (line === next[index] ? [] : [index]));
	if (changed.length !== 1) return null;
	const index = changed[0] ?? 0;
	const was = TASK_LINE.exec(old[index] ?? '');
	const is = TASK_LINE.exec(next[index] ?? '');
	if (was === null || is === null || was[1] !== is[1] || was[3] !== is[3]) return null;
	const ticked = is[2] !== ' ';
	if ((was[2] !== ' ') === ticked) return null;
	// Markdown escapes of the generators ("1\.5") are shown without their backslash.
	const task = (is[3] ?? '').trim().replace(/\\([!-/:-@[-`{-~])/g, '$1');
	const shown = task.length > TASK_TEXT_MAX ? `${task.slice(0, TASK_TEXT_MAX - 1)}…` : task;
	const verb = ticked ? 'Aufgabe abgehakt' : 'Aufgabe wieder offen';
	return shown === '' ? verb : `${verb}: ${shown}`;
}

/**
 * Pinning a comment (ADR-0044 section 2): pinned (empty → ID), released (ID → empty) or replaced
 * (ID → ID). The comment it now concerns (the new one, or the released one) is named by author and
 * time while it is loaded; a deleted comment is not.
 */
function pinText(
	oldValue: string,
	newValue: string,
	lookups: HistoryLookups,
	selfId: string | null
): string {
	let verb = 'Angepinnten Kommentar ersetzt';
	if (oldValue === '') verb = 'Kommentar angepinnt';
	else if (newValue === '') verb = 'Anpinnen gelöst';
	const comment = lookups.comments?.get(newValue === '' ? oldValue : newValue);
	if (comment === undefined) return verb;
	const author = personLabel(comment.author, selfId);
	return `${verb}: Kommentar von ${author} vom ${formatBerlinDateTime(comment.created)}`;
}

/** Text of one entry, without actor and time. */
function describe(entry: HistoryEntry, lookups: HistoryLookups, selfId: string | null): string {
	const { field, oldValue, newValue } = entry;
	switch (field) {
		case 'created':
			return newValue === '' ? 'hat das Ticket angelegt' : `hat das Ticket angelegt (${newValue})`;
		case 'title':
			return change('Titel', orEmpty(oldValue), orEmpty(newValue));
		case 'description':
			return taskToggleText(oldValue, newValue) ?? 'Beschreibung geändert';
		case 'status':
			return change('Status', statusText(oldValue), statusText(newValue));
		case 'priority':
			return change('Priorität', priorityText(oldValue), priorityText(newValue));
		case 'due':
			if (oldValue === '') return `Fälligkeit gesetzt: ${dueText(newValue)}`;
			if (newValue === '') return `Fälligkeit entfernt (war ${dueText(oldValue)})`;
			return change('Fälligkeit', dueText(oldValue), dueText(newValue));
		case 'key':
			return change('Key geändert', orEmpty(oldValue), orEmpty(newValue));
		case 'project':
			return change('Projekt', projectText(oldValue, lookups), projectText(newValue, lookups));
		case 'tags':
			return tagsText(oldValue, newValue, lookups);
		case 'household':
			return change('Bereich', areaText(oldValue), areaText(newValue));
		case 'recurrence':
			// E5 plan, T-9: joining a series ("Wiederholen…"), leaving it or deleting its rule.
			if (oldValue === '') return 'Wiederholung eingerichtet';
			if (newValue === '') return 'Wiederholung entfernt';
			return 'Wiederholung geändert';
		case 'source_link':
			return sourceLinkText(oldValue, newValue);
		case 'pinned_comment':
			return pinText(oldValue, newValue, lookups, selfId);
		case SKIPPED_FIELD: {
			// ADR-0022 addendum 4: a catch-up ticket names the missed dates it stands for.
			const skipped = parseSkipped(newValue);
			return skipped === null
				? 'Verpasste Termine zusammengefasst'
				: `${skippedText(skipped)}, zusammengefasst in diesem Ticket`;
		}
		default:
			return `${historyFieldLabel(field)} geändert`;
	}
}

/** Author of a ticket a recurrence rule created (E5 plan, T-9). */
export const RECURRENCE_ACTOR = 'Wiederholung';

/**
 * A rule created the ticket: the entry "created" has no user and the rule as old value (the
 * hook writes it so since E5, package 3).
 */
function createdByRule(entry: HistoryEntry): boolean {
	return (
		(entry.field === 'created' || entry.field === SKIPPED_FIELD) &&
		entry.user === '' &&
		entry.oldValue !== ''
	);
}

/** Readable form of a history entry for the signed-in user `selfId`. */
export function describeHistoryEntry(
	entry: HistoryEntry,
	lookups: HistoryLookups,
	selfId: string | null
): HistoryLine {
	return {
		id: entry.id,
		time: formatBerlinDateTime(entry.created),
		actor: createdByRule(entry) ? RECURRENCE_ACTOR : personLabel(entry.user, selfId),
		text: describe(entry, lookups, selfId),
		details:
			entry.field === 'description' ? { before: entry.oldValue, after: entry.newValue } : null
	};
}
