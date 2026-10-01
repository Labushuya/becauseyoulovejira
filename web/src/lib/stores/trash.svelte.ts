// Trash for tickets (ADR-0037, plan PB-2): the tickets in the trash of the signed-in account, the
// retention, and the actions of the view (restore, delete for good, empty) one by one or for the
// chosen rows, at most TRASH_CONCURRENCY at a time. Also "Rückgängig" after deleting in the panel:
// it restores with expected_updated, so a ticket changed since is never overwritten. The server
// reports changes of the trash on byl/trash; the store then reads the list again.

import type PocketBase from 'pocketbase';
import { createContext } from 'svelte';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { toDataError, type DataError } from '$lib/data/errors';
import type { Unsubscribe } from '$lib/data/realtime';
import { onReconnect } from '$lib/data/realtime';
import type { TrashMove } from '$lib/data/tickets';
import {
	emptyTrash,
	getTrashPreview,
	listTrash,
	purgeFromTrash,
	resolveTrash,
	restoreFromTrash,
	saveTrashRetention,
	subscribeTrash
} from '$lib/data/trash';
import {
	DEFAULT_RETENTION,
	RETENTION_LABELS,
	TRASH_CODES,
	blockedReason,
	restoreNotes,
	type EmptyResult,
	type RestoreNeed,
	type RestoreOptions,
	type RestoreResult,
	type TrashItem,
	type TrashPreview,
	type TrashRetention
} from '$lib/domain/trash';
import { resolvedText, type ResolveAction } from '$lib/domain/trash-dependencies';
import { SILENT_FLAGS, type FlagSink } from './flags.svelte';
import { hold } from './realtime';
import type { SessionGuard } from './ticket-list.svelte';

/** Requests of a bulk action at the same time, as for the tickets (ADR-0036 §3). */
export const TRASH_CONCURRENCY = 4;

/** Data access of the store; tests pass a fake, the app binds the data layer. */
export interface TrashData {
	list(signal?: AbortSignal): Promise<{ items: TrashItem[]; retention: TrashRetention }>;
	preview(id: string, signal?: AbortSignal): Promise<TrashPreview>;
	restore(id: string, options: RestoreOptions): Promise<RestoreResult>;
	/** The decisions of the decision help (ADR-0047); the preview afterwards. */
	resolve(id: string, actions: readonly ResolveAction[]): Promise<TrashPreview>;
	purge(id: string): Promise<void>;
	purgeAll(): Promise<EmptyResult>;
	saveRetention(retention: TrashRetention): Promise<TrashRetention>;
}

/** Changes of the trash from the server and reconnections (ADR-0007 section 3). */
export interface TrashLive {
	changes(onChange: () => void): Promise<Unsubscribe>;
	reconnected(callback: () => void): Promise<Unsubscribe>;
}

export function trashData(pb: PocketBase, userId: () => string | null): TrashData {
	return {
		list: (signal) => listTrash(pb, { signal }),
		preview: (id, signal) => getTrashPreview(pb, id, { signal }),
		restore: (id, options) => restoreFromTrash(pb, id, options),
		resolve: (id, actions) => resolveTrash(pb, id, actions),
		purge: (id) => purgeFromTrash(pb, id),
		purgeAll: () => emptyTrash(pb),
		saveRetention: (retention) => {
			const id = userId();
			if (id === null) return Promise.reject(new Error('No signed-in user'));
			return saveTrashRetention(pb, id, retention);
		}
	};
}

export function trashLive(pb: PocketBase): TrashLive {
	return {
		changes: (onChange) => subscribeTrash(pb, onChange),
		reconnected: (callback) => onReconnect(pb, callback)
	};
}

export type TrashState = 'idle' | 'loading' | 'ready' | 'error' | 'unavailable';

/** A ticket a bulk action could not handle, with the reason. */
export interface TrashProblem {
	id: string;
	key: string;
	reason: string;
}

/** Result of the last action of the view, shown above the table until the next one. */
export interface TrashResult {
	/** Notes of restores worth knowing (new key, sources left in the inbox, …). */
	notes: readonly string[];
	failures: readonly TrashProblem[];
}

export interface TrashProgress {
	label: string;
	total: number;
	done: number;
}

