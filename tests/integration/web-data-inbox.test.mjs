// Data layer of the inbox against the disposable instance (E4 plan, package 2; ADR-0014): new
// entries in full, handled ones page by page, duplicates as outcome, actions, the protected
// original, realtime and the ticket created from an entry.

import { readFileSync } from 'node:fs';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { superuserClient } from '../support/api.mjs';
import { createOwner, uniqueSuffix } from '../support/scenario.mjs';
import { DataError } from '../../web/src/lib/data/errors.ts';
import {
	assignToTicket,
	createItem,
	discardItem,
	getItem,
	importCalendarFile,
	listHandledItems,
	listTicketSources,
	lookupDrafts,
	previewCalendarFile,
	listNewItems,
	originalFileUrl,
	releaseItem,
	restoreItem
} from '../../web/src/lib/data/inbox.ts';
import { getImportKeywords, saveImportKeywords } from '../../web/src/lib/data/import-keywords.ts';
import { subscribeInboxItems } from '../../web/src/lib/data/realtime.ts';
import { createTicket, deleteTicket, getTicket, listOpenTickets } from '../../web/src/lib/data/tickets.ts';
import { bookmarkletValues } from '../../web/src/lib/domain/bookmarklet.ts';
import {
	EMPTY_CAPTURE_INPUT,
	buildCapture,
	captureInboxDraft
} from '../../web/src/lib/domain/templates.ts';
import { messageDraft, parseWhatsAppExport } from '../../web/src/lib/domain/whatsapp-export.ts';
import { readMailFile } from '../../web/src/lib/mail-file.ts';

const EML = new URL('../fixtures/eml/', import.meta.url);

/** A fixture as File, the way the browser hands a dropped file over. */
function emlFile(name) {
	return new File([readFileSync(new URL(name, EML))], name, { type: 'message/rfc822' });
}

const EVENT_TIMEOUT_MS = 5_000;

let superuser;
let owner;
let other;

