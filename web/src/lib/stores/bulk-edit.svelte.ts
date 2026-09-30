// Bulk actions of the ticket table (plan BI-2, ADR-0036 §3 and §4): the chosen tickets are
// changed one by one through the same data functions as a single change (Record API, route of
// "Löschen"), at most BULK_CONCURRENCY at a time. So every hook rule applies unchanged: keys on a
// new project, the history with the acting user, the lock of open sub-tasks, the next ticket of a
// series. The store shows the progress, keeps the result with a reason per ticket (partial success
// is possible) and offers "Rückgängig" in the flag for field changes and "Erledigen". A field change
// of open tickets of series offers the same for their templates in a second flag (plan WV), which
// "Rückgängig" withdraws.

import type PocketBase from 'pocketbase';
import { createContext } from 'svelte';
import { toDataError } from '$lib/data/errors';
import { countTicketSources, listSourceEventDates } from '$lib/data/bulk';
import { deleteTicket, updateTicket, type TrashMove } from '$lib/data/tickets';
import { restoreFromTrash } from '$lib/data/trash';
import {
	BULK_CONCURRENCY,
	NO_SOURCE_DATES,
	actionLabel,
	completionOrder,
	planStep,
	resultTitle,
	restorePatch,
	ticketCount,
	type BulkAction,
	type BulkCounts,
	type FieldAction,
	type SourceDates
} from '$lib/domain/bulk';
import type { CalendarDate } from '$lib/domain/berlin-date';
import { NO_SERIES, type SeriesChange, type SeriesChangeSink } from '$lib/domain/series-template';
import type { SourceHandling } from '$lib/domain/sources';
import { openChildrenMessage, subtaskCountText, type CompletionChoice } from '$lib/domain/subtasks';
import type { TicketPatch, TicketSummary } from '$lib/domain/ticket';
import {
	completedChildren,
	openChildrenOf,
	type CompletedChild,
	type SessionGuard
} from './ticket-list.svelte';
import { SILENT_FLAGS, type FlagSink } from './flags.svelte';

/** Data access of the bulk actions; tests pass a fake, the app binds the data layer. */
export interface BulkEditData {
	update(
		id: string,
		patch: TicketPatch,
		options?: { completion?: CompletionChoice; expectedUpdated?: string }
	): Promise<TicketSummary>;
	/** Moves the ticket to the trash (ADR-0037); the move for "Rückgängig", null before it. */
	delete(id: string, sources: SourceHandling): Promise<TrashMove | null>;
	/** "Rückgängig" of a move: restores the ticket unless it changed since `expectedUpdated`. */
	restore(id: string, expectedUpdated: string): Promise<void>;
	/** Dates of the events the tickets were converted from, by ticket ID. */
	sourceDates(): Promise<Map<string, CalendarDate>>;
	/** Number of sources of the tickets, for the question of "Löschen …". */
	sourceCount(ticketIds: readonly string[]): Promise<number>;
}

export function bulkEditData(pb: PocketBase): BulkEditData {
	return {
		update: (id, patch, options) => updateTicket(pb, id, patch, options),
		delete: (id, sources) => deleteTicket(pb, id, { sources }),
		restore: async (id, expectedUpdated) => {
			await restoreFromTrash(pb, id, { expectedUpdated });
		},
		sourceDates: () => listSourceEventDates(pb),
		sourceCount: (ticketIds) => countTicketSources(pb, ticketIds)
	};
}

/** What the store needs of the ticket list: the known tickets and their sub-tasks. */
export interface BulkList {
	find(id: string): TicketSummary | null;
	upsert(ticket: TicketSummary): void;
	remove(id: string): void;
	openBlockingOf(parentId: string): TicketSummary[];
}

/** A ticket the action left out or could not change, with the reason. */
export interface BulkProblem {
	id: string;
	key: string;
	reason: string;
}

