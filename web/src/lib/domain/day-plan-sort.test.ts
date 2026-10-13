// Sorting the plan of a day (TP-5, ADR-0065 addendum TP-5): the stored preference, the first
// direction of each criterion (the first click in "Aufgaben"), the texts, and the order a sort shows
// with ties in the manual order, a parent with its sub-tasks as a unit, a sub-task without its parent
// on its own, done entries last and entries without a ticket last in their section.

import { describe, expect, it } from 'vitest';
import {
	DAY_PLAN_SORT_KEYS,
	DAY_PLAN_SORT_LABELS,
	DAY_PLAN_SORT_STORAGE_KEY,
	MANUAL_SORT,
	SORTED_MOVE_HINT,
	defaultDirection,
	directionHint,
	effectiveSort,
	parseDayPlanSort,
	sameSort,
	serializeDayPlanSort,
	sortAnnouncement,
	sortBy,
	sortButtonText,
	sortKeysFor,
	sortPlanEntries,
	sortedText,
	type DayPlanSort,
	type DayPlanSortKey
} from './day-plan-sort';
import { NATURAL_DIRECTION, type SortableTicket } from './ordering';
import type { ArrangedTicket } from './subtasks';
import type { ProjectRef } from './ticket';

type PlanTicket = SortableTicket & ArrangedTicket;

interface Entry {
	id: string;
	ticket: PlanTicket | null;
	done: boolean;
}

const OLD = '2031-05-01 08:00:00.000Z';
const A: ProjectRef = { id: 'p00000000000001', name: 'Auto', code: 'AUTO', archived: false };
const B: ProjectRef = { id: 'p00000000000002', name: 'Balkon', code: 'BALK', archived: false };

function planTicket(id: string, overrides: Partial<PlanTicket> = {}): PlanTicket {
	return {
		id,
		key: `TASK-${id}`,
		title: `Ticket ${id}`,
		status: 'open',
		priority: 'medium',
		due: null,
		project: null,
		created: OLD,
		parentId: null,
		...overrides
	};
}

function entry(id: string, overrides: Partial<PlanTicket> = {}, done = false): Entry {
	return { id, ticket: planTicket(id, overrides), done };
}

const access = {
	ticketOf: (item: Entry) => item.ticket,
	doneOf: (item: Entry) => item.done
};

const NAMES: Record<string, string> = { u1: 'Zora Beispiel', u2: 'Anna Beispiel' };

function shown(entries: Entry[], sort: DayPlanSort) {
	return sortPlanEntries(
		entries,
		sort,
		access,
		(ticket) => ticket.project,
		(id) => NAMES[id] ?? id
	);
}

const order = (entries: Entry[], sort: DayPlanSort) =>
	shown(entries, sort).map((row) => row.entry.id);

/** IDs in the order shown, indented ones with two blanks before. */
const rows = (entries: Entry[], sort: DayPlanSort) =>
	shown(entries, sort).map((row) => `${row.nested ? '  ' : ''}${row.entry.id}`);

const by = (key: DayPlanSortKey, direction: 'ascending' | 'descending'): DayPlanSort => ({
	key,
	direction
});

