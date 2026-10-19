// "Auf Unteraufgaben übertragen …" (UE-1, ADR-0070) for the (app) layout: sends the confirmed choice
// of the dialog to the route, which changes the sub-tasks in one transaction or not at all, and shows
// the result as a flag "Auf 3 Unteraufgaben übertragen."; the lists follow by realtime. A refusal comes
// back as a message for the dialog (with the key of the sub-task a hook refused). The fields of the
// last confirmed choice are a preference of this device in localStorage (never the project); blocked
// or full storage never breaks the dialog, the choice then lasts for this page. Whether the server
// knows the route comes from the answer of GET /api/byl/tickets/create the TicketDetailStore keeps
// (`subtask_transfer`); before the restart the dialog shows the hint instead of sending.

import type PocketBase from 'pocketbase';
import { createContext } from 'svelte';
import { problemOf, toDataError, withIntent } from '$lib/data/errors';
import { transferToSubtasks } from '$lib/data/subtask-transfer';
import type { ProblemEntry } from '$lib/domain/problems';

/** The intent in "Details" of a failed transfer (FP-1, ADR-0071), the action of the dialog. */
const TRANSFER_INTENT = 'Unteraufgaben übertragen';
import {
	DEFAULT_TRANSFER_FIELDS,
	SUBTASK_TRANSFER_STORAGE_KEY,
	TRANSFER_MESSAGES,
	TRANSFER_STALE_MESSAGE,
	parseRememberedFields,
	rememberedOf,
	serializeRememberedFields,
	targetFailureText,
	transferredText,
	type TransferField,
	type TransferOutcome,
	type TransferRequest
} from '$lib/domain/subtask-transfer';
import type { CreateSupport } from '$lib/domain/ticket-create';
import { SILENT_FLAGS, type FlagSink } from './flags.svelte';
import type { SessionGuard } from './ticket-list.svelte';

/** What the store reads of the options the server knows: the TicketDetailStore of the layout. */
export interface TransferSupportSource {
	readonly createSupport: CreateSupport | null | undefined;
	readonly createSupportProblem: string | null;
	/** The failed request behind `createSupportProblem` (FP-1, ADR-0071). */
	readonly createSupportFailure?: ProblemEntry | null;
	readonly createSupportLoading: boolean;
	loadCreateSupport(): Promise<void>;
}

export interface SubtaskTransferData {
	/** The answer of the route, or null while the server does not know it (before the restart). */
	transfer(parentId: string, request: TransferRequest): Promise<TransferOutcome | null>;
}

export function subtaskTransferData(pb: PocketBase): SubtaskTransferData {
	return { transfer: (parentId, request) => transferToSubtasks(pb, parentId, request) };
}

/**
 * Whether the dialog may send: the server knows the route (`ready`), does not know it yet (`missing`,
 * before the restart), the answer is still out (`pending`), or the question failed (`failed`).
 */
export type TransferSupport = 'ready' | 'missing' | 'pending' | 'failed';

/**
 * The result of a transfer; `missing` when the server does not know the route yet, `stale` when the
 * parent changed meanwhile (409: sending again cannot help, the dialog has to be opened anew). A
 * refusal carries the failed request behind its message for "Details" (`problem`, FP-1).
 */
export type TransferResult =
	| { ok: true; outcome: TransferOutcome }
	| {
			ok: false;
			message: string | null;
			missing: boolean;
			stale?: boolean;
			problem?: ProblemEntry | null;
	  };

type PrefStorage = Pick<Storage, 'getItem' | 'setItem'>;

function storageOf(win: Window | null): PrefStorage | null {
	try {
		return win?.localStorage ?? null;
	} catch {
		return null;
	}
}

export class SubtaskTransferStore {
	readonly #data: SubtaskTransferData;
	readonly #session: SessionGuard;
	readonly #flags: FlagSink;
	readonly #support: TransferSupportSource | null;
	readonly #win: Window | null;
	/** The last confirmed choice of this page, for blocked storage. */
	#remembered: readonly TransferField[] = DEFAULT_TRANSFER_FIELDS;

	constructor(
		data: SubtaskTransferData,
		session: SessionGuard,
		flags: FlagSink = SILENT_FLAGS,
		support: TransferSupportSource | null = null,
		win: Window | null = null
	) {
		this.#data = data;
		this.#session = session;
		this.#flags = flags;
		this.#support = support;
		this.#win = win;
	}

