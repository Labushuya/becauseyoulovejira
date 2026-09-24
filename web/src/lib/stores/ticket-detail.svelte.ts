// State of the detail panel (ADR-0006 sections 1 to 5, E2 plan T-7 and package 7): one ticket,
// saving per field and protection of drafts. A draft stays while an update for the same ticket
// arrives (own list, from package 12 realtime); every other field follows the update. Only the
// changed field is sent, and the answer of the server replaces the ticket.

import type PocketBase from 'pocketbase';
import { createContext } from 'svelte';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { toDataError } from '$lib/data/errors';
import type { RequestOptions } from '$lib/data/options';
import { getTicket, updateTicket } from '$lib/data/tickets';
import { isCalendarDate } from '$lib/domain/berlin-date';
import { isPriority, isStatus, type Status } from '$lib/domain/status';
import type { Ticket, TicketPatch, TicketSummary } from '$lib/domain/ticket';
import type { SessionGuard } from './ticket-list.svelte';

/** Fields editable in E2 (E2 plan, section 2). */
export type EditableField = 'title' | 'description' | 'status' | 'priority' | 'due';

/** idle: no ticket; loading; ready; not_found: unknown or foreign ID; error: loading failed. */
export type DetailState = 'idle' | 'loading' | 'ready' | 'not_found' | 'error';

export const TITLE_REQUIRED_MESSAGE = 'Der Titel darf nicht leer sein.';
export const INVALID_DATE_MESSAGE = 'Ungültiges Datum.';

export interface TicketDetailData {
	get(id: string, options: RequestOptions): Promise<Ticket>;
	update(id: string, patch: TicketPatch): Promise<Ticket>;
}

/** The part of the list store the panel updates, so the list shows a change at once. */
export interface TicketListSync {
	find(id: string): TicketSummary | null;
	upsert(ticket: TicketSummary): void;
	completed(ticket: TicketSummary, previousStatus: Status): void;
}

export function ticketDetailData(pb: PocketBase): TicketDetailData {
	return {
		get: (id, options) => getTicket(pb, id, options),
		update: (id, patch) => updateTicket(pb, id, patch)
	};
}

/** Current value of a field as the text of its control ('' for no due date). */
function fieldText(ticket: Ticket, field: EditableField): string {
	return field === 'due' ? (ticket.due ?? '') : ticket[field];
}

type PatchResult = { patch: TicketPatch } | { error: string };

/** Patch for one field from its draft, or the reason why the draft cannot be saved. */
function patchFor(field: EditableField, draft: string): PatchResult {
	switch (field) {
		case 'title': {
			const title = draft.trim();
			return title === '' ? { error: TITLE_REQUIRED_MESSAGE } : { patch: { title } };
		}
		case 'description':
			return { patch: { description: draft } };
		case 'due':
			if (draft === '') return { patch: { due: null } };
			return isCalendarDate(draft) ? { patch: { due: draft } } : { error: INVALID_DATE_MESSAGE };
		case 'status':
			return isStatus(draft) ? { patch: { status: draft } } : { error: 'Ungültiger Wert.' };
		case 'priority':
			return isPriority(draft) ? { patch: { priority: draft } } : { error: 'Ungültiger Wert.' };
	}
}

export class TicketDetailStore {
	readonly #data: TicketDetailData;
	readonly #session: SessionGuard;
	readonly #list: TicketListSync;

	readonly #drafts = new SvelteMap<EditableField, string>();
	readonly #saving = new SvelteSet<EditableField>();
	readonly #fieldErrors = new SvelteMap<EditableField, string>();
	#controller: AbortController | null = null;

	#id = $state<string | null>(null);
	#own = $state.raw<Ticket | null>(null);
	#state = $state<DetailState>('idle');
	#error = $state<string | null>(null);