/** What a restore needs, from its refusal; null for any other failure. */
export function needOf(error: DataError): RestoreNeed | null {
	const project = error.fields.project;
	if (project?.code === TRASH_CODES.projectRequired) {
		const params = project.params ?? {};
		return {
			kind: 'project',
			code: typeof params.code === 'string' ? params.code : '',
			reason: params.reason === 'changed' ? 'changed' : 'missing'
		};
	}
	const series = error.fields.recurrence;
	if (series?.code === TRASH_CODES.seriesConflict) {
		const params = series.params ?? {};
		return {
			kind: 'series',
			key: typeof params.key === 'string' ? params.key : '',
			ticketId: typeof params.ticket === 'string' ? params.ticket : ''
		};
	}
	return null;
}

/** Why a request failed, in words; null if nothing is to be shown (aborted, session). */
function reasonOf(error: DataError): string | null {
	if (error.kind === 'aborted' || error.kind === 'session') return null;
	if (error.kind === 'not_found') return 'Nicht mehr im Papierkorb.';
	const blocked = error.fields.id;
	if (blocked?.code === TRASH_CODES.blocked) {
		const count = blocked.params?.count;
		return blockedReason(typeof count === 'number' ? count : 1);
	}
	const field = Object.values(error.fields)[0];
	return field?.message ?? error.message;
}

