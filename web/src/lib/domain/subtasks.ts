// Sub-tasks (ADR-0033): order and progress of the sub-tasks of a ticket, the texts of the hook
// codes and of the question before completing, what a new sub-task takes from its parent. Pure.

import type { CalendarDate } from './berlin-date';
import { subtaskStatusOf, type TemplateStatus } from './series-template';
import type { ParentRef, TicketSummary } from './ticket';

/**
 * Texts of the parent guard and the completion guard, the same as the hook
 * (app/pb_hooks/lib/ticket-rules.js, SUBTASK_MESSAGES; tests/unit/web-subtasks.test.mjs).
 */
export const SUBTASK_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
	validation_parent_self: 'Ein Ticket kann nicht sein eigenes übergeordnetes Ticket sein.',
	validation_parent_nested: 'Das gewählte Ticket ist selbst eine Unteraufgabe (nur eine Ebene).',
	validation_parent_has_children: 'Ein Ticket mit Unteraufgaben kann keine Unteraufgabe werden.',
	validation_ticket_has_children: 'Ein Ticket mit Unteraufgaben kann den Bereich nicht wechseln.',
	validation_parent_open_children: 'Offene Unteraufgaben blockieren das Erledigen.'
});

/** "1 Unteraufgabe" or "3 Unteraufgaben". */
export function subtaskCountText(count: number): string {
	return count === 1 ? '1 Unteraufgabe' : `${count} Unteraufgaben`;
}

/** "3 Unteraufgaben sind noch offen." (refusal of the hook with its count). */
export function openChildrenMessage(count: number): string {
	return `${subtaskCountText(count)} ${count === 1 ? 'ist' : 'sind'} noch offen.`;
}

/**
 * Answer to "N Unteraufgaben sind noch offen – trotzdem erledigen?" (ADR-0033 section 2):
 * complete the blocking sub-tasks with the ticket, or complete it anyway. The values are the body
 * fields the hook reads.
 */
export type CompletionChoice = 'complete_children' | 'force';

/** The choices in the order of the question; the first one is chosen at first. */
export const COMPLETION_CHOICES: readonly CompletionChoice[] = Object.freeze([
	'complete_children',
	'force'
]);

export const COMPLETION_LABELS: Readonly<Record<CompletionChoice, string>> = Object.freeze({
	complete_children: 'Unteraufgaben mit erledigen',
	force: 'Trotzdem erledigen'
});

/** Question before completing a ticket with open blocking sub-tasks. */
export function openChildrenQuestion(count: number): string {
	return `${subtaskCountText(count)} ${count === 1 ? 'ist' : 'sind'} noch offen – trotzdem erledigen?`;
}

/** "HAUS-13", "HAUS-13 und HAUS-14", "HAUS-13, HAUS-14 und 2 weitere" (at most three keys). */
export function keysText(keys: readonly string[], count = keys.length): string {
	const shown = keys.slice(0, 3);
	const rest = count - shown.length;
	if (rest > 0) return `${shown.join(', ')} und ${rest === 1 ? '1 weitere' : `${rest} weitere`}`;
	if (shown.length <= 1) return shown.join('');
	return `${shown.slice(0, -1).join(', ')} und ${shown.at(-1) ?? ''}`;
}

/** What a choice does, named with the keys of the sub-tasks. */
export function completionHint(
	choice: CompletionChoice,
	keys: readonly string[],
	count: number
): string {
	const one = count === 1;
	if (choice === 'force') {
		return one ? 'Die Unteraufgabe bleibt offen.' : 'Die Unteraufgaben bleiben offen.';
	}
	return `${keysText(keys, count)} ${one ? 'wird' : 'werden'} ebenfalls erledigt.`;
}

/** Open sub-tasks that block completing their parent (`blocks_parent`, true unless switched off). */
export function openBlocking<T extends Pick<TicketSummary, 'status' | 'blocksParent'>>(
	subtasks: readonly T[]
): T[] {
	return subtasks.filter((entry) => entry.status !== 'done' && entry.blocksParent !== false);
}

export type SubtaskLike = Pick<TicketSummary, 'id' | 'status' | 'created'>;

