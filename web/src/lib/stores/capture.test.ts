// Saving a capture (E4 plan, package 5; OF-E4-3): template tags through the catalog, ticket with
// read mark or inbox entry, failures per field of the form.

import { describe, expect, it, vi } from 'vitest';
import type { InboxItem } from '$lib/domain/inbox';
import { EMPTY_CAPTURE_INPUT, buildCapture, type Capture } from '$lib/domain/templates';
import type { Ticket } from '$lib/domain/ticket';
import { saveCapture, type CaptureDeps } from './capture';

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
