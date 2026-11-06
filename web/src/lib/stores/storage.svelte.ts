// Page "Einstellungen → Speicher" (ADR-0047 §6 to §9; ADR-0006): what the app takes, measured when
// the page opens and again on "Neu messen" and after every action; the actions one at a time. The
// store lives with the page and ends its requests when the page goes. Results go out as flags.
// Since FP-3b a failure (a failed request, a refusal "script", an answer of another form) carries
// its entry for "Details" (ADR-0071) and is shown as an error; a refusal of the route and a refused
// choice stay a warning without one. "Verworfene jetzt leeren" names entries it could not empty
// (`failed` of its result) as a failure the server reports.

import type PocketBase from 'pocketbase';
import {
	detailsOf,
	problemDetails,
	reportedProblem,
	scriptProblem,
	toDataError
} from '$lib/data/errors';
import type { RequestOptions } from '$lib/data/options';
import { fetchStorage, runStorageAction, type StorageAnswer } from '$lib/data/storage';
import type { ProblemEntry } from '$lib/domain/problems';
import {
	ACTION_TEXTS,
	denialText,
	discardedFailedText,
	type LeftoverGroup,
	type StorageAction,
	type StorageOverview
} from '$lib/domain/storage';
import type { SystemDenial } from '$lib/domain/system';
import { RESTART_NEEDED, restartNeeded } from '$lib/guidance/texts';
import { SILENT_FLAGS, type FlagSink } from './flags.svelte';
import type { SessionGuard } from './ticket-list.svelte';

export interface StorageData {
	overview(options: RequestOptions): Promise<StorageAnswer<StorageOverview>>;
	act(
		action: StorageAction,
		groups: readonly LeftoverGroup[],
		options: RequestOptions
	): Promise<StorageAnswer<Record<string, unknown>>>;
}

export function storageData(pb: PocketBase): StorageData {
	return {
		overview: (options) => fetchStorage(pb, options),
		act: (action, groups, options) => runStorageAction(pb, action, groups, options)
	};
}

export type StorageState = 'idle' | 'loading' | 'ready' | 'denied' | 'error';

export interface StorageMessage {
	title: string;
	text: string;
	/** The failed action behind the message (FP-3b), for "Details"; absent for a refusal. */
	problem?: ProblemEntry | null;
}

/** What the page says for a refusal; "missing" is the hint to restart after an update. */
export function storageDenial(reason: SystemDenial): StorageMessage {
	if (reason === 'missing') {
		return { title: RESTART_NEEDED.title, text: restartNeeded('Die Seite Speicher ist') };
	}
	return denialText(reason);
}

/** A refusal with the entry of "script" (FP-3b); every other one stays without. */
function storageRefusal(answer: { kind: 'denied'; reason: SystemDenial }): StorageMessage {
	return { ...storageDenial(answer.reason), ...detailsOf(scriptProblem(answer)) };
}

/** Whether a message is a failure with "Details": an error, not a warning (FP-3b, P5). */
export function isStorageFailure(message: StorageMessage | null): boolean {
	return (message?.problem ?? null) !== null;
}

/** How many entries "Verworfene jetzt leeren" could not empty (`failed` of its result). */
function failedCount(result: Record<string, unknown>): number {
	const failed = result.failed;
	return typeof failed === 'number' && Number.isInteger(failed) && failed > 0 ? failed : 0;
}

export class StorageStore {
	readonly #data: StorageData;
	readonly #session: SessionGuard;
	readonly #flags: FlagSink;
	readonly #controller = new AbortController();

	#state = $state<StorageState>('idle');
	#overview = $state.raw<StorageOverview | null>(null);
	#message = $state<StorageMessage | null>(null);
	#busy = $state<StorageAction | null>(null);
	#actionMessage = $state<StorageMessage | null>(null);

	constructor(data: StorageData, session: SessionGuard, flags: FlagSink = SILENT_FLAGS) {
		this.#data = data;
		this.#session = session;
		this.#flags = flags;
	}

	get state(): StorageState {
		return this.#state;
	}

	get overview(): StorageOverview | null {
		return this.#overview;
	}

	/** Why the page shows nothing (refusal or failure). */
	get message(): StorageMessage | null {
		return this.#message;
	}

	/** The action that runs, or null. */
	get busy(): StorageAction | null {
		return this.#busy;
	}

	/** Why the last action did not run (shown at the actions, not as a flag). */
	get actionMessage(): StorageMessage | null {
		return this.#actionMessage;
	}

	/** Ends the requests of the page. */
	dispose(): void {
		this.#controller.abort();
	}

	/** Measures (again); the last overview stays while it runs. */
	async load(): Promise<void> {
		if (!this.#session.ensureValid()) return;
		if (this.#overview === null) this.#state = 'loading';
		try {
			const answer = await this.#data.overview({ signal: this.#controller.signal });
			if (answer.kind === 'ok') {
				this.#overview = answer.value;
				this.#message = null;
				this.#state = 'ready';
			} else if (this.#overview === null) {
				this.#message =
					answer.kind === 'denied'
						? storageRefusal(answer)
						: { title: denialText('script').title, text: answer.message };
				this.#state = 'denied';
			}
		} catch (error) {
			const failure = toDataError(error, this.#controller.signal);
			if (failure.kind === 'aborted') return;
			if (failure.kind === 'session') {
				this.#session.logout();
				return;
			}
			if (this.#overview === null) {
				this.#message = {
					title: denialText('script').title,
					text: failure.message,
					...problemDetails(failure)
				};
				this.#state = 'error';
			}
		}
	}

	/**
	 * Runs an action (one at a time), says what happened as a flag and measures again. A refusal
	 * stays at the actions; returns whether it ran.
	 */
	async run(action: StorageAction, groups: readonly LeftoverGroup[] = []): Promise<boolean> {
		if (this.#busy !== null || !this.#session.ensureValid()) return false;
		this.#busy = action;
		this.#actionMessage = null;
		try {
			const answer = await this.#data.act(action, groups, { signal: this.#controller.signal });
			if (answer.kind === 'denied') {
				this.#actionMessage = storageRefusal(answer);
				return false;
			}
			if (answer.kind === 'invalid') {
				this.#actionMessage = { title: ACTION_TEXTS[action].title, text: answer.message };
				return false;
			}
			const failed = action === 'discarded' ? failedCount(answer.value) : 0;
			if (failed > 0) {
				// The action ran, but some entries stayed: the server reports it in its result.
				const text = discardedFailedText(failed);
				this.#flags.show({
					tone: 'error',
					title: text,
					problem: reportedProblem({
						intent: ACTION_TEXTS[action].title,
						method: 'POST',
						path: `/api/byl/storage/actions/${action}`,
						code: 'failed',
						message: text
					})
				});
			} else {
				this.#flags.show({ tone: 'success', title: ACTION_TEXTS[action].done });
			}
			await this.load();
			return true;
		} catch (error) {
			const failure = toDataError(error, this.#controller.signal);
			if (failure.kind === 'session') this.#session.logout();
			if (failure.kind !== 'aborted' && failure.kind !== 'session') {
				this.#actionMessage = {
					title: ACTION_TEXTS[action].title,
					text: failure.message,
					...problemDetails(failure)
				};
			}
			return false;
		} finally {
			this.#busy = null;
		}
	}
}
