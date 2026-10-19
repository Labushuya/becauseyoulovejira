// "Ticket duplizieren" (ADR-0045) for the (app) layout: sends the answered question to the route,
// which creates the duplicate with everything chosen in one transaction, and shows the result as a
// flag "HAUS-12 dupliziert." with the way back to the original. Opening the duplicate is the
// caller's part (it knows the remembered way to open a ticket, ADR-0036 §1). The new tickets reach
// the lists by realtime like any other. Since MV-2 (ADR-0045, addendum MV-2) the duplicate may go
// into the other area: the store loads its projects and tags first, and the flag of a duplicate there
// leads to it instead of back to the original. Since UT-2 it says whether the server takes the status
// of the new sub-tasks, from the answer of GET /api/byl/tickets/create the TicketDetailStore keeps.

import type PocketBase from 'pocketbase';
import { createContext } from 'svelte';
import { problemDetails, toDataError } from '$lib/data/errors';
import type { ProblemEntry } from '$lib/domain/problems';
import { duplicateTicket, fetchDuplicateTarget } from '$lib/data/tickets';
import {
	duplicatedElsewhereFlag,
	duplicatedFlag,
	type DuplicateArea,
	type DuplicateField,
	type DuplicateOutcome,
	type DuplicateRequest,
	type DuplicateTarget
} from '$lib/domain/duplicate';
import type { CreateSupport } from '$lib/domain/ticket-create';
import { restartNeeded } from '$lib/guidance/texts';
import { SILENT_FLAGS, type FlagSink } from './flags.svelte';
import type { SessionGuard } from './ticket-list.svelte';

/**
 * What the store reads of the options the server knows (UT-2): the TicketDetailStore of the (app)
 * layout, which asks GET /api/byl/tickets/create.
 */
export interface DuplicateSupportSource {
	readonly createSupport: CreateSupport | null | undefined;
	readonly createSupportProblem: string | null;
	readonly createSupportLoading: boolean;
	loadCreateSupport(): Promise<void>;
}

/**
 * Whether the question may offer "Status der Unteraufgaben" (UT-2): the server takes it (`ready`),
 * answered without it or knows no such question at all (`missing`, before the restart), the answer
 * is still out (`pending`), or the question failed (`failed`: unknown, not missing).
 */
export type SubtaskStatusSupport = 'ready' | 'missing' | 'pending' | 'failed';

export interface TicketDuplicateData {
	duplicate(id: string, request: DuplicateRequest): Promise<DuplicateOutcome>;
	/** Projects and tags of the other area (MV-2); a store without it offers no other area. */
	target?(id: string, to: DuplicateArea): Promise<DuplicateTarget>;
}

export function ticketDuplicateData(pb: PocketBase): TicketDuplicateData {
	return {
		duplicate: (id, request) => duplicateTicket(pb, id, request),
		target: (id, to) => fetchDuplicateTarget(pb, id, to)
	};
}

/**
 * Outcome of a duplication; a refusal carries errors per field and/or a message, and the failed
 * request for "Details" (`problem`, FP-1, ADR-0071).
 */
export type DuplicateResult =
	| { ok: true; outcome: DuplicateOutcome }
	| {
			ok: false;
			message: string | null;
			fields: Partial<Record<DuplicateField, string>>;
			problem?: ProblemEntry;
	  };

/** The projects and tags of the other area, or why they could not be loaded (MV-2). */
export type DuplicateTargetResult =
	| { ok: true; target: DuplicateTarget }
	| { ok: false; message: string | null; problem?: ProblemEntry };

const FIELDS: readonly DuplicateField[] = ['title', 'status', 'project', 'source', 'to'];

/** The original is gone or in the trash meanwhile (404). */
export const DUPLICATE_GONE = 'Das Ticket gibt es nicht mehr, oder es liegt im Papierkorb.';

export class TicketDuplicateStore {
	readonly #data: TicketDuplicateData;
	readonly #session: SessionGuard;
	readonly #flags: FlagSink;
	readonly #support: DuplicateSupportSource | null;

	constructor(
		data: TicketDuplicateData,
		session: SessionGuard,
		flags: FlagSink = SILENT_FLAGS,
		support: DuplicateSupportSource | null = null
	) {
		this.#data = data;
		this.#session = session;
		this.#flags = flags;
		this.#support = support;
	}

