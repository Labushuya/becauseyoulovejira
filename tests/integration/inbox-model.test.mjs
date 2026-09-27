// Inbox data model and hook (ADR-0014 sections 1 and 3, E4 plan package 1): scope, cleaning,
// fingerprint, duplicates per scope, immutable fields, state changes and the protected
// original file.

import { beforeAll, describe, expect, it } from 'vitest';
import { pocketBaseUrl, rejectionOf, statusOf, superuserClient } from '../support/api.mjs';
import { createOwner, uniqueSuffix } from '../support/scenario.mjs';

let superuser;
let owner;
let other;

/** Creates an inbox item of `who` (private scope); `data` overrides the defaults. */
function createItem(who, data = {}) {
	return who.client.collection('inbox_items').create({
		owner: who.id,
		channel: 'manual',
		kind: 'todo',
		title: `Eintrag ${uniqueSuffix()}`,
		...data
	});
}

function mail(messageId, data = {}) {
	return { channel: 'eml', kind: 'mail', source_ref: messageId, ...data };
}

/** Rejection with the params of the field error (ADR-0014 section 3). */
async function duplicateOf(promise) {
	try {
		await promise;
	} catch (error) {
		return { status: error.status, detail: error.response?.data?.fingerprint };
	}
	throw new Error('Expected a duplicate rejection.');
}

beforeAll(async () => {
	superuser = await superuserClient();
	owner = await createOwner(superuser);
	other = await createOwner(superuser);
});

describe('create', () => {
	it('sets scope, state and fingerprint and overwrites client values', async () => {
		const item = await createItem(owner, {
			scope: 'u:someone-else',
			state: 'converted',
			fingerprint: 'chosen-by-client',
			handled_at: '2026-01-01 00:00:00.000Z'
		});
		expect(item.scope).toBe(`u:${owner.id}`);
		expect(item.state).toBe('new');
		expect(item.handled_at).toBe('');
		expect(item.ticket).toBe('');
		expect(item.fingerprint).toMatch(/^[0-9a-f]{64}$/);
	});

	it('refuses a ticket on create', async () => {
		const ticket = await owner.ticket();
		const item = await createItem(owner, { ticket: ticket.id });
		expect(item.ticket).toBe('');
		expect(item.state).toBe('new');
	});

	it('collapses whitespace and cuts long titles to 200 characters', async () => {
		const item = await createItem(owner, { title: `  Re:\r\n ${'x'.repeat(300)}` });
		expect(item.title).toHaveLength(200);
		expect(item.title.startsWith('Re: xxx')).toBe(true);
		expect(item.title.endsWith('…')).toBe(true);
	});

	it('rejects an empty title and links other than http(s)', async () => {
		expect((await rejectionOf(createItem(owner, { title: '   ' }))).codes.title).toBe(
			'validation_required'
		);
		const script = await rejectionOf(
			createItem(owner, { channel: 'link', kind: 'link', source_url: 'javascript:alert(1)' })
		);
		expect(script).toEqual({ status: 400, codes: { source_url: 'validation_invalid_url' } });
		const noUrl = await rejectionOf(createItem(owner, { channel: 'link', kind: 'link' }));
		expect(noUrl.codes).toEqual({ source_url: 'validation_required' });
	});

	it('rejects unknown channels and kinds', async () => {
		expect((await rejectionOf(createItem(owner, { channel: 'fax' }))).codes.channel).toBeTruthy();
		expect((await rejectionOf(createItem(owner, { kind: 'epic' }))).codes.kind).toBeTruthy();
	});

	it('allows the same manual title twice', async () => {
		const title = `Milch kaufen ${uniqueSuffix()}`;
		const first = await createItem(owner, { title });
		const second = await createItem(owner, { title, channel: 'quick' });
		expect(second.fingerprint).not.toBe(first.fingerprint);
	});
});

describe('duplicates', () => {
	it('rejects the same mail twice in one scope, with the state of the existing item', async () => {
		const id = `<${uniqueSuffix()}@Example.com>`;
		const first = await createItem(owner, mail(id));
		const again = await duplicateOf(
			createItem(owner, { ...mail(id.toLowerCase().slice(1, -1)), channel: 'mail' })
		);
		expect(again.status).toBe(400);
		expect(again.detail).toEqual({
			code: 'validation_inbox_duplicate',
			message: 'Schon im Eingang.',
			params: { state: 'new', item: first.id, ticket: '', ticketKey: '' }
		});
	});

	it('allows the same mail in another scope', async () => {
		const id = `<${uniqueSuffix()}@example.com>`;
		const mine = await createItem(owner, mail(id));
		const theirs = await createItem(other, mail(id));
		expect(theirs.fingerprint).toBe(mine.fingerprint);
		expect(theirs.scope).not.toBe(mine.scope);
	});

	it('keeps a discarded item as tombstone', async () => {
		const url = `https://example.com/${uniqueSuffix()}`;
		const item = await createItem(owner, { channel: 'link', kind: 'link', source_url: url });
		await owner.client.collection('inbox_items').update(item.id, { state: 'discarded' });
		const again = await duplicateOf(
			createItem(owner, { channel: 'link', kind: 'link', source_url: `${url}?utm_source=x#top` })
		);
		expect(again.detail.message).toBe('Schon verworfen.');
		expect(again.detail.params).toMatchObject({ state: 'discarded', item: item.id });
	});
});

