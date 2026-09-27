// Readable history entries (E2 plan, T-9 and T-10). Pure: the raw values of ticket_history
// (OF-12) become German text; projects and tags are resolved through lookup lists, unknown IDs
// appear as "(gelöscht)". Descriptions are returned as plain text for a collapsible detail and
// never rendered as Markdown.

import { formatCalendarDate, formatBerlinDateTime } from './format';
import { CHANNEL_LABELS, isInboxChannel } from './inbox';
import { PRIORITY_LABELS, STATUS_LABELS, historyFieldLabel } from './labels';
import { personLabel } from './people';
import { isPriority, isStatus } from './status';
import { toDueInput, type HistoryEntry, type ProjectRef, type TagRef } from './ticket';

export const EMPTY_VALUE = '–';
export const DELETED_VALUE = '(gelöscht)';

/** Projects and tags visible to the user, keyed by record ID. */
export interface HistoryLookups {
	projects: ReadonlyMap<string, ProjectRef>;
	tags: ReadonlyMap<string, TagRef>;
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
function sourceText(value: string): string {
	try {
		const parsed: unknown = JSON.parse(value);
		if (typeof parsed !== 'object' || parsed === null) return '';
		const { channel, title } = parsed as { channel?: unknown; title?: unknown };
		const label = isInboxChannel(channel) ? CHANNEL_LABELS[channel] : '';
		const name = typeof title === 'string' && title !== '' ? `„${title}“` : '';
		return [label, name].filter((part) => part !== '').join(' ');
	} catch {
		return '';
	}
}

/** Linking (new value set) or releasing (old value set) a source of the ticket. */
function sourceLinkText(oldValue: string, newValue: string): string {
	const linked = newValue !== '';
	const what = sourceText(linked ? newValue : oldValue);
	const verb = linked ? 'Quelle verknüpft' : 'Quelle gelöst';
	return what === '' ? verb : `${verb}: ${what}`;
}

function change(label: string, before: string, after: string): string {
	return `${label}: ${before} → ${after}`;
}

/** Text of one entry, without actor and time. */
function describe(entry: HistoryEntry, lookups: HistoryLookups): string {
	const { field, oldValue, newValue } = entry;
	switch (field) {
		case 'created':
			return newValue === '' ? 'hat das Ticket angelegt' : `hat das Ticket angelegt (${newValue})`;
		case 'title':
			return change('Titel', orEmpty(oldValue), orEmpty(newValue));
		case 'description':
			return 'Beschreibung geändert';
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
	return entry.field === 'created' && entry.user === '' && entry.oldValue !== '';
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
		text: describe(entry, lookups),
		details:
			entry.field === 'description' ? { before: entry.oldValue, after: entry.newValue } : null
	};
}
