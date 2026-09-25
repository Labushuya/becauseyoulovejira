// Saving a capture (E4 plan, packages 5 and 6; OF-E4-3): resolve the tags of the template through
// the catalog, then create the ticket (source "manual" or "quick") or the inbox entry. Without
// runes and SDK: the route passes the store methods, the tests pass fakes.

import type { InboxDraft } from '$lib/domain/inbox';
import {
	captureInboxDraft,
	captureTicketDraft,
	type Capture,
	type CaptureErrors,
	type CaptureField,
	type CaptureTarget
} from '$lib/domain/templates';
import type { Ticket, TicketDraft } from '$lib/domain/ticket';
import type { EnsureTagResult } from './catalog.svelte';
import type { InboxCreateResult } from './inbox.svelte';
import type { CreateResult } from './ticket-detail.svelte';

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
