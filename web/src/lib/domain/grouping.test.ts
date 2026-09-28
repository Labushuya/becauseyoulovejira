// Grouping of the open tickets (E3 plan, T-7, T-19 and package 2).

import { describe, expect, it } from 'vitest';
import { addDays } from './berlin-date';
import { matchesFilter } from './filter';
import {
	DUE_GROUP_LABELS,
	GROUP_COLLAPSED_MAX,
	GROUP_COLLAPSED_STORAGE_KEY,
	GROUPING_LABELS,
	GROUPINGS,
	NO_PROJECT_LABEL,
	groupTicketLevels,
	groupTickets,
	readCollapsedGroups,
	writeCollapsedGroups,
	type GroupNode,
	type Grouping
} from './grouping';
import { EMPTY_LIST_QUERY, NO_PROJECT, type ListQuery } from './list-query';
import { columnOrder, SORT_KEYS, type SortableTicket } from './ordering';
import { PRIORITIES, STATUSES } from './status';
import type { ProjectRef, TicketSummary } from './ticket';

const TODAY = '2026-09-25';
const HOUSE: ProjectRef = { id: 'p00000000000001', name: 'Haus', code: 'HAUS', archived: false };
const CAR: ProjectRef = { id: 'p00000000000002', name: 'Auto', code: 'AUTO', archived: false };
const OFFICE: ProjectRef = { id: 'p00000000000003', name: 'Büro', code: 'BUERO', archived: true };
const ZOO: ProjectRef = { id: 'p00000000000004', name: 'auto', code: 'ZOO', archived: false };

function row(id: string, overrides: Partial<TicketSummary> = {}): TicketSummary {
	return {
		id,
		key: 'TASK-' + id,
		title: 'Ticket ' + id,
		status: 'open',
		priority: 'medium',
		due: null,
		projectId: null,
		tagIds: [],
		project: null,
		tags: [],
		recurring: false,
		source: null,
		completedAt: null,
		created: '2026-01-01 08:00:00.000Z',
		updated: '2026-01-01 08:00:00.000Z',
		...overrides
	};
}

/** Group keys, labels and ticket IDs. */
function shape(groups: ReturnType<typeof groupTickets<TicketSummary>>) {
	return groups.map((group) => [group.key, group.label, group.tickets.map((ticket) => ticket.id)]);
}

