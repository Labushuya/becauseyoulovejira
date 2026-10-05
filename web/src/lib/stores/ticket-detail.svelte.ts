// State of the detail panel (ADR-0006 sections 1 to 5, E2 plan T-7 and package 7): one ticket,
// saving per field and protection of drafts. A draft stays while an update for the same ticket
// arrives (own list or realtime, ADR-0007); every other field follows the update. Only the
// changed field is sent, and the answer of the server replaces the ticket. While a ticket is
// shown, the store follows it live, including its description and its deletion elsewhere.
// The description never overwrites a newer one silently (ADR-0032 section 6): saving it and ticking
// a task in it send `expected_updated`; a description that changed meanwhile ends in a question
// (saving) or a message (ticking) instead. The pinned comment of the ticket (ADR-0044) is a field
// of the ticket as well: pinning another one replaces it and offers "Rückgängig" in a flag.

import type PocketBase from 'pocketbase';
import { createContext } from 'svelte';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { toDataError, type DataError } from '$lib/data/errors';
import type { RequestOptions } from '$lib/data/options';
import {
	createTicket,
	deleteTicket,
	getTicket,
	updateTicket,
	type TrashMove,
	type UpdateOptions
} from '$lib/data/tickets';
import { toggleTask } from '$lib/markdown';
import { PIN_FLAGS, type CommentPinControl } from '$lib/domain/comments';
import type { SourceHandling } from '$lib/domain/sources';
import { isCalendarDate } from '$lib/domain/berlin-date';
import { isCharmKey } from '$lib/domain/charms';
import { isProjectColor } from '$lib/domain/colors';
import { isTicketKind, kindOf } from '$lib/domain/day-plan';
import { NO_SERIES, type SeriesChangeSink } from '$lib/domain/series-template';
import { isPriority, isStatus, type Status } from '$lib/domain/status';
import { openBlocking, type CompletionChoice } from '$lib/domain/subtasks';
import type {
	Ticket,
	TicketDraft,
	TicketOrigin,
	TicketPatch,
	TicketSummary
} from '$lib/domain/ticket';
import { SILENT_FLAGS, type FlagSink } from './flags.svelte';
import { hold, type LiveSource } from './realtime';
import {
	completedChildren,
	openChildrenOf,
	reopenRefusalOf,
	type CompletedChild,
	type SessionGuard
} from './ticket-list.svelte';
import {
	moveTicketToTrash,
	type DeleteResult,
	type DeleteSources,
	type TrashUndo
} from './trash-move';

export type { DeleteResult, DeleteSources, TrashUndo };

/**
 * Fields editable in the panel (E2 plan, section 2; E3 plan, T-13), the color since ADR-0052, the
 * charm since ADR-0062, the kind since ADR-0065.
 */
export type EditableField =
	'title' | 'description' | 'status' | 'priority' | 'due' | 'project' | 'color' | 'charm' | 'kind';

/**
 * Fields with their own saving state and error: the editable ones plus the tags (T-14), the parent
 * and the switch "Blockiert das übergeordnete Ticket" of a sub-task (ADR-0033).
 */
export type FieldKey = EditableField | 'tags' | 'parent' | 'blocksParent';

/**
 * Fields that save at once when chosen (T-7, T-13; the color since ADR-0052, the charm since
 * ADR-0062, the switch "Laufendes Vorhaben" since ADR-0065).
 */
export type ChoiceField = 'status' | 'priority' | 'project' | 'color' | 'charm' | 'kind';

/**
 * idle: no ticket; loading; ready; not_found: unknown or foreign ID; error: loading failed;
 * deleted: the shown ticket was deleted elsewhere (ADR-0007 section 2).
 */
export type DetailState = 'idle' | 'loading' | 'ready' | 'not_found' | 'error' | 'deleted';

export const TITLE_REQUIRED_MESSAGE = 'Der Titel darf nicht leer sein.';
export const INVALID_DATE_MESSAGE = 'Ungültiges Datum.';
export const INVALID_VALUE_MESSAGE = 'Ungültiger Wert.';
/** A task was ticked on a description that changed meanwhile (ADR-0032 section 6). */
export const TASK_STALE_MESSAGE =
	'Die Beschreibung wurde inzwischen geändert. Bitte erneut abhaken.';

/** Code of the hook for a description that changed since `expected_updated`. */
const STALE_CODE = 'validation_description_stale';

/** Record ID as PocketBase creates it (15 characters a–z and 0–9). */
const RECORD_ID = /^[a-z0-9]{15}$/;

/** The hook refused a change of the description because the ticket changed meanwhile. */
function isStale(failure: DataError): boolean {
	return failure.fields.description?.code === STALE_CODE;
}

export interface TicketDetailData {
	get(id: string, options: RequestOptions): Promise<Ticket>;
	update(id: string, patch: TicketPatch, options?: UpdateOptions): Promise<Ticket>;
	create(draft: TicketDraft, origin?: TicketOrigin): Promise<Ticket>;
	/**
	 * Moves the ticket to the trash (ADR-0037) through the route, the sources as chosen; answers
	 * the move for "Rückgängig" (null before the migration of the trash).
	 */
	delete(id: string, sources: SourceHandling): Promise<TrashMove | null>;
}