/** Result of the last bulk action, shown next to the bar until the next one or "Schließen". */
export interface BulkResult {
	title: string;
	counts: BulkCounts;
	/** Refused or failed requests; shown as errors. */
	failures: readonly BulkProblem[];
	/** Tickets the action does not apply to (e.g. no due date to shift); neutral. */
	skipped: readonly BulkProblem[];
}

/** Progress of a running bulk action. */
export interface BulkProgress {
	label: string;
	total: number;
	done: number;
}

/** How to restore one changed ticket. */
interface UndoEntry {
	id: string;
	key: string;
	/** Fields to write back; null: the ticket went to the trash and is restored from there. */
	patch: TicketPatch | null;
	/** `updated` after the change: a ticket changed since is not overwritten. */
	updated: string;
	/** Sub-tasks completed along (ADR-0033 section 2), restored after the ticket. */
	children: readonly CompletedChild[];
}

/** Why a request failed, in words for the result list; null if nothing is to be shown. */
function reasonOf(error: unknown): string | null {
	const failure = toDataError(error);
	if (failure.kind === 'aborted' || failure.kind === 'session') return null;
	const open = openChildrenOf(failure);
	if (open !== null) {
		const keys = open.keys.length > 0 ? ` (${open.keys.join(', ')})` : '';
		return `${openChildrenMessage(open.count).replace(/\.$/, '')}${keys}.`;
	}
	const stale = Object.values(failure.fields).find(
		(field) => field.code === 'validation_description_stale'
	);
	if (stale !== undefined) return 'Wurde inzwischen geändert, nicht zurückgesetzt.';
	const field = Object.values(failure.fields)[0];
	return field?.message ?? failure.message;
}

