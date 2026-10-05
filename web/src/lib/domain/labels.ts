// German UI labels for status, priority and history fields (CLAUDE.md sections 7 and 8).
// The identifiers stay English in code (E1 plan, package 2).

import type { SortKey, SortSpec } from './ordering';
import type { Priority, Status } from './status';

export const STATUS_LABELS: Readonly<Record<Status, string>> = Object.freeze({
	backlog: 'Backlog',
	open: 'Offen',
	in_progress: 'In Arbeit',
	waiting: 'Wartet',
	done: 'Erledigt'
});

export const PRIORITY_LABELS: Readonly<Record<Priority, string>> = Object.freeze({
	low: 'Niedrig',
	medium: 'Mittel',
	high: 'Hoch',
	urgent: 'Dringend'
});

/**
 * Fields of ticket_history: "created" for the creation entry plus the tracked fields of
 * app/pb_hooks/lib/history.js (tests/unit/web-labels.test.mjs keeps both in sync).
 */
export const HISTORY_FIELD_LABELS: Readonly<Record<string, string>> = Object.freeze({
	created: 'Angelegt',
	title: 'Titel',
	description: 'Beschreibung',
	status: 'Status',
	priority: 'Priorität',
	due: 'Fälligkeit',
	project: 'Projekt',
	tags: 'Tags',
	parent: 'Übergeordnetes Ticket',
	blocks_parent: 'Blockiert übergeordnetes Ticket',
	recurrence: 'Wiederholung',
	key: 'Key',
	household: 'Haushalt',
	pinned_comment: 'Angepinnter Kommentar',
	color: 'Farbe',
	charm: 'Charm',
	kind: 'Art'
});

/** Label of a history field; an unknown field shows its technical name instead of nothing. */
export function historyFieldLabel(field: string): string {
	return Object.hasOwn(HISTORY_FIELD_LABELS, field)
		? (HISTORY_FIELD_LABELS[field] ?? field)
		: field;
}

/** Column names of the sort buttons (E3 plan, T-5): "Nach Priorität sortieren". */
export const SORT_COLUMN_LABELS: Readonly<Record<SortKey, string>> = Object.freeze({
	key: 'Key',
	priority: 'Priorität',
	status: 'Status',
	title: 'Titel',
	project: 'Projekt',
	due: 'Fälligkeit',
	created: 'Erstellt',
	assignee: 'Zuständig'
});

/** Order of a column in words: natural direction (first click), then reversed (T-5). */
const SORT_ORDER_LABELS: Readonly<Record<SortKey, readonly [string, string]>> = Object.freeze({
	key: ['aufsteigend', 'absteigend'],
	priority: ['Dringend zuerst', 'Niedrig zuerst'],
	status: ['Backlog zuerst', 'Wartet zuerst'],
	title: ['A bis Z', 'Z bis A'],
	project: ['A bis Z', 'Z bis A'],
	due: ['früheste zuerst', 'späteste zuerst'],
	created: ['neueste zuerst', 'älteste zuerst'],
	assignee: ['A bis Z', 'Z bis A']
});

/** The order of a column sort in words, e.g. "Dringend zuerst". */
export function sortOrderLabel(spec: SortSpec): string {
	const [natural, reversed] = SORT_ORDER_LABELS[spec.key];
	return spec.reversed ? reversed : natural;
}

/**
 * End of a table caption while a narrow frame hides columns (package UI-6b); a component shows it
 * through a container query. The leading space is part of the text, so it stays in the caption.
 */
export const MORE_COLUMNS_HINT = ' · Weitere Spalten im Panel';

/** The column sort in words, e.g. "Priorität, Dringend zuerst". */
export function sortLabel(spec: SortSpec): string {
	return `${SORT_COLUMN_LABELS[spec.key]}, ${sortOrderLabel(spec)}`;
}
