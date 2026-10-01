// Pinned comment of a ticket (ADR-0044 section 2, package KO-1) against the shared disposable
// instance: one field, so at most one pin per ticket; only a comment of the ticket itself; whoever
// may change the ticket may pin (also a comment of someone else in the household); history entries
// with the acting user; deleting the pinned comment releases the pin; the pin stays with the
// ticket in the trash and comes back with it; a new ticket (also a sub-ticket) never has one.

import { beforeAll, describe, expect, it } from 'vitest';
import { rejectionOf, statusOf, superuserClient } from '../support/api.mjs';
import { createOwner, createScenario, historyOf, uniqueSuffix } from '../support/scenario.mjs';
import { createComment, deleteComment, listComments } from '../../web/src/lib/data/comments.ts';
import { DataError } from '../../web/src/lib/data/errors.ts';
import { deleteTicket, getTicket, updateTicket, createTicket } from '../../web/src/lib/data/tickets.ts';
import { purgeFromTrash, restoreFromTrash } from '../../web/src/lib/data/trash.ts';

function draft(overrides = {}) {
	return {
		title: `Ticket ${uniqueSuffix()}`,
		description: '',
		status: 'open',
		priority: 'medium',
		due: null,
		project: null,
		tags: [],
		...overrides
	};
}

