// The outbox of the app and what it asks the server (OF-2, ADR-0074 addenda OF-2 and OF-2b): one
// instance for the whole tab, bound to the client of the app, so the error page and the hints of a
// reload see the same state as the layout that starts it. The capability `offline_ops` comes from
// the same question as "Neues Ticket" (GET /api/byl/tickets/create, ADR-0074 §7). Without it the
// outbox creates nothing in the browser: the identifier of the tab and the BroadcastChannel come
// with its first watch (OF-2b).

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
		tab: () => tabIdOf(sessionStorageOf()),
		channel: () => broadcastChannel(OUTBOX_CHANNEL),
		// Sent only with the account the client is signed in with now (another tab may have changed it).
		account: () => pb.authStore.record?.id ?? null,
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

/** An answer without `offline_ops` is asked again at most this often (OF-2b). */
export const SUPPORT_RETRY_MS = 5 * 60 * 1000;

let support: Promise<OfflineOps | null> | null = null;
/** When the last question went out that did not bring the capability; null once known or forgotten. */
let missingSince: number | null = null;

/**
 * Whether the server reports `offline_ops`, asked once per sign-in. An answer without it (before the
 * restart after OF-1) or a failed question is asked again on a later call, at most every 5 minutes
 * (OF-2b: the tab asks again when it becomes visible), so a restart of the server shows up without a
 * reload. Once known, the history asks for the mark of the outbox too.
 */
export function offlineSupport(): Promise<OfflineOps | null> {
	const now = Date.now();
	if (support !== null && (missingSince === null || now - missingSince < SUPPORT_RETRY_MS)) {
		return support;
	}
	missingSince = null;
	support = fetchCreateSupport(pb).then(
		(answer) => {
			const ops = answer?.offlineOps ?? null;
			const known = supportsKind(ops, 'ticket.update');
			askOfflineMarks(known);
			if (!known) missingSince = now;
			return ops;
		},
		() => {
			missingSince = now;
			return null;
		}
	);
	return support;
}

/** Forgets the answer (sign-out): the next account asks again at once. */
export function forgetOfflineSupport(): void {
	support = null;
	missingSince = null;
	askOfflineMarks(false);
}