	/** Whether the question may offer the other area (MV-2): the data layer can load it. */
	get offersAreas(): boolean {
		return this.#data.target !== undefined;
	}

	/**
	 * Whether the server takes the status of the new sub-tasks (UT-2). Without a source (tests of
	 * single parts) it is `missing`, and the sub-tasks start open as before.
	 */
	get subtaskStatusSupport(): SubtaskStatusSupport {
		const source = this.#support;
		if (source === null) return 'missing';
		const known = source.createSupport;
		if (known?.duplicateSubtaskStatus === true) return 'ready';
		if (source.createSupportProblem !== null) return 'failed';
		if (known === undefined || source.createSupportLoading) return 'pending';
		return 'missing';
	}

	/** Why the question failed (`failed`), null otherwise. */
	get subtaskStatusProblem(): string | null {
		return this.subtaskStatusSupport === 'failed'
			? (this.#support?.createSupportProblem ?? null)
			: null;
	}

	/** The question runs ("Erneut versuchen" shows it). */
	get subtaskStatusLoading(): boolean {
		return this.#support?.createSupportLoading ?? false;
	}

	/**
	 * Asks the server what it knows, unless it named everything already: on every opening of the
	 * question with sub-tasks and for "Erneut versuchen" (UT-2, K3).
	 */
	async loadSupport(): Promise<void> {
		await this.#support?.loadCreateSupport();
	}

	/**
	 * The projects and tags of the other area for the question (MV-2); a refusal or a failure as a
	 * message (before the restart: the hint to restart), nothing without a session.
	 */
	async target(id: string, to: DuplicateArea): Promise<DuplicateTargetResult> {
		const load = this.#data.target;
		if (load === undefined || !this.#session.ensureValid()) return { ok: false, message: null };
		try {
			return { ok: true, target: await load(id, to) };
		} catch (error) {
			const failure = toDataError(error);
			if (failure.kind === 'session') this.#session.logout();
			if (failure.kind === 'session' || failure.kind === 'aborted') {
				return { ok: false, message: null };
			}
			if (failure.kind === 'not_found') {
				return {
					ok: false,
					message: restartNeeded('Das Duplizieren in einen anderen Bereich ist')
				};
			}
			const field = Object.values(failure.fields)[0];
			return { ok: false, message: field?.message ?? failure.message, ...problemDetails(failure) };
		}
	}

	/**
	 * Duplicates `original` as asked. On success the flag names both keys and offers to open the
	 * original again (`open`), after a duplicate into the other area (MV-2) the duplicate; a refusal
	 * of the server comes back per field (title, status, project, source, to), anything else as a
	 * message. Without a session nothing is sent.
	 */
	async duplicate(
		original: { id: string; key: string },
		request: DuplicateRequest,
		open: (ticketId: string) => void
	): Promise<DuplicateResult> {
		if (!this.#session.ensureValid()) return { ok: false, message: null, fields: {} };
		try {
			const outcome = await this.#data.duplicate(original.id, request);
			const to = request.to;
			const flag =
				to === undefined
					? duplicatedFlag(original.key, outcome.key)
					: duplicatedElsewhereFlag(original.key, outcome.key, to);
			const target = to === undefined ? original.id : outcome.id;
			this.#flags.show({
				tone: 'success',
				title: flag.title,
				description: flag.description,
				action: { label: flag.action, run: () => open(target) }
			});
			return { ok: true, outcome };
		} catch (error) {
			const failure = toDataError(error);
			if (failure.kind === 'session') this.#session.logout();
			if (failure.kind === 'session' || failure.kind === 'aborted') {
				return { ok: false, message: null, fields: {} };
			}
			if (failure.kind === 'not_found') {
				return { ok: false, message: DUPLICATE_GONE, fields: {}, ...problemDetails(failure) };
			}
			const fields: Partial<Record<DuplicateField, string>> = {};
			const others: string[] = [];
			for (const [name, entry] of Object.entries(failure.fields)) {
				const field = FIELDS.find((candidate) => candidate === name);
				if (field === undefined) others.push(entry.message);
				else fields[field] = entry.message;
			}
			const message = others[0] ?? (Object.keys(fields).length === 0 ? failure.message : null);
			return { ok: false, message, fields, ...problemDetails(failure) };
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