/** History entries of the pin, as old and new comment and the acting user. */
async function pinHistory(superuser, ticketId) {
	return (await historyOf(superuser, ticketId))
		.filter((entry) => entry.field === 'pinned_comment')
		.map(({ old_value, new_value, user }) => ({ old: old_value, new: new_value, user }));
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

describe('pinned comment (ADR-0044 section 2)', () => {
	let superuser;
	let a;

	beforeAll(async () => {
		superuser = await superuserClient();
		a = await createOwner(superuser);
	});

	it('pins a comment of the ticket and names the user in the history', async () => {
		const ticket = await createTicket(a.client, draft());
		expect(ticket.pinnedComment).toBeNull();
		const comment = await createComment(a.client, ticket.id, 'Der **wichtigste** Kommentar');

		const pinned = await updateTicket(a.client, ticket.id, { pinnedComment: comment.id });

		expect(pinned.pinnedComment).toBe(comment.id);
		expect((await getTicket(a.client, ticket.id)).pinnedComment).toBe(comment.id);
		expect(await pinHistory(superuser, ticket.id)).toEqual([{ old: '', new: comment.id, user: a.id }]);
	});

	it('replaces the pinned comment, so a ticket never has two', async () => {
		const ticket = await createTicket(a.client, draft());
		const first = await createComment(a.client, ticket.id, 'Erster');
		const second = await createComment(a.client, ticket.id, 'Zweiter');
		await updateTicket(a.client, ticket.id, { pinnedComment: first.id });

		const replaced = await updateTicket(a.client, ticket.id, { pinnedComment: second.id });

		expect(replaced.pinnedComment).toBe(second.id);
		expect(await pinHistory(superuser, ticket.id)).toEqual([
			{ old: '', new: first.id, user: a.id },
			{ old: first.id, new: second.id, user: a.id }
		]);
		// The field holds one comment: of two sent at once PocketBase keeps one (the last), the hook
		// checks it like any other.
		const both = await a.client
			.collection('tickets')
			.update(ticket.id, { pinned_comment: [second.id, first.id] });
		expect(both.pinned_comment).toBe(first.id);
		expect((await getTicket(a.client, ticket.id)).pinnedComment).toBe(first.id);
	});

	it('releases the pin', async () => {
		const ticket = await createTicket(a.client, draft());
		const comment = await createComment(a.client, ticket.id, 'Kurz angepinnt');
		await updateTicket(a.client, ticket.id, { pinnedComment: comment.id });

		const released = await updateTicket(a.client, ticket.id, { pinnedComment: null });

		expect(released.pinnedComment).toBeNull();
		expect(await pinHistory(superuser, ticket.id)).toEqual([
			{ old: '', new: comment.id, user: a.id },
			{ old: comment.id, new: '', user: a.id }
		]);
		// The comment itself stays.
		expect((await listComments(a.client, ticket.id)).map((entry) => entry.id)).toEqual([comment.id]);
	});

	it('refuses a comment of another ticket and a deleted one, and leaves the ticket unchanged', async () => {
		const ticket = await createTicket(a.client, draft());
		const other = await createTicket(a.client, draft());
		const foreign = await createComment(a.client, other.id, 'Gehört woanders hin');
		const gone = await createComment(a.client, ticket.id, 'Gleich weg');
		await deleteComment(a.client, gone.id);

		const wrong = await dataErrorOf(updateTicket(a.client, ticket.id, { pinnedComment: foreign.id }));
		expect(wrong.kind).toBe('validation');
		expect(wrong.fields.pinned_comment).toEqual({
			code: 'validation_pinned_comment_foreign',
			message: 'Anpinnen lässt sich nur ein Kommentar dieses Tickets.'
		});
		const missing = await dataErrorOf(updateTicket(a.client, ticket.id, { pinnedComment: gone.id }));
		expect(missing.fields.pinned_comment?.code).toBe('validation_pinned_comment_missing');

		const stored = await getTicket(a.client, ticket.id);
		expect(stored.pinnedComment).toBeNull();
		expect(stored.updated).toBe(ticket.updated);
		expect(await pinHistory(superuser, ticket.id)).toEqual([]);
	});

	it('never creates a ticket with a pin, also not a sub-ticket with the comment of its parent', async () => {
		const parent = await createTicket(a.client, draft());
		const comment = await createComment(a.client, parent.id, 'Wichtig');
		await updateTicket(a.client, parent.id, { pinnedComment: comment.id });

		const direct = await rejectionOf(
			a.client.collection('tickets').create({ owner: a.id, title: 'Neu', pinned_comment: comment.id })
		);
		expect(direct).toEqual({ status: 400, codes: { pinned_comment: 'validation_pinned_comment_create' } });
		const child = await rejectionOf(
			a.client
				.collection('tickets')
				.create({ owner: a.id, title: 'Unteraufgabe', parent: parent.id, pinned_comment: comment.id })
		);
		expect(child.codes).toEqual({ pinned_comment: 'validation_pinned_comment_create' });
		// A sub-ticket made the normal way starts without a pin.
		const made = await createTicket(a.client, draft({ parent: parent.id }));
		expect(made.pinnedComment).toBeNull();
	});

	it('lets every other change of the ticket pass while the pin stays', async () => {
		const ticket = await createTicket(a.client, draft());
		const comment = await createComment(a.client, ticket.id, 'Bleibt oben');
		await updateTicket(a.client, ticket.id, { pinnedComment: comment.id });

		const changed = await updateTicket(a.client, ticket.id, { title: 'Neuer Titel', status: 'in_progress' });

		expect(changed).toMatchObject({ title: 'Neuer Titel', status: 'in_progress', pinnedComment: comment.id });
	});
});

describe('who may pin (ADR-0044 section 2)', () => {
	let scenario;

	beforeAll(async () => {
		scenario = await createScenario();
	});

	it('lets a member of the household pin a comment of another member, and nobody outside', async () => {
		const { a, b, c, ids, h1 } = scenario;
		const ticket = await a.collection('tickets').create({ owner: ids.a, household: h1.id, title: 'Gemeinsam' });
		const byB = await b.collection('comments').create({ ticket: ticket.id, author: ids.b, body: 'Von B' });

		const pinned = await a.collection('tickets').update(ticket.id, { pinned_comment: byB.id });
		expect(pinned.pinned_comment).toBe(byB.id);
		expect(await statusOf(c.collection('tickets').update(ticket.id, { pinned_comment: '' }))).toBe(404);
		expect((await a.collection('tickets').getOne(ticket.id)).pinned_comment).toBe(byB.id);

		// B may release it too: whoever may change the ticket.
		expect((await b.collection('tickets').update(ticket.id, { pinned_comment: '' })).pinned_comment).toBe('');
	});
});

describe('deleting the pinned comment (ADR-0044 section 2)', () => {
	let superuser;
	let a;

	beforeAll(async () => {
		superuser = await superuserClient();
		a = await createOwner(superuser);
	});

	it('releases the pin in the same step, named after the user who deleted it', async () => {
		const ticket = await createTicket(a.client, draft());
		const pinnedOne = await createComment(a.client, ticket.id, 'Angepinnt');
		const plain = await createComment(a.client, ticket.id, 'Normal');
		await updateTicket(a.client, ticket.id, { pinnedComment: pinnedOne.id });

		await deleteComment(a.client, plain.id);
		expect((await getTicket(a.client, ticket.id)).pinnedComment).toBe(pinnedOne.id);

		await deleteComment(a.client, pinnedOne.id);
		expect((await getTicket(a.client, ticket.id)).pinnedComment).toBeNull();
		expect(await pinHistory(superuser, ticket.id)).toEqual([
			{ old: '', new: pinnedOne.id, user: a.id },
			{ old: pinnedOne.id, new: '', user: a.id }
		]);
	});

	it('releases the pin also when the superuser deletes the comment in the admin UI', async () => {
		const ticket = await createTicket(a.client, draft());
		const comment = await createComment(a.client, ticket.id, 'Angepinnt');
		await updateTicket(a.client, ticket.id, { pinnedComment: comment.id });

		await superuser.collection('comments').delete(comment.id);

		expect((await getTicket(a.client, ticket.id)).pinnedComment).toBeNull();
		// No app user acted: the history names nobody ("System").
		expect((await pinHistory(superuser, ticket.id)).at(-1)).toEqual({ old: comment.id, new: '', user: '' });
	});
});

describe('the pin and the trash (ADR-0044 section 2, ADR-0037)', () => {
	let superuser;
	let a;

	beforeAll(async () => {
		superuser = await superuserClient();
		a = await createOwner(superuser);
	});

	it('keeps the pin with the ticket in the trash and brings it back on restore', async () => {
		const ticket = await createTicket(a.client, draft());
		const comment = await createComment(a.client, ticket.id, 'Wichtig');
		await updateTicket(a.client, ticket.id, { pinnedComment: comment.id });

		const move = await deleteTicket(a.client, ticket.id, { sources: 'inbox' });
		expect(move?.id).toBe(ticket.id);
		expect((await superuser.collection('tickets').getOne(ticket.id)).pinned_comment).toBe(comment.id);

		await restoreFromTrash(a.client, ticket.id);

		const restored = await getTicket(a.client, ticket.id);
		expect(restored.pinnedComment).toBe(comment.id);
		expect((await listComments(a.client, ticket.id)).map((entry) => entry.id)).toEqual([comment.id]);
		// Moving and restoring change no pin: no history entry of the field.
		expect(await pinHistory(superuser, ticket.id)).toEqual([{ old: '', new: comment.id, user: a.id }]);
	});

	it('deletes a ticket with a pinned comment for good, comments included', async () => {
		const ticket = await createTicket(a.client, draft());
		const comment = await createComment(a.client, ticket.id, 'Wichtig');
		await createComment(a.client, ticket.id, 'Noch einer');
		// Done, so nothing blocks deleting it for good (ADR-0047).
		await updateTicket(a.client, ticket.id, { pinnedComment: comment.id, status: 'done' });
		await deleteTicket(a.client, ticket.id, { sources: 'inbox' });

		await purgeFromTrash(a.client, ticket.id);

		expect(await statusOf(superuser.collection('tickets').getOne(ticket.id))).toBe(404);
		expect(await statusOf(superuser.collection('comments').getOne(comment.id))).toBe(404);
	});
});
