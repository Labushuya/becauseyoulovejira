// The outbox of the app and what it asks the server (OF-2, ADR-0074 addendum OF-2): one instance
// for the whole tab, bound to the client of the app, so the error page and the hints of a reload see
// the same state as the layout that starts it. The capability `offline_ops` comes from the same
// question as "Neues Ticket" (GET /api/byl/tickets/create, ADR-0074 §7).

import { provideMissingConnection } from '$lib/data/errors';
import { askOfflineMarks } from '$lib/data/history-marks';
import { fetchCreateSupport } from '$lib/data/ticket-create';
import { getTicket, updateTicket } from '$lib/data/tickets';
import { newOpId, parseAction, supportsKind, type OfflineOps } from '$lib/domain/offline';
import { observeRequests, pb } from '$lib/pocketbase';
import { getConnectivity } from './connectivity.svelte';
import { OUTBOX_CHANNEL, OutboxStore, broadcastChannel } from './outbox.svelte';
import { IdbOutboxStorage, hasOutboxDatabase } from './outbox-storage';

/** Key of the identifier of this tab in sessionStorage (concept §3.9). */
export const TAB_KEY = 'byl-outbox-tab';

function fill(bytes: Uint8Array<ArrayBuffer>): Uint8Array {
	return crypto.getRandomValues(bytes);
}

/** The identifier of this tab: kept in sessionStorage, new where that is blocked. */
export function tabIdOf(storage: Pick<Storage, 'getItem' | 'setItem'> | null): string {
	try {
		const known = storage?.getItem(TAB_KEY);
		if (typeof known === 'string' && known !== '') return known;
		const id = newOpId(fill);
		storage?.setItem(TAB_KEY, id);
		return id;
	} catch {
		return newOpId(fill);
	}
}

function sessionStorageOf(): Storage | null {
	try {
		return window.sessionStorage;
	} catch {
		return null;
	}
}

function indexedDbOf(): IDBFactory | undefined {
	try {
		return typeof indexedDB === 'undefined' ? undefined : indexedDB;
	} catch {
		return undefined;
	}
}

let shared: OutboxStore | undefined;

/** The outbox of the tab, created on first use; it does nothing until the layout starts it. */
export function getOutbox(): OutboxStore {
	if (shared !== undefined) return shared;
	const factory = indexedDbOf();
	const outbox = new OutboxStore({
		storage: factory === undefined ? null : new IdbOutboxStorage(factory),
		exists: () => hasOutboxDatabase(factory),
		connectivity: getConnectivity(),
		send: (action, fields, signal) =>
			updateTicket(
				pb,
				action.target,
				{ status: action.payload.status },
				{
					signal,
					outbox: fields,
					...(action.completion !== undefined && { completion: action.completion })
				}
			),
		get: (id) => getTicket(pb, id),
		tab: tabIdOf(sessionStorageOf()),
		channel: broadcastChannel(OUTBOX_CHANNEL),
		win: window,
		observe: (note) => observeRequests(note),
		watchRealtime: (check) => {
			pb.realtime.onDisconnect =
				check === null
					? undefined
					: (subscriptions) => {
							// Also called when the last subscription goes on purpose (logout): only a loss counts.
							if (subscriptions.length > 0) check();
						};
		}
	});
	provideMissingConnection(() => outbox.offline);
	shared = outbox;
	return outbox;
}

/**
 * How many kept changes wait on this device, of any account (the login page says so); 0 without
 * the storage, without opening or creating it where the browser cannot tell that it exists.
 */
export async function keptOnDevice(): Promise<number> {
	const factory = indexedDbOf();
	if (!(await hasOutboxDatabase(factory)) || factory === undefined) return 0;
	try {
		const entries = await new IdbOutboxStorage(factory).list();
		return entries.filter((entry) => parseAction(entry) !== null).length;
	} catch {
		return 0;
	}
}

let support: Promise<OfflineOps | null> | null = null;

/**
 * Whether the server reports `offline_ops`, asked once per sign-in. An answer without it (before the
 * restart after OF-1) or a failed question is asked again on the next call, so a restart of the
 * server shows up after the next reconnection without a reload. Once known, the history asks for
 * the mark of the outbox too.
 */
export function offlineSupport(): Promise<OfflineOps | null> {
	support ??= fetchCreateSupport(pb).then(
		(answer) => {
			const ops = answer?.offlineOps ?? null;
			const known = supportsKind(ops, 'ticket.update');
			askOfflineMarks(known);
			if (!known) support = null;
			return ops;
		},
		() => {
			support = null;
			return null;
		}
	);
	return support;
}

/** Forgets the answer (sign-out): the next account asks again. */
export function forgetOfflineSupport(): void {
	support = null;
	askOfflineMarks(false);
}