/** Runs `work` over `items` with at most `limit` at a time. */
async function inPool<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>) {
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const item = items[next];
			next += 1;
			if (item !== undefined) await work(item);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

function tickets(count: number): string {
	return count === 1 ? '1 Ticket' : `${count} Tickets`;
}

export class TrashStore {
	readonly #data: TrashData;
	readonly #session: SessionGuard;
	readonly #flags: FlagSink;

	#state = $state<TrashState>('idle');
	#error = $state<string | null>(null);
	#items = $state.raw<readonly TrashItem[]>([]);
	#retention = $state<TrashRetention>(DEFAULT_RETENTION);
	#progress = $state<TrashProgress | null>(null);
	#result = $state<TrashResult | null>(null);
	readonly #needs = new SvelteMap<string, RestoreNeed>();
	/** Choices already made for a restore (target project, leaving the series), kept for the next. */
	readonly #choices = new SvelteMap<string, RestoreOptions>();
	readonly #busy = new SvelteSet<string>();
	#controller: AbortController | null = null;
	#reloadAgain = false;

	constructor(data: TrashData, session: SessionGuard, flags: FlagSink = SILENT_FLAGS) {
		this.#data = data;
		this.#session = session;
		this.#flags = flags;
	}

	get state(): TrashState {
		return this.#state;
	}

	/** Loading error in words, while `state` is "error". */
	get error(): string | null {
		return this.#error;
	}

	/** Tickets of the trash (first of each group), newest first. */
	get items(): readonly TrashItem[] {
		return this.#items;
	}

	/** Number for the navigation; null while not loaded. */
	get count(): number | null {
		return this.#state === 'ready' ? this.#items.length : null;
	}

	get retention(): TrashRetention {
		return this.#retention;
	}

	get progress(): TrashProgress | null {
		return this.#progress;
	}

	get result(): TrashResult | null {
		return this.#result;
	}

	dismissResult(): void {
		this.#result = null;
	}

	/** What the restore of a ticket needs (target project or leaving the series), if anything. */
	needOf(id: string): RestoreNeed | null {
		return this.#needs.get(id) ?? null;
	}

	/** Drops the inline question of a ticket ("Abbrechen") and the choices made so far. */
	dismissNeed(id: string): void {
		this.#needs.delete(id);
		this.#choices.delete(id);
	}

	/** Whether an action on the ticket runs. */
	isBusy(id: string): boolean {
		return this.#busy.has(id) || this.#progress !== null;
	}

	find(id: string): TrashItem | null {
		return this.#items.find((item) => item.id === id) ?? null;
	}

	/** Loads the trash once per session; the cleanup empties the store. */
	start(): () => void {
		void this.reload();
		return () => {
			this.#controller?.abort();
			this.#controller = null;
			this.#items = [];
			this.#needs.clear();
			this.#state = 'idle';
		};
	}

	/**
	 * Reads the trash again after every change the server reports, after a reconnection and after
	 * a subscription that came only after failed attempts.
	 */
	connect(live: TrashLive): () => void {
		const reload = () => void this.reload();
		const stops = [
			hold((guard) => live.changes(guard(reload)), { recovered: reload }),
			hold((guard) => live.reconnected(guard(reload)), { recovered: reload })
		];
		return () => {
			for (const stop of stops) stop();
		};
	}

	/**
	 * Loads the list. Before the migration of the trash the server answers 503: the view then says
	 * that the trash comes with the next start. A second call while one runs loads once more after
	 * it, so no change is lost.
	 */
	async reload(): Promise<void> {
		if (this.#controller !== null) {
			this.#reloadAgain = true;
			return;
		}
		if (!this.#session.ensureValid()) return;
		const controller = new AbortController();
		this.#controller = controller;
		if (this.#state !== 'ready') this.#state = 'loading';
		try {
			const { items, retention } = await this.#data.list(controller.signal);
			this.#items = items;
			this.#retention = retention;
			for (const id of [...this.#needs.keys()]) {
				if (!items.some((item) => item.id === id)) this.#needs.delete(id);
			}
			this.#state = 'ready';
			this.#error = null;
		} catch (error) {
			const failure = toDataError(error);
			if (failure.kind === 'aborted') return;
			if (failure.kind === 'session') {
				this.#session.logout();
				return;
			}
			this.#state = failure.status === 503 ? 'unavailable' : 'error';
			this.#error = failure.message;
		} finally {
			if (this.#controller === controller) this.#controller = null;
			if (this.#reloadAgain) {
				this.#reloadAgain = false;
				void this.reload();
			}
		}
	}

	/** Read-only preview of a ticket in the trash; null if it is not there (any more). */
	async preview(id: string, signal?: AbortSignal): Promise<TrashPreview | null> {
		if (!this.#session.ensureValid()) return null;
		try {
			return await this.#data.preview(id, signal);
		} catch (error) {
			const failure = toDataError(error, signal);
			if (failure.kind === 'session') this.#session.logout();
			if (
				failure.kind === 'not_found' ||
				failure.kind === 'aborted' ||
				failure.kind === 'session'
			) {
				return null;
			}
			throw failure;
		}
	}

	#remove(ids: readonly string[]): void {
		this.#items = this.#items.filter((item) => !ids.includes(item.id));
		for (const id of ids) {
			this.#needs.delete(id);
			this.#choices.delete(id);
		}
	}

	/**
	 * Restores one ticket with its group. A refusal that needs a choice (target project, leaving
	 * the series) becomes the inline question of the row; the choices made so far go along with the
	 * next try. Any other failure is an error flag. Returns the result, or null.
	 */
	async restore(id: string, options: RestoreOptions = {}): Promise<RestoreResult | null> {
		if (this.#busy.has(id) || this.#progress !== null || !this.#session.ensureValid()) return null;
		this.#busy.add(id);
		const key = this.find(id)?.key ?? '';
		const choices = { ...this.#choices.get(id), ...options };
		this.#choices.set(id, choices);
		try {
			const result = await this.#data.restore(id, choices);
			this.#remove([id]);
			const notes = restoreNotes(result);
			this.#result = notes.length > 0 ? { notes, failures: [] } : null;
			this.#flags.show({
				tone: 'success',
				title: `${result.key} wiederhergestellt.`,
				...(notes.length > 0 && { description: notes.join(' ') })
			});
			return result;
		} catch (error) {
			const failure = toDataError(error);
			if (failure.kind === 'session') this.#session.logout();
			const need = failure.kind === 'validation' ? needOf(failure) : null;
			if (need !== null) {
				this.#needs.set(id, need);
				return null;
			}
			const reason = reasonOf(failure);
			if (reason !== null) {
				this.#flags.show({
					tone: 'error',
					title: `${key || 'Das Ticket'} wurde nicht wiederhergestellt. ${reason}`
				});
			}
			if (failure.kind === 'not_found') this.#remove([id]);
			return null;
		} finally {
			this.#busy.delete(id);
		}
	}

	/**
	 * The decisions of the decision help for the dependencies of a ticket (ADR-0047), in one
	 * request: done, back to the inbox, discarded, to another ticket. Returns the preview
	 * afterwards or the reason of a refusal: an error flag shows it, except for a move, whose
	 * dialog ("Anderem Ticket zuordnen …") shows it itself.
	 */
	async resolve(
		id: string,
		actions: readonly ResolveAction[]
	): Promise<{ ok: true; value: TrashPreview } | { ok: false; message: string | null }> {
		if (this.#busy.has(id) || this.#progress !== null || !this.#session.ensureValid()) {
			return { ok: false, message: null };
		}
		this.#busy.add(id);
		const key = this.find(id)?.key ?? '';
		try {
			const preview = await this.#data.resolve(id, actions);
			this.#items = this.#items.map((item) =>
				item.id === id
					? {
							...item,
							status: preview.status,
							updated: preview.updated,
							dependencies: preview.dependencyList.length
						}
					: item
			);
			this.#flags.show({ tone: 'success', title: resolvedText(actions, preview.key) });
			return { ok: true, value: preview };
		} catch (error) {
			const failure = toDataError(error);
			if (failure.kind === 'session') this.#session.logout();
			const reason = reasonOf(failure);
			if (reason !== null && !actions.some((action) => action.action === 'move')) {
				this.#flags.show({
					tone: 'error',
					title: `Die Entscheidung für ${key || 'das Ticket'} wurde nicht übernommen. ${reason}`
				});
			}
			if (failure.kind === 'not_found') this.#remove([id]);
			return { ok: false, message: reason };
		} finally {
			this.#busy.delete(id);
		}
	}

	/** "Endgültig löschen" of one ticket with its group; the caller asked before. */
	async purge(id: string): Promise<boolean> {
		if (this.#busy.has(id) || this.#progress !== null || !this.#session.ensureValid()) return false;
		this.#busy.add(id);
		const key = this.find(id)?.key ?? '';
		try {
			await this.#data.purge(id);
			this.#remove([id]);
			this.#flags.show({ tone: 'success', title: `${key} endgültig gelöscht.` });
			return true;
		} catch (error) {
			const failure = toDataError(error);
			if (failure.kind === 'session') this.#session.logout();
			if (failure.kind === 'not_found') {
				this.#remove([id]);
				return true;
			}
			const reason = reasonOf(failure);
			if (reason !== null) {
				this.#flags.show({ tone: 'error', title: `${key} wurde nicht gelöscht. ${reason}` });
			}
			return false;
		} finally {
			this.#busy.delete(id);
		}
	}

	/**
	 * "Wiederherstellen" or "Endgültig löschen" of the chosen tickets, one request each. Tickets
	 * whose restore needs a choice get their inline question; failures stand in the result.
	 */
	async runMany(kind: 'restore' | 'purge', ids: readonly string[]): Promise<void> {
		if (this.#progress !== null || ids.length === 0 || !this.#session.ensureValid()) return;
		const chosen = ids
			.map((id) => this.find(id))
			.filter((item): item is TrashItem => item !== null);
		if (chosen.length === 0) return;
		this.#result = null;
		this.#progress = {
			label: kind === 'restore' ? 'Wiederherstellen' : 'Endgültig löschen',
			total: chosen.length,
			done: 0
		};
		const failures: TrashProblem[] = [];
		const notes: string[] = [];
		const done: string[] = [];
		let asked = 0;
		let stopped = false;
		try {
			await inPool(chosen, TRASH_CONCURRENCY, async (item) => {
				try {
					if (stopped) return;
					if (kind === 'restore') {
						const result = await this.#data.restore(item.id, {});
						notes.push(...restoreNotes(result));
					} else {
						await this.#data.purge(item.id);
					}
					done.push(item.id);
				} catch (error) {
					const failure = toDataError(error);
					if (failure.kind === 'session') {
						if (!stopped) this.#session.logout();
						stopped = true;
						return;
					}
					const need = kind === 'restore' && failure.kind === 'validation' ? needOf(failure) : null;
					if (need !== null) {
						this.#needs.set(item.id, need);
						asked += 1;
						return;
					}
					if (failure.kind === 'not_found') {
						done.push(item.id);
						return;
					}
					const reason = reasonOf(failure);
					if (reason !== null) failures.push({ id: item.id, key: item.key, reason });
				} finally {
					if (this.#progress !== null) {
						this.#progress = { ...this.#progress, done: this.#progress.done + 1 };
					}
				}
			});
		} finally {
			this.#progress = null;
		}
		if (stopped) return;
		this.#remove(done);
		this.#result = notes.length > 0 || failures.length > 0 ? { notes, failures } : null;
		const verb = kind === 'restore' ? 'wiederhergestellt' : 'endgültig gelöscht';
		if (done.length === 0 && failures.length > 0) {
			this.#flags.show({
				tone: 'error',
				title: `Keines der ${tickets(chosen.length)} wurde ${verb}.`,
				description: 'Die Gründe stehen über der Tabelle.'
			});
			return;
		}
		const open =
			asked > 0
				? ` ${asked === 1 ? '1 Ticket braucht' : `${asked} Tickets brauchen`} noch eine Entscheidung.`
				: '';
		this.#flags.show({ tone: 'success', title: `${tickets(done.length)} ${verb}.${open}` });
	}

	/** Tickets of the trash that wait for a decision (ADR-0047). */
	get blockedCount(): number {
		return this.#items.filter((item) => item.dependencies > 0).length;
	}

	/**
	 * "Papierkorb leeren"; the caller asked before. Blocked tickets stay (ADR-0047); the flag
	 * names them.
	 */
	async purgeAll(): Promise<boolean> {
		if (this.#progress !== null || !this.#session.ensureValid()) return false;
		this.#progress = { label: 'Papierkorb leeren', total: 1, done: 0 };
		try {
			const { purged, blocked } = await this.#data.purgeAll();
			const stay = blocked.map((entry) => entry.id);
			this.#items = this.#items.filter((item) => stay.includes(item.id));
			this.#needs.clear();
			this.#result = null;
			const kept =
				blocked.length === 0
					? undefined
					: `${blocked.length === 1 ? '1 blockiertes Ticket bleibt' : `${blocked.length} blockierte Tickets bleiben`}: ${blocked.map((entry) => entry.key).join(', ')}. Bitte in der Vorschau entscheiden.`;
			this.#flags.show(
				purged === 0 && kept !== undefined
					? { tone: 'info', title: 'Nichts gelöscht.', description: kept }
					: {
							tone: 'success',
							title: `Papierkorb geleert (${tickets(purged)}).`,
							...(kept !== undefined && { description: kept })
						}
			);
			return true;
		} catch (error) {
			const failure = toDataError(error);
			if (failure.kind === 'session') this.#session.logout();
			const reason = reasonOf(failure);
			if (reason !== null) {
				this.#flags.show({ tone: 'error', title: `Der Papierkorb wurde nicht geleert. ${reason}` });
			}
			void this.reload();
			return false;
		} finally {
			this.#progress = null;
		}
	}

	/** Saves the retention of the account ("Einstellungen → Darstellung"). */
	async setRetention(retention: TrashRetention): Promise<boolean> {
		if (!this.#session.ensureValid()) return false;
		const previous = this.#retention;
		this.#retention = retention;
		try {
			this.#retention = await this.#data.saveRetention(retention);
			this.#flags.show({
				tone: 'success',
				title: `Papierkorb: ${RETENTION_LABELS[this.#retention]} gespeichert.`
			});
			void this.reload();
			return true;
		} catch (error) {
			this.#retention = previous;
			const failure = toDataError(error);
			if (failure.kind === 'session') this.#session.logout();
			const reason = reasonOf(failure);
			if (reason !== null) {
				this.#flags.show({
					tone: 'error',
					title: `Die Aufbewahrung wurde nicht gespeichert. ${reason}`
				});
			}
			return false;
		}
	}

	/**
	 * Flag after deleting in the panel or the full view (ADR-0037 §7): "In den Papierkorb
	 * verschoben" with "Rückgängig", which restores with expected_updated.
	 */
	offerUndo(move: TrashMove, title: string): void {
		this.#flags.show({
			tone: 'success',
			title,
			action: { label: 'Rückgängig', run: () => void this.undo(move) }
		});
	}

	/** "Rückgängig" of a move: restores the ticket unless it changed since; a failure as a flag. */
	async undo(move: TrashMove): Promise<boolean> {
		if (!this.#session.ensureValid()) return false;
		const key = move.tickets.find((ticket) => ticket.id === move.id)?.key ?? '';
		try {
			const result = await this.#data.restore(move.id, { expectedUpdated: move.updated });
			this.#remove([move.id]);
			const notes = restoreNotes(result);
			this.#flags.show({
				tone: 'success',
				title: `${result.key} wiederhergestellt.`,
				...(notes.length > 0 && { description: notes.join(' ') })
			});
			return true;
		} catch (error) {
			const failure = toDataError(error);
			if (failure.kind === 'session') this.#session.logout();
			const need = failure.kind === 'validation' ? needOf(failure) : null;
			if (need !== null) this.#needs.set(move.id, need);
			const reason = need !== null ? 'Bitte im Papierkorb entscheiden.' : reasonOf(failure);
			if (reason !== null) {
				this.#flags.show({
					tone: 'error',
					title: `${key || 'Das Ticket'} wurde nicht wiederhergestellt. ${reason}`
				});
			}
			return false;
		}
	}
}

const [getTrashStore, setTrashStore, hasTrashStore] = createContext<TrashStore>();

/** The store of the (app) layout, or null outside it (tests of single components). */
export function findTrashStore(): TrashStore | null {
	return hasTrashStore() ? getTrashStore() : null;
}

export { getTrashStore, setTrashStore };
