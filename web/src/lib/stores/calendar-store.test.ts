// Unit tests of the stores of the calendar (ADR-0053 §2 and §5): the done tickets of the shown period
// (only on demand, page by page up to the limit, aborted for another period, kept current by
// realtime, also while a period loads) and what this device remembers (view and layers, other tabs,
// blocked storage, narrow windows).

import { describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { RecordChange } from '$lib/data/realtime';
import type { DueRange, TicketChoicePage } from '$lib/data/tickets';
import {
	CALENDAR_LAYERS_STORAGE_KEY,
	CALENDAR_NARROW_QUERY,
	CALENDAR_VIEW_STORAGE_KEY
} from '$lib/domain/calendar';
import type { TicketSummary } from '$lib/domain/ticket';
import { CALENDAR_DONE_MAX_PAGES, CalendarDoneStore } from './calendar.svelte';
import { CalendarPrefsStore } from './calendar-prefs.svelte';
import type { LiveSource } from './realtime';

const T0 = '2026-09-24 08:00:00.000Z';
const T1 = '2026-09-25 08:00:00.000Z';
const OCTOBER: DueRange = { from: '2026-09-28', to: '2026-11-01' };

let sequence = 0;

function ticket(due: string | null, overrides: Partial<TicketSummary> = {}): TicketSummary {
	sequence += 1;
	return {
		id: `t${String(sequence).padStart(14, '0')}`,
		key: `HAUS-${sequence}`,
		title: 'Ticket',
		status: 'done',
		priority: 'medium',
		due,
		projectId: null,
		tagIds: [],
		project: null,
		tags: [],
		recurring: false,
		source: null,
		completedAt: T0,
		created: T0,
		updated: T0,
		...overrides
	};
}

function session() {
	return { ensureValid: vi.fn(() => true), logout: vi.fn() };
}

/** A live source whose ticket events the test sends. */
function fakeLive() {
	let onTicket: ((change: RecordChange<TicketSummary>) => void) | null = null;
	let onReconnect: (() => void) | null = null;
	const live = {
		tickets: vi.fn(async (callback: (change: RecordChange<TicketSummary>) => void) => {
			onTicket = callback;
			return async () => undefined;
		}),
		reconnected: vi.fn(async (callback: () => void) => {
			onReconnect = callback;
			return async () => undefined;
		})
	} as unknown as LiveSource;
	return {
		live,
		send: (change: RecordChange<TicketSummary>) => onTicket?.(change),
		reconnect: () => onReconnect?.()
	};
}

describe('done tickets of the calendar', () => {
	it('loads nothing while hidden and the period once shown', async () => {
		const done = ticket('2026-10-05');
		const listDone = vi.fn(async (): Promise<TicketChoicePage> => ({
			items: [done],
			hasMore: false
		}));
		const store = new CalendarDoneStore({ listDone }, session());
		expect(store.state).toBe('idle');

		store.follow(OCTOBER);
		await vi.waitFor(() => expect(store.state).toBe('ready'));
		expect(listDone).toHaveBeenCalledExactlyOnceWith(OCTOBER, 1, expect.anything());
		expect(store.done).toEqual([done]);
		expect(store.complete).toBe(true);
		store.follow({ ...OCTOBER });
		expect(listDone).toHaveBeenCalledTimes(1);
		store.follow(null);
		expect(store.done).toEqual([]);
		expect(store.state).toBe('idle');
	});

	it(`loads page by page up to ${CALENDAR_DONE_MAX_PAGES} pages and says when there were more`, async () => {
		const listDone = vi.fn(async (_range: DueRange, page: number): Promise<TicketChoicePage> => ({
			items: [ticket('2026-10-05', { title: `Seite ${page}` })],
			hasMore: true
		}));
		const store = new CalendarDoneStore({ listDone }, session());

		store.follow(OCTOBER);
		await vi.waitFor(() => expect(store.state).toBe('ready'));
		expect(listDone).toHaveBeenCalledTimes(CALENDAR_DONE_MAX_PAGES);
		expect(store.done).toHaveLength(CALENDAR_DONE_MAX_PAGES);
		expect(store.complete).toBe(false);
	});

	it('aborts the request of a period left before its answer', async () => {
		const signals: AbortSignal[] = [];
		const listDone = vi.fn(
			(_range: DueRange, _page: number, { signal }: { signal?: AbortSignal }) =>
				new Promise<TicketChoicePage>((resolve) => {
					if (signal) signals.push(signal);
					setTimeout(() => resolve({ items: [], hasMore: false }), 5);
				})
		);
		const store = new CalendarDoneStore({ listDone }, session());

		store.follow(OCTOBER);
		store.follow({ from: '2026-10-26', to: '2026-11-29' });
		expect(signals[0]?.aborted).toBe(true);
		await vi.waitFor(() => expect(store.state).toBe('ready'));
		expect(listDone).toHaveBeenLastCalledWith(
			{ from: '2026-10-26', to: '2026-11-29' },
			1,
			expect.anything()
		);
	});

	it('shows a failure, ends the session on its loss and loads again on request', async () => {
		const listDone = vi
			.fn<(range: DueRange, page: number) => Promise<TicketChoicePage>>()
			.mockRejectedValueOnce(new DataError('network'))
			.mockResolvedValueOnce({ items: [], hasMore: false })
			.mockRejectedValueOnce(new DataError('session'));
		const guard = session();
		const store = new CalendarDoneStore({ listDone }, guard);

		store.follow(OCTOBER);
		await vi.waitFor(() => expect(store.state).toBe('error'));
		expect(store.error).toBeTruthy();
		await store.reload();
		expect(store.state).toBe('ready');
		await store.reload();
		expect(guard.logout).toHaveBeenCalledOnce();
	});

	it('follows realtime: completed, reopened, moved away and deleted tickets', async () => {
		const listDone = vi.fn(async (): Promise<TicketChoicePage> => ({ items: [], hasMore: false }));
		const store = new CalendarDoneStore({ listDone }, session());
		const { live, send, reconnect } = fakeLive();
		const stop = store.connect(live);
		store.follow(OCTOBER);
		await vi.waitFor(() => expect(store.state).toBe('ready'));
		await vi.waitFor(() => expect(live.tickets).toHaveBeenCalled());

		const done = ticket('2026-10-05');
		send({ action: 'update', record: done });
		expect(store.done).toEqual([done]);
		// An older answer does not overwrite a newer one.
		const older = '2026-09-01 08:00:00.000Z';
		send({ action: 'update', record: { ...done, title: 'Alt', updated: older } });
		expect(store.done[0]?.title).toBe('Ticket');
		send({ action: 'update', record: { ...done, status: 'open', updated: T1 } });
		expect(store.done).toEqual([]);
		const later = '2026-09-26 08:00:00.000Z';
		send({ action: 'update', record: { ...done, due: '2026-12-24', updated: later } });
		expect(store.done).toEqual([]);
		const other = ticket('2026-10-06');
		send({ action: 'create', record: other });
		send({ action: 'delete', id: other.id });
		expect(store.done).toEqual([]);
		reconnect();
		await vi.waitFor(() => expect(listDone).toHaveBeenCalledTimes(2));
		stop();
		expect(store.state).toBe('idle');
	});

	it('keeps an event that arrives while the period loads', async () => {
		let release: (page: TicketChoicePage) => void = () => undefined;
		const listDone = vi.fn(() => new Promise<TicketChoicePage>((resolve) => (release = resolve)));
		const store = new CalendarDoneStore({ listDone }, session());
		store.follow(OCTOBER);
		await vi.waitFor(() => expect(listDone).toHaveBeenCalled());

		const fresh = ticket('2026-10-08');
		const gone = ticket('2026-10-09');
		store.upsert(fresh);
		store.remove(gone.id);
		release({ items: [gone], hasMore: false });
		await vi.waitFor(() => expect(store.state).toBe('ready'));
		expect(store.done).toEqual([fresh]);
	});
});

/** A window with localStorage, matchMedia and storage events, as far as the store uses them. */
function fakeWindow(narrow = false, storage: Partial<Storage> = localStorage) {
	const listeners = new Set<(event: StorageEvent) => void>();
	const media = new Set<() => void>();
	const query = {
		matches: narrow,
		addEventListener: (_type: string, listener: () => void) => media.add(listener),
		removeEventListener: (_type: string, listener: () => void) => media.delete(listener)
	};
	const win = {
		localStorage: storage,
		matchMedia: vi.fn((text: string) => {
			expect(text).toBe(CALENDAR_NARROW_QUERY);
			return query;
		}),
		addEventListener: (_type: string, listener: (event: StorageEvent) => void) =>
			listeners.add(listener),
		removeEventListener: (_type: string, listener: (event: StorageEvent) => void) =>
			listeners.delete(listener)
	} as unknown as Window;
	return {
		win,
		storageEvent: (key: string | null, newValue: string | null) => {
			for (const listener of listeners) listener({ key, newValue } as StorageEvent);
		},
		resize: (matches: boolean) => {
			query.matches = matches;
			for (const listener of media) listener();
		}
	};
}

describe('what this device remembers of the calendar', () => {
	it('remembers the view and the layers, and only layers other than the default', () => {
		localStorage.clear();
		const store = new CalendarPrefsStore(fakeWindow().win);
		expect(store.view).toBeNull();
		expect([...store.layers]).toEqual(['open', 'planned', 'inbox']);

		store.chooseView('agenda');
		expect(localStorage.getItem(CALENDAR_VIEW_STORAGE_KEY)).toBe('agenda');
		store.setLayer('done', true);
		const stored = localStorage.getItem(CALENDAR_LAYERS_STORAGE_KEY);
		expect(stored).toBe('offen,erledigt,geplant,eingang');
		store.setLayer('done', false);
		expect(localStorage.getItem(CALENDAR_LAYERS_STORAGE_KEY)).toBeNull();
		expect(new CalendarPrefsStore(fakeWindow().win).view).toBe('agenda');
	});

	it('follows other tabs and the width of the window', () => {
		localStorage.clear();
		const { win, storageEvent, resize } = fakeWindow(true);
		const store = new CalendarPrefsStore(win);
		const stop = store.connect();
		expect(store.narrow).toBe(true);

		storageEvent(CALENDAR_VIEW_STORAGE_KEY, 'woche');
		expect(store.view).toBe('week');
		storageEvent(CALENDAR_LAYERS_STORAGE_KEY, 'erledigt');
		expect([...store.layers]).toEqual(['done']);
		storageEvent(null, null);
		expect(store.view).toBeNull();
		expect([...store.layers]).toEqual(['open', 'planned', 'inbox']);
		resize(false);
		expect(store.narrow).toBe(false);
		stop();
	});

	it('keeps a choice for this page when the storage is blocked', () => {
		const blocked = {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('blocked');
			},
			removeItem: () => {
				throw new Error('blocked');
			}
		};
		const store = new CalendarPrefsStore(fakeWindow(false, blocked).win);
		expect(store.view).toBeNull();
		store.chooseView('week');
		store.setLayer('inbox', false);
		expect(store.view).toBe('week');
		expect(store.layers.has('inbox')).toBe(false);
		expect(new CalendarPrefsStore(null).narrow).toBe(false);
	});
});