describe('groupTickets', () => {
	it('groups by status in the order of work, without empty groups', () => {
		const tickets = [
			row('w', { status: 'waiting' }),
			row('b', { status: 'backlog' }),
			row('w2', { status: 'waiting' }),
			row('d', { status: 'done' })
		];
		expect(shape(groupTickets(tickets, 'status', TODAY))).toEqual([
			['backlog', 'Backlog', ['b']],
			['waiting', 'Wartet', ['w', 'w2']],
			['done', 'Erledigt', ['d']]
		]);
	});

	it('groups by priority, urgent first', () => {
		const tickets = [
			row('low', { priority: 'low' }),
			row('urgent', { priority: 'urgent' }),
			row('high', { priority: 'high' }),
			row('low2', { priority: 'low' })
		];
		expect(shape(groupTickets(tickets, 'priority', TODAY))).toEqual([
			['urgent', 'Dringend', ['urgent']],
			['high', 'Hoch', ['high']],
			['low', 'Niedrig', ['low', 'low2']]
		]);
	});

	it('groups by project name, projects with the same name by code, "Ohne Projekt" last', () => {
		const tickets = [
			row('none'),
			row('house', { project: HOUSE }),
			row('zoo', { project: ZOO }),
			row('office', { project: OFFICE }),
			row('car', { project: CAR }),
			row('house2', { project: HOUSE })
		];
		expect(shape(groupTickets(tickets, 'project', TODAY))).toEqual([
			[CAR.id, 'Auto', ['car']],
			[ZOO.id, 'auto', ['zoo']],
			[OFFICE.id, 'Büro', ['office']],
			[HOUSE.id, 'Haus', ['house', 'house2']],
			[NO_PROJECT, NO_PROJECT_LABEL, ['none']]
		]);
	});

	it('groups by project through the given function (catalog)', () => {
		const tickets = [row('house', { project: HOUSE }), row('car', { project: CAR })];
		const renamed = { ...HOUSE, name: 'Aaa' };
		const groups = groupTickets(tickets, 'project', TODAY, (ticket) =>
			ticket.project?.id === HOUSE.id ? renamed : ticket.project
		);
		expect(shape(groups)).toEqual([
			[HOUSE.id, 'Aaa', ['house']],
			[CAR.id, 'Auto', ['car']]
		]);
	});

	it('groups each sub project with its path, right after its parent (ADR-0034)', () => {
		const GARDEN: ProjectRef = {
			id: 'p00000000000011',
			name: 'Garten',
			code: 'GART',
			archived: false,
			parent: { id: HOUSE.id, name: 'Haus', code: 'HAUS' }
		};
		const ATTIC: ProjectRef = { ...GARDEN, id: 'p00000000000012', name: 'Boden', code: 'BODEN' };
		const tickets = [
			row('garden', { project: GARDEN }),
			row('zoo', { project: ZOO }),
			row('house', { project: HOUSE }),
			row('attic', { project: ATTIC }),
			row('none')
		];
		expect(shape(groupTickets(tickets, 'project', TODAY))).toEqual([
			[ZOO.id, 'auto', ['zoo']],
			[HOUSE.id, 'Haus', ['house']],
			[ATTIC.id, 'Haus › Boden', ['attic']],
			[GARDEN.id, 'Haus › Garten', ['garden']],
			[NO_PROJECT, NO_PROJECT_LABEL, ['none']]
		]);
		// A sub project without tickets of its parent still stands where the parent would.
		expect(
			shape(
				groupTickets(
					[row('garden', { project: GARDEN }), row('car', { project: CAR })],
					'project',
					TODAY
				)
			)
		).toEqual([
			[CAR.id, 'Auto', ['car']],
			[GARDEN.id, 'Haus › Garten', ['garden']]
		]);
	});

	it('groups by due date: overdue, today, next 7 days, later, without date', () => {
		const tickets = [
			row('none'),
			row('later', { due: addDays(TODAY, 8) }),
			row('soon7', { due: addDays(TODAY, 7) }),
			row('today', { due: TODAY }),
			row('tomorrow', { due: addDays(TODAY, 1) }),
			row('overdue', { due: addDays(TODAY, -1) })
		];
		expect(shape(groupTickets(tickets, 'due', TODAY))).toEqual([
			['overdue', 'Überfällig', ['overdue']],
			['today', 'Heute', ['today']],
			['soon', 'Nächste 7 Tage', ['soon7', 'tomorrow']],
			['later', 'Später', ['later']],
			['none', 'Ohne Datum', ['none']]
		]);
		expect(Object.values(DUE_GROUP_LABELS)).toEqual([
			'Überfällig',
			'Heute',
			'Nächste 7 Tage',
			'Später',
			'Ohne Datum'
		]);
	});

	it('keeps the input order (the current sort) within a group', () => {
		const tickets = [
			row('c', { priority: 'high', title: 'C' }),
			row('a', { priority: 'high', title: 'A' }),
			row('b', { priority: 'high', title: 'B' })
		];
		const bytitle = [...tickets].sort(columnOrder({ key: 'title', reversed: false }, TODAY));
		expect(shape(groupTickets(bytitle, 'priority', TODAY))).toEqual([
			['high', 'Hoch', ['a', 'b', 'c']]
		]);
		const reversed = [...tickets].sort(columnOrder({ key: 'title', reversed: true }, TODAY));
		expect(shape(groupTickets(reversed, 'priority', TODAY))).toEqual([
			['high', 'Hoch', ['c', 'b', 'a']]
		]);
	});

	it.each(GROUPINGS)('%s gives no groups for no tickets', (grouping) => {
		expect(groupTickets([], grouping, TODAY)).toEqual([]);
	});

	it('names every grouping', () => {
		expect(GROUPING_LABELS).toEqual({
			status: 'Status',
			priority: 'Priorität',
			project: 'Projekt',
			due: 'Fälligkeit',
			source: 'Quelle',
			recurrence: 'Wiederholung'
		});
	});

	it.each(GROUPINGS)('%s keeps every ticket exactly once in a mixed set', (grouping) => {
		const tickets = mixedSet(120);
		const groups = groupTickets(tickets, grouping, TODAY);
		const grouped = groups.flatMap((group) => group.tickets.map((ticket) => ticket.id));
		expect([...grouped].sort()).toEqual(tickets.map((ticket) => ticket.id).sort());
		expect(groups.every((group) => group.tickets.length > 0)).toBe(true);
		expect(new Set(groups.map((group) => group.key)).size).toBe(groups.length);
	});
});