describe('client updates', () => {
	it('rejects changes of the immutable fields', async () => {
		const item = await createItem(owner, mail(`<${uniqueSuffix()}@example.com>`, {
			source_date: '2026-09-25 08:00:00.000Z'
		}));
		const items = owner.client.collection('inbox_items');
		for (const [field, value] of [
			['channel', 'mail'],
			['source_ref', 'other@example.com'],
			['source_date', '2026-09-26 08:00:00.000Z'],
			['fingerprint', 'f'.repeat(64)]
		]) {
			const rejection = await rejectionOf(items.update(item.id, { [field]: value }));
			expect(rejection, field).toEqual({
				status: 400,
				codes: { [field]: 'validation_inbox_immutable' }
			});
		}
		const unchanged = await items.update(item.id, { title: 'Neuer Titel', channel: 'eml' });
		expect(unchanged.title).toBe('Neuer Titel');
	});

	it('discards and restores, with handled_at from the hook', async () => {
		const items = owner.client.collection('inbox_items');
		const item = await createItem(owner);
		const discarded = await items.update(item.id, {
			state: 'discarded',
			handled_at: '2020-01-01 00:00:00.000Z'
		});
		expect(discarded.state).toBe('discarded');
		expect(Date.parse(discarded.handled_at.replace(' ', 'T'))).toBeGreaterThan(Date.parse('2026-01-01'));
		const edited = await items.update(item.id, { title: 'Nur Titel', handled_at: '' });
		expect(edited.handled_at).toBe(discarded.handled_at);
		const restored = await items.update(item.id, { state: 'new' });
		expect(restored.handled_at).toBe('');
	});

	it('rejects conversions without ticket, from discarded and back from converted', async () => {
		const items = owner.client.collection('inbox_items');
		const ticket = await owner.ticket();

		const item = await createItem(owner);
		expect((await rejectionOf(items.update(item.id, { state: 'converted' }))).codes).toEqual({
			ticket: 'validation_inbox_ticket_required'
		});
		expect((await rejectionOf(items.update(item.id, { ticket: ticket.id }))).codes).toEqual({
			ticket: 'validation_inbox_transition'
		});

		const discarded = await createItem(owner);
		await items.update(discarded.id, { state: 'discarded' });
		expect(
			(await rejectionOf(items.update(discarded.id, { state: 'converted', ticket: ticket.id }))).codes
		).toEqual({ state: 'validation_inbox_transition' });

		const assigned = await items.update(item.id, { state: 'converted', ticket: ticket.id });
		expect(assigned.state).toBe('converted');
		expect(assigned.ticket).toBe(ticket.id);
		expect(assigned.handled_at).not.toBe('');
		for (const change of [{ state: 'new' }, { state: 'discarded' }, { ticket: '' }]) {
			expect((await rejectionOf(items.update(item.id, change))).codes).toEqual({
				state: 'validation_inbox_item_handled'
			});
		}
	});

	it('assigns only tickets of the same scope and leaves the ticket unchanged', async () => {
		const items = owner.client.collection('inbox_items');
		const item = await createItem(owner);
		const foreign = await other.ticket();
		expect(
			(await rejectionOf(items.update(item.id, { state: 'converted', ticket: foreign.id }))).codes
		).toEqual({ ticket: 'validation_scope_mismatch' });
		expect((await items.getOne(item.id)).state).toBe('new');

		const ticket = await owner.ticket();
		await items.update(item.id, { state: 'converted', ticket: ticket.id });
		const after = await owner.client.collection('tickets').getOne(ticket.id);
		expect(after.source).toBe('');
		expect(after.source_item).toBe('');
		expect(after.updated).toBe(ticket.updated);
	});
});

describe('original file', () => {
	it('is protected: readable only with a file token of a user who sees the item', async () => {
		const content = `Message-ID: <${uniqueSuffix()}@example.com>\r\nSubject: Test\r\n\r\nHallo`;
		const form = new FormData();
		form.append('owner', owner.id);
		form.append('channel', 'eml');
		form.append('kind', 'mail');
		form.append('title', 'Mit Original');
		form.append('original', new Blob([content], { type: 'message/rfc822' }), 'mail.eml');
		const item = await owner.client.collection('inbox_items').create(form);
		expect(item.original).toMatch(/^mail_\w+\.eml$/);

		const url = `${pocketBaseUrl()}/api/files/inbox_items/${item.id}/${item.original}`;
		expect((await fetch(url)).status).toBe(404);
		const token = await owner.client.files.getToken();
		const response = await fetch(`${url}?token=${encodeURIComponent(token)}`);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe(content);
		const foreignToken = await other.client.files.getToken();
		expect((await fetch(`${url}?token=${encodeURIComponent(foreignToken)}`)).status).toBe(404);

		const replaced = new FormData();
		replaced.append('original', new Blob(['x']), 'other.eml');
		expect(
			(await rejectionOf(owner.client.collection('inbox_items').update(item.id, replaced))).codes
		).toEqual({ original: 'validation_inbox_immutable' });
	});

	it('is limited to one file of at most 25 MB (ADR-0031, addendum D)', async () => {
		const superuserView = await superuser.collections.getOne('inbox_items');
		const field = superuserView.fields.find((candidate) => candidate.name === 'original');
		expect(field).toMatchObject({ maxSelect: 1, maxSize: 25 * 1024 * 1024, protected: true });
		expect(await statusOf(superuser.collection('inbox_items').getList(1, 1))).toBe(200);

		// A dropped .eml of 20 MB goes through the record API with its file (the way of the SPA).
		const form = new FormData();
		form.set('owner', owner.id);
		form.set('channel', 'eml');
		form.set('kind', 'mail');
		form.set('title', 'Fotos');
		form.set('source_ref', `<${uniqueSuffix()}@example.com>`);
		form.set('original', new Blob(['Subject: Fotos\r\n\r\n', 'x'.repeat(20 * 1024 * 1024)]), 'fotos.eml');
		const created = await owner.client.collection('inbox_items').create(form);
		expect(created.original).toMatch(/^fotos_\w+\.eml$/);
	});
});
