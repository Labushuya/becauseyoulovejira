// State of "Erste Schritte" (plan EH-12) for the (app) layout: which steps are reached and whether
// the list is dismissed, kept in localStorage on this device only. Storage that is blocked or full
// never breaks the app: the state then lasts for this page. The layout puts the store into the
// context; views and pages mark the steps they see.

import { createContext } from 'svelte';
import {
	EMPTY_FIRST_STEPS,
	FIRST_STEPS_STORAGE_KEY,
	parseFirstSteps,
	reachStep,
	serializeFirstSteps,
	type FirstStepId,
	type FirstStepsState
} from '$lib/domain/first-steps';

/** Access to the storage; null or a throwing storage count as "not available". */
export type StorageSource = () => Pick<Storage, 'getItem' | 'setItem'> | null;

/** localStorage of the window, or null where it is blocked. */
export const localStore: StorageSource = () => {
	try {
		return typeof window === 'undefined' ? null : window.localStorage;
	} catch {
		return null;
	}
};

export class FirstStepsStore {
	#state = $state<FirstStepsState>(EMPTY_FIRST_STEPS);
	readonly #storage: StorageSource;

	constructor(storage: StorageSource) {
		this.#storage = storage;
		try {
			this.#state = parseFirstSteps(storage()?.getItem(FIRST_STEPS_STORAGE_KEY));
		} catch {
			this.#state = EMPTY_FIRST_STEPS;
		}
	}

	get state(): FirstStepsState {
		return this.#state;
	}

	/** Marks a step as reached; nothing happens if it was reached already. */
	reach(id: FirstStepId): void {
		const next = reachStep(this.#state, id);
		if (next === this.#state) return;
		this.#set(next);
	}

	/** Hides the list for good on this device. */
	dismiss(): void {
		if (this.#state.dismissed) return;
		this.#set({ ...this.#state, dismissed: true });
	}

	#set(next: FirstStepsState): void {
		this.#state = next;
		try {
			this.#storage()?.setItem(FIRST_STEPS_STORAGE_KEY, serializeFirstSteps(next));
		} catch {
			// Blocked or full storage: the state lasts for this page.
		}
	}
}

const [getFirstStepsStore, setFirstStepsStore, hasFirstStepsStore] =
	createContext<FirstStepsStore>();

/** The store of the (app) layout, or null outside it (tests of single pages). */
export function findFirstStepsStore(): FirstStepsStore | null {
	return hasFirstStepsStore() ? getFirstStepsStore() : null;
}

export { getFirstStepsStore, setFirstStepsStore };