/** Tickets with every status (done excluded), priority, due date class and project. */
function mixedSet(count: number): TicketSummary[] {
	const projects = [null, HOUSE, CAR, OFFICE, ZOO];
	const dueOffsets = [null, -30, -1, 0, 1, 7, 8, 90];
	const open = STATUSES.filter((status) => status !== 'done');
	return Array.from({ length: count }, (_, index) => {
		const offset = dueOffsets[index % dueOffsets.length] ?? null;
		const project = projects[index % projects.length] ?? null;
		return row('m' + String(index).padStart(5, '0'), {
			key: (project?.code ?? 'TASK') + '-' + (index + 1),
			title: 'Aufgabe ' + ((index * 7919) % 1000),
			status: open[index % open.length],
			priority: PRIORITIES[(index * 3) % PRIORITIES.length],
			due: offset === null ? null : addDays(TODAY, offset),
			recurring: index % 3 === 0,
			project,
			tags: index % 4 === 0 ? [{ id: 't00000000000001', name: 'Einkauf' }] : [],
			created: '2026-0' + (1 + (index % 9)) + '-01 08:00:00.000Z'
		});
	});
}

describe('filter, sort and grouping with 2 000 tickets (T-19)', () => {
	const tickets = mixedSet(2000);
	const queries: ListQuery[] = [
		EMPTY_LIST_QUERY,
		{ ...EMPTY_LIST_QUERY, status: 'in_progress' },
		{ ...EMPTY_LIST_QUERY, due: 'soon', priority: 'urgent' },
		{ ...EMPTY_LIST_QUERY, project: HOUSE.id, tag: 't00000000000001' },
		{ ...EMPTY_LIST_QUERY, project: NO_PROJECT, due: 'overdue' },
		{ ...EMPTY_LIST_QUERY, recurring: 'recurring', priority: 'high' }
	];
	const groupings: (Grouping | null)[] = [null, ...GROUPINGS];

	it('runs every combination without errors and keeps the filtered set', () => {
		for (const query of queries) {
			const visible = tickets.filter((ticket) => matchesFilter(ticket, query, TODAY));
			for (const key of [null, ...SORT_KEYS]) {
				const order = columnOrder<SortableTicket>(
					key === null ? null : { key, reversed: key === 'due' },
					TODAY
				);
				const sorted = [...visible].sort(order);
				expect(sorted).toHaveLength(visible.length);
				for (const grouping of groupings) {
					const count =
						grouping === null
							? sorted.length
							: groupTickets(sorted, grouping, TODAY).reduce(
									(sum, group) => sum + group.tickets.length,
									0
								);
					expect(count).toBe(visible.length);
				}
			}
		}
		expect(tickets.filter((ticket) => matchesFilter(ticket, queries[1]!, TODAY)).length).toBe(500);
	});
});

