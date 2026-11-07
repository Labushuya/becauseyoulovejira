// InboxStore with fake data and a fake realtime source (E4 plan, T-4 and package 2): new entries
// in full, handled entries page by page, targeted updates, reconciliation after a reconnection,
// duplicates as outcome, actions with messages, the missing collection before the migration.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DATA_ERROR_MESSAGES, DataError } from '$lib/data/errors';
import type { HandledItemPage } from '$lib/data/inbox';
import type { InboxDraft, InboxItem, InboxItemSummary } from '$lib/domain/inbox';
import type { InboxQuery } from '$lib/domain/inbox-query';
import type { TicketSummary } from '$lib/domain/ticket';
import { loosePattern } from '$lib/domain/ticket-picker';
import {
	INBOX_UNAVAILABLE_MESSAGE,
	InboxStore,
	type InboxConnectionNames,
	type InboxData,
	type InboxOverlay
} from './inbox.svelte';
import { FLAG_DURATION_MS, FlagStore } from './flags.svelte';
import type { LiveSource, RecordChange, Unsubscribe } from './realtime';
import { SEARCH_DEBOUNCE_MS } from './ticket-list.svelte';

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

function setup(
	options: {
		newItems?: InboxItemSummary[];
		valid?: boolean;
		/** Entries "＋" of the outbox (OF-4a). */
		overlay?: InboxOverlay;
		/** Names of the connections (EG-2). */
		names?: InboxConnectionNames;
	} = {}
) {
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
		})),
		savePage: vi.fn<InboxData['savePage']>(async () => ({
			kind: 'saved',
			title: 'Seite',
			size: 10,
			truncated: false
		}))
	} satisfies InboxData;
	const session = { ensureValid: vi.fn(() => options.valid ?? true), logout: vi.fn() };
	const flags = new FlagStore();
	const store = new InboxStore(
		data,
		session,
		flags,
		() => [],
		options.overlay ?? null,
		options.names ?? null
	);
	return { store, data, session, flags };
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

	it('pages through every state in the view "Alle", newest first (ADR-0031 addendum C)', async () => {
		const { store, data } = setup();
		await store.load();
		const linked = item('item00000000010', {
			state: 'converted',
			ticketId: 't',
			handledAt: T2,
			created: T2,
			updated: T2
		});
		data.listHandled.mockResolvedValueOnce({ items: [linked, B, A], page: 1, hasMore: false });
		store.activate({ source: null, state: 'all' });
		await vi.waitFor(() => expect(store.handledLoad).toBe('ready'));
		expect(store.handledState).toBe('all');
		expect(data.listHandled).toHaveBeenLastCalledWith('all', 1, expect.anything());
		expect(store.visible.map((entry) => entry.id)).toEqual([linked.id, B.id, A.id]);
		// The new ones stay new (count of the switch) while they are shown here.
		expect(store.newItems.map((entry) => entry.id)).toEqual([B.id, A.id]);

		// Discarding and restoring keep the row; a newer entry comes in on top.
		store.upsert(discarded(A, T2));
		expect(store.visible.map((entry) => entry.id)).toEqual([linked.id, B.id, A.id]);
		expect(store.newItems.map((entry) => entry.id)).toEqual([B.id]);
		store.upsert({ ...A, updated: '2026-09-25 11:00:00.000Z' });
		expect(store.newItems.map((entry) => entry.id)).toEqual([B.id, A.id]);
		const fresh = item('item00000000011', { created: '2026-09-25 12:00:00.000Z', updated: T2 });
		store.upsert(fresh);
		expect(store.visible.map((entry) => entry.id)).toEqual([fresh.id, linked.id, B.id, A.id]);
	});
});

describe('discard with "Rückgängig"', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('removes a discarded entry at once and offers "Rückgängig" in a flag for 8 s (UI-5)', async () => {
		vi.useFakeTimers();
		const { store, flags } = setup();
		await store.load();
		const result = await store.discard(A.id);
		expect(result.ok).toBe(true);
		expect(store.visible.map((entry) => entry.id)).toEqual([B.id]);
		expect(store.newCount).toBe(1);
		expect(store.canUndo(A.id)).toBe(true);
		expect(flags.flags.map((flag) => [flag.tone, flag.title, flag.action?.label])).toEqual([
			['success', `„${A.title}“ verworfen.`, 'Rückgängig']
		]);

		await vi.advanceTimersByTimeAsync(FLAG_DURATION_MS);
		expect(flags.flags).toEqual([]);
		expect(store.canUndo(A.id)).toBe(false);
	});

	it('restores the entry with "Rückgängig" in the flag', async () => {
		vi.useFakeTimers();
		const { store, data, flags } = setup();
		await store.load();
		await store.discard(A.id);
		flags.act(flags.flags[0]?.id ?? '');
		await vi.waitFor(() => expect(data.restore).toHaveBeenCalledWith(A.id));
		await vi.waitFor(() => expect(store.newItems.map((entry) => entry.id)).toContain(A.id));
		expect(store.canUndo(A.id)).toBe(false);
		expect(flags.flags.map((flag) => flag.title)).toEqual([`„${A.title}“ ist wieder im Eingang.`]);
	});

	it('shows a refused "Rückgängig" as an error flag', async () => {
		const { store, data, flags } = setup();
		await store.load();
		await store.discard(A.id);
		data.restore.mockRejectedValueOnce(new DataError('network'));
		const undone = await store.undo(A.id);
		expect(undone.ok).toBe(false);
		const errors = flags.flags.filter((flag) => flag.tone === 'error');
		expect(errors.map((flag) => flag.title)).toEqual([
			expect.stringMatching(/^„.*“ konnte nicht wiederhergestellt werden\./)
		]);
	});

	it('offers no "Rückgängig" for an entry that was not new, and closes the flag on reset', async () => {
		vi.useFakeTimers();
		const { store, flags } = setup();
		await store.load();
		await store.discard('item00000000077');
		expect(store.canUndo('item00000000077')).toBe(false);
		expect(flags.flags[0]?.action).toBeNull();
		await store.discard(A.id);
		store.reset();
		expect(store.canUndo(A.id)).toBe(false);
		expect(flags.flags.map((flag) => flag.action)).toEqual([null]);
		flags.clear();
		expect(vi.getTimerCount()).toBe(0);
	});
});