/** Order of the section "Unteraufgaben": open ones first, then by creation, last the ID. */
export function compareSubtasks(a: SubtaskLike, b: SubtaskLike): number {
	const doneA = a.status === 'done' ? 1 : 0;
	const doneB = b.status === 'done' ? 1 : 0;
	if (doneA !== doneB) return doneA - doneB;
	if (a.created !== b.created) return a.created < b.created ? -1 : 1;
	if (a.id === b.id) return 0;
	return a.id < b.id ? -1 : 1;
}

export interface SubtaskProgress {
	done: number;
	total: number;
}

/** How many sub-tasks are done of all of them. */
export function subtaskProgress(
	children: readonly Pick<TicketSummary, 'status'>[]
): SubtaskProgress {
	return {
		done: children.filter((child) => child.status === 'done').length,
		total: children.length
	};
}

/** "2/5 erledigt" next to the section and, shorter, "2/5" at the title in the table. */
export function progressText({ done, total }: SubtaskProgress): string {
	return `${done}/${total} erledigt`;
}

/** Name of the progress for screen readers: "2 von 5 Unteraufgaben erledigt". */
export function progressLabel({ done, total }: SubtaskProgress): string {
	return `${done} von ${subtaskCountText(total)} erledigt`;
}

/** Share of done sub-tasks in percent, 0 without sub-tasks. */
export function progressPercent({ done, total }: SubtaskProgress): number {
	return total === 0 ? 0 : Math.round((done / total) * 100);
}

/** A row of the ticket table (ADR-0033 section 5). */
export interface TicketRow<T> {
	ticket: T;
	/** Indented directly below its parent. */
	nested: boolean;
	/** The parent of a sub-task (for the path hint and the column "Übergeordnet"), else null. */
	parent: ParentRef | null;
}

/** A row of any list whose entries carry a ticket (the day plan, TP-3), arranged like the table. */
export interface ArrangedRow<E> {
	entry: E;
	/** Indented directly below its parent. */
	nested: boolean;
	/** The parent of a sub-task (for the path hint), else null. */
	parent: ParentRef | null;
}

/** What arranging needs of the ticket of an entry. */
export type ArrangedTicket = Pick<TicketSummary, 'id' | 'parentId' | 'parentRef'>;

/**
 * Order of entries given in the order of their sort (ADR-0033 section 5), each with a ticket that
 * `ticketOf` names: with `nest` a sub-task follows its parent directly when both are among the
 * entries, and sub-tasks of one parent keep their order among each other. Otherwise, and without
 * `nest`, every entry stays at its place; a sub-task then carries its parent for the path hint.
 * The table arranges tickets with it (`arrangeRows`), the day plan its pool and its suggestions
 * (TP-3). Filters, search and counts are the caller's, per entry.
 */
export function arrangeBy<E>(
	entries: readonly E[],
	ticketOf: (entry: E) => ArrangedTicket,
	nest: boolean,
	find: (id: string) => Pick<TicketSummary, 'id' | 'key' | 'title'> | null
): ArrangedRow<E>[] {
	const shown = new Set(entries.map((entry) => ticketOf(entry).id));
	const parentIdOf = (entry: E) => ticketOf(entry).parentId || null;
	const follows = (entry: E) => {
		const parentId = parentIdOf(entry);
		return nest && parentId !== null && shown.has(parentId);
	};
	const children = new Map<string, E[]>();
	for (const entry of entries) {
		const parentId = parentIdOf(entry);
		if (!follows(entry) || parentId === null) continue;
		const list = children.get(parentId);
		if (list === undefined) children.set(parentId, [entry]);
		else list.push(entry);
	}
	const rows: ArrangedRow<E>[] = [];
	for (const entry of entries) {
		if (follows(entry)) continue;
		rows.push({ entry, nested: false, parent: parentOf(ticketOf(entry), find) });
		for (const child of children.get(ticketOf(entry).id) ?? []) {
			rows.push({ entry: child, nested: true, parent: parentOf(ticketOf(child), find) });
		}
	}
	return rows;
}

/**
 * Order of the rows of one section of the table (a group, the open or the done tickets), given in
 * the order of the sort (ADR-0033 section 5): `arrangeBy` with the tickets themselves as entries.
 */
export function arrangeRows<T extends TicketSummary>(
	tickets: readonly T[],
	nest: boolean,
	find: (id: string) => Pick<TicketSummary, 'id' | 'key' | 'title'> | null
): TicketRow<T>[] {
	return arrangeBy(tickets, (ticket) => ticket, nest, find).map(({ entry, nested, parent }) => ({
		ticket: entry,
		nested,
		parent
	}));
}