describe('groupTickets: source (E4 plan, package 9; ADR-0019 section 3)', () => {
	it('groups by source family in the fixed order, old tickets as "Manuell", without empty groups', () => {
		const tickets = [
			row('c', { source: 'telegram' }),
			row('m', { source: 'eml' }),
			row('o', { source: null }),
			row('q', { source: 'quick' }),
			row('k', { source: 'ics' }),
			row('w', { source: 'whatsapp' }),
			row('l', { source: 'link' }),
			row('m2', { source: 'mail' })
		];
		expect(shape(groupTickets(tickets, 'source', TODAY))).toEqual([
			['manual', 'Manuell', ['o', 'q']],
			['link', 'Web-Link', ['l']],
			['mail', 'Mail', ['m', 'm2']],
			['calendar', 'Kalender', ['k']],
			['chat', 'Chat', ['c', 'w']]
		]);
	});

	it('keeps the order of the input within a group and shows Notion once it has tickets', () => {
		const tickets = [row('n', { source: 'notion' }), row('a', { source: 'clipboard' }), row('b')];
		expect(shape(groupTickets(tickets, 'source', TODAY))).toEqual([
			['manual', 'Manuell', ['a', 'b']],
			['notion', 'Notion', ['n']]
		]);
	});
});

describe('groupTickets: recurrence (plan OR-2)', () => {
	it('puts the tickets of a series before the single ones, in the order of the input', () => {
		const tickets = [
			row('a'),
			row('s1', { recurring: true }),
			row('b'),
			row('s2', { recurring: true, recurrenceId: 'r00000000000001' })
		];
		expect(shape(groupTickets(tickets, 'recurrence', TODAY))).toEqual([
			['recurring', 'Wiederkehrend', ['s1', 's2']],
			['once', 'Einmalig', ['a', 'b']]
		]);
	});

	it('leaves out an empty group', () => {
		expect(shape(groupTickets([row('a'), row('b')], 'recurrence', TODAY))).toEqual([
			['once', 'Einmalig', ['a', 'b']]
		]);
	});
});

describe('groupTicketLevels (plan OR-3)', () => {
	/** Keys, paths and ticket IDs per level. */
	function levels(groups: GroupNode<TicketSummary>[]): unknown[] {
		return groups.map((group) => [
			group.path,
			group.label,
			group.subgroups === null
				? group.tickets.map((ticket) => ticket.id)
				: group.subgroups.map((sub) => [
						sub.path,
						sub.label,
						sub.tickets.map((ticket) => ticket.id)
					])
		]);
	}

	it('splits project groups by status, both in the order of the domain, without empty groups', () => {
		const tickets = [
			row('h-wait', { project: HOUSE, status: 'waiting' }),
			row('none-open'),
			row('h-open', { project: HOUSE }),
			row('c-open', { project: CAR }),
			row('h-open2', { project: HOUSE })
		];
		expect(levels(groupTicketLevels(tickets, 'project', 'status', TODAY))).toEqual([
			[`project:${CAR.id}`, 'Auto', [[`project:${CAR.id}/status:open`, 'Offen', ['c-open']]]],
			[
				`project:${HOUSE.id}`,
				'Haus',
				[
					[`project:${HOUSE.id}/status:open`, 'Offen', ['h-open', 'h-open2']],
					[`project:${HOUSE.id}/status:waiting`, 'Wartet', ['h-wait']]
				]
			],
			['project:ohne', NO_PROJECT_LABEL, [['project:ohne/status:open', 'Offen', ['none-open']]]]
		]);
	});

	it('splits due groups by priority and keeps the sort within each leaf', () => {
		const tickets = [
			row('a', { due: TODAY, priority: 'low' }),
			row('b', { due: TODAY, priority: 'urgent' }),
			row('c', { priority: 'low' }),
			row('d', { due: TODAY, priority: 'low' })
		];
		expect(levels(groupTicketLevels(tickets, 'due', 'priority', TODAY))).toEqual([
			[
				'due:today',
				'Heute',
				[
					['due:today/priority:urgent', 'Dringend', ['b']],
					['due:today/priority:low', 'Niedrig', ['a', 'd']]
				]
			],
			['due:none', 'Ohne Datum', [['due:none/priority:low', 'Niedrig', ['c']]]]
		]);
	});

	it('has one level without a second grouping or with the same one twice', () => {
		const tickets = [row('a', { status: 'waiting' }), row('b')];
		for (const second of [null, 'status'] as const) {
			const groups = groupTicketLevels(tickets, 'status', second, TODAY);
			expect(levels(groups)).toEqual([
				['status:open', 'Offen', ['b']],
				['status:waiting', 'Wartet', ['a']]
			]);
			expect(shape(groups)).toEqual(shape(groupTickets(tickets, 'status', TODAY)));
		}
	});

	it.each(GROUPINGS.flatMap((first) => GROUPINGS.map((second) => [first, second] as const)))(
		'%s and %s keep every ticket exactly once, with unique paths',
		(first, second) => {
			const tickets = mixedSet(90);
			const groups = groupTicketLevels(tickets, first, second, TODAY);
			const leaves = groups.flatMap((group) => group.subgroups ?? [group]);
			const ids = leaves.flatMap((leaf) => leaf.tickets.map((ticket) => ticket.id));
			expect([...ids].sort()).toEqual(tickets.map((ticket) => ticket.id).sort());
			const paths = [...groups, ...leaves].map((group) => group.path);
			expect(new Set(paths).size).toBe(new Set([...groups, ...leaves]).size);
			expect(leaves.every((leaf) => leaf.tickets.length > 0)).toBe(true);
		}
	);
});