describe('the sort of this device (S5)', () => {
	it('stores the criterion with its direction and reads anything else as "Manuell"', () => {
		expect(DAY_PLAN_SORT_STORAGE_KEY).toBe('byl-dayplan-sort');
		expect(serializeDayPlanSort(by('priority', 'ascending'))).toBe('priority:ascending');
		expect(serializeDayPlanSort(MANUAL_SORT)).toBeNull();
		expect(parseDayPlanSort('priority:ascending')).toEqual(by('priority', 'ascending'));
		expect(parseDayPlanSort('assignee:descending')).toEqual(by('assignee', 'descending'));
		// A criterion alone takes its first direction.
		expect(parseDayPlanSort('due')).toEqual(by('due', 'ascending'));
		for (const raw of [
			null,
			undefined,
			'',
			'manual',
			'manual:descending',
			'key:ascending',
			'priority:up',
			'priority:ascending:x',
			'Priorität'
		]) {
			expect(parseDayPlanSort(raw), String(raw)).toEqual(MANUAL_SORT);
		}
		for (const key of DAY_PLAN_SORT_KEYS) {
			for (const direction of ['ascending', 'descending'] as const) {
				const sort = key === 'manual' ? MANUAL_SORT : by(key, direction);
				expect(parseDayPlanSort(serializeDayPlanSort(sort))).toEqual(sort);
			}
		}
	});

	it('starts every criterion with the direction of its first click in "Aufgaben"', () => {
		for (const key of DAY_PLAN_SORT_KEYS) {
			if (key === 'manual') continue;
			expect(defaultDirection(key), key).toBe(NATURAL_DIRECTION[key]);
			expect(sortBy(key)).toEqual({ key, direction: NATURAL_DIRECTION[key] });
		}
		// Urgent first, earliest first, A to Z.
		expect(sortBy('priority').direction).toBe('descending');
		expect(sortBy('due').direction).toBe('ascending');
		expect(sortBy('title').direction).toBe('ascending');
		expect(sortBy('manual')).toEqual(MANUAL_SORT);
	});

	it('offers "Zuständigkeit" only in a household and applies it nowhere else', () => {
		expect(sortKeysFor(true).map((key) => DAY_PLAN_SORT_LABELS[key])).toEqual([
			'Manuell',
			'Priorität',
			'Status',
			'Fälligkeit',
			'Titel',
			'Projekt',
			'Zuständigkeit'
		]);
		expect(sortKeysFor(false)).not.toContain('assignee');
		expect(effectiveSort(by('assignee', 'ascending'), false)).toEqual(MANUAL_SORT);
		expect(effectiveSort(by('assignee', 'ascending'), true)).toEqual(by('assignee', 'ascending'));
		expect(effectiveSort(by('title', 'descending'), false)).toEqual(by('title', 'descending'));
		expect(sameSort(MANUAL_SORT, { key: 'manual', direction: 'descending' })).toBe(true);
		expect(sameSort(by('title', 'ascending'), by('title', 'descending'))).toBe(false);
	});

	it('names the sort, what a direction means and that moving needs "Manuell"', () => {
		expect(sortButtonText(MANUAL_SORT)).toBe('Sortierung: Manuell');
		expect(sortButtonText(by('due', 'ascending'))).toBe('Sortierung: Fälligkeit');
		expect(directionHint('priority', 'descending')).toBe('Dringende zuerst');
		expect(directionHint('priority', 'ascending')).toBe('Niedrige zuerst');
		expect(directionHint('due', 'ascending')).toBe('Früheste zuerst, ohne Fälligkeit zuletzt');
		expect(directionHint('title', 'descending')).toBe('Z bis A');
		expect(directionHint('manual', 'ascending')).toBe('');
		expect(sortedText(by('priority', 'descending'))).toBe(
			'Sortiert nach Priorität (Dringende zuerst). Abgehaktes steht am Ende.'
		);
		expect(sortedText(MANUAL_SORT)).toBe('');
		expect(sortAnnouncement(by('status', 'descending'))).toBe(
			'Sortiert nach Status, absteigend: Wartet zuerst.'
		);
		expect(sortAnnouncement(MANUAL_SORT)).toBe('Manuelle Reihenfolge.');
		expect(SORTED_MOVE_HINT).toBe('Zum Verschieben auf „Manuell“ umstellen.');
	});
});

