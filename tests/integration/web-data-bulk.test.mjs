// Bulk actions of the ticket table (plan BI-2, ADR-0036 §3 to §5) against PocketBase: the reads
// of web/src/lib/data/bulk.ts (dates of the source events, number of sources) and the single
// paths every bulk action goes through, one ticket at a time, so the hooks decide exactly as for a
// change in the panel: a new key on another project, the lock of open sub-tasks with
// `complete_children`, the next ticket of a series and its removal on "Rückgängig" (or the
// refusal once it was edited), and the guard `expected_updated` of "Rückgängig".

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { berlinToday } from '../../web/src/lib/domain/berlin-date.ts';
import { countTicketSources, listSourceEventDates } from '../../web/src/lib/data/bulk.ts';
import { deleteTicket, updateTicket } from '../../web/src/lib/data/tickets.ts';
import { superuserClient } from '../support/api.mjs';
import { createOwner, historyOf, uniqueCode, uniqueSuffix } from '../support/scenario.mjs';

let superuser;
let owner;
let other;
/** Rules created here; they are paused afterwards, so no later run of the cron touches them. */
const rulesToPause = [];

beforeAll(async () => {
	superuser = await superuserClient();
	owner = await createOwner(superuser);
	other = await createOwner(superuser);
});

afterAll(async () => {
	for (const rule of rulesToPause) {
		await superuser.collection('recurrence_rules').update(rule, { active: false });
	}
});

function createItem(who, data = {}) {
	return who.client.collection('inbox_items').create({
		owner: who.id,
		channel: 'ics',
		kind: 'event',
		title: `Termin ${uniqueSuffix()}`,
		source_ref: `${uniqueSuffix()}@example.com`,
		...data
	});
}

/** The field errors of a refused request of the data layer (DataError). */
async function refusalOf(promise) {
	try {
		await promise;
	} catch (error) {
		return error;
	}
	throw new Error('Expected the request to be refused, but it succeeded.');
}

describe('reads of the bulk actions', () => {
	it('dates the tickets converted from an event, and only those', async () => {
		// Converted from an event; the start at 22:30 UTC is the next day in Berlin.
		const event = await createItem(owner, { source_date: '2026-10-05 22:30:00.000Z' });
		const fromEvent = await owner.ticket({ source_item: event.id });
		// An all-day event starts at midnight in Berlin.
		const allDay = await createItem(owner, {
			source_date: '2026-12-23 23:00:00.000Z',
			source_meta: { all_day: true }
		});
		const fromAllDay = await owner.ticket({ source_item: allDay.id });
		// A mail as main source: its date is when it was sent, no appointment.
		const mail = await createItem(owner, {
			channel: 'eml',
			kind: 'mail',
			source_date: '2026-10-01 08:00:00.000Z'
		});
		const fromMail = await owner.ticket({ source_item: mail.id });
		// An entry from Notion: its date comes from the list, like an appointment (ADR-0041 §8).
		const notion = await createItem(owner, {
			channel: 'notion',
			kind: 'task',
			source_ref: '00000000-0000-4000-8000-00000000c0de',
			source_date: '2026-11-19 23:00:00.000Z',
			source_meta: { all_day: true }
		});
		const fromNotion = await owner.ticket({ source_item: notion.id });
		// An event linked later is a source, but not the main one.
		const plain = await owner.ticket();
		const linked = await createItem(owner, { source_date: '2026-11-11 09:00:00.000Z' });
		await owner.client
			.collection('inbox_items')
			.update(linked.id, { state: 'converted', ticket: plain.id });
		// Tickets of another user stay out.
		const foreign = await createItem(other, { source_date: '2026-10-05 08:00:00.000Z' });
		const foreignTicket = await other.ticket({ source_item: foreign.id });

		const dates = await listSourceEventDates(owner.client);

		expect(dates.get(fromEvent.id)).toBe('2026-10-06');
		expect(dates.get(fromAllDay.id)).toBe('2026-12-24');
		expect(dates.get(fromNotion.id)).toBe('2026-11-20');
		expect(dates.has(fromMail.id)).toBe(false);
		expect(dates.has(plain.id)).toBe(false);
		expect(dates.has(foreignTicket.id)).toBe(false);
	});

	it('counts the sources of the chosen tickets', async () => {
		const main = await createItem(owner);
		const ticket = await owner.ticket({ source_item: main.id });
		const second = await createItem(owner);
		await owner.client.collection('inbox_items').update(second.id, { state: 'converted', ticket: ticket.id });
		const without = await owner.ticket();

		expect(await countTicketSources(owner.client, [ticket.id, without.id])).toBe(2);
		expect(await countTicketSources(owner.client, [without.id])).toBe(0);
		expect(await countTicketSources(owner.client, [])).toBe(0);
	});
});

