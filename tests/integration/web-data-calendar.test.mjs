// Data layer of the calendar against the disposable instance (ADR-0053 §5): the done tickets due in
// the shown period, by due date, only the own ones, without tickets in the trash. The TypeScript
// modules from web/src/lib/data are imported directly, as in web-data-tickets.test.mjs.

import { beforeAll, describe, expect, it } from 'vitest';
import { superuserClient } from '../support/api.mjs';
import { createOwner, uniqueSuffix } from '../support/scenario.mjs';
import {
	CALENDAR_DONE_PAGE_SIZE,
	createTicket,
	deleteTicket,
	listDoneTicketsDue
} from '../../web/src/lib/data/tickets.ts';

const OCTOBER = { from: '2026-09-28', to: '2026-11-01' };

function draft(overrides = {}) {
	return {
		title: `Kalender ${uniqueSuffix()}`,
		description: '',
		status: 'done',
		priority: 'medium',
		due: null,
		...overrides
	};
}

describe('web data layer: calendar', () => {
	let superuser;

	beforeAll(async () => {
		superuser = await superuserClient();
	});

	it('lists the done tickets due in the period by due date, with both ends, only the own ones', async () => {
		const [owner, other] = await Promise.all([createOwner(superuser), createOwner(superuser)]);
		const last = await createTicket(owner.client, draft({ due: OCTOBER.to }));
		const first = await createTicket(owner.client, draft({ due: OCTOBER.from }));
		const middle = await createTicket(owner.client, draft({ due: '2026-10-07' }));
		await Promise.all([
			createTicket(owner.client, draft({ due: '2026-09-27' })),
			createTicket(owner.client, draft({ due: '2026-11-02' })),
			createTicket(owner.client, draft({ due: null })),
			createTicket(owner.client, draft({ status: 'open', due: '2026-10-07' })),
			createTicket(other.client, draft({ due: '2026-10-07' }))
		]);

		const page = await listDoneTicketsDue(owner.client, OCTOBER, 1);

		expect(page.items.map((ticket) => ticket.id)).toEqual([first.id, middle.id, last.id]);
		expect(page.items.every((ticket) => ticket.status === 'done')).toBe(true);
		expect(page.items.map((ticket) => ticket.due)).toEqual([OCTOBER.from, '2026-10-07', OCTOBER.to]);
		expect(page.hasMore).toBe(false);
		expect(CALENDAR_DONE_PAGE_SIZE).toBe(200);
	});

	it('leaves tickets in the trash out', async () => {
		const owner = await createOwner(superuser);
		const kept = await createTicket(owner.client, draft({ due: '2026-10-07' }));
		const trashed = await createTicket(owner.client, draft({ due: '2026-10-07' }));
		await deleteTicket(owner.client, trashed.id, { sources: 'inbox' });

		const page = await listDoneTicketsDue(owner.client, OCTOBER, 1);

		expect(page.items.map((ticket) => ticket.id)).toEqual([kept.id]);
	});
});
