// InboxStore with fake data and a fake realtime source (E4 plan, T-4 and package 2): new entries
// in full, handled entries page by page, targeted updates, reconciliation after a reconnection,
// duplicates as outcome, actions with messages, the missing collection before the migration.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { InboxDraft, InboxItem, InboxItemSummary } from '$lib/domain/inbox';
import type { InboxQuery } from '$lib/domain/inbox-query';
import type { TicketSummary } from '$lib/domain/ticket';
import { INBOX_UNAVAILABLE_MESSAGE, InboxStore, type InboxData } from './inbox.svelte';
import type { LiveSource, RecordChange, Unsubscribe } from './realtime';
import { UNDO_WINDOW_MS } from './ticket-list.svelte';

const T0 = '2026-09-25 08:00:00.000Z';
const T1 = '2026-09-25 09:00:00.000Z';
const T2 = '2026-09-25 10:00:00.000Z';

function item(id: string, overrides: Partial<InboxItemSummary> = {}): InboxItemSummary {
	return {
		id,
		channel: 'manual',
		kind: 'todo',
		title: `Eintrag ${id}`,
		sourceUrl: '',
		sourceRef: '',
		sourceDate: null,
		sourceMeta: {},
		original: '',
		state: 'new',
		ticketId: null,
		handledAt: null,
		created: T0,
		updated: T0,
		...overrides
	};
}

const A = item('item00000000001', { created: T0 });
const B = item('item00000000002', { created: T1 });

function discarded(entry: InboxItemSummary, at = T1): InboxItemSummary {
	return { ...entry, state: 'discarded', handledAt: at, updated: at };
}