describe('single paths of the bulk actions', () => {
	it('gives each ticket a new key on another project and restores the project on undo', async () => {
		const code = uniqueCode();
		const project = await owner.project(code);
		const ticket = await owner.ticket();

		const moved = await updateTicket(owner.client, ticket.id, { project: project.id });
		expect(moved.key).toBe(`${code}-1`);
		const history = await historyOf(superuser, ticket.id);
		expect(history.some((entry) => entry.field === 'key' && entry.old_value === ticket.key)).toBe(true);

		const back = await updateTicket(owner.client, ticket.id, { project: null }, { expectedUpdated: moved.updated });
		expect(back.projectId).toBeNull();
		expect(back.key).toMatch(/^TASK-\d+$/);
		expect(back.key).not.toBe(ticket.key);
	});

	it('refuses "Rückgängig" for a ticket changed meanwhile', async () => {
		const ticket = await owner.ticket({ priority: 'low' });
		const changed = await updateTicket(owner.client, ticket.id, { priority: 'high' });
		await updateTicket(owner.client, ticket.id, { title: 'Inzwischen geändert' });

		const error = await refusalOf(
			updateTicket(owner.client, ticket.id, { priority: 'low' }, { expectedUpdated: changed.updated })
		);

		expect(error.kind).toBe('validation');
		expect(Object.values(error.fields).map((field) => field.code)).toContain('validation_description_stale');
		expect((await owner.client.collection('tickets').getOne(ticket.id)).priority).toBe('high');
	});

	it('completes a ticket with open sub-tasks only with them or names them', async () => {
		const parent = await owner.ticket();
		const child = await owner.ticket({ parent: parent.id });

		const error = await refusalOf(updateTicket(owner.client, parent.id, { status: 'done' }));
		expect(error.fields.status).toMatchObject({
			code: 'validation_parent_open_children',
			params: { count: 1, keys: [child.key] }
		});

		const done = await updateTicket(owner.client, parent.id, { status: 'done' }, { completion: 'complete_children' });
		expect(done.status).toBe('done');
		expect((await owner.client.collection('tickets').getOne(child.id)).status).toBe('done');

		// "Rückgängig": the parent first, then the sub-task with its status from before.
		await updateTicket(owner.client, parent.id, { status: 'open' }, { expectedUpdated: done.updated });
		await updateTicket(owner.client, child.id, { status: 'open' });
		expect((await owner.client.collection('tickets').getOne(child.id)).status).toBe('open');
	});

	it('lets the server create the next ticket of a series and remove it again on undo', async () => {
		const today = berlinToday(Date.now());
		const ticket = await owner.ticket({ due: today });
		const rule = await owner.client.collection('recurrence_rules').create({
			owner: owner.id,
			title: 'Täglich',
			mode: 'calendar',
			freq: 'daily',
			lead_days: 3,
			initial_status: 'open',
			ticket: ticket.id
		});
		rulesToPause.push(rule.id);
		const instances = () =>
			owner.client
				.collection('tickets')
				.getFullList({ filter: owner.client.filter('recurrence = {:rule}', { rule: rule.id }) });

		const done = await updateTicket(owner.client, ticket.id, { status: 'done' });
		expect(await instances()).toHaveLength(2);

		await updateTicket(owner.client, ticket.id, { status: 'open' }, { expectedUpdated: done.updated });
		expect((await instances()).map((entry) => entry.id)).toEqual([ticket.id]);
	});

	it('refuses to reopen once the next ticket of the series was edited', async () => {
		const today = berlinToday(Date.now());
		const ticket = await owner.ticket({ due: today });
		const rule = await owner.client.collection('recurrence_rules').create({
			owner: owner.id,
			title: 'Täglich',
			mode: 'calendar',
			freq: 'daily',
			lead_days: 3,
			initial_status: 'open',
			ticket: ticket.id
		});
		rulesToPause.push(rule.id);
		const done = await updateTicket(owner.client, ticket.id, { status: 'done' });
		const [followUp] = await owner.client.collection('tickets').getFullList({
			filter: owner.client.filter('recurrence = {:rule} && id != {:id}', { rule: rule.id, id: ticket.id })
		});
		await updateTicket(owner.client, followUp.id, { title: 'Schon bearbeitet' });

		const error = await refusalOf(
			updateTicket(owner.client, ticket.id, { status: 'open' }, { expectedUpdated: done.updated })
		);

		expect(error.fields.status.code).toBe('validation_recurrence_open_instance');
		expect((await owner.client.collection('tickets').getOne(ticket.id)).status).toBe('done');
	});

	it('deletes with the chosen handling of the sources', async () => {
		const main = await createItem(owner);
		const ticket = await owner.ticket({ source_item: main.id });
		// Into the trash (ADR-0037): the discarded source stays with the ticket until it goes for good.
		const moved = await deleteTicket(owner.client, ticket.id, { sources: 'discard' });
		expect(moved).toMatchObject({ id: ticket.id, tickets: [{ id: ticket.id, key: ticket.key }] });
		expect(await superuser.collection('inbox_items').getOne(main.id)).toMatchObject({ state: 'converted', ticket: ticket.id });
		await owner.client.send(`/api/byl/trash/${ticket.id}/purge`, { method: 'POST' });
		expect((await superuser.collection('inbox_items').getOne(main.id)).state).toBe('discarded');
	});
});
