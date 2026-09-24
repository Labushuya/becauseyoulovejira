// Comments and history through the web data layer (E2 plan, package 4; T-11, T-13).

import { beforeAll, describe, expect, it } from 'vitest';
import { superuserClient } from '../support/api.mjs';
import { createOwner, uniqueSuffix } from '../support/scenario.mjs';
import {
	createComment,
	deleteComment,
	listComments,
	updateComment
} from '../../web/src/lib/data/comments.ts';
import { DataError } from '../../web/src/lib/data/errors.ts';
import { listHistory } from '../../web/src/lib/data/history.ts';
import { createTicket, updateTicket } from '../../web/src/lib/data/tickets.ts';

function draft(overrides = {}) {
	return {
		title: `Ticket ${uniqueSuffix()}`,
		description: '',
		status: 'open',
		priority: 'medium',
		due: null,
		...overrides
	};
}

async function dataErrorOf(promise) {
	try {
		await promise;
	} catch (error) {
		expect(error).toBeInstanceOf(DataError);
		return error;
	}
	throw new Error('Expected the call to fail, but it succeeded.');
}

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('web data layer: comments', () => {
	let superuser;
	let a;
	let b;

	beforeAll(async () => {
		superuser = await superuserClient();
		[a, b] = await Promise.all([createOwner(superuser), createOwner(superuser)]);
	});

	it('creates comments as the signed-in user and lists them oldest first', async () => {
		const ticket = await createTicket(a.client, draft());

		const first = await createComment(a.client, ticket.id, 'Erster **Kommentar**');
		const second = await createComment(a.client, ticket.id, 'Zweiter');
		const third = await createComment(a.client, ticket.id, 'Dritter');

		expect(first).toMatchObject({ ticket: ticket.id, author: a.id, body: 'Erster **Kommentar**' });
		expect((await listComments(a.client, ticket.id)).map((comment) => comment.id)).toEqual([
			first.id,
			second.id,
			third.id
		]);
	});

	it('lists only the comments of the given ticket', async () => {
		const one = await createTicket(a.client, draft());
		const other = await createTicket(a.client, draft());
		await createComment(a.client, other.id, 'woanders');
		const own = await createComment(a.client, one.id, 'hier');

		expect((await listComments(a.client, one.id)).map((comment) => comment.id)).toEqual([own.id]);
	});

	it('lets the author edit a comment', async () => {
		const ticket = await createTicket(a.client, draft());
		const comment = await createComment(a.client, ticket.id, 'alt');
		await delay(5);

		const edited = await updateComment(a.client, comment.id, 'neu');

		expect(edited).toMatchObject({ id: comment.id, body: 'neu', created: comment.created });
		expect(edited.updated > edited.created).toBe(true);
	});

	it('lets the author delete a comment', async () => {
		const ticket = await createTicket(a.client, draft());
		const comment = await createComment(a.client, ticket.id, 'weg');

		await deleteComment(a.client, comment.id);

		expect(await listComments(a.client, ticket.id)).toEqual([]);
	});

	it('hides the comments of A from B: edit and delete report "not_found"', async () => {
		const ticket = await createTicket(a.client, draft());
		const comment = await createComment(a.client, ticket.id, 'von A');

		expect((await dataErrorOf(updateComment(b.client, comment.id, 'von B'))).kind).toBe(
			'not_found'
		);
		expect((await dataErrorOf(deleteComment(b.client, comment.id))).kind).toBe('not_found');
		expect(await listComments(b.client, ticket.id)).toEqual([]);
		expect((await superuser.collection('comments').getOne(comment.id)).body).toBe('von A');
	});

	it('rejects an empty comment as a validation error of the field body', async () => {
		const ticket = await createTicket(a.client, draft());

		const error = await dataErrorOf(createComment(a.client, ticket.id, ''));

		expect(error.kind).toBe('validation');
		expect(error.fields.body.code).toBe('validation_required');
	});
});

describe('web data layer: history', () => {
	let superuser;
	let a;

	beforeAll(async () => {
		superuser = await superuserClient();
		a = await createOwner(superuser);
	});

	it('lists the creation entry and one entry per changed field, newest first', async () => {
		const ticket = await createTicket(a.client, draft({ title: 'Vorher' }));
		await updateTicket(a.client, ticket.id, {
			title: 'Nachher',
			priority: 'urgent',
			due: '2026-10-01'
		});
		await delay(5);
		await updateTicket(a.client, ticket.id, { status: 'waiting' });

		const entries = await listHistory(a.client, ticket.id);

		// Newest first: the status change, then the three fields of the first update, then creation.
		expect(entries).toHaveLength(5);
		expect(entries[0].field).toBe('status');
		expect(entries[4].field).toBe('created');
		expect(entries.slice(1, 4).map((entry) => entry.field).sort()).toEqual([
			'due',
			'priority',
			'title'
		]);
		const byField = Object.fromEntries(entries.map((entry) => [entry.field, entry]));
		expect(byField.created).toMatchObject({ oldValue: '', newValue: ticket.key, user: a.id });
		expect(byField.title).toMatchObject({ oldValue: 'Vorher', newValue: 'Nachher' });
		expect(byField.priority).toMatchObject({ oldValue: 'medium', newValue: 'urgent' });
		expect(byField.due).toMatchObject({ oldValue: '', newValue: '2026-10-01 00:00:00.000Z' });
		expect(byField.status).toMatchObject({ oldValue: 'open', newValue: 'waiting', user: a.id });
		expect(entries.every((entry) => entry.ticket === ticket.id)).toBe(true);
	});

	it('keeps the write order for entries of the same moment', async () => {
		const ticket = await createTicket(a.client, draft());
		await updateTicket(a.client, ticket.id, { title: 'eins', priority: 'low' });

		const entries = await listHistory(a.client, ticket.id);
		const stored = await superuser.collection('ticket_history').getFullList({
			filter: superuser.filter('ticket = {:id}', { id: ticket.id }),
			sort: '@rowid'
		});

		expect(entries.map((entry) => entry.id)).toEqual(stored.map((entry) => entry.id).reverse());
	});
});
