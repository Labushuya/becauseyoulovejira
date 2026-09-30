// "Ticket duplizieren" (ADR-0045) for the (app) layout: sends the answered question to the route,
// which creates the duplicate with everything chosen in one transaction, and shows the result as a
// flag "HAUS-12 dupliziert." with the way back to the original. Opening the duplicate is the
// caller's part (it knows the remembered way to open a ticket, ADR-0036 §1). The new tickets reach
// the lists by realtime like any other.

import type PocketBase from 'pocketbase';
import { createContext } from 'svelte';
import { toDataError } from '$lib/data/errors';
import { duplicateTicket } from '$lib/data/tickets';
import {
	duplicatedFlag,
	type DuplicateField,
	type DuplicateOutcome,
	type DuplicateRequest
} from '$lib/domain/duplicate';
import { SILENT_FLAGS, type FlagSink } from './flags.svelte';
import type { SessionGuard } from './ticket-list.svelte';

export interface TicketDuplicateData {
	duplicate(id: string, request: DuplicateRequest): Promise<DuplicateOutcome>;
}

export function ticketDuplicateData(pb: PocketBase): TicketDuplicateData {
	return { duplicate: (id, request) => duplicateTicket(pb, id, request) };
}

/** Outcome of a duplication; a refusal carries errors per field and/or a message. */
export type DuplicateResult =
	| { ok: true; outcome: DuplicateOutcome }
	| { ok: false; message: string | null; fields: Partial<Record<DuplicateField, string>> };

const FIELDS: readonly DuplicateField[] = ['title', 'status', 'project', 'source'];

/** The original is gone or in the trash meanwhile (404). */
export const DUPLICATE_GONE = 'Das Ticket gibt es nicht mehr, oder es liegt im Papierkorb.';

export class TicketDuplicateStore {
	readonly #data: TicketDuplicateData;
	readonly #session: SessionGuard;
	readonly #flags: FlagSink;

	constructor(data: TicketDuplicateData, session: SessionGuard, flags: FlagSink = SILENT_FLAGS) {
		this.#data = data;
		this.#session = session;
		this.#flags = flags;
	}

	/**
	 * Duplicates `original` as asked. On success the flag names both keys and offers to open the
	 * original again (`open`); a refusal of the server comes back per field (title, status, project,
	 * source), anything else as a message. Without a session nothing is sent.
	 */
	async duplicate(
		original: { id: string; key: string },
		request: DuplicateRequest,
		open: (ticketId: string) => void
	): Promise<DuplicateResult> {
		if (!this.#session.ensureValid()) return { ok: false, message: null, fields: {} };
		try {
			const outcome = await this.#data.duplicate(original.id, request);
			const flag = duplicatedFlag(original.key, outcome.key);
			this.#flags.show({
				tone: 'success',
				title: flag.title,
				description: flag.description,
				action: { label: flag.action, run: () => open(original.id) }
			});
			return { ok: true, outcome };
		} catch (error) {
			const failure = toDataError(error);
			if (failure.kind === 'session') this.#session.logout();
			if (failure.kind === 'session' || failure.kind === 'aborted') {
				return { ok: false, message: null, fields: {} };
			}
			if (failure.kind === 'not_found') return { ok: false, message: DUPLICATE_GONE, fields: {} };
			const fields: Partial<Record<DuplicateField, string>> = {};
			const others: string[] = [];
			for (const [name, entry] of Object.entries(failure.fields)) {
				const field = FIELDS.find((candidate) => candidate === name);
				if (field === undefined) others.push(entry.message);
				else fields[field] = entry.message;
			}
			const message = others[0] ?? (Object.keys(fields).length === 0 ? failure.message : null);
			return { ok: false, message, fields };
		}
	}
}

const [getTicketDuplicateStore, setTicketDuplicateStore, hasTicketDuplicateStore] =
	createContext<TicketDuplicateStore>();

/** The store of the (app) layout, or null outside it (tests of single components). */
export function findTicketDuplicateStore(): TicketDuplicateStore | null {
	return hasTicketDuplicateStore() ? getTicketDuplicateStore() : null;
}

export { setTicketDuplicateStore };