/**
 * The first arranged rows up to `limit`, in whole blocks (the pool of the day plan, TP-3): a block
 * is a row with the rows indented below it, and it counts in full or not at all. The first block
 * shows in full even when it alone is longer than `limit`; after a block that does not fit, none
 * follows, so the order stays.
 */
export function limitBlocks<R extends { nested: boolean }>(rows: readonly R[], limit: number): R[] {
	let end = 0;
	while (end < rows.length) {
		let next = end + 1;
		while (next < rows.length && rows[next]?.nested === true) next += 1;
		if (next > limit && end > 0) break;
		end = next;
	}
	return rows.slice(0, end);
}

/**
 * Indentation of a list whose order is the user's and never changes (the plan of a day, TP-3): an
 * entry is indented when the entry directly above it is its parent or an indented sub-task of the
 * same parent. An entry without a ticket (null) is never indented and ends such a run.
 */
export function nestedInOrder(
	tickets: readonly (Pick<TicketSummary, 'id' | 'parentId'> | null)[]
): boolean[] {
	const nested: boolean[] = [];
	tickets.forEach((ticket, index) => {
		const parentId = ticket?.parentId || null;
		const above = index > 0 ? (tickets[index - 1] ?? null) : null;
		nested.push(
			parentId !== null &&
				above !== null &&
				(above.id === parentId || (nested[index - 1] === true && above.parentId === parentId))
		);
	});
	return nested;
}

/** Key of a parent that is neither in the list nor expanded (not loaded, no access). */
export const UNKNOWN_PARENT_KEY = '…';

/**
 * The parent of a sub-task for its path: the list's own version of the parent if it has one (a new
 * key after a project change shows at once), else the expanded one; null for a top-level ticket.
 * Without both only the ID is known, and the key stands as "…".
 */
export function parentOf(
	ticket: Pick<TicketSummary, 'parentId' | 'parentRef'>,
	find: (id: string) => Pick<TicketSummary, 'id' | 'key' | 'title'> | null
): ParentRef | null {
	const id = ticket.parentId ?? null;
	if (id === null) return null;
	const known = find(id);
	if (known !== null) return { id, key: known.key, title: known.title };
	if (ticket.parentRef && ticket.parentRef.id === id) return ticket.parentRef;
	return { id, key: UNKNOWN_PARENT_KEY, title: '' };
}

/**
 * The parent of a sub-task as the object the list or the expand holds, null for a top-level ticket
 * and for an unknown parent (TP-3). Unlike `parentOf` it makes no new object: a cache keyed by the
 * object sees a renamed parent, which is a new object of the list, as new.
 */
export function parentTicketOf(
	ticket: Pick<TicketSummary, 'parentId' | 'parentRef'>,
	find: (id: string) => Pick<TicketSummary, 'key' | 'title'> | null
): Pick<TicketSummary, 'key' | 'title'> | null {
	const id = ticket.parentId || null;
	if (id === null) return null;
	const known = find(id);
	if (known !== null) return known;
	return ticket.parentRef && ticket.parentRef.id === id ? ticket.parentRef : null;
}

/** Whether the parent is resolved: only then its key opens it (TP-2). */
export function isKnownParent(parent: Pick<ParentRef, 'key'>): boolean {
	return parent.key !== UNKNOWN_PARENT_KEY;
}

/**
 * What screen readers hear before the title of a sub-task: "Unteraufgabe von HAUS-7:" (the table,
 * ADR-0033 section 5) or with the title of the parent "Unteraufgabe von HAUS-7 Wochenputz:" (the
 * day plan, TP-2). An unknown parent stays "Unteraufgabe von …:".
 */
export function subtaskOfText(parent: Pick<ParentRef, 'key' | 'title'>, withTitle = false): string {
	const name = withTitle && parent.title !== '' ? `${parent.key} ${parent.title}` : parent.key;
	return `Unteraufgabe von ${name}:`;
}

// --- A new ticket below a parent in "Neues Ticket" (UT-2, ADR-0069 addendum UT-2) -------------------

/** Hint at a field of "Neues Ticket" whose value came from the chosen parent. */
export const FROM_PARENT_HINT = 'Vom Hauptticket übernommen.';

