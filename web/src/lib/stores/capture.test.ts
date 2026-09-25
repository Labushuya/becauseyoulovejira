// Saving a capture (E4 plan, package 5; OF-E4-3): template tags through the catalog, ticket with
// read mark or inbox entry, failures per field of the form.

import { describe, expect, it, vi } from 'vitest';
import type { InboxItem } from '$lib/domain/inbox';
import { EMPTY_CAPTURE_INPUT, buildCapture, type Capture } from '$lib/domain/templates';
import type { Ticket } from '$lib/domain/ticket';
import { DataError } from '$lib/data/errors';
import { parseQuickEntry } from '$lib/domain/quick-syntax';
import {
	draftsSummary,
	panelFreeTicketCreate,
	saveCapture,
	saveDrafts,
	saveQuickEntry,
	type CaptureDeps
} from './capture';

function capture(template: Capture['template'], values: Record<string, string>): Capture {
	const outcome = buildCapture(template, { ...EMPTY_CAPTURE_INPUT, tagIds: [], ...values });
	if (!outcome.ok) throw new Error('invalid test input');
	return outcome.capture;
}

const TICKET = { id: 'tick00000000001', key: 'TASK-7', created: '', status: 'open' } as Ticket;
const ITEM = { id: 'item00000000001', title: 'Anrufen: Anna' } as InboxItem;

function deps(overrides: Partial<CaptureDeps> = {}) {
	return {
		ensureTag: vi.fn(async (name: string) => ({
			ok: true as const,
			tag: { id: `tag-${name.toLowerCase()}`, name, updated: '' }
		})),
		createTicket: vi.fn(async () => ({ ok: true as const, ticket: TICKET })),
		createItem: vi.fn(async () => ({ kind: 'created' as const, item: ITEM })),
		markRead: vi.fn(),
		...overrides
	};
}

describe('saveCapture', () => {
	it('creates a ticket with the tag of the template and marks it read', async () => {
		const fake = deps();
		const result = await saveCapture(capture('call', { who: 'Anna' }), 'ticket', fake);
		expect(fake.ensureTag).toHaveBeenCalledWith('Anruf');
		expect(fake.createTicket).toHaveBeenCalledWith(
			expect.objectContaining({ title: 'Anrufen: Anna', tags: ['tag-anruf'] })
		);
		expect(fake.markRead).toHaveBeenCalledWith(TICKET);
		expect(fake.createItem).not.toHaveBeenCalled();
		expect(result).toEqual({
			ok: true,
			target: 'ticket',
			id: TICKET.id,
			message: 'Ticket TASK-7 angelegt.'
		});
	});

	it('puts an entry into the inbox with channel manual', async () => {
		const fake = deps();
		const result = await saveCapture(capture('call', { who: 'Anna' }), 'inbox', fake);
		expect(fake.createItem).toHaveBeenCalledWith(
			expect.objectContaining({
				channel: 'manual',
				kind: 'task',
				sourceMeta: { template: 'anruf', preset: { tags: ['tag-anruf'] } }
			})
		);
		expect(fake.createTicket).not.toHaveBeenCalled();
		expect(fake.markRead).not.toHaveBeenCalled();
		expect(result).toEqual({
			ok: true,
			target: 'inbox',
			id: ITEM.id,
			message: '„Anrufen: Anna“ liegt im Eingang.'
		});
	});

	it('stops when the tag of the template cannot be created', async () => {
		const fake = deps({
			ensureTag: vi.fn(async () => ({ ok: false as const, message: 'Höchstens 50 Zeichen.' }))
		});
		expect(await saveCapture(capture('shopping', { items: 'Milch' }), 'ticket', fake)).toEqual({
			ok: false,
			message: 'Tag „Einkauf“: Höchstens 50 Zeichen.',
			fields: {}
		});
		expect(fake.createTicket).not.toHaveBeenCalled();
	});

	it('maps failures of ticket fields to the fields of the form', async () => {
		const fake = deps({
			createTicket: vi.fn(async () => ({
				ok: false as const,
				message: null,
				fields: { title: 'Zu lang.', project: 'Das Projekt ist archiviert.', description: 'X.' }
			}))
		});
		const result = await saveCapture(
			capture('project_task', { what: 'A', project: 'proj00000000001' }),
			'ticket',
			fake
		);
		expect(result).toEqual({
			ok: false,
			message: 'X.',
			fields: { what: 'Zu lang.', project: 'Das Projekt ist archiviert.' }
		});
		const call = await saveCapture(
			capture('call', { who: 'B' }),
			'ticket',
			deps({
				createTicket: vi.fn(async () => ({
					ok: false as const,
					message: null,
					fields: { title: 'Pflichtfeld.' }
				}))
			})
		);
		expect(call).toEqual({ ok: false, message: null, fields: { who: 'Pflichtfeld.' } });
	});

	it('reports failures and duplicates of the inbox as message', async () => {
		const failed = deps({
			createItem: vi.fn(async () => ({
				kind: 'error' as const,
				message: null,
				fields: { title: 'Zu lang.' }
			}))
		});
		expect(await saveCapture(capture('todo', { what: 'A' }), 'inbox', failed)).toEqual({
			ok: false,
			message: 'Zu lang.',
			fields: {}
		});
		const duplicate = deps({
			createItem: vi.fn(async () => ({
				kind: 'duplicate' as const,
				state: 'new' as const,
				itemId: '',
				ticketId: '',
				ticketKey: '',
				message: 'Schon im Eingang.'
			}))
		});
		expect(await saveCapture(capture('todo', { what: 'A' }), 'inbox', duplicate)).toEqual({
			ok: false,
			message: 'Schon im Eingang.',
			fields: {}
		});
	});
});

