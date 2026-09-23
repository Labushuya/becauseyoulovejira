// completed_at and due dates (E1 plan, package 6; CLAUDE.md section 5; ADR-0005).

import { beforeAll, describe, expect, it } from 'vitest';
import { rejectionOf, superuserClient } from '../support/api.mjs';
import { createOwner } from '../support/scenario.mjs';

let owner;
let tickets;

beforeAll(async () => {
	owner = await createOwner(await superuserClient());
	tickets = owner.client.collection('tickets');
});

/** Parses the PocketBase date format "YYYY-MM-DD HH:MM:SS.mmmZ". */
const toMillis = (value) => Date.parse(value.replace(' ', 'T'));

describe('completed_at', () => {
	it('is set when a ticket is created as done', async () => {
		const before = Date.now();
		const ticket = await owner.ticket({ status: 'done' });
		const after = Date.now();
		expect(toMillis(ticket.completed_at)).toBeGreaterThanOrEqual(before - 1000);
		expect(toMillis(ticket.completed_at)).toBeLessThanOrEqual(after + 1000);
	});

	it('is set on the change to done, kept while done and cleared when leaving done', async () => {
		const ticket = await owner.ticket();
		expect(ticket.completed_at).toBe('');

		const done = await tickets.update(ticket.id, { status: 'done' });
		expect(done.completed_at).not.toBe('');

		const stillDone = await tickets.update(ticket.id, { title: 'weiter erledigt' });
		expect(stillDone.completed_at).toBe(done.completed_at);

		const reopened = await tickets.update(ticket.id, { status: 'in_progress' });
		expect(reopened.completed_at).toBe('');

		const doneAgain = await tickets.update(ticket.id, { status: 'done' });
		expect(doneAgain.completed_at).not.toBe('');
		expect(toMillis(doneAgain.completed_at)).toBeGreaterThanOrEqual(toMillis(done.completed_at));
	});

	it('ignores values sent by the client', async () => {
		const open = await owner.ticket({ completed_at: '2020-01-01 10:00:00.000Z' });
		expect(open.completed_at).toBe('');
		expect(
			(await tickets.update(open.id, { completed_at: '2020-01-01 10:00:00.000Z' })).completed_at
		).toBe('');

		const done = await owner.ticket({ status: 'done', completed_at: '2020-01-01 10:00:00.000Z' });
		expect(done.completed_at).not.toBe('2020-01-01 10:00:00.000Z');
		const tampered = await tickets.update(done.id, { completed_at: '2020-01-01 10:00:00.000Z' });
		expect(tampered.completed_at).toBe(done.completed_at);
	});
});

describe('due', () => {
	it('accepts calendar dates and stores them at midnight UTC', async () => {
		expect((await owner.ticket({ due: '2026-10-01' })).due).toBe('2026-10-01 00:00:00.000Z');
		expect((await owner.ticket({ due: '2028-02-29 00:00:00.000Z' })).due).toBe(
			'2028-02-29 00:00:00.000Z'
		);
		const ticket = await owner.ticket({ due: '2026-10-01' });
		expect((await tickets.update(ticket.id, { due: '' })).due).toBe('');
	});

	it('rejects a time of day', async () => {
		const invalid = { status: 400, codes: { due: 'validation_calendar_date' } };
		expect(await rejectionOf(owner.ticket({ due: '2026-10-01 12:30:00.000Z' }))).toEqual(invalid);
		const ticket = await owner.ticket();
		expect(await rejectionOf(tickets.update(ticket.id, { due: '2026-10-01T22:00:00Z' }))).toEqual(
			invalid
		);
	});
});
