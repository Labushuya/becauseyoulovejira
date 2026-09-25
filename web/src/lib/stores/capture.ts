// Saving a capture (E4 plan, packages 5 and 6; OF-E4-3): resolve the tags of the template through
// the catalog, then create the ticket (source "manual" or "quick") or the inbox entry. Without
// runes and SDK: the route passes the store methods, the tests pass fakes.

import type PocketBase from 'pocketbase';
import { toDataError } from '$lib/data/errors';
import { createTicket } from '$lib/data/tickets';
import { PRESET_META_KEY, presetMeta, type InboxDraft } from '$lib/domain/inbox';
import type { QuickEntry } from '$lib/domain/quick-syntax';
import {
	captureInboxDraft,
	captureTicketDraft,
	type Capture,
	type CaptureErrors,
	type CaptureField,
	type CaptureTarget
} from '$lib/domain/templates';
import {
	DEFAULT_PRIORITY,
	DEFAULT_STATUS,
	QUICK_ORIGIN,
	type Ticket,
	type TicketDraft,
	type TicketSummary
} from '$lib/domain/ticket';
import type { EnsureTagResult } from './catalog.svelte';
import type { InboxCreateResult } from './inbox.svelte';
import { TITLE_REQUIRED_MESSAGE, type CreateResult } from './ticket-detail.svelte';
import type { SessionGuard } from './ticket-list.svelte';

export interface CaptureDeps {
	/** Existing or new tag of the catalog for a name (catalog.ensureTag). */
	ensureTag(name: string): Promise<EnsureTagResult>;
	/** Creates the ticket with its source (TicketDetailStore.create). */
	createTicket(draft: TicketDraft): Promise<CreateResult>;
	/** Creates the inbox entry (InboxStore.create). */
	createItem(draft: InboxDraft): Promise<InboxCreateResult>;
	/** A ticket created one by one is read (ADR-0015 section 3). */
	markRead(ticket: Ticket): unknown;
}

export type CaptureSaveResult =
	| { ok: true; target: 'ticket'; id: string; message: string }
	| { ok: true; target: 'inbox'; id: string; message: string }
	| { ok: false; message: string | null; fields: CaptureErrors };

/** Field of the form that shows a failure of a ticket field. */
function formField(template: Capture['template'], field: keyof TicketDraft): CaptureField | null {
	switch (field) {
		case 'title':
			return template === 'call' ? 'who' : template === 'shopping' ? 'items' : 'what';
		case 'due':
		case 'priority':
		case 'project':
			return field;
		case 'tags':
			return 'tags';
		default:
			return null;
	}
}

/** Resolves the tag names of the template; the first failure stops the save. */
async function templateTags(
	capture: Capture,
	deps: CaptureDeps
): Promise<{ ok: true; ids: string[] } | { ok: false; message: string | null }> {
	const ids: string[] = [];
	for (const name of capture.tagNames) {
		const result = await deps.ensureTag(name);
		if (!result.ok) {
			return {
				ok: false,
				message: result.message === null ? null : `Tag „${name}“: ${result.message}`
			};
		}
		ids.push(result.tag.id);
	}
	return { ok: true, ids };
}

/**
 * Saves a checked capture where the user wants it: as ticket (announced with its key) or as
 * inbox entry. Failures come back per field of the form where one fits, else as message.
 */
export async function saveCapture(
	capture: Capture,
	target: CaptureTarget,
	deps: CaptureDeps
): Promise<CaptureSaveResult> {
	const tags = await templateTags(capture, deps);
	if (!tags.ok) return { ok: false, message: tags.message, fields: {} };

	if (target === 'inbox') {
		const result = await deps.createItem(captureInboxDraft(capture, tags.ids));
		if (result.kind === 'created') {
			return {
				ok: true,
				target,
				id: result.item.id,
				message: `„${result.item.title}“ liegt im Eingang.`
			};
		}
		if (result.kind === 'duplicate') return { ok: false, message: result.message, fields: {} };
		return { ok: false, message: result.message ?? inboxFieldMessage(result.fields), fields: {} };
	}

	const result = await deps.createTicket(captureTicketDraft(capture, tags.ids));
	if (result.ok) {
		void deps.markRead(result.ticket);
		return {
			ok: true,
			target,
			id: result.ticket.id,
			message: `Ticket ${result.ticket.key} angelegt.`
		};
	}
	const fields: CaptureErrors = {};
	const rest: string[] = [];
	for (const [field, message] of Object.entries(result.fields) as [keyof TicketDraft, string][]) {
		const target = formField(capture.template, field);
		if (target === null) rest.push(message);
		else fields[target] = message;
	}
	const message = result.message ?? (rest.length > 0 ? rest.join(' ') : null);
	return { ok: false, message, fields };
}

/** An inbox field error has no field in the form (the entry keeps title and text only). */
function inboxFieldMessage(fields: Readonly<Record<string, string>>): string | null {
	const messages = Object.values(fields);
	return messages.length === 0 ? null : messages.join(' ');
}

/** Tags of a quick entry: existing ones by ID, new names through the catalog. */
async function quickTags(
	entry: QuickEntry,
	deps: Pick<CaptureDeps, 'ensureTag'>
): Promise<{ ok: true; ids: string[] } | { ok: false; message: string | null }> {
	const ids: string[] = [];
	for (const tag of entry.tags) {
		if (tag.existing !== null) {
			ids.push(tag.existing.id);
			continue;
		}
		const result = await deps.ensureTag(tag.name);
		if (!result.ok) {
			return {
				ok: false,
				message: result.message === null ? null : `Tag „${tag.name}“: ${result.message}`
			};
		}
		ids.push(result.tag.id);
	}
	return { ok: true, ids: [...new Set(ids)] };
}