describe('saveQuickEntry (E4 plan, package 6)', () => {
	const HOUSE = { id: 'proj00000000001', name: 'Haushalt', code: 'HAUS', archived: false };
	const CALL = { id: 'tag000000000001', name: 'Anruf' };
	const entry = (text: string) => parseQuickEntry(text, [HOUSE], [CALL]);

	it('creates a ticket with project, priority, existing and new tags and marks it read', async () => {
		const fake = deps();
		const result = await saveQuickEntry(
			entry('Zahnarzt @HAUS !hoch #anruf #Praxis'),
			'ticket',
			fake
		);
		expect(fake.ensureTag).toHaveBeenCalledExactlyOnceWith('Praxis');
		expect(fake.createTicket).toHaveBeenCalledWith({
			title: 'Zahnarzt',
			description: '',
			status: 'open',
			priority: 'high',
			due: null,
			project: HOUSE.id,
			tags: [CALL.id, 'tag-praxis']
		});
		expect(fake.markRead).toHaveBeenCalledWith(TICKET);
		expect(result).toMatchObject({
			ok: true,
			target: 'ticket',
			message: 'Ticket TASK-7 angelegt.'
		});
	});

	it('puts the line into the inbox with channel quick and the values as preset', async () => {
		const fake = deps();
		await saveQuickEntry(entry('Idee @HAUS #anruf'), 'inbox', fake);
		expect(fake.createItem).toHaveBeenCalledWith({
			channel: 'quick',
			kind: 'todo',
			title: 'Idee',
			sourceMeta: { preset: { project: HOUSE.id, tags: [CALL.id] } }
		});
		await saveQuickEntry(entry('Nur Text'), 'inbox', fake);
		expect(fake.createItem).toHaveBeenLastCalledWith({
			channel: 'quick',
			kind: 'todo',
			title: 'Nur Text'
		});
		expect(fake.markRead).not.toHaveBeenCalled();
	});

	it('refuses an empty title and reports failures as message', async () => {
		const fake = deps();
		expect(await saveQuickEntry(entry('@HAUS !1'), 'ticket', fake)).toEqual({
			ok: false,
			message: 'Der Titel darf nicht leer sein.',
			fields: {}
		});
		expect(fake.createTicket).not.toHaveBeenCalled();
		const failing = deps({
			createTicket: vi.fn(async () => ({
				ok: false as const,
				message: null,
				fields: { project: 'Das Projekt ist archiviert.' }
			}))
		});
		expect(await saveQuickEntry(entry('A @HAUS'), 'ticket', failing)).toEqual({
			ok: false,
			message: 'Das Projekt ist archiviert.',
			fields: {}
		});
	});
});