// EG-1 (ADR-0014 addendum EG-1): "Verwerfen (n)" and "Wiederherstellen (n)" of the chosen entries,
// one entry after the other like the other bulk actions (no batch API), with one "Rückgängig".
describe('several entries at once (EG-1)', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	const SERVER_FAILURE =
		'Der Server hat mit einem Fehler geantwortet. Bitte später erneut versuchen.';
	const C = item('item00000000003', { created: T0 });
	const GONE = discarded(item('item00000000004'), T1);
	const LINKED = item('item00000000005', {
		state: 'converted',
		ticketId: 'tick00000000001',
		handledAt: T1,
		updated: T1
	});
	const entry = ({ id, title }: InboxItemSummary) => ({ id, title });
	const shown = (flags: FlagStore) =>
		flags.flags.map((flag) => [flag.tone, flag.title, flag.action?.label]);

	/** The store in the view "Alle": three new entries, a discarded and a linked one. */
	async function mixed() {
		const context = setup({ newItems: [A, B, C] });
		context.data.listHandled.mockResolvedValue({ items: [GONE, LINKED], page: 1, hasMore: false });
		context.store.activate({ source: null, state: 'all' });
		await vi.waitFor(() => expect(context.store.handledLoad).toBe('ready'));
		await vi.waitFor(() => expect(context.store.state).toBe('ready'));
		return context;
	}

	it('discards the new ones of a mixed choice one after the other and names the skipped ones with their reason', async () => {
		const { store, data, flags } = await mixed();
		const first = deferred<InboxItemSummary>();
		data.discard.mockReturnValueOnce(first.promise);
		const unknown = { id: 'item00000000077', title: 'Weg' };
		const run = store.discardMany([entry(A), entry(GONE), entry(LINKED), entry(B), unknown]);
		expect(store.bulkProgress).toEqual({ label: 'Verwerfen', total: 5, done: 0 });
		expect(store.isPending(A.id)).toBe(true);
		// One after the other: the next request waits for the answer of the first, a second run waits.
		expect(data.discard.mock.calls).toEqual([[A.id]]);
		await store.discardMany([entry(C)]);
		expect(data.discard.mock.calls).toEqual([[A.id]]);
		first.resolve(discarded(A, T2));
		await run;
		expect(data.discard.mock.calls).toEqual([[A.id], [B.id]]);
		expect(store.bulkProgress).toBeNull();
		expect(store.newItems.map((value) => value.id)).toEqual([C.id]);
		expect(store.bulkResult).toEqual({
			verb: 'verworfen',
			failures: [],
			skipped: [
				{ id: GONE.id, title: GONE.title, reason: 'Schon verworfen.' },
				{ id: LINKED.id, title: LINKED.title, reason: 'Schon verknüpft.' },
				{ id: unknown.id, title: 'Weg', reason: 'Nicht mehr neu.' }
			]
		});
		expect(shown(flags)).toEqual([
			['success', '2 Einträge verworfen, 3 übersprungen.', 'Rückgängig']
		]);
		expect(store.canUndoBulk).toBe(true);
	});

	it('skips an entry whose own action still runs', async () => {
		const { store, data } = setup();
		await store.load();
		const single = deferred<InboxItemSummary>();
		data.discard.mockReturnValueOnce(single.promise);
		const one = store.discard(A.id);
		await store.discardMany([entry(A), entry(B)]);
		expect(store.bulkResult?.skipped).toEqual([
			{ id: A.id, title: A.title, reason: 'Wird gerade bearbeitet.' }
		]);
		expect(store.isPending(A.id)).toBe(true);
		single.resolve(discarded(A, T2));
		await one;
		expect(data.discard.mock.calls).toEqual([[A.id], [B.id]]);
	});

	it('goes on after a failure, names it with its reason and keeps that entry new', async () => {
		const { store, data, flags } = setup();
		await store.load();
		data.discard.mockRejectedValueOnce(new DataError('server'));
		await store.discardMany([entry(A), entry(B)]);
		expect(data.discard.mock.calls).toEqual([[A.id], [B.id]]);
		expect(store.find(A.id)?.state).toBe('new');
		expect(store.bulkResult).toEqual({
			verb: 'verworfen',
			// Since round 2 a failure keeps its request for "Details" (E-7, checked below).
			failures: [{ id: A.id, title: A.title, reason: SERVER_FAILURE, problem: expect.any(Object) }],
			skipped: []
		});
		expect(shown(flags)).toEqual([
			['success', '1 Eintrag verworfen, 1 fehlgeschlagen.', 'Rückgängig']
		]);
	});

	it('shows an error flag without "Rückgängig" when no entry could be discarded', async () => {
		const { store, data, flags } = setup();
		await store.load();
		data.discard.mockRejectedValue(new DataError('server'));
		await store.discardMany([entry(A), entry(B)]);
		expect(
			flags.flags.map((flag) => [flag.tone, flag.title, flag.description, flag.action])
		).toEqual([
			[
				'error',
				'Keiner der 2 Einträge wurde verworfen.',
				'Die Gründe stehen bei der Auswahl.',
				null
			]
		]);
		expect(store.canUndoBulk).toBe(false);
		expect(store.bulkResult?.failures).toHaveLength(2);
	});

	it('restores every entry of the run with one "Rückgängig" in its flag', async () => {
		vi.useFakeTimers();
		const { store, data, flags } = setup();
		await store.load();
		await store.discardMany([entry(A), entry(B)]);
		expect(store.newItems).toEqual([]);
		flags.act(flags.flags[0]?.id ?? '');
		await vi.waitFor(() =>
			expect(store.newItems.map((value) => value.id).sort()).toEqual([A.id, B.id])
		);
		expect(data.restore.mock.calls).toEqual([[A.id], [B.id]]);
		expect(store.canUndoBulk).toBe(false);
		expect(store.bulkResult).toBeNull();
		expect(shown(flags)).toEqual([['success', '2 Einträge wiederhergestellt.', undefined]]);
	});

	it('offers "Rückgängig" as long as the flag of one discarded entry, 8 s', async () => {
		vi.useFakeTimers();
		const { store, flags } = setup();
		await store.load();
		await store.discardMany([entry(A)]);
		expect(store.canUndoBulk).toBe(true);
		await vi.advanceTimersByTimeAsync(FLAG_DURATION_MS);
		expect(flags.flags).toEqual([]);
		expect(store.canUndoBulk).toBe(false);
	});

	it('names a failed restore of "Rückgängig" in the result and in its flag', async () => {
		const { store, data, flags } = setup();
		await store.load();
		await store.discardMany([entry(A), entry(B)]);
		data.restore.mockRejectedValueOnce(new DataError('server'));
		await store.undoDiscardMany();
		expect(data.restore.mock.calls).toEqual([[A.id], [B.id]]);
		expect(store.find(B.id)?.state).toBe('new');
		expect(store.bulkResult).toEqual({
			verb: 'wiederhergestellt',
			failures: [{ id: A.id, title: A.title, reason: SERVER_FAILURE, problem: expect.any(Object) }],
			skipped: []
		});
		expect(shown(flags)).toEqual([
			['success', '1 Eintrag wiederhergestellt, 1 fehlgeschlagen.', undefined]
		]);
	});

	it('restores the discarded ones of a choice and names the others', async () => {
		const { store, data, flags } = await mixed();
		await store.restoreMany([entry(GONE), entry(A), entry(LINKED)]);
		expect(data.restore.mock.calls).toEqual([[GONE.id]]);
		expect(store.find(GONE.id)?.state).toBe('new');
		expect(store.bulkResult).toEqual({
			verb: 'wiederhergestellt',
			failures: [],
			skipped: [
				{ id: A.id, title: A.title, reason: 'Schon im Eingang.' },
				{ id: LINKED.id, title: LINKED.title, reason: 'Verknüpft, nicht verworfen.' }
			]
		});
		expect(shown(flags)).toEqual([
			['success', '1 Eintrag wiederhergestellt, 2 übersprungen.', undefined]
		]);
		store.dismissBulkResult();
		expect(store.bulkResult).toBeNull();
	});

	it('stops at an ended session without a result, and reset ends a running run', async () => {
		const { store, data, session, flags } = setup();
		await store.load();
		data.discard.mockRejectedValueOnce(new DataError('session'));
		await store.discardMany([entry(A), entry(B)]);
		expect(session.logout).toHaveBeenCalledOnce();
		expect(data.discard).toHaveBeenCalledOnce();
		expect(store.bulkProgress).toBeNull();
		expect(store.bulkResult).toBeNull();
		expect(flags.flags).toEqual([]);

		const pending = deferred<InboxItemSummary>();
		data.discard.mockReturnValueOnce(pending.promise);
		const run = store.discardMany([entry(A), entry(B)]);
		store.reset();
		expect(store.bulkProgress).toBeNull();
		pending.resolve(discarded(A, T2));
		await run;
		expect(data.discard).toHaveBeenCalledTimes(2);
		expect(store.bulkResult).toBeNull();
		expect(flags.flags).toEqual([]);
	});

	// Round 2 of EG-1 (review E-2, E-3, E-4, E-7 and E-8).
	const T3 = '2026-09-25 11:00:00.000Z';

	it('restores the rest of a run when the chip "Quelle" changes meanwhile; only a deleted entry is skipped (E-2)', async () => {
		const D = discarded(item('item00000000006'), T1);
		const E = discarded(item('item00000000007'), T0);
		const F = discarded(item('item00000000008'), T0);
		const { store, data, flags } = setup();
		data.listHandled.mockResolvedValueOnce({ items: [D, E, F], page: 1, hasMore: false });
		store.activate({ source: null, state: 'discarded' });
		await vi.waitFor(() => expect(store.handledLoad).toBe('ready'));
		const first = deferred<InboxItemSummary>();
		data.restore.mockReturnValueOnce(first.promise);
		const run = store.restoreMany([entry(D), entry(E), entry(F)]);
		// Meanwhile another source is chosen (the view loads anew, without these entries) and another
		// tab deletes one of them.
		store.activate({ source: 'mail', state: 'discarded' });
		store.remove(F.id);
		first.resolve(item(D.id, { updated: T2 }));
		await run;
		// The server decides on the unloaded one; the deleted one is named as before.
		expect(data.restore.mock.calls).toEqual([[D.id], [E.id]]);
		expect(store.bulkResult).toEqual({
			verb: 'wiederhergestellt',
			failures: [],
			skipped: [{ id: F.id, title: F.title, reason: 'Nicht mehr verworfen.' }]
		});
		expect(shown(flags)).toEqual([
			['success', '2 Einträge wiederhergestellt, 1 übersprungen.', undefined]
		]);
	});

	it('keeps a result for its view only: another state drops it, another source does not (E-3)', async () => {
		const { store } = setup();
		store.activate({ source: null, state: 'new' });
		await vi.waitFor(() => expect(store.state).toBe('ready'));
		await store.discardMany([entry(A), { id: 'item00000000077', title: 'Weg' }]);
		expect(store.bulkResult?.skipped).toHaveLength(1);
		store.activate({ source: 'mail', state: 'new' });
		expect(store.bulkResult?.skipped).toHaveLength(1);
		store.activate({ source: 'mail', state: 'discarded' });
		expect(store.bulkResult).toBeNull();
	});

	it('keeps no result of a run that ends in another view; its error flag then carries "Details" (E-3, E-7)', async () => {
		const { store, data, flags } = setup();
		store.activate({ source: null, state: 'new' });
		await vi.waitFor(() => expect(store.state).toBe('ready'));
		const first = deferred<InboxItemSummary>();
		data.discard.mockReturnValueOnce(first.promise);
		data.discard.mockRejectedValueOnce(new DataError('server'));
		const run = store.discardMany([entry(A), entry(B)]);
		store.activate({ source: null, state: 'converted' });
		first.reject(new DataError('server'));
		await run;
		expect(data.discard).toHaveBeenCalledTimes(2);
		expect(store.bulkResult).toBeNull();
		// No "Die Gründe stehen bei der Auswahl.": no result stands; the flag offers the request and,
		// since MO-7c1 (F-1), names the reason of the first failure.
		expect(flags.flags.map((flag) => [flag.tone, flag.title, flag.description])).toEqual([
			[
				'error',
				'Keiner der 2 Einträge wurde verworfen.',
				`„${A.title}“: ${SERVER_FAILURE} Dazu 1 weiterer Fehler.`
			]
		]);
		expect(flags.flags[0]?.problem).toEqual(expect.objectContaining({ source: 'client' }));
	});

	// MO-7c1 (F-1 of the review of EG-1): a run with failures whose result cannot stand at the
	// selection (it ended in another view, or "Rückgängig" ran in "Alle" or "Verknüpft") warns with the
	// reason and "Details" instead of a flag of success.
	it('warns with the reason and "Details" when a run with failures ends in another view (F-1)', async () => {
		const { store, data, flags } = setup();
		store.activate({ source: null, state: 'new' });
		await vi.waitFor(() => expect(store.state).toBe('ready'));
		const first = deferred<InboxItemSummary>();
		data.discard.mockReturnValueOnce(first.promise);
		data.discard.mockRejectedValueOnce(new DataError('server'));
		const run = store.discardMany([entry(A), entry(B)]);
		store.activate({ source: null, state: 'all' });
		first.resolve(discarded(A, T2));
		await run;
		expect(store.bulkResult).toBeNull();
		expect(shown(flags)).toEqual([
			['error', '1 Eintrag verworfen, 1 fehlgeschlagen.', 'Rückgängig']
		]);
		expect(flags.flags[0]?.description).toBe(`„${B.title}“: ${SERVER_FAILURE}`);
		expect(flags.flags[0]?.problem).toEqual(expect.objectContaining({ source: 'client' }));
		// "Rückgängig" stays for the one that was discarded.
		expect(store.canUndoBulk).toBe(true);
	});

	it('warns with the reason and "Details" when "Rückgängig" in the view "Alle" fails for an entry (F-1)', async () => {
		const { store, data, flags } = setup();
		await store.load();
		await store.discardMany([entry(A), entry(B)]);
		store.activate({ source: null, state: 'all' });
		data.restore.mockRejectedValueOnce(new DataError('server'));
		await store.undoDiscardMany();
		expect(data.restore.mock.calls).toEqual([[A.id], [B.id]]);
		expect(shown(flags)).toEqual([
			['error', '1 Eintrag wiederhergestellt, 1 fehlgeschlagen.', undefined]
		]);
		expect(flags.flags[0]?.description).toBe(`„${A.title}“: ${SERVER_FAILURE}`);
		expect(flags.flags[0]?.problem).toEqual(expect.objectContaining({ source: 'client' }));
	});

	// NA-1 (C3 of the review of MO-7c1): the reason and "Details" of the flag belong to the same failure,
	// the first one. A refusal that only checks an input has no request for "Details"; the flag then
	// offers none, rather than the request of another entry.
	it('takes the reason and "Details" of the flag from the same failure (NA-1, C3)', async () => {
		const { store, data, flags } = setup();
		store.activate({ source: null, state: 'new' });
		await vi.waitFor(() => expect(store.state).toBe('ready'));
		const first = deferred<InboxItemSummary>();
		data.discard.mockReturnValueOnce(first.promise);
		data.discard.mockRejectedValueOnce(new DataError('server'));
		const run = store.discardMany([entry(A), entry(B)]);
		store.activate({ source: null, state: 'converted' });
		first.reject(
			new DataError('validation', {
				status: 400,
				fields: { title: { code: 'validation_required', message: 'Bitte einen Titel angeben.' } }
			})
		);
		await run;
		expect(data.discard).toHaveBeenCalledTimes(2);
		expect(flags.flags.map((flag) => [flag.tone, flag.description])).toEqual([
			['error', `„${A.title}“: Bitte einen Titel angeben. Dazu 1 weiterer Fehler.`]
		]);
		// The flag keeps no request: no "Details".
		expect(flags.flags[0]?.problem).toBeNull();
	});

	it('keeps the flag of success where the result stands at the selection (F-1, counter-check)', async () => {
		const { store, data, flags } = setup();
		await store.load();
		data.discard.mockRejectedValueOnce(new DataError('server'));
		await store.discardMany([entry(A), entry(B)]);
		expect(store.bulkResult?.failures).toHaveLength(1);
		expect(shown(flags)).toEqual([
			['success', '1 Eintrag verworfen, 1 fehlgeschlagen.', 'Rückgängig']
		]);
		expect(flags.flags[0]?.description).toBe('');
	});

	it('says "Nichts verworfen" in an info flag without "Rückgängig" when every entry was skipped (E-4)', async () => {
		const { store, data, flags } = await mixed();
		await store.discardMany([entry(GONE), entry(LINKED)]);
		expect(data.discard).not.toHaveBeenCalled();
		expect(shown(flags)).toEqual([['info', 'Nichts verworfen: 2 übersprungen.', undefined]]);
		expect(store.canUndoBulk).toBe(false);
	});

	it('keeps the failed request of a failure for "Details", like one failed action (E-7)', async () => {
		const { store, data } = setup();
		await store.load();
		data.discard.mockRejectedValueOnce(new DataError('server', { status: 500 }));
		await store.discardMany([entry(A), entry(B)]);
		expect(store.bulkResult?.failures).toEqual([
			{
				id: A.id,
				title: A.title,
				reason: expect.any(String),
				problem: expect.objectContaining({
					source: 'client',
					outcome: expect.objectContaining({ status: 500 })
				})
			}
		]);
	});

	it('skips in "Rückgängig" what was restored or linked meanwhile and leaves what was discarded before (E-8)', async () => {
		const { store, data, flags } = await mixed();
		await store.discardMany([entry(A), entry(B), entry(C), entry(GONE)]);
		expect(store.bulkResult?.skipped).toEqual([
			{ id: GONE.id, title: GONE.title, reason: 'Schon verworfen.' }
		]);
		// Meanwhile another tab restores A and links B to a ticket.
		store.upsert({ ...A, updated: T3 });
		store.upsert({
			...B,
			state: 'converted',
			ticketId: 'tick00000000002',
			handledAt: T3,
			updated: T3
		});
		await store.undoDiscardMany();
		expect(data.restore.mock.calls).toEqual([[C.id]]);
		expect(store.find(GONE.id)?.state).toBe('discarded');
		expect(store.find(B.id)?.state).toBe('converted');
		expect(store.bulkResult).toEqual({
			verb: 'wiederhergestellt',
			failures: [],
			skipped: [
				{ id: A.id, title: A.title, reason: 'Schon im Eingang.' },
				{ id: B.id, title: B.title, reason: 'Verknüpft, nicht verworfen.' }
			]
		});
		expect(shown(flags)).toEqual([
			['success', '1 Eintrag wiederhergestellt, 2 übersprungen.', undefined]
		]);
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
	it('saves the page of a web link with a flag, and passes a refusal on (ADR-0031)', async () => {
		const { store, data, flags, session } = setup();
		expect(await store.savePage({ id: A.id, title: 'Artikel' })).toEqual({
			ok: true,
			truncated: false
		});
		expect(data.savePage).toHaveBeenCalledWith(A.id);
		// The newest flag stands first.
		expect(flags.flags[0]?.title).toBe('Seite von „Artikel“ gesichert.');

		data.savePage.mockResolvedValueOnce({ kind: 'saved', title: '', size: 3, truncated: true });
		await store.savePage({ id: A.id, title: 'Artikel' });
		expect(flags.flags[0]?.title).toBe('Seite von „Artikel“ gesichert (auf 2 MB gekürzt).');

		data.savePage.mockResolvedValueOnce({
			kind: 'refused',
			message: 'Die Seite ist schon gesichert.'
		});
		expect(await store.savePage({ id: A.id, title: 'Artikel' })).toEqual({
			ok: false,
			message: 'Die Seite ist schon gesichert.'
		});

		data.savePage.mockRejectedValueOnce(new DataError('session'));
		expect(await store.savePage({ id: A.id, title: 'Artikel' })).toEqual({
			ok: false,
			message: null
		});
		expect(session.logout).toHaveBeenCalledOnce();
	});

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
		expect(store.canUndo(A.id)).toBe(true);
		expect(await store.restore(A.id)).toMatchObject({ ok: true, item: { state: 'new' } });
		expect(store.canUndo(A.id)).toBe(false);
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
			message: `„${A.title}“ konnte nicht zugeordnet werden. Das Ticket ist nicht verfügbar.`,
			// The refusal of the hook with its "Details" (FP-1).
			problem: expect.objectContaining({
				outcome: expect.objectContaining({ code: 'ticket: validation_scope_mismatch' })
			})
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

describe('area of the tab (E7-3, ADR-0059 §2)', () => {
	it('drops the entries of the old area at once and loads the new ones for the same view', async () => {
		const { store, data } = setup();
		await store.load();
		const query: InboxQuery = { source: null, state: 'discarded' };
		data.listHandled.mockResolvedValueOnce({
			items: [discarded(item('item00000000010'), T2)],
			page: 1,
			hasMore: false
		});
		store.activate(query);
		await vi.waitFor(() => expect(store.handledLoad).toBe('ready'));
		const fresh = deferred<InboxItemSummary[]>();
		data.listNew.mockImplementationOnce(() => fresh.promise);
		const shared = item('item00000000020', { created: T2 });
		data.listHandled.mockResolvedValueOnce({ items: [], page: 1, hasMore: false });

		store.rescope();

		expect(store.newItems).toEqual([]);
		expect(store.handled).toEqual([]);
		expect(store.newCount).toBeNull();
		fresh.resolve([shared]);
		await vi.waitFor(() => expect(store.state).toBe('ready'));
		await vi.waitFor(() => expect(store.handledLoad).toBe('ready'));
		expect(store.newItems.map((entry) => entry.id)).toEqual([shared.id]);
		expect(store.handledState).toBe('discarded');
		expect(data.listNew).toHaveBeenCalledTimes(2);
		expect(data.listHandled).toHaveBeenCalledTimes(2);
	});
});

describe('search (EG-2, ADR-0014 addendum EG-2)', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	const MILK = item('item00000000031', { title: 'Milch kaufen', created: T1 });
	const BILL = item('item00000000032', {
		title: 'Rechnung März',
		channel: 'mail',
		kind: 'mail',
		connectionId: 'conn00000000001',
		created: T2
	});
	const NAMES: InboxConnectionNames = {
		nameOf: (id) => (id === 'conn00000000001' ? 'Gmail Arbeit' : null),
		names: ['Gmail Arbeit']
	};
	const ids = (entries: readonly InboxItemSummary[]) => entries.map((entry) => entry.id);
	/** The patterns of the last request of a paged view. */
	const lastPatterns = (data: ReturnType<typeof setup>['data']) =>
		data.listHandled.mock.calls.at(-1)?.[2].patterns;

	it('narrows the new entries in the client without a request; the count of the switch stays', async () => {
		const { store, data } = setup({ newItems: [A, MILK, BILL], names: NAMES });
		await store.load();
		store.activate({ source: null, state: 'new', search: 'märz' });
		expect(ids(store.visible)).toEqual([BILL.id]);
		expect(store.searching).toBe(true);
		expect(store.searchTotal).toBe(3);
		expect(store.newCount).toBe(3);
		// The name of the connection, case and order of the words do not matter.
		store.activate({ source: null, state: 'new', search: 'ARBEIT gmail' });
		expect(ids(store.visible)).toEqual([BILL.id]);
		store.activate({ source: null, state: 'new', search: 'kaufen Milch' });
		expect(ids(store.visible)).toEqual([MILK.id]);
		// With the chips: the search narrows what they leave.
		store.activate({ source: 'mail', state: 'new', search: 'milch' });
		expect(store.visible).toEqual([]);
		expect(store.searchTotal).toBe(1);
		store.activate({ source: null, state: 'new', search: null });
		expect(ids(store.visible)).toEqual([BILL.id, MILK.id, A.id]);
		expect(store.searching).toBe(false);
		expect(data.listHandled).not.toHaveBeenCalled();
		expect(data.listNew).toHaveBeenCalledOnce();
	});

	it('finds the entries "＋" of the outbox and narrows realtime entries with the same search', async () => {
		const kept: InboxItem = {
			...item('item00000000033', { title: 'Paket abholen', created: T2 }),
			body: ''
		};
		const overlay: InboxOverlay = {
			createdItems: () => [kept],
			createdItem: (id) => (id === kept.id ? kept : null),
			isCreatedView: () => false
		};
		const { store } = setup({ newItems: [A], overlay });
		const live = fakeLive();
		store.connect(live.source);
		await vi.waitFor(() => expect(live.inbox).toHaveLength(1));
		await store.load();
		store.activate({ source: null, state: 'new', search: 'paket' });
		expect(ids(store.visible)).toEqual([kept.id]);

		live.send({
			action: 'create',
			record: item('item00000000034', { title: 'Paket zur Post', created: T1, updated: T1 })
		});
		live.send({
			action: 'create',
			record: item('item00000000035', { title: 'Brief', updated: T1 })
		});
		expect(ids(store.visible)).toEqual([kept.id, 'item00000000034']);
		expect(store.newCount).toBe(4);
	});

	it('asks a paged view again after the pause with the server words and narrows its answer exactly', async () => {
		vi.useFakeTimers();
		const { store, data } = setup({ names: NAMES });
		await store.load();
		const bill = discarded(item('item00000000040', { title: 'Rechnung Strom' }), T2);
		const roof = discarded(item('item00000000041', { title: 'Dach' }), T1);
		const loose = discarded(item('item00000000042', { title: 'Rüche nähen' }), T0);
		data.listHandled.mockResolvedValueOnce({ items: [bill, roof], page: 1, hasMore: true });
		store.activate({ source: null, state: 'discarded' });
		await vi.advanceTimersByTimeAsync(0);
		expect(store.handledLoad).toBe('ready');
		expect(lastPatterns(data)).toEqual([]);

		// Typing narrows the loaded rows at once; the server is asked only after the pause.
		const answer = deferred<HandledItemPage>();
		data.listHandled.mockImplementationOnce(() => answer.promise);
		store.activate({ source: null, state: 'discarded', search: 'Rech' });
		expect(ids(store.visible)).toEqual([bill.id]);
		expect(ids(store.handled)).toEqual([bill.id, roof.id]);
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS - 1);
		expect(data.listHandled).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(data.listHandled).toHaveBeenCalledTimes(2);
		expect(data.listHandled).toHaveBeenLastCalledWith(
			'discarded',
			1,
			expect.objectContaining({ patterns: [loosePattern('rech')] })
		);
		// The server sends a superset; only what the search finds is shown.
		answer.resolve({ items: [bill, loose], page: 1, hasMore: true });
		await vi.advanceTimersByTimeAsync(0);
		expect(ids(store.handled)).toEqual([bill.id, loose.id]);
		expect(ids(store.visible)).toEqual([bill.id]);
		expect(store.searchTotal).toBe(2);
		expect(store.handledHasMore).toBe(true);

		// "Weitere laden" and a reconciliation ask with the words of page 1.
		data.listHandled.mockResolvedValueOnce({ items: [], page: 2, hasMore: false });
		await store.loadMoreHandled();
		expect(data.listHandled).toHaveBeenLastCalledWith(
			'discarded',
			2,
			expect.objectContaining({ patterns: [loosePattern('rech')] })
		);
		expect(store.handledHasMore).toBe(false);
		await store.reconcile();
		expect(data.listHandled).toHaveBeenLastCalledWith(
			'discarded',
			2,
			expect.objectContaining({ patterns: [loosePattern('rech')] })
		);
	});

	it('aborts a stale request, starts the pause anew with every change and leaves words of the client alone', async () => {
		vi.useFakeTimers();
		const { store, data } = setup({ names: NAMES });
		await store.load();
		store.activate({ source: null, state: 'all' });
		await vi.advanceTimersByTimeAsync(0);
		const stale = deferred<HandledItemPage>();
		data.listHandled.mockImplementationOnce(() => stale.promise);
		store.activate({ source: null, state: 'all', search: 'rech' });
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
		const staleSignal = data.listHandled.mock.calls.at(-1)?.[2].signal;
		expect(staleSignal?.aborted).toBe(false);

		store.activate({ source: null, state: 'all', search: 'rechnung' });
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS - 1);
		expect(staleSignal?.aborted).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		expect(staleSignal?.aborted).toBe(true);
		expect(lastPatterns(data)).toEqual([loosePattern('rechnung')]);
		await vi.advanceTimersByTimeAsync(0);
		expect(store.handledLoad).toBe('ready');
		const calls = data.listHandled.mock.calls.length;

		// Words with a digit, of a channel or of a connection narrow in the client only.
		store.activate({ source: null, state: 'all', search: 'rechnung 2026 postfach arbeit' });
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS * 2);
		expect(data.listHandled).toHaveBeenCalledTimes(calls);

		// Typing on starts the pause anew: one request for the last text.
		store.activate({ source: null, state: 'all', search: 'strom' });
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS - 50);
		store.activate({ source: null, state: 'all', search: 'stromz' });
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS - 50);
		expect(data.listHandled).toHaveBeenCalledTimes(calls);
		await vi.advanceTimersByTimeAsync(50);
		expect(data.listHandled).toHaveBeenCalledTimes(calls + 1);
		expect(lastPatterns(data)).toEqual([loosePattern('stromz')]);
	});

	it('keeps the loaded rows after a failure or without a connection and narrows them in the client', async () => {
		vi.useFakeTimers();
		const { store, data } = setup();
		await store.load();
		const linked = (id: string, title: string, at: string) =>
			item(id, { title, state: 'converted', ticketId: 't', handledAt: at, updated: at });
		const bill = linked('item00000000043', 'Rechnung Strom', T2);
		const roof = linked('item00000000044', 'Dach reparieren', T1);
		data.listHandled.mockResolvedValueOnce({ items: [bill, roof], page: 1, hasMore: false });
		store.activate({ source: null, state: 'converted' });
		await vi.advanceTimersByTimeAsync(0);

		data.listHandled.mockRejectedValueOnce(new DataError('network'));
		store.activate({ source: null, state: 'converted', search: 'dach' });
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
		expect(store.handledLoad).toBe('error');
		expect(store.handledError).toBe(DATA_ERROR_MESSAGES.network);
		expect(ids(store.handled)).toEqual([bill.id, roof.id]);
		expect(ids(store.visible)).toEqual([roof.id]);

		// "Erneut versuchen" asks again with the search.
		data.listHandled.mockResolvedValueOnce({ items: [roof], page: 1, hasMore: false });
		await store.reload();
		expect(store.handledLoad).toBe('ready');
		expect(lastPatterns(data)).toEqual([loosePattern('dach')]);
		expect(ids(store.visible)).toEqual([roof.id]);
	});

	it('asks again once the names of the connections come in, so no name narrows on the server', async () => {
		vi.useFakeTimers();
		const known: string[] = [];
		const names: InboxConnectionNames = {
			nameOf: () => null,
			get names() {
				return known;
			}
		};
		const { store, data } = setup({ names });
		await store.load();
		store.activate({ source: null, state: 'discarded', search: 'arbeit' });
		await vi.advanceTimersByTimeAsync(0);
		expect(lastPatterns(data)).toEqual([loosePattern('arbeit')]);
		known.push('Gmail Arbeit');
		store.namesChanged();
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
		expect(lastPatterns(data)).toEqual([]);
		// Another view or the new entries ask nothing for the names.
		const calls = data.listHandled.mock.calls.length;
		store.activate({ source: null, state: 'new', search: 'arbeit' });
		store.namesChanged();
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
		expect(data.listHandled).toHaveBeenCalledTimes(calls);
	});

	// The review of EG-2 (R-B1, R-A5, R-A6, R-A7).
	it('refreshes page 1 over loaded rows without leaving "ready", and loads when there were none', async () => {
		vi.useFakeTimers();
		const { store, data } = setup();
		await store.load();
		const bill = discarded(item('item00000000050', { title: 'Rechnung Strom' }), T2);
		const roof = discarded(item('item00000000051', { title: 'Dach' }), T1);
		const first = deferred<HandledItemPage>();
		data.listHandled.mockImplementationOnce(() => first.promise);
		store.activate({ source: null, state: 'discarded' });
		// The first page of a view is no refresh: there is nothing to keep.
		expect(store.handledLoad).toBe('loading');
		expect(store.handledRefreshing).toBe(false);
		first.resolve({ items: [bill, roof], page: 1, hasMore: true });
		await vi.advanceTimersByTimeAsync(0);

		const answer = deferred<HandledItemPage>();
		data.listHandled.mockImplementationOnce(() => answer.promise);
		store.activate({ source: null, state: 'discarded', search: 'rechnung' });
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
		expect(store.handledLoad).toBe('ready');
		expect(store.handledRefreshing).toBe(true);
		expect(store.handledHasMore).toBe(true);
		expect(ids(store.visible)).toEqual([bill.id]);
		expect(ids(store.handled)).toEqual([bill.id, roof.id]);
		answer.resolve({ items: [bill], page: 1, hasMore: false });
		await vi.advanceTimersByTimeAsync(0);
		expect(store.handledRefreshing).toBe(false);
		expect(store.handledHasMore).toBe(false);
		// The answer replaces the loaded rows: no old row stays.
		expect(ids(store.handled)).toEqual([bill.id]);

		// Another view ends a running refresh at once.
		data.listHandled.mockImplementationOnce(() => new Promise(() => undefined));
		store.activate({ source: null, state: 'discarded', search: 'strom' });
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
		expect(store.handledRefreshing).toBe(true);
		store.activate({ source: null, state: 'new' });
		expect(store.handledRefreshing).toBe(false);
		expect(store.handledLoad).toBe('idle');
	});

	it('loads no further page after a failed page 1, and the reconciliation asks page 1 again', async () => {
		vi.useFakeTimers();
		const { store, data } = setup();
		await store.load();
		const bill = discarded(item('item00000000052', { title: 'Rechnung Strom' }), T2);
		data.listHandled.mockResolvedValueOnce({ items: [bill], page: 1, hasMore: true });
		store.activate({ source: null, state: 'discarded' });
		await vi.advanceTimersByTimeAsync(0);

		data.listHandled.mockRejectedValueOnce(new DataError('network'));
		store.activate({ source: null, state: 'discarded', search: 'rechnung' });
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
		expect(store.handledLoad).toBe('error');
		expect(store.handledHasMore).toBe(true);
		const calls = data.listHandled.mock.calls.length;
		// The words of the loaded pages are no longer those of the failed page 1: no page 2.
		await store.loadMoreHandled();
		expect(data.listHandled).toHaveBeenCalledTimes(calls);

		data.listHandled.mockResolvedValueOnce({ items: [bill], page: 1, hasMore: false });
		await store.reconcile();
		expect(data.listHandled).toHaveBeenCalledTimes(calls + 1);
		expect(data.listHandled).toHaveBeenLastCalledWith(
			'discarded',
			1,
			expect.objectContaining({ patterns: [loosePattern('rechnung')] })
		);
		expect(store.handledLoad).toBe('ready');
		expect(store.handledError).toBeNull();
		expect(ids(store.visible)).toEqual([bill.id]);
		// The new entries were reconciled as well.
		expect(data.listNew).toHaveBeenCalledTimes(2);
	});

	it('keeps the order of the loaded pages for a changed search and reads a renamed connection', async () => {
		vi.useFakeTimers();
		let name = 'Gmail Arbeit';
		const names: InboxConnectionNames = {
			nameOf: (id) => (id === 'conn00000000001' ? name : null),
			get names() {
				return [name];
			}
		};
		const { store, data } = setup({ names });
		await store.load();
		const bill = discarded({ ...BILL, id: 'item00000000053' }, T2);
		const milk = discarded({ ...MILK, id: 'item00000000054' }, T1);
		data.listHandled.mockResolvedValue({ items: [milk, bill], page: 1, hasMore: false });
		store.activate({ source: null, state: 'discarded' });
		await vi.advanceTimersByTimeAsync(0);
		const order = store.handled;
		expect(ids(order)).toEqual([bill.id, milk.id]);
		// A search of the client alone: the same sorted list, narrowed.
		store.activate({ source: null, state: 'discarded', search: 'gmail' });
		expect(store.handled).toBe(order);
		expect(ids(store.visible)).toEqual([bill.id]);
		// The connection is renamed: the text of the entry is built anew.
		name = 'Privat';
		store.activate({ source: null, state: 'discarded', search: 'gmail ' });
		expect(store.visible).toEqual([]);
		store.activate({ source: null, state: 'discarded', search: 'privat' });
		expect(ids(store.visible)).toEqual([bill.id]);
		expect(data.listHandled).toHaveBeenCalledTimes(1);
	});

	// After the review of PR #349 (N-1, N-5 and further cases).
	it('counts the pause of a changed search as a refresh until page 1 answers (N-1)', async () => {
		vi.useFakeTimers();
		const { store, data } = setup();
		await store.load();
		const bill = discarded(item('item00000000060', { title: 'Rechnung Strom' }), T2);
		data.listHandled.mockResolvedValueOnce({ items: [bill], page: 1, hasMore: false });
		store.activate({ source: null, state: 'discarded' });
		await vi.advanceTimersByTimeAsync(0);
		expect(store.handledRefreshing).toBe(false);

		const answer = deferred<HandledItemPage>();
		data.listHandled.mockImplementationOnce(() => answer.promise);
		store.activate({ source: null, state: 'discarded', search: 'zahnarzt' });
		// No request yet, and the loaded rows do not answer the new search: the view counts as busy.
		expect(store.visible).toEqual([]);
		expect(store.handledLoad).toBe('ready');
		expect(store.handledRefreshing).toBe(true);
		expect(data.listHandled).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
		expect(data.listHandled).toHaveBeenCalledTimes(2);
		expect(store.handledRefreshing).toBe(true);
		answer.resolve({ items: [], page: 1, hasMore: false });
		await vi.advanceTimersByTimeAsync(0);
		expect(store.handledRefreshing).toBe(false);

		// Words of the client alone start no pause; another view ends a waiting one.
		store.activate({ source: null, state: 'discarded', search: 'zahnarzt 2026' });
		expect(store.handledRefreshing).toBe(false);
		store.activate({ source: null, state: 'discarded', search: 'strom' });
		expect(store.handledRefreshing).toBe(true);
		store.activate({ source: null, state: 'new' });
		expect(store.handledRefreshing).toBe(false);
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
		expect(data.listHandled).toHaveBeenCalledTimes(2);
	});

	it('makes the view "error" when page 1 ends without an answer and without a message (N-5)', async () => {
		vi.useFakeTimers();
		for (const failure of [new DataError('aborted'), new DataError('session', { status: 401 })]) {
			const { store, data, session } = setup();
			await store.load();
			const bill = discarded(item('item00000000061', { title: 'Rechnung Strom' }), T2);
			data.listHandled.mockResolvedValueOnce({ items: [bill], page: 1, hasMore: true });
			store.activate({ source: null, state: 'discarded' });
			await vi.advanceTimersByTimeAsync(0);

			// An abort from elsewhere or an ended session, not the own signal.
			data.listHandled.mockRejectedValueOnce(failure);
			store.activate({ source: null, state: 'discarded', search: 'rechnung' });
			await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
			expect(store.handledLoad, failure.kind).toBe('error');
			expect(store.handledError).toBeNull();
			expect(store.handledRefreshing).toBe(false);
			expect(ids(store.visible)).toEqual([bill.id]);
			expect(session.logout).toHaveBeenCalledTimes(failure.kind === 'session' ? 1 : 0);
			// The server words of the loaded pages are no longer known: no further page.
			const calls = data.listHandled.mock.calls.length;
			await store.loadMoreHandled();
			expect(data.listHandled).toHaveBeenCalledTimes(calls);
		}

		// The first page of a view as well: it does not stay "loading".
		const { store, data } = setup();
		await store.load();
		data.listHandled.mockRejectedValueOnce(new DataError('aborted'));
		store.activate({ source: null, state: 'converted' });
		await vi.advanceTimersByTimeAsync(0);
		expect(store.handledLoad).toBe('error');
		expect(store.handledError).toBeNull();
	});

	it('merges no page of a reconciliation while page 1 loads again', async () => {
		vi.useFakeTimers();
		const { store, data } = setup();
		await store.load();
		const bill = discarded(item('item00000000062', { title: 'Rechnung Strom' }), T1);
		const roof = discarded(item('item00000000063', { title: 'Dach' }), T0);
		data.listHandled.mockResolvedValueOnce({ items: [bill, roof], page: 1, hasMore: false });
		store.activate({ source: null, state: 'discarded' });
		await vi.advanceTimersByTimeAsync(0);

		// A reconciliation during the refresh asks no page.
		const answer = deferred<HandledItemPage>();
		data.listHandled.mockImplementationOnce(() => answer.promise);
		store.activate({ source: null, state: 'discarded', search: 'rechnung' });
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
		const calls = data.listHandled.mock.calls.length;
		await store.reconcile();
		expect(data.listHandled).toHaveBeenCalledTimes(calls);
		expect(ids(store.handled)).toEqual([bill.id, roof.id]);
		answer.resolve({ items: [bill], page: 1, hasMore: false });
		await vi.advanceTimersByTimeAsync(0);
		expect(ids(store.handled)).toEqual([bill.id]);

		// A reconciliation that started before a refresh merges none of its older pages.
		const page = deferred<HandledItemPage>();
		data.listHandled.mockImplementationOnce(() => page.promise);
		const running = store.reconcile();
		await vi.advanceTimersByTimeAsync(0);
		expect(data.listHandled).toHaveBeenLastCalledWith(
			'discarded',
			1,
			expect.objectContaining({ patterns: [loosePattern('rechnung')] })
		);
		const fresh = deferred<HandledItemPage>();
		data.listHandled.mockImplementationOnce(() => fresh.promise);
		store.activate({ source: null, state: 'discarded', search: 'dach' });
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
		page.resolve({ items: [bill, roof], page: 1, hasMore: false });
		await running;
		expect(ids(store.handled)).toEqual([bill.id]);
		fresh.resolve({ items: [roof], page: 1, hasMore: false });
		await vi.advanceTimersByTimeAsync(0);
		expect(ids(store.handled)).toEqual([roof.id]);
	});

	it('sends every chosen entry of "Verwerfen (n)" and "Wiederherstellen (n)" when the search changes meanwhile', async () => {
		vi.useFakeTimers();
		const { store, data } = setup({ newItems: [A, B, MILK] });
		await store.load();
		const chosen = (entries: readonly InboxItemSummary[]) =>
			entries.map(({ id, title }) => ({ id, title }));
		const first = deferred<InboxItemSummary>();
		data.discard.mockReturnValueOnce(first.promise);
		const run = store.discardMany(chosen([A, MILK, B]));
		// The search hides B meanwhile; the run keeps its choice.
		store.activate({ source: null, state: 'new', search: 'milch' });
		expect(ids(store.visible)).toEqual([MILK.id]);
		first.resolve(discarded(A, T2));
		await run;
		expect(data.discard.mock.calls).toEqual([[A.id], [MILK.id], [B.id]]);
		expect(store.bulkResult).toBeNull();

		const roof = discarded(item('item00000000064', { title: 'Dach' }), T1);
		const bill = discarded(item('item00000000065', { title: 'Rechnung' }), T0);
		data.listHandled.mockResolvedValueOnce({ items: [roof, bill], page: 1, hasMore: false });
		store.activate({ source: null, state: 'discarded' });
		await vi.advanceTimersByTimeAsync(0);
		const restored = deferred<InboxItemSummary>();
		data.restore.mockReturnValueOnce(restored.promise);
		const back = store.restoreMany(chosen([roof, bill]));
		// A search with other server words loads page 1 anew, without the second entry.
		data.listHandled.mockResolvedValueOnce({ items: [roof], page: 1, hasMore: false });
		store.activate({ source: null, state: 'discarded', search: 'dach' });
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
		expect(ids(store.handled)).toEqual([roof.id]);
		restored.resolve(item(roof.id, { updated: T2 }));
		await back;
		expect(data.restore.mock.calls).toEqual([[roof.id], [bill.id]]);
		expect(store.bulkResult).toBeNull();
	});
});
