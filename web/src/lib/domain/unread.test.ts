// "Neu" per user (ADR-0015; E4 plan, package 4): base line, read rows, done and older tickets.

import { describe, expect, it } from 'vitest';
import type { TicketSummary } from './ticket';
import { countNew, isNew, unreadSinceOf } from './unread';

const BASE = '2026-09-25 08:00:00.000Z';

function ticket(overrides: Partial<TicketSummary> = {}) {
	return {
		id: 'tick00000000001',
		created: '2026-09-25 09:00:00.000Z',
		status: 'open' as TicketSummary['status'],
		projectId: null as string | null,
		...overrides
	};
}

describe('unreadSinceOf', () => {
	it('takes the base line of the user', () => {
		expect(unreadSinceOf({ unread_since: BASE, created: '2026-01-01 00:00:00.000Z' })).toBe(BASE);
	});

	it('counts an empty base line as the creation of the user', () => {
		expect(unreadSinceOf({ unread_since: '', created: '2026-01-01 00:00:00.000Z' })).toBe(
			'2026-01-01 00:00:00.000Z'
		);
	});

	it('knows nothing before the migration or without a user', () => {
		expect(unreadSinceOf({ created: '2026-01-01 00:00:00.000Z' })).toBeNull();
		expect(unreadSinceOf(null)).toBeNull();
		expect(unreadSinceOf({ unread_since: '', created: '' })).toBeNull();
	});
});

describe('isNew', () => {
	const none = new Set<string>();

	it('marks tickets created at or after the base line without a read row', () => {
		expect(isNew(ticket(), none, BASE)).toBe(true);
		expect(isNew(ticket({ created: BASE }), none, BASE)).toBe(true);
		expect(isNew(ticket({ created: '2026-09-25 07:59:59.999Z' }), none, BASE)).toBe(false);
	});

	it('does not mark read, done or anything without a base line', () => {
		expect(isNew(ticket(), new Set(['tick00000000001']), BASE)).toBe(false);
		expect(isNew(ticket({ status: 'done' }), none, BASE)).toBe(false);
		expect(isNew(ticket(), none, null)).toBe(false);
	});
});

describe('countNew', () => {
	it('counts in total and per project', () => {
		const tickets = [
			ticket({ id: 'a', projectId: 'p1' }),
			ticket({ id: 'b', projectId: 'p1' }),
			ticket({ id: 'c', projectId: 'p2' }),
			ticket({ id: 'd' }),
			ticket({ id: 'e', projectId: 'p2', status: 'done' }),
			ticket({ id: 'f', projectId: 'p2', created: '2026-01-01 00:00:00.000Z' })
		];
		const result = countNew(tickets, new Set(['b']), BASE);
		expect(result.total).toBe(3);
		expect([...result.byProject]).toEqual([
			['p1', 1],
			['p2', 1]
		]);
		expect(countNew(tickets, new Set(), null)).toEqual({ total: 0, byProject: new Map() });
	});
});