/** Runs `work` over `items` with at most `limit` at a time; resolves when all are done. */
async function inPool<T>(
	items: readonly T[],
	limit: number,
	work: (item: T) => Promise<void>
): Promise<void> {
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

export class BulkEditStore {
	readonly #data: BulkEditData;
	readonly #session: SessionGuard;
	readonly #list: BulkList;
	readonly #flags: FlagSink;
	readonly #series: SeriesChangeSink;

	#progress = $state<BulkProgress | null>(null);
	#result = $state<BulkResult | null>(null);
	/**
	 * Restores of the last action while its flag offers "Rückgängig", with the ID of the offer for
	 * the templates it brought (withdrawn by "Rückgängig").
	 */
	#undo: { entries: readonly UndoEntry[]; flagId: string; offer: string | null } | null = null;
	/** The session ended during an action: the remaining tickets are not sent. */
	#stopped = false;

	constructor(
		data: BulkEditData,
		session: SessionGuard,
		list: BulkList,
		flags: FlagSink = SILENT_FLAGS,
		series: SeriesChangeSink = NO_SERIES
	) {
		this.#data = data;
		this.#session = session;
		this.#list = list;
		this.#flags = flags;
		this.#series = series;
	}

	/** The running action, null while none runs. */
	get progress(): BulkProgress | null {
		return this.#progress;
	}

	get busy(): boolean {
		return this.#progress !== null;
	}

	/** Result of the last action with its problems, null without one. */
	get result(): BulkResult | null {
		return this.#result;
	}

	/** Closes the result. */
	dismissResult(): void {
		this.#result = null;
	}

	/** Whether the flag of the last action still offers "Rückgängig". */
	get canUndo(): boolean {
		return this.#undo !== null;
	}

	/** Number of sources of the tickets, for the question of "Löschen …"; null if unknown. */
	async sourceCount(ids: readonly string[]): Promise<number | null> {
		if (!this.#session.ensureValid()) return null;
		try {
			return await this.#data.sourceCount(ids);
		} catch (error) {
			if (toDataError(error).kind === 'session') this.#session.logout();
			return null;
		}
	}

	/**
	 * Runs `action` on the tickets `ids` (in the order of the table) and resolves with the result.
	 * Nothing runs while another action runs.
	 */
	async run(action: BulkAction, ids: readonly string[]): Promise<BulkResult | null> {
		if (this.busy || ids.length === 0 || !this.#session.ensureValid()) return null;
		const tickets = ids
			.map((id) => this.#list.find(id))
			.filter((ticket): ticket is TicketSummary => ticket !== null);
		if (tickets.length === 0) return null;
		this.#dropUndo();
		this.#result = null;
		this.#stopped = false;
		this.#progress = { label: actionLabel(action), total: tickets.length, done: 0 };
		try {
			switch (action.kind) {
				case 'complete':
					return await this.#complete(tickets, action.withChildren);
				case 'delete':
					return await this.#delete(tickets, action.sources);
				case 'status':
					if (action.value === 'done') return await this.#complete(tickets, true);
					return await this.#change(tickets, action);
				default:
					return await this.#change(tickets, action);
			}
		} finally {
			this.#progress = null;
		}
	}

	/** "Rückgängig" of the flag: restores every ticket of the last action, one by one. */
	async undo(): Promise<BulkResult | null> {
		const undo = this.#undo;
		if (undo === null || this.busy || !this.#session.ensureValid()) return null;
		this.#undo = null;
		this.#flags.dismiss(undo.flagId);
		if (undo.offer !== null) this.#series.withdrawTemplateOffer(undo.offer);
		this.#result = null;
		this.#stopped = false;
		this.#progress = { label: 'Rückgängig', total: undo.entries.length, done: 0 };
		const failures: BulkProblem[] = [];
		let changed = 0;
		const restoring = undo.entries.every((entry) => entry.patch === null);
		try {
			await inPool(undo.entries, BULK_CONCURRENCY, async (entry) => {
				try {
					if (this.#stopped) return;
					if (entry.patch === null) {
						// Back from the trash (ADR-0037 §7); the ticket returns to the list by realtime.
						await this.#data.restore(entry.id, entry.updated);
						changed += 1;
						return;
					}
					const saved = await this.#data.update(entry.id, entry.patch, {
						expectedUpdated: entry.updated
					});
					this.#list.upsert(saved);
					changed += 1;
					for (const child of entry.children) {
						try {
							this.#list.upsert(
								await this.#data.update(child.id, { status: child.previousStatus })
							);
						} catch (error) {
							this.#note(failures, child, error);
						}
					}
				} catch (error) {
					this.#note(failures, entry, error);
				} finally {
					this.#step();
				}
			});
		} finally {
			this.#progress = null;
		}
		return this.#finish(
			{ changed, skipped: 0, unchanged: 0, failed: failures.length },
			restoring ? 'wiederhergestellt' : 'zurückgesetzt',
			failures,
			[]
		);
	}

	/** Field changes: one patch per ticket from planStep; "Rückgängig" restores the fields. */
	async #change(
		tickets: readonly TicketSummary[],
		action: FieldAction
	): Promise<BulkResult | null> {
		let sources: SourceDates = NO_SOURCE_DATES;
		if (action.kind === 'due' && action.mode === 'source') {
			try {
				sources = await this.#data.sourceDates();
			} catch (error) {
				const reason = reasonOf(error);
				if (toDataError(error).kind === 'session') this.#session.logout();
				if (reason === null) return null;
				this.#flags.show({
					tone: 'error',
					title: `Die Termine der Quellen ließen sich nicht laden. ${reason}`
				});
				return null;
			}
		}
		const failures: BulkProblem[] = [];
		const skipped: BulkProblem[] = [];
		const entries: UndoEntry[] = [];
		const changes: SeriesChange[] = [];
		let unchanged = 0;
		await inPool(tickets, BULK_CONCURRENCY, async (ticket) => {
			try {
				const step = planStep(ticket, action, sources);
				if (step.type === 'unchanged') {
					unchanged += 1;
					return;
				}
				if (step.type === 'skip') {
					skipped.push({ id: ticket.id, key: ticket.key, reason: step.reason });
					return;
				}
				if (this.#stopped) return;
				const saved = await this.#data.update(ticket.id, step.patch);
				this.#list.upsert(saved);
				changes.push({ before: ticket, after: saved });
				entries.push({
					id: saved.id,
					key: saved.key,
					patch: restorePatch(ticket, step.patch),
					updated: saved.updated,
					children: []
				});
			} catch (error) {
				this.#note(failures, ticket, error);
			} finally {
				this.#step();
			}
		});
		const counts = {
			changed: entries.length,
			skipped: skipped.length,
			unchanged,
			failed: failures.length
		};
		const result = this.#finish(counts, 'geändert', failures, skipped, entries);
		// Open tickets of series: one flag for all their rules, after the result (plan WV).
		const offer = result === null ? null : this.#series.offerTemplate(changes);
		if (offer !== null && this.#undo !== null) this.#undo = { ...this.#undo, offer };
		return result;
	}

	/**
	 * "Erledigen" (ADR-0033 section 2, ADR-0022 section 4): sub-tasks first, then the others. A
	 * ticket with open blocking sub-tasks takes them along with `withChildren` (atomically in the
	 * hook); without it the hook refuses and the ticket is listed with the reason. The next ticket
	 * of a series comes from the server as for a single check mark. "Rückgängig" reopens with the
	 * status from before; a series that has an edited next ticket refuses (ADR-0023 section 3).
	 */
	async #complete(
		tickets: readonly TicketSummary[],
		withChildren: boolean
	): Promise<BulkResult | null> {
		const failures: BulkProblem[] = [];
		const entries: UndoEntry[] = [];
		let unchanged = 0;
		const ordered = completionOrder(tickets);
		const phases = [
			ordered.filter((ticket) => ticket.parentId),
			ordered.filter((ticket) => !ticket.parentId)
		];
		for (const phase of phases) {
			await inPool(phase, BULK_CONCURRENCY, async (ticket) => {
				try {
					const current = this.#list.find(ticket.id) ?? ticket;
					if (current.status === 'done') {
						unchanged += 1;
						return;
					}
					if (this.#stopped) return;
					const blocking = withChildren ? this.#list.openBlockingOf(current.id) : [];
					const completion: CompletionChoice | undefined =
						blocking.length > 0 ? 'complete_children' : undefined;
					const saved = await this.#data.update(
						current.id,
						{ status: 'done' },
						completion === undefined ? {} : { completion }
					);
					// The sub-tasks completed along reach the list through their realtime events, as
					// after a single check mark.
					const children = completion === undefined ? [] : completedChildren(blocking, completion);
					this.#list.upsert(saved);
					entries.push({
						id: saved.id,
						key: saved.key,
						patch: { status: current.status },
						updated: saved.updated,
						children
					});
				} catch (error) {
					this.#note(failures, ticket, error);
				} finally {
					this.#step();
				}
			});
		}
		const counts = { changed: entries.length, skipped: 0, unchanged, failed: failures.length };
		return this.#finish(counts, 'erledigt', failures, [], entries);
	}

	/**
	 * "Löschen" (ADR-0031, addendum B; ADR-0037): each ticket moves to the trash with its sub-tasks,
	 * the sources as chosen. "Rückgängig" restores them from the trash with expected_updated.
	 * Parents go first, so their chosen sub-tasks move along as their group (one entry to undo); a
	 * sub-task found in the trash already (404) counts as moved.
	 */
	async #delete(
		tickets: readonly TicketSummary[],
		sources: SourceHandling
	): Promise<BulkResult | null> {
		const failures: BulkProblem[] = [];
		const entries: UndoEntry[] = [];
		let deleted = 0;
		const chosen = tickets.map((ticket) => ticket.id);
		const alongWithParent = (ticket: TicketSummary) =>
			!!ticket.parentId && chosen.includes(ticket.parentId);
		const phases = [
			tickets.filter((ticket) => !alongWithParent(ticket)),
			tickets.filter(alongWithParent)
		];
		for (const phase of phases)
			await inPool(phase, BULK_CONCURRENCY, async (ticket) => {
				try {
					if (this.#stopped) return;
					const move = await this.#data.delete(ticket.id, sources);
					this.#list.remove(ticket.id);
					deleted += 1;
					if (move !== null) {
						entries.push({
							id: move.id,
							key: ticket.key,
							patch: null,
							updated: move.updated,
							children: []
						});
					}
				} catch (error) {
					if (toDataError(error).kind === 'not_found') {
						this.#list.remove(ticket.id);
						deleted += 1;
						return;
					}
					this.#note(failures, ticket, error);
				} finally {
					this.#step();
				}
			});
		return this.#finish(
			{ changed: deleted, skipped: 0, unchanged: 0, failed: failures.length },
			entries.length > 0 ? 'in den Papierkorb verschoben' : 'gelöscht',
			failures,
			[],
			entries
		);
	}

	#step(): void {
		if (this.#progress !== null)
			this.#progress = { ...this.#progress, done: this.#progress.done + 1 };
	}

	/** Records a failed ticket; an ended session stops the action and leads to the login. */
	#note(failures: BulkProblem[], ticket: { id: string; key: string }, error: unknown): void {
		const failure = toDataError(error);
		if (failure.kind === 'session') {
			if (!this.#stopped) this.#session.logout();
			this.#stopped = true;
			return;
		}
		const reason = reasonOf(failure);
		if (reason !== null) failures.push({ id: ticket.id, key: ticket.key, reason });
	}

	/**
	 * Keeps the result and shows the flag: an error flag when nothing changed and requests failed,
	 * otherwise a success flag, with "Rückgängig" for FLAG_DURATION_MS when the changes can be
	 * restored. Its title names failures as a number; their reasons stay in the result.
	 */
	#finish(
		counts: BulkCounts,
		verb: string,
		failures: readonly BulkProblem[],
		skipped: readonly BulkProblem[],
		entries: readonly UndoEntry[] = []
	): BulkResult | null {
		if (this.#stopped) return null;
		const title = resultTitle(counts, verb);
		const result: BulkResult = { title, counts, failures, skipped };
		this.#result = failures.length > 0 || skipped.length > 0 ? result : null;
		const withChildren = entries.reduce((sum, entry) => sum + entry.children.length, 0);
		const flagTitle =
			withChildren === 0 ? title : `${title} Dazu ${subtaskCountText(withChildren)} erledigt.`;
		if (counts.changed === 0 && counts.failed > 0) {
			this.#flags.show({
				tone: 'error',
				title: flagTitle,
				description: 'Die Gründe stehen bei der Auswahl.'
			});
			return result;
		}
		if (entries.length === 0) {
			this.#flags.show({ tone: 'success', title: flagTitle });
			return result;
		}
		const flagId = this.#flags.show({
			tone: 'success',
			title: flagTitle,
			action: { label: 'Rückgängig', run: () => void this.undo() },
			onclose: () => {
				if (this.#undo?.flagId === flagId) this.#undo = null;
			}
		});
		this.#undo = { entries, flagId, offer: null };
		return result;
	}

	#dropUndo(): void {
		const undo = this.#undo;
		this.#undo = null;
		if (undo !== null) this.#flags.dismiss(undo.flagId);
	}
}

/** Text of the progress: "Priorität ändern: 3 von 12 Tickets". */
export function progressText(progress: BulkProgress): string {
	return `${progress.label}: ${progress.done} von ${ticketCount(progress.total)}`;
}

const [getBulkEditStore, setBulkEditStore, hasBulkEditStore] = createContext<BulkEditStore>();

/** The store of the (app) layout, or null outside it (tests of single views). */
export function findBulkEditStore(): BulkEditStore | null {
	return hasBulkEditStore() ? getBulkEditStore() : null;
}

export { setBulkEditStore };