	/** The loaded ticket, or the list's version of it if that one is newer (check mark). */
	#ticket = $derived.by((): Ticket | null => {
		const own = this.#own;
		if (own === null) return null;
		const summary = this.#list.find(own.id);
		if (summary === null || summary.updated <= own.updated) return own;
		return { ...own, ...summary, description: own.description };
	});

	constructor(data: TicketDetailData, session: SessionGuard, list: TicketListSync) {
		this.#data = data;
		this.#session = session;
		this.#list = list;
	}

	get id(): string | null {
		return this.#id;
	}

	get ticket(): Ticket | null {
		return this.#ticket;
	}

	get state(): DetailState {
		return this.#state;
	}

	get error(): string | null {
		return this.#error;
	}

	/** Value shown in the control of a field: the draft while editing, else the ticket's. */
	value(field: EditableField): string {
		const draft = this.#drafts.get(field);
		if (draft !== undefined) return draft;
		return this.#ticket === null ? '' : fieldText(this.#ticket, field);
	}

	isEditing(field: EditableField): boolean {
		return this.#drafts.has(field);
	}

	isSaving(field: EditableField): boolean {
		return this.#saving.has(field);
	}

	fieldError(field: EditableField): string | null {
		return this.#fieldErrors.get(field) ?? null;
	}

	/** True while any field has an unsaved draft. */
	get dirty(): boolean {
		return this.#drafts.size > 0;
	}

	/** Shows the given ticket; another ID drops drafts and aborts the previous request. */
	open(id: string): void {
		if (id === this.#id && this.#state !== 'error') return;
		this.reset();
		this.#id = id;
		void this.#load(id);
	}

	/** Loads the ticket again ("Erneut versuchen"). */
	async reload(): Promise<void> {
		if (this.#id !== null) await this.#load(this.#id);
	}

	/**
	 * Replaces the ticket with a newer version (own answer or realtime event). Drafts stay, so a
	 * running input keeps its text; an older `updated` is ignored.
	 */
	upsert(ticket: Ticket): void {
		if (ticket.id !== this.#id) return;
		if (this.#own !== null && this.#own.updated > ticket.updated) return;
		this.#own = ticket;
		if (this.#state !== 'ready') {
			this.#state = 'ready';
			this.#error = null;
		}
	}

	/** Starts editing a field with its current value as draft. */
	edit(field: EditableField): void {
		if (this.#ticket === null || this.#drafts.has(field)) return;
		this.#drafts.set(field, fieldText(this.#ticket, field));
		this.#fieldErrors.delete(field);
	}

	setDraft(field: EditableField, value: string): void {
		this.#drafts.set(field, value);
	}

	/** Drops the draft and the error of a field (Escape, "Abbrechen"). */
	cancel(field: EditableField): void {
		this.#drafts.delete(field);
		this.#fieldErrors.delete(field);
	}

	/** Marks a field as invalid without a request (e.g. an incomplete date in the browser). */
	reject(field: EditableField, message: string): void {
		this.#fieldErrors.set(field, message);
	}

	/**
	 * Saves the draft of a field. Returns true if nothing is left to save. An unchanged draft
	 * ends editing without a request. On failure the draft stays and the field shows the error.
	 */
	async save(field: EditableField): Promise<boolean> {
		const ticket = this.#ticket;
		const draft = this.#drafts.get(field);
		if (ticket === null || draft === undefined) return true;
		if (this.#saving.has(field)) return false;
		const result = patchFor(field, draft);
		if ('error' in result) {
			this.#fieldErrors.set(field, result.error);
			return false;
		}
		const next = field === 'title' ? draft.trim() : draft;
		if (next === fieldText(ticket, field)) {
			this.cancel(field);
			return true;
		}
		if (!this.#session.ensureValid()) return false;
		this.#saving.add(field);
		this.#fieldErrors.delete(field);
		try {
			const saved = await this.#data.update(ticket.id, result.patch);
			if (saved.status === 'done' && ticket.status !== 'done') {
				this.#list.completed(saved, ticket.status);
			} else {
				this.#list.upsert(saved);
			}
			if (saved.id === this.#id) {
				this.upsert(saved);
				if (this.#drafts.get(field) === draft) this.#drafts.delete(field);
			}
			return true;
		} catch (error) {
			const failure = toDataError(error);
			if (failure.kind === 'session') this.#session.logout();
			else if (failure.kind !== 'aborted' && ticket.id === this.#id) {
				this.#fieldErrors.set(field, failure.fields[field]?.message ?? failure.message);
			}
			return false;
		} finally {
			this.#saving.delete(field);
		}
	}

	/**
	 * Status and priority save at once when chosen (T-7); a failure restores the old value. A
	 * choice during a running save (arrow keys on a closed select) is saved right after it.
	 */
	async choose(field: 'status' | 'priority', value: string): Promise<void> {
		this.#drafts.set(field, value);
		if (this.#saving.has(field)) return;
		while (this.#drafts.has(field)) {
			if (!(await this.save(field))) {
				this.#drafts.delete(field);
				return;
			}
		}
	}

	/** Empties the store and aborts a running request. */
	reset(): void {
		this.#controller?.abort();
		this.#controller = null;
		this.#drafts.clear();
		this.#saving.clear();
		this.#fieldErrors.clear();
		this.#id = null;
		this.#own = null;
		this.#state = 'idle';
		this.#error = null;
	}

	async #load(id: string): Promise<void> {
		this.#controller?.abort();
		this.#controller = null;
		if (!this.#session.ensureValid()) return;
		const controller = new AbortController();
		this.#controller = controller;
		this.#state = 'loading';
		this.#error = null;
		try {
			const ticket = await this.#data.get(id, { signal: controller.signal });
			if (controller.signal.aborted) return;
			this.#own = ticket;
			this.#state = 'ready';
		} catch (error) {
			if (controller.signal.aborted) return;
			const failure = toDataError(error);
			if (failure.kind === 'aborted') return;
			if (failure.kind === 'session') {
				this.#session.logout();
				return;
			}
			if (failure.kind === 'not_found' || failure.kind === 'forbidden') {
				this.#state = 'not_found';
				return;
			}
			this.#error = failure.message;
			this.#state = 'error';
		} finally {
			if (this.#controller === controller) this.#controller = null;
		}
	}
}

const [getTicketDetailStore, setTicketDetailStore] = createContext<TicketDetailStore>();

/** Store of the detail panel, set by the app layout and read by the ticket route. */
export { getTicketDetailStore, setTicketDetailStore };