/** Outcome of ticking a task; a failure carries a message unless nothing is to be shown. */
export type TaskResult = { ok: true } | { ok: false; message: string | null };

/** Outcome of creating a ticket; a failure carries a message and/or errors per field. */
export type CreateResult =
	| { ok: true; ticket: Ticket }
	| { ok: false; message: string | null; fields: Partial<Record<keyof TicketDraft, string>> };

const DRAFT_FIELDS: readonly (keyof TicketDraft)[] = [
	'title',
	'description',
	'status',
	'priority',
	'due',
	'project',
	'tags',
	'color',
	'charm'
];

/** The part of the list store the panel updates, so the list shows a change at once. */
export interface TicketListSync {
	find(id: string): TicketSummary | null;
	upsert(ticket: TicketSummary): void;
	/** `children`: sub-tasks completed along, restored by "Rückgängig" (ADR-0033 section 2). */
	completed(
		ticket: TicketSummary,
		previousStatus: Status,
		children?: readonly CompletedChild[]
	): void;
	remove(id: string): void;
	/** Polite status message of the list (aria-live), which stays when the panel closes. */
	announce(message: string): void;
	/** Sub-tasks of a ticket (ADR-0033); without it the panel knows none before the server says. */
	subtasksOf?(parentId: string): readonly TicketSummary[];
}

/** Question before completing the shown ticket with open blocking sub-tasks (ADR-0033). */
export interface DetailCompletionQuestion {
	count: number;
	keys: readonly string[];
}

/** A refused reopening (ADR-0023 addendum 4): the chosen status and why it was refused. */
export interface DetailReopenQuestion {
	status: Status;
	message: string;
}

export function ticketDetailData(pb: PocketBase): TicketDetailData {
	return {
		get: (id, options) => getTicket(pb, id, options),
		update: (id, patch, options) => updateTicket(pb, id, patch, options),
		create: (draft, origin) => createTicket(pb, draft, { origin }),
		delete: (id, sources) => deleteTicket(pb, id, { sources })
	};
}

/** Current value of a field as the text of its control ('' for no due date, project or color). */
function fieldText(ticket: Ticket, field: EditableField): string {
	if (field === 'due') return ticket.due ?? '';
	if (field === 'project') return ticket.projectId ?? '';
	if (field === 'color') return ticket.color ?? '';
	if (field === 'charm') return ticket.charm ?? '';
	if (field === 'kind') return kindOf(ticket.kind);
	return ticket[field];
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
			return isStatus(draft) ? { patch: { status: draft } } : { error: INVALID_VALUE_MESSAGE };
		case 'priority':
			return isPriority(draft) ? { patch: { priority: draft } } : { error: INVALID_VALUE_MESSAGE };
		case 'project':
			if (draft === '') return { patch: { project: null } };
			return RECORD_ID.test(draft)
				? { patch: { project: draft } }
				: { error: INVALID_VALUE_MESSAGE };
		case 'color':
			// '' is "wie Projekt" (ADR-0052).
			if (draft === '') return { patch: { color: null } };
			return isProjectColor(draft) ? { patch: { color: draft } } : { error: INVALID_VALUE_MESSAGE };
		case 'charm':
			// '' is "Kein Charm" (ADR-0062).
			if (draft === '') return { patch: { charm: null } };
			return isCharmKey(draft) ? { patch: { charm: draft } } : { error: INVALID_VALUE_MESSAGE };
		case 'kind':
			// "Laufendes Vorhaben" or "Aufgabe" (ADR-0065).
			return isTicketKind(draft) ? { patch: { kind: draft } } : { error: INVALID_VALUE_MESSAGE };
	}
}

export class TicketDetailStore implements CommentPinControl {
	readonly #data: TicketDetailData;
	readonly #session: SessionGuard;
	readonly #list: TicketListSync;
	readonly #trash: TrashUndo | null;
	/** Offers to take a change of an open ticket of a series over into its template (plan WV). */
	readonly #series: SeriesChangeSink;
	/** "Angepinnter Kommentar ersetzt." with "Rückgängig" (ADR-0044 section 2). */
	readonly #flags: FlagSink;