describe('folded groups in sessionStorage (plan OR-3)', () => {
	function memory(initial: string | null = null) {
		const values = new Map<string, string>();
		if (initial !== null) values.set(GROUP_COLLAPSED_STORAGE_KEY, initial);
		return {
			values,
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => void values.set(key, value),
			removeItem: (key: string) => void values.delete(key)
		};
	}

	it('reads valid paths and drops everything else', () => {
		const stored = JSON.stringify([
			'status:open',
			`project:${HOUSE.id}/status:in_progress`,
			'status:open/priority:high/due:today',
			'Status:open',
			'status:',
			42,
			'status:open;x'
		]);
		expect(readCollapsedGroups(memory(stored))).toEqual([
			'status:open',
			`project:${HOUSE.id}/status:in_progress`
		]);
		expect(readCollapsedGroups(memory('{"a":1}'))).toEqual([]);
		expect(readCollapsedGroups(memory('kaputt'))).toEqual([]);
		expect(readCollapsedGroups(null)).toEqual([]);
	});

	it('writes the paths, removes the key when none is folded and keeps the newest at most', () => {
		const storage = memory();
		writeCollapsedGroups(storage, ['due:today', 'due:today/priority:high']);
		expect(storage.values.get(GROUP_COLLAPSED_STORAGE_KEY)).toBe(
			'["due:today","due:today/priority:high"]'
		);
		writeCollapsedGroups(storage, []);
		expect(storage.values.has(GROUP_COLLAPSED_STORAGE_KEY)).toBe(false);
		const many = Array.from({ length: GROUP_COLLAPSED_MAX + 5 }, (_, index) => `status:s${index}`);
		writeCollapsedGroups(storage, many);
		const kept = readCollapsedGroups(storage);
		expect(kept).toHaveLength(GROUP_COLLAPSED_MAX);
		expect(kept.at(-1)).toBe(`status:s${GROUP_COLLAPSED_MAX + 4}`);
	});

	it('loses only the memory when the storage is blocked', () => {
		const blocked = {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('blocked');
			},
			removeItem: () => {
				throw new Error('blocked');
			}
		};
		expect(readCollapsedGroups(blocked)).toEqual([]);
		expect(() => writeCollapsedGroups(blocked, ['status:open'])).not.toThrow();
	});
});
