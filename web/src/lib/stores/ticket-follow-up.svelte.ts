// "Folge-Ticket anlegen …" (QT-1, ADR-0067 §4) for the (app) layout: sends the answered question to
// the route, which creates the new ticket and its link to the source in one transaction, and shows
// the result as a flag "Folge-Ticket HAUS-21 angelegt." with the way back to the source. Opening the
// new ticket is the caller's part (it knows the remembered way to open a ticket, ADR-0036 §1). The
// new ticket reaches the lists by realtime like any other.

import type PocketBase from 'pocketbase';
import { createContext } from 'svelte';
import { toDataError } from '$lib/data/errors';
import { createFollowUp } from '$lib/data/ticket-origins';
import {
	followUpFlag,
	type FollowUpOutcome,
	type FollowUpRequest
} from '$lib/domain/ticket-origins';
import { restartNeeded } from '$lib/guidance/texts';
import { SILENT_FLAGS, type FlagSink } from './flags.svelte';
import { DUPLICATE_GONE } from './ticket-duplicate.svelte';
import type { SessionGuard } from './ticket-list.svelte';

export interface TicketFollowUpData {
	create(sourceId: string, request: FollowUpRequest): Promise<FollowUpOutcome>;
}

export function ticketFollowUpData(pb: PocketBase): TicketFollowUpData {
	return { create: (sourceId, request) => createFollowUp(pb, sourceId, request) };
}

/** Outcome of the question; a refusal carries the error of the title and/or a message. */
export type FollowUpResult =
	| { ok: true; outcome: FollowUpOutcome }
	| { ok: false; message: string | null; title: string | null };

export class TicketFollowUpStore {
	readonly #data: TicketFollowUpData;
	readonly #session: SessionGuard;
	readonly #flags: FlagSink;

	constructor(data: TicketFollowUpData, session: SessionGuard, flags: FlagSink = SILENT_FLAGS) {
		this.#data = data;
		this.#session = session;
		this.#flags = flags;
	}

	/**
	 * Creates a follow-up of `source` as asked. On success the flag names the new key and offers to
	 * open the source again (`open`); a refusal of the title comes back at the field, anything else
	 * (the source gone or in the trash, no right in the area, before the restart) as a message.
	 */
	async create(
		source: { id: string; key: string },
		request: FollowUpRequest,
		open: (ticketId: string) => void
	): Promise<FollowUpResult> {
		if (!this.#session.ensureValid()) return { ok: false, message: null, title: null };
		try {
			const outcome = await this.#data.create(source.id, request);
			const flag = followUpFlag(source.key, outcome.key);
			this.#flags.show({
				tone: 'success',
				title: flag.title,
				description: flag.description,
				action: { label: flag.action, run: () => open(source.id) }
			});
			return { ok: true, outcome };
		} catch (error) {
			const failure = toDataError(error);
			if (failure.kind === 'session') this.#session.logout();
			if (failure.kind === 'session' || failure.kind === 'aborted') {
				return { ok: false, message: null, title: null };
			}
			if (failure.kind === 'not_found') return { ok: false, message: DUPLICATE_GONE, title: null };
			if (failure.status === 503) {
				// Before the migration of ADR-0067 (the instance still waits for its restart).
				return { ok: false, message: restartNeeded('„Folge-Ticket anlegen“ ist'), title: null };
			}
			const title = failure.fields.title?.message ?? null;
			const other = Object.entries(failure.fields).find(([name]) => name !== 'title')?.[1];
			const message = other?.message ?? (title === null ? failure.message : null);
			return { ok: false, message, title };
		}
	}
}

const [getTicketFollowUpStore, setTicketFollowUpStore, hasTicketFollowUpStore] =
	createContext<TicketFollowUpStore>();

/** The store of the (app) layout, or null outside it (tests of single components). */
export function findTicketFollowUpStore(): TicketFollowUpStore | null {
	return hasTicketFollowUpStore() ? getTicketFollowUpStore() : null;
}

export { getTicketFollowUpStore, setTicketFollowUpStore };
