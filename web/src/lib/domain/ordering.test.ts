// Default order of the ticket list (E2 plan P-2 in the reading T-2).

import { describe, expect, it } from 'vitest';
import { addDays } from './berlin-date';
import {
	compareTickets,
	dueState,
	PRIORITY_RANK,
	SOON_DAYS,
	ticketOrder,
	type OrderedTicket
} from './ordering';
import { PRIORITIES, type Priority } from './status';

const TODAY = '2026-09-24';
const OLD = '2026-01-01 08:00:00.000Z';

function ticket(
	id: string,
	priority: Priority,
	due: string | null = null,
	created = OLD
): OrderedTicket {
	return { id, priority, due, created };
}

function order(tickets: OrderedTicket[], today = TODAY): string[] {
	return [...tickets].sort(ticketOrder(today)).map((entry) => entry.id);
}

describe('compareTickets', () => {
	it.each<[string, OrderedTicket[], string[]]>([
		[
			'overdue before soon due before the rest',
			[
				ticket('rest-urgent', 'urgent', null),
				ticket('soon', 'low', '2026-09-28'),
				ticket('later', 'urgent', '2026-12-01'),
				ticket('overdue', 'low', '2026-09-20')
			],
			['overdue', 'soon', 'later', 'rest-urgent']
		],
		[
			'group 1 by date, then priority',
			[
				ticket('tomorrow-low', 'low', '2026-09-25'),
				ticket('tomorrow-urgent', 'urgent', '2026-09-25'),
				ticket('today-low', 'low', '2026-09-24'),
				ticket('week-high', 'high', '2026-10-01')
			],
			['today-low', 'tomorrow-urgent', 'tomorrow-low', 'week-high']
		],
		[
			'group 1 with the same date and priority: newest first, then id',
			[
				ticket('b-old', 'medium', '2026-09-25', '2026-02-01 00:00:00.000Z'),
				ticket('a-new', 'medium', '2026-09-25', '2026-03-01 00:00:00.000Z'),
				ticket('c-old', 'medium', '2026-09-25', '2026-02-01 00:00:00.000Z')
			],
			['a-new', 'b-old', 'c-old']
		],
		[
			'group 2 by priority: an urgent ticket without date stays above a low one with a far date',
			[
				ticket('low-far', 'low', '2026-10-05'),
				ticket('medium-far', 'medium', '2026-11-01'),
				ticket('urgent-none', 'urgent', null),
				ticket('high-none', 'high', null)
			],
			['urgent-none', 'high-none', 'medium-far', 'low-far']
		],
		[
			'group 2 with the same priority: with due date (ascending) before without, then newest',
			[
				ticket('none-old', 'medium', null, '2026-02-01 00:00:00.000Z'),
				ticket('due-late', 'medium', '2026-10-10'),
				ticket('none-new', 'medium', null, '2026-03-01 00:00:00.000Z'),
				ticket('due-early', 'medium', '2026-10-05')
			],
			['due-early', 'due-late', 'none-new', 'none-old']
		],
		[
			'group 2 with the same date and priority: newest first',
			[
				ticket('older', 'low', '2026-12-24', '2026-05-01 00:00:00.000Z'),
				ticket('newer', 'low', '2026-12-24', '2026-06-01 00:00:00.000Z')
			],
			['newer', 'older']
		],
		[
			'last tie: id',
			[ticket('b', 'high'), ticket('c', 'high'), ticket('a', 'high')],
			['a', 'b', 'c']
		]
	])('%s', (_name, tickets, expected) => {
		expect(order(tickets)).toEqual(expected);
	});

	it(`puts the horizon today + ${SOON_DAYS} days into group 1, the day after into group 2`, () => {
		const horizon = addDays(TODAY, SOON_DAYS);
		expect(horizon).toBe('2026-10-01');
		const tickets = [
			ticket('urgent-none', 'urgent', null),
			ticket('low-horizon', 'low', horizon),
			ticket('low-after', 'low', addDays(horizon, 1))
		];

		expect(order(tickets)).toEqual(['low-horizon', 'urgent-none', 'low-after']);
	});

	it('moves tickets into group 1 when the Berlin date advances', () => {
		const tickets = [
			ticket('urgent-none', 'urgent', null),
			ticket('low-soon', 'low', '2026-10-02')
		];

		expect(order(tickets, '2026-09-24')).toEqual(['urgent-none', 'low-soon']);
		expect(order(tickets, '2026-09-25')).toEqual(['low-soon', 'urgent-none']);
	});

	it('orders a mixed set the same way for every input order', () => {
		const tickets: OrderedTicket[] = [];
		const dues = [
			null,
			'2026-09-01',
			'2026-09-24',
			'2026-09-25',
			'2026-10-01',
			'2026-10-02',
			'2027-01-01'
		];
		let counter = 0;
		for (const due of dues) {
			for (const priority of PRIORITIES) {
				for (const created of ['2026-02-01 00:00:00.000Z', '2026-03-01 00:00:00.000Z']) {
					counter += 1;
					tickets.push(ticket(`t${String(counter).padStart(3, '0')}`, priority, due, created));
				}
			}
		}
		const expected = order(tickets);

		// Deterministic pseudo-random permutations (linear congruential generator).
		let seed = 42;
		const random = () => {
			seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
			return seed / 2 ** 31;
		};
		for (let round = 0; round < 50; round += 1) {
			const shuffled = [...tickets];
			for (let index = shuffled.length - 1; index > 0; index -= 1) {
				const other = Math.floor(random() * (index + 1));
				[shuffled[index], shuffled[other]] = [shuffled[other]!, shuffled[index]!];
			}
			expect(order(shuffled)).toEqual(expected);
		}
		expect(order([...tickets].reverse())).toEqual(expected);
	});

	it('is antisymmetric and zero only for the same ticket', () => {
		const a = ticket('a', 'high', '2026-09-30');
		const b = ticket('b', 'low', null);

		expect(Math.sign(compareTickets(a, b, TODAY))).toBe(-Math.sign(compareTickets(b, a, TODAY)));
		expect(compareTickets(a, a, TODAY)).toBe(0);
		expect(compareTickets(a, b, TODAY)).toBeLessThan(0);
	});
});

describe('PRIORITY_RANK', () => {
	it('ranks urgent > high > medium > low', () => {
		const ranked = [...PRIORITIES].sort((a, b) => PRIORITY_RANK[a] - PRIORITY_RANK[b]);
		expect(ranked).toEqual(['urgent', 'high', 'medium', 'low']);
	});
});

describe('dueState', () => {
	it.each<[string | null, string, ReturnType<typeof dueState>]>([
		[null, TODAY, 'none'],
		['2026-09-23', TODAY, 'overdue'],
		['2025-12-31', TODAY, 'overdue'],
		['2026-09-24', TODAY, 'today'],
		['2026-09-25', TODAY, 'tomorrow'],
		['2026-09-26', TODAY, 'soon'],
		['2026-10-01', TODAY, 'soon'],
		['2026-10-02', TODAY, 'later'],
		['2027-01-01', '2026-12-31', 'tomorrow'],
		['2028-02-29', '2028-02-28', 'tomorrow']
	])('%s at %s is %s', (due, today, expected) => {
		expect(dueState(due, today)).toBe(expected);
	});
});
