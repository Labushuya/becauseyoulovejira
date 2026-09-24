// Tag access of the web app against the disposable instance (E3 plan, package 3). The
// TypeScript modules from web/src/lib/data are imported directly (E2 plan, package 4).

import { beforeAll, describe, expect, it } from 'vitest';
import { superuserClient } from '../support/api.mjs';
import { createOwner, historyOf, uniqueSuffix } from '../support/scenario.mjs';
import { DataError } from '../../web/src/lib/data/errors.ts';
import {
	countTicketsWithTag,
	createTag,
	deleteTag,
	listTags,
	renameTag
} from '../../web/src/lib/data/tags.ts';
import { setTicketDone } from '../../web/src/lib/data/tickets.ts';

/** The DataError a call fails with; fails the test if the call succeeds. */
async function dataErrorOf(promise) {
	try {
		await promise;
	} catch (error) {
		expect(error).toBeInstanceOf(DataError);
		return error;
	}
	throw new Error('Expected the call to fail, but it succeeded.');
}

describe('web data layer: tags', () => {
	let superuser;

	beforeAll(async () => {
		superuser = await superuserClient();
	});

	it('creates, renames and deletes a tag that only its owner sees', async () => {
		const owner = await createOwner(superuser);
		const other = await createOwner(superuser);

		const tag = await createTag(owner.client, 'Einkauf');
		expect(tag).toMatchObject({ name: 'Einkauf' });
		expect(tag.updated).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}Z$/);
		const stored = await superuser.collection('tags').getOne(tag.id);
		expect(stored).toMatchObject({ owner: owner.id, household: '', scope: `u:${owner.id}` });

		const renamed = await renameTag(owner.client, tag.id, 'Einkäufe');
		expect(renamed).toMatchObject({ id: tag.id, name: 'Einkäufe' });
		expect(await listTags(owner.client)).toEqual([renamed]);

		expect(await listTags(other.client)).toEqual([]);
		expect((await dataErrorOf(renameTag(other.client, tag.id, 'fremd'))).kind).toBe('not_found');
		expect((await dataErrorOf(deleteTag(other.client, tag.id))).kind).toBe('not_found');

		await deleteTag(owner.client, tag.id);
		expect(await listTags(owner.client)).toEqual([]);
	});

	it('rejects a name that exists in another spelling, only in the same scope', async () => {
		const owner = await createOwner(superuser);
		const other = await createOwner(superuser);
		const name = `Garten-${uniqueSuffix()}`;
		await createTag(owner.client, name);

		for (const variant of [name, name.toUpperCase(), name.toLowerCase()]) {
			const duplicate = await dataErrorOf(createTag(owner.client, variant));
			expect(duplicate.kind, variant).toBe('validation');
			expect(duplicate.fields.name, variant).toEqual({
				code: 'validation_not_unique',
				message: 'Schon vergeben.'
			});
		}
		const second = await createTag(owner.client, `Haus-${uniqueSuffix()}`);
		expect((await dataErrorOf(renameTag(owner.client, second.id, name.toUpperCase()))).fields.name?.code).toBe(
			'validation_not_unique'
		);
		expect((await createTag(other.client, name)).name).toBe(name);
	});

	it('counts the tickets with the tag, done ones included', async () => {
		const owner = await createOwner(superuser);
		const tag = await createTag(owner.client, 'Zählen');
		const other = await createTag(owner.client, 'Anderes');
		expect(await countTicketsWithTag(owner.client, tag.id)).toBe(0);

		await owner.ticket({ tags: [tag.id] });
		await owner.ticket({ tags: [tag.id, other.id] });
		const done = await owner.ticket({ tags: [tag.id] });
		await setTicketDone(owner.client, done.id, true);
		await owner.ticket({ tags: [other.id] });
		await owner.ticket();

		expect(await countTicketsWithTag(owner.client, tag.id)).toBe(3);
		expect(await countTicketsWithTag(owner.client, other.id)).toBe(2);
	});

	it('removes a deleted tag from its tickets and records that without a user', async () => {
		const owner = await createOwner(superuser);
		const tag = await createTag(owner.client, 'Weg');
		const kept = await createTag(owner.client, 'Bleibt');
		const ticket = await owner.ticket({ tags: [tag.id, kept.id] });

		await deleteTag(owner.client, tag.id);

		expect((await superuser.collection('tickets').getOne(ticket.id)).tags).toEqual([kept.id]);
		const entries = (await historyOf(superuser, ticket.id)).filter((entry) => entry.field === 'tags');
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			old_value: JSON.stringify([tag.id, kept.id].sort()),
			new_value: JSON.stringify([kept.id]),
			user: ''
		});
	});
});
