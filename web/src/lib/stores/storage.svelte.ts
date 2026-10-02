// Page "Einstellungen → Speicher" (ADR-0047 §6 to §9; ADR-0006): what the app takes, measured when
// the page opens and again on "Neu messen" and after every action; the actions one at a time. The
// store lives with the page and ends its requests when the page goes. Results go out as flags.

import type PocketBase from 'pocketbase';
import { toDataError } from '$lib/data/errors';
import type { RequestOptions } from '$lib/data/options';
import { fetchStorage, runStorageAction, type StorageAnswer } from '$lib/data/storage';
import {
	ACTION_TEXTS,
	denialText,
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
}

/** What the page says for a refusal; "missing" is the hint to restart after an update. */
export function storageDenial(reason: SystemDenial): StorageMessage {
	if (reason === 'missing') {
		return { title: RESTART_NEEDED.title, text: restartNeeded('Die Seite Speicher ist') };
	}
	return denialText(reason);
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
						? storageDenial(answer.reason)
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
				this.#message = { title: denialText('script').title, text: failure.message };
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
				this.#actionMessage = storageDenial(answer.reason);
				return false;
			}
			if (answer.kind === 'invalid') {
				this.#actionMessage = { title: ACTION_TEXTS[action].title, text: answer.message };
				return false;
			}
			this.#flags.show({ tone: 'success', title: ACTION_TEXTS[action].done });
			await this.load();
			return true;
		} catch (error) {
			const failure = toDataError(error, this.#controller.signal);
			if (failure.kind === 'session') this.#session.logout();
			if (failure.kind !== 'aborted' && failure.kind !== 'session') {
				this.#actionMessage = { title: ACTION_TEXTS[action].title, text: failure.message };
			}
			return false;
		} finally {
			this.#busy = null;
		}
	}
}