	/**
	 * Whether the server knows the route. Without a source (tests of single parts) the dialog sends,
	 * and a server without the route still leads to the hint.
	 */
	get support(): TransferSupport {
		const source = this.#support;
		if (source === null) return 'ready';
		const known = source.createSupport;
		if (known?.subtaskTransfer === true) return 'ready';
		if (source.createSupportProblem !== null) return 'failed';
		if (known === undefined || source.createSupportLoading) return 'pending';
		return 'missing';
	}

	/** Why the question failed (`failed`), null otherwise. */
	get supportProblem(): string | null {
		return this.support === 'failed' ? (this.#support?.createSupportProblem ?? null) : null;
	}

	/** The failed request behind `supportProblem`, for "Details" (FP-1, ADR-0071). */
	get supportFailure(): ProblemEntry | null {
		return this.support === 'failed' ? (this.#support?.createSupportFailure ?? null) : null;
	}

	/** The question runs ("Erneut versuchen" shows it). */
	get supportLoading(): boolean {
		return this.#support?.createSupportLoading ?? false;
	}

	/** Asks the server what it knows, unless it named everything already: on every opening. */
	async loadSupport(): Promise<void> {
		await this.#support?.loadCreateSupport();
	}

	/**
	 * The fields of the last confirmed choice on this device (read on every opening, so a choice of
	 * another tab counts as well); due date and priority without one.
	 */
	get rememberedFields(): readonly TransferField[] {
		try {
			const storage = storageOf(this.#win);
			if (storage !== null)
				return parseRememberedFields(storage.getItem(SUBTASK_TRANSFER_STORAGE_KEY));
		} catch {
			// Blocked storage: the choice of this page.
		}
		return this.#remembered;
	}

	#remember(chosen: Iterable<TransferField>): void {
		this.#remembered = rememberedOf(chosen);
		try {
			storageOf(this.#win)?.setItem(
				SUBTASK_TRANSFER_STORAGE_KEY,
				serializeRememberedFields(this.#remembered)
			);
		} catch {
			// Blocked or full storage: the choice lasts for this page.
		}
	}

	/**
	 * Transfers the chosen fields of `parent` (`chosen` are the checked fields of the dialog, which the
	 * device remembers without the project; after a change, UE-2, it remembers nothing: `remember`
	 * false). On success the flag names the number of changed sub-tasks; a refusal comes back as a
	 * message (409: the parent changed meanwhile, `stale`; a sub-task a hook refused with its key), a
	 * server without the route as `missing`. Without a session nothing is sent.
	 */
	async transfer(
		parent: { id: string; key: string },
		request: TransferRequest,
		chosen: Iterable<TransferField>,
		remember = true
	): Promise<TransferResult> {
		if (!this.#session.ensureValid()) return { ok: false, message: null, missing: false };
		try {
			const outcome = await withIntent(TRANSFER_INTENT, () =>
				this.#data.transfer(parent.id, request)
			);
			if (outcome === null) return { ok: false, message: null, missing: true };
			if (remember) this.#remember(chosen);
			this.#flags.show({ tone: 'success', title: transferredText(outcome.changed) });
			return { ok: true, outcome };
		} catch (error) {
			const failure = toDataError(error);
			if (failure.kind === 'session') this.#session.logout();
			if (failure.kind === 'session' || failure.kind === 'aborted') {
				return { ok: false, message: null, missing: false };
			}
			const problem = problemOf(failure);
			if (failure.status === 409) {
				return { ok: false, message: TRANSFER_STALE_MESSAGE, missing: false, stale: true, problem };
			}
			if (failure.kind === 'not_found') {
				return {
					ok: false,
					message: TRANSFER_MESSAGES.validation_transfer_missing ?? failure.message,
					missing: false,
					problem
				};
			}
			const field = failure.fields.targets ?? Object.values(failure.fields)[0];
			if (field === undefined) {
				return { ok: false, message: failure.message, missing: false, problem };
			}
			const key = typeof field.params?.key === 'string' ? field.params.key : null;
			return {
				ok: false,
				message: key === null ? field.message : targetFailureText(key, field.message),
				missing: false,
				problem
			};
		}
	}
}

const [getSubtaskTransferStore, setSubtaskTransferStore, hasSubtaskTransferStore] =
	createContext<SubtaskTransferStore>();

/** The store of the (app) layout, or null outside it (tests of single components). */
export function findSubtaskTransferStore(): SubtaskTransferStore | null {
	return hasSubtaskTransferStore() ? getSubtaskTransferStore() : null;
}

export { setSubtaskTransferStore };