/**
 * Saves a line of the quick entry (E4 plan, package 6; OF-E4-3): Enter creates a ticket with
 * source "quick", Alt+Enter an inbox entry with channel "quick" whose project, tags and priority
 * travel as preset. `createTicket` of the deps is expected to send the source "quick".
 */
export async function saveQuickEntry(
	entry: QuickEntry,
	target: CaptureTarget,
	deps: CaptureDeps
): Promise<CaptureSaveResult> {
	if (entry.title === '') return { ok: false, message: TITLE_REQUIRED_MESSAGE, fields: {} };
	const tags = await quickTags(entry, deps);
	if (!tags.ok) return { ok: false, message: tags.message, fields: {} };
	const project = entry.project?.id ?? null;

	if (target === 'inbox') {
		const preset = presetMeta({ project, tagIds: tags.ids, priority: entry.priority, due: null });
		const result = await deps.createItem({
			channel: 'quick',
			kind: 'todo',
			title: entry.title,
			...(Object.keys(preset).length > 0 && { sourceMeta: { [PRESET_META_KEY]: preset } })
		});
		if (result.kind === 'created') {
			return {
				ok: true,
				target,
				id: result.item.id,
				message: `„${result.item.title}“ liegt im Eingang.`
			};
		}
		if (result.kind === 'duplicate') return { ok: false, message: result.message, fields: {} };
		return { ok: false, message: result.message ?? inboxFieldMessage(result.fields), fields: {} };
	}

	const result = await deps.createTicket({
		title: entry.title,
		description: '',
		status: DEFAULT_STATUS,
		priority: entry.priority ?? DEFAULT_PRIORITY,
		due: null,
		project,
		tags: tags.ids
	});
	if (!result.ok) {
		const messages = Object.values(result.fields);
		return {
			ok: false,
			message: result.message ?? (messages.length > 0 ? messages.join(' ') : null),
			fields: {}
		};
	}
	void deps.markRead(result.ticket);
	return {
		ok: true,
		target,
		id: result.ticket.id,
		message: `Ticket ${result.ticket.key} angelegt.`
	};
}

/**
 * Creates a ticket outside of the panel (quick entry): the answer joins the list at once, the
 * panel store stays untouched, so an open ticket panel keeps its state. Failures come back like
 * those of TicketDetailStore.create; a session failure ends the session.
 */
export function panelFreeTicketCreate(
	create: (draft: TicketDraft) => Promise<Ticket>,
	session: SessionGuard,
	list: { upsert(ticket: TicketSummary): void }
): (draft: TicketDraft) => Promise<CreateResult> {
	return async (draft) => {
		const title = draft.title.trim();
		if (title === '')
			return { ok: false, message: null, fields: { title: TITLE_REQUIRED_MESSAGE } };
		if (!session.ensureValid()) return { ok: false, message: null, fields: {} };
		try {
			const ticket = await create({ ...draft, title });
			list.upsert(ticket);
			return { ok: true, ticket };
		} catch (error) {
			const failure = toDataError(error);
			if (failure.kind === 'session') session.logout();
			if (failure.kind === 'session' || failure.kind === 'aborted') {
				return { ok: false, message: null, fields: {} };
			}
			const fields: Partial<Record<keyof TicketDraft, string>> = {};
			for (const [field, detail] of Object.entries(failure.fields)) {
				fields[field as keyof TicketDraft] = detail.message;
			}
			return {
				ok: false,
				message: Object.keys(fields).length > 0 ? null : failure.message,
				fields
			};
		}
	};
}

/** Outcome of putting several drafts into the inbox one after the other. */
export interface DraftsOutcome {
	created: number;
	/** Drafts that were in the inbox already (only link, mail and similar sources). */
	duplicates: number;
	failures: { title: string; message: string }[];
}

/**
 * Puts drafts into the inbox one after the other (clipboard, later files); a failure is kept with
 * its reason and the others go on. A session failure (no message) stops the rest.
 */
export async function saveDrafts(
	drafts: readonly InboxDraft[],
	createItem: (draft: InboxDraft) => Promise<InboxCreateResult>
): Promise<DraftsOutcome> {
	const outcome: DraftsOutcome = { created: 0, duplicates: 0, failures: [] };
	for (const draft of drafts) {
		const result = await createItem(draft);
		if (result.kind === 'created') outcome.created += 1;
		else if (result.kind === 'duplicate') outcome.duplicates += 1;
		else {
			const message = result.message ?? inboxFieldMessage(result.fields);
			if (message === null) break;
			outcome.failures.push({ title: draft.title, message });
		}
	}
	return outcome;
}

/** Text of a drafts outcome for the live region, e.g. "3 Einträge im Eingang, 1 schon vorhanden." */
export function draftsSummary(outcome: DraftsOutcome): string {
	const parts = [
		outcome.created === 1 ? '1 Eintrag im Eingang' : `${outcome.created} Einträge im Eingang`
	];
	if (outcome.duplicates > 0) parts.push(`${outcome.duplicates} schon vorhanden`);
	if (outcome.failures.length > 0) parts.push(`${outcome.failures.length} fehlgeschlagen`);
	return `${parts.join(', ')}.`;
}

/** Ticket creation of the quick entry, bound to the client: source "quick". */
export function quickTicketData(pb: PocketBase): (draft: TicketDraft) => Promise<Ticket> {
	return (draft) => createTicket(pb, draft, { origin: QUICK_ORIGIN });
}
