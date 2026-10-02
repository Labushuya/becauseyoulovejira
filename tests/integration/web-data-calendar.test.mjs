// Data layer of the calendar against the disposable instance (ADR-0053 §5 and §12): the done tickets
// due in the shown period, by due date, only the own ones, without tickets in the trash; moving a
// due date with expected_updated, refused for an older base, back with "Rückgängig", and only the
// ticket of a series moves, not its rule. The TypeScript modules from web/src/lib/data are imported
// directly, as in web-data-tickets.test.mjs.

import { beforeAll, describe, expect, it } from 'vitest';
import { superuserClient } from '../support/api.mjs';
import { createOwner, uniqueSuffix } from '../support/scenario.mjs';
import { DataError } from '../../web/src/lib/data/errors.ts';
import { createRule, listRules } from '../../web/src/lib/data/recurrence.ts';
import {
	CALENDAR_DONE_PAGE_SIZE,
	createTicket,
	deleteTicket,
	getTicket,
	listDoneTicketsDue,
	updateTicket
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

describe('web data layer: moving a due date in the calendar (K-2)', () => {
	let superuser;

	beforeAll(async () => {
		superuser = await superuserClient();
	});

	/** The request fails; its error, else the test fails. */
	async function refusal(promise) {
		const error = await promise.then(
			() => null,
			(reason) => reason
		);
		expect(error).toBeInstanceOf(DataError);
		return error;
	}

	it('sets the due date with expected_updated, refuses an older base and goes back with "Rückgängig"', async () => {
		const owner = await createOwner(superuser);
		const ticket = await createTicket(owner.client, draft({ status: 'open', due: '2026-10-05' }));

		const moved = await updateTicket(
			owner.client,
			ticket.id,
			{ due: '2026-10-09' },
			{ expectedUpdated: ticket.updated }
		);
		expect(moved.due).toBe('2026-10-09');
		expect(moved.updated).not.toBe(ticket.updated);

		// Another tab still based on the version before the move: refused, nothing changes.
		const error = await refusal(
			updateTicket(owner.client, ticket.id, { due: '2026-10-12' }, { expectedUpdated: ticket.updated })
		);
		expect(error.kind).toBe('validation');
		expect(error.fields.description?.code).toBe('validation_description_stale');
		expect((await getTicket(owner.client, ticket.id)).due).toBe('2026-10-09');

		// "Rückgängig", based on the answer of the move.
		const restored = await updateTicket(
			owner.client,
			ticket.id,
			{ due: '2026-10-05' },
			{ expectedUpdated: moved.updated }
		);
		expect(restored.due).toBe('2026-10-05');
	});

	it('moves only the ticket of a series, not its rule', async () => {
		const owner = await createOwner(superuser);
		const ticket = await createTicket(owner.client, draft({ status: 'open', due: '2031-01-06' }));
		const rule = await createRule(
			owner.client,
			{
				title: ticket.title,
				description: '',
				project: null,
				tags: [],
				priority: 'medium',
				mode: 'calendar',
				freq: 'weekly',
				interval: 1,
				weekdays: ['MO'],
				month_day: 0,
				anchor: '2031-01-06',
				lead_days: 3,
				initial_status: 'open'
			},
			ticket.id
		);
		const instance = await getTicket(owner.client, ticket.id);
		expect(instance).toMatchObject({ recurring: true, recurrenceId: rule.id });

		const moved = await updateTicket(
			owner.client,
			ticket.id,
			{ due: '2031-01-08' },
			{ expectedUpdated: instance.updated }
		);

		expect(moved).toMatchObject({ due: '2031-01-08', recurring: true, recurrenceId: rule.id });
		const after = (await listRules(owner.client)).find((item) => item.id === rule.id);
		expect(after?.nextDue).toBe(rule.nextDue);
	});
});
