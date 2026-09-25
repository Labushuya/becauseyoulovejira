// Flags (ADR-0025 section 8; plan UI-Konsistenz, package UI-5): results of actions without a fixed
// place (created, converted, imported, deleted, "Rückgängig") and failed actions of table rows,
// shown bottom left by FlagGroup.svelte. Success and info leave after FLAG_DURATION_MS, errors stay
// until they are closed. The clock stops while any pause reason holds (pointer or focus on the
// flags, hidden tab, open modal), so nobody misses a flag or its action. At most MAX_FLAGS are
// shown, the newest first; a further one pushes out the oldest. The store never moves the focus.

import { createContext } from 'svelte';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';

/** How long a success or info flag stays (ADS minimum; decision 3 of the user: "Rückgängig" 8 s). */
export const FLAG_DURATION_MS = 8000;

/** Flags shown at the same time. */
export const MAX_FLAGS = 3;

export type FlagTone = 'success' | 'info' | 'error';

/** The one action of a flag, e.g. "Rückgängig"; running it closes the flag. */
export interface FlagAction {
	label: string;
	run: () => unknown;
}

export interface FlagInput {
	tone: FlagTone;
	title: string;
	description?: string;
	action?: FlagAction;
	/** Milliseconds until it leaves; null stays until closed. Default: 8 s, errors stay. */
	duration?: number | null;
	/** Called once when the flag leaves (timeout, ×, action, pushed out, cleared). */
	onclose?: () => void;
}

export interface Flag {
	readonly id: string;
	readonly tone: FlagTone;
	readonly title: string;
	readonly description: string;
	readonly action: FlagAction | null;
}

/** What the stores need of the flags; tests and views without flags pass SILENT_FLAGS. */
export interface FlagSink {
	/** Shows a flag and returns its ID. */
	show(input: FlagInput): string;
	dismiss(id: string): void;
}

export const SILENT_FLAGS: FlagSink = {
	show: () => '',
	dismiss: () => undefined
};

/** Why the clock stands still. */
export type PauseReason = 'hover' | 'focus' | 'hidden' | 'modal';

/** Text for a live region; the ID makes the same text count as a new message. */
export interface FlagMessage {
	readonly id: string;
	readonly text: string;
}

interface Entry {
	flag: Flag;
	/** Milliseconds left; null: stays until closed. */
	remaining: number | null;
	startedAt: number;
	timer: ReturnType<typeof setTimeout> | undefined;
	onclose: (() => void) | undefined;
}

export class FlagStore implements FlagSink {
	readonly #entries = new SvelteMap<string, Entry>();
	readonly #pauses = new SvelteSet<PauseReason>();
	#count = 0;

	#flags = $state.raw<readonly Flag[]>([]);
	#status = $state.raw<FlagMessage | null>(null);
	#alert = $state.raw<FlagMessage | null>(null);
	#paused = $state(false);

	/** Shown flags, newest first. */
	get flags(): readonly Flag[] {
		return this.#flags;
	}

	/** Latest success or info message for the polite live region. */
	get statusMessage(): FlagMessage | null {
		return this.#status;
	}

	/** Latest error message for the assertive live region. */
	get alertMessage(): FlagMessage | null {
		return this.#alert;
	}

	/** True while the clock stands still. */
	get paused(): boolean {
		return this.#paused;
	}

	show(input: FlagInput): string {
		this.#count += 1;
		const id = `flag-${this.#count}`;
		const flag: Flag = {
			id,
			tone: input.tone,
			title: input.title,
			description: input.description ?? '',
			action: input.action ?? null
		};
		const remaining =
			input.duration !== undefined
				? input.duration
				: input.tone === 'error'
					? null
					: FLAG_DURATION_MS;
		const entry: Entry = {
			flag,
			remaining,
			startedAt: Date.now(),
			timer: undefined,
			onclose: input.onclose
		};
		this.#entries.set(id, entry);
		if (this.#pauses.size === 0) this.#start(entry);
		this.#flags = [flag, ...this.#flags];
		for (const old of this.#flags.slice(MAX_FLAGS)) this.dismiss(old.id);

		const message = {
			id,
			text: flag.description === '' ? flag.title : `${flag.title} ${flag.description}`
		};
		if (flag.tone === 'error') this.#alert = message;
		else this.#status = message;
		return id;
	}

	dismiss(id: string): void {
		const entry = this.#entries.get(id);
		if (entry === undefined) return;
		clearTimeout(entry.timer);
		this.#entries.delete(id);
		this.#flags = this.#flags.filter((flag) => flag.id !== id);
		entry.onclose?.();
	}

	/** Runs the action of a flag and closes it; the action sees its data before `onclose`. */
	act(id: string): void {
		const entry = this.#entries.get(id);
		if (entry === undefined) return;
		entry.flag.action?.run();
		this.dismiss(id);
	}

	pause(reason: PauseReason): void {
		if (this.#pauses.has(reason)) return;
		if (this.#pauses.size === 0) {
			const now = Date.now();
			for (const entry of this.#entries.values()) {
				clearTimeout(entry.timer);
				entry.timer = undefined;
				if (entry.remaining !== null) {
					entry.remaining = Math.max(0, entry.remaining - (now - entry.startedAt));
				}
			}
		}
		this.#pauses.add(reason);
		this.#paused = true;
	}

	resume(reason: PauseReason): void {
		if (!this.#pauses.delete(reason) || this.#pauses.size > 0) return;
		this.#paused = false;
		for (const entry of this.#entries.values()) this.#start(entry);
	}

	/** Closes every flag (sign-out, leaving the app); pause reasons stay with their sources. */
	clear(): void {
		for (const id of [...this.#entries.keys()]) this.dismiss(id);
		this.#status = null;
		this.#alert = null;
	}

	#start(entry: Entry): void {
		if (entry.remaining === null) return;
		entry.startedAt = Date.now();
		entry.timer = setTimeout(() => this.dismiss(entry.flag.id), entry.remaining);
	}
}

const [getFlagStore, setFlagStore] = createContext<FlagStore>();

/** Flags of the app, set by the app layout. */
export { getFlagStore, setFlagStore };
