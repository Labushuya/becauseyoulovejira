// Realtime for the stores (ADR-0007 sections 2 to 4; E3 plan, T-16): the subscriptions the
// stores need, as an interface they can be tested with (fake) and bound to the app client
// (`liveSource`). `hold` turns the asynchronous subscription into a synchronous stop for
// cleanups and tries a failed subscription again (ADR-0011 E6, E2 plan §8).

import type PocketBase from 'pocketbase';
import {
	onReconnect,
	subscribeComments,
	subscribeHistory,
	subscribeInboxItems,
	subscribeProjects,
	subscribeReads,
	subscribeTags,
	subscribeTicket,
	subscribeTickets,
	type ReadChange,
	type RecordChange,
	type Unsubscribe
} from '$lib/data/realtime';
import { currentUserId } from '$lib/data/options';
import type { InboxItemSummary } from '$lib/domain/inbox';
import type { Project } from '$lib/domain/project';
import type { Tag } from '$lib/domain/tag';
import type { Comment, HistoryEntry, Ticket, TicketSummary } from '$lib/domain/ticket';
import { liveHealth, type LiveHealth } from './live-health.svelte';

export type { ReadChange, RecordChange, Unsubscribe };

export interface LiveSource {
	/** All visible tickets (list fields). */
	tickets(onChange: (change: RecordChange<TicketSummary>) => void): Promise<Unsubscribe>;
	/** One ticket with its description (detail panel). */
	ticket(id: string, onChange: (change: RecordChange<Ticket>) => void): Promise<Unsubscribe>;
	comments(
		ticketId: string,
		onChange: (change: RecordChange<Comment>) => void
	): Promise<Unsubscribe>;
	history(
		ticketId: string,
		onChange: (change: RecordChange<HistoryEntry>) => void
	): Promise<Unsubscribe>;
	/** All visible projects, archived ones included (catalog, E3 plan T-16). */
	projects(onChange: (change: RecordChange<Project>) => void): Promise<Unsubscribe>;
	/** All visible tags (catalog). */
	tags(onChange: (change: RecordChange<Tag>) => void): Promise<Unsubscribe>;
	/** All visible inbox entries (E4 plan, T-4). */
	inbox(onChange: (change: RecordChange<InboxItemSummary>) => void): Promise<Unsubscribe>;
	/** Own read rows and the own base line of the "new" mark (ADR-0015 section 6). */
	reads(onChange: (change: ReadChange) => void): Promise<Unsubscribe>;
	/** Called after a new connection that follows an interrupted one. */
	reconnected(callback: () => void): Promise<Unsubscribe>;
}

export function liveSource(pb: PocketBase): LiveSource {
	return {
		tickets: (onChange) => subscribeTickets(pb, onChange),
		ticket: (id, onChange) => subscribeTicket(pb, id, onChange),
		comments: (ticketId, onChange) => subscribeComments(pb, ticketId, onChange),
		history: (ticketId, onChange) => subscribeHistory(pb, ticketId, onChange),
		projects: (onChange) => subscribeProjects(pb, onChange),
		tags: (onChange) => subscribeTags(pb, onChange),
		inbox: (onChange) => subscribeInboxItems(pb, onChange),
		reads: (onChange) => {
			const userId = currentUserId(pb.authStore.record);
			if (userId === null) return Promise.reject(new Error('No signed-in user'));
			return subscribeReads(pb, userId, onChange);
		},
		reconnected: (callback) => onReconnect(pb, callback)
	};
}

/** Waits before the first attempts of a failed subscription again, in ms. */
export const RETRY_DELAYS_MS: readonly number[] = [1_000, 2_000, 5_000, 10_000];
/** Wait before every later attempt, in ms. */
export const RETRY_MAX_MS = 30_000;

/** Lets a callback of one attempt through only while that attempt is the current one. */
export type Guard = <A extends unknown[]>(callback: (...args: A) => void) => (...args: A) => void;

export interface HoldOptions {
	/**
	 * Called once a subscription is set up after failed attempts: events of the gap are lost, so
	 * the owner loads again (like after a reconnection, ADR-0007 section 3).
	 */
	recovered?: () => void;
	/** Counts the failed subscriptions for the hint of the layout; tests pass their own. */
	health?: LiveHealth;
}

/**
 * Holds a subscription that is still being set up. The returned stop works at once: if the
 * subscription is not ready yet, it ends as soon as it is.
 *
 * A failed subscription (server not reachable while the page loads; the SDK itself reconnects
 * only an established connection) is tried again after `RETRY_DELAYS_MS`, then every
 * `RETRY_MAX_MS`, as long as the stop
 * has not been called; meanwhile `health` reports it for the hint. `start` gets a guard for its
 * callbacks: the SDK keeps the listener of a failed attempt and would call it once a later
 * connection stands, so only the callbacks of the current attempt act, and none after the stop.
 * A failure while unsubscribing changes nothing for the caller and is ignored.
 */
export function hold(
	start: (guard: Guard) => Promise<Unsubscribe>,
	{ recovered, health = liveHealth }: HoldOptions = {}
): () => void {
	let stopped = false;
	let attempt = 0;
	let failures = 0;
	let unsubscribe: Unsubscribe | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;

	function run(): void {
		attempt += 1;
		const current = attempt;
		const guard: Guard =
			(callback) =>
			(...args) => {
				if (!stopped && attempt === current) callback(...args);
			};
		let pending: Promise<Unsubscribe>;
		try {
			pending = start(guard);
		} catch (error) {
			pending = Promise.reject(error);
		}
		pending.then(
			(stop) => {
				if (stopped) {
					void stop().catch(() => undefined);
					return;
				}
				unsubscribe = stop;
				if (failures === 0) return;
				failures = 0;
				health.resume();
				recovered?.();
			},
			() => {
				if (stopped) return;
				if (failures === 0) health.interrupt();
				const delay = RETRY_DELAYS_MS[failures] ?? RETRY_MAX_MS;
				failures += 1;
				timer = setTimeout(run, delay);
			}
		);
	}

	run();
	return () => {
		if (stopped) return;
		stopped = true;
		clearTimeout(timer);
		if (failures > 0) health.resume();
		void unsubscribe?.().catch(() => undefined);
		unsubscribe = null;
	};
}
