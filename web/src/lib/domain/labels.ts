// German UI labels for status, priority and history fields (CLAUDE.md sections 7 and 8).
// The identifiers stay English in code (E1 plan, package 2).

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
	household: 'Haushalt'
});

/** Label of a history field; an unknown field shows its technical name instead of nothing. */
export function historyFieldLabel(field: string): string {
	return Object.hasOwn(HISTORY_FIELD_LABELS, field)
		? (HISTORY_FIELD_LABELS[field] ?? field)
		: field;
}