function ticketDraft(overrides = {}) {
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

async function created(pb, draft) {
	const outcome = await createItem(pb, draft);
	if (outcome.kind !== 'created') throw new Error(`Expected a new entry, got ${outcome.kind}`);
	return outcome.item;
}

function mail(overrides = {}) {
	return {
		channel: 'eml',
		kind: 'mail',
		title: `Mail ${uniqueSuffix()}`,
		sourceRef: `<${uniqueSuffix()}@example.com>`,
		...overrides
	};
}

beforeAll(async () => {
	superuser = await superuserClient();
	owner = await createOwner(superuser);
	other = await createOwner(superuser);
});

afterAll(async () => {
	await owner?.client.realtime.unsubscribe();
});

describe('create and read', () => {
	it('creates an entry with all fields and reads it back', async () => {
		const item = await created(owner.client, {
			channel: 'eml',
			kind: 'mail',
			title: '  Rechnung\r\n September ',
			body: 'Hallo',
			sourceRef: `<${uniqueSuffix()}@example.com>`,
			sourceDate: '2026-09-25T08:30:00Z',
			sourceMeta: { from: 'shop@example.com' }
		});
		expect(item).toMatchObject({
			channel: 'eml',
			kind: 'mail',
			title: 'Rechnung September',
			body: 'Hallo',
			sourceDate: '2026-09-25 08:30:00.000Z',
			sourceMeta: { from: 'shop@example.com' },
			state: 'new',
			ticketId: null,
			handledAt: null,
			original: ''
		});
		expect(await getItem(owner.client, item.id)).toEqual(item);
	});

	it('lists every new entry of the user, newest first, without the text', async () => {
		const fresh = await createOwner(superuser);
		const first = await created(fresh.client, mail());
		const second = await created(fresh.client, mail());
		await created(other.client, mail());
		const discarded = await created(fresh.client, mail());
		await discardItem(fresh.client, discarded.id);

		const items = await listNewItems(fresh.client);
		expect(items.map((item) => item.id)).toEqual([second.id, first.id]);
		expect(items[0]).not.toHaveProperty('body');
	});

	it('returns a duplicate as outcome with state and ticket key', async () => {
		const draft = mail();
		const item = await created(owner.client, draft);
		expect(await createItem(owner.client, { ...draft, channel: 'mail' })).toEqual({
			kind: 'duplicate',
			state: 'new',
			itemId: item.id,
			ticketId: '',
			ticketKey: '',
			message: 'Schon im Eingang.'
		});

		const ticket = await createTicket(owner.client, ticketDraft(), {
			origin: { sourceItem: item.id }
		});
		expect(await createItem(owner.client, draft)).toMatchObject({
			kind: 'duplicate',
			state: 'converted',
			ticketId: ticket.id,
			ticketKey: ticket.key,
			message: `Schon Ticket ${ticket.key}.`
		});
	});

	it('reports the same web link from the bookmarklet twice as duplicate (package 7)', async () => {
		const path = `/artikel-${uniqueSuffix()}`;
		const draftFor = (query) => {
			const values = bookmarkletValues(new URLSearchParams(query));
			const outcome = buildCapture('link', {
				...EMPTY_CAPTURE_INPUT,
				tagIds: [],
				url: values.url ?? '',
				what: values.title,
				excerpt: values.selection
			});
			if (!outcome.ok) throw new Error('invalid capture');
			return captureInboxDraft(outcome.capture, []);
		};
		const first = await createItem(
			owner.client,
			draftFor(new URLSearchParams({ url: `https://Example.com${path}#oben`, titel: 'Artikel' }))
		);
		expect(first).toMatchObject({
			kind: 'created',
			item: { channel: 'link', kind: 'link', sourceUrl: `https://Example.com${path}#oben` }
		});
		const again = await createItem(
			owner.client,
			draftFor(
				new URLSearchParams({
					url: `https://example.com:443${path}?utm_source=x`,
					titel: 'Anderer Titel',
					auswahl: 'Zitat'
				})
			)
		);
		expect(again).toEqual({
			kind: 'duplicate',
			state: 'new',
			itemId: first.item.id,
			ticketId: '',
			ticketKey: '',
			message: 'Schon im Eingang.'
		});
	});

	it('throws other failures as DataError with the field', async () => {
		await expect(
			createItem(owner.client, { channel: 'link', kind: 'link', title: 'x', sourceUrl: 'data:x' })
		).rejects.toMatchObject({
			kind: 'validation',
			fields: { source_url: { code: 'validation_invalid_url' } }
		});
		await expect(getItem(owner.client, (await created(other.client, mail())).id)).rejects.toBeInstanceOf(
			DataError
		);
	});
});

describe('actions', () => {
	it('discards, restores and pages through handled entries', async () => {
		const fresh = await createOwner(superuser);
		const items = [];
		for (let index = 0; index < 3; index += 1) items.push(await created(fresh.client, mail()));
		for (const item of items) await discardItem(fresh.client, item.id);

		const first = await listHandledItems(fresh.client, 'discarded', 1, { perPage: 2 });
		const second = await listHandledItems(fresh.client, 'discarded', 2, { perPage: 2 });
		expect(first.hasMore).toBe(true);
		expect(second.hasMore).toBe(false);
		const order = [...first.items, ...second.items];
		expect(order.map((item) => item.id).sort()).toEqual(items.map((item) => item.id).sort());
		for (let index = 1; index < order.length; index += 1) {
			expect(order[index - 1].handledAt >= order[index].handledAt).toBe(true);
		}
		expect(order.every((item) => item.state === 'discarded' && item.handledAt !== null)).toBe(true);

		const restored = await restoreItem(fresh.client, items[0].id);
		expect(restored).toMatchObject({ state: 'new', handledAt: null });
		expect((await listNewItems(fresh.client)).map((item) => item.id)).toEqual([items[0].id]);
		expect((await listHandledItems(fresh.client, 'converted', 1)).items).toEqual([]);

		// View "Alle" (ADR-0031, addendum C): every state, newest first, with the source filter.
		const every = await listHandledItems(fresh.client, 'all', 1);
		expect(every.items.map((item) => item.id)).toEqual([...items].reverse().map((item) => item.id));
		expect(every.items.map((item) => item.state)).toEqual(['discarded', 'discarded', 'new']);
		expect((await listHandledItems(fresh.client, 'all', 1, { channels: ['link'] })).items).toEqual([]);
	});

	it('narrows handled entries to the channels of a source family on the server', async () => {
		const fresh = await createOwner(superuser);
		const fromMail = await created(fresh.client, mail());
		const fromLink = await created(fresh.client, {
			channel: 'link',
			kind: 'link',
			title: 'Artikel',
			sourceUrl: `https://example.com/${uniqueSuffix()}`
		});
		const typed = await created(fresh.client, { channel: 'quick', kind: 'todo', title: 'Notiz' });
		for (const item of [fromMail, fromLink, typed]) await discardItem(fresh.client, item.id);

		const ids = async (channels) =>
			(await listHandledItems(fresh.client, 'discarded', 1, { channels })).items.map(
				(item) => item.id
			);
		expect(await ids(['eml', 'mail'])).toEqual([fromMail.id]);
		expect(await ids(['manual', 'quick', 'clipboard'])).toEqual([typed.id]);
		expect((await ids(null)).sort()).toEqual([fromMail.id, fromLink.id, typed.id].sort());
		await expect(
			listHandledItems(fresh.client, 'discarded', 1, { channels: ['a', 'b', 'c', 'd'] })
		).rejects.toBeInstanceOf(DataError);
	});

	it('assigns an entry to an existing ticket', async () => {
		const item = await created(owner.client, mail());
		const ticket = await createTicket(owner.client, ticketDraft());
		const assigned = await assignToTicket(owner.client, item.id, ticket.id);
		expect(assigned).toMatchObject({ state: 'converted', ticketId: ticket.id });
		expect((await getTicket(owner.client, ticket.id)).source).toBe('manual');
	});

	it('gives the address of the protected original with a fresh file token', async () => {
		const content = `Message-ID: <${uniqueSuffix()}@example.com>\r\n\r\nHallo`;
		const original = new File([content], 'mail.eml', { type: 'message/rfc822' });
		const item = await created(owner.client, mail({ original }));
		const url = await originalFileUrl(owner.client, item);
		expect(url).toContain('token=');
		const response = await fetch(url);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe(content);
		expect(await originalFileUrl(owner.client, { id: item.id, original: '' })).toBeNull();
	});
});

describe('mail files (E4 plan, package 8)', () => {
	async function readDraft(name) {
		const result = await readMailFile(emlFile(name));
		if (!result.ok) throw new Error(result.message);
		return result.draft;
	}

	it('keeps a dropped .eml with its fields and the original file, and knows it the second time', async () => {
		const fresh = await createOwner(superuser);
		const outcome = await createItem(fresh.client, await readDraft('latin1-qp.eml'));
		expect(outcome).toMatchObject({
			kind: 'created',
			item: {
				channel: 'eml',
				kind: 'mail',
				title: 'Straßenfest am Südplatz',
				sourceRef: '<latin1.qp@example.com>',
				sourceDate: '2026-10-05 08:00:00.000Z',
				sourceMeta: { from: 'Jürgen Müller <juergen@example.com>' }
			}
		});
		expect(outcome.item.original).toMatch(/\.eml$/);
		expect(outcome.item.body).toMatch(/^Schöne Grüße/);

		const url = await originalFileUrl(fresh.client, outcome.item);
		const response = await fetch(url);
		expect(response.status).toBe(200);
		expect(Buffer.from(await response.arrayBuffer())).toEqual(
			readFileSync(new URL('latin1-qp.eml', EML))
		);

		expect(await createItem(fresh.client, await readDraft('latin1-qp.eml'))).toEqual({
			kind: 'duplicate',
			state: 'new',
			itemId: outcome.item.id,
			ticketId: '',
			ticketKey: '',
			message: 'Schon im Eingang.'
		});
	});

	it('knows a mail without Message-ID again by sender, date and subject', async () => {
		const fresh = await createOwner(superuser);
		const first = await createItem(fresh.client, await readDraft('no-message-id.eml'));
		expect(first).toMatchObject({ kind: 'created', item: { sourceRef: '' } });
		expect(await createItem(fresh.client, await readDraft('no-message-id.eml'))).toMatchObject({
			kind: 'duplicate',
			itemId: first.item.id
		});
	});

	it('takes HTML-only mails and mails with attachments as text with their count', async () => {
		const fresh = await createOwner(superuser);
		const html = await createItem(fresh.client, await readDraft('html-only.eml'));
		expect(html).toMatchObject({ kind: 'created', item: { sourceMeta: { html_only: true } } });
		expect(html.item.body).not.toMatch(/tracker|script|alert/);
		const withFiles = await createItem(fresh.client, await readDraft('attachments.eml'));
		expect(withFiles).toMatchObject({ kind: 'created', item: { sourceMeta: { attachments: 2 } } });
	});

	it('keeps a mail with alternative parts, inline image and attachment with its original (BYL-E6-942)', async () => {
		const fresh = await createOwner(superuser);
		const name = 'alternative-inline-attachment.eml';
		const outcome = await createItem(fresh.client, await readDraft(name));
		expect(outcome).toMatchObject({
			kind: 'created',
			item: {
				channel: 'eml',
				kind: 'mail',
				title: 'Prüfbericht für März',
				sourceRef: '<alternative.inline.attachment@example.com>',
				sourceDate: '2026-10-12 12:30:00.000Z',
				sourceMeta: {
					from: 'Jürgen Müller <juergen@example.com>',
					to: 'Anna Beispiel <anna@example.com>',
					attachments: 2
				}
			}
		});
		// The form upload with the original turns the line breaks of the text into CRLF.
		expect(outcome.item.body.replace(/\r\n/g, '\n')).toBe(
			'Hallo Anna,\n\nanbei der Prüfbericht für März.\n\nViele Grüße\nJürgen\n\n_2 Anhänge, nur in der Originaldatei._'
		);
		expect(outcome.item.original).toMatch(/\.eml$/);
		const response = await fetch(await originalFileUrl(fresh.client, outcome.item));
		expect(response.status).toBe(200);
		expect(Buffer.from(await response.arrayBuffer())).toEqual(readFileSync(new URL(name, EML)));
	});
});

describe('calendar files (E4 plan, package 14)', () => {
	const ics = (name) =>
		new File([readFileSync(new URL(`../fixtures/ics/${name}`, import.meta.url))], name, {
			type: 'text/calendar'
		});

	it('uploads an .ics file and gets the counts; the entries are events of channel ics', async () => {
		const fresh = await createOwner(superuser);
		expect(await importCalendarFile(fresh.client, ics('outlook.ics'), [0, 1])).toEqual({
			created: 2,
			duplicates: 0,
			skipped: 0,
			failed: 0,
			itemId: ''
		});
		const items = await listNewItems(fresh.client);
		expect(items.map((item) => [item.channel, item.kind, item.title]).sort()).toEqual([
			['ics', 'event', 'Quartalsplanung'],
			['ics', 'event', 'Weihnachten bei der Familie']
		]);
		const holiday = items.find((item) => item.title === 'Weihnachten bei der Familie');
		expect(holiday?.sourceMeta).toMatchObject({ all_day: true });
		expect(await importCalendarFile(fresh.client, ics('outlook.ics'), [1, 0])).toMatchObject({
			created: 0,
			duplicates: 2
		});
	});

	it('fails with a data error for guests', async () => {
		const guest = new PocketBase(superuser.baseURL);
		await expect(importCalendarFile(guest, ics('apple.ics'), [0])).rejects.toMatchObject({
			kind: 'session'
		});
	});
});

describe('selection of dropped files (E4 plan, package 21)', () => {
	const ics = (name) =>
		new File([readFileSync(new URL(`../fixtures/ics/${name}`, import.meta.url))], name, {
			type: 'text/calendar'
		});

	it('keeps the keyword lists of the user and uses them in the calendar preview', async () => {
		const fresh = await createOwner(superuser);
		expect(await getImportKeywords(fresh.client)).toEqual({
			eml: { keywords: [], matchBody: false },
			ics: { keywords: [], matchBody: false },
			whatsapp: { keywords: [], matchBody: false },
			api: { keywords: [], matchBody: false },
			'whatsapp-web': { keywords: [], matchBody: false }
		});
		const saved = await saveImportKeywords(fresh.client, {
			eml: { keywords: ['rechnung'], matchBody: true },
			ics: { keywords: ['quartal'], matchBody: false },
			whatsapp: { keywords: ['milch'], matchBody: false },
			api: { keywords: ['todo'], matchBody: false },
			'whatsapp-web': { keywords: ['#byl'], matchBody: false }
		});
		expect(saved.ics.keywords).toEqual(['quartal']);
		expect(saved['whatsapp-web'].keywords).toEqual(['#byl']);
		expect(await getImportKeywords(fresh.client)).toEqual(saved);
		await expect(
			saveImportKeywords(fresh.client, { ...saved, ics: { keywords: ['x'.repeat(101)], matchBody: false } })
		).rejects.toMatchObject({ kind: 'validation', fields: { import_keywords: expect.anything() } });

		const preview = await previewCalendarFile(fresh.client, ics('outlook.ics'));
		expect(preview.items.map((item) => [item.title, item.keyword, item.state]).sort()).toEqual([
			['Quartalsplanung', 'quartal', ''],
			['Weihnachten bei der Familie', '', '']
		]);
		const planning = preview.items.find((item) => item.keyword === 'quartal');
		expect(await importCalendarFile(fresh.client, ics('outlook.ics'), [planning.index])).toMatchObject({
			created: 1
		});
		const [item] = await listNewItems(fresh.client);
		expect(item.sourceMeta).toMatchObject({ keyword: 'quartal' });
		const again = await previewCalendarFile(fresh.client, ics('outlook.ics'));
		expect(again.items.find((entry) => entry.index === planning.index)).toMatchObject({
			state: 'new',
			message: 'Schon im Eingang.'
		});
	});

	it('looks up whether dropped mails are in the inbox already', async () => {
		const fresh = await createOwner(superuser);
		const read = await readMailFile(emlFile('utf8-plain.eml'));
		if (!read.ok) throw new Error(read.message);
		expect(await lookupDrafts(fresh.client, [read.draft])).toEqual([{ state: '', message: '' }]);
		await createItem(fresh.client, read.draft);
		expect(await lookupDrafts(fresh.client, [read.draft])).toEqual([
			{ state: 'new', message: 'Schon im Eingang.' }
		]);
		expect(await lookupDrafts(fresh.client, [])).toEqual([]);
	});
});

describe('WhatsApp export (E4 plan, package 16)', () => {
	const exported = parseWhatsAppExport(
		readFileSync(
			new URL('../fixtures/whatsapp/WhatsApp Chat mit Familie Beispiel.txt', import.meta.url),
			'utf8'
		)
	);

	it('takes chosen messages as entries and knows the same export again', async () => {
		const fresh = await createOwner(superuser);
		const drafts = exported.messages.map((message) => messageDraft(message, 'Familie Beispiel'));
		for (const draft of drafts) {
			expect(await createItem(fresh.client, draft)).toMatchObject({
				kind: 'created',
				item: { channel: 'whatsapp', kind: 'message', sourceMeta: { chat: 'Familie Beispiel' } }
			});
		}
		const [list] = await listNewItems(fresh.client).then((items) =>
			items.filter((item) => item.title === 'Ich! Liste bitte:')
		);
		expect(list.sourceDate).toBe('2026-03-29 01:05:00.000Z');
		for (const draft of drafts) {
			expect(await createItem(fresh.client, draft)).toMatchObject({ kind: 'duplicate' });
		}
		// The same text at the same minute from the same sender in the same chat counts as one.
		const again = { ...drafts[0], title: 'Anderer Titel' };
		expect(await createItem(fresh.client, again)).toMatchObject({ kind: 'duplicate' });
		const otherChat = { ...drafts[0], sourceMeta: { chat: 'Anderer Chat', sender: 'Anna Beispiel' } };
		expect(await createItem(fresh.client, otherChat)).toMatchObject({ kind: 'created' });
	});
});

describe('tickets from the inbox', () => {
	it('creates tickets with the source of the form or of the entry', async () => {
		const plain = await createTicket(owner.client, ticketDraft());
		expect(plain).toMatchObject({ source: 'manual', sourceItem: null });
		const quick = await createTicket(owner.client, ticketDraft(), { origin: { source: 'quick' } });
		expect(quick.source).toBe('quick');

		const item = await created(owner.client, mail());
		const converted = await createTicket(owner.client, ticketDraft(), {
			origin: { sourceItem: item.id }
		});
		expect(converted).toMatchObject({ source: 'eml', sourceItem: item.id });
		expect(await getItem(owner.client, item.id)).toMatchObject({
			state: 'converted',
			ticketId: converted.id
		});
		const listed = (await listOpenTickets(owner.client)).find((ticket) => ticket.id === converted.id);
		expect(listed?.source).toBe('eml');
		expect(listed).not.toHaveProperty('sourceItem');

		await expect(
			createTicket(owner.client, ticketDraft(), { origin: { sourceItem: item.id } })
		).rejects.toMatchObject({
			kind: 'validation',
			fields: { source_item: { code: 'validation_inbox_item_handled' } }
		});
	});
});

describe('sources of a ticket (ADR-0031, HK-2)', () => {
	it('lists the sources, links another entry and releases it again', async () => {
		const main = await created(owner.client, mail());
		const ticket = await createTicket(owner.client, ticketDraft(), {
			origin: { sourceItem: main.id }
		});
		const extra = await created(owner.client, {
			channel: 'telegram',
			kind: 'message',
			title: 'Chat',
			sourceRef: `1:${uniqueSuffix()}`
		});
		const linked = await assignToTicket(owner.client, extra.id, ticket.id);
		expect(linked).toMatchObject({ state: 'converted', ticketId: ticket.id });
		const ref = { id: ticket.id, key: ticket.key, title: ticket.title };
		expect(linked.ticket).toEqual({ ...ref, primary: false });

		const sources = await listTicketSources(owner.client, ticket.id);
		expect(sources.map((item) => item.id)).toEqual([main.id, extra.id]);
		expect(sources[0]).not.toHaveProperty('body');
		expect(sources.map((item) => item.ticket)).toEqual([
			{ ...ref, primary: true },
			{ ...ref, primary: false }
		]);
		expect((await getItem(owner.client, main.id)).ticket).toEqual({ ...ref, primary: true });

		// Moving to another ticket (ADR-0031 addendum): the same update, the main source never.
		const next = await createTicket(owner.client, ticketDraft());
		const moved = await assignToTicket(owner.client, extra.id, next.id);
		expect(moved).toMatchObject({ state: 'converted', ticketId: next.id });
		expect(moved.ticket).toMatchObject({ id: next.id, key: next.key, primary: false });
		await expect(assignToTicket(owner.client, main.id, next.id)).rejects.toMatchObject({
			kind: 'validation',
			fields: { ticket: { code: 'validation_inbox_primary_source' } }
		});
		await assignToTicket(owner.client, extra.id, ticket.id);
		expect(await listTicketSources(other.client, ticket.id)).toEqual([]);

		const released = await releaseItem(owner.client, extra.id);
		expect(released).toMatchObject({ state: 'new', ticketId: null, handledAt: null });
		const left = await listTicketSources(owner.client, ticket.id);
		expect(left.map((item) => item.id)).toEqual([main.id]);

		await expect(releaseItem(owner.client, main.id)).rejects.toMatchObject({
			kind: 'validation',
			fields: { state: { code: 'validation_inbox_primary_source' } }
		});
	});
});

describe('realtime', () => {
	it('delivers created, updated and deleted entries of the user as domain records', async () => {
		const changes = [];
		const ticket = await createTicket(owner.client, ticketDraft());
		const stop = await subscribeInboxItems(owner.client, (change) => changes.push(change));
		try {
			const item = await created(owner.client, mail());
			await assignToTicket(owner.client, item.id, ticket.id);
			// No entry is deleted through the API (ADR-0014, addendum of 2026-10-01): a source that
			// goes with its ticket into the trash ("Quellen verwerfen") leaves with a delete event.
			await deleteTicket(owner.client, ticket.id, { sources: 'discard' });
			await created(other.client, mail());

			const deadline = Date.now() + EVENT_TIMEOUT_MS;
			while (changes.filter((change) => change.action === 'delete').length === 0) {
				if (Date.now() > deadline) throw new Error('No delete event.');
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			expect(changes.map((change) => change.action)).toEqual(['create', 'update', 'delete']);
			expect(changes[0].record).toMatchObject({ id: item.id, state: 'new' });
			expect(changes[0].record).not.toHaveProperty('body');
			expect(changes[1].record).toMatchObject({ id: item.id, state: 'converted', ticketId: ticket.id });
			expect(changes[2]).toEqual({ action: 'delete', id: item.id });
		} finally {
			await stop();
		}
	});

	it('names the ticket of a linked entry in the event (ADR-0031 addendum)', async () => {
		const ticket = await createTicket(owner.client, ticketDraft());
		const item = await created(owner.client, mail());
		const changes = [];
		const stop = await subscribeInboxItems(owner.client, (change) => changes.push(change));
		try {
			await assignToTicket(owner.client, item.id, ticket.id);
			const deadline = Date.now() + EVENT_TIMEOUT_MS;
			while (changes.length === 0) {
				if (Date.now() > deadline) throw new Error('No update event.');
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			expect(changes[0].record.ticket).toEqual({
				id: ticket.id,
				key: ticket.key,
				title: ticket.title,
				primary: false
			});
		} finally {
			await stop();
		}
	});
});