describe('the order a sort shows', () => {
	// The manual order: e1, e2, e3, e4.
	const plan = [
		entry('e1', {
			priority: 'medium',
			status: 'open',
			due: '2031-05-20',
			title: 'Bad',
			project: B,
			assignee: 'u2'
		}),
		entry('e2', { priority: 'urgent', status: 'waiting', title: 'apfel' }),
		entry('e3', { priority: 'medium', status: 'in_progress', due: '2031-05-15', title: 'Äpfel' }),
		entry('e4', {
			priority: 'low',
			status: 'backlog',
			due: '2031-05-15',
			title: 'Zelt',
			project: A,
			assignee: 'u1'
		})
	];

	it('keeps the manual order with "Manuell", indented as before (TP-3)', () => {
		const parent = entry('p');
		const child = entry('c', { parentId: 'p' });
		const lone = entry('l', { parentId: 'p' });
		expect(rows([parent, child, entry('x'), lone], MANUAL_SORT)).toEqual(['p', '  c', 'x', 'l']);
		expect(order(plan, MANUAL_SORT)).toEqual(['e1', 'e2', 'e3', 'e4']);
	});

	it('sorts by priority, status and due date in both directions, ties in the manual order', () => {
		expect(order(plan, by('priority', 'descending'))).toEqual(['e2', 'e1', 'e3', 'e4']);
		expect(order(plan, by('priority', 'ascending'))).toEqual(['e4', 'e1', 'e3', 'e2']);
		expect(order(plan, by('status', 'ascending'))).toEqual(['e4', 'e1', 'e3', 'e2']);
		expect(order(plan, by('status', 'descending'))).toEqual(['e2', 'e3', 'e1', 'e4']);
		// Without a due date last in both directions; the same date keeps the manual order.
		expect(order(plan, by('due', 'ascending'))).toEqual(['e3', 'e4', 'e1', 'e2']);
		expect(order(plan, by('due', 'descending'))).toEqual(['e1', 'e3', 'e4', 'e2']);
	});

	it('sorts by title, project and assignee in both directions, empty ones last', () => {
		// "apfel" and "Äpfel" are equal in German order: the manual order decides.
		expect(order(plan, by('title', 'ascending'))).toEqual(['e2', 'e3', 'e1', 'e4']);
		expect(order(plan, by('title', 'descending'))).toEqual(['e4', 'e1', 'e2', 'e3']);
		expect(order(plan, by('project', 'ascending'))).toEqual(['e4', 'e1', 'e2', 'e3']);
		expect(order(plan, by('project', 'descending'))).toEqual(['e1', 'e4', 'e2', 'e3']);
		// By the name of the assignee (Anna before Zora), nobody last.
		expect(order(plan, by('assignee', 'ascending'))).toEqual(['e1', 'e4', 'e2', 'e3']);
		expect(order(plan, by('assignee', 'descending'))).toEqual(['e4', 'e1', 'e2', 'e3']);
	});

	it('sorts the same whatever the order of equal entries, and leaves the plan as it is', () => {
		const ties = [entry('t1'), entry('t2'), entry('t3')];
		expect(order(ties, by('priority', 'descending'))).toEqual(['t1', 't2', 't3']);
		expect(order(ties, by('priority', 'ascending'))).toEqual(['t1', 't2', 't3']);
		const before = plan.map((item) => item.id);
		order(plan, by('title', 'descending'));
		expect(plan.map((item) => item.id)).toEqual(before);
	});

	it('sorts a parent with its sub-tasks as a unit, the sub-tasks below it sorted alike (S2)', () => {
		// Manual order: a sub-task, another ticket, the parent, a sub-task without its parent, a sub-task.
		const entries = [
			entry('s2', { parentId: 'p', priority: 'medium' }),
			entry('x', { priority: 'high' }),
			entry('p', { priority: 'low' }),
			entry('l', { parentId: 'gone', priority: 'urgent' }),
			entry('s1', { parentId: 'p', priority: 'urgent' })
		];
		// The unit sorts by its parent (low); the sub-task without its parent sorts on its own.
		expect(rows(entries, by('priority', 'descending'))).toEqual(['l', 'x', 'p', '  s1', '  s2']);
		expect(rows(entries, by('priority', 'ascending'))).toEqual(['p', '  s2', '  s1', 'x', 'l']);
	});

	it('puts entries checked for today or done last, sorted among each other, each section arranged on its own (S2)', () => {
		const entries = [
			entry('a', { priority: 'low' }),
			entry('b', { priority: 'urgent' }, true),
			entry('p', { priority: 'medium' }),
			entry('s', { parentId: 'p', priority: 'high' }, true),
			entry('c', { priority: 'urgent' }),
			entry('d', { priority: 'low' }, true),
			entry('o', { parentId: 'q', priority: 'high' }),
			entry('q', { priority: 'high' }, true)
		];
		// Open: c (urgent), o alone (its parent q is done), p, a; done: b, s alone (its parent is open), q, d.
		expect(rows(entries, by('priority', 'descending'))).toEqual([
			'c',
			'o',
			'p',
			'a',
			'b',
			's',
			'q',
			'd'
		]);
		// Done ones last in the other direction as well.
		expect(order(entries, by('priority', 'ascending'))).toEqual([
			'a',
			'p',
			'o',
			'c',
			'd',
			's',
			'q',
			'b'
		]);
		// Both done: the sub-task stays below its parent.
		const both = [entry('q2', {}, true), entry('k', { parentId: 'q2' }, true), entry('z')];
		expect(rows(both, by('title', 'ascending'))).toEqual(['z', 'q2', '  k']);
	});

	it('puts an entry without a visible ticket last in its section, in the manual order', () => {
		const entries: Entry[] = [
			{ id: 'h1', ticket: null, done: false },
			entry('a', { title: 'Zebra' }),
			{ id: 'h2', ticket: null, done: true },
			{ id: 'h3', ticket: null, done: false },
			entry('b', { title: 'Affe' }, true),
			entry('c', { title: 'Affe' })
		];
		expect(order(entries, by('title', 'ascending'))).toEqual(['c', 'a', 'h1', 'h3', 'b', 'h2']);
	});
});
