// Detail store with a fake data layer (E2 plan, package 7; E3 plan, T-13): saving sends only the
// changed field, a failure keeps the draft and sets the field error, an incoming update keeps the
// draft, a new project gives a new key. The description is guarded against overwriting and its
// tasks can be ticked (ADR-0032 section 6).

import { SvelteMap } from 'svelte/reactivity';
import { describe, expect, it, vi } from 'vitest';
import { DATA_ERROR_MESSAGES, DataError } from '$lib/data/errors';
import type { Ticket, TicketDraft, TicketPatch, TicketSummary } from '$lib/domain/ticket';
import {
	INVALID_DATE_MESSAGE,
	TASK_STALE_MESSAGE,
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
		sourceItem: null,
		status: 'in_progress',
		priority: 'medium',
		due: '2026-10-01',
		projectId: null,
		tagIds: [],
		project: null,
		tags: [],
		recurring: false,
		source: null,
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

/** Projects the fake server knows; a project change gives the key of the new number range. */
const HOUSE = { id: 'proj00000000001', name: 'Haushalt', code: 'HAUS', archived: false };

/** Applies a patch like the server: `project` is an ID and changes the key (E3 plan, T-13). */
function applyPatch(current: Ticket, { project, tags, ...fields }: TicketPatch): Ticket {
	const next: Ticket = { ...current, ...fields };
	if (tags !== undefined) {
		next.tagIds = [...tags];
		next.tags = tags.map((id) => ({ id, name: id }));
	}
	if (project === undefined) return next;
	return {
		...next,
		projectId: project,
		project: project === HOUSE.id ? HOUSE : null,
		key: project === null ? 'TASK-10' : 'HAUS-1'
	};
}

function setup(initial: Ticket = ticket()) {
	let current = initial;
	const data = {
		get: vi.fn<TicketDetailData['get']>(async () => current),
		update: vi.fn(async (_id: string, patch: TicketPatch): Promise<Ticket> => {
			clock += 1;
			current = {
				...applyPatch(current, patch),
				completedAt: patch.status === 'done' ? '2026-09-24 10:00:00.000Z' : current.completedAt,
				updated: `2026-09-24 10:00:${String(clock).padStart(2, '0')}.000Z`
			};
			return current;
		}),
		create: vi.fn(async ({ project, tags, ...draft }: TicketDraft): Promise<Ticket> => ({
			...ticket(draft),
			id: 'new000000000000',
			key: project === null ? 'TASK-9' : 'HAUS-1',
			projectId: project,
			tagIds: tags,
			project: project === HOUSE.id ? HOUSE : null,
			tags: [],
			recurring: false,
			source: null,
			completedAt: null,
			created: '2026-09-24 10:00:00.000Z',
			updated: '2026-09-24 10:00:00.000Z'
		})),
		delete: vi.fn<TicketDetailData['delete']>(async () => null)
	} satisfies TicketDetailData;
	// Reactive like the real list store, whose newer versions the panel follows.
	const listTickets = new SvelteMap<string, TicketSummary>();
	const list = {
		find: vi.fn((id: string) => listTickets.get(id) ?? null),
		upsert: vi.fn((summary: TicketSummary) => listTickets.set(summary.id, summary)),
		completed: vi.fn((summary: TicketSummary) => listTickets.set(summary.id, summary)),
		remove: vi.fn((id: string) => listTickets.delete(id)),
		announce: vi.fn()
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
		due: null,
		project: null,
		tags: []
	};

	it('creates with a trimmed title, adds the ticket to the list and shows it', async () => {
		const { store, data, list } = setup();

		const result = await store.create(DRAFT);

		expect(data.create).toHaveBeenCalledExactlyOnceWith(
			{ ...DRAFT, title: 'Neues Ticket' },
			undefined
		);
		expect(result).toMatchObject({ ok: true, ticket: { id: 'new000000000000', key: 'TASK-9' } });
		expect(list.upsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'new000000000000' }));
		expect(store.state).toBe('ready');
		expect(store.ticket?.key).toBe('TASK-9');

		store.open('new000000000000');
		expect(data.get).not.toHaveBeenCalled();
	});

	it('passes the origin and reports a refused inbox entry as message (E4 plan, package 2)', async () => {
		const { store, data } = setup();
		const origin = { sourceItem: 'item00000000001' };
		await store.create(DRAFT, origin);
		expect(data.create).toHaveBeenLastCalledWith({ ...DRAFT, title: 'Neues Ticket' }, origin);

		data.create.mockRejectedValueOnce(
			new DataError('validation', {
				status: 400,
				fields: {
					source_item: {
						code: 'validation_inbox_item_handled',
						message: 'Dieser Eintrag wurde schon bearbeitet.'
					}
				}
			})
		);
		expect(await store.create(DRAFT, origin)).toEqual({
			ok: false,
			message: 'Dieser Eintrag wurde schon bearbeitet.',
			fields: {}
		});
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

describe('project (E3 plan, T-13)', () => {
	const ARCHIVED = new DataError('validation', {
		status: 400,
		fields: {
			project: { code: 'validation_project_archived', message: 'Das Projekt ist archiviert.' }
		}
	});

	it('creates with a project and reports an archived project at the field', async () => {
		const { store, data } = setup();
		const draft: TicketDraft = {
			title: 'Neu',
			description: '',
			status: 'open',
			priority: 'medium',
			due: null,
			project: HOUSE.id,
			tags: []
		};

		const result = await store.create(draft);
		expect(data.create).toHaveBeenLastCalledWith(draft, undefined);
		expect(result).toMatchObject({ ok: true, ticket: { key: 'HAUS-1', projectId: HOUSE.id } });

		data.create.mockRejectedValueOnce(ARCHIVED);
		expect(await store.create(draft)).toEqual({
			ok: false,
			message: null,
			fields: { project: 'Das Projekt ist archiviert.' }
		});
	});

	it('saves a chosen project at once, sends only the project and announces the new key', async () => {
		const { store, data, list } = await opened();
		expect(store.value('project')).toBe('');

		await store.choose('project', HOUSE.id);

		expect(data.update).toHaveBeenCalledExactlyOnceWith(ID, { project: HOUSE.id });
		expect(store.ticket).toMatchObject({ key: 'HAUS-1', projectId: HOUSE.id });
		expect(store.value('project')).toBe(HOUSE.id);
		expect(store.isEditing('project')).toBe(false);
		expect(list.upsert).toHaveBeenLastCalledWith(expect.objectContaining({ key: 'HAUS-1' }));
		expect(list.announce).toHaveBeenCalledExactlyOnceWith('Neuer Key: HAUS-1');
		expect(store.id).toBe(ID);
	});

	it('removes the project with null', async () => {
		const { store, data, list } = await opened(
			ticket({ key: 'HAUS-1', projectId: HOUSE.id, project: HOUSE })
		);
		expect(store.value('project')).toBe(HOUSE.id);

		await store.choose('project', '');

		expect(data.update).toHaveBeenCalledExactlyOnceWith(ID, { project: null });
		expect(store.ticket?.key).toBe('TASK-10');
		expect(list.announce).toHaveBeenCalledWith('Neuer Key: TASK-10');
	});

	it('restores the old project and shows the error at the field when saving fails', async () => {
		const { store, data, list } = await opened();
		data.update.mockRejectedValueOnce(ARCHIVED);

		await store.choose('project', HOUSE.id);

		expect(store.value('project')).toBe('');
		expect(store.fieldError('project')).toBe('Das Projekt ist archiviert.');
		expect(store.ticket?.key).toBe('TASK-3');
		expect(list.announce).not.toHaveBeenCalled();
	});

	it('refuses a value that is no record ID without a request', async () => {
		const { store, data } = await opened();

		await store.choose('project', 'kein-projekt');

		expect(data.update).not.toHaveBeenCalled();
		expect(store.fieldError('project')).toBe('Ungültiger Wert.');
		expect(store.value('project')).toBe('');
	});

	it('announces nothing when a save keeps the key', async () => {
		const { store, list } = await opened();

		await store.choose('priority', 'high');

		expect(list.announce).not.toHaveBeenCalled();
	});
});

describe('tags (E3 plan, T-14)', () => {
	const GARDEN = 'tag000000000001';
	const CALL = 'tag000000000002';

	it('adds and removes a tag by saving the whole list at once', async () => {
		const { store, data, list } = await opened(ticket({ tagIds: [GARDEN] }));

		expect(await store.addTag(CALL)).toBe(true);
		expect(data.update).toHaveBeenLastCalledWith(ID, { tags: [GARDEN, CALL] });
		expect(store.ticket?.tagIds).toEqual([GARDEN, CALL]);
		expect(list.upsert).toHaveBeenLastCalledWith(
			expect.objectContaining({ tagIds: [GARDEN, CALL] })
		);

		expect(await store.removeTag(GARDEN)).toBe(true);
		expect(data.update).toHaveBeenLastCalledWith(ID, { tags: [CALL] });
		expect(store.ticket?.tagIds).toEqual([CALL]);
	});

	it('sends nothing for a tag the ticket has or lacks already', async () => {
		const { store, data } = await opened(ticket({ tagIds: [GARDEN] }));

		expect(await store.addTag(GARDEN)).toBe(true);
		expect(await store.removeTag(CALL)).toBe(true);
		expect(data.update).not.toHaveBeenCalled();
	});

	it('refuses a second change while one is saved', async () => {
		const { store, data } = await opened();
		const answer = deferred<Ticket>();
		data.update.mockImplementationOnce(() => answer.promise);

		const first = store.addTag(GARDEN);
		expect(store.isSaving('tags')).toBe(true);
		expect(await store.addTag(CALL)).toBe(false);
		answer.resolve(ticket({ tagIds: [GARDEN], updated: '2026-09-24 11:00:00.000Z' }));

		expect(await first).toBe(true);
		expect(data.update).toHaveBeenCalledOnce();
		expect(store.isSaving('tags')).toBe(false);
	});

	it('keeps the tags and shows the error at the field when saving fails', async () => {
		const { store, data } = await opened(ticket({ tagIds: [GARDEN] }));
		data.update.mockRejectedValueOnce(new DataError('network'));

		expect(await store.addTag(CALL)).toBe(false);

		expect(store.ticket?.tagIds).toEqual([GARDEN]);
		expect(store.fieldError('tags')).toMatch(/Server nicht erreichbar/);
	});

	it('counts a name in the tag picker as unsaved input until the panel is reset', async () => {
		const { store } = await opened();
		expect(store.hasUnsavedInput).toBe(false);

		store.setTagInput('   ');
		expect(store.hasUnsavedInput).toBe(false);
		store.setTagInput(' Steuer');
		expect(store.hasUnsavedInput).toBe(true);
		expect(store.tagInput).toBe(' Steuer');

		store.reset();
		expect(store.tagInput).toBe('');
		expect(store.hasUnsavedInput).toBe(false);
	});

	it('counts a changed description as unsaved input as before', async () => {
		const { store } = await opened();

		store.edit('description');
		store.setDraft('description', 'neu');

		expect(store.hasUnsavedInput).toBe(true);
	});
});

describe('TicketDetailStore: deleting', () => {
	it('deletes the ticket, removes it from the list and announces it (before the trash)', async () => {
		const { store, data, list } = await opened();

		expect(await store.deleteTicket()).toEqual({ ok: true, key: 'TASK-3' });

		expect(data.delete).toHaveBeenCalledExactlyOnceWith(ID, 'inbox');
		expect(list.remove).toHaveBeenCalledWith(ID);
		expect(list.announce).toHaveBeenCalledWith('TASK-3 wurde gelöscht.');
	});

	it('offers "Rückgängig" through the trash when the server moved the ticket (ADR-0037)', async () => {
		const { data, list } = await opened();
		const move = { id: ID, updated: '2026-09-28 10:00:00.000Z', tickets: [] };
		data.delete.mockResolvedValueOnce(move);
		const trash = { offerUndo: vi.fn() };
		const withTrash = new TicketDetailStore(
			data,
			{ ensureValid: () => true, logout: vi.fn() },
			list,
			trash
		);
		withTrash.open(ID);
		await vi.waitFor(() => expect(withTrash.state).toBe('ready'));

		expect(await withTrash.deleteTicket({ count: 2, handling: 'discard' })).toEqual({
			ok: true,
			key: 'TASK-3'
		});
		expect(data.delete).toHaveBeenLastCalledWith(ID, 'discard');
		expect(trash.offerUndo).toHaveBeenCalledExactlyOnceWith(
			move,
			'TASK-3 in den Papierkorb verschoben. 2 Quellen bleiben beim Ticket.'
		);
		expect(list.announce).not.toHaveBeenCalled();
	});

	it('treats a ticket that is already gone as deleted', async () => {
		const { store, data, list } = await opened();
		data.delete.mockRejectedValueOnce(new DataError('not_found', { status: 404 }));

		expect(await store.deleteTicket()).toEqual({ ok: true, key: 'TASK-3' });
		expect(list.remove).toHaveBeenCalledWith(ID);
	});

	it('keeps the ticket and returns the message on failure', async () => {
		const { store, data, list } = await opened();
		data.delete.mockRejectedValueOnce(new DataError('network'));

		const result = await store.deleteTicket();

		expect(result).toEqual({
			ok: false,
			message: expect.stringMatching(/Server nicht erreichbar/)
		});
		expect(list.remove).not.toHaveBeenCalled();
		expect(store.ticket?.id).toBe(ID);
	});

	it('ends the session on 401 without a message', async () => {
		const { store, data, session } = await opened();
		data.delete.mockRejectedValueOnce(new DataError('session', { status: 401 }));

		expect(await store.deleteTicket()).toEqual({ ok: false, message: null });
		expect(session.logout).toHaveBeenCalled();
	});

	it('sends no request without a valid session or ticket', async () => {
		const { store, data, session } = setup();
		expect(await store.deleteTicket()).toEqual({ ok: false, message: null });

		store.open(ID);
		await vi.waitFor(() => expect(store.state).toBe('ready'));
		session.ensureValid.mockReturnValue(false);
		expect(await store.deleteTicket()).toEqual({ ok: false, message: null });
		expect(data.delete).not.toHaveBeenCalled();
	});
});

/** The hook refuses a description based on an older `updated` (ADR-0032 section 6). */
function staleError(): DataError {
	return new DataError('validation', {
		status: 400,
		fields: {
			description: {
				code: 'validation_description_stale',
				message: 'Die Beschreibung wurde inzwischen geändert.'
			}
		}
	});
}

const TASKS = '- [ ] Milch\n- [ ] Brot';
const FIRST = '2026-09-01 10:00:00.000Z';
const LATER = '2026-09-05 08:00:00.000Z';

describe('ticking tasks of the description (ADR-0032 section 6)', () => {
	it('ticks a task and sends the description with expected_updated', async () => {
		const { store, data, list } = await opened(ticket({ description: TASKS }));

		expect(await store.toggleTask(1, true)).toEqual({ ok: true });

		expect(data.update).toHaveBeenCalledExactlyOnceWith(
			ID,
			{ description: '- [ ] Milch\n- [x] Brot' },
			{ expectedUpdated: FIRST }
		);
		expect(store.ticket?.description).toBe('- [ ] Milch\n- [x] Brot');
		expect(list.upsert).toHaveBeenCalled();
		expect(store.isSaving('description')).toBe(false);
	});

	it('sends once more on the new version when only other fields changed', async () => {
		const { store, data } = await opened(ticket({ description: TASKS }));
		data.update.mockRejectedValueOnce(staleError());
		data.get.mockResolvedValueOnce(
			ticket({ description: TASKS, status: 'waiting', updated: LATER })
		);

		expect(await store.toggleTask(0, true)).toEqual({ ok: true });

		expect(data.update).toHaveBeenCalledTimes(2);
		expect(data.update).toHaveBeenLastCalledWith(
			ID,
			{ description: '- [x] Milch\n- [ ] Brot' },
			{ expectedUpdated: LATER }
		);
	});

	it('says so when the description changed meanwhile and shows the new one', async () => {
		const { store, data } = await opened(ticket({ description: TASKS }));
		data.update.mockRejectedValueOnce(staleError());
		data.get.mockResolvedValueOnce(ticket({ description: '- [ ] Käse', updated: LATER }));

		expect(await store.toggleTask(1, true)).toEqual({ ok: false, message: TASK_STALE_MESSAGE });

		expect(data.update).toHaveBeenCalledOnce();
		expect(store.ticket?.description).toBe('- [ ] Käse');
	});

	it('gives up after a second refusal', async () => {
		const { store, data } = await opened(ticket({ description: TASKS }));
		data.update.mockRejectedValue(staleError());
		data.get.mockResolvedValue(ticket({ description: TASKS, updated: LATER }));

		expect(await store.toggleTask(0, true)).toEqual({ ok: false, message: TASK_STALE_MESSAGE });
		expect(data.update).toHaveBeenCalledTimes(2);
	});

	it('refuses while the description is edited, and a task that does not exist', async () => {
		const { store, data } = await opened(ticket({ description: TASKS }));

		expect(await store.toggleTask(5, true)).toEqual({ ok: false, message: TASK_STALE_MESSAGE });
		store.edit('description');
		expect(await store.toggleTask(0, true)).toEqual({ ok: false, message: null });
		expect(data.update).not.toHaveBeenCalled();
	});

	it('returns other failures as message and ends the session on 401', async () => {
		const { store, data, session } = await opened(ticket({ description: TASKS }));
		data.update.mockRejectedValueOnce(new DataError('server', { status: 500 }));

		expect(await store.toggleTask(0, true)).toEqual({
			ok: false,
			message: DATA_ERROR_MESSAGES.server
		});

		data.update.mockRejectedValueOnce(new DataError('session', { status: 401 }));
		expect(await store.toggleTask(0, true)).toEqual({ ok: false, message: null });
		expect(session.logout).toHaveBeenCalled();
	});
});

describe('saving the description without overwriting a newer one (ADR-0032 section 6)', () => {
	it('sends the description with the updated of the version the draft started from', async () => {
		const { store, data } = await opened();

		store.edit('description');
		store.setDraft('description', 'Neu');
		expect(await store.save('description')).toBe(true);

		expect(data.update).toHaveBeenCalledExactlyOnceWith(
			ID,
			{ description: 'Neu' },
			{ expectedUpdated: FIRST }
		);
		expect(store.isEditing('description')).toBe(false);
	});

	it('asks without a request when a newer description arrived while editing', async () => {
		const { store, data } = await opened();

		store.edit('description');
		store.setDraft('description', 'Mein Text');
		store.upsert(ticket({ description: 'Anderer Text', updated: LATER }));
		expect(await store.save('description')).toBe(false);

		expect(store.descriptionConflict).toBe(true);
		expect(store.value('description')).toBe('Mein Text');
		expect(data.update).not.toHaveBeenCalled();
	});

	it('asks when the server knows a newer description', async () => {
		const { store, data } = await opened();
		data.update.mockRejectedValueOnce(staleError());
		data.get.mockResolvedValueOnce(ticket({ description: 'Anderer Text', updated: LATER }));

		store.edit('description');
		store.setDraft('description', 'Mein Text');
		expect(await store.save('description')).toBe(false);

		expect(store.descriptionConflict).toBe(true);
		expect(store.fieldError('description')).toBeNull();
		expect(store.ticket?.description).toBe('Anderer Text');
		expect(data.update).toHaveBeenCalledOnce();
	});

	it('sends once more when only other fields changed meanwhile', async () => {
		const { store, data } = await opened();
		data.update.mockRejectedValueOnce(staleError());
		data.get.mockResolvedValueOnce(ticket({ status: 'waiting', updated: LATER }));

		store.edit('description');
		store.setDraft('description', 'Mein Text');
		expect(await store.save('description')).toBe(true);

		expect(store.descriptionConflict).toBe(false);
		expect(data.update).toHaveBeenLastCalledWith(
			ID,
			{ description: 'Mein Text' },
			{ expectedUpdated: LATER }
		);
	});

	it('overwrites the newer description when asked to', async () => {
		const { store, data } = await opened();
		store.edit('description');
		store.setDraft('description', 'Mein Text');
		store.upsert(ticket({ description: 'Anderer Text', updated: LATER }));
		await store.save('description');

		expect(await store.overwriteDescription()).toBe(true);

		expect(store.descriptionConflict).toBe(false);
		expect(store.isEditing('description')).toBe(false);
		expect(data.update).toHaveBeenCalledExactlyOnceWith(
			ID,
			{ description: 'Mein Text' },
			{ expectedUpdated: LATER }
		);
		expect(store.ticket?.description).toBe('Mein Text');
	});

	it('discards the draft and loads the ticket again when asked to', async () => {
		const { store, data } = await opened();
		store.edit('description');
		store.setDraft('description', 'Mein Text');
		store.upsert(ticket({ description: 'Anderer Text', updated: LATER }));
		await store.save('description');
		data.get.mockResolvedValueOnce(ticket({ description: 'Anderer Text', updated: LATER }));

		await store.discardDescription();

		expect(store.descriptionConflict).toBe(false);
		expect(store.isEditing('description')).toBe(false);
		expect(store.ticket?.description).toBe('Anderer Text');
		expect(data.get).toHaveBeenCalledTimes(2);
		expect(data.update).not.toHaveBeenCalled();
	});

	it('forgets the question when editing ends or the store resets', async () => {
		const { store } = await opened();
		store.edit('description');
		store.setDraft('description', 'Mein Text');
		store.upsert(ticket({ description: 'Anderer Text', updated: LATER }));
		await store.save('description');

		store.cancel('description');
		expect(store.descriptionConflict).toBe(false);

		store.edit('description');
		expect(store.value('description')).toBe('Anderer Text');
		expect(await store.save('description')).toBe(true);
		store.reset();
		expect(store.descriptionConflict).toBe(false);
	});
});

describe('completing with open blocking sub-tasks (ADR-0033 section 2)', () => {
	const child = (key: string, overrides: Partial<TicketSummary> = {}): TicketSummary => ({
		...ticket({ id: `sub-${key}`, key, parentId: ID }),
		status: 'open',
		...overrides
	});

	async function withSubtasks(subtasks: TicketSummary[]) {
		const context = await opened();
		Object.assign(context.list, { subtasksOf: () => subtasks });
		return context;
	}

	it('asks instead of saving the status "Erledigt" and keeps the status', async () => {
		const { store, data } = await withSubtasks([
			child('HAUS-13'),
			child('HAUS-14', { blocksParent: false }),
			child('HAUS-15', { status: 'done' })
		]);

		await store.choose('status', 'done');

		expect(data.update).not.toHaveBeenCalled();
		expect(store.completionQuestion).toEqual({ count: 1, keys: ['HAUS-13'] });
		expect(store.value('status')).toBe('in_progress');
		expect(store.fieldError('status')).toBeNull();

		store.cancelCompletion();
		expect(store.completionQuestion).toBeNull();
	});

	it('saves the answer with the choice and hands the sub-tasks to the list for "Rückgängig"', async () => {
		const { store, data, list } = await withSubtasks([child('HAUS-13', { status: 'waiting' })]);
		await store.choose('status', 'done');

		expect(await store.confirmCompletion('complete_children')).toBe(true);

		expect(data.update).toHaveBeenCalledWith(
			ID,
			{ status: 'done' },
			{ completion: 'complete_children' }
		);
		expect(list.completed).toHaveBeenCalledWith(
			expect.objectContaining({ status: 'done' }),
			'in_progress',
			[{ id: 'sub-HAUS-13', key: 'HAUS-13', previousStatus: 'waiting' }]
		);
		expect(store.completionQuestion).toBeNull();
		expect(store.ticket?.status).toBe('done');
	});

	it('completes anyway without handing sub-tasks to the list', async () => {
		const { store, data, list } = await withSubtasks([child('HAUS-13')]);
		await store.choose('status', 'done');

		await store.confirmCompletion('force');

		expect(data.update).toHaveBeenCalledWith(ID, { status: 'done' }, { completion: 'force' });
		expect(list.completed).toHaveBeenCalledWith(expect.anything(), 'in_progress', []);
	});

	it('asks when the hook refuses, and shows another failure at the field', async () => {
		const { store, data } = await opened();
		data.update.mockRejectedValueOnce(
			new DataError('validation', {
				status: 400,
				fields: {
					status: {
						code: 'validation_parent_open_children',
						message: '2 Unteraufgaben sind noch offen.',
						params: { count: 2, keys: ['HAUS-20', 'HAUS-21'] }
					}
				}
			})
		);

		await store.choose('status', 'done');
		expect(store.completionQuestion).toEqual({ count: 2, keys: ['HAUS-20', 'HAUS-21'] });
		expect(store.fieldError('status')).toBeNull();

		data.update.mockRejectedValueOnce(new DataError('network'));
		expect(await store.confirmCompletion('force')).toBe(false);
		expect(store.completionQuestion).toBeNull();
		expect(store.fieldError('status')).toMatch(/Server nicht erreichbar/);
	});

	it('forgets the question with another ticket', async () => {
		const { store } = await withSubtasks([child('HAUS-13')]);
		await store.choose('status', 'done');

		store.reset();

		expect(store.completionQuestion).toBeNull();
	});
});

describe('TicketDetailStore: refused reopening of a series (ADR-0023 addendum 4)', () => {
	const MESSAGE =
		'Von dieser Serie ist schon HAUS-14 offen, und dieses Ticket ist nicht das zuletzt erledigte. Du kannst es als normales Ticket wieder öffnen (aus der Serie lösen).';
	const refusal = (code: string) =>
		new DataError('validation', {
			status: 400,
			fields: { status: { code, message: MESSAGE, params: { key: 'HAUS-14' } } }
		});

	it('explains the refusal inline and reopens as a normal ticket on request', async () => {
		const { store, data, list } = await opened(ticket({ status: 'done' }));
		data.update.mockRejectedValueOnce(refusal('validation_recurrence_reopen_older'));

		await store.choose('status', 'in_progress');
		expect(store.reopenQuestion).toEqual({ status: 'in_progress', message: MESSAGE });
		expect(store.fieldError('status')).toBeNull();
		expect(store.value('status')).toBe('done');

		expect(await store.reopenDetached()).toBe(true);
		expect(data.update).toHaveBeenLastCalledWith(ID, {
			status: 'in_progress',
			detachSeries: true
		});
		expect(store.reopenQuestion).toBeNull();
		expect(list.announce).toHaveBeenCalledWith(expect.stringMatching(/als normales Ticket/));
	});

	it('also for an edited follow-up; "Abbrechen", another status or ticket end the question', async () => {
		const { store, data } = await opened(ticket({ status: 'done' }));
		data.update.mockRejectedValueOnce(refusal('validation_recurrence_open_instance'));
		await store.choose('status', 'open');
		expect(store.reopenQuestion?.status).toBe('open');

		store.cancelReopen();
		expect(store.reopenQuestion).toBeNull();

		data.update.mockRejectedValueOnce(refusal('validation_recurrence_open_instance'));
		await store.choose('status', 'open');
		store.reset();
		expect(store.reopenQuestion).toBeNull();
	});

	it('shows a failure of the way out at the field', async () => {
		const { store, data } = await opened(ticket({ status: 'done' }));
		data.update.mockRejectedValueOnce(refusal('validation_recurrence_reopen_older'));
		await store.choose('status', 'open');
		data.update.mockRejectedValueOnce(new DataError('network'));

		expect(await store.reopenDetached()).toBe(false);
		expect(store.reopenQuestion).toBeNull();
		expect(store.fieldError('status')).toMatch(/Server nicht erreichbar/);
	});
});
