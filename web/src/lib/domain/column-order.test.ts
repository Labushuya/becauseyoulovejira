// Column sort of the table (E3 plan, T-5 and package 2).

import { describe, expect, it } from 'vitest';
import {
	columnOrder,
	compareKeys,
	compareTitles,
	nextSort,
	SORT_KEYS,
	sortDirection,
	ticketOrder,
	type SortableTicket,
	type SortKey,
	type SortSpec
} from './ordering';
import { PRIORITIES } from './status';

const TODAY = '2026-09-25';
const OLD = '2026-01-01 08:00:00.000Z';
const HOUSE = { id: 'p00000000000001', name: 'Haus', code: 'HAUS', archived: false };
const CAR = { id: 'p00000000000002', name: 'Auto', code: 'AUTO', archived: false };
const OFFICE = { id: 'p00000000000003', name: 'Büro', code: 'BUERO', archived: true };

function row(id: string, overrides: Partial<SortableTicket> = {}): SortableTicket {
	return {
		id,
		key: 'TASK-' + id,
		title: 'Ticket ' + id,
		status: 'open',
		priority: 'medium',
		due: null,
		project: null,
		created: OLD,
		...overrides
	};
}

const ids = (tickets: SortableTicket[]) => tickets.map((entry) => entry.id);
const sorted = (tickets: SortableTicket[], spec: SortSpec | null) =>
	ids([...tickets].sort(columnOrder(spec, TODAY)));
const defaultOrder = (tickets: SortableTicket[]) => ids([...tickets].sort(ticketOrder(TODAY)));
const natural = (key: SortKey): SortSpec => ({ key, reversed: false });
const reversed = (key: SortKey): SortSpec => ({ key, reversed: true });

/** Deterministic pseudo-random permutation (linear congruential generator). */
function shuffler(seed: number) {
	let state = seed;
	return <T>(items: readonly T[]): T[] => {
		const copy = [...items];
		for (let index = copy.length - 1; index > 0; index -= 1) {
			state = (state * 1_103_515_245 + 12_345) % 2 ** 31;
			const other = Math.floor((state / 2 ** 31) * (index + 1));
			[copy[index], copy[other]] = [copy[other]!, copy[index]!];
		}
		return copy;
	};
}

