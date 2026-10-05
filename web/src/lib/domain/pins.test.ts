// Pure rules of the pinned tickets (PIN-1, ADR-0064): the order of pinning, each ticket once, the
// pinned tickets a list knows, the texts and the folded section on this device.

import { describe, expect, it } from 'vitest';
import {
	PINNED_FOLDED_KEY,
	comparePins,
	pinFailedText,
	pinToggleLabel,
	pinnedCountText,
	pinnedMoreText,
	pinnedTicketIds,
	pinnedTickets,
	projectPinsLabel,
	readPinnedFolded,
	writePinnedFolded,
	type TicketPin
} from './pins';

const pin = (id: string, ticket: string, created: string): TicketPin => ({ id, ticket, created });

describe('order of the pins', () => {
	it('puts the oldest pin first and keeps equal moments stable by their ID', () => {
		const late = pin('p3', 't1', '2026-10-05 09:00:00.000Z');
		const early = pin('p2', 't2', '2026-10-05 08:00:00.000Z');
		const sameB = pin('p5', 't3', '2026-10-05 08:30:00.000Z');
		const sameA = pin('p4', 't4', '2026-10-05 08:30:00.000Z');
		expect([late, sameB, early, sameA].sort(comparePins)).toEqual([early, sameA, sameB, late]);
		expect(comparePins(early, early)).toBe(0);
	});

	it('names every pinned ticket once, in that order', () => {
		expect(
			pinnedTicketIds([
				pin('p2', 't2', '2026-10-05 09:00:00.000Z'),
				pin('p1', 't1', '2026-10-05 08:00:00.000Z'),
				pin('p3', 't1', '2026-10-05 10:00:00.000Z')
			])
		).toEqual(['t1', 't2']);
		expect(pinnedTicketIds([])).toEqual([]);
	});

	it('takes the pinned tickets a list knows, in the order of the IDs', () => {
		const known = new Map([
			['t1', { id: 't1' }],
			['t3', { id: 't3' }]
		]);
		expect(pinnedTickets(['t3', 't2', 't1'], (id) => known.get(id))).toEqual([
			{ id: 't3' },
			{ id: 't1' }
		]);
		expect(pinnedTickets(['t1'], () => null)).toEqual([]);
	});
});

describe('texts', () => {
	it('names the toggle, the numbers, a failure and the list of a project', () => {
		expect(pinToggleLabel('HAUS-12')).toBe('HAUS-12 anheften');
		expect(pinnedMoreText(2)).toBe('+ 2 angeheftet');
		expect(pinnedCountText(1)).toBe('1 Ticket');
		expect(pinnedCountText(3)).toBe('3 Tickets');
		expect(pinFailedText('HAUS-12', false)).toBe('HAUS-12 ließ sich nicht anheften.');
		expect(pinFailedText('HAUS-12', true)).toBe('HAUS-12 ließ sich nicht lösen.');
		expect(projectPinsLabel('Haus')).toBe('Angeheftet in „Haus“');
	});
});

describe('folded section on this device', () => {
	function memory(): Storage {
		const values = new Map<string, string>();
		return {
			getItem: (key) => values.get(key) ?? null,
			setItem: (key, value) => void values.set(key, value),
			removeItem: (key) => void values.delete(key),
			clear: () => values.clear(),
			key: () => null,
			get length() {
				return values.size;
			}
		};
	}

	it('remembers only "folded" and removes the key when unfolded', () => {
		const storage = memory();
		expect(readPinnedFolded(storage)).toBe(false);
		writePinnedFolded(storage, true);
		expect(storage.getItem(PINNED_FOLDED_KEY)).toBe('1');
		expect(readPinnedFolded(storage)).toBe(true);
		writePinnedFolded(storage, false);
		expect(storage.getItem(PINNED_FOLDED_KEY)).toBeNull();
		expect(readPinnedFolded(storage)).toBe(false);
	});

	it('stays open with a blocked or missing storage', () => {
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
		expect(readPinnedFolded(blocked)).toBe(false);
		expect(() => writePinnedFolded(blocked, true)).not.toThrow();
		expect(readPinnedFolded(null)).toBe(false);
		expect(() => writePinnedFolded(null, true)).not.toThrow();
	});
});