	readonly #drafts = new SvelteMap<EditableField, string>();
	readonly #saving = new SvelteSet<FieldKey>();
	readonly #fieldErrors = new SvelteMap<FieldKey, string>();
	#controller: AbortController | null = null;
	#live: LiveSource | null = null;
	/** Ends the subscription of the shown ticket. */
	#stopTicket: (() => void) | null = null;
	/** Ticket this panel is deleting: its delete event is the own one, not a deletion elsewhere. */
	#deletingId: string | null = null;
	/** Description the draft started from; saving asks if the stored one is another by now. */
	#descriptionBase: string | null = null;
	/** The description changed while it was being edited: "Überschreiben" or "Verwerfen". */
	#conflict = $state(false);
	/** Question before completing with open blocking sub-tasks, for the ticket it came from. */
	#completion = $state<(DetailCompletionQuestion & { ticketId: string }) | null>(null);
	/** A refused reopening of an instance, for the ticket it came from (ADR-0023 addendum 4). */
	#reopen = $state<(DetailReopenQuestion & { ticketId: string }) | null>(null);
	/** Comment whose pin is being saved (ADR-0044 section 2). */
	#pinning = $state<string | null>(null);
	/** Why pinning or releasing a comment of the shown ticket failed. */
	#pinFailure = $state<{ ticketId: string; commentId: string; message: string } | null>(null);

	#id = $state<string | null>(null);
	#own = $state.raw<Ticket | null>(null);
	#state = $state<DetailState>('idle');
	/** Text in the input of the tag picker (T-14), kept here for the question on leaving. */
	#tagInput = $state('');
	#error = $state<string | null>(null);
	/** The shown ticket went into an area this tab does not see (E7-4, ADR-0061 §3). */
	#movedAway = $state(false);

