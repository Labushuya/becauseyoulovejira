// Follow-up of "＋" without a connection (OF-4a), found in its second reading and done in OF-4b
// (ADR-0074 addendum OF-4b, B-4), on the scaffold of the outbox ($lib/test/outbox-fake.ts): a clock
// set back does not make the lookup of a discarded creation repeat every 5 minutes; the lookup takes
// the time of its last request as "now" at most.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { KeptAction } from '$lib/domain/offline';
import type { TicketDraft } from '$lib/domain/ticket';
import {
	ALL_OPS,
	NOW,
	goOffline,
	goOnline,
	harness,
	settle,
	type Harness
} from '$lib/test/outbox-fake';

/** The ID and the identifier `letters()` draws first: the ID, then the identifier. */
const OP = 'bbbbbbbbbbbbbbbbbbbb';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** A lookup that does not find a discarded creation is final this long after its last request. */
const GRACE = 5 * MINUTE;

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

async function ready(): Promise<Harness> {
	const h = harness({ support: ALL_OPS });
	h.server.strict = true;
	await settle();
	return h;
}

const DRAFT: TicketDraft = {
	title: 'Zahnarzt anrufen',
	description: '',
	status: 'open',
	priority: 'medium',
	due: null,
	project: null,
	tags: []
};

function only(h: Harness): KeptAction {
	expect(h.outbox.actions).toHaveLength(1);
	return h.outbox.actions[0] as KeptAction;
}

describe('the lookup of a discarded creation after the clock went back (B-4)', () => {
	it('takes "now" as the time of its last request at most, so the second lookup is final', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.createTicket(DRAFT);
		h.sendCreate.mockRejectedValueOnce(new DataError('network'));
		await goOnline(h);
		await goOffline(h);
		expect(only(h)).toMatchObject({ unanswered: true, lastSentAt: NOW });
		// The clock of the device goes back an hour; the user discards the creation.
		vi.setSystemTime(NOW - HOUR);
		await h.outbox.discard(OP);
		await goOnline(h);
		expect(h.get).toHaveBeenCalledTimes(1);
		expect(only(h)).toMatchObject({ discarded: true, lastSentAt: NOW - HOUR });
		await vi.advanceTimersByTimeAsync(GRACE);
		expect(h.get).toHaveBeenCalledTimes(2);
		expect(h.outbox.count).toBe(0);
		expect(h.outbox.notices).toEqual([]);
		// Nothing more is looked up later.
		await vi.advanceTimersByTimeAsync(4 * GRACE);
		expect(h.get).toHaveBeenCalledTimes(2);
	});
});
