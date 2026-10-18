// Order of a list by time (ADR-0044 §1, QS-1 with ADR-0031 addendum M), pure: the choice of the
// switch shared by comments and sources, its stored value and the comparison of timestamps.

import { describe, expect, it } from 'vitest';
import {
	DEFAULT_LIST_ORDER,
	LIST_ORDERS,
	LIST_ORDER_LABELS,
	compareIds,
	compareTimestamps,
	parseListOrder,
	serializeListOrder
} from './list-order';

describe('stored order', () => {
	it('reads only "oldest"; everything else is the default "newest"', () => {
		expect(DEFAULT_LIST_ORDER).toBe('newest');
		expect(parseListOrder('oldest')).toBe('oldest');
		for (const raw of [null, undefined, '', 'newest', 'OLDEST', 'x']) {
			expect(parseListOrder(raw), String(raw)).toBe('newest');
		}
	});

	it('stores only "oldest" and removes the key for the default', () => {
		expect(serializeListOrder('oldest')).toBe('oldest');
		expect(serializeListOrder('newest')).toBeNull();
	});

	it('names both orders in the order of the switch', () => {
		expect(LIST_ORDERS).toEqual(['newest', 'oldest']);
		expect(LIST_ORDER_LABELS).toEqual({ newest: 'Neueste zuerst', oldest: 'Älteste zuerst' });
	});
});

describe('compareTimestamps and compareIds', () => {
	it('compares points in time, whichever way they are written', () => {
		expect(compareTimestamps('2026-09-24 08:30:00.000Z', '2026-09-24 08:30:00Z')).toBe(0);
		expect(compareTimestamps('2026-09-24T08:30:00Z', '2026-09-24 08:30:00.001Z')).toBe(-1);
		expect(compareTimestamps('2026-09-25 00:00:00.000Z', '2026-09-24 23:59:59.999Z')).toBe(1);
	});

	it('takes an unreadable timestamp as the oldest', () => {
		expect(compareTimestamps('', '2026-09-24 08:30:00.000Z')).toBe(-1);
		expect(compareTimestamps('gestern', '')).toBe(0);
	});

	it('compares IDs by their characters', () => {
		expect(compareIds('a0', 'a1')).toBe(-1);
		expect(compareIds('b', 'a')).toBe(1);
		expect(compareIds('x', 'x')).toBe(0);
	});
});