describe('panelFreeTicketCreate', () => {
	const session = () => ({ ensureValid: vi.fn(() => true), logout: vi.fn() });
	const draft = {
		title: ' Neu ',
		description: '',
		status: 'open' as const,
		priority: 'medium' as const,
		due: null,
		project: null,
		tags: []
	};

	it('puts the new ticket into the list and trims the title', async () => {
		const upsert = vi.fn();
		const create = vi.fn(async () => TICKET);
		const result = await panelFreeTicketCreate(create, session(), { upsert })(draft);
		expect(create).toHaveBeenCalledWith({ ...draft, title: 'Neu' });
		expect(upsert).toHaveBeenCalledWith(TICKET);
		expect(result).toEqual({ ok: true, ticket: TICKET });
	});

	it('maps field errors, ends a lost session and sends nothing without one', async () => {
		const guard = session();
		const upsert = vi.fn();
		const fields = await panelFreeTicketCreate(
			async () => {
				throw new DataError('validation', {
					status: 400,
					fields: { project: { code: 'x', message: 'Das Projekt ist archiviert.' } }
				});
			},
			guard,
			{ upsert }
		)(draft);
		expect(fields).toEqual({
			ok: false,
			message: null,
			fields: { project: 'Das Projekt ist archiviert.' }
		});
		const lost = await panelFreeTicketCreate(
			async () => {
				throw new DataError('session', { status: 401 });
			},
			guard,
			{ upsert }
		)(draft);
		expect(lost).toEqual({ ok: false, message: null, fields: {} });
		expect(guard.logout).toHaveBeenCalledOnce();
		const create = vi.fn();
		const none = await panelFreeTicketCreate(
			create,
			{ ensureValid: () => false, logout: vi.fn() },
			{ upsert }
		)(draft);
		expect(none).toEqual({ ok: false, message: null, fields: {} });
		expect(create).not.toHaveBeenCalled();
		expect(upsert).not.toHaveBeenCalled();
	});
});

describe('saveDrafts', () => {
	const draft = (title: string) => ({
		channel: 'clipboard' as const,
		kind: 'todo' as const,
		title
	});

	it('saves one after the other, counts duplicates and keeps failures with their reason', async () => {
		const createItem = vi
			.fn()
			.mockResolvedValueOnce({ kind: 'created', item: ITEM })
			.mockResolvedValueOnce({
				kind: 'duplicate',
				state: 'new',
				itemId: '',
				ticketId: '',
				ticketKey: '',
				message: 'Schon im Eingang.'
			})
			.mockResolvedValueOnce({ kind: 'error', message: 'Server nicht erreichbar.', fields: {} })
			.mockResolvedValueOnce({ kind: 'created', item: ITEM });
		const outcome = await saveDrafts([draft('a'), draft('b'), draft('c'), draft('d')], createItem);
		expect(outcome).toEqual({
			created: 2,
			duplicates: 1,
			failures: [{ title: 'c', message: 'Server nicht erreichbar.' }]
		});
		expect(draftsSummary(outcome)).toBe(
			'2 Einträge im Eingang, 1 schon vorhanden, 1 fehlgeschlagen.'
		);
	});

	it('stops at a lost session', async () => {
		const createItem = vi
			.fn()
			.mockResolvedValueOnce({ kind: 'error', message: null, fields: {} })
			.mockResolvedValueOnce({ kind: 'created', item: ITEM });
		expect(await saveDrafts([draft('a'), draft('b')], createItem)).toEqual({
			created: 0,
			duplicates: 0,
			failures: []
		});
		expect(createItem).toHaveBeenCalledOnce();
		expect(draftsSummary({ created: 1, duplicates: 0, failures: [] })).toBe(
			'1 Eintrag im Eingang.'
		);
	});
});
