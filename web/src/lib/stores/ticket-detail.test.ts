// Detail store with a fake data layer (E2 plan, package 7): saving sends only the changed field,
// a failure keeps the draft and sets the field error, an incoming update keeps the draft.

import { SvelteMap } from 'svelte/reactivity';
import { describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { Ticket, TicketDraft, TicketPatch, TicketSummary } from '$lib/domain/ticket';
import {
	INVALID_DATE_MESSAGE,
	TITLE_REQUIRED_MESSAGE,
	TicketDetailStore,
	type TicketDetailData,
	type TicketListSync
} from './ticket-detail.svelte';

const ID = 'abc123def456ghi';

function ticket(overrides: Partial<Ticket> = {}): Ticket {
	return {
		id: ID,
		key: 'TASK-3',
		title: 'Steuererklärung',
		description: 'Belege sammeln',
		status: 'in_progress',
		priority: 'medium',
		due: '2026-10-01',
		project: null,
		tags: [],
		recurring: false,
		completedAt: null,
		created: '2026-09-01 10:00:00.000Z',
		updated: '2026-09-01 10:00:00.000Z',
		...overrides
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

let clock = 0;

function setup(initial: Ticket = ticket()) {
	let current = initial;
	const data = {
		get: vi.fn<TicketDetailData['get']>(async () => current),
		update: vi.fn(async (_id: string, patch: TicketPatch): Promise<Ticket> => {
			clock += 1;
			current = {
				...current,
				...patch,
				completedAt: patch.status === 'done' ? '2026-09-24 10:00:00.000Z' : current.completedAt,
				updated: `2026-09-24 10:00:${String(clock).padStart(2, '0')}.000Z`
			};
			return current;
		}),
		create: vi.fn(async (draft: TicketDraft): Promise<Ticket> => ({
			...ticket(draft),
			id: 'new000000000000',
			key: 'TASK-9',
			project: null,
			tags: [],
			recurring: false,
			completedAt: null,
			created: '2026-09-24 10:00:00.000Z',
			updated: '2026-09-24 10:00:00.000Z'
		}))
	} satisfies TicketDetailData;
	// Reactive like the real list store, whose newer versions the panel follows.
	const listTickets = new SvelteMap<string, TicketSummary>();
	const list = {
		find: vi.fn((id: string) => listTickets.get(id) ?? null),
		upsert: vi.fn((summary: TicketSummary) => listTickets.set(summary.id, summary)),
		completed: vi.fn((summary: TicketSummary) => listTickets.set(summary.id, summary))
	} satisfies TicketListSync;
	const session = { ensureValid: vi.fn(() => true), logout: vi.fn() };
	const store = new TicketDetailStore(data, session, list);
	return { store, data, list, listTickets, session };
}

async function opened(initial?: Ticket) {
	const context = setup(initial);
	context.store.open(ID);
	await vi.waitFor(() => expect(context.store.state).toBe('ready'));
	return context;
}

describe('loading', () => {
	it('loads the ticket of an ID', async () => {
		const { store, data } = await opened();

		expect(data.get).toHaveBeenCalledWith(
			ID,
			expect.objectContaining({ signal: expect.anything() })
		);
		expect(store.ticket?.key).toBe('TASK-3');
		expect(store.value('title')).toBe('Steuererklärung');
		expect(store.value('due')).toBe('2026-10-01');
	});

	it.each(['not_found', 'forbidden'] as const)(
		'reports an unknown or foreign ID (%s)',
		async (kind) => {
			const { store, data } = setup();
			data.get.mockRejectedValueOnce(new DataError(kind));

			store.open('unknown00000000');

			await vi.waitFor(() => expect(store.state).toBe('not_found'));
			expect(store.ticket).toBeNull();
		}
	);

	it('shows other errors and retries', async () => {
		const { store, data } = setup();
		data.get.mockRejectedValueOnce(new DataError('network'));

		store.open(ID);
		await vi.waitFor(() => expect(store.state).toBe('error'));
		expect(store.error).toMatch(/Server nicht erreichbar/);

		await store.reload();
		expect(store.state).toBe('ready');
	});

	it('aborts the request of the previous ticket', async () => {
		const { store, data } = setup();
		const pending = deferred<Ticket>();
		data.get.mockImplementationOnce(() => pending.promise);

		store.open('first0000000000');
		const firstSignal = data.get.mock.calls[0]?.[1].signal;
		store.open(ID);

		expect(firstSignal?.aborted).toBe(true);
		await vi.waitFor(() => expect(store.state).toBe('ready'));
		pending.resolve(ticket({ id: 'first0000000000', title: 'alt' }));
		await Promise.resolve();
		expect(store.ticket?.id).toBe(ID);
	});

	it('ends the session on a session error', async () => {
		const { store, data, session } = setup();
		data.get.mockRejectedValueOnce(new DataError('session'));

		store.open(ID);

		await vi.waitFor(() => expect(session.logout).toHaveBeenCalledOnce());
	});
});

describe('saving', () => {
	it('sends only the changed field and passes the answer to the list', async () => {
		const { store, data, list } = await opened();

		store.edit('title');
		store.setDraft('title', '  Steuererklärung 2026  ');
		expect(await store.save('title')).toBe(true);

		expect(data.update).toHaveBeenCalledExactlyOnceWith(ID, { title: 'Steuererklärung 2026' });
		expect(store.ticket?.title).toBe('Steuererklärung 2026');
		expect(store.isEditing('title')).toBe(false);
		expect(list.upsert).toHaveBeenCalledWith(
			expect.objectContaining({ title: 'Steuererklärung 2026' })
		);
	});

	it('ends editing without a request when nothing changed', async () => {
		const { store, data } = await opened();

		store.edit('description');
		expect(await store.save('description')).toBe(true);

		expect(data.update).not.toHaveBeenCalled();
		expect(store.isEditing('description')).toBe(false);
	});

	it('rejects an empty title without a request and keeps the draft', async () => {
		const { store, data } = await opened();

		store.edit('title');
		store.setDraft('title', '   ');
		expect(await store.save('title')).toBe(false);

		expect(data.update).not.toHaveBeenCalled();
		expect(store.fieldError('title')).toBe(TITLE_REQUIRED_MESSAGE);
		expect(store.value('title')).toBe('   ');
	});

	it('keeps the draft and shows the field error of the server', async () => {
		const { store, data } = await opened();
		data.update.mockRejectedValueOnce(
			new DataError('validation', {
				status: 400,
				fields: { title: { code: 'validation_max_text_constraint', message: 'Zu lang.' } }
			})
		);

		store.edit('title');
		store.setDraft('title', 'x'.repeat(10));
		expect(await store.save('title')).toBe(false);

		expect(store.fieldError('title')).toBe('Zu lang.');
		expect(store.value('title')).toBe('x'.repeat(10));
		expect(store.ticket?.title).toBe('Steuererklärung');

		store.cancel('title');
		expect(store.fieldError('title')).toBeNull();
		expect(store.value('title')).toBe('Steuererklärung');
	});

	it('shows other failures at the field as well', async () => {
		const { store, data } = await opened();
		data.update.mockRejectedValueOnce(new DataError('network'));

		store.edit('description');
		store.setDraft('description', 'neu');
		await store.save('description');

		expect(store.fieldError('description')).toMatch(/Server nicht erreichbar/);
		expect(store.value('description')).toBe('neu');
	});

	it('saves the due date and removes it', async () => {
		const { store, data } = await opened();

		store.edit('due');
		store.setDraft('due', '2026-12-24');
		await store.save('due');
		store.edit('due');
		store.setDraft('due', '');
		await store.save('due');

		expect(data.update.mock.calls.map((call) => call[1])).toEqual([
			{ due: '2026-12-24' },
			{ due: null }
		]);
		expect(store.ticket?.due).toBeNull();
	});

	it('rejects an invalid date', async () => {
		const { store, data } = await opened();

		store.edit('due');
		store.setDraft('due', '2026-02-30');

		expect(await store.save('due')).toBe(false);
		expect(store.fieldError('due')).toBe(INVALID_DATE_MESSAGE);
		expect(data.update).not.toHaveBeenCalled();
	});

	it('saves status and priority at once and restores them on failure', async () => {
		const { store, data } = await opened();

		await store.choose('priority', 'urgent');
		expect(data.update).toHaveBeenLastCalledWith(ID, { priority: 'urgent' });
		expect(store.value('priority')).toBe('urgent');

		data.update.mockRejectedValueOnce(new DataError('server', { status: 500 }));
		await store.choose('status', 'waiting');
		expect(store.value('status')).toBe('in_progress');
		expect(store.fieldError('status')).toMatch(/Server/);
	});

	it('saves a choice made during a running save right after it', async () => {
		const { store, data } = await opened();
		const first = deferred<Ticket>();
		data.update.mockImplementationOnce(() => first.promise);

		const running = store.choose('priority', 'high');
		void store.choose('priority', 'low');
		first.resolve(ticket({ priority: 'high', updated: '2026-09-24 09:00:00.000Z' }));
		await running;

		expect(data.update.mock.calls.map((call) => call[1])).toEqual([
			{ priority: 'high' },
			{ priority: 'low' }
		]);
		expect(store.value('priority')).toBe('low');
		expect(store.isEditing('priority')).toBe(false);
	});

	it('treats "Erledigt" in the panel like the check mark', async () => {
		const { store, list } = await opened();

		await store.choose('status', 'done');

		expect(list.completed).toHaveBeenCalledWith(
			expect.objectContaining({ status: 'done' }),
			'in_progress'
		);
		expect(list.upsert).not.toHaveBeenCalled();
	});
});

describe('drafts and updates', () => {
	it('keeps a running draft when an update for the ticket arrives', async () => {
		const { store } = await opened();

		store.edit('title');
		store.setDraft('title', 'Mein Entwurf');
		store.upsert(
			ticket({ title: 'Von woanders', priority: 'high', updated: '2026-09-24 12:00:00.000Z' })
		);

		expect(store.value('title')).toBe('Mein Entwurf');
		expect(store.value('priority')).toBe('high');
		expect(store.ticket?.title).toBe('Von woanders');
	});

	it('ignores an older update and updates of other tickets', async () => {
		const { store } = await opened(ticket({ updated: '2026-09-24 12:00:00.000Z' }));

		store.upsert(ticket({ title: 'älter', updated: '2026-09-24 11:00:00.000Z' }));
		store.upsert(ticket({ id: 'other0000000000', title: 'anderes' }));

		expect(store.ticket?.title).toBe('Steuererklärung');
	});

	it('follows a newer version of the ticket in the list (check mark)', async () => {
		const { store, listTickets } = await opened();

		listTickets.set(ID, {
			...ticket({ status: 'done', updated: '2026-09-24 12:00:00.000Z' }),
			description: undefined
		} as unknown as TicketSummary);

		expect(store.ticket?.status).toBe('done');
		expect(store.ticket?.description).toBe('Belege sammeln');
	});

	it('drops drafts and errors when another ticket opens or the store resets', async () => {
		const { store } = await opened();
		store.edit('title');
		store.setDraft('title', '');
		await store.save('title');

		store.reset();

		expect(store.state).toBe('idle');
		expect(store.ticket).toBeNull();
		expect(store.isEditing('title')).toBe(false);
		expect(store.fieldError('title')).toBeNull();
		expect(store.dirty).toBe(false);
	});
});

describe('creating', () => {
	const DRAFT: TicketDraft = {
		title: '  Neues Ticket  ',
		description: '',
		status: 'open',
		priority: 'medium',
		due: null
	};

	it('creates with a trimmed title, adds the ticket to the list and shows it', async () => {
		const { store, data, list } = setup();

		const result = await store.create(DRAFT);

		expect(data.create).toHaveBeenCalledExactlyOnceWith({ ...DRAFT, title: 'Neues Ticket' });
		expect(result).toMatchObject({ ok: true, ticket: { id: 'new000000000000', key: 'TASK-9' } });
		expect(list.upsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'new000000000000' }));
		expect(store.state).toBe('ready');
		expect(store.ticket?.key).toBe('TASK-9');

		store.open('new000000000000');
		expect(data.get).not.toHaveBeenCalled();
	});

	it('refuses an empty title without a request', async () => {
		const { store, data } = setup();

		const result = await store.create({ ...DRAFT, title: ' ' });

		expect(result).toEqual({ ok: false, message: null, fields: { title: TITLE_REQUIRED_MESSAGE } });
		expect(data.create).not.toHaveBeenCalled();
	});

	it('returns field errors of the server and other failures as a message', async () => {
		const { store, data } = setup();
		data.create.mockRejectedValueOnce(
			new DataError('validation', {
				status: 400,
				fields: { due: { code: 'validation_calendar_date', message: 'Ungültiges Datum.' } }
			})
		);
		data.create.mockRejectedValueOnce(new DataError('server', { status: 400 }));

		expect(await store.create(DRAFT)).toEqual({
			ok: false,
			message: null,
			fields: { due: 'Ungültiges Datum.' }
		});
		expect(await store.create(DRAFT)).toEqual({
			ok: false,
			message: expect.stringMatching(/Der Server hat mit einem Fehler geantwortet/),
			fields: {}
		});
		expect(store.state).toBe('idle');
	});

	it('ends the session on a session error', async () => {
		const { store, data, session } = setup();
		data.create.mockRejectedValueOnce(new DataError('session'));

		expect(await store.create(DRAFT)).toEqual({ ok: false, message: null, fields: {} });
		expect(session.logout).toHaveBeenCalledOnce();
	});
});