/**
 * What "Neues Ticket" fills in from the chosen parent while a field is untouched (UT-2, K1): the
 * status a sub-task starts with (`subtaskStatusOf`, never "Erledigt": "Offen" under a done parent,
 * as the hook decides for a sub-task without a status), its due date, whether it is an ongoing
 * project and its assignee ('' for nobody). `ongoing` and `assignee` are null where the server does
 * not know the field (before its migration): those fields stay as they are.
 */
export interface ParentDefaults {
	status: TemplateStatus;
	due: CalendarDate | null;
	ongoing: boolean | null;
	assignee: string | null;
}

export function parentDefaultsOf(
	parent: Pick<TicketSummary, 'status' | 'due' | 'kind' | 'assignee'>
): ParentDefaults {
	return {
		status: subtaskStatusOf(undefined, parent.status),
		due: parent.due,
		ongoing: parent.kind === undefined ? null : parent.kind === 'ongoing',
		assignee: parent.assignee === undefined ? null : (parent.assignee ?? '')
	};
}

// --- A sub-task of a ticket of a series (UT-1, ADR-0033 addendum UT-1) ------------------------------

/** The parent of a sub-task that belongs to a series: its key and the rule of the series. */
export interface ParentSeries {
	key: string;
	recurrenceId: string;
}

/**
 * The parent of a sub-task when it belongs to a series, else null: the list's own version of the
 * parent if it has one, else the expanded one (also a done parent outside the list).
 */
export function parentSeriesOf(
	ticket: Pick<TicketSummary, 'parentId' | 'parentRef'>,
	find: (id: string) => Pick<TicketSummary, 'key' | 'recurrenceId'> | null
): ParentSeries | null {
	const id = ticket.parentId ?? null;
	if (id === null) return null;
	const known = find(id);
	const expanded = ticket.parentRef && ticket.parentRef.id === id ? ticket.parentRef : null;
	const key = known?.key ?? expanded?.key ?? null;
	const recurrenceId = known !== null ? known.recurrenceId : expanded?.recurrenceId;
	return key !== null && recurrenceId ? { key, recurrenceId } : null;
}

/** "Teil von HAUS-7 · wiederholt sich jeden Montag"; without a known rhythm only "wiederholt sich". */
export function parentSeriesText(parent: Pick<ParentSeries, 'key'>, rhythm: string): string {
	return `Teil von ${parent.key} · wiederholt sich${rhythm === '' ? '' : ` ${rhythm}`}`;
}

/**
 * Where a sub-task of a ticket of a series comes from: `template`, a copy of an entry of the template
 * that every date gets anew, or `single`, one for this date only.
 */
export type SeriesOrigin = 'template' | 'single';

export const SERIES_ORIGIN_TEXTS: Readonly<Record<SeriesOrigin, string>> = Object.freeze({
	template: 'aus der Vorlage – wird mit jedem Termin neu angelegt',
	single: 'nur für diesen Termin'
});

/** Titles compared without case and outer spaces, like "Unteraufgaben dieses Tickets übernehmen". */
function sameTitle(a: string, b: string): boolean {
	return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Where a sub-task of a ticket of a series comes from, from the data there is, without guessing:
 * `created` is its history entry "created" (null when the history is not loaded or has none),
 * `ruleId` the rule of the series of its parent, `templateTitles` the titles of the sub-tasks of the
 * template now (null while the rule is unknown).
 *   - Made by the rule (the generation writes "created" without a user and the rule as old value,
 *     ADR-0022 addendum 10) and the template still has its title: `template`.
 *   - Made by a person and the template has no entry of its title: `single`.
 *   - Anything else (the template changed since, a sub-task of "Neues Ticket" that went into the
 *     template as well, unknown history or rule): null, and the line says nothing about it.
 */
export function subtaskSeriesOrigin(input: {
	title: string;
	created: { user: string; oldValue: string } | null;
	ruleId: string;
	templateTitles: readonly string[] | null;
}): SeriesOrigin | null {
	const { title, created, ruleId, templateTitles } = input;
	if (created === null || templateTitles === null) return null;
	const inTemplate = templateTitles.some((entry) => sameTitle(entry, title));
	if (created.user === '') return created.oldValue === ruleId && inTemplate ? 'template' : null;
	return inTemplate ? null : 'single';
}
