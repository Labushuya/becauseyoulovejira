// Fakes of the view "Erledigte" (ER-1, ADR-0066) for the tests of its store, its components and
// its layout: done tickets, a data layer with pages and a total, and a live source whose events
// and reconnections the test sends.

import { vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { RequestOptions } from '$lib/data/options';
import type { CompletedFilter, CompletedTicketPage } from '$lib/data/tickets';
import type { TicketPatch, TicketSummary } from '$lib/domain/ticket';
import type { DoneListData } from '$lib/stores/done-list.svelte';
import type { LiveSource, RecordChange } from '$lib/stores/realtime';

/** Time of the answers of setDone and update. */
export const ANSWERED = '2026-10-07 12:00:00.000Z';

let sequence = 0;

/** A done ticket, completed at `completedAt`. */
export function doneTicket(
	completedAt: string,
	overrides: Partial<TicketSummary> = {}
): TicketSummary {
	sequence += 1;
	return {
		id: `d${String(sequence).padStart(14, '0')}`,
		key: `HAUS-${sequence}`,
		title: `Erledigt ${sequence}`,
		status: 'done',
		priority: 'medium',
		due: null,
		projectId: null,
		tagIds: [],
		project: null,
		tags: [],
		recurring: false,
		source: null,
		completedAt,
		created: '2026-09-01 10:00:00.000Z',
		updated: completedAt,
		...overrides
	};
}

/** Rejects with "aborted" once the signal of the request aborts. */
function abortable<T>(options: RequestOptions, value: Promise<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		options.signal?.addEventListener('abort', () => reject(new DataError('aborted')));
		value.then(resolve, reject);
	});
}

/**
 * A data layer with `pages` of done tickets; `total` is the number on all pages (default: the
 * tickets of the pages). setDone and update answer with the ticket in its new state.
 */
export function fakeDoneData(pages: TicketSummary[][] = [], total?: number) {
	const known = () => pages.flat();
	const data = {
		list: vi.fn((page: number, options: RequestOptions & { filter: CompletedFilter }) =>
			abortable<CompletedTicketPage>(
				options,
				Promise.resolve({
					items: pages[page - 1] ?? [],
					page,
					hasMore: page < pages.length,
					total: total ?? known().length
				})
			)
		),
		matches: vi.fn<DoneListData['matches']>(async () => true),
		count: vi.fn<DoneListData['count']>(async () => total ?? 0),
		setDone: vi.fn(async (id: string, isDone: boolean): Promise<TicketSummary> => {
			const current = known().find((ticket) => ticket.id === id);
			if (!current) throw new DataError('not_found');
			return {
				...current,
				status: isDone ? 'done' : 'open',
				completedAt: isDone ? ANSWERED : null,
				updated: ANSWERED
			};
		}),
		update: vi.fn(async (id: string, patch: TicketPatch): Promise<TicketSummary> => {
			const current = known().find((ticket) => ticket.id === id);
			if (!current) throw new DataError('not_found');
			return {
				...current,
				...(patch.status ? { status: patch.status } : {}),
				...(patch.detachSeries ? { recurring: false, recurrenceId: null } : {}),
				completedAt: patch.status === 'done' ? ANSWERED : null,
				updated: ANSWERED
			};
		})
	} satisfies DoneListData;
	return data;
}

/** A live source of tickets: `send` an event, `reconnect` after a gap. */
export function fakeDoneLive() {
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