describe('columnOrder', () => {
	it('without a spec is the default order', () => {
		const tickets = [
			row('a', { priority: 'urgent' }),
			row('b', { due: '2026-09-20', priority: 'low' }),
			row('c', { priority: 'high' })
		];
		expect(sorted(tickets, null)).toEqual(defaultOrder(tickets));
		expect(sorted(tickets, null)).toEqual(['b', 'a', 'c']);
	});

	it('sorts keys by code, then numerically, TASK like any code', () => {
		const tickets = [
			row('1', { key: 'HAUS-10' }),
			row('2', { key: 'TASK-2' }),
			row('3', { key: 'HAUS-9' }),
			row('4', { key: 'AUTO-100' }),
			row('5', { key: 'TASK-11' })
		];
		expect(sorted(tickets, natural('key'))).toEqual(['4', '3', '1', '2', '5']);
		expect(sorted(tickets, reversed('key'))).toEqual(['5', '2', '1', '3', '4']);
		expect(compareKeys('HAUS-9', 'HAUS-10')).toBeLessThan(0);
		expect(compareKeys('HAUS-10', 'HAUS-9')).toBeGreaterThan(0);
	});

	it('sorts numbers of any length numerically, never as text (KN-1)', () => {
		const numbers = [9, 10, 999, 1000, 10000, 1000000];
		const shuffle = shuffler(7);
		for (const code of ['TASK', 'ABCDEF']) {
			const tickets = shuffle(
				numbers.map((number) => row(String(number), { key: `${code}-${number}` }))
			);
			const ascending = numbers.map(String);
			expect(sorted(tickets, natural('key')), code).toEqual(ascending);
			expect(sorted(tickets, reversed('key')), code).toEqual([...ascending].reverse());
		}
		// As text "1000000" < "999" < "10"; numerically the other way round.
		expect(compareKeys('HAUS-999', 'HAUS-1000')).toBeLessThan(0);
		expect(compareKeys('HAUS-10000', 'HAUS-9999')).toBeGreaterThan(0);
		expect(compareKeys('HAUS-1000000', 'HAUS-999999')).toBeGreaterThan(0);
		expect(compareKeys('HAUS-1000000', 'HAUS-1000000')).toBe(0);
		// The code decides first, however large the number.
		expect(compareKeys('AUTO-1000000', 'HAUS-9')).toBeLessThan(0);
		// Every pair in both directions: antisymmetric over the whole set.
		for (const a of numbers) {
			for (const b of numbers) {
				const sign = Math.sign(compareKeys(`TASK-${a}`, `TASK-${b}`));
				expect(sign, `${a} ${b}`).toBe(Math.sign(a - b));
			}
		}
	});

	it('sorts priority urgent first, reversed low first', () => {
		const tickets = PRIORITIES.map((priority) => row(priority, { priority }));
		expect(sorted(tickets, natural('priority'))).toEqual(['urgent', 'high', 'medium', 'low']);
		expect(sorted(tickets, reversed('priority'))).toEqual(['low', 'medium', 'high', 'urgent']);
	});

	it('sorts status in the order of work, a checked row last', () => {
		const tickets = (['done', 'waiting', 'open', 'backlog', 'in_progress'] as const).map((status) =>
			row(status, { status })
		);
		expect(sorted(tickets, natural('status'))).toEqual([
			'backlog',
			'open',
			'in_progress',
			'waiting',
			'done'
		]);
		expect(sorted(tickets, reversed('status'))).toEqual([
			'done',
			'waiting',
			'in_progress',
			'open',
			'backlog'
		]);
	});

	it('sorts titles in German order with numbers as numbers', () => {
		const tickets = [
			row('t10', { title: 'Ticket 10' }),
			row('zebra', { title: 'Zebra' }),
			row('aepfel', { title: 'Äpfel kaufen' }),
			row('t2', { title: 'Ticket 2' }),
			row('birnen', { title: 'birnen kaufen' }),
			row('apfel', { title: 'Apfelmus' })
		];
		expect(sorted(tickets, natural('title'))).toEqual([
			'aepfel',
			'apfel',
			'birnen',
			't2',
			't10',
			'zebra'
		]);
		expect(sorted(tickets, reversed('title'))).toEqual([
			'zebra',
			't10',
			't2',
			'birnen',
			'apfel',
			'aepfel'
		]);
		expect(compareTitles('Äpfel', 'apfel')).toBe(0);
		expect(compareTitles('Ticket 2', 'Ticket 10')).toBeLessThan(0);
	});

	it('sorts projects by name, tickets without a project last in both directions', () => {
		const tickets = [
			row('none'),
			row('house', { project: HOUSE }),
			row('car', { project: CAR }),
			row('office', { project: OFFICE })
		];
		expect(sorted(tickets, natural('project'))).toEqual(['car', 'office', 'house', 'none']);
		expect(sorted(tickets, reversed('project'))).toEqual(['house', 'office', 'car', 'none']);
	});

	it('resolves projects through the given function (catalog)', () => {
		const renamed = { ...HOUSE, name: 'Aaa' };
		const tickets = [row('car', { project: CAR }), row('house', { project: HOUSE })];
		const order = columnOrder<SortableTicket>(natural('project'), TODAY, (ticket) =>
			ticket.project?.id === HOUSE.id ? renamed : ticket.project
		);
		expect(ids([...tickets].sort(order))).toEqual(['house', 'car']);
	});

	it('sorts by the path, so sub projects stand with their parent (ADR-0034)', () => {
		const garden = { ...CAR, id: 'p00000000000011', name: 'Garten', parent: HOUSE };
		const attic = { ...CAR, id: 'p00000000000012', name: 'Boden', parent: HOUSE };
		const tickets = [
			row('garden', { project: garden }),
			row('car', { project: CAR }),
			row('house', { project: HOUSE }),
			row('attic', { project: attic }),
			row('office', { project: OFFICE })
		];
		expect(sorted(tickets, natural('project'))).toEqual([
			'car',
			'office',
			'house',
			'attic',
			'garden'
		]);
		expect(sorted(tickets, reversed('project'))).toEqual([
			'garden',
			'attic',
			'house',
			'office',
			'car'
		]);
	});

	it('sorts due dates earliest first, tickets without one last in both directions', () => {
		const tickets = [
			row('none'),
			row('late', { due: '2026-12-01' }),
			row('overdue', { due: '2026-09-01' }),
			row('today', { due: TODAY })
		];
		expect(sorted(tickets, natural('due'))).toEqual(['overdue', 'today', 'late', 'none']);
		expect(sorted(tickets, reversed('due'))).toEqual(['late', 'today', 'overdue', 'none']);
	});

	it('sorts created newest first, reversed oldest first', () => {
		const tickets = [
			row('old', { created: '2026-01-01 00:00:00.000Z' }),
			row('new', { created: '2026-09-01 00:00:00.000Z' }),
			row('mid', { created: '2026-05-01 00:00:00.000Z' })
		];
		expect(sorted(tickets, natural('created'))).toEqual(['new', 'mid', 'old']);
		expect(sorted(tickets, reversed('created'))).toEqual(['old', 'mid', 'new']);
	});

	it('breaks ties with the default order, also when reversed', () => {
		const tickets = [
			row('rest', { priority: 'high' }),
			row('soon', { priority: 'high', due: '2026-09-26' }),
			row('overdue', { priority: 'high', due: '2026-09-01' })
		];
		const expected = defaultOrder(tickets);
		expect(expected).toEqual(['overdue', 'soon', 'rest']);
		expect(sorted(tickets, natural('priority'))).toEqual(expected);
		expect(sorted(tickets, reversed('priority'))).toEqual(expected);
		expect(sorted(tickets, reversed('status'))).toEqual(expected);

		const empty = [
			row('b', { priority: 'low' }),
			row('a', { priority: 'urgent' }),
			row('c', { priority: 'medium' })
		];
		expect(sorted(empty, natural('due'))).toEqual(['a', 'c', 'b']);
		expect(sorted(empty, reversed('due'))).toEqual(['a', 'c', 'b']);
		expect(sorted(empty, reversed('project'))).toEqual(['a', 'c', 'b']);
	});

	it('gives the same result for every input order, per column and direction', () => {
		const projects = [null, HOUSE, CAR, OFFICE];
		const dues = [null, '2026-09-01', TODAY, '2026-09-30', '2027-01-01'];
		const statuses = ['backlog', 'open', 'in_progress', 'waiting'] as const;
		const tickets: SortableTicket[] = [];
		for (const priority of PRIORITIES) {
			for (const due of dues) {
				for (const project of projects) {
					const counter = tickets.length + 1;
					tickets.push(
						row('r' + String(counter).padStart(3, '0'), {
							key: (project?.code ?? 'TASK') + '-' + (counter % 13),
							title: counter % 3 === 0 ? 'Gleich' : 'Titel ' + (counter % 7),
							status: statuses[counter % 4],
							priority,
							due,
							project,
							created: '2026-0' + (1 + (counter % 9)) + '-01 00:00:00.000Z'
						})
					);
				}
			}
		}
		const shuffle = shuffler(7);
		for (const key of SORT_KEYS) {
			for (const spec of [natural(key), reversed(key)]) {
				const expected = sorted(tickets, spec);
				for (let round = 0; round < 10; round += 1) {
					expect(sorted(shuffle(tickets), spec), key + ' ' + spec.reversed).toEqual(expected);
				}
				expect(sorted([...tickets].reverse(), spec)).toEqual(expected);
			}
		}
	});
});

describe('nextSort', () => {
	it('cycles default → natural → reversed → default', () => {
		const first = nextSort(null, 'priority');
		expect(first).toEqual({ key: 'priority', reversed: false });
		const second = nextSort(first, 'priority');
		expect(second).toEqual({ key: 'priority', reversed: true });
		expect(nextSort(second, 'priority')).toBeNull();
	});

	it('starts another column with its natural direction', () => {
		expect(nextSort({ key: 'priority', reversed: true }, 'title')).toEqual({
			key: 'title',
			reversed: false
		});
		expect(nextSort({ key: 'due', reversed: false }, 'created')).toEqual({
			key: 'created',
			reversed: false
		});
	});
});

describe('sortDirection', () => {
	it.each<[SortKey, 'ascending' | 'descending']>([
		['key', 'ascending'],
		['priority', 'descending'],
		['status', 'ascending'],
		['title', 'ascending'],
		['project', 'ascending'],
		['due', 'ascending'],
		['created', 'descending']
	])('%s starts %s and turns around', (key, direction) => {
		expect(sortDirection({ key, reversed: false })).toBe(direction);
		expect(sortDirection({ key, reversed: true })).toBe(
			direction === 'ascending' ? 'descending' : 'ascending'
		);
	});
});