	/** The loaded ticket, or the list's version of it if that one is newer (check mark). */
	#ticket = $derived.by((): Ticket | null => {
		const own = this.#own;
		if (own === null) return null;
		const summary = this.#list.find(own.id);
		if (summary === null || summary.updated <= own.updated) return own;
		return { ...own, ...summary, description: own.description };
	});

	constructor(
		data: TicketDetailData,
		session: SessionGuard,
		list: TicketListSync,
		trash: TrashUndo | null = null,
		series: SeriesChangeSink = NO_SERIES,
		flags: FlagSink = SILENT_FLAGS
	) {
		this.#data = data;
		this.#session = session;
		this.#list = list;
		this.#trash = trash;
		this.#series = series;
		this.#flags = flags;
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

	/** With the state "deleted": the ticket was moved into an area this account does not see. */
	get movedAway(): boolean {
		return this.#movedAway;
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

	isSaving(field: FieldKey): boolean {
		return this.#saving.has(field);
	}

	fieldError(field: FieldKey): string | null {
		return this.#fieldErrors.get(field) ?? null;
	}

	/**
	 * True when saving the description found a newer one (ADR-0032 section 6); the draft stays
	 * until the user overwrites it or discards it.
	 */
	get descriptionConflict(): boolean {
		return this.#conflict;
	}

	/**
	 * The question "N Unteraufgaben sind noch offen – trotzdem erledigen?" of the status select
	 * (ADR-0033 section 2), null without one. It belongs to the ticket it came from.
	 */
	get completionQuestion(): DetailCompletionQuestion | null {
		return this.#question;
	}

	#question = $derived.by((): DetailCompletionQuestion | null => {
		const question = this.#completion;
		if (question === null || question.ticketId !== this.#id) return null;
		return { count: question.count, keys: question.keys };
	});

	/**
	 * Answers the question: completes the shown ticket anyway (`force`) or with its blocking
	 * sub-tasks (`complete_children`). The list shows the flag with "Rückgängig", which restores the
	 * sub-tasks as well. A failure stands at the field "status" and ends the question.
	 */
	async confirmCompletion(choice: CompletionChoice): Promise<boolean> {
		const ticket = this.#ticket;
		if (ticket === null || this.completionQuestion === null) return false;
		if (this.#saving.has('status') || !this.#session.ensureValid()) return false;
		const children = completedChildren(this.#blockingOf(ticket.id), choice);
		this.#saving.add('status');
		this.#fieldErrors.delete('status');
		try {
			const saved = await this.#data.update(ticket.id, { status: 'done' }, { completion: choice });
			this.#completion = null;
			this.#list.completed(saved, ticket.status, children);
			if (saved.id === this.#id) this.upsert(saved);
			return true;
		} catch (error) {
			const failure = toDataError(error);
			if (failure.kind === 'session') this.#session.logout();
			else if (failure.kind !== 'aborted' && ticket.id === this.#id) {
				this.#completion = null;
				this.#fieldErrors.set('status', failure.fields.status?.message ?? failure.message);
			}
			return false;
		} finally {
			this.#saving.delete('status');
		}
	}

	/** "Abbrechen" of the question: the status stays. */
	cancelCompletion(): void {
		this.#completion = null;
	}

	/**
	 * The refused reopening of an instance (ADR-0023 section 3 and addendum 4): another ticket of the
	 * series is open. The panel explains it inline and offers to reopen the ticket as a normal one;
	 * null without one. It belongs to the ticket it came from.
	 */
	get reopenQuestion(): DetailReopenQuestion | null {
		const question = this.#reopen;
		if (question === null || question.ticketId !== this.#id) return null;
		return { status: question.status, message: question.message };
	}

	/**
	 * "Als normales Ticket wieder öffnen (aus der Serie lösen)": the chosen status and leaving the
	 * series in one request. A failure stands at the field "status" and ends the question.
	 */
	async reopenDetached(): Promise<boolean> {
		const ticket = this.#ticket;
		const question = this.reopenQuestion;
		if (ticket === null || question === null) return false;
		if (this.#saving.has('status') || !this.#session.ensureValid()) return false;
		this.#saving.add('status');
		this.#fieldErrors.delete('status');
		try {
			const saved = await this.#data.update(ticket.id, {
				status: question.status,
				detachSeries: true
			});
			this.#reopen = null;
			this.#list.upsert(saved);
			this.#list.announce(`${saved.key} ist wieder offen, als normales Ticket.`);
			if (saved.id === this.#id) this.upsert(saved);
			return true;
		} catch (error) {
			const failure = toDataError(error);
			if (failure.kind === 'session') this.#session.logout();
			else if (failure.kind !== 'aborted' && ticket.id === this.#id) {
				this.#reopen = null;
				this.#fieldErrors.set('status', failure.fields.status?.message ?? failure.message);
			}
			return false;
		} finally {
			this.#saving.delete('status');
		}
	}

	/** "Abbrechen" of the refused reopening: the ticket stays done. */
	cancelReopen(): void {
		this.#reopen = null;
	}

	#blockingOf(id: string): TicketSummary[] {
		return openBlocking(this.#list.subtasksOf?.(id) ?? []);
	}

	#askCompletion(ticketId: string, count: number, keys: readonly string[]): void {
		this.#completion = { ticketId, count, keys: [...keys] };
		this.#fieldErrors.delete('status');
	}

	/** True while any field has an unsaved draft. */
	get dirty(): boolean {
		return this.#drafts.size > 0;
	}

	/**
	 * True while the description editor holds text that differs from the saved description, so
	 * leaving the panel would lose it (question "Änderungen verwerfen?").
	 */
	get unsavedDescription(): boolean {
		const draft = this.#drafts.get('description');
		return draft !== undefined && this.#ticket !== null && draft !== this.#ticket.description;
	}

	/** Text typed into the tag picker and not yet turned into a tag. */
	get tagInput(): string {
		return this.#tagInput;
	}

	setTagInput(text: string): void {
		this.#tagInput = text;
	}

	/**
	 * True while leaving the panel would lose typed text (question "Änderungen verwerfen?"): a
	 * changed description or a name in the tag picker (E2 plan, section 10; E3 plan, T-14).
	 */
	get hasUnsavedInput(): boolean {
		return this.unsavedDescription || this.#tagInput.trim() !== '';
	}

	/** Adds a tag to the shown ticket and saves the whole list at once (T-14). */
	addTag(id: string): Promise<boolean> {
		const ticket = this.#ticket;
		if (ticket === null || ticket.tagIds.includes(id)) return Promise.resolve(true);
		return this.#saveTags(ticket, [...ticket.tagIds, id]);
	}

	/** Removes a tag from the shown ticket and saves the whole list at once. */
	removeTag(id: string): Promise<boolean> {
		const ticket = this.#ticket;
		if (ticket === null || !ticket.tagIds.includes(id)) return Promise.resolve(true);
		return this.#saveTags(
			ticket,
			ticket.tagIds.filter((tagId) => tagId !== id)
		);
	}

	/**
	 * Makes the shown ticket a sub-task of `parent`, or releases it with null (ADR-0033 section 4).
	 * The hook checks level and scope; a refusal stands at the field `parent`. The list announces
	 * the result as a flag.
	 */
	async setParent(parent: { id: string; key: string } | null): Promise<boolean> {
		const ticket = this.#ticket;
		if (ticket === null) return false;
		const before = ticket.parentId ?? null;
		if ((parent?.id ?? null) === before) return true;
		const saved = await this.#saveField(ticket, 'parent', { parent: parent?.id ?? null });
		if (saved === null) return false;
		this.#list.announce(
			parent === null
				? `${saved.key} ist keine Unteraufgabe mehr.`
				: `${saved.key} ist jetzt eine Unteraufgabe von ${parent.key}.`
		);
		return true;
	}

	/** Switch "Blockiert das übergeordnete Ticket" of a sub-task (ADR-0033 section 2). */
	async setBlocksParent(blocks: boolean): Promise<boolean> {
		const ticket = this.#ticket;
		if (ticket === null) return false;
		if ((ticket.blocksParent ?? true) === blocks) return true;
		return (await this.#saveField(ticket, 'blocksParent', { blocksParent: blocks })) !== null;
	}

	/**
	 * Saves a patch that belongs to one field with its own saving state and error. One save per
	 * field at a time. Returns the saved ticket, or null after a failure (shown at the field).
	 */
	async #saveField(ticket: Ticket, field: FieldKey, patch: TicketPatch): Promise<Ticket | null> {
		if (this.#saving.has(field) || !this.#session.ensureValid()) return null;
		this.#saving.add(field);
		this.#fieldErrors.delete(field);
		try {
			const saved = await this.#data.update(ticket.id, patch);
			this.#list.upsert(saved);
			if (saved.id === this.#id) this.upsert(saved);
			return saved;
		} catch (error) {
			const failure = toDataError(error);
			if (failure.kind === 'session') this.#session.logout();
			else if (failure.kind !== 'aborted' && ticket.id === this.#id) {
				const key = field === 'blocksParent' ? 'blocks_parent' : field;
				this.#fieldErrors.set(field, failure.fields[key]?.message ?? failure.message);
			}
			return null;
		} finally {
			this.#saving.delete(field);
		}
	}

	/**
	 * The pinned comment of the shown ticket (ADR-0044 section 2): null without one, undefined
	 * while the server does not know pins (before the restart) or no ticket is shown.
	 */
	get pinnedComment(): string | null | undefined {
		return this.#ticket?.pinnedComment;
	}

	/** Comment whose pin is being saved, null otherwise. */
	get pinning(): string | null {
		return this.#pinning;
	}

	/** Why pinning or releasing this comment of the shown ticket failed, null otherwise. */
	pinError(commentId: string): string | null {
		const failure = this.#pinFailure;
		return failure !== null && failure.ticketId === this.#id && failure.commentId === commentId
			? failure.message
			: null;
	}

	/**
	 * Pins a comment of the shown ticket. The field holds one comment, so another pinned one is
	 * replaced; the info flag then offers "Rückgängig" (ADR-0044 section 2). One pin at a time.
	 */
	async pin(commentId: string): Promise<boolean> {
		const ticket = this.#ticket;
		if (ticket === null) return false;
		const previous = ticket.pinnedComment ?? null;
		if (previous === commentId) return true;
		const saved = await this.#savePin(ticket, commentId, commentId);
		if (saved === null) return false;
		if (previous !== null) this.#offerPinUndo(saved.id, previous, commentId);
		return true;
	}

	/** Releases the pin of the shown ticket. */
	async unpin(): Promise<boolean> {
		const ticket = this.#ticket;
		const current = ticket?.pinnedComment ?? null;
		if (ticket === null || current === null) return true;
		return (await this.#savePin(ticket, null, current)) !== null;
	}

	/** Sends the pin (`commentId`, null releases it); `target` is the comment of the button. */
	async #savePin(ticket: Ticket, commentId: string | null, target: string): Promise<Ticket | null> {
		if (this.#pinning !== null || !this.#session.ensureValid()) return null;
		this.#pinning = target;
		this.#pinFailure = null;
		try {
			const saved = await this.#data.update(ticket.id, { pinnedComment: commentId });
			this.#list.upsert(saved);
			if (saved.id === this.#id) this.upsert(saved);
			return saved;
		} catch (error) {
			const failure = toDataError(error);
			if (failure.kind === 'session') this.#session.logout();
			else if (failure.kind !== 'aborted' && ticket.id === this.#id) {
				const message = failure.fields.pinned_comment?.message ?? failure.message;
				this.#pinFailure = { ticketId: ticket.id, commentId: target, message };
			}
			return null;
		} finally {
			this.#pinning = null;
		}
	}

	/** Info flag after replacing a pinned comment, with "Rückgängig" for 8 s (ADR-0025 §8). */
	#offerPinUndo(ticketId: string, previous: string, replacement: string): void {
		this.#flags.show({
			tone: 'info',
			title: PIN_FLAGS.replaced,
			action: {
				label: 'Rückgängig',
				run: () => void this.#undoPin(ticketId, previous, replacement)
			}
		});
	}

	/**
	 * "Rückgängig": pins the previous comment again, but only while the replacement is still pinned
	 * (read fresh from the server), so a pin chosen meanwhile, here or in another tab, is never
	 * overwritten. Works for the ticket of the flag, also after the panel moved on.
	 */
	async #undoPin(ticketId: string, previous: string, replacement: string): Promise<void> {
		if (!this.#session.ensureValid()) return;
		try {
			const current = await this.#data.get(ticketId, {});
			if (current.pinnedComment !== replacement) {
				this.#flags.show({ tone: 'info', title: PIN_FLAGS.changed });
				return;
			}
			const saved = await this.#data.update(ticketId, { pinnedComment: previous });
			this.#list.upsert(saved);
			if (saved.id === this.#id) this.upsert(saved);
		} catch (error) {
			const failure = toDataError(error);
			if (failure.kind === 'session') this.#session.logout();
			if (failure.kind === 'session' || failure.kind === 'aborted') return;
			this.#flags.show({
				tone: 'error',
				title: PIN_FLAGS.undoFailed,
				description: failure.fields.pinned_comment?.message ?? failure.message
			});
		}
	}

	/**
	 * Follows the shown ticket live (ADR-0007 sections 2 and 3). A later `open` subscribes to its
	 * ticket; after a reconnection, or a subscription that came only after failed attempts, the
	 * ticket is loaded again without a loading state. Returns the cleanup, which ends every
	 * subscription.
	 */
	connect(live: LiveSource): () => void {
		this.#live = live;
		if (this.#id !== null) this.#follow(this.#id);
		const refresh = () => void this.#refresh();
		const stopReconnect = hold((guard) => live.reconnected(guard(refresh)), {
			recovered: refresh
		});
		return () => {
			stopReconnect();
			this.#stopTicket?.();
			this.#stopTicket = null;
			if (this.#live === live) this.#live = null;
		};
	}

	/** Shows the given ticket; another ID drops drafts and aborts the previous request. */
	open(id: string): void {
		if (id === this.#id && this.#state !== 'error') return;
		this.reset();
		this.#id = id;
		this.#follow(id);
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
		if (ticket.id !== this.#id || this.#state === 'deleted') return;
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
		if (field === 'description') {
			this.#descriptionBase = this.#ticket.description;
			this.#conflict = false;
		}
	}

	setDraft(field: EditableField, value: string): void {
		this.#drafts.set(field, value);
	}

	/** Drops the draft and the error of a field (Escape, "Abbrechen"). */
	cancel(field: EditableField): void {
		this.#drafts.delete(field);
		this.#fieldErrors.delete(field);
		if (field === 'description') {
			this.#descriptionBase = null;
			this.#conflict = false;
		}
	}

	/** Marks a field as invalid without a request (e.g. an incomplete date in the browser). */
	reject(field: FieldKey, message: string): void {
		this.#fieldErrors.set(field, message);
	}

	/**
	 * Saves the draft of a field. Returns true if nothing is left to save. An unchanged draft
	 * ends editing without a request. On failure the draft stays and the field shows the error.
	 * The description is saved only over the version its draft started from (ADR-0032 section 6):
	 * if another one is stored by now, `descriptionConflict` asks what to do; if only other fields
	 * changed meanwhile, the draft is sent once more on the new version.
	 */
	save(field: EditableField): Promise<boolean> {
		return this.#save(field, true);
	}

	/** "Überschreiben": saves the draft of the description over the newer one. */
	overwriteDescription(): Promise<boolean> {
		if (this.#ticket === null || !this.#drafts.has('description')) return Promise.resolve(true);
		this.#descriptionBase = this.#ticket.description;
		this.#conflict = false;
		return this.save('description');
	}

	/** "Verwerfen und neu laden": drops the draft of the description and loads the ticket again. */
	async discardDescription(): Promise<void> {
		this.cancel('description');
		await this.#refresh();
	}

	async #save(field: EditableField, retryStale: boolean): Promise<boolean> {
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
		const base = field === 'description' ? (this.#descriptionBase ?? ticket.description) : null;
		if (base !== null && ticket.description !== base) {
			this.#conflict = true;
			return false;
		}
		// Open blocking sub-tasks: ask first instead of sending (ADR-0033 section 2).
		const completing = field === 'status' && next === 'done' && ticket.status !== 'done';
		const blocking = completing ? this.#blockingOf(ticket.id) : [];
		if (blocking.length > 0) {
			this.#askCompletion(
				ticket.id,
				blocking.length,
				blocking.map((child) => child.key)
			);
			this.cancel(field);
			return false;
		}
		if (!this.#session.ensureValid()) return false;
		this.#saving.add(field);
		this.#fieldErrors.delete(field);
		if (field === 'status') this.#reopen = null;
		let stale = false;
		try {
			const saved =
				base === null
					? await this.#data.update(ticket.id, result.patch)
					: await this.#data.update(ticket.id, result.patch, { expectedUpdated: ticket.updated });
			if (saved.status === 'done' && ticket.status !== 'done') {
				this.#list.completed(saved, ticket.status);
			} else {
				this.#list.upsert(saved);
			}
			// A new project means a new key (T-13); the URL keeps the record ID.
			if (saved.key !== ticket.key) this.#list.announce(`Neuer Key: ${saved.key}`);
			if (saved.id === this.#id) {
				this.upsert(saved);
				if (this.#drafts.get(field) === draft) this.cancel(field);
			}
			// Title, description, priority or project of an open ticket of a series: only this
			// ticket changed; the flag offers the same for the next ones (status and due date never).
			this.#series.offerTemplate([{ before: ticket, after: saved }]);
			return true;
		} catch (error) {
			const failure = toDataError(error);
			const open = completing ? openChildrenOf(failure) : null;
			const refusal = field === 'status' ? reopenRefusalOf(failure) : null;
			if (failure.kind === 'session') this.#session.logout();
			else if (base !== null && isStale(failure)) stale = ticket.id === this.#id;
			else if (open !== null) this.#askCompletion(ticket.id, open.count, open.keys);
			else if (refusal !== null && ticket.id === this.#id && isStatus(next)) {
				this.#reopen = { ticketId: ticket.id, status: next, message: refusal };
			} else if (failure.kind !== 'aborted' && ticket.id === this.#id) {
				this.#fieldErrors.set(field, failure.fields[field]?.message ?? failure.message);
			}
			if (!stale) return false;
		} finally {
			this.#saving.delete(field);
		}
		return this.#afterStaleDescription(ticket.id, base ?? '', retryStale);
	}

	/**
	 * The hook refused the description because the ticket changed meanwhile: loads it, and either
	 * sends the draft once more (only other fields changed) or asks about the conflict.
	 */
	async #afterStaleDescription(id: string, base: string, retry: boolean): Promise<boolean> {
		try {
			this.upsert(await this.#data.get(id, {}));
		} catch (error) {
			const failure = toDataError(error);
			if (failure.kind === 'session') this.#session.logout();
			else if (failure.kind !== 'aborted' && id === this.#id) {
				this.#fieldErrors.set('description', failure.message);
			}
			return false;
		}
		if (id !== this.#id) return false;
		if (retry && this.#ticket?.description === base) return this.#save('description', false);
		this.#conflict = true;
		return false;
	}

	/**
	 * Ticks or unticks task `index` of the description in the view (ADR-0032 section 6); not
	 * while the description is edited or saved. The change goes with `expected_updated`. If the
	 * ticket changed meanwhile but its description is the same, it is sent once more on the new
	 * version; otherwise the result says that the description changed. Ticking is progress of this
	 * ticket like its status, so a ticket of a series offers nothing for its template (plan WV).
	 */
	async toggleTask(index: number, checked: boolean): Promise<TaskResult> {
		const ticket = this.#ticket;
		if (ticket === null || this.#drafts.has('description') || this.#saving.has('description')) {
			return { ok: false, message: null };
		}
		if (!this.#session.ensureValid()) return { ok: false, message: null };
		const source = ticket.description;
		this.#saving.add('description');
		try {
			let base = ticket;
			for (let attempt = 0; attempt < 2; attempt++) {
				const next = toggleTask(base.description, index, checked);
				if (next === null) return { ok: false, message: TASK_STALE_MESSAGE };
				if (next === base.description) return { ok: true };
				try {
					const saved = await this.#data.update(
						base.id,
						{ description: next },
						{ expectedUpdated: base.updated }
					);
					this.#list.upsert(saved);
					this.upsert(saved);
					return { ok: true };
				} catch (error) {
					const failure = toDataError(error);
					if (!isStale(failure) || attempt > 0) throw failure;
				}
				const fresh = await this.#data.get(base.id, {});
				this.upsert(fresh);
				if (fresh.description !== source) return { ok: false, message: TASK_STALE_MESSAGE };
				base = fresh;
			}
			return { ok: false, message: TASK_STALE_MESSAGE };
		} catch (error) {
			const failure = toDataError(error);
			if (failure.kind === 'session') this.#session.logout();
			if (failure.kind === 'session' || failure.kind === 'aborted') {
				return { ok: false, message: null };
			}
			if (isStale(failure)) return { ok: false, message: TASK_STALE_MESSAGE };
			return { ok: false, message: failure.fields.description?.message ?? failure.message };
		} finally {
			this.#saving.delete('description');
		}
	}

	/**
	 * Status, priority and project save at once when chosen (T-7, T-13); a failure restores the
	 * old value and shows the error at the field. A choice during a running save (arrow keys on a
	 * closed select) is saved right after it.
	 */
	async choose(field: ChoiceField, value: string): Promise<void> {
		this.#drafts.set(field, value);
		if (this.#saving.has(field)) return;
		while (this.#drafts.has(field)) {
			if (!(await this.save(field))) {
				this.#drafts.delete(field);
				return;
			}
		}
	}

	/**
	 * Creates a ticket (E2 plan, T-8). The new ticket joins the list at once and becomes the
	 * ticket of the panel, so the route switch to its ID needs no further request. `origin` is
	 * the form by default; with an inbox entry the server converts it (ADR-0014 section 2), and a
	 * refusal of the entry (already handled, not visible) comes back as message.
	 */
	async create(draft: TicketDraft, origin?: TicketOrigin): Promise<CreateResult> {
		const title = draft.title.trim();
		if (title === '')
			return { ok: false, message: null, fields: { title: TITLE_REQUIRED_MESSAGE } };
		if (!this.#session.ensureValid()) return { ok: false, message: null, fields: {} };
		try {
			const ticket = await this.#data.create({ ...draft, title }, origin);
			this.#list.upsert(ticket);
			this.reset();
			this.#id = ticket.id;
			this.#follow(ticket.id);
			this.#own = ticket;
			this.#state = 'ready';
			return { ok: true, ticket };
		} catch (error) {
			const failure = toDataError(error);
			if (failure.kind === 'session') this.#session.logout();
			if (failure.kind === 'session' || failure.kind === 'aborted') {
				return { ok: false, message: null, fields: {} };
			}
			const fields: Partial<Record<keyof TicketDraft, string>> = {};
			for (const field of DRAFT_FIELDS) {
				const message = failure.fields[field]?.message;
				if (message !== undefined) fields[field] = message;
			}
			const known = Object.keys(fields).length > 0;
			const itemMessage = failure.fields.source_item?.message;
			if (itemMessage !== undefined) return { ok: false, message: itemMessage, fields };
			return { ok: false, message: known ? null : failure.message, fields };
		}
	}

	/**
	 * Moves the shown ticket with its sub-tasks to the trash (ADR-0037; before its migration the
	 * server deletes for good as in E2). On success the ticket leaves the list and a flag says so,
	 * with "Rückgängig" when the server answered the move. A ticket that is already gone (404)
	 * counts as deleted. Any other failure keeps the ticket. The sources go back to the inbox or
	 * stay with the ticket as chosen (ADR-0031, addendum B), and the flag says so.
	 */
	async deleteTicket(sources?: DeleteSources): Promise<DeleteResult> {
		const ticket = this.#ticket;
		if (ticket === null) return { ok: false, message: null };
		// Its delete event is the own one, not a deletion elsewhere.
		this.#deletingId = ticket.id;
		const result = await moveTicketToTrash(
			{
				delete: (id, handling) => this.#data.delete(id, handling),
				session: this.#session,
				list: this.#list,
				trash: this.#trash
			},
			ticket,
			sources
		);
		if (!result.ok && this.#deletingId === ticket.id) this.#deletingId = null;
		return result;
	}

	/** Empties the store, ends the subscription and aborts a running request. */
	reset(): void {
		this.#controller?.abort();
		this.#controller = null;
		this.#stopTicket?.();
		this.#stopTicket = null;
		this.#deletingId = null;
		this.#drafts.clear();
		this.#saving.clear();
		this.#fieldErrors.clear();
		this.#descriptionBase = null;
		this.#conflict = false;
		this.#completion = null;
		this.#reopen = null;
		this.#pinning = null;
		this.#pinFailure = null;
		this.#tagInput = '';
		this.#id = null;
		this.#own = null;
		this.#state = 'idle';
		this.#error = null;
		this.#movedAway = false;
	}

	/**
	 * Saves the tags of a ticket. One save at a time: a change during a running save is refused
	 * (the picker is locked meanwhile). A failure keeps the old tags and shows the error.
	 */
	async #saveTags(ticket: Ticket, tags: string[]): Promise<boolean> {
		if (this.#saving.has('tags')) return false;
		if (!this.#session.ensureValid()) return false;
		this.#saving.add('tags');
		this.#fieldErrors.delete('tags');
		try {
			const saved = await this.#data.update(ticket.id, { tags });
			this.#list.upsert(saved);
			if (saved.id === this.#id) this.upsert(saved);
			this.#series.offerTemplate([{ before: ticket, after: saved }]);
			return true;
		} catch (error) {
			const failure = toDataError(error);
			if (failure.kind === 'session') this.#session.logout();
			else if (failure.kind !== 'aborted' && ticket.id === this.#id) {
				this.#fieldErrors.set('tags', failure.fields.tags?.message ?? failure.message);
			}
			return false;
		} finally {
			this.#saving.delete('tags');
		}
	}

	/** Subscribes to the shown ticket (updates with description, deletion elsewhere). */
	#follow(id: string): void {
		this.#stopTicket?.();
		this.#stopTicket = null;
		const live = this.#live;
		if (live === null) return;
		this.#stopTicket = hold(
			(guard) =>
				live.ticket(
					id,
					guard((change) => {
						if (change.action !== 'delete') this.upsert(change.record);
						else if (change.id === this.#id && change.id !== this.#deletingId) {
							this.#gone(change.moved === true);
						}
					})
				),
			{ recovered: () => void this.#refresh() }
		);
	}

	/**
	 * The shown ticket was deleted elsewhere: the panel says so instead of vanishing. Drafts go,
	 * because there is nothing left to save them to. `moved`: it went into an area this account does
	 * not see (E7-4), and the panel says that instead.
	 */
	#gone(moved = false): void {
		this.#controller?.abort();
		this.#controller = null;
		this.#drafts.clear();
		this.#saving.clear();
		this.#fieldErrors.clear();
		this.#state = 'deleted';
		this.#error = null;
		this.#movedAway = moved;
	}

	/**
	 * Loads the shown ticket again after a reconnection, without a loading state; drafts stay.
	 * A ticket that is gone by now counts as deleted.
	 */
	async #refresh(): Promise<void> {
		const id = this.#id;
		if (id === null || this.#state === 'deleted' || this.#state === 'not_found') return;
		if (this.#state !== 'ready') {
			await this.reload();
			return;
		}
		if (!this.#session.ensureValid()) return;
		this.#controller?.abort();
		const controller = new AbortController();
		this.#controller = controller;
		try {
			const ticket = await this.#data.get(id, { signal: controller.signal });
			if (!controller.signal.aborted) this.upsert(ticket);
		} catch (error) {
			if (controller.signal.aborted) return;
			const failure = toDataError(error);
			if (failure.kind === 'session') this.#session.logout();
			else if (failure.kind === 'not_found' || failure.kind === 'forbidden') this.#gone();
		} finally {
			if (this.#controller === controller) this.#controller = null;
		}
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
