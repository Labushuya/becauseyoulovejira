// "Duplizieren …" and "In den Papierkorb …" from the menu of a row (plan aktionsmenues, AM-2):
// a choice loads what its question needs, one row at a time, failures as error flags, and moving
// to the trash runs like in the panel (the row leaves the list, "Rückgängig" in the flag).

import { describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { TrashMove } from '$lib/data/tickets';
import type { InboxItemSummary } from '$lib/domain/inbox';
import type { Ticket, TicketSummary } from '$lib/domain/ticket';
import type { FlagInput } from './flags.svelte';
import { DUPLICATE_GONE } from './ticket-duplicate.svelte';
import { TicketRowActionsStore, type TicketRowActionsData } from './ticket-row-actions.svelte';

const ID = 'ticket000000001';

function summary(): TicketSummary {
	return {
		id: ID,
		key: 'TASK-1',
		title: 'Fenster putzen',
		status: 'open',
		priority: 'medium',
		due: null,
		projectId: null,
		tagIds: [],
		project: null,
		tags: [],
		recurring: false,
		source: null,
		completedAt: null,
		created: '2026-09-01 10:00:00.000Z',
		updated: '2026-09-01 10:00:00.000Z'
	};
}

const FULL: Ticket = { ...summary(), description: 'Innen und außen', sourceItem: null };

const SOURCE: InboxItemSummary = {
	id: 'item00000000001',
	channel: 'mail',
	kind: 'mail',
	title: 'Fenster',
	sourceUrl: '',
	sourceRef: '',
	sourceDate: null,
	sourceMeta: {},
	original: '',
	state: 'converted',
	ticketId: ID,
	handledAt: '2026-09-01 10:00:00.000Z',
	created: '2026-09-01 10:00:00.000Z',
	updated: '2026-09-01 10:00:00.000Z'
};

const MOVE: TrashMove = {
	id: ID,
	updated: '2026-09-28 10:00:00.000Z',
	tickets: [{ id: ID, key: 'TASK-1', updated: '2026-09-28 10:00:00.000Z' }]
};

function setup(data: Partial<TicketRowActionsData> = {}) {
	const shown: FlagInput[] = [];
	const flags = {
		show: vi.fn((input: FlagInput) => {
			shown.push(input);
			return 'flag';
		}),
		dismiss: vi.fn()
	};
	const fake = {
		get: vi.fn(async () => FULL),
		sources: vi.fn(async () => [SOURCE]),
		commentCount: vi.fn(async () => 3),
		delete: vi.fn<TicketRowActionsData['delete']>(async () => MOVE),
		...data
	};
	const session = { ensureValid: vi.fn(() => true), logout: vi.fn() };
	const list = { remove: vi.fn(), announce: vi.fn() };
	const trash = { offerUndo: vi.fn() };
	const store = new TicketRowActionsStore(fake, session, list, trash, flags);
	return { store, data: fake, session, list, trash, shown };
}

describe('menu of a row: preparing a question (AM-2)', () => {
	it('loads the ticket, its sources and its comments for "Duplizieren …"', async () => {
		const { store, data } = setup();
		const choosing = store.choose('duplicate', summary());
		expect(store.isPreparing(ID)).toBe(true);
		expect(store.dialog).toBeNull();

		expect(await choosing).toBe(true);
		expect(store.isPreparing(ID)).toBe(false);
		expect(data.get).toHaveBeenCalledWith(ID);
		expect(store.dialog).toEqual({
			kind: 'duplicate',
			ticket: FULL,
			sources: [SOURCE],
			commentCount: 3
		});

		store.close();
		expect(store.dialog).toBeNull();
	});

	it('counts the sources for "In den Papierkorb …" and loads nothing else', async () => {
		const { store, data } = setup();
		expect(await store.choose('delete', summary())).toBe(true);
		expect(store.dialog).toEqual({ kind: 'delete', ticket: summary(), sourceCount: 1 });
		expect(data.get).not.toHaveBeenCalled();
		expect(data.commentCount).not.toHaveBeenCalled();
	});

	it('prepares one row at a time and none while a question is open', async () => {
		const { store } = setup();
		const first = store.choose('delete', summary());
		expect(await store.choose('duplicate', summary())).toBe(false);
		await first;
		expect(await store.choose('duplicate', summary())).toBe(false);
		expect(store.dialog?.kind).toBe('delete');
	});

	it('says in an error flag when loading fails, a ticket that is gone as such', async () => {
		const gone = setup({
			sources: vi.fn(async (): Promise<InboxItemSummary[]> => {
				throw new DataError('not_found', { status: 404 });
			})
		});
		expect(await gone.store.choose('delete', summary())).toBe(false);
		expect(gone.store.dialog).toBeNull();
		expect(gone.store.isPreparing(ID)).toBe(false);
		expect(gone.shown).toEqual([
			{ tone: 'error', title: 'TASK-1 konnte nicht geladen werden.', description: DUPLICATE_GONE }
		]);

		const broken = setup({
			commentCount: vi.fn(async (): Promise<number> => {
				throw new DataError('server', { status: 500 });
			})
		});
		expect(await broken.store.choose('duplicate', summary())).toBe(false);
		expect(broken.shown[0]?.tone).toBe('error');
		expect(broken.shown[0]?.description).toMatch(/Der Server hat mit einem Fehler geantwortet/);
	});

	it('ends an expired session without a flag and sends nothing without one', async () => {
		const expired = setup({
			get: vi.fn(async (): Promise<Ticket> => {
				throw new DataError('session', { status: 401 });
			})
		});
		expect(await expired.store.choose('duplicate', summary())).toBe(false);
		expect(expired.session.logout).toHaveBeenCalledOnce();
		expect(expired.shown).toEqual([]);

		const signedOut = setup();
		signedOut.session.ensureValid.mockReturnValue(false);
		expect(await signedOut.store.choose('delete', summary())).toBe(false);
		expect(signedOut.data.sources).not.toHaveBeenCalled();
	});
});

describe('menu of a row: moving to the trash (AM-2)', () => {
	it('moves the ticket of the question with the chosen handling and offers "Rückgängig"', async () => {
		const { store, data, list, trash } = setup();
		await store.choose('delete', summary());

		const result = await store.deleteTicket({ count: 1, handling: 'discard' });

		expect(result).toEqual({ ok: true, key: 'TASK-1' });
		expect(data.delete).toHaveBeenCalledExactlyOnceWith(ID, 'discard');
		expect(list.remove).toHaveBeenCalledWith(ID);
		expect(trash.offerUndo).toHaveBeenCalledExactlyOnceWith(
			MOVE,
			'TASK-1 in den Papierkorb verschoben. 1 Quelle bleibt beim Ticket.'
		);
	});

	it('counts a ticket that is gone meanwhile as moved and keeps it on another failure', async () => {
		const gone = setup({
			delete: vi.fn(async (): Promise<TrashMove | null> => {
				throw new DataError('not_found', { status: 404 });
			})
		});
		await gone.store.choose('delete', summary());
		expect(await gone.store.deleteTicket()).toEqual({ ok: true, key: 'TASK-1' });
		expect(gone.list.remove).toHaveBeenCalledWith(ID);
		expect(gone.list.announce).toHaveBeenCalledWith('TASK-1 wurde gelöscht.');

		const broken = setup({
			delete: vi.fn(async (): Promise<TrashMove | null> => {
				throw new DataError('server', { status: 500 });
			})
		});
		await broken.store.choose('delete', summary());
		const result = await broken.store.deleteTicket();
		expect(result.ok).toBe(false);
		expect(broken.list.remove).not.toHaveBeenCalled();
		expect(broken.trash.offerUndo).not.toHaveBeenCalled();
	});

	it('moves nothing without an open question', async () => {
		const { store, data } = setup();
		expect(await store.deleteTicket()).toEqual({ ok: false, message: null });
		await store.choose('duplicate', summary());
		expect(await store.deleteTicket()).toEqual({ ok: false, message: null });
		expect(data.delete).not.toHaveBeenCalled();
	});
});