function withBody(entry: InboxItemSummary): InboxItem {
	return { ...entry, body: 'Text' };
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function setup(options: { newItems?: InboxItemSummary[]; valid?: boolean } = {}) {
	const data = {
		listNew: vi.fn<InboxData['listNew']>(async () => options.newItems ?? [A, B]),
		listHandled: vi.fn<InboxData['listHandled']>(async (_state, page) => ({
			items: [],
			page,
			hasMore: false
		})),
		get: vi.fn<InboxData['get']>(async (id) => withBody(item(id))),
		create: vi.fn<InboxData['create']>(async (draft) => ({
			kind: 'created',
			item: withBody(item('item00000000009', { title: draft.title, created: T2, updated: T2 }))
		})),
		discard: vi.fn<InboxData['discard']>(async (id) => discarded(item(id), T2)),
		restore: vi.fn<InboxData['restore']>(async (id) => item(id, { updated: T2 })),
		assign: vi.fn<InboxData['assign']>(async (id, ticketId) =>
			item(id, { state: 'converted', ticketId, handledAt: T2, updated: T2 })
		),
		originalUrl: vi.fn<InboxData['originalUrl']>(async (entry) =>
			entry.original === '' ? null : `http://pb.test/${entry.original}?token=t`
		),
		importCalendar: vi.fn<InboxData['importCalendar']>(async () => ({
			created: 0,
			duplicates: 0,
			skipped: 0,
			failed: 0,
			itemId: ''
		}))
	} satisfies InboxData;
	const session = { ensureValid: vi.fn(() => options.valid ?? true), logout: vi.fn() };
	return { store: new InboxStore(data, session), data, session };
}

/** Realtime source with inbox events and reconnections only. */
function fakeLive() {
	const inbox: ((change: RecordChange<InboxItemSummary>) => void)[] = [];
	const reconnected: (() => void)[] = [];
	const add = <T>(list: T[], call: T): Promise<Unsubscribe> => {
		list.push(call);
		return Promise.resolve(async () => {
			list.splice(list.indexOf(call), 1);
		});
	};
	const never = (): Promise<Unsubscribe> => {
		throw new Error('The inbox must not subscribe to anything else.');
	};
	const source: LiveSource = {
		tickets: never,
		ticket: never,
		comments: never,
		history: never,
		projects: never,
		tags: never,
		inbox: (call) => add(inbox, call),
		reads: never,
		reconnected: (call) => add(reconnected, call)
	};
	return {
		source,
		inbox,
		reconnected,
		send: (change: RecordChange<InboxItemSummary>) => {
			for (const call of [...inbox]) call(change);
		},
		reconnect: () => {
			for (const call of [...reconnected]) call();
		}
	};
}

describe('loading', () => {
	it('loads the new entries once, newest first, and counts them', async () => {
		const { store, data } = setup();
		expect(store.newCount).toBeNull();
		await store.load();
		expect(store.state).toBe('ready');
		expect(store.newItems.map((entry) => entry.id)).toEqual([B.id, A.id]);
		expect(store.newCount).toBe(2);
		await store.load();
		expect(data.listNew).toHaveBeenCalledOnce();
	});

	it('explains a missing collection: the migration runs at the next start', async () => {
		const { store, data } = setup();
		data.listNew.mockRejectedValueOnce(new DataError('not_found', { status: 404 }));
		await store.load();
		expect(store.state).toBe('error');
		expect(store.error).toBe(INBOX_UNAVAILABLE_MESSAGE);
		expect(store.newCount).toBeNull();
		// After the restart the next load works.
		await store.load();
		expect(store.state).toBe('ready');
	});

	it('loads nothing without a valid session and logs out on 401', async () => {
		const invalid = setup({ valid: false });
		await invalid.store.load();
		expect(invalid.data.listNew).not.toHaveBeenCalled();

		const { store, data, session } = setup();
		data.listNew.mockRejectedValueOnce(new DataError('session', { status: 401 }));
		await store.load();
		expect(session.logout).toHaveBeenCalledOnce();
		expect(store.error).toBeNull();
	});

	it('empties itself with the cleanup of start()', async () => {
		const { store } = setup();
		const stop = store.start();
		await vi.waitFor(() => expect(store.state).toBe('ready'));
		stop();
		expect(store.newItems).toEqual([]);
		expect(store.state).toBe('idle');
	});
});

describe('view (E4 plan, package 3)', () => {
	const NEW: InboxQuery = { source: null, state: 'new' };
	const DISCARDED: InboxQuery = { source: null, state: 'discarded' };

	it('loads the chosen state page by page and drops it again', async () => {
		const { store, data } = setup();
		await store.load();
		const first = discarded(item('item00000000010'), T2);
		const second = discarded(item('item00000000011'), T1);
		data.listHandled
			.mockResolvedValueOnce({ items: [first], page: 1, hasMore: true })
			.mockResolvedValueOnce({ items: [second], page: 2, hasMore: false });

		store.activate(DISCARDED);
		await vi.waitFor(() => expect(store.handledLoad).toBe('ready'));
		expect(store.visible.map((entry) => entry.id)).toEqual([first.id]);
		expect(store.handledHasMore).toBe(true);
		expect(data.listHandled).toHaveBeenLastCalledWith(
			'discarded',
			1,
			expect.objectContaining({ channels: null })
		);

		await store.loadMoreHandled();
		expect(data.listHandled).toHaveBeenLastCalledWith('discarded', 2, expect.anything());
		expect(store.visible.map((entry) => entry.id)).toEqual([first.id, second.id]);
		expect(store.handledHasMore).toBe(false);

		store.activate({ ...DISCARDED });
		expect(data.listHandled).toHaveBeenCalledTimes(2);
		store.activate(NEW);
		expect(store.handled).toEqual([]);
		expect(store.handledState).toBeNull();
		expect(store.visible.map((entry) => entry.id)).toEqual([B.id, A.id]);
	});

	it('filters new entries by source family and asks the server for the handled ones', async () => {
		const mail = item('item00000000003', { channel: 'eml', kind: 'mail', created: T2 });
		const link = item('item00000000004', { channel: 'link', kind: 'link', created: T2 });
		const { store, data } = setup({ newItems: [A, mail, link] });
		await store.load();
		store.activate({ source: 'mail', state: 'new' });
		expect(store.visible.map((entry) => entry.id)).toEqual([mail.id]);
		store.activate({ source: 'manual', state: 'new' });
		expect(store.visible.map((entry) => entry.id)).toEqual([A.id]);
		expect(store.newCount).toBe(3);

		store.activate({ source: 'mail', state: 'converted' });
		await vi.waitFor(() => expect(store.handledLoad).toBe('ready'));
		expect(data.listHandled).toHaveBeenLastCalledWith(
			'converted',
			1,
			expect.objectContaining({ channels: ['eml', 'mail'] })
		);
		// A converted link does not join the mails shown.
		store.upsert({ ...link, state: 'converted', ticketId: 't', handledAt: T2, updated: T2 });
		expect(store.visible).toEqual([]);
	});

	it('moves entries between new and handled on upsert', async () => {
		const { store } = setup();
		await store.load();
		store.activate(DISCARDED);
		await vi.waitFor(() => expect(store.handledLoad).toBe('ready'));

		store.upsert(discarded(A, T2));
		expect(store.newItems.map((entry) => entry.id)).toEqual([B.id]);
		expect(store.handled.map((entry) => entry.id)).toEqual([A.id]);

		store.upsert({ ...A, updated: '2026-09-25 11:00:00.000Z' });
		expect(store.newItems.map((entry) => entry.id)).toEqual([B.id, A.id]);
		expect(store.handled).toEqual([]);

		// A converted entry is not shown while the discarded ones are.
		store.upsert(item(B.id, { state: 'converted', ticketId: 't', handledAt: T2, updated: T2 }));
		expect(store.newItems.map((entry) => entry.id)).toEqual([A.id]);
		expect(store.handled).toEqual([]);
	});

	it('keeps handled entries outside the loaded pages out, so "Weitere laden" keeps the order', async () => {
		const { store, data } = setup();
		await store.load();
		data.listHandled.mockResolvedValueOnce({
			items: [discarded(item('item00000000010'), T2)],
			page: 1,
			hasMore: true
		});
		store.activate(DISCARDED);
		await vi.waitFor(() => expect(store.handledLoad).toBe('ready'));
		store.upsert(discarded(A, T0));
		expect(store.handled.map((entry) => entry.id)).toEqual(['item00000000010']);
		store.upsert(discarded(B, '2026-09-25 12:00:00.000Z'));
		expect(store.handled.map((entry) => entry.id)).toEqual([B.id, 'item00000000010']);
	});
});

describe('discard with "Rückgängig"', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('keeps a discarded entry in place for the undo window, then drops it', async () => {
		vi.useFakeTimers();
		const { store } = setup();
		await store.load();
		const result = await store.discard(A.id);
		expect(result.ok).toBe(true);
		expect(store.isLingering(A.id)).toBe(true);
		expect(store.visible.map((entry) => entry.id)).toEqual([B.id, A.id]);
		expect(store.visible.find((entry) => entry.id === A.id)?.state).toBe('discarded');
		expect(store.newCount).toBe(1);
		expect(store.announcement).toBe(`„${A.title}“ verworfen. Rückgängig ist kurz möglich.`);

		await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
		expect(store.isLingering(A.id)).toBe(false);
		expect(store.visible.map((entry) => entry.id)).toEqual([B.id]);
	});

	it('restores the entry with "Rückgängig"', async () => {
		vi.useFakeTimers();
		const { store, data } = setup();
		await store.load();
		await store.discard(A.id);
		const undone = await store.undo(A.id);
		expect(undone.ok).toBe(true);
		expect(data.restore).toHaveBeenCalledWith(A.id);
		expect(store.isLingering(A.id)).toBe(false);
		expect(store.newItems.map((entry) => entry.id)).toContain(A.id);
		expect(store.announcement).toBe(`„${A.title}“ ist wieder im Eingang.`);
	});

	it('does not linger an entry that was not new, and clears the timers on reset', async () => {
		vi.useFakeTimers();
		const { store } = setup();
		await store.load();
		await store.discard('item00000000077');
		expect(store.isLingering('item00000000077')).toBe(false);
		await store.discard(A.id);
		store.reset();
		expect(store.isLingering(A.id)).toBe(false);
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe('updates', () => {
	it('ignores older events and deleted entries', async () => {
		const { store } = setup();
		await store.load();
		store.upsert({ ...A, title: 'Neu', updated: T2 });
		store.upsert({ ...A, title: 'Alt', updated: T1 });
		expect(store.find(A.id)?.title).toBe('Neu');
		store.remove(A.id);
		store.upsert({ ...A, updated: '2026-09-25 12:00:00.000Z' });
		expect(store.find(A.id)).toBeNull();
	});

	it('follows realtime events and ends the subscriptions with the cleanup', async () => {
		const { store } = setup();
		await store.load();
		const live = fakeLive();
		const stop = store.connect(live.source);
		await vi.waitFor(() => expect(live.inbox).toHaveLength(1));

		const C = item('item00000000003', { created: T2, updated: T2 });
		live.send({ action: 'create', record: C });
		live.send({ action: 'update', record: discarded(A, T2) });
		live.send({ action: 'delete', id: B.id });
		expect(store.newItems.map((entry) => entry.id)).toEqual([C.id]);

		stop();
		await vi.waitFor(() => expect(live.inbox).toHaveLength(0));
		expect(live.reconnected).toHaveLength(0);
	});

	it('reconciles after a reconnection: new in, changed replaced, missing out', async () => {
		const { store, data } = setup();
		await store.load();
		const live = fakeLive();
		store.connect(live.source);
		await vi.waitFor(() => expect(live.reconnected).toHaveLength(1));

		const C = item('item00000000003', { created: T2, updated: T2 });
		data.listNew.mockResolvedValueOnce([{ ...A, title: 'Geändert', updated: T1 }, C]);
		live.reconnect();
		await vi.waitFor(() => expect(store.find(C.id)).not.toBeNull());
		expect(store.find(A.id)?.title).toBe('Geändert');
		expect(store.find(B.id)).toBeNull();
		expect(store.state).toBe('ready');
	});

	it('keeps entries changed during the reconciliation', async () => {
		const { store, data } = setup();
		await store.load();
		const pending = deferred<InboxItemSummary[]>();
		data.listNew.mockReturnValueOnce(pending.promise);
		const running = store.reconcile();
		const C = item('item00000000003', { created: T2, updated: T2 });
		store.upsert(C);
		pending.resolve([A]);
		await running;
		expect(store.newItems.map((entry) => entry.id)).toEqual([C.id, A.id]);
	});
});

describe('actions', () => {
	it('creates an entry and reports a duplicate as outcome', async () => {
		const { store, data } = setup();
		await store.load();
		const draft: InboxDraft = { channel: 'link', kind: 'link', title: 'Artikel' };
		const created = await store.create(draft);
		expect(created).toMatchObject({ kind: 'created', item: { title: 'Artikel' } });
		expect(store.newCount).toBe(3);

		data.create.mockResolvedValueOnce({
			kind: 'duplicate',
			state: 'converted',
			itemId: A.id,
			ticketId: 'tick00000000001',
			ticketKey: 'HAUS-4',
			message: 'Schon Ticket HAUS-4.'
		});
		expect(await store.create(draft)).toMatchObject({ kind: 'duplicate', ticketKey: 'HAUS-4' });
		expect(store.newCount).toBe(3);
	});

	it('imports a calendar file, reconciles after new entries and explains failures', async () => {
		const { store, data, session } = setup();
		await store.load();
		const file = new File(['BEGIN:VCALENDAR'], 'kalender.ics', { type: 'text/calendar' });
		data.importCalendar.mockResolvedValueOnce({
			created: 2,
			duplicates: 1,
			skipped: 1,
			failed: 0,
			itemId: ''
		});
		expect(await store.importCalendar(file, [0, 2])).toEqual({
			kind: 'imported',
			created: 2,
			duplicates: 1,
			skipped: 1,
			failed: 0,
			itemId: ''
		});
		expect(data.importCalendar).toHaveBeenCalledWith(file, [0, 2]);
		await vi.waitFor(() => expect(data.listNew).toHaveBeenCalledTimes(2));

		data.importCalendar.mockRejectedValueOnce(new DataError('server', { status: 503 }));
		expect(await store.importCalendar(file, [0, 2])).toEqual({
			kind: 'error',
			message: INBOX_UNAVAILABLE_MESSAGE
		});
		data.importCalendar.mockRejectedValueOnce(new DataError('network'));
		expect(await store.importCalendar(file, [0, 2])).toMatchObject({
			kind: 'error',
			message: expect.stringContaining('Server nicht erreichbar')
		});
		data.importCalendar.mockRejectedValueOnce(new DataError('session', { status: 401 }));
		expect(await store.importCalendar(file, [0, 2])).toEqual({ kind: 'error', message: null });
		expect(session.logout).toHaveBeenCalledOnce();
	});

	it('reports failures of create per field', async () => {
		const { store, data } = setup();
		data.create.mockRejectedValueOnce(
			new DataError('validation', {
				status: 400,
				fields: {
					source_url: { code: 'validation_invalid_url', message: 'Nur http- und https-Adressen.' }
				}
			})
		);
		expect(await store.create({ channel: 'link', kind: 'link', title: 'x' })).toEqual({
			kind: 'error',
			message: null,
			fields: { source_url: 'Nur http- und https-Adressen.' }
		});
		data.create.mockRejectedValueOnce(new DataError('network'));
		expect(await store.create({ channel: 'manual', kind: 'todo', title: 'x' })).toMatchObject({
			kind: 'error',
			message: expect.stringContaining('Server nicht erreichbar')
		});
	});

	it('discards, restores and assigns with the answer of the server', async () => {
		const { store, data } = setup();
		await store.load();
		expect(await store.discard(A.id)).toMatchObject({ ok: true, item: { state: 'discarded' } });
		expect(store.newItems.map((entry) => entry.id)).toEqual([B.id]);
		expect(store.isLingering(A.id)).toBe(true);
		expect(await store.restore(A.id)).toMatchObject({ ok: true, item: { state: 'new' } });
		expect(store.find(A.id)?.state).toBe('new');
		expect(await store.assign(B.id, 'tick00000000001')).toMatchObject({ ok: true });
		expect(data.assign).toHaveBeenCalledWith(B.id, 'tick00000000001');
		expect(store.newItems.map((entry) => entry.id)).toEqual([A.id]);
	});

	it('refuses a second action on the same entry while one runs', async () => {
		const { store, data } = setup();
		await store.load();
		const pending = deferred<InboxItemSummary>();
		data.discard.mockReturnValueOnce(pending.promise);
		const first = store.discard(A.id);
		expect(store.isPending(A.id)).toBe(true);
		expect(await store.discard(A.id)).toEqual({ ok: false, message: null });
		pending.resolve(discarded(A, T2));
		await first;
		expect(store.isPending(A.id)).toBe(false);
		expect(data.discard).toHaveBeenCalledOnce();
	});

	it('names the entry and the reason of a failed action', async () => {
		const { store, data } = setup();
		await store.load();
		data.assign.mockRejectedValueOnce(
			new DataError('validation', {
				status: 400,
				fields: {
					ticket: { code: 'validation_scope_mismatch', message: 'Das Ticket ist nicht verfügbar.' }
				}
			})
		);
		expect(await store.assign(A.id, 'tick00000000009')).toEqual({
			ok: false,
			message: `„${A.title}“ konnte nicht zugeordnet werden. Das Ticket ist nicht verfügbar.`
		});
		expect(store.find(A.id)?.state).toBe('new');
	});

	it('loads one entry with its text and marks a conversion before the event arrives', async () => {
		const { store } = setup();
		await store.load();
		expect(await store.fetch(A.id)).toMatchObject({ id: A.id, body: 'Text' });
		store.markConverted(A.id, 'tick00000000001', T2);
		expect(store.newItems.map((entry) => entry.id)).toEqual([B.id]);
		// The event of the hook (newer) still replaces the local mark.
		store.upsert(
			item(A.id, { state: 'converted', ticketId: 'tick00000000001', handledAt: T2, updated: T2 })
		);
		expect(store.find(A.id)).toBeNull();
		store.markConverted('item00000000099', 't', T2);
		expect(store.newItems.map((entry) => entry.id)).toEqual([B.id]);
	});

	it('gives the address of the original or says there is none', async () => {
		const { store, data } = setup();
		expect(await store.originalUrl({ id: A.id, original: 'mail_abc.eml' })).toEqual({
			ok: true,
			url: 'http://pb.test/mail_abc.eml?token=t'
		});
		expect(await store.originalUrl({ id: A.id, original: '' })).toEqual({
			ok: false,
			message: 'Zu diesem Eintrag gibt es keine Datei.'
		});
		data.originalUrl.mockRejectedValueOnce(new DataError('network'));
		expect(await store.originalUrl({ id: A.id, original: 'x.eml' })).toMatchObject({
			ok: false,
			message: expect.stringContaining('Server nicht erreichbar')
		});
	});

	it('finds soft duplicates among open tickets and the other new entries', async () => {
		const { store } = setup({
			newItems: [A, item('item00000000005', { title: `  ${A.title.toUpperCase()} ` })]
		});
		await store.load();
		const open = [{ id: 't', title: A.title, status: 'open' } as TicketSummary];
		const result = store.softDuplicates(A, open);
		expect(result.tickets).toHaveLength(1);
		expect(result.items.map((entry) => entry.id)).toEqual(['item00000000005']);
	});
});
