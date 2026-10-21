// "＋" without a connection in the quick entry (OF-4a, ADR-0074 addendum OF-4a): a line kept by the
// outbox says so instead of an error, a ticket kept for later is not taken into the list as one of the
// server, and new `#tags` give a hint instead of losing the text (concept §2.2).

import { describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { InboxItem } from '$lib/domain/inbox';
import { parseQuickEntry } from '$lib/domain/quick-syntax';
import type { Ticket } from '$lib/domain/ticket';
import {
	panelFreeTicketCreate,
	quickItemCreate,
	saveQuickEntry,
	type CaptureDeps,
	type QuickOutbox
} from './capture';

const HOUSE = { id: 'proj00000000001', name: 'Haushalt', code: 'HAUS', archived: false };
const CALL = { id: 'tag000000000001', name: 'Anruf' };
const entry = (text: string) => parseQuickEntry(text, [HOUSE], [CALL]);
const KEPT = { id: 'aaaaaaaaaaaaaaa', key: '', title: 'Zahnarzt' } as Ticket;
const SERVED = { id: 'aaaaaaaaaaaaaaa', key: 'HAUS-13', title: 'Zahnarzt' } as Ticket;
const ITEM = { id: 'aaaaaaaaaaaaaaa', title: 'Idee', channel: 'quick' } as InboxItem;

function deps(overrides: Partial<CaptureDeps> = {}) {
	return {
		ensureTag: vi.fn(async (name: string) => ({
			ok: true as const,
			tag: { id: `tag-${name.toLowerCase()}`, name, updated: '' }
		})),
		createTicket: vi.fn(async () => ({ ok: true as const, ticket: KEPT, kept: true as const })),
		createItem: vi.fn(async () => ({ kind: 'created' as const, item: ITEM, kept: true as const })),
		markRead: vi.fn(),
		keep: { takes: vi.fn(() => true), offline: vi.fn(() => true) },
		...overrides
	};
}

function session() {
	return { ensureValid: vi.fn(() => true), logout: vi.fn() };
}

function outbox(kept: boolean): QuickOutbox & { takes: ReturnType<typeof vi.fn> } {
	return {
		takes: vi.fn(() => true),
		createTicket: vi.fn(async () => ({ value: kept ? KEPT : SERVED, kept })),
		createItem: vi.fn(async () => ({ value: ITEM, kept }))
	};
}

describe('saveQuickEntry without a connection (OF-4a)', () => {
	it('says that a ticket is kept and created later, and marks nothing read yet', async () => {
		const fake = deps();
		const result = await saveQuickEntry(entry('Zahnarzt @HAUS #anruf'), 'ticket', fake);
		expect(result).toEqual({
			ok: true,
			target: 'ticket',
			id: KEPT.id,
			message: 'Ticket „Zahnarzt“ gemerkt. Es wird angelegt, sobald die Verbindung zurück ist.'
		});
		expect(fake.markRead).not.toHaveBeenCalled();
	});

	it('says that an entry is kept for the inbox', async () => {
		const result = await saveQuickEntry(entry('Idee'), 'inbox', deps());
		expect(result).toMatchObject({
			ok: true,
			target: 'inbox',
			message: '„Idee“ gemerkt. Der Eintrag kommt in den Eingang, sobald die Verbindung zurück ist.'
		});
	});

	it('keeps the line with a hint for new #tags instead of asking the server', async () => {
		for (const target of ['ticket', 'inbox'] as const) {
			const fake = deps();
			const result = await saveQuickEntry(entry('Zahnarzt #anruf #Praxis #neu'), target, fake);
			expect(result).toEqual({
				ok: false,
				message:
					'Neue Tags gehen nur mit Verbindung: #Praxis, #neu. Entferne sie oder wähle vorhandene Tags, dann wird der Eintrag gemerkt.',
				fields: {}
			});
			expect(fake.ensureTag).not.toHaveBeenCalled();
			expect(fake.createTicket).not.toHaveBeenCalled();
			expect(fake.createItem).not.toHaveBeenCalled();
		}
	});

	it('says it neutrally when the line was kept while the connection is there, after a 5xx (OF-4b, B-3)', async () => {
		const online = { takes: () => true, offline: () => false };
		const ticket = await saveQuickEntry(entry('Zahnarzt'), 'ticket', deps({ keep: online }));
		expect(ticket).toMatchObject({
			ok: true,
			message: 'Ticket „Zahnarzt“ gemerkt. Es wird später erneut übertragen.'
		});
		const item = await saveQuickEntry(entry('Idee'), 'inbox', deps({ keep: online }));
		expect(item).toMatchObject({
			ok: true,
			message: '„Idee“ gemerkt. Der Eintrag wird später erneut übertragen.'
		});
	});

	it('asks the server for a new tag as today where the outbox does not take "＋" or the connection is there', async () => {
		const outside = deps({ keep: { takes: () => false, offline: () => true } });
		await saveQuickEntry(entry('Zahnarzt #Praxis'), 'ticket', outside);
		expect(outside.ensureTag).toHaveBeenCalledWith('Praxis');
		const online = deps({ keep: { takes: () => true, offline: () => false } });
		await saveQuickEntry(entry('Zahnarzt #Praxis'), 'ticket', online);
		expect(online.ensureTag).toHaveBeenCalledWith('Praxis');
	});
});

describe('panelFreeTicketCreate through the outbox (OF-4a)', () => {
	const draft = {
		title: ' Zahnarzt ',
		description: '',
		status: 'open' as const,
		priority: 'medium' as const,
		due: null,
		project: null,
		tags: []
	};

	it('keeps a ticket for later without taking it into the list as one of the server', async () => {
		const upsert = vi.fn();
		const direct = vi.fn();
		const route = outbox(true);
		const result = await panelFreeTicketCreate(direct, session(), { upsert }, route)(draft);
		expect(route.createTicket).toHaveBeenCalledWith({ ...draft, title: 'Zahnarzt' });
		expect(direct).not.toHaveBeenCalled();
		expect(upsert).not.toHaveBeenCalled();
		expect(result).toEqual({ ok: true, ticket: KEPT, kept: true });
	});

	it('takes the answer of the server into the list as today', async () => {
		const upsert = vi.fn();
		const result = await panelFreeTicketCreate(
			vi.fn(),
			session(),
			{ upsert },
			outbox(false)
		)(draft);
		expect(upsert).toHaveBeenCalledWith(SERVED);
		expect(result).toEqual({ ok: true, ticket: SERVED });
	});

	it('goes the way of today where the outbox does not take "＋"', async () => {
		const route = outbox(true);
		route.takes.mockReturnValue(false);
		const direct = vi.fn(async () => SERVED);
		const result = await panelFreeTicketCreate(
			direct,
			session(),
			{ upsert: vi.fn() },
			route
		)(draft);
		expect(direct).toHaveBeenCalled();
		expect(route.createTicket).not.toHaveBeenCalled();
		expect(result).toEqual({ ok: true, ticket: SERVED });
	});

	it('maps a refusal of the outbox like one of today: the line stays', async () => {
		const route = outbox(true);
		route.createTicket = vi.fn(async () => {
			throw new DataError('validation', {
				status: 400,
				fields: { project: { code: 'x', message: 'Das Projekt ist archiviert.' } }
			});
		});
		const result = await panelFreeTicketCreate(
			vi.fn(),
			session(),
			{ upsert: vi.fn() },
			route
		)(draft);
		expect(result).toMatchObject({
			ok: false,
			message: null,
			fields: { project: 'Das Projekt ist archiviert.' }
		});
	});
});

describe('quickItemCreate (OF-4a)', () => {
	const draft = {
		channel: 'quick' as const,
		kind: 'todo' as const,
		title: 'Idee',
		sourceMeta: { preset: { project: HOUSE.id, tags: [CALL.id], priority: 'high' } }
	};

	it('puts the line through the outbox with its preset and keeps it out of the inbox until the server has it', async () => {
		const route = outbox(true);
		const upsert = vi.fn();
		const direct = vi.fn();
		const result = await quickItemCreate(direct, route, session(), { upsert })(draft);
		expect(route.createItem).toHaveBeenCalledWith({
			title: 'Idee',
			project: HOUSE.id,
			tags: [CALL.id],
			priority: 'high'
		});
		expect(upsert).not.toHaveBeenCalled();
		expect(direct).not.toHaveBeenCalled();
		expect(result).toEqual({ kind: 'created', item: ITEM, kept: true });
	});

	it('takes an answer of the server into the inbox, and goes the way of today without the outbox', async () => {
		const upsert = vi.fn();
		expect(await quickItemCreate(vi.fn(), outbox(false), session(), { upsert })(draft)).toEqual({
			kind: 'created',
			item: ITEM
		});
		expect(upsert).toHaveBeenCalledWith(ITEM);
		const route = outbox(true);
		route.takes.mockReturnValue(false);
		const direct = vi.fn(async () => ({ kind: 'created' as const, item: ITEM }));
		await quickItemCreate(direct, route, session(), { upsert })(draft);
		expect(direct).toHaveBeenCalledWith(draft);
	});

	it('ends a lost session and says nothing more', async () => {
		const route = outbox(true);
		route.createItem = vi.fn(async () => {
			throw new DataError('session', { status: 401 });
		});
		const guard = session();
		expect(await quickItemCreate(vi.fn(), route, guard, { upsert: vi.fn() })(draft)).toEqual({
			kind: 'error',
			message: null,
			fields: {}
		});
		expect(guard.logout).toHaveBeenCalledOnce();
	});
});
